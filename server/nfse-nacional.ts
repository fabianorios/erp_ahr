import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
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

/** Abre o PFX em memória. A senha não entra na mensagem de erro. */
export function abrirPfx(pfx: Buffer, senha: string): CertificadoA1 {
  try {
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
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("O certificado A1 não abriu. Confira o arquivo PFX e a senha.");
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
  pfx: Buffer;
  senha: string;
  chave: string;
  certificado: string;
} {
  const ambiente = ambienteNfse(process.env.NFSE_AMBIENTE ?? "");
  const certPath = (process.env.NFSE_CERT_PATH ?? "").trim();
  const senha = process.env.NFSE_CERT_PASSWORD ?? "";
  if (!certPath || !senha.trim()) throw new DomainError("O certificado A1 da NFS-e não está configurado no servidor.");
  const serie = (process.env.NFSE_SERIE_DPS ?? "").trim();
  if (!serie) throw new DomainError("A série da DPS não está configurada.");
  let pfx: Buffer;
  try {
    pfx = readFileSync(certPath);
  } catch {
    throw new DomainError("O certificado A1 da NFS-e não está no servidor.");
  }
  const aberto = abrirPfx(pfx, senha);
  return {
    base: ambiente.base,
    ambiente: ambiente.ambiente,
    cnpj: (process.env.NFSE_CNPJ ?? "").trim(),
    im: (process.env.NFSE_INSCRICAO_MUNICIPAL ?? "").trim(),
    codigoServico: (process.env.NFSE_ITEM_SERVICO ?? "").trim(),
    serie,
    cMun: (process.env.NFSE_CODIGO_MUNICIPIO ?? "").trim(),
    pfx,
    senha,
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
  const resposta = await postarSefin(prestador.base, prestador.pfx, prestador.senha, enviado);
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

async function guardarPdf(db: Banco, tituloId: string, prestador: { pfx: Buffer; senha: string }, producao: boolean): Promise<void> {
  const { data } = await db.from("erp_nfse").select("id_externo").eq("conta_receber_id", tituloId).maybeSingle();
  const chave = typeof data?.id_externo === "string" ? data.id_externo : "";
  if (!/^\d{50}$/.test(chave)) return;
  const host = producao ? "https://adn.nfse.gov.br" : "https://adn.producaorestrita.nfse.gov.br";
  const pdf = await baixarPdf(`${host}/danfse/${chave}`, prestador.pfx, prestador.senha);
  await gravador(db).gravarPdf(tituloId, pdf);
}

function postarSefin(base: string, pfx: Buffer, senha: string, dpsXmlGZipB64: string): Promise<{ status: number; texto: string }> {
  return httpsTexto({
    url: `${base}/nfse`,
    method: "POST",
    pfx,
    senha,
    body: JSON.stringify({ dpsXmlGZipB64 }),
    headers: { "content-type": "application/json", accept: "application/json" },
    limite: 8_000_000,
  });
}

function baixarPdf(url: string, pfx: Buffer, senha: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const alvo = new URL(url);
    const req = httpsRequest(
      {
        protocol: alvo.protocol,
        hostname: alvo.hostname,
        path: `${alvo.pathname}${alvo.search}`,
        method: "GET",
        pfx,
        passphrase: senha,
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
  pfx: Buffer;
  senha: string;
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
        pfx: opcoes.pfx,
        passphrase: opcoes.senha,
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
