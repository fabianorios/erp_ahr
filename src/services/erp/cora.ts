import { DomainError, assertData, somenteDigitos, validarDocumento, type TituloStatus } from "./domain.ts";

/** Monta e lê a fatura da Cora. Não abre conexão. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST_PRODUCAO = "matls-clients.api.cora.com.br";
const MINIMO_CENTAVOS = 500;

export type EnderecoCora = {
  street: string;
  number: string;
  district: string;
  city: string;
  state: string;
  complement: string;
  zip: string;
};

export type TituloParaCora = {
  id: string;
  status: TituloStatus;
  valorCents: number;
  vencimento: string;
  descricao: string;
  clienteNome: string;
  documento: string;
  email: string | null;
  endereco: EnderecoCora | null;
  boleto: { id: string; coraId: string | null } | null;
};

export type PedidoCora = {
  code: string;
  customer: {
    name: string;
    email?: string;
    document: { identity: string; type: "CPF" | "CNPJ" };
    address?: {
      street: string;
      number: string;
      district: string;
      city: string;
      state: string;
      complement: string;
      zip_code: string;
    };
  };
  services: [{ name: string; description: string; amount: number }];
  payment_terms: { due_date: string };
  payment_forms: ["BANK_SLIP", "PIX"];
};

export type FaturaCora = {
  id: string;
  coraStatus: string;
  status: "aberto" | "atrasado";
  linha: string;
  codigoBarras: string;
  pix: string | null;
  pdfUrl: string;
  nossoNumero: string;
};

export type BoletoInserir = {
  contaReceberId: string;
  numero: string;
  valorCents: number;
  vencimento: string;
  status: "aberto" | "atrasado";
  linha: string;
  codigoBarras: string;
  pix: string | null;
  coraId: string;
  coraStatus: string;
  pdfPath: string;
};

export type DecisaoEmissao =
  | { tipo: "mostrar"; boletoId: string }
  | { tipo: "emitir"; pedido: PedidoCora; faturar: boolean; idempotencyKey: string };

export function hojeBrasil(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

export function validarBaseCora(base: string): string {
  const limpa = base.trim().replace(/\/+$/, "");
  let host = "";
  try {
    host = new URL(limpa).host;
  } catch {
    host = "";
  }
  if (host !== HOST_PRODUCAO) throw new DomainError("A base da API Cora tem de ser a de produção.");
  return limpa;
}

export function urlsCora(base: string): { token: string; invoices: string } {
  const limpa = validarBaseCora(base);
  return { token: `${limpa}/token`, invoices: `${limpa}/v2/invoices` };
}

export function decidirEmissao(titulo: TituloParaCora, hoje: string): DecisaoEmissao {
  if (!UUID.test(titulo.id)) throw new DomainError("Título inválido.");
  const coraId = titulo.boleto?.coraId?.trim() ?? "";
  if (titulo.boleto && coraId) return { tipo: "mostrar", boletoId: titulo.boleto.id };
  if (titulo.boleto) throw new DomainError("O título já tem boleto.");
  if (titulo.status === "cancelado") throw new DomainError("Este título está cancelado.");
  if (titulo.status === "recebido") throw new DomainError("Este título já foi recebido.");
  if (titulo.status !== "previsto" && titulo.status !== "faturado") {
    throw new DomainError("Este título não pode emitir boleto.");
  }
  return {
    tipo: "emitir",
    pedido: pedidoCora(titulo, hoje),
    faturar: titulo.status === "previsto",
    idempotencyKey: titulo.id,
  };
}

export function pedidoCora(titulo: TituloParaCora, hoje: string): PedidoCora {
  const faltando: string[] = [];
  if (!titulo.clienteNome.trim()) faltando.push("Falta o nome do cliente.");
  if (!somenteDigitos(titulo.documento)) faltando.push("Falta o documento do cliente.");
  if (!Number.isFinite(titulo.valorCents) || titulo.valorCents <= 0) faltando.push("Falta o valor.");
  if (!titulo.vencimento.trim()) faltando.push("Falta o vencimento.");
  if (!titulo.descricao.trim()) faltando.push("Falta a descrição do título.");
  if (faltando.length) throw new DomainError(faltando.join(" "));

  let documento = "";
  try {
    documento = validarDocumento(titulo.documento);
  } catch {
    throw new DomainError("O documento do cliente não é CPF nem CNPJ.");
  }
  if (!Number.isInteger(titulo.valorCents) || titulo.valorCents < MINIMO_CENTAVOS) {
    throw new DomainError("O valor do boleto precisa ser de pelo menos R$ 5,00.");
  }
  const vencimento = assertData(titulo.vencimento, "Vencimento");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje) || vencimento < hoje) {
    throw new DomainError("O vencimento é anterior a hoje.");
  }

  const email = emailCora(titulo.email);
  const address = enderecoCora(titulo.endereco);
  const descricao = cortar(titulo.descricao, 100);
  return {
    code: titulo.id,
    customer: {
      name: cortar(titulo.clienteNome, 60),
      ...(email ? { email } : {}),
      document: { identity: documento, type: documento.length === 14 ? "CNPJ" : "CPF" },
      ...(address ? { address } : {}),
    },
    services: [{ name: cortar(titulo.descricao, 60), description: descricao, amount: titulo.valorCents }],
    payment_terms: { due_date: vencimento },
    payment_forms: ["BANK_SLIP", "PIX"],
  };
}

export function lerFaturaCora(bruto: unknown): FaturaCora {
  const json = objeto(bruto);
  if (!json) throw new DomainError("A Cora devolveu uma resposta inválida.");
  const id = texto(json.id);
  const coraStatus = texto(json.status).toUpperCase();
  if (!id) throw new DomainError("A Cora não devolveu o id da fatura.");
  const status = statusDoBoletoCora(coraStatus);
  const slip = objeto(objeto(json.payment_options)?.bank_slip);
  const linha = texto(slip?.digitable);
  const codigoBarras = texto(slip?.barcode);
  if (!linha) throw new DomainError("A Cora não devolveu a linha digitável.");
  if (!codigoBarras) throw new DomainError("A Cora não devolveu o código de barras.");
  const pdfUrl = urlPdfCora(texto(slip?.url));
  const nossoNumero = (texto(slip?.our_number) || id).slice(0, 40);
  const pix = texto(objeto(json.pix)?.emv) || null;
  return { id, coraStatus, status, linha, codigoBarras, pix, pdfUrl, nossoNumero };
}

export function urlPdfCora(valor: string): string {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new DomainError("A Cora não devolveu o PDF do boleto.");
  }
  if (url.protocol !== "https:" || url.username || url.password || hostProibido(url.hostname)) {
    throw new DomainError("A Cora não devolveu o PDF do boleto.");
  }
  return url.toString();
}

export function ehPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export function nomeArquivoPdf(tituloId: string): string {
  if (!UUID.test(tituloId)) throw new DomainError("Título inválido.");
  return `${tituloId.toLowerCase()}.pdf`;
}

export function assuntoBoleto(descricao: string): string {
  const limpo = descricao.replace(/\s+/g, " ").trim() || "AHR";
  return `Boleto ${limpo}`.slice(0, 140);
}

export function textoEmailBoleto(input: {
  nome: string;
  descricao: string;
  valor: string;
  vencimento: string;
  linha: string;
  codigoBarras: string;
  pix: string | null;
}): string {
  const pix = input.pix ? `\nPIX copia e cola: ${input.pix}` : "";
  return `Olá ${input.nome},\n\nSegue o boleto de ${input.descricao}.\nValor: ${input.valor}\nVencimento: ${input.vencimento}\nLinha digitável: ${input.linha}\nCódigo de barras: ${input.codigoBarras}${pix}\n\nO PDF está em anexo.`;
}

export async function executarEmissao(input: {
  titulo: TituloParaCora;
  hoje: string;
  preparar: () => Promise<void>;
  chamar: (pedido: PedidoCora, idempotencyKey: string) => Promise<unknown>;
  baixar: (url: string) => Promise<Uint8Array>;
  gravarPdf: (pdf: Uint8Array) => Promise<void>;
  faturar: () => Promise<void>;
  inserir: (boleto: BoletoInserir) => Promise<string>;
}): Promise<{ id: string; chamouCora: boolean; aviso: string }> {
  const decisao = decidirEmissao(input.titulo, input.hoje);
  if (decisao.tipo === "mostrar") {
    return { id: decisao.boletoId, chamouCora: false, aviso: "Este título já tem boleto na Cora." };
  }
  await input.preparar();
  if (decisao.faturar) await input.faturar();
  const fatura = lerFaturaCora(await input.chamar(decisao.pedido, decisao.idempotencyKey));
  const pdf = await input.baixar(fatura.pdfUrl);
  if (!ehPdf(pdf)) throw new DomainError("A Cora não devolveu o PDF do boleto.");
  await input.gravarPdf(pdf);
  const id = await input.inserir({
    contaReceberId: input.titulo.id,
    numero: fatura.nossoNumero,
    valorCents: input.titulo.valorCents,
    vencimento: decisao.pedido.payment_terms.due_date,
    status: fatura.status,
    linha: fatura.linha,
    codigoBarras: fatura.codigoBarras,
    pix: fatura.pix,
    coraId: fatura.id,
    coraStatus: fatura.coraStatus,
    pdfPath: nomeArquivoPdf(input.titulo.id),
  });
  return { id, chamouCora: true, aviso: "Boleto emitido e salvo no ERP." };
}

function statusDoBoletoCora(status: string): "aberto" | "atrasado" {
  if (status === "LATE") return "atrasado";
  if (status === "CANCELLED") throw new DomainError("A Cora cancelou este boleto e ele não foi gravado.");
  if (status === "OPEN" || status === "DRAFT" || status === "IN_PAYMENT" || status === "PAID") return "aberto";
  throw new DomainError("A Cora devolveu um status de boleto desconhecido.");
}

function emailCora(valor: string | null): string | undefined {
  const email = (valor ?? "").trim();
  if (!email || email.length > 60 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  return email;
}

function enderecoCora(endereco: EnderecoCora | null): PedidoCora["customer"]["address"] {
  if (!endereco) return undefined;
  const street = endereco.street.trim();
  const number = endereco.number.trim();
  const district = endereco.district.trim();
  const city = endereco.city.trim();
  const state = endereco.state.trim().toUpperCase();
  const zip = somenteDigitos(endereco.zip);
  if (!street || !number || !district || !city || !/^[A-Z]{2}$/.test(state) || zip.length !== 8) return undefined;
  return {
    street: street.slice(0, 100),
    number: number.slice(0, 20),
    district: district.slice(0, 60),
    city: city.slice(0, 60),
    state,
    complement: endereco.complement.trim().slice(0, 60) || "N/A",
    zip_code: zip,
  };
}

function cortar(valor: string, max: number): string {
  return valor.trim().slice(0, max);
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function objeto(valor: unknown): Record<string, unknown> | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  return valor as Record<string, unknown>;
}

function hostProibido(host: string): boolean {
  const nome = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (nome === "localhost" || nome.endsWith(".local") || nome.endsWith(".internal") || nome === "0.0.0.0" || nome === "::1") {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(nome);
  if (!ipv4) return false;
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168)) return true;
  return a === 172 && b >= 16 && b <= 31;
}
