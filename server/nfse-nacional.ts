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
  const textos: string[] = [];
  coletarEnv(raiz, 0, textos);
  return escolherCertificado(textos.flatMap(parseEnv));
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
    if (nome !== ".env" && !nome.startsWith(".env.")) continue;
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

function abrirComOpenssl(caminho: string, senha: string): CertificadoA1 {
  const chave = pemDe(opensslPkcs12(caminho, senha, ["-nocerts", "-noenc"]), "PRIVATE KEY")
    || pemDe(opensslPkcs12(caminho, senha, ["-nocerts", "-noenc"]), "RSA PRIVATE KEY");
  const certificado = pemDe(opensslPkcs12(caminho, senha, ["-clcerts", "-nokeys"]), "CERTIFICATE");
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
  im: string;
  codigoServico: string;
  serie: string;
  cMun: string;
  chave: string;
  certificado: string;
} {
  const ambiente = ambienteNfse(process.env.NFSE_AMBIENTE ?? "");
  const gestao = certificadoDaGestao();
  const doGestao = gestao && existsSync(gestao.caminho) ? gestao : null;
  const certPath = doGestao?.caminho || (process.env.NFSE_CERT_PATH ?? "").trim();
  const senha = doGestao?.senha || (process.env.NFSE_CERT_PASSWORD ?? "");
  if (!certPath || !senha.trim()) throw new DomainError("O certificado A1 da NFS-e não está configurado no servidor.");
  const serie = (process.env.NFSE_SERIE_DPS ?? "").trim();
  if (!serie) throw new DomainError("A série da DPS não está configurada.");
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
    im: (process.env.NFSE_INSCRICAO_MUNICIPAL ?? "").trim(),
    codigoServico: (process.env.NFSE_ITEM_SERVICO ?? "").trim(),
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
  const cep = String(cliente.cep ?? "").replace(/\D/g, "");
  const pedido = validarPedidoNfse({
    clienteId,
    descricao: texto(dados, "descricao"),
    valor: texto(dados, "valor"),
    vencimento: texto(dados, "vencimento"),
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
    inscricaoMunicipal: prestador.im,
    codigoServico: prestador.codigoServico,
    serie: prestador.serie,
    numeroDps: numeroDps(agora, agora.getMilliseconds()),
    emitidoEm: instanteBrasil(agora),
    ambiente: prestador.ambiente,
  });
  const xml = assinarDps(montarDps(pedido), prestador.chave, prestador.certificado);
  const enviado = gzipSync(Buffer.from(xml, "utf8")).toString("base64");
  const resposta = await postarSefin(prestador.base, prestador.certificado, prestador.chave, enviado);
  const id = await aplicarNota(gravador(db), pedido, resposta.status, resposta.texto);
  await guardarPdf(db, id, prestador, pedido.ambiente === 1).catch(() => undefined);
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

async function guardarPdf(db: Banco, tituloId: string, prestador: { certificado: string; chave: string }, producao: boolean): Promise<void> {
  const { data } = await db.from("erp_nfse").select("id_externo").eq("conta_receber_id", tituloId).maybeSingle();
  const chaveAcesso = typeof data?.id_externo === "string" ? data.id_externo : "";
  if (!/^\d{50}$/.test(chaveAcesso)) return;
  const host = producao ? "https://adn.nfse.gov.br" : "https://adn.producaorestrita.nfse.gov.br";
  const pdf = await baixarPdf(`${host}/danfse/${chaveAcesso}`, prestador.certificado, prestador.chave);
  await gravador(db).gravarPdf(tituloId, pdf);
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

function baixarPdf(url: string, certificado: string, chave: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const alvo = new URL(url);
    const req = httpsRequest(
      {
        protocol: alvo.protocol,
        hostname: alvo.hostname,
        path: `${alvo.pathname}${alvo.search}`,
        method: "GET",
        cert: certificado,
        key: chave,
        headers: { accept: "application/pdf" },
        timeout: 20_000,
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on("data", (chunk: Buffer) => partes.push(chunk));
        res.on("end", () => {
          const bytes = Buffer.concat(partes);
          if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300 && bytes.subarray(0, 4).toString() === "%PDF") {
            resolve(bytes);
            return;
          }
          reject(new DomainError("O Emissor Nacional não devolveu o PDF da nota."));
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
