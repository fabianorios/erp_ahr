import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, centsToReais } from "../src/services/erp/domain.ts";
import {
  ambienteNfse,
  codigoIbgeConhecido,
  instanteBrasil,
  lerNotaAutorizada,
  montarDps,
  numeroDps,
  tituloDaNota,
  validarPedidoNfse,
  type PedidoNfse,
  type TituloNascido,
} from "../src/services/erp/nfse-nacional.ts";
import { diretorioNfse, gravarPdfEm } from "./boleto-cora.ts";

type Banco = SupabaseClient;

type GravadorNfse = {
  inserir(row: Record<string, unknown>): Promise<string>;
  faturar(id: string): Promise<void>;
  inserirNfse(row: Record<string, unknown>): Promise<void>;
  gravarPdf(id: string, pdf: Uint8Array): Promise<void>;
};

export function incorporarXml(corpo: string): string {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(corpo) as Record<string, unknown>;
  } catch {
    return corpo;
  }
  if (typeof json.nfseXml === "string" && json.nfseXml.trim()) return corpo;
  const gzip = typeof json.nfseXmlGZipB64 === "string" ? json.nfseXmlGZipB64 : "";
  if (!gzip) return corpo;
  try {
    json.nfseXml = gunzipSync(Buffer.from(gzip, "base64")).toString("utf8");
  } catch {
    throw new DomainError("O Emissor Nacional devolveu uma nota ilegível.");
  }
  return JSON.stringify(json);
}

export function assinarDps(xml: string, chave: string, certificado: string): string {
  const id = / Id="(DPS\d{42})"/.exec(xml)?.[1];
  if (!id) throw new DomainError("A DPS da NFS-e ficou sem identificador.");
  const assinatura = new SignedXml({
    privateKey: chave,
    publicCert: certificado,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  assinatura.addReference({
    xpath: `//*[@Id='${id}']`,
    uri: `#${id}`,
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
  });
  assinatura.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='infDPS']", action: "after" },
  });
  return assinatura.getSignedXml();
}

/** Grava o título só depois da nota autorizada. Rejeição não chama o gravador. */
export async function aplicarNota(
  gravar: Pick<GravadorNfse, "inserir" | "faturar" | "inserirNfse">,
  pedido: PedidoNfse,
  status: number,
  corpo: string,
): Promise<string> {
  const nota = lerNotaAutorizada(status, incorporarXml(corpo), pedido.descricao, pedido.valor);
  const titulo = tituloDaNota(pedido, nota);
  const id = await gravar.inserir(linhaTitulo(titulo));
  await gravar.faturar(id);
  await gravar.inserirNfse(linhaNfse(id, titulo));
  return id;
}

function linhaTitulo(titulo: TituloNascido): Record<string, unknown> {
  return {
    cliente_id: titulo.clienteId,
    centro_custo_id: titulo.centroId,
    descricao: titulo.descricao,
    valor: centsToReais(titulo.valorCents),
    vencimento: titulo.vencimento,
    competencia: titulo.competencia,
    origem: titulo.origem,
    parcela: 1,
    quantidade_parcelas: 1,
    forma_recebimento: titulo.forma,
    numero_nf: titulo.numeroNf,
    tipo_vencimento: "data_fixa",
    banco: titulo.banco,
    status: "previsto",
  };
}

function linhaNfse(tituloId: string, titulo: TituloNascido): Record<string, unknown> {
  return {
    conta_receber_id: tituloId,
    numero: titulo.nfse.numero,
    valor: centsToReais(titulo.nfse.valorCents),
    vencimento: titulo.nfse.vencimento,
    data_emissao: titulo.nfse.dataEmissao,
    status: "informada",
    emissor: titulo.nfse.emissor,
    municipio: titulo.nfse.municipio,
    id_externo: titulo.nfse.chave,
    codigo_verificacao: titulo.nfse.codigo,
  };
}

function texto(dados: Record<string, unknown>, chave: string): string {
  const valor = dados[chave];
  return valor == null ? "" : String(valor);
}

type CertificadoA1 = { chave: string; certificado: string };

const RAIZ_GESTAO = "/var/www/gestaoconsultoria";
const IGNORAR_GESTAO = new Set(["node_modules", "vendor", ".git", "storage", "dist", "build"]);

/** Lê o PFX já configurado no Gestão. Não registra senha nem certificado. */
export function certificadoDaGestao(raiz = RAIZ_GESTAO): { caminho: string; senha: string } | null {
  if (!existsSync(raiz)) return null;
  const esocial = certificadoEsocial(raiz);
  if (esocial) return esocial;
  const textos: string[] = [];
  coletarEnv(raiz, 0, textos);
  return escolherCertificado(textos.flatMap(parseEnv));
}

function certificadoEsocial(raiz: string): { caminho: string; senha: string } | null {
  const caminho = join(raiz, "secrets", "esocial.pfx");
  const envPath = join(raiz, "secrets", "esocial.env");
  if (!existsSync(caminho) || !existsSync(envPath)) return null;
  let texto = "";
  try {
    texto = readFileSync(envPath, "utf8");
  } catch {
    return null;
  }
  const senha = parseEnv(texto).find((item) => item.chave.toUpperCase() === "ESOCIAL_CERT_PASSWORD")?.valor ?? "";
  if (!senha.trim()) return null;
  return { caminho, senha };
}

function coletarEnv(dir: string, profundidade: number, textos: string[]): void {
  if (profundidade > 2) return;
  let entradas: string[] = [];
  try {
    entradas = readdirSync(dir);
  } catch {
    return;
  }
  for (const nome of entradas) {
    if (IGNORAR_GESTAO.has(nome)) continue;
    const caminho = join(dir, nome);
    let info;
    try {
      info = statSync(caminho);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      coletarEnv(caminho, profundidade + 1, textos);
      continue;
    }
    if (nome !== ".env" && !nome.startsWith(".env.") && !nome.endsWith(".env")) continue;
    if (info.size > 200_000) continue;
    try {
      textos.push(readFileSync(caminho, "utf8"));
    } catch {
      continue;
    }
  }
}

function parseEnv(texto: string): { chave: string; valor: string }[] {
  const saida: { chave: string; valor: string }[] = [];
  for (const linha of texto.split("\n")) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith("#")) continue;
    const achado = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(limpa);
    if (!achado) continue;
    let valor = achado[2].trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) valor = valor.slice(1, -1);
    saida.push({ chave: achado[1], valor });
  }
  return saida;
}

function escolherCertificado(entradas: { chave: string; valor: string }[]): { caminho: string; senha: string } | null {
  const pfxs = entradas.filter((item) => /\.(pfx|p12)$/i.test(item.valor.trim()));
  const esocial = pfxs.find((item) => /esocial\.pfx$/i.test(item.valor.trim()) || item.chave.toUpperCase().includes("ESOCIAL"));
  if (esocial) {
    const senha = senhaDoPar(entradas, esocial.chave)
      ?? entradas.find((item) => item.chave.toUpperCase() === "ESOCIAL_CERT_PASSWORD" && item.valor)?.valor
      ?? null;
    if (senha) return { caminho: esocial.valor.trim(), senha };
  }
  const ordenados = [...pfxs].sort((a, b) => pontuarChave(b.chave) - pontuarChave(a.chave));
  for (const item of ordenados) {
    const senha = senhaDoPar(entradas, item.chave);
    if (senha) return { caminho: item.valor.trim(), senha };
  }
  if (pfxs.length === 1) {
    const senhas = entradas.filter((item) => /SENHA|PASSWORD|PASSWD|_PWD/i.test(item.chave) && item.valor && !/\.(pfx|p12)$/i.test(item.valor));
    if (senhas.length === 1) return { caminho: pfxs[0].valor.trim(), senha: senhas[0].valor };
  }
  return null;
}

function pontuarChave(chave: string): number {
  const nome = chave.toUpperCase();
  let pontos = 0;
  if (nome.includes("NFSE") || nome.includes("NFS")) pontos += 4;
  if (nome.includes("A1")) pontos += 3;
  if (nome.includes("CERT")) pontos += 2;
  if (nome.includes("PFX")) pontos += 2;
  return pontos;
}

function senhaDoPar(entradas: { chave: string; valor: string }[], chavePath: string): string | null {
  const base = chavePath.replace(/_(PATH|FILE|CAMINHO|PFX|CERT|CERTIFICADO)$/i, "");
  const nomes = [`${chavePath}_PASSWORD`, `${chavePath}_SENHA`, `${base}_PASSWORD`, `${base}_SENHA`, `${base}_PASS`, `${base}_PWD`];
  for (const nome of nomes) {
    const achado = entradas.find((item) => item.chave.toUpperCase() === nome.toUpperCase() && item.valor);
    if (achado) return achado.valor;
  }
  return null;
}

/** No servidor do Gestão o A1 de lá é obrigatório. Fora dele, vale o PFX do próprio ERP. */
export function certificadoDaEmissao(
  raiz = RAIZ_GESTAO,
  ambiente: NodeJS.ProcessEnv = process.env,
): { caminho: string; senha: string } {
  if (existsSync(raiz)) {
    const gestao = certificadoDaGestao(raiz);
    if (!gestao?.caminho || !gestao.senha || !existsSync(gestao.caminho)) {
      throw new DomainError("O certificado A1 do Gestão não foi encontrado.");
    }
    return gestao;
  }
  const caminho = (ambiente.NFSE_CERT_PATH ?? "").trim();
  const senha = ambiente.NFSE_CERT_PASSWORD ?? "";
  if (!caminho || !senha.trim()) throw new DomainError("O certificado A1 da NFS-e não está configurado no servidor.");
  return { caminho, senha };
}

function falhaCertificado(): DomainError {
  return new DomainError("O certificado A1 não abriu. Confira o arquivo PFX e a senha.");
}

function abrirComForge(pfx: Buffer, senha: string): CertificadoA1 {
  const der = forge.util.createBuffer(pfx.toString("binary"));
  const asn1 = forge.asn1.fromDer(der);
  const pacote = forge.pkcs12.pkcs12FromAsn1(asn1, senha);
  const chaveBag = pacote.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key
    ?? pacote.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0]?.key;
  const certBag = pacote.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0]?.cert;
  if (!chaveBag || !certBag) throw new Error("sem chave");
  return {
    chave: forge.pki.privateKeyToPem(chaveBag),
    certificado: forge.pki.certificateToPem(certBag),
  };
}

function pemDe(texto: string, rotulo: string): string {
  const inicio = `-----BEGIN ${rotulo}-----`;
  const fim = `-----END ${rotulo}-----`;
  const de = texto.indexOf(inicio);
  const ate = texto.indexOf(fim);
  if (de < 0 || ate < 0) return "";
  return `${texto.slice(de, ate + fim.length)}\n`;
}

function opensslPkcs12(caminho: string, senha: string, extra: string[]): string {
  const resultado = spawnSync(
    "openssl",
    ["pkcs12", "-legacy", "-in", caminho, "-passin", "stdin", ...extra],
    { input: `${senha}\n`, encoding: "utf8", maxBuffer: 2_000_000 },
  );
  if (resultado.status !== 0) throw falhaCertificado();
  return resultado.stdout ?? "";
}

function pemTodos(texto: string, rotulo: string): string {
  const inicio = `-----BEGIN ${rotulo}-----`;
  const fim = `-----END ${rotulo}-----`;
  const partes: string[] = [];
  let de = texto.indexOf(inicio);
  while (de >= 0) {
    const ate = texto.indexOf(fim, de);
    if (ate < 0) break;
    partes.push(`${texto.slice(de, ate + fim.length)}\n`);
    de = texto.indexOf(inicio, ate + fim.length);
  }
  return partes.join("");
}

function abrirComOpenssl(caminho: string, senha: string): CertificadoA1 {
  const chave = pemDe(opensslPkcs12(caminho, senha, ["-nocerts", "-noenc"]), "PRIVATE KEY")
    || pemDe(opensslPkcs12(caminho, senha, ["-nocerts", "-noenc"]), "RSA PRIVATE KEY");
  const certificado = pemTodos(opensslPkcs12(caminho, senha, ["-nokeys"]), "CERTIFICATE");
  if (!chave || !certificado) throw falhaCertificado();
  return { chave, certificado };
}

/** Tenta o leitor interno e, se o PFX for antigo, o OpenSSL com -legacy. A senha não entra na mensagem. */
export function abrirPfx(pfx: Buffer, senha: string, caminho?: string): CertificadoA1 {
  try {
    return abrirComForge(pfx, senha);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (!caminho) throw falhaCertificado();
    try {
      return abrirComOpenssl(caminho, senha);
    } catch (seguinte) {
      if (seguinte instanceof DomainError) throw seguinte;
      throw falhaCertificado();
    }
  }
}

function configPrestador(): {
  base: string;
  ambiente: 1 | 2;
  cnpj: string;
  codigoServico: string;
  codigoMunicipal: string;
  cNbs: string;
  aliquota: string;
  serie: string;
  cMun: string;
  chave: string;
  certificado: string;
} {
  const ambiente = ambienteNfse(process.env.NFSE_AMBIENTE ?? "");
  const { caminho: certPath, senha } = certificadoDaEmissao();
  if (!certPath || !senha.trim()) throw new DomainError("O certificado A1 da NFS-e não está configurado no servidor.");
  const serie = (process.env.NFSE_SERIE_DPS ?? "").trim();
  if (!serie) throw new DomainError("A série da DPS não está configurada.");
  const codigoServico = (process.env.NFSE_ITEM_SERVICO ?? "").trim();
  const codigoMunicipal = (process.env.NFSE_CODIGO_TRIBUTACAO ?? "").trim();
  const cNbs = (process.env.NFSE_CODIGO_NBS ?? "").trim();
  const aliquota = (process.env.NFSE_ALIQUOTA_ISS ?? "").trim();
  if (!codigoServico) throw new DomainError("O item de serviço da NFS-e não está configurado.");
  if (!codigoMunicipal) throw new DomainError("O código de tributação municipal da NFS-e não está configurado.");
  if (!cNbs) throw new DomainError("O código NBS da NFS-e não está configurado.");
  if (!aliquota) throw new DomainError("A alíquota da NFS-e não está configurada.");
  let pfx: Buffer;
  try {
    pfx = readFileSync(certPath);
  } catch {
    throw new DomainError("O certificado A1 da NFS-e não está no servidor.");
  }
  const aberto = abrirPfx(pfx, senha, certPath);
  return {
    base: ambiente.base,
    ambiente: ambiente.ambiente,
    cnpj: (process.env.NFSE_CNPJ ?? "").trim(),
    codigoServico,
    codigoMunicipal,
    cNbs,
    aliquota,
    serie,
    cMun: (process.env.NFSE_CODIGO_MUNICIPIO ?? "").trim(),
    chave: aberto.chave,
    certificado: aberto.certificado,
  };
}

async function codigoTomador(cidade: string, uf: string, cep: string): Promise<string> {
  const conhecido = codigoIbgeConhecido(cidade, uf);
  if (conhecido) return conhecido;
  if (!/^\d{8}$/.test(cep)) throw new DomainError("O cliente precisa de CEP para a NFS-e.");
  const resposta = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(8_000) });
  if (!resposta.ok) throw new DomainError("Não foi possível identificar o município do cliente.");
  const json = (await resposta.json()) as { ibge?: string; erro?: boolean };
  if (json.erro || !/^\d{7}$/.test(json.ibge ?? "")) throw new DomainError("Não foi possível identificar o município do cliente.");
  return json.ibge ?? "";
}

export async function emitirNfseECriarTitulo(db: Banco, dados: Record<string, unknown>): Promise<{ id: string }> {
  const clienteId = texto(dados, "clienteId").trim();
  const centroId = texto(dados, "centroId").trim();
  const { data: cliente, error: clienteErro } = await db
    .from("clients")
    .select("id, name, document, email, logradouro, numero, bairro, cidade, uf, cep, complemento")
    .eq("id", clienteId)
    .maybeSingle();
  if (clienteErro) throw new DomainError("Não foi possível ler o cliente.");
  if (!cliente) throw new DomainError("Informe o cliente.");
  const { data: centro, error: centroErro } = await db.from("erp_centros_custo").select("id, ativo").eq("id", centroId).maybeSingle();
  if (centroErro) throw new DomainError("Não foi possível ler o centro de custo.");
  if (!centro?.ativo) throw new DomainError("Informe o centro de custo.");
  const prestador = configPrestador();
  const agora = new Date();
  const emitidoEm = instanteBrasil(agora);
  const vencimento = texto(dados, "vencimento");
  const cep = String(cliente.cep ?? "").replace(/\D/g, "");
  const pedido = validarPedidoNfse({
    clienteId,
    descricao: texto(dados, "descricao"),
    valor: texto(dados, "valor"),
    vencimento,
    competencia: emitidoEm.slice(0, 10),
    centroId,
    forma: texto(dados, "forma"),
    banco: texto(dados, "banco"),
    documento: String(cliente.document ?? ""),
    nome: String(cliente.name ?? ""),
    email: String(cliente.email ?? ""),
    logradouro: String(cliente.logradouro ?? ""),
    numero: String(cliente.numero ?? ""),
    bairro: String(cliente.bairro ?? ""),
    cidade: String(cliente.cidade ?? ""),
    uf: String(cliente.uf ?? ""),
    cep,
    complemento: String(cliente.complemento ?? ""),
    cMunTomador: await codigoTomador(String(cliente.cidade ?? ""), String(cliente.uf ?? ""), cep),
    cMunPrestador: prestador.cMun,
    cnpjPrestador: prestador.cnpj,
    inscricaoMunicipal: "",
    codigoServico: prestador.codigoServico,
    codigoMunicipal: prestador.codigoMunicipal,
    cNbs: prestador.cNbs,
    aliquota: prestador.aliquota,
    serie: prestador.serie,
    numeroDps: numeroDps(agora, agora.getMilliseconds()),
    emitidoEm,
    ambiente: prestador.ambiente,
  });
  const xml = assinarDps(montarDps(pedido), prestador.chave, prestador.certificado);
  const enviado = gzipSync(Buffer.from(xml, "utf8")).toString("base64");
  const resposta = await postarSefin(prestador.base, prestador.certificado, prestador.chave, enviado);
  const id = await aplicarNota(gravador(db), pedido, resposta.status, resposta.texto);
  try {
    await guardarPdf(db, id, prestador.certificado, prestador.chave, pedido.ambiente === 1);
  } catch (erro) {
    if (erro instanceof DomainError && /autorizada/.test(erro.message)) throw erro;
    const detalhe = erro instanceof DomainError ? erro.message : "O PDF não foi gravado.";
    throw new DomainError(`A nota foi autorizada e o título foi aberto. ${detalhe}`);
  }
  return { id };
}

function gravador(db: Banco): GravadorNfse {
  return {
    async inserir(row) {
      const { data, error } = await db.from("erp_contas_receber").insert(row).select("id");
      if (error || !data?.[0]?.id) {
        throw new DomainError(`A nota foi autorizada no Emissor Nacional, mas o título não foi gravado. ${error?.message ?? ""}`.trim());
      }
      return String(data[0].id);
    },
    async faturar(id) {
      const { data, error } = await db.from("erp_contas_receber").update({ status: "faturado" }).eq("id", id).select("id");
      if (error || !data?.length) {
        throw new DomainError(`A nota foi autorizada no Emissor Nacional, mas o título não ficou faturado. ${error?.message ?? ""}`.trim());
      }
    },
    async inserirNfse(row) {
      const primeira = await db.from("erp_nfse").insert(row).select("id");
      const erro = primeira.error;
      if (!erro && primeira.data?.[0]?.id) return;
      const textoErro = `${erro?.message ?? ""}`;
      if (/check|emissor/i.test(textoErro)) {
        const deNovo = await db.from("erp_nfse").insert({ ...row, emissor: "giss" }).select("id");
        if (!deNovo.error && deNovo.data?.[0]?.id) return;
      }
      throw new DomainError(`A nota foi autorizada no Emissor Nacional e o título foi aberto, mas a NFS-e não foi gravada. Rode sql/nfse-nacional.sql. ${textoErro}`.trim());
    },
    async gravarPdf(id, pdf) {
      await gravarPdfEm(diretorioNfse(), id, pdf);
      const { error } = await db.from("erp_nfse").update({ pdf_path: `${id.toLowerCase()}.pdf` }).eq("conta_receber_id", id);
      if (error && !/pdf_path/i.test(error.message ?? "")) throw new DomainError("A nota foi autorizada, mas o PDF não foi gravado.");
    },
  };
}

export async function gravarPdfDaNota(db: Banco, tituloId: string): Promise<void> {
  const { data, error } = await db.from("erp_nfse").select("id_externo, pdf_path").eq("conta_receber_id", tituloId).maybeSingle();
  if (error) throw new DomainError("Não foi possível ler a NFS-e.");
  if (!data) throw new DomainError("Este título não tem NFS-e.");
  if (typeof data.pdf_path === "string" && data.pdf_path.trim()) return;
  const chaveAcesso = typeof data.id_externo === "string" ? data.id_externo : "";
  const conexao = conexaoNfse();
  await guardarPdf(db, tituloId, chaveAcesso, conexao.certificado, conexao.chave, conexao.producao);
}

function conexaoNfse(): { certificado: string; chave: string; producao: boolean } {
  const ambiente = ambienteNfse(process.env.NFSE_AMBIENTE ?? "");
  const { caminho, senha } = certificadoDaEmissao();
  if (!caminho || !senha.trim()) throw new DomainError("O certificado A1 da NFS-e não está configurado no servidor.");
  let pfx: Buffer;
  try {
    pfx = readFileSync(caminho);
  } catch {
    throw new DomainError("O certificado A1 da NFS-e não está no servidor.");
  }
  let aberto: CertificadoA1;
  try {
    aberto = abrirComOpenssl(caminho, senha);
  } catch (erro) {
    if (!(erro instanceof DomainError)) throw falhaCertificado();
    try {
      aberto = abrirComForge(pfx, senha);
    } catch {
      throw erro;
    }
  }
  return { certificado: aberto.certificado, chave: aberto.chave, producao: ambiente.ambiente === 1 };
}

async function guardarPdf(db: Banco, tituloId: string, chaveAcesso: string, certificado: string, chave: string, producao: boolean): Promise<void> {
  if (!/^\d{50}$/.test(chaveAcesso)) throw new DomainError("A NFS-e não tem chave de acesso.");
  const pdf = await baixarDanfse(chaveAcesso, certificado, chave, producao);
  await gravador(db).gravarPdf(tituloId, pdf);
}

export function pdfDanfse(corpo: Buffer): Buffer | null {
  if (corpo.subarray(0, 5).toString("utf8") === "%PDF-") return corpo;
  try {
    const achado = pdfNoJson(JSON.parse(corpo.toString("utf8")) as unknown);
    if (achado) return achado;
  } catch {
    /* o corpo não era JSON */
  }
  return null;
}

function pdfNoJson(valor: unknown): Buffer | null {
  if (typeof valor === "string" && valor.length >= 20) {
    const binario = Buffer.from(valor, "base64");
    if (binario.subarray(0, 5).toString("utf8") === "%PDF-") return binario;
  }
  if (!valor || typeof valor !== "object") return null;
  for (const item of Object.values(valor as Record<string, unknown>)) {
    const achado = pdfNoJson(item);
    if (achado) return achado;
  }
  return null;
}

export function cookiesSessao(setCookie: string | string[] | undefined): string[] {
  const lista = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return lista.map((item) => item.split(";", 1)[0]?.trim() ?? "").filter((item) => item.includes("="));
}

export function falhaPdfDanfse(tentativas: { url: string; status: number | "sem resposta" }[]): string {
  const partes = tentativas.map((tentativa) => `${rotuloDanfse(tentativa.url)} HTTP ${tentativa.status}`);
  return `O PDF da NFS-e não foi obtido (${partes.join("; ")}).`;
}

function rotuloDanfse(url: string): string {
  const alvo = new URL(url);
  return `${alvo.host}${alvo.pathname.replace(/\/\d{50}(?=$)/, "")}`;
}

export function enderecoLoginDanfse(producao: boolean): string {
  return producao
    ? "https://certificado.nfse.gov.br/EmissorNacional/Certificado"
    : "https://certificado.producaorestrita.nfse.gov.br/EmissorNacional/Certificado";
}

function urlsDanfse(producao: boolean, chave: string): { adn: string; emissor: string; login: string } {
  const portal = producao ? "https://www.nfse.gov.br" : "https://www.producaorestrita.nfse.gov.br";
  const adn = producao ? "https://adn.nfse.gov.br" : "https://adn.producaorestrita.nfse.gov.br";
  return {
    adn: `${adn}/danfse/${chave}`,
    emissor: `${portal}/EmissorNacional/Notas/Download/DANFSe/${chave}`,
    login: enderecoLoginDanfse(producao),
  };
}

async function baixarDanfse(chave: string, certificado: string, chavePrivada: string, producao: boolean): Promise<Buffer> {
  const urls = urlsDanfse(producao, chave);
  const tentativas: { url: string; status: number | "sem resposta" }[] = [];
  try {
    const adn = await httpsGet(urls.adn, certificado, chavePrivada, { accept: "application/pdf, application/json" });
    const pdfAdn = pdfDanfse(adn.corpo);
    if (pdfAdn) return pdfAdn;
    tentativas.push({ url: urls.adn, status: adn.status });
  } catch (erro) {
    if (erro instanceof DomainError && /grande demais/.test(erro.message)) throw erro;
    tentativas.push({ url: urls.adn, status: "sem resposta" });
  }
  const login = await httpsGet(urls.login, certificado, chavePrivada, cabecalhosPortal("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"), true);
  const cookies = login.jar;
  if (!cookies.length || login.status === 403 || /\/Login/i.test(login.location)) {
    tentativas.push({ url: urls.login, status: login.status });
    throw new DomainError(falhaPdfDanfse(tentativas));
  }
  const baixado = await httpsGet(
    urls.emissor,
    certificado,
    chavePrivada,
    { ...cabecalhosPortal("application/pdf,*/*;q=0.8"), cookie: cookies.join("; ") },
    true,
  );
  const pdf = pdfDanfse(baixado.corpo);
  if (pdf) return pdf;
  tentativas.push({ url: urls.emissor, status: baixado.status });
  throw new DomainError(falhaPdfDanfse(tentativas));
}

function postarSefin(base: string, certificado: string, chave: string, dpsXmlGZipB64: string): Promise<{ status: number; texto: string }> {
  return httpsTexto({
    url: `${base}/nfse`,
    method: "POST",
    certificado,
    chave,
    body: JSON.stringify({ dpsXmlGZipB64 }),
    headers: { "content-type": "application/json", accept: "application/json" },
    limite: 8_000_000,
  });
}

type RespostaHttp = { status: number; corpo: Buffer; cookies: string[]; location: string; jar: string[] };

function cabecalhosPortal(accept: string): Record<string, string> {
  return {
    accept,
    "user-agent": "Mozilla/5.0",
    "accept-language": "pt-BR,pt;q=0.9",
  };
}

function juntarCookies(cookieHeader: string | undefined, novos: string[]): string[] {
  const atuais = cookieHeader ? cookieHeader.split(";").map((item) => item.trim()).filter((item) => item.includes("=")) : [];
  const mapa = new Map<string, string>();
  for (const item of [...atuais, ...novos]) mapa.set(item.split("=", 1)[0] ?? item, item);
  return [...mapa.values()];
}

function httpsGet(
  url: string,
  certificado: string,
  chave: string,
  headers: Record<string, string>,
  seguir = false,
  saltos = 0,
): Promise<RespostaHttp> {
  const alvo = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: alvo.protocol,
        hostname: alvo.hostname,
        path: `${alvo.pathname}${alvo.search}`,
        method: "GET",
        cert: certificado,
        key: chave,
        headers,
        timeout: 20_000,
      },
      (res) => {
        const partes: Buffer[] = [];
        let tamanho = 0;
        res.on("data", (chunk: Buffer) => {
          tamanho += chunk.length;
          if (tamanho > 8_000_000) {
            req.destroy();
            reject(new DomainError("O Emissor Nacional devolveu uma resposta grande demais."));
            return;
          }
          partes.push(chunk);
        });
        res.on("end", () => {
          const cookies = cookiesSessao(res.headers["set-cookie"]);
          const location = typeof res.headers.location === "string" ? res.headers.location : "";
          const status = res.statusCode ?? 0;
          const corpo = Buffer.concat(partes);
          const jar = juntarCookies(headers.cookie, cookies);
          if (seguir && saltos < 5 && status >= 300 && status < 400 && location && !/\/Login/i.test(location)) {
            const proxima = new URL(location, url);
            if (proxima.protocol === "https:" && proxima.hostname.endsWith("nfse.gov.br")) {
              resolve(httpsGet(proxima.toString(), certificado, chave, { ...headers, cookie: jar.join("; ") }, true, saltos + 1));
              return;
            }
          }
          resolve({ status, corpo, cookies, location, jar });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new DomainError("O Emissor Nacional não respondeu."));
    });
    req.on("error", () => reject(new DomainError("O Emissor Nacional não respondeu.")));
    req.end();
  });
}

function httpsTexto(opcoes: {
  url: string;
  method: string;
  certificado: string;
  chave: string;
  body?: string;
  headers: Record<string, string>;
  limite: number;
}): Promise<{ status: number; texto: string }> {
  const alvo = new URL(opcoes.url);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: alvo.protocol,
        hostname: alvo.hostname,
        path: `${alvo.pathname}${alvo.search}`,
        method: opcoes.method,
        cert: opcoes.certificado,
        key: opcoes.chave,
        headers: opcoes.headers,
        timeout: 20_000,
      },
      (res) => {
        const partes: Buffer[] = [];
        let tamanho = 0;
        res.on("data", (chunk: Buffer) => {
          tamanho += chunk.length;
          if (tamanho > opcoes.limite) {
            req.destroy();
            reject(new DomainError("O Emissor Nacional devolveu uma resposta grande demais."));
            return;
          }
          partes.push(chunk);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, texto: Buffer.concat(partes).toString("utf8") }));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new DomainError("O Emissor Nacional não respondeu."));
    });
    req.on("error", () => reject(new DomainError("O Emissor Nacional não respondeu.")));
    if (opcoes.body) req.write(opcoes.body);
    req.end();
  });
}
