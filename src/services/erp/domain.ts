/** Regras da fase 1 do ERP AHR. Dinheiro em centavos só aqui dentro; a borda fala em reais. */

export type Cents = number;

export class DomainError extends Error {
  readonly name = "DomainError";

  constructor(message: string) {
    super(message);
  }
}

export const FORMA_COBRANCA = "mista" as const;
export const MUNICIPIO_NFSE = "São Caetano do Sul/SP";
export const EMISSOR_NFSE_FASE1 = "manual" as const;

export const CATEGORIAS_FINANCEIRAS = ["juros", "tarifa_bancaria", "iof"] as const;
export type CategoriaFinanceira = (typeof CATEGORIAS_FINANCEIRAS)[number];

export type CentroTipo = "contrato" | "indireto" | "financeiro";
export type PropostaStatus = "rascunho" | "enviada" | "aceita" | "recusada" | "expirada";
export type ContratoStatus = "rascunho" | "vigente" | "encerrado" | "cancelado";
export type TituloStatus = "previsto" | "faturado" | "recebido" | "cancelado";
export type NfseStatus = "informada" | "cancelada";
export type BoletoStatus = "aberto" | "atrasado" | "pago" | "cancelado";
export type MeioRecebimento = "boleto" | "pix" | "manual";
export type MeioBoleto = "boleto" | "pix";
export type ContaPagarStatus = "a_pagar" | "paga" | "cancelada";
export type CustoStatus = "rascunho" | "fechado";
export type PresencaDoc = "ausente" | NfseStatus | BoletoStatus;

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

export function centsToReais(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function formatBrl(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const grouped = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$ ${grouped},${String(abs % 100).padStart(2, "0")}`;
}

export function reaisToCents(value: string | number): Cents {
  const raw =
    typeof value === "number"
      ? centsToReais(Math.round(value * 100 + Math.sign(value) * 1e-6))
      : normalizeDecimal(value);
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    throw new DomainError("Valor em reais com até duas casas.");
  }
  const negative = raw.startsWith("-");
  const [reais, frac = ""] = raw.replace("-", "").split(".");
  const cents = Number(reais) * 100 + Number(frac.padEnd(2, "0"));
  return negative ? -cents : cents;
}

function normalizeDecimal(value: string): string {
  let raw = value.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!raw) throw new DomainError("Informe o valor.");
  if (raw.includes(",") && raw.includes(".")) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (raw.includes(",")) raw = raw.replace(",", ".");
  return raw;
}

export function mascaraDinheiro(valor: string): string {
  const digitos = somenteDigitos(valor).replace(/^0+(?=\d)/, "");
  if (!digitos) return "";
  const padded = digitos.padStart(3, "0");
  const inteiro = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${inteiro},${padded.slice(-2)}`;
}

export function mascaraCpf(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function mascaraCnpj(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function mascaraDocumento(valor: string): string {
  const d = somenteDigitos(valor);
  return d.length > 11 ? mascaraCnpj(d) : mascaraCpf(d);
}

export function percentToBp(value: string | number): number {
  const raw = typeof value === "number" ? value.toFixed(2) : value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new DomainError("Percentual inválido.");
  const [inteiro, frac = ""] = raw.split(".");
  return Number(inteiro) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
}

export function formatPercentBp(bp: number): string {
  return `${Math.trunc(bp / 100)},${String(Math.abs(bp) % 100).padStart(2, "0")}%`;
}

/** Valor do centro = total × percentual, arredondado na segunda casa. */
export function valorRateado(total: Cents, percentualBp: number): Cents {
  return Math.round((total * percentualBp) / 10000);
}

export function somenteDigitos(value: string): string {
  return value.replace(/\D/g, "");
}

export function validarDocumento(value: string): string {
  const digits = somenteDigitos(value);
  if (digits.length !== 11 && digits.length !== 14) {
    throw new DomainError("Documento é CPF ou CNPJ, só dígitos.");
  }
  return digits;
}

export type ClienteGravado = {
  name: string;
  document: string;
  email: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  complemento: string | null;
};

function textoOuNulo(value: unknown): string | null {
  const texto = typeof value === "string" ? value.trim() : "";
  return texto || null;
}

export function normalizarCliente(form: {
  nome?: unknown;
  documento?: unknown;
  email?: unknown;
  logradouro?: unknown;
  numero?: unknown;
  bairro?: unknown;
  cidade?: unknown;
  uf?: unknown;
  cep?: unknown;
  complemento?: unknown;
}): ClienteGravado {
  const nome = typeof form.nome === "string" ? form.nome.trim() : "";
  if (!nome) throw new DomainError("Informe o nome.");
  const documento = validarDocumento(typeof form.documento === "string" ? form.documento : "");
  const uf = typeof form.uf === "string" ? form.uf.trim().toUpperCase() : "";
  if (uf && !/^[A-Z]{2}$/.test(uf)) throw new DomainError("UF com duas letras.");
  const cep = somenteDigitos(typeof form.cep === "string" ? form.cep : "");
  if (cep && cep.length !== 8) throw new DomainError("CEP com 8 dígitos.");
  return {
    name: nome,
    document: documento,
    email: textoOuNulo(form.email),
    logradouro: textoOuNulo(form.logradouro),
    numero: textoOuNulo(form.numero),
    bairro: textoOuNulo(form.bairro),
    cidade: textoOuNulo(form.cidade),
    uf: uf || null,
    cep: cep || null,
    complemento: textoOuNulo(form.complemento),
  };
}

export function assertData(value: string, rotulo: string): string {
  const match = DATA.exec(value);
  if (!match) throw new DomainError(`${rotulo} inválida.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new DomainError(`${rotulo} inválida.`);
  }
  return value;
}

export function normalizarCompetencia(value: string): string {
  const mes = value.length === 7 ? `${value}-01` : value;
  assertData(mes, "Competência");
  if (!mes.endsWith("-01")) throw new DomainError("Competência é o mês, no primeiro dia.");
  return mes;
}

export function competenciaDoVencimento(vencimento: string): string {
  const data = assertData(vencimento, "Vencimento");
  return `${data.slice(0, 7)}-01`;
}

export function assertVigencia(inicio: string | null, fim: string | null): void {
  if (inicio) assertData(inicio, "Início");
  if (fim) assertData(fim, "Fim");
  if (inicio && fim && fim < inicio) throw new DomainError("O fim da vigência não pode ser antes do início.");
}

export function periodoDoMes(competencia: string): { inicio: string; fim: string } {
  const mes = normalizarCompetencia(competencia);
  const [year, month] = mes.slice(0, 7).split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { inicio: mes, fim: `${mes.slice(0, 7)}-${String(last).padStart(2, "0")}` };
}

export function enderecoCompleto(endereco: {
  logradouro: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}): boolean {
  return [endereco.logradouro, endereco.numero, endereco.bairro, endereco.cidade, endereco.uf, endereco.cep].every(
    (parte) => parte.trim().length > 0,
  );
}

export function validarCentroIndireto(nome: string): string {
  const limpo = nome.trim();
  if (!limpo) throw new DomainError("Informe o nome do centro.");
  return limpo;
}

export function validarDespesa(input: {
  tipo: "operacional" | "financeira";
  categoria: string;
  descricao: string;
  favorecidoNome: string;
  favorecidoDocumento: string;
  valor: string;
  competencia: string;
  vencimento: string;
  tipoCentro: CentroTipo;
}): {
  tipo: "operacional" | "financeira";
  categoria: string;
  descricao: string;
  favorecidoNome: string;
  favorecidoDocumento: string | null;
  valor: Cents;
  competencia: string;
  vencimento: string;
} {
  const valor = reaisToCents(input.valor);
  if (valor <= 0) throw new DomainError("O valor da despesa precisa ser maior que zero.");
  const descricao = input.descricao.trim();
  if (!descricao) throw new DomainError("Informe a descrição.");
  const favorecidoNome = input.favorecidoNome.trim();
  if (!favorecidoNome) throw new DomainError("Informe o favorecido.");
  const favorecidoDocumento = input.favorecidoDocumento.trim() ? validarDocumento(input.favorecidoDocumento) : null;
  let categoria = input.categoria.trim();
  if (input.tipo === "financeira") {
    if (!CATEGORIAS_FINANCEIRAS.includes(input.categoria as CategoriaFinanceira)) {
      throw new DomainError("Categoria financeira é juros, tarifa bancária ou IOF.");
    }
    if (input.tipoCentro !== "financeiro") throw new DomainError("Despesa financeira cai só no centro financeiro.");
    categoria = input.categoria;
  } else if (input.tipo === "operacional") {
    if (!categoria) throw new DomainError("Informe a categoria.");
    if (input.tipoCentro !== "contrato" && input.tipoCentro !== "indireto") {
      throw new DomainError("Despesa operacional cai em centro de contrato ou indireto.");
    }
  } else {
    throw new DomainError("Tipo de despesa inválido.");
  }
  return {
    tipo: input.tipo,
    categoria,
    descricao,
    favorecidoNome,
    favorecidoDocumento,
    valor,
    competencia: normalizarCompetencia(input.competencia),
    vencimento: assertData(input.vencimento, "Vencimento"),
  };
}

export function pagarDespesa(status: ContaPagarStatus, data: string): string {
  if (status !== "a_pagar") throw new DomainError("Só conta a pagar pode ser paga.");
  return assertData(data, "Data do pagamento");
}

export function cancelarDespesa(status: ContaPagarStatus): void {
  if (status !== "a_pagar") throw new DomainError("Só conta a pagar pode ser cancelada.");
}

export function validarCusto(input: {
  salario: string;
  encargos: string;
  beneficios: string;
  competencia: string;
}): { salario: Cents; encargos: Cents; beneficios: Cents; total: Cents; competencia: string } {
  const salario = reaisToCents(input.salario || "0");
  const encargos = reaisToCents(input.encargos || "0");
  const beneficios = reaisToCents(input.beneficios || "0");
  if (salario < 0 || encargos < 0 || beneficios < 0) {
    throw new DomainError("Salário, encargos e benefícios não podem ser negativos.");
  }
  return {
    salario,
    encargos,
    beneficios,
    total: salario + encargos + beneficios,
    competencia: normalizarCompetencia(input.competencia),
  };
}

export function assertCustoEditavel(status: CustoStatus): void {
  if (status === "fechado") throw new DomainError("Custo de pessoal fechado não pode ser alterado.");
}

export function fecharRateio(
  linhas: { centroId: string; tipoCentro: CentroTipo; percentual: string }[],
  total: Cents,
): { centroId: string; percentualBp: number; valor: Cents }[] {
  if (linhas.length === 0) throw new DomainError("Informe o rateio antes de fechar.");
  const vistos = new Set<string>();
  let soma = 0;
  const parsed = linhas.map((linha) => {
    if (!linha.centroId || (linha.tipoCentro !== "contrato" && linha.tipoCentro !== "indireto")) {
      throw new DomainError("O rateio só aceita centro de contrato ou indireto.");
    }
    if (vistos.has(linha.centroId)) throw new DomainError("Cada centro entra uma vez no rateio.");
    vistos.add(linha.centroId);
    const percentualBp = percentToBp(linha.percentual);
    if (percentualBp <= 0) throw new DomainError("Percentual do rateio precisa ser maior que zero.");
    soma += percentualBp;
    return { centroId: linha.centroId, percentualBp };
  });
  if (soma !== 10000) throw new DomainError("O rateio só fecha quando a soma dos percentuais é 100.");
  return parsed.map((linha) => ({
    ...linha,
    valor: valorRateado(total, linha.percentualBp),
  }));
}

export type TextosProposta = {
  titulo: string;
  visaoGeral: string;
  escopo: string;
  responsabilidades: string;
  prazo: string;
  execucao: string;
  validade: string;
  formaPagamento: string;
};

function textoProposta(valor: string | null | undefined): string {
  return (valor ?? "").trim();
}

export function normalizarValidade(valor: string | null | undefined): string {
  const texto = textoProposta(valor);
  if (!texto) return "";
  if (DATA.test(texto)) return assertData(texto, "Validade da proposta");
  const brasileira = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  if (brasileira) return assertData(`${brasileira[3]}-${brasileira[2]}-${brasileira[1]}`, "Validade da proposta");
  if (texto.length > 180) throw new DomainError("A validade da proposta precisa ser uma data ou um texto curto.");
  return texto;
}

export function validadeNoFormulario(valor: string | null | undefined): string {
  const texto = textoProposta(valor);
  if (!DATA.test(texto)) return texto;
  const [ano, mes, dia] = texto.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function validadeNoDocumento(valor: string | null | undefined): string {
  const texto = textoProposta(valor);
  if (!DATA.test(texto)) return texto;
  const [ano, mes, dia] = texto.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(ano, mes - 1, dia)));
}

export type ModoParcelas = "datas" | "intervalo";

export type Parcela = { vencimento: string; valor: Cents };

export type AgendaPagamento = {
  modo: ModoParcelas;
  quantidade: number;
  intervaloDias: number | null;
  primeiroVencimento: string | null;
  parcelas: Parcela[];
};

export type EntradaAgenda = {
  valor: string;
  quantidade: string;
  modoParcelas: ModoParcelas;
  intervaloDias: string;
  primeiroVencimento: string;
  vencimentos: string[];
};

function somarDias(iso: string, dias: number): string {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function dividirCentavos(total: Cents, quantidade: number): Cents[] {
  if (total < quantidade) throw new DomainError("O valor total não cobre todas as parcelas.");
  const base = Math.floor(total / quantidade);
  const resto = total - base * quantidade;
  return Array.from({ length: quantidade }, (_item, indice) => base + (indice === quantidade - 1 ? resto : 0));
}

export function montarAgenda(input: EntradaAgenda): AgendaPagamento {
  const valor = reaisToCents(input.valor || "0");
  if (valor <= 0) throw new DomainError("Informe o valor total da proposta.");
  const quantidade = Number(input.quantidade);
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 120) {
    throw new DomainError("Informe o número de parcelas.");
  }
  let vencimentos: string[];
  let intervaloDias: number | null = null;
  let primeiroVencimento: string | null = null;
  if (input.modoParcelas === "intervalo") {
    intervaloDias = Number(input.intervaloDias);
    if (!Number.isInteger(intervaloDias) || intervaloDias < 1 || intervaloDias > 3650) {
      throw new DomainError("Informe os dias entre as parcelas.");
    }
    primeiroVencimento = assertData(input.primeiroVencimento, "Primeiro vencimento");
    vencimentos = Array.from({ length: quantidade }, (_item, indice) => somarDias(primeiroVencimento as string, intervaloDias as number * indice));
  } else if (input.modoParcelas === "datas") {
    if (input.vencimentos.length !== quantidade || input.vencimentos.some((data) => !data)) {
      throw new DomainError("Informe o vencimento de cada parcela.");
    }
    vencimentos = input.vencimentos.map((data, indice) => assertData(data, `Vencimento da parcela ${indice + 1}`));
  } else {
    throw new DomainError("Escolha o vencimento de cada parcela ou os dias entre elas.");
  }
  const valores = dividirCentavos(valor, quantidade);
  const parcelas = vencimentos.map((vencimento, indice) => ({ vencimento, valor: valores[indice] }));
  const soma = parcelas.reduce((total, parcela) => total + parcela.valor, 0);
  if (soma !== valor) throw new DomainError("A soma das parcelas precisa ser o valor total.");
  return { modo: input.modoParcelas, quantidade, intervaloDias, primeiroVencimento, parcelas };
}

export function preverAgenda(input: EntradaAgenda): { agenda: AgendaPagamento } | { erro: string } {
  try {
    return { agenda: montarAgenda(input) };
  } catch (error) {
    return { erro: error instanceof Error ? error.message : "Forma de pagamento inválida." };
  }
}

function dataCurta(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function agendaDeJson(valor: unknown): AgendaPagamento | null {
  if (!valor || typeof valor !== "object") return null;
  const bruto = valor as {
    modo?: string;
    quantidade?: number;
    intervaloDias?: number | null;
    primeiroVencimento?: string | null;
    parcelas?: { vencimento?: string; valor?: string | number }[];
  };
  if (bruto.modo !== "datas" && bruto.modo !== "intervalo") return null;
  const parcelas = (bruto.parcelas ?? []).flatMap((parcela) => {
    if (!parcela.vencimento || parcela.valor == null || parcela.valor === "") return [];
    return [{ vencimento: String(parcela.vencimento).slice(0, 10), valor: reaisToCents(parcela.valor) }];
  });
  if (!parcelas.length) return null;
  return {
    modo: bruto.modo,
    quantidade: bruto.quantidade || parcelas.length,
    intervaloDias: bruto.intervaloDias ?? null,
    primeiroVencimento: bruto.primeiroVencimento ?? null,
    parcelas,
  };
}

export function agendaParaJson(agenda: AgendaPagamento) {
  return {
    modo: agenda.modo,
    quantidade: agenda.quantidade,
    intervaloDias: agenda.intervaloDias,
    primeiroVencimento: agenda.primeiroVencimento,
    parcelas: agenda.parcelas.map((parcela) => ({
      vencimento: parcela.vencimento,
      valor: centsToReais(parcela.valor),
    })),
  };
}

export function htmlAgenda(agenda: AgendaPagamento): string {
  const intro =
    agenda.modo === "intervalo"
      ? `<p>${agenda.quantidade} parcelas, com ${agenda.intervaloDias} dias entre os vencimentos, a partir de ${dataCurta(agenda.primeiroVencimento ?? agenda.parcelas[0].vencimento)}.</p>`
      : `<p>${agenda.quantidade} parcelas, cada uma no vencimento informado.</p>`;
  const linhas = agenda.parcelas
    .map((parcela, indice) => `<tr><td>${indice + 1}</td><td>${dataCurta(parcela.vencimento)}</td><td>${formatBrl(parcela.valor)}</td></tr>`)
    .join("");
  return `${intro}<table><thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor</th></tr></thead><tbody>${linhas}</tbody></table>`;
}

export type TipoAdicional = "transporte" | "refeicao" | "outras";
export type RegraAdicional = "incluso" | "reembolso" | "valor_fixo";
export type MeioAdicional = "pix" | "boleto" | "transferencia" | "reembolso" | "incluso";

export type EntradaAdicional = {
  cobrado: boolean;
  regra: RegraAdicional | "";
  valor: string;
  meio: MeioAdicional | "";
  descricao: string;
};

export type ValoresAdicionaisForm = {
  transporte: EntradaAdicional;
  refeicao: EntradaAdicional;
  outras: EntradaAdicional[];
};

export type ItemAdicional = {
  tipo: TipoAdicional;
  descricao: string;
  regra: RegraAdicional;
  valor: Cents | null;
  meio: MeioAdicional;
};

const REGRAS_ADICIONAIS = new Set<RegraAdicional>(["incluso", "reembolso", "valor_fixo"]);
const MEIOS_ADICIONAIS = new Set<MeioAdicional>(["pix", "boleto", "transferencia", "reembolso", "incluso"]);

export function entradaAdicionalVazia(): EntradaAdicional {
  return { cobrado: false, regra: "", valor: "", meio: "", descricao: "" };
}

export function valoresAdicionaisVazios(): ValoresAdicionaisForm {
  return {
    transporte: entradaAdicionalVazia(),
    refeicao: entradaAdicionalVazia(),
    outras: [entradaAdicionalVazia()],
  };
}

function regraDe(valor: unknown): RegraAdicional | "" {
  return typeof valor === "string" && REGRAS_ADICIONAIS.has(valor as RegraAdicional) ? (valor as RegraAdicional) : "";
}

function meioDe(valor: unknown): MeioAdicional | "" {
  return typeof valor === "string" && MEIOS_ADICIONAIS.has(valor as MeioAdicional) ? (valor as MeioAdicional) : "";
}

export function entradaAdicionalDe(valor: unknown): EntradaAdicional {
  const item = valor && typeof valor === "object" ? (valor as Record<string, unknown>) : {};
  return {
    cobrado: item.cobrado === true,
    regra: regraDe(item.regra),
    valor: typeof item.valor === "string" ? item.valor : "",
    meio: meioDe(item.meio),
    descricao: typeof item.descricao === "string" ? item.descricao.trim() : "",
  };
}

function validarItemAdicional(tipo: TipoAdicional, entrada: EntradaAdicional, rotulo: string): ItemAdicional | null {
  if (!entrada.cobrado) return null;
  if (!entrada.regra) throw new DomainError(`Informe a regra de cobrança de ${rotulo}.`);
  const descricao = entrada.descricao.trim();
  if (tipo === "outras" && !descricao) throw new DomainError("Descreva o item em Outras.");
  if (descricao.length > 180) throw new DomainError("A descrição da despesa adicional está longa demais.");
  let valor: Cents | null = null;
  let meio = entrada.meio;
  if (entrada.regra === "incluso") {
    meio = "incluso";
  } else if (entrada.regra === "reembolso") {
    if (!meio || meio === "incluso") meio = "reembolso";
  } else {
    valor = reaisToCents(entrada.valor || "0");
    if (valor <= 0) throw new DomainError(`Informe o valor de ${rotulo}.`);
    if (meio !== "pix" && meio !== "boleto" && meio !== "transferencia" && meio !== "reembolso") {
      throw new DomainError(`Informe como ${rotulo} será pago.`);
    }
  }
  return { tipo, descricao, regra: entrada.regra, valor, meio };
}

export function valoresAdicionaisDe(valor: unknown): ValoresAdicionaisForm {
  if (!valor || typeof valor !== "object") return valoresAdicionaisVazios();
  const bruto = valor as Record<string, unknown>;
  const outras = Array.isArray(bruto.outras) ? bruto.outras.map(entradaAdicionalDe) : [];
  return {
    transporte: entradaAdicionalDe(bruto.transporte),
    refeicao: entradaAdicionalDe(bruto.refeicao),
    outras: outras.length ? outras.slice(0, 12) : [entradaAdicionalVazia()],
  };
}

export function validarAdicionais(entrada: ValoresAdicionaisForm | null | undefined): ItemAdicional[] {
  const form = entrada ?? valoresAdicionaisVazios();
  const outras = Array.isArray(form.outras) ? form.outras.slice(0, 12) : [];
  const itens = [
    validarItemAdicional("transporte", form.transporte ?? entradaAdicionalVazia(), "transporte"),
    validarItemAdicional("refeicao", form.refeicao ?? entradaAdicionalVazia(), "refeição"),
    ...outras.map((item, indice) => validarItemAdicional("outras", item, `outras (${indice + 1})`)),
  ];
  return itens.filter((item): item is ItemAdicional => item != null);
}

export function adicionaisParaJson(itens: ItemAdicional[]) {
  return {
    itens: itens.map((item) => ({
      tipo: item.tipo,
      descricao: item.descricao,
      regra: item.regra,
      valor: item.valor == null ? null : centsToReais(item.valor),
      meio: item.meio,
    })),
  };
}

export function adicionaisDeJson(valor: unknown): ItemAdicional[] {
  const bruto = valor && typeof valor === "object" ? (valor as { itens?: unknown }).itens : null;
  if (!Array.isArray(bruto)) return [];
  return bruto.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const linha = item as { tipo?: unknown; descricao?: unknown; regra?: unknown; valor?: unknown; meio?: unknown };
    const tipo = linha.tipo === "transporte" || linha.tipo === "refeicao" || linha.tipo === "outras" ? linha.tipo : null;
    const regra = regraDe(linha.regra);
    const meio = meioDe(linha.meio);
    if (!tipo || !regra || !meio) return [];
    const descricao = typeof linha.descricao === "string" ? linha.descricao.trim() : "";
    if (tipo === "outras" && !descricao) return [];
    const valor = regra === "valor_fixo" && (typeof linha.valor === "string" || typeof linha.valor === "number") ? reaisToCents(linha.valor) : null;
    if (regra === "valor_fixo" && (valor == null || valor <= 0)) return [];
    return [{ tipo, descricao, regra, valor: regra === "valor_fixo" ? valor : null, meio: regra === "incluso" ? "incluso" : meio }];
  });
}

export function adicionaisNoFormulario(itens: ItemAdicional[]): ValoresAdicionaisForm {
  const vazio = valoresAdicionaisVazios();
  const preencher = (item: ItemAdicional): EntradaAdicional => ({
    cobrado: true,
    regra: item.regra,
    valor: item.valor == null ? "" : centsToReais(item.valor).replace(".", ","),
    meio: item.meio,
    descricao: item.descricao,
  });
  for (const item of itens) {
    if (item.tipo === "transporte") vazio.transporte = preencher(item);
    else if (item.tipo === "refeicao") vazio.refeicao = preencher(item);
    else vazio.outras.push(preencher(item));
  }
  if (vazio.outras.length > 1) vazio.outras = vazio.outras.filter((item) => item.cobrado);
  if (!vazio.outras.length) vazio.outras = [entradaAdicionalVazia()];
  return vazio;
}

function escaparHtml(valor: string): string {
  return valor.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function rotuloItem(item: ItemAdicional): string {
  if (item.tipo === "transporte") return "Transporte";
  if (item.tipo === "refeicao") return "Refeição";
  return item.descricao;
}

function rotuloRegra(regra: RegraAdicional): string {
  if (regra === "incluso") return "Incluso";
  if (regra === "reembolso") return "Reembolso mediante comprovante";
  return "Valor fixo";
}

function rotuloMeio(meio: MeioAdicional): string {
  if (meio === "pix") return "PIX";
  if (meio === "boleto") return "Boleto";
  if (meio === "transferencia") return "Transferência";
  if (meio === "reembolso") return "Reembolso mediante comprovante";
  return "Incluso no valor";
}

export function htmlAdicionais(itens: ItemAdicional[]): string {
  if (!itens.length) return "";
  const linhas = itens
    .map((item) => {
      const valor = item.valor == null ? "" : formatBrl(item.valor);
      return `<tr><td>${escaparHtml(rotuloItem(item))}</td><td>${rotuloRegra(item.regra)}</td><td>${valor}</td><td>${rotuloMeio(item.meio)}</td></tr>`;
    })
    .join("");
  return `<p>Despesas que podem ocorrer durante o trabalho, fora do valor total:</p><table><thead><tr><th>Item</th><th>Regra</th><th>Valor</th><th>Pagamento</th></tr></thead><tbody>${linhas}</tbody></table>`;
}

export function validarProposta(input: {
  clienteId: string;
  titulo: string;
  visaoGeral: string;
  escopo: string;
  responsabilidades: string;
  prazo: string;
  execucao: string;
  validade: string;
  formaPagamento: string;
  valor: string;
  inicio: string;
  fim: string;
  quantidade: string;
  modoParcelas: ModoParcelas;
  intervaloDias: string;
  primeiroVencimento: string;
  vencimentos: string[];
  adicionais?: ValoresAdicionaisForm | null;
}): TextosProposta & {
  valor: Cents;
  inicio: string | null;
  fim: string | null;
  formaCobranca: typeof FORMA_COBRANCA;
  agenda: AgendaPagamento;
  adicionais: ItemAdicional[];
} {
  if (!input.clienteId) throw new DomainError("Escolha o cliente.");
  const titulo = textoProposta(input.titulo);
  if (!titulo) throw new DomainError("Informe o título da proposta.");
  if (titulo.length > 180) throw new DomainError("O título da proposta está longo demais.");
  const valor = reaisToCents(input.valor || "0");
  if (valor < 0) throw new DomainError("Valor inválido.");
  const inicio = input.inicio || null;
  const fim = input.fim || null;
  assertVigencia(inicio, fim);
  const agenda = montarAgenda(input);
  if (agenda.parcelas.reduce((total, parcela) => total + parcela.valor, 0) !== valor) {
    throw new DomainError("A soma das parcelas precisa ser o valor total.");
  }
  return {
    titulo,
    visaoGeral: textoProposta(input.visaoGeral),
    escopo: textoProposta(input.escopo),
    responsabilidades: textoProposta(input.responsabilidades),
    prazo: textoProposta(input.prazo),
    execucao: textoProposta(input.execucao),
    validade: normalizarValidade(input.validade),
    formaPagamento: textoProposta(input.formaPagamento),
    adicionais: validarAdicionais(input.adicionais),
    valor,
    inicio,
    fim,
    formaCobranca: FORMA_COBRANCA,
    agenda,
  };
}

export function assertPropostaEditavel(status: PropostaStatus): void {
  if (status !== "rascunho") {
    throw new DomainError("Proposta enviada fica como foi mandada. Correção vira versão nova.");
  }
}

export function transicionarProposta(status: PropostaStatus, acao: "enviar" | "aceitar" | "recusar" | "expirar"): PropostaStatus {
  const destino = { enviar: "enviada", aceitar: "aceita", recusar: "recusada", expirar: "expirada" }[acao] as PropostaStatus;
  const permitida =
    (status === "rascunho" && (destino === "enviada" || destino === "recusada" || destino === "expirada")) ||
    (status === "enviada" && (destino === "aceita" || destino === "recusada" || destino === "expirada"));
  if (!permitida) throw new DomainError("Transição de status da proposta não permitida.");
  return destino;
}

export function assertPodeAceitar(valor: Cents): void {
  if (valor <= 0) throw new DomainError("A proposta aceita precisa de valor maior que zero.");
}

export type ParcelaPrevista = {
  parcela: number;
  descricao: string;
  valor: Cents;
  vencimento: string;
  competencia: string;
};

export function parcelasPrevistas(agenda: AgendaPagamento | null): ParcelaPrevista[] {
  if (!agenda) return [];
  const total = agenda.parcelas.length;
  const previstas: ParcelaPrevista[] = [];
  agenda.parcelas.forEach((parcela, indice) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parcela.vencimento) || parcela.valor <= 0) return;
    const vencimento = assertData(parcela.vencimento, "Vencimento");
    previstas.push({
      parcela: indice + 1,
      descricao: `Parcela ${indice + 1}/${total}`,
      valor: parcela.valor,
      vencimento,
      competencia: competenciaDoVencimento(vencimento),
    });
  });
  return previstas;
}

export function validarOrigemTitulo(valor: string): string {
  const origem = valor.trim();
  if (origem.length < 2) throw new DomainError("Informe de onde veio este título.");
  if (origem.length > 200) throw new DomainError("A origem passou de 200 caracteres.");
  return origem;
}

export function validarTituloAvulso(input: {
  descricao: string;
  valor: string;
  vencimento: string;
  competencia: string;
  origem: string;
}): { descricao: string; valor: Cents; vencimento: string; competencia: string; origem: string; status: "previsto" } {
  const descricao = input.descricao.trim();
  if (!descricao) throw new DomainError("Informe a descrição do título.");
  const valor = reaisToCents(input.valor);
  if (valor <= 0) throw new DomainError("O valor do título precisa ser maior que zero.");
  const vencimento = assertData(input.vencimento, "Vencimento");
  const competencia = input.competencia ? normalizarCompetencia(input.competencia) : competenciaDoVencimento(vencimento);
  return { descricao, valor, vencimento, competencia, origem: validarOrigemTitulo(input.origem), status: "previsto" };
}

export const FORMAS_RECEBIMENTO_TITULO = ["boleto", "pix", "transferencia", "outro"] as const;
export type FormaRecebimentoTitulo = (typeof FORMAS_RECEBIMENTO_TITULO)[number];
export type TipoVencimentoTitulo = "data_fixa" | "prazo_dias";

export function validarCentroTitulo(centroId: string): string {
  const id = centroId.trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("Informe o centro de custo.");
  return id;
}

export type PreenchimentoGrupo = {
  centroId: string | null;
  forma: FormaRecebimentoTitulo | null;
  banco: string | null;
  numeroNf: string | null;
  tipoVencimento: TipoVencimentoTitulo | null;
  prazoDias: number | null;
  competencia: string | null;
};

export function validarPreenchimentoGrupo(entrada: {
  centroId: string;
  forma: string;
  banco: string;
  numeroNf: string;
  tipoVencimento: string;
  prazoDias: string;
  competencia: string;
}): PreenchimentoGrupo {
  const centroId = entrada.centroId.trim() ? validarCentroTitulo(entrada.centroId) : null;
  const formaBruta = entrada.forma.trim();
  let forma: FormaRecebimentoTitulo | null = null;
  if (formaBruta) {
    if (!FORMAS_RECEBIMENTO_TITULO.includes(formaBruta as FormaRecebimentoTitulo)) throw new DomainError("Informe a forma de recebimento.");
    forma = formaBruta as FormaRecebimentoTitulo;
  }
  const banco = entrada.banco.trim();
  if (banco && (banco.length < 2 || banco.length > 80)) throw new DomainError("Informe o banco de recebimento.");
  const numeroNf = entrada.numeroNf.trim();
  if (numeroNf.length > 40) throw new DomainError("O número da NF passou de 40 caracteres.");
  const tipoBruto = entrada.tipoVencimento.trim();
  let tipoVencimento: TipoVencimentoTitulo | null = null;
  let prazoDias: number | null = null;
  if (tipoBruto) {
    if (tipoBruto !== "data_fixa" && tipoBruto !== "prazo_dias") throw new DomainError("Informe o tipo de vencimento.");
    tipoVencimento = tipoBruto;
    if (tipoVencimento === "prazo_dias") {
      if (!/^\d+$/.test(entrada.prazoDias.trim())) throw new DomainError("Informe o prazo em dias.");
      prazoDias = Number(entrada.prazoDias);
      if (prazoDias <= 0 || prazoDias > 3650) throw new DomainError("Informe o prazo em dias.");
    }
  }
  const competencia = entrada.competencia.trim() ? normalizarCompetencia(entrada.competencia.trim()) : null;
  if (!centroId && !forma && !banco && !numeroNf && !tipoVencimento && !competencia) {
    throw new DomainError("Informe ao menos um campo da manutenção em grupo.");
  }
  return { centroId, forma, banco: banco || null, numeroNf: numeroNf || null, tipoVencimento, prazoDias, competencia };
}

export type TituloParaGrupo = {
  status: string;
  temNfse: boolean;
  temBoleto: boolean;
  centroId: string | null;
  forma: string | null;
  banco: string | null;
  numeroNf: string | null;
  tipoVencimento: string | null;
  competencia: string | null;
};

export function aplicarCamposVazios(
  atual: TituloParaGrupo,
  preenchimento: PreenchimentoGrupo,
): "ignorar" | "vazio" | Record<string, string | number | null> {
  if (atual.status !== "previsto" || atual.temNfse || atual.temBoleto) return "ignorar";
  const patch: Record<string, string | number | null> = {};
  if (preenchimento.centroId && !atual.centroId) patch.centro_custo_id = preenchimento.centroId;
  if (preenchimento.forma && !atual.forma) patch.forma_recebimento = preenchimento.forma;
  if (preenchimento.banco && !atual.banco?.trim()) patch.banco = preenchimento.banco;
  if (preenchimento.numeroNf && !atual.numeroNf?.trim()) patch.numero_nf = preenchimento.numeroNf;
  if (preenchimento.tipoVencimento && !atual.tipoVencimento) {
    patch.tipo_vencimento = preenchimento.tipoVencimento;
    patch.prazo_dias = preenchimento.prazoDias;
  }
  if (preenchimento.competencia && !atual.competencia) patch.competencia = preenchimento.competencia;
  return Object.keys(patch).length === 0 ? "vazio" : patch;
}

export function validarRecebimentoTitulo(input: {
  forma: string;
  numeroNf: string;
  tipoVencimento: string;
  prazoDias: string;
  banco: string;
}): {
  forma: FormaRecebimentoTitulo;
  numeroNf: string | null;
  tipoVencimento: TipoVencimentoTitulo;
  prazoDias: number | null;
  banco: string;
} {
  const forma = input.forma.trim() as FormaRecebimentoTitulo;
  if (!FORMAS_RECEBIMENTO_TITULO.includes(forma)) throw new DomainError("Informe a forma de recebimento.");
  const tipo = input.tipoVencimento.trim();
  if (tipo !== "data_fixa" && tipo !== "prazo_dias") throw new DomainError("Informe o tipo de vencimento.");
  let prazoDias: number | null = null;
  if (tipo === "prazo_dias") {
    if (!/^\d+$/.test(input.prazoDias.trim())) throw new DomainError("Informe o prazo em dias.");
    prazoDias = Number(input.prazoDias);
    if (prazoDias <= 0 || prazoDias > 3650) throw new DomainError("Informe o prazo em dias.");
  }
  const banco = input.banco.trim();
  if (banco.length < 2) throw new DomainError("Informe o banco de recebimento.");
  if (banco.length > 80) throw new DomainError("O banco passou de 80 caracteres.");
  const numeroNf = input.numeroNf.trim();
  if (numeroNf.length > 40) throw new DomainError("O número da NF passou de 40 caracteres.");
  return { forma, numeroNf: numeroNf || null, tipoVencimento: tipo, prazoDias, banco };
}

export type TituloAvulsoPronto = {
  descricao: string;
  valor: Cents;
  vencimento: string;
  competencia: string;
  origem: string;
  clienteId: string;
  parcela: number;
  quantidade: number;
  forma: FormaRecebimentoTitulo;
  numeroNf: string | null;
  tipoVencimento: TipoVencimentoTitulo;
  prazoDias: number | null;
  banco: string;
  centroId: string;
  status: "previsto";
};

export function montarTitulosAvulsos(input: {
  descricao: string;
  valor: string;
  origem: string;
  clienteId: string;
  forma: string;
  numeroNf: string;
  tipoVencimento: string;
  prazoDias: string;
  quantidade: string;
  vencimentos: string[];
  primeiroVencimento: string;
  banco: string;
  centroId: string;
}): TituloAvulsoPronto[] {
  const descricao = input.descricao.trim();
  if (!descricao) throw new DomainError("Informe a descrição do título.");
  const valor = reaisToCents(input.valor);
  if (valor <= 0) throw new DomainError("O valor do título precisa ser maior que zero.");
  const clienteId = input.clienteId.trim();
  if (!clienteId) throw new DomainError("Informe o cliente.");
  const recebimento = validarRecebimentoTitulo(input);
  if (!/^\d+$/.test(input.quantidade.trim())) throw new DomainError("Informe a quantidade de parcelas.");
  const quantidade = Number(input.quantidade);
  if (quantidade < 1 || quantidade > 60) throw new DomainError("A quantidade de parcelas vai de 1 a 60.");
  const origem = validarOrigemTitulo(input.origem);
  const centroId = validarCentroTitulo(input.centroId);
  const vencimentos: string[] = [];
  if (recebimento.tipoVencimento === "data_fixa") {
    if (input.vencimentos.length !== quantidade) throw new DomainError("Informe a data de cada parcela.");
    for (const data of input.vencimentos) vencimentos.push(assertData(data, "Vencimento"));
  } else {
    const primeiro = assertData(input.primeiroVencimento, "Primeiro vencimento");
    const prazo = recebimento.prazoDias ?? 0;
    for (let indice = 0; indice < quantidade; indice += 1) vencimentos.push(somarDias(primeiro, indice * prazo));
  }
  return vencimentos.map((vencimento, indice) => ({
    descricao: quantidade === 1 ? descricao : `${descricao} · Parcela ${indice + 1}/${quantidade}`,
    valor,
    vencimento,
    competencia: competenciaDoVencimento(vencimento),
    origem,
    clienteId,
    parcela: indice + 1,
    quantidade,
    forma: recebimento.forma,
    numeroNf: recebimento.numeroNf,
    tipoVencimento: recebimento.tipoVencimento,
    prazoDias: recebimento.prazoDias,
    banco: recebimento.banco,
    centroId,
    status: "previsto",
  }));
}

export function novaVersao(status: PropostaStatus, versao: number, existeRascunho: boolean): { versao: number; status: "rascunho" } {
  if (status === "rascunho") throw new DomainError("A versão em rascunho ainda pode ser editada.");
  if (existeRascunho) throw new DomainError("Já existe uma versão em rascunho desta proposta.");
  return { versao: versao + 1, status: "rascunho" };
}

export function proximoNumero(existentes: string[]): string {
  let max = 0;
  for (const numero of existentes) {
    const match = /^P-(\d+)$/.exec(numero);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `P-${String(max + 1).padStart(4, "0")}`;
}

export function contratoDaProposta(proposta: {
  status: PropostaStatus;
  clienteId: string;
  valor: Cents;
  formaCobranca: string;
  jaTemContrato: boolean;
}): { status: "rascunho"; clienteId: string; valorContratado: Cents; formaCobranca: typeof FORMA_COBRANCA } {
  if (proposta.status !== "aceita") throw new DomainError("Contrato nasce de uma proposta aceita.");
  if (proposta.jaTemContrato) throw new DomainError("Uma versão aceita gera no máximo um contrato.");
  if (proposta.formaCobranca !== FORMA_COBRANCA) throw new DomainError("A forma de cobrança é mista.");
  return {
    status: "rascunho",
    clienteId: proposta.clienteId,
    valorContratado: proposta.valor,
    formaCobranca: FORMA_COBRANCA,
  };
}

export function vigorarContrato(contrato: { status: ContratoStatus; inicio: string | null; fim: string | null }): void {
  if (contrato.status !== "rascunho") throw new DomainError("Só contrato em rascunho fica vigente.");
  if (!contrato.inicio) throw new DomainError("Informe o início da vigência.");
  assertVigencia(contrato.inicio, contrato.fim);
}

export function encerrarContrato(status: ContratoStatus): void {
  if (status !== "vigente") throw new DomainError("Só contrato vigente pode ser encerrado.");
}

export type DocTitulo = {
  id: string;
  status: TituloStatus;
  nfse: "ausente" | NfseStatus;
  boleto: "ausente" | BoletoStatus;
};

export function cancelarContrato(status: ContratoStatus, titulos: DocTitulo[]): string[] {
  if (status !== "rascunho" && status !== "vigente") throw new DomainError("Este contrato não pode ser cancelado.");
  const bloqueado = titulos.some(
    (titulo) => titulo.status === "faturado" && (titulo.nfse === "informada" || (titulo.boleto !== "ausente" && titulo.boleto !== "cancelado")),
  );
  if (bloqueado) {
    throw new DomainError("Cancele a NFS-e e o boleto dos títulos faturados antes de cancelar o contrato.");
  }
  return titulos.filter((titulo) => titulo.status === "previsto" || titulo.status === "faturado").map((titulo) => titulo.id);
}

export function podeAbrirTitulo(status: ContratoStatus): void {
  if (status !== "vigente") throw new DomainError("Conta a receber só abre com o contrato vigente.");
}

export function novoTitulo(input: {
  contratoStatus: ContratoStatus;
  descricao: string;
  valor: string;
  vencimento: string;
  competencia: string;
}): { descricao: string; valor: Cents; vencimento: string; competencia: string; status: "previsto" } {
  podeAbrirTitulo(input.contratoStatus);
  const descricao = input.descricao.trim();
  if (!descricao) throw new DomainError("Informe a descrição do título.");
  const valor = reaisToCents(input.valor);
  if (valor <= 0) throw new DomainError("O valor do título precisa ser maior que zero.");
  const vencimento = assertData(input.vencimento, "Vencimento");
  const competencia = input.competencia ? normalizarCompetencia(input.competencia) : competenciaDoVencimento(vencimento);
  return { descricao, valor, vencimento, competencia, status: "previsto" };
}

export function editarTituloPrevisto(
  status: TituloStatus,
  input: { descricao: string; valor: string; vencimento: string; competencia: string },
): { descricao: string; valor: Cents; vencimento: string; competencia: string } {
  if (status !== "previsto") {
    throw new DomainError("Valor, vencimento e competência só mudam enquanto o título está previsto.");
  }
  return novoTitulo({ contratoStatus: "vigente", ...input });
}

export function faturarTitulo(status: TituloStatus): void {
  if (status !== "previsto") throw new DomainError("Só título previsto pode ser faturado.");
}

export function podeCancelarTitulo(titulo: DocTitulo): void {
  if (titulo.status === "previsto") return;
  if (titulo.status !== "faturado") throw new DomainError("Este título não pode ser cancelado.");
  if (titulo.nfse === "informada") throw new DomainError("Cancele a NFS-e antes de cancelar a conta.");
  if (titulo.boleto !== "ausente" && titulo.boleto !== "cancelado") {
    throw new DomainError("Cancele o boleto antes de cancelar a conta.");
  }
}

export function registrarNfse(input: {
  tituloStatus: TituloStatus;
  jaInformada: boolean;
  numero: string;
  valor: string;
  vencimento: string;
  dataEmissao: string;
}): {
  numero: string;
  valor: Cents;
  vencimento: string;
  dataEmissao: string;
  status: "informada";
  emissor: typeof EMISSOR_NFSE_FASE1;
  municipio: typeof MUNICIPIO_NFSE;
} {
  if (input.jaInformada) throw new DomainError("O título já tem NFS-e informada.");
  if (input.tituloStatus !== "faturado" && input.tituloStatus !== "recebido") {
    throw new DomainError("A NFS-e exige a conta faturada.");
  }
  const numero = input.numero.trim();
  if (!numero) throw new DomainError("Informe o número da NFS-e.");
  const valor = reaisToCents(input.valor);
  if (valor <= 0) throw new DomainError("O valor da NFS-e precisa ser maior que zero.");
  return {
    numero,
    valor,
    vencimento: assertData(input.vencimento, "Vencimento"),
    dataEmissao: assertData(input.dataEmissao, "Data de emissão"),
    status: "informada",
    emissor: EMISSOR_NFSE_FASE1,
    municipio: MUNICIPIO_NFSE,
  };
}

export function cancelarNfse(status: NfseStatus | "ausente"): void {
  if (status !== "informada") throw new DomainError("Não há NFS-e informada para cancelar.");
}

export function registrarBoleto(input: {
  tituloStatus: TituloStatus;
  jaTem: boolean;
  numero: string;
  valor: string;
  vencimento: string;
  status: "aberto" | "atrasado";
  meio: MeioBoleto;
  linhaDigitavel: string;
}): {
  numero: string;
  valor: Cents;
  vencimento: string;
  status: "aberto" | "atrasado";
  meio: MeioBoleto;
  linhaDigitavel: string | null;
} {
  if (input.jaTem) throw new DomainError("O título já tem boleto.");
  if (input.tituloStatus !== "faturado") throw new DomainError("O boleto exige a conta faturada.");
  const numero = input.numero.trim();
  if (!numero) throw new DomainError("Informe o número do boleto.");
  const valor = reaisToCents(input.valor);
  if (valor <= 0) throw new DomainError("O valor do boleto precisa ser maior que zero.");
  if (input.status !== "aberto" && input.status !== "atrasado") throw new DomainError("Boleto novo nasce aberto ou atrasado.");
  if (input.meio !== "boleto" && input.meio !== "pix") throw new DomainError("Informe o meio do boleto.");
  return {
    numero,
    valor,
    vencimento: assertData(input.vencimento, "Vencimento"),
    status: input.status,
    meio: input.meio,
    linhaDigitavel: input.linhaDigitavel.trim() || null,
  };
}

export function mudarBoleto(atual: BoletoStatus, proximo: "aberto" | "atrasado" | "cancelado"): BoletoStatus {
  const livre = atual === "aberto" || atual === "atrasado";
  if (livre && (proximo === "aberto" || proximo === "atrasado" || proximo === "cancelado")) return proximo;
  throw new DomainError("Este boleto não muda para esse status.");
}

export function pagarBoleto(input: {
  tituloStatus: TituloStatus;
  boletoStatus: BoletoStatus;
  valor: string;
  data: string;
  meio: MeioBoleto;
}): { valorRecebido: Cents; data: string; meio: MeioBoleto } {
  if (input.tituloStatus !== "faturado") throw new DomainError("Só um título faturado pode ser baixado pelo boleto.");
  if (input.boletoStatus !== "aberto" && input.boletoStatus !== "atrasado") {
    throw new DomainError("Só boleto aberto ou atrasado pode ser pago.");
  }
  if (input.meio !== "boleto" && input.meio !== "pix") throw new DomainError("Informe o meio do boleto pago.");
  const valorRecebido = reaisToCents(input.valor);
  if (valorRecebido <= 0) throw new DomainError("O valor recebido precisa ser maior que zero.");
  return { valorRecebido, data: assertData(input.data, "Data da baixa"), meio: input.meio };
}

export function baixaManual(input: {
  tituloStatus: TituloStatus;
  boleto: DocTitulo["boleto"];
  valor: string;
  data: string;
  meio: MeioRecebimento;
}): { valorRecebido: Cents; data: string; meio: MeioRecebimento } {
  if (input.tituloStatus !== "faturado") throw new DomainError("Só um título faturado pode ser baixado.");
  if (input.boleto === "aberto" || input.boleto === "atrasado" || input.boleto === "pago") {
    throw new DomainError("Baixe pelo boleto pago ou cancele o boleto antes da baixa manual.");
  }
  if (input.meio !== "boleto" && input.meio !== "pix" && input.meio !== "manual") {
    throw new DomainError("Informe o meio da baixa.");
  }
  const valorRecebido = reaisToCents(input.valor);
  if (valorRecebido <= 0) throw new DomainError("O valor recebido precisa ser maior que zero.");
  return { valorRecebido, data: assertData(input.data, "Data da baixa"), meio: input.meio };
}

export type Movimento = {
  data: string;
  natureza: "entrada" | "saida";
  situacao: "previsto" | "realizado";
  origem: "receber" | "pagar";
  descricao: string;
  valor: Cents;
};

export function montarFluxo(input: {
  titulos: {
    descricao: string;
    status: TituloStatus;
    valor: Cents;
    vencimento: string;
    valorRecebido: Cents | null;
    dataRecebimento: string | null;
  }[];
  contas: {
    descricao: string;
    status: ContaPagarStatus;
    valor: Cents;
    vencimento: string;
    dataPagamento: string | null;
  }[];
}): Movimento[] {
  const movimentos: Movimento[] = [];
  for (const titulo of input.titulos) {
    if (titulo.status !== "recebido" && titulo.status !== "cancelado") {
      movimentos.push({
        data: titulo.vencimento,
        natureza: "entrada",
        situacao: "previsto",
        origem: "receber",
        descricao: titulo.descricao,
        valor: titulo.valor,
      });
    }
    if (titulo.status === "recebido" && titulo.dataRecebimento && titulo.valorRecebido != null) {
      movimentos.push({
        data: titulo.dataRecebimento,
        natureza: "entrada",
        situacao: "realizado",
        origem: "receber",
        descricao: titulo.descricao,
        valor: titulo.valorRecebido,
      });
    }
  }
  for (const conta of input.contas) {
    if (conta.status === "a_pagar") {
      movimentos.push({
        data: conta.vencimento,
        natureza: "saida",
        situacao: "previsto",
        origem: "pagar",
        descricao: conta.descricao,
        valor: conta.valor,
      });
    }
    if (conta.status === "paga" && conta.dataPagamento) {
      movimentos.push({
        data: conta.dataPagamento,
        natureza: "saida",
        situacao: "realizado",
        origem: "pagar",
        descricao: conta.descricao,
        valor: conta.valor,
      });
    }
  }
  return movimentos.sort((a, b) => a.data.localeCompare(b.data) || a.descricao.localeCompare(b.descricao, "pt-BR"));
}

export function filtrarPeriodo(movimentos: Movimento[], de: string, ate: string): Movimento[] {
  const inicio = assertData(de, "Início");
  const fim = assertData(ate, "Fim");
  if (fim < inicio) throw new DomainError("O fim do período não pode ser antes do início.");
  return movimentos.filter((movimento) => movimento.data >= inicio && movimento.data <= fim);
}

export function somarFluxo(movimentos: Movimento[]): {
  previstoEntradas: Cents;
  previstoSaidas: Cents;
  realizadoEntradas: Cents;
  realizadoSaidas: Cents;
} {
  const total = (situacao: Movimento["situacao"], natureza: Movimento["natureza"]) =>
    movimentos.filter((movimento) => movimento.situacao === situacao && movimento.natureza === natureza).reduce((acc, movimento) => acc + movimento.valor, 0);
  return {
    previstoEntradas: total("previsto", "entrada"),
    previstoSaidas: total("previsto", "saida"),
    realizadoEntradas: total("realizado", "entrada"),
    realizadoSaidas: total("realizado", "saida"),
  };
}

export type TituloMargem = {
  id: string;
  centroId: string | null;
  contratoId: string | null;
  status: TituloStatus;
  valor: Cents;
  valorRecebido: Cents | null;
  vencimento: string;
  dataRecebimento: string | null;
};

function assertPeriodo(inicio: string, fim: string): { inicio: string; fim: string } {
  const de = assertData(inicio, "Início");
  const ate = assertData(fim, "Fim");
  if (ate < de) throw new DomainError("O fim do período não pode ser antes do início.");
  return { inicio: de, fim: ate };
}

function diaNoPeriodo(data: string | null, inicio: string, fim: string): boolean {
  if (!data) return false;
  const dia = data.slice(0, 10);
  return dia >= inicio && dia <= fim;
}

export function tituloContaNaMargem(
  titulo: { status: TituloStatus; vencimento: string; dataRecebimento: string | null },
  inicio: string,
  fim: string,
): boolean {
  if (titulo.status === "cancelado") return false;
  if (titulo.status === "previsto" || titulo.status === "faturado") return diaNoPeriodo(titulo.vencimento, inicio, fim);
  if (titulo.status === "recebido") return diaNoPeriodo(titulo.dataRecebimento, inicio, fim);
  return false;
}

export function margemDoCentro(input: {
  centroId: string;
  inicio: string;
  fim: string;
  titulos: { centroId: string | null; status: TituloStatus; valor: Cents; vencimento: string; dataRecebimento: string | null }[];
  pessoal: { centroId: string; competencia: string; valor: Cents }[];
  despesas: { centroId: string; competencia: string; tipo: "operacional" | "financeira"; valor: Cents; cancelada: boolean }[];
}): { receita: Cents; pessoal: Cents; operacional: Cents; margem: Cents } {
  const periodo = assertPeriodo(input.inicio, input.fim);
  const receita = input.titulos
    .filter((titulo) => titulo.centroId === input.centroId && tituloContaNaMargem(titulo, periodo.inicio, periodo.fim))
    .reduce((acc, titulo) => acc + titulo.valor, 0);
  const pessoal = input.pessoal
    .filter((linha) => linha.centroId === input.centroId && diaNoPeriodo(linha.competencia, periodo.inicio, periodo.fim))
    .reduce((acc, linha) => acc + linha.valor, 0);
  const operacional = input.despesas
    .filter(
      (despesa) =>
        despesa.centroId === input.centroId &&
        diaNoPeriodo(despesa.competencia, periodo.inicio, periodo.fim) &&
        despesa.tipo === "operacional" &&
        !despesa.cancelada,
    )
    .reduce((acc, despesa) => acc + despesa.valor, 0);
  return { receita, pessoal, operacional, margem: receita - pessoal - operacional };
}

export function despesaFinanceiraDoPeriodo(
  despesas: { competencia: string; tipo: "operacional" | "financeira"; valor: Cents; cancelada: boolean }[],
  inicio: string,
  fim: string,
): Cents {
  const periodo = assertPeriodo(inicio, fim);
  return despesas
    .filter((despesa) => diaNoPeriodo(despesa.competencia, periodo.inicio, periodo.fim) && despesa.tipo === "financeira" && !despesa.cancelada)
    .reduce((acc, despesa) => acc + despesa.valor, 0);
}

export function receitaJurosDoPeriodo(
  titulos: { status: TituloStatus; valor: Cents; valorRecebido: Cents | null; dataRecebimento: string | null }[],
  inicio: string,
  fim: string,
): Cents {
  const periodo = assertPeriodo(inicio, fim);
  return titulos.reduce((acc, titulo) => {
    if (titulo.status !== "recebido" || titulo.valorRecebido == null) return acc;
    if (!diaNoPeriodo(titulo.dataRecebimento, periodo.inicio, periodo.fim)) return acc;
    return acc + Math.max(0, titulo.valorRecebido - titulo.valor);
  }, 0);
}

export function comporMargem(input: {
  inicio: string;
  fim: string;
  contratos: { id: string; centroId: string | null }[];
  centrosIndiretos: string[];
  titulos: TituloMargem[];
  pessoal: { centroId: string; competencia: string; valor: Cents }[];
  despesas: { centroId: string; competencia: string; tipo: "operacional" | "financeira"; valor: Cents; cancelada: boolean }[];
}): {
  contratos: { id: string; receita: Cents; pessoal: Cents; operacional: Cents; margem: Cents }[];
  overhead: { centroId: string; receita: Cents; pessoal: Cents; operacional: Cents; margem: Cents }[];
  avulsos: { centroId: string | null; receita: Cents }[];
  despesaFinanceira: Cents;
  receitaJuros: Cents;
} {
  const periodo = assertPeriodo(input.inicio, input.fim);
  const noPeriodo = input.titulos.filter((titulo) => tituloContaNaMargem(titulo, periodo.inicio, periodo.fim));
  const usados = new Set<string>();
  const receitaPorContrato = new Map<string, Cents>(input.contratos.map((contrato) => [contrato.id, 0]));
  const contratoIds = new Set(input.contratos.map((contrato) => contrato.id));

  for (const titulo of noPeriodo) {
    if (!titulo.contratoId || !contratoIds.has(titulo.contratoId) || usados.has(titulo.id)) continue;
    usados.add(titulo.id);
    receitaPorContrato.set(titulo.contratoId, (receitaPorContrato.get(titulo.contratoId) ?? 0) + titulo.valor);
  }

  const contratoDoCentro = new Map<string, string>();
  for (const contrato of input.contratos) {
    if (contrato.centroId && !contratoDoCentro.has(contrato.centroId)) contratoDoCentro.set(contrato.centroId, contrato.id);
  }
  for (const titulo of noPeriodo) {
    if (usados.has(titulo.id) || !titulo.centroId) continue;
    const contratoId = contratoDoCentro.get(titulo.centroId);
    if (!contratoId) continue;
    usados.add(titulo.id);
    receitaPorContrato.set(contratoId, (receitaPorContrato.get(contratoId) ?? 0) + titulo.valor);
  }

  const indiretos = new Set(input.centrosIndiretos);
  const receitaOverhead = new Map<string, Cents>(input.centrosIndiretos.map((centroId) => [centroId, 0]));
  const avulsoMap = new Map<string, Cents>();
  for (const titulo of noPeriodo) {
    if (usados.has(titulo.id)) continue;
    usados.add(titulo.id);
    if (titulo.centroId && indiretos.has(titulo.centroId)) {
      receitaOverhead.set(titulo.centroId, (receitaOverhead.get(titulo.centroId) ?? 0) + titulo.valor);
      continue;
    }
    const chave = titulo.centroId ?? "";
    avulsoMap.set(chave, (avulsoMap.get(chave) ?? 0) + titulo.valor);
  }

  const pessoalDo = (centroId: string) =>
    input.pessoal
      .filter((linha) => linha.centroId === centroId && diaNoPeriodo(linha.competencia, periodo.inicio, periodo.fim))
      .reduce((acc, linha) => acc + linha.valor, 0);
  const operacionalDo = (centroId: string) =>
    input.despesas
      .filter(
        (despesa) =>
          despesa.centroId === centroId &&
          diaNoPeriodo(despesa.competencia, periodo.inicio, periodo.fim) &&
          despesa.tipo === "operacional" &&
          !despesa.cancelada,
      )
      .reduce((acc, despesa) => acc + despesa.valor, 0);
  const fechar = (centroId: string | null, receita: Cents) => {
    const pessoal = centroId ? pessoalDo(centroId) : 0;
    const operacional = centroId ? operacionalDo(centroId) : 0;
    return { receita, pessoal, operacional, margem: receita - pessoal - operacional };
  };

  return {
    contratos: input.contratos
      .filter((contrato) => contrato.centroId || (receitaPorContrato.get(contrato.id) ?? 0) > 0)
      .map((contrato) => ({ id: contrato.id, ...fechar(contrato.centroId, receitaPorContrato.get(contrato.id) ?? 0) })),
    overhead: input.centrosIndiretos.map((centroId) => ({ centroId, ...fechar(centroId, receitaOverhead.get(centroId) ?? 0) })),
    avulsos: [...avulsoMap.entries()]
      .map(([chave, receita]) => ({ centroId: chave || null, receita }))
      .sort((a, b) => (a.centroId ?? "\uffff").localeCompare(b.centroId ?? "\uffff")),
    despesaFinanceira: despesaFinanceiraDoPeriodo(input.despesas, periodo.inicio, periodo.fim),
    receitaJuros: receitaJurosDoPeriodo(input.titulos, periodo.inicio, periodo.fim),
  };
}

export function totaisDoMes(
  despesas: { centroId: string; centroNome: string; tipo: "operacional" | "financeira"; valor: Cents; competencia: string; cancelada: boolean }[],
  competencia: string,
): { centroId: string; centroNome: string; tipo: "operacional" | "financeira"; total: Cents }[] {
  const mes = normalizarCompetencia(competencia);
  const mapa = new Map<string, { centroId: string; centroNome: string; tipo: "operacional" | "financeira"; total: Cents }>();
  for (const despesa of despesas) {
    if (despesa.competencia !== mes || despesa.cancelada) continue;
    const chave = `${despesa.centroId}:${despesa.tipo}`;
    const atual = mapa.get(chave) ?? { centroId: despesa.centroId, centroNome: despesa.centroNome, tipo: despesa.tipo, total: 0 };
    atual.total += despesa.valor;
    mapa.set(chave, atual);
  }
  return [...mapa.values()].sort((a, b) => a.centroNome.localeCompare(b.centroNome, "pt-BR") || a.tipo.localeCompare(b.tipo));
}
