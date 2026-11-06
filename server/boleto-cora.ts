import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { resolve, sep } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, centsToReais, formatBrl, reaisToCents, type TituloStatus } from "../src/services/erp/domain.ts";
import { ordenarContatos, validarEmailAssinatura } from "../src/services/erp/assinatura.ts";
import {
  assuntoBoleto,
  chaveWebhook,
  efeitoDoWebhook,
  ehPdf,
  executarEmissao,
  gatilhosPendentes,
  hojeBrasil,
  lerConsultaCora,
  lerEndpointsCora,
  nomeArquivoPdf,
  pedidoWebhook,
  textoEmailBoleto,
  URL_WEBHOOK_CORA,
  urlPdfCora,
  urlsCora,
  validarBaseCora,
  type AvisoCora,
  type BoletoInserir,
  type EndpointCora,
  type PedidoCora,
  type TituloParaCora,
} from "../src/services/erp/cora.ts";
import { enviarEmail } from "./email.ts";

type Banco = SupabaseClient;

const MENSAGEM_SQL = "Falta o SQL do boleto Cora. Rode sql/boleto-cora.sql no projeto do ERP.";

type ConfigCora = { base: string; clientId: string; cert: Buffer; key: Buffer };

let cacheToken: { chave: string; token: string; expira: number } | null = null;

export function diretorioBoletos(): string {
  const configurado = process.env.CORA_BOLETO_DIR?.trim();
  return configurado || "/var/www/erpahr/secrets/cora/boletos";
}

export function caminhoPdf(dir: string, tituloId: string): string {
  const nome = nomeArquivoPdf(tituloId);
  const base = resolve(dir);
  const arquivo = resolve(base, nome);
  if (arquivo !== `${base}${sep}${nome}`) throw new DomainError("O PDF deste boleto não está no servidor.");
  return arquivo;
}

/** Grava o PDF fora do git. A leitura posterior usa este arquivo e não a Cora. */
export async function gravarPdfEm(dir: string, tituloId: string, pdf: Uint8Array): Promise<void> {
  if (!ehPdf(pdf)) throw new DomainError("A Cora não devolveu o PDF do boleto.");
  const caminho = caminhoPdf(dir, tituloId);
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    await writeFile(caminho, pdf, { mode: 0o600 });
    await chmod(caminho, 0o600);
  } catch {
    throw new DomainError("Não foi possível gravar o PDF do boleto no servidor.");
  }
}

export async function lerPdfEm(dir: string, tituloId: string): Promise<Buffer> {
  const caminho = caminhoPdf(dir, tituloId);
  try {
    const bytes = await readFile(caminho);
    if (!ehPdf(bytes)) throw new DomainError("O PDF deste boleto não está no servidor.");
    return bytes;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("O PDF deste boleto não está no servidor.");
  }
}

export async function lerPdfDoTitulo(db: Banco, tituloId: string): Promise<Buffer> {
  await garantirColunas(db);
  const { data, error } = await db.from("erp_boletos").select("pdf_path").eq("conta_receber_id", tituloId).maybeSingle();
  if (colunaAusente(error)) throw new DomainError(MENSAGEM_SQL);
  if (error) throw new DomainError("Não foi possível ler o boleto.");
  if (!data?.pdf_path) throw new DomainError("O PDF deste boleto não está no servidor.");
  return lerPdfEm(diretorioBoletos(), tituloId);
}

export async function emitirBoletoDoTitulo(db: Banco, tituloId: string): Promise<{ id: string; aviso: string }> {
  await garantirColunas(db);
  const titulo = await tituloParaCora(db, tituloId);
  const resultado = await executarEmissao({
    titulo,
    hoje: hojeBrasil(),
    preparar: async () => {
      configCora();
    },
    faturar: async () => {
      await faturarPrevisto(db, tituloId);
    },
    chamar: (pedido, chave) => emitirNaCora(pedido, chave),
    baixar: baixarPdf,
    gravarPdf: (pdf) => gravarPdfEm(diretorioBoletos(), tituloId, pdf),
    inserir: (boleto) => inserirBoleto(db, boleto),
  });
  return { id: resultado.id, aviso: resultado.aviso };
}

export async function enviarBoletoDoTitulo(db: Banco, tituloId: string, contatoIds: unknown): Promise<{ aviso: string }> {
  const ids = ordenarContatos(contatoIds);
  await garantirColunas(db);
  const titulo = await tituloParaCora(db, tituloId);
  if (!titulo.boleto?.coraId) throw new DomainError("Emita o boleto antes de enviá-lo.");
  const pdf = await lerPdfEm(diretorioBoletos(), tituloId);
  const { data: clienteIdRow, error } = await db.from("erp_contas_receber").select("cliente_id").eq("id", tituloId).maybeSingle();
  if (error || !clienteIdRow?.cliente_id) throw new DomainError("Falta o cliente do título.");
  const contatos = await contatosDoCliente(db, String(clienteIdRow.cliente_id), ids);
  const valor = formatBrl(titulo.valorCents);
  const vencimento = dataBr(titulo.vencimento);
  const linha = await linhaDoBoleto(db, tituloId);
  const ok: string[] = [];
  const falhas: string[] = [];
  for (const contato of contatos) {
    try {
      await enviarEmail({
        para: contato.email,
        assunto: assuntoBoleto(titulo.descricao),
        texto: textoEmailBoleto({
          nome: contato.nome,
          descricao: titulo.descricao,
          valor,
          vencimento,
          linha: linha.linha,
          codigoBarras: linha.codigoBarras,
          pix: linha.pix,
        }),
        anexo: { nome: "boleto.pdf", tipo: "application/pdf", bytes: pdf },
      });
      ok.push(contato.email);
    } catch (error) {
      const motivo = error instanceof Error ? error.message : "falha no envio";
      falhas.push(`${contato.email} (${motivo})`);
    }
  }
  if (ok.length === 0) throw new DomainError(`Não foi possível enviar o boleto para ${falhas.join("; ")}.`);
  if (falhas.length) return { aviso: `Boleto enviado para ${ok.join(", ")}. Não foi possível enviar para ${falhas.join("; ")}.` };
  return { aviso: `Boleto enviado para ${ok.join(", ")}.` };
}

async function garantirColunas(db: Banco): Promise<void> {
  const { error } = await db.from("erp_boletos").select("cora_invoice_id, linha_digitavel, codigo_barras, pix_emv, pdf_path, cora_status").limit(1);
  if (colunaAusente(error)) throw new DomainError(MENSAGEM_SQL);
  if (error) throw new DomainError("Não foi possível ler o boleto.");
}

function colunaAusente(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const texto = `${error.code ?? ""} ${error.message ?? ""}`;
  return /PGRST204|42703|schema cache|could not find|does not exist/i.test(texto);
}

async function tituloParaCora(db: Banco, tituloId: string): Promise<TituloParaCora> {
  if (!/^[0-9a-f-]{36}$/i.test(tituloId)) throw new DomainError("Título inválido.");
  const { data, error } = await db
    .from("erp_contas_receber")
    .select("id, status, valor, vencimento, descricao, numero_nf, cliente_id, erp_boletos(id, cora_invoice_id)")
    .eq("id", tituloId)
    .maybeSingle();
  if (error) throw new DomainError("Não foi possível ler o título.");
  if (!data) throw new DomainError("Título não encontrado.");
  if (!data.cliente_id) throw new DomainError("Falta o cliente do título.");
  const { data: cliente, error: erroCliente } = await db
    .from("clients")
    .select("name, document, email, logradouro, numero, bairro, cidade, uf, cep, complemento")
    .eq("id", data.cliente_id)
    .maybeSingle();
  if (erroCliente || !cliente) throw new DomainError("Falta o cliente do título.");
  const boleto = primeiro(data.erp_boletos);
  const status = String(data.status ?? "");
  if (status !== "previsto" && status !== "faturado" && status !== "recebido" && status !== "cancelado") {
    throw new DomainError("Este título não pode emitir boleto.");
  }
  return {
    id: String(data.id),
    status,
    valorCents: reaisToCents(data.valor as string | number),
    vencimento: String(data.vencimento ?? "").slice(0, 10),
    descricao: String(data.descricao ?? ""),
    numeroNf: typeof data.numero_nf === "string" ? data.numero_nf : null,
    clienteNome: String(cliente.name ?? ""),
    documento: String(cliente.document ?? ""),
    email: typeof cliente.email === "string" ? cliente.email : null,
    endereco: {
      street: String(cliente.logradouro ?? ""),
      number: String(cliente.numero ?? ""),
      district: String(cliente.bairro ?? ""),
      city: String(cliente.cidade ?? ""),
      state: String(cliente.uf ?? ""),
      complement: String(cliente.complemento ?? ""),
      zip: String(cliente.cep ?? ""),
    },
    boleto: boleto ? { id: String(boleto.id ?? ""), coraId: typeof boleto.cora_invoice_id === "string" ? boleto.cora_invoice_id : null } : null,
  };
}

async function faturarPrevisto(db: Banco, tituloId: string): Promise<void> {
  const { data, error } = await db.from("erp_contas_receber").update({ status: "faturado" }).eq("id", tituloId).eq("status", "previsto").select("id");
  if (error) throw new DomainError(textoErro(error));
  if (data?.length) return;
  const { data: atual, error: leitura } = await db.from("erp_contas_receber").select("status").eq("id", tituloId).maybeSingle();
  if (leitura || !atual) throw new DomainError("Não foi possível faturar o título antes do boleto.");
  if (atual.status !== "faturado") throw new DomainError("Não foi possível faturar o título antes do boleto.");
}

async function inserirBoleto(db: Banco, boleto: BoletoInserir): Promise<string> {
  const { data, error } = await db
    .from("erp_boletos")
    .insert({
      conta_receber_id: boleto.contaReceberId,
      numero: boleto.numero,
      valor: Number(centsToReais(boleto.valorCents)),
      vencimento: boleto.vencimento,
      status: boleto.status,
      meio: "boleto",
      linha_digitavel: boleto.linha,
      codigo_barras: boleto.codigoBarras,
      pix_emv: boleto.pix,
      cora_invoice_id: boleto.coraId,
      cora_status: boleto.coraStatus,
      pdf_path: boleto.pdfPath,
    })
    .select("id");
  if (error?.code === "23505") {
    const { data: existente } = await db.from("erp_boletos").select("id, cora_invoice_id").eq("conta_receber_id", boleto.contaReceberId).maybeSingle();
    if (existente?.cora_invoice_id === boleto.coraId) return String(existente.id);
    throw new DomainError("O título já tem boleto.");
  }
  if (colunaAusente(error)) throw new DomainError(MENSAGEM_SQL);
  if (error || !data?.[0]?.id) throw new DomainError(error ? textoErro(error) : "Não foi possível gravar o boleto.");
  return String(data[0].id);
}

async function linhaDoBoleto(db: Banco, tituloId: string): Promise<{ linha: string; codigoBarras: string; pix: string | null }> {
  const { data, error } = await db.from("erp_boletos").select("linha_digitavel, codigo_barras, pix_emv").eq("conta_receber_id", tituloId).maybeSingle();
  if (error || !data?.linha_digitavel) throw new DomainError("O boleto salvo não tem linha digitável.");
  return {
    linha: String(data.linha_digitavel),
    codigoBarras: String(data.codigo_barras ?? ""),
    pix: typeof data.pix_emv === "string" && data.pix_emv.trim() ? data.pix_emv : null,
  };
}

async function contatosDoCliente(db: Banco, clienteId: string, ids: string[]): Promise<{ nome: string; email: string }[]> {
  const { data, error } = await db.from("erp_cliente_contatos").select("id, cliente_id, nome, email").in("id", ids);
  if (error && /erp_cliente_contatos|schema cache|does not exist/i.test(error.message)) {
    throw new DomainError("Falta criar as tabelas de contatos. Cole o SQL de contatos da assinatura no projeto do ERP.");
  }
  if (error) throw new DomainError("Não foi possível ler os contatos.");
  const porId = new Map((data ?? []).map((contato) => [String(contato.id).toLowerCase(), contato]));
  return ids.map((id) => {
    const contato = porId.get(id.toLowerCase());
    if (!contato || String(contato.cliente_id) !== clienteId) throw new DomainError("Escolha contatos deste cliente.");
    return {
      nome: String(contato.nome ?? "").trim() || "cliente",
      email: validarEmailAssinatura(String(contato.email ?? ""), "O contato não tem e-mail.", "E-mail do contato inválido."),
    };
  });
}

function configCora(): ConfigCora {
  const base = validarBaseCora(process.env.CORA_API_BASE?.trim() || "https://matls-clients.api.cora.com.br");
  const clientId = (process.env.CORA_CLIENT_ID ?? "").trim();
  const certPath = (process.env.CORA_CERT_PATH ?? "").trim();
  const keyPath = (process.env.CORA_KEY_PATH ?? "").trim();
  if (!clientId || !certPath || !keyPath) throw new DomainError("A Cora não está configurada no servidor.");
  try {
    const cert = readFileSync(certPath);
    const key = readFileSync(keyPath);
    if (cert.length < 32 || key.length < 32) throw new Error("curto");
    return { base, clientId, cert, key };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("A Cora não está configurada no servidor.");
  }
}

async function emitirNaCora(pedido: PedidoCora, idempotencyKey: string): Promise<unknown> {
  const cfg = configCora();
  const body = JSON.stringify(pedido);
  const resposta = await comToken(cfg, (acesso) =>
    httpsComCert({
      url: urlsCora(cfg.base).invoices,
      method: "POST",
      headers: {
        Authorization: `Bearer ${acesso}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Idempotency-Key": idempotencyKey,
        "Content-Length": String(Buffer.byteLength(body)),
      },
      body,
      cert: cfg.cert,
      key: cfg.key,
      limite: 2_000_000,
    }),
  );
  if (resposta.status < 200 || resposta.status >= 300) throw new DomainError(mensagemCora(resposta.status, resposta.texto));
  try {
    return JSON.parse(resposta.texto) as unknown;
  } catch {
    throw new DomainError("A Cora devolveu uma resposta inválida.");
  }
}

export async function tratarAvisoCora(db: Banco, aviso: AvisoCora): Promise<void> {
  await garantirColunas(db);
  const { data: boleto, error } = await db
    .from("erp_boletos")
    .select("id, status, conta_receber_id, cora_status")
    .eq("cora_invoice_id", aviso.faturaId)
    .maybeSingle();
  if (colunaAusente(error)) throw new DomainError(MENSAGEM_SQL);
  if (error) throw new DomainError("Não foi possível ler o boleto.");
  if (!boleto?.id || !boleto.conta_receber_id) return;
  const boletoStatus = statusBoleto(boleto.status);
  if (!boletoStatus) return;
  const { data: titulo, error: erroTitulo } = await db.from("erp_contas_receber").select("status").eq("id", boleto.conta_receber_id).maybeSingle();
  if (erroTitulo || !titulo) throw new DomainError("Não foi possível ler o título.");
  const tituloStatus = statusTitulo(titulo.status);
  if (!tituloStatus) return;
  if (aviso.evento === "invoice.paid" && boletoStatus === "pago") {
    await marcarStatusCora(db, String(boleto.id), "PAID");
    return;
  }
  if (aviso.evento === "invoice.canceled" && boletoStatus === "cancelado") return;
  if (aviso.evento === "invoice.overdue" && boletoStatus !== "aberto") return;
  const consulta = lerConsultaCora(await consultarFaturaCora(aviso.faturaId));
  const efeito = efeitoDoWebhook({
    evento: aviso.evento,
    faturaStatus: consulta.status,
    totalPaidCents: consulta.totalPaidCents,
    dataPagamento: consulta.dataPagamento,
    meio: consulta.meio,
    boletoStatus,
    tituloStatus,
  });
  if (efeito.tipo === "ja_baixado") {
    await marcarStatusCora(db, String(boleto.id), "PAID");
    return;
  }
  if (efeito.tipo === "ignorar") return;
  if (efeito.tipo === "status") {
    const { error: gravacao } = await db
      .from("erp_boletos")
      .update({ status: efeito.status, cora_status: efeito.coraStatus })
      .eq("id", boleto.id)
      .in("status", ["aberto", "atrasado"]);
    if (colunaAusente(gravacao)) throw new DomainError(MENSAGEM_SQL);
    if (gravacao) throw new DomainError(textoErro(gravacao));
    return;
  }
  const { error: baixa } = await db.rpc("erp_pagar_boleto", {
    p_boleto_id: boleto.id,
    p_data: efeito.data,
    p_valor_recebido: Number(centsToReais(efeito.valorCents)),
    p_meio: efeito.meio,
  });
  if (baixa) {
    const { data: atual } = await db.from("erp_contas_receber").select("status").eq("id", boleto.conta_receber_id).maybeSingle();
    if (atual?.status === "recebido") return;
    throw new DomainError(textoErro(baixa));
  }
  await marcarStatusCora(db, String(boleto.id), "PAID");
}

export async function registrarWebhooksCora(): Promise<{ trigger: string; acao: "existente" | "criado"; id: string }[]> {
  const cfg = configCora();
  const lista = await comToken(cfg, (acesso) =>
    httpsComCert({
      url: urlsCora(cfg.base).endpoints,
      method: "GET",
      headers: { Authorization: `Bearer ${acesso}`, Accept: "application/json" },
      cert: cfg.cert,
      key: cfg.key,
      limite: 2_000_000,
    }),
  );
  if (lista.status < 200 || lista.status >= 300) throw new DomainError(mensagemCora(lista.status, lista.texto));
  let existentes: EndpointCora[] = [];
  try {
    existentes = lerEndpointsCora(JSON.parse(lista.texto) as unknown);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("A Cora devolveu uma resposta inválida.");
  }
  const pendentes = new Set(gatilhosPendentes(existentes));
  const resultado: { trigger: string; acao: "existente" | "criado"; id: string }[] = [];
  for (const trigger of ["paid", "canceled", "overdue"] as const) {
    if (!pendentes.has(trigger)) {
      const achou = existentes.find(
        (item) =>
          item.active &&
          item.resource === "invoice" &&
          item.url.replace(/\/+$/, "") === URL_WEBHOOK_CORA &&
          (item.trigger === trigger || item.trigger === "*"),
      );
      resultado.push({ trigger, acao: "existente", id: achou?.id ?? "" });
      continue;
    }
    const body = JSON.stringify(pedidoWebhook(trigger));
    const criado = await comToken(cfg, (acesso) =>
      httpsComCert({
        url: urlsCora(cfg.base).endpoints,
        method: "POST",
        headers: {
          Authorization: `Bearer ${acesso}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": chaveWebhook(trigger),
          "Content-Length": String(Buffer.byteLength(body)),
        },
        body,
        cert: cfg.cert,
        key: cfg.key,
        limite: 200_000,
      }),
    );
    if (criado.status < 200 || criado.status >= 300) throw new DomainError(mensagemCora(criado.status, criado.texto));
    let id = "";
    try {
      const json = JSON.parse(criado.texto) as { id?: unknown };
      id = typeof json.id === "string" ? json.id : "";
    } catch {
      id = "";
    }
    resultado.push({ trigger, acao: "criado", id });
  }
  return resultado;
}

async function consultarFaturaCora(faturaId: string): Promise<unknown> {
  const cfg = configCora();
  const resposta = await comToken(cfg, (acesso) =>
    httpsComCert({
      url: `${urlsCora(cfg.base).invoices}/${faturaId}`,
      method: "GET",
      headers: { Authorization: `Bearer ${acesso}`, Accept: "application/json" },
      cert: cfg.cert,
      key: cfg.key,
      limite: 2_000_000,
    }),
  );
  if (resposta.status < 200 || resposta.status >= 300) {
    throw new DomainError(resposta.status === 401 || resposta.status === 403 ? "A Cora recusou o certificado ou o token." : "Não foi possível consultar a fatura na Cora.");
  }
  try {
    return JSON.parse(resposta.texto) as unknown;
  } catch {
    throw new DomainError("A Cora devolveu uma resposta inválida.");
  }
}

async function comToken(cfg: ConfigCora, acao: (acesso: string) => Promise<{ status: number; texto: string }>): Promise<{ status: number; texto: string }> {
  let resposta = await acao(await tokenCora(cfg));
  if (resposta.status === 401) {
    cacheToken = null;
    resposta = await acao(await tokenCora(cfg));
  }
  return resposta;
}

async function marcarStatusCora(db: Banco, boletoId: string, coraStatus: string): Promise<void> {
  const { error } = await db.from("erp_boletos").update({ cora_status: coraStatus }).eq("id", boletoId);
  if (colunaAusente(error)) throw new DomainError(MENSAGEM_SQL);
  if (error) throw new DomainError(textoErro(error));
}

function statusBoleto(valor: unknown): "aberto" | "atrasado" | "pago" | "cancelado" | null {
  if (valor === "aberto" || valor === "atrasado" || valor === "pago" || valor === "cancelado") return valor;
  return null;
}

function statusTitulo(valor: unknown): TituloStatus | null {
  if (valor === "previsto" || valor === "faturado" || valor === "recebido" || valor === "cancelado") return valor;
  return null;
}

async function tokenCora(cfg: ConfigCora): Promise<string> {
  const chave = createHash("sha256").update(cfg.clientId).update(cfg.cert).digest("hex");
  if (cacheToken && cacheToken.chave === chave && cacheToken.expira > Date.now() + 30_000) return cacheToken.token;
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.clientId }).toString();
  const resposta = await httpsComCert({
    url: urlsCora(cfg.base).token,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": String(Buffer.byteLength(body)),
    },
    body,
    cert: cfg.cert,
    key: cfg.key,
    limite: 100_000,
  });
  if (resposta.status < 200 || resposta.status >= 300) throw new DomainError(mensagemCora(resposta.status, resposta.texto));
  let json: { access_token?: string; expires_in?: number };
  try {
    json = JSON.parse(resposta.texto) as { access_token?: string; expires_in?: number };
  } catch {
    throw new DomainError("A Cora devolveu um token inválido.");
  }
  if (!json.access_token) throw new DomainError("A Cora não devolveu o token.");
  cacheToken = { chave, token: json.access_token, expira: Date.now() + Math.max(60, Number(json.expires_in) || 3600) * 1000 };
  return json.access_token;
}

async function baixarPdf(urlInicial: string): Promise<Uint8Array> {
  let url = urlInicial;
  for (let salto = 0; salto < 4; salto += 1) {
    urlPdfCora(url);
    let resposta: Response;
    try {
      resposta = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new DomainError("A Cora emitiu o boleto, mas o PDF não pôde ser gravado. Tente emitir de novo: a mesma cobrança será reaproveitada.");
    }
    if (resposta.status >= 300 && resposta.status < 400) {
      const location = resposta.headers.get("location");
      if (!location) throw new DomainError("A Cora não devolveu o PDF do boleto.");
      url = new URL(location, url).toString();
      continue;
    }
    if (!resposta.ok) {
      throw new DomainError("A Cora emitiu o boleto, mas o PDF não pôde ser gravado. Tente emitir de novo: a mesma cobrança será reaproveitada.");
    }
    const bytes = new Uint8Array(await resposta.arrayBuffer());
    if (bytes.byteLength > 8_000_000 || !ehPdf(bytes)) throw new DomainError("A Cora não devolveu o PDF do boleto.");
    return bytes;
  }
  throw new DomainError("A Cora não devolveu o PDF do boleto.");
}

function httpsComCert(opcoes: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  cert: Buffer;
  key: Buffer;
  limite: number;
}): Promise<{ status: number; texto: string }> {
  const alvo = new URL(opcoes.url);
  return new Promise((resolvePromise, reject) => {
    const req = httpsRequest(
      {
        protocol: alvo.protocol,
        hostname: alvo.hostname,
        port: alvo.port || 443,
        path: `${alvo.pathname}${alvo.search}`,
        method: opcoes.method,
        cert: opcoes.cert,
        key: opcoes.key,
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
            reject(new DomainError("A Cora devolveu uma resposta grande demais."));
            return;
          }
          partes.push(chunk);
        });
        res.on("end", () => {
          resolvePromise({ status: res.statusCode ?? 0, texto: Buffer.concat(partes).toString("utf8") });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new DomainError("A Cora não respondeu."));
    });
    req.on("error", () => reject(new DomainError("Não foi possível falar com a Cora.")));
    if (opcoes.body) req.write(opcoes.body);
    req.end();
  });
}

function mensagemCora(status: number, body: string): string {
  const detalhe = limparMensagem(extrairMensagem(body));
  if (status === 401 || status === 403) return "A Cora recusou o certificado ou o token.";
  if (status === 400) return detalhe ? `A Cora recusou o boleto: ${detalhe}` : "A Cora recusou o boleto.";
  return detalhe ? `A Cora não emitiu o boleto: ${detalhe}` : "A Cora não emitiu o boleto.";
}

function extrairMensagem(body: string): string {
  try {
    const json = JSON.parse(body) as { message?: unknown; error_description?: unknown; error?: unknown };
    if (typeof json.message === "string") return json.message;
    if (typeof json.error_description === "string") return json.error_description;
    if (typeof json.error === "string") return json.error;
  } catch {
    return "";
  }
  return "";
}

function limparMensagem(texto: string): string {
  return texto
    .replace(/-----BEGIN[\s\S]*?-----END[^-]+-----/g, "")
    .replace(/Bearer\s+\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function primeiro(valor: unknown): Record<string, unknown> | null {
  if (Array.isArray(valor)) return (valor[0] as Record<string, unknown> | undefined) ?? null;
  if (valor && typeof valor === "object") return valor as Record<string, unknown>;
  return null;
}

function textoErro(error: { message?: string }): string {
  return (error.message ?? "").replace(/^.*ERROR:\s*/i, "").trim() || "Não foi possível gravar o boleto.";
}

function dataBr(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}
