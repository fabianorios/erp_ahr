import { supabase } from "@/integrations/supabase/client";
import {
  DomainError,
  type BoletoStatus,
  type CentroTipo,
  type Cents,
  type ContaPagarStatus,
  type ContratoStatus,
  type CustoStatus,
  type MeioBoleto,
  type MeioRecebimento,
  type NfseStatus,
  type PropostaStatus,
  type TituloStatus,
  assertCustoEditavel,
  assertPodeAceitar,
  assertPropostaEditavel,
  assertVigencia,
  baixaManual,
  cancelarContrato,
  cancelarDespesa,
  cancelarNfse,
  comporMargem,
  editarTituloPrevisto,
  encerrarContrato,
  faturarTitulo,
  fecharRateio,
  filtrarPeriodo,
  montarFluxo,
  mudarBoleto,
  novaVersao,
  novoTitulo,
  pagarBoleto,
  pagarDespesa,
  percentToBp,
  podeCancelarTitulo,
  reaisToCents,
  registrarBoleto,
  registrarNfse,
  normalizarCliente,
  somarFluxo,
  validarCentroIndireto,
  validarCusto,
  validarDespesa,
  adicionaisDeJson,
  adicionaisNoFormulario,
  agendaDeJson,
  validadeNoFormulario,
  valoresAdicionaisVazios,
  validarProposta,
  montarTitulosAvulsos,
  validarCentroTitulo,
  validarRecebimentoTitulo,
  validarTituloAvulso,
  type AgendaPagamento,
  type ModoParcelas,
  type TextosProposta,
  type ValoresAdicionaisForm,
  valorRateado,
  transicionarProposta,
} from "@/services/erp/domain";
import type { PainelAssinaturaDados, TipoDocumentoAssinatura } from "@/services/erp/assinatura";

export { DomainError } from "@/services/erp/domain";

type Result = { data: any; error: { message: string } | null };

function banco() {
  if (!supabase) throw new DomainError("Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente deste ERP.");
  return supabase as unknown as {
    from: (table: string) => any;
    rpc: (fn: string, args?: Record<string, unknown>) => Promise<Result>;
  };
}

export function mensagemDb(message: string): string {
  if (/permission denied|row-level security|42501/i.test(message)) {
    return "Seu usuário precisa de um papel em user_roles: admin, consultor, editor ou beta_tester.";
  }
  return message.replace(/^.*ERROR:\s*/i, "").trim();
}

function falha(error: { message: string } | null): void {
  if (!error) return;
  if (/schema cache|column/i.test(error.message) && /responsabilidades|forma_pagamento|agenda_pagamento|\bprazo\b/.test(error.message)) {
    throw new DomainError("As seções da proposta ainda não existem no banco deste ERP.");
  }
  throw new DomainError(mensagemDb(error.message));
}

async function ler<T>(query: PromiseLike<Result>): Promise<T[]> {
  const { data, error } = await query;
  falha(error);
  return (data ?? []) as T[];
}

async function escrever(acao: string, dados: unknown): Promise<{ id?: string; message?: string; clientes?: ClienteItem[]; contatos?: ContatoItem[]; titulos?: any[]; painel?: PainelAssinaturaDados | null; aviso?: string; vez?: boolean; atualizados?: number; ignorados?: number; semVazio?: number }> {
  if (!supabase) throw new DomainError("Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente deste ERP.");
  const sessao = await supabase.auth.getSession();
  const token = sessao.data.session?.access_token;
  if (!token) throw new DomainError("Entre de novo.");
  const resposta = await fetch("/api/erp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ acao, dados }),
  });
  const corpo = (await resposta.json().catch(() => ({}))) as { id?: string; message?: string; clientes?: ClienteItem[]; contatos?: ContatoItem[]; titulos?: any[]; painel?: PainelAssinaturaDados | null; aviso?: string; vez?: boolean; atualizados?: number; ignorados?: number; semVazio?: number };
  if (!resposta.ok) throw new DomainError(corpo.message ?? "Não foi possível gravar.");
  return corpo;
}

function exigirId(resultado: { id?: string }, mensagem: string): string {
  if (!resultado.id) throw new DomainError(mensagem);
  return resultado.id;
}

function cents(value: unknown): Cents {
  if (typeof value === "number" || typeof value === "string") return reaisToCents(value);
  throw new DomainError("Valor ausente.");
}

function dia(value: unknown): string {
  if (typeof value !== "string" || value.length < 10) throw new DomainError("Data ausente.");
  return value.slice(0, 10);
}

function diaOu(value: unknown): string | null {
  if (value == null || value === "") return null;
  return dia(value);
}

function um<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function percentualTexto(value: unknown): string {
  const bp = percentToBp(typeof value === "number" ? value : String(value ?? ""));
  return `${Math.trunc(bp / 100)},${String(Math.abs(bp) % 100).padStart(2, "0")}`;
}

export type Centro = { id: string; nome: string; tipo: CentroTipo; contratoId: string | null; ativo: boolean };

export async function listarCentros(): Promise<Centro[]> {
  const data = await ler<any>(banco().from("erp_centros_custo").select("*").order("nome"));
  return data.map((row) => ({
    id: row.id,
    nome: row.nome,
    tipo: row.tipo,
    contratoId: row.contrato_id,
    ativo: row.ativo,
  }));
}

export async function criarCentroIndireto(nome: string): Promise<void> {
  validarCentroIndireto(nome);
  await escrever("centro.criar", { nome });
}

export async function renomearCentro(id: string, nome: string): Promise<void> {
  validarCentroIndireto(nome);
  await escrever("centro.renomear", { id, nome });
}

export async function alternarCentro(centro: Centro, ativo: boolean): Promise<void> {
  if (centro.tipo === "financeiro" && !ativo) throw new DomainError("O centro financeiro permanece ativo.");
  await escrever("centro.alternar", { id: centro.id, ativo });
}

export async function excluirCentro(centro: Centro): Promise<void> {
  if (centro.tipo === "financeiro") throw new DomainError("O centro financeiro não pode ser excluído.");
  if (centro.tipo === "contrato") throw new DomainError("O centro do contrato sai junto com o contrato.");
  await escrever("centro.excluir", { id: centro.id });
}

export type ClienteForm = {
  nome: string;
  documento: string;
  email: string;
  logradouro: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  complemento: string;
};

export function clienteVazio(): ClienteForm {
  return {
    nome: "",
    documento: "",
    email: "",
    logradouro: "",
    numero: "",
    bairro: "",
    cidade: "",
    uf: "",
    cep: "",
    complemento: "",
  };
}

export async function salvarCliente(id: string | null, form: ClienteForm): Promise<void> {
  normalizarCliente(form);
  await escrever("cliente.salvar", { ...form, id });
}

export async function excluirCliente(id: string): Promise<void> {
  await escrever("cliente.excluir", { id });
}

export type ClienteItem = ClienteForm & { id: string };

export type ContatoItem = { id: string; clienteId: string; nome: string; email: string };

export async function listarContatos(clienteId: string): Promise<ContatoItem[]> {
  const corpo = await escrever("contato.listar", { clienteId });
  return (corpo.contatos ?? []).map((contato) => ({
    id: contato.id,
    clienteId: contato.clienteId,
    nome: contato.nome ?? "",
    email: contato.email ?? "",
  }));
}

export async function salvarContato(contato: { id: string | null; clienteId: string; nome: string; email: string }): Promise<void> {
  await escrever("contato.salvar", contato);
}

export async function excluirContato(id: string): Promise<void> {
  await escrever("contato.excluir", { id });
}

export async function listarClientes(): Promise<ClienteItem[]> {
  const corpo = await escrever("cliente.listar", {});
  return (corpo.clientes ?? []).map((cliente) => ({
    id: cliente.id,
    nome: cliente.nome ?? "",
    documento: cliente.documento ?? "",
    email: cliente.email ?? "",
    logradouro: cliente.logradouro ?? "",
    numero: cliente.numero ?? "",
    bairro: cliente.bairro ?? "",
    cidade: cliente.cidade ?? "",
    uf: cliente.uf ?? "",
    cep: cliente.cep ?? "",
    complemento: cliente.complemento ?? "",
  }));
}

export type ClienteOpcao = { id: string; nome: string; documento: string | null };

export async function listarClientesFinanceiros(): Promise<ClienteOpcao[]> {
  const clientes = await listarClientes();
  return clientes.map((cliente) => ({ id: cliente.id, nome: cliente.nome, documento: cliente.documento }));
}

export type DespesaItem = {
  id: string;
  tipo: "operacional" | "financeira";
  categoria: string;
  descricao: string;
  favorecidoNome: string;
  favorecidoDocumento: string;
  valor: Cents;
  competencia: string;
  centroId: string;
  centroNome: string;
  tipoCentro: CentroTipo;
  contaId: string | null;
  contaStatus: ContaPagarStatus;
  vencimento: string | null;
  dataPagamento: string | null;
  cancelada: boolean;
};

export async function listarDespesas(): Promise<DespesaItem[]> {
  const data = await ler<any>(
    banco()
      .from("erp_despesas")
      .select("*, erp_centros_custo(nome, tipo), erp_contas_pagar(id, status, vencimento, data_pagamento)")
      .order("competencia", { ascending: false }),
  );
  return data.map((row) => {
    const centro = um<{ nome: string; tipo: CentroTipo }>(row.erp_centros_custo);
    const conta = um<{ id: string; status: ContaPagarStatus; vencimento: string; data_pagamento: string | null }>(row.erp_contas_pagar);
    return {
      id: row.id,
      tipo: row.tipo,
      categoria: row.categoria,
      descricao: row.descricao,
      favorecidoNome: row.favorecido_nome,
      favorecidoDocumento: row.favorecido_documento ?? "",
      valor: cents(row.valor),
      competencia: dia(row.competencia),
      centroId: row.centro_custo_id,
      centroNome: centro?.nome ?? "Centro",
      tipoCentro: centro?.tipo ?? "indireto",
      contaId: conta?.id ?? null,
      contaStatus: conta?.status ?? "a_pagar",
      vencimento: conta ? dia(conta.vencimento) : null,
      dataPagamento: diaOu(conta?.data_pagamento),
      cancelada: conta?.status === "cancelada",
    };
  });
}

export async function criarDespesa(input: {
  tipo: "operacional" | "financeira";
  categoria: string;
  descricao: string;
  favorecidoNome: string;
  favorecidoDocumento: string;
  valor: string;
  competencia: string;
  vencimento: string;
  centroId: string;
  tipoCentro: CentroTipo;
}): Promise<void> {
  validarDespesa(input);
  await escrever("despesa.salvar", input);
}

export async function salvarDespesa(
  id: string,
  input: {
    tipo: "operacional" | "financeira";
    categoria: string;
    descricao: string;
    favorecidoNome: string;
    favorecidoDocumento: string;
    valor: string;
    competencia: string;
    vencimento: string;
    centroId: string;
    tipoCentro: CentroTipo;
  },
): Promise<void> {
  validarDespesa(input);
  await escrever("despesa.salvar", { ...input, id });
}

export async function pagarConta(contaId: string, status: ContaPagarStatus, data: string): Promise<void> {
  pagarDespesa(status, data);
  await escrever("despesa.pagar", { contaId, data });
}

export async function cancelarConta(contaId: string, status: ContaPagarStatus): Promise<void> {
  cancelarDespesa(status);
  await escrever("despesa.cancelar", { contaId });
}

export async function excluirDespesa(id: string, status: ContaPagarStatus): Promise<void> {
  if (status === "paga") throw new DomainError("Conta paga não pode ser excluída.");
  await escrever("despesa.excluir", { id });
}

export type Colaborador = { id: string; nome: string; ativo: boolean };

export async function listarColaboradores(): Promise<Colaborador[]> {
  const data = await ler<any>(banco().from("erp_colaboradores").select("*").order("nome"));
  return data.map((row) => ({ id: row.id, nome: row.nome, ativo: row.ativo }));
}

export async function criarColaborador(nome: string): Promise<void> {
  if (!nome.trim()) throw new DomainError("Informe o nome do colaborador.");
  await escrever("colaborador.criar", { nome });
}

export async function renomearColaborador(id: string, nome: string): Promise<void> {
  if (!nome.trim()) throw new DomainError("Informe o nome do colaborador.");
  await escrever("colaborador.renomear", { id, nome });
}

export async function alternarColaborador(id: string, ativo: boolean): Promise<void> {
  await escrever("colaborador.alternar", { id, ativo });
}

export async function excluirColaborador(id: string): Promise<void> {
  await escrever("colaborador.excluir", { id });
}

export type CustoDetalhe = {
  id: string;
  salario: Cents;
  encargos: Cents;
  beneficios: Cents;
  total: Cents;
  status: CustoStatus;
  linhas: { centroId: string; percentual: string }[];
};

export async function obterCusto(colaboradorId: string, competencia: string): Promise<CustoDetalhe | null> {
  const mes = validarCusto({ salario: "0", encargos: "0", beneficios: "0", competencia }).competencia;
  const data = await ler<any>(
    banco()
      .from("erp_custos_pessoal")
      .select("*, erp_rateios(centro_custo_id, percentual)")
      .eq("colaborador_id", colaboradorId)
      .eq("competencia", mes),
  );
  const row = data[0];
  if (!row) return null;
  const salario = cents(row.salario);
  const encargos = cents(row.encargos);
  const beneficios = cents(row.beneficios);
  const linhas = (Array.isArray(row.erp_rateios) ? row.erp_rateios : []).map((linha: any) => ({
    centroId: linha.centro_custo_id as string,
    percentual: percentualTexto(linha.percentual),
  }));
  return { id: row.id, salario, encargos, beneficios, total: salario + encargos + beneficios, status: row.status, linhas };
}

export async function salvarCusto(input: {
  id: string | null;
  colaboradorId: string;
  competencia: string;
  salario: string;
  encargos: string;
  beneficios: string;
  status: CustoStatus | null;
}): Promise<string> {
  if (input.status) assertCustoEditavel(input.status);
  validarCusto(input);
  const resultado = await escrever("custo.salvar", input);
  return exigirId(resultado, "Não foi possível gravar o custo.");
}

export async function excluirCusto(id: string, status: CustoStatus): Promise<void> {
  if (status === "fechado") throw new DomainError("Custo de pessoal fechado não pode ser excluído.");
  await escrever("custo.excluir", { id });
}

export async function salvarRateio(input: {
  custoId: string;
  status: CustoStatus;
  total: Cents;
  linhas: { centroId: string; tipoCentro: CentroTipo; percentual: string }[];
  fechar: boolean;
}): Promise<void> {
  assertCustoEditavel(input.status);
  if (input.fechar) fecharRateio(input.linhas, input.total);
  else if (input.linhas.some((linha) => linha.tipoCentro === "financeiro" || !linha.centroId)) {
    throw new DomainError("O rateio só aceita centro de contrato ou indireto.");
  }
  await escrever("custo.rateio", input);
}

export type PropostaItem = {
  id: string;
  clienteId: string;
  clienteNome: string;
  numero: string;
  versao: number;
  status: PropostaStatus;
  titulo: string;
  visaoGeral: string;
  escopo: string;
  responsabilidades: string;
  prazo: string;
  execucao: string;
  validade: string;
  formaPagamento: string;
  adicionais: ValoresAdicionaisForm;
  agenda: AgendaPagamento | null;
  valor: Cents;
  inicio: string | null;
  fim: string | null;
  enviadaEm: string | null;
  aceitaEm: string | null;
  contratoId: string | null;
};

function mapProposta(row: any): PropostaItem {
  const cliente = um<{ name: string }>(row.clients);
  const contrato = um<{ id: string }>(row.erp_contratos);
  return {
    id: row.id,
    clienteId: row.cliente_id,
    clienteNome: cliente?.name ?? "",
    numero: row.numero,
    versao: row.versao,
    status: row.status,
    titulo: row.titulo ?? "",
    visaoGeral: row.visao_geral ?? "",
    escopo: row.escopo ?? "",
    responsabilidades: row.responsabilidades ?? "",
    prazo: row.prazo ?? "",
    execucao: row.execucao ?? "",
    validade: validadeNoFormulario(row.validade),
    formaPagamento: row.forma_pagamento ?? "",
    adicionais: adicionaisNoFormulario(adicionaisDeJson(row.valores_adicionais)),
    agenda: agendaDeJson(row.agenda_pagamento),
    valor: cents(row.valor_total),
    inicio: diaOu(row.inicio_sugerido),
    fim: diaOu(row.fim_sugerido),
    enviadaEm: row.enviada_em,
    aceitaEm: row.aceita_em,
    contratoId: contrato?.id ?? null,
  };
}

export async function listarPropostas(): Promise<PropostaItem[]> {
  const data = await ler<any>(
    banco().from("erp_propostas").select("*, clients(name), erp_contratos(id)").order("numero", { ascending: false }).order("versao", { ascending: false }),
  );
  return data.map(mapProposta);
}

export async function obterProposta(id: string): Promise<PropostaItem | null> {
  const data = await ler<any>(banco().from("erp_propostas").select("*, clients(name), erp_contratos(id)").eq("id", id));
  return data[0] ? mapProposta(data[0]) : null;
}

export type PropostaFormulario = TextosProposta & {
  clienteId: string;
  valor: string;
  inicio: string;
  fim: string;
  quantidade: string;
  modoParcelas: ModoParcelas;
  intervaloDias: string;
  primeiroVencimento: string;
  vencimentos: string[];
  adicionais: ValoresAdicionaisForm;
};

export function formularioPropostaVazio(): PropostaFormulario {
  return {
    clienteId: "",
    titulo: "",
    visaoGeral: "",
    escopo: "",
    responsabilidades: "",
    prazo: "",
    execucao: "",
    validade: "",
    formaPagamento: "",
    valor: "",
    inicio: "",
    fim: "",
    quantidade: "",
    modoParcelas: "datas",
    intervaloDias: "",
    primeiroVencimento: "",
    vencimentos: [],
    adicionais: valoresAdicionaisVazios(),
  };
}

export async function criarProposta(input: PropostaFormulario): Promise<string> {
  validarProposta(input);
  return exigirId(await escrever("proposta.criar", input), "Não foi possível criar a proposta.");
}

export async function salvarProposta(proposta: PropostaItem, input: PropostaFormulario): Promise<void> {
  assertPropostaEditavel(proposta.status);
  validarProposta(input);
  await escrever("proposta.salvar", { ...input, id: proposta.id });
}

export async function mudarProposta(proposta: PropostaItem, acao: "enviar" | "aceitar" | "recusar" | "expirar"): Promise<string | undefined> {
  transicionarProposta(proposta.status, acao);
  if (acao === "aceitar") {
    assertPodeAceitar(proposta.valor);
    const soma = (proposta.agenda?.parcelas ?? []).reduce((total, parcela) => total + parcela.valor, 0);
    if (!proposta.agenda || soma !== proposta.valor) {
      throw new DomainError("A proposta aceita precisa das parcelas somando o valor total.");
    }
  }
  const corpo = await escrever("proposta.mudar", { id: proposta.id, acao });
  return corpo.aviso;
}

export async function criarVersao(proposta: PropostaItem, existeRascunho: boolean): Promise<string> {
  novaVersao(proposta.status, proposta.versao, existeRascunho);
  return exigirId(await escrever("proposta.versao", { id: proposta.id }), "Não foi possível criar a versão.");
}

export async function excluirProposta(proposta: PropostaItem): Promise<void> {
  if (proposta.contratoId) throw new DomainError("A proposta já tem contrato e não pode ser excluída.");
  await escrever("proposta.excluir", { id: proposta.id });
}

export async function criarContratoDaProposta(proposta: PropostaItem): Promise<string> {
  if (proposta.status !== "aceita") throw new DomainError("Contrato nasce de uma proposta aceita.");
  if (proposta.contratoId) throw new DomainError("Uma versão aceita gera no máximo um contrato.");
  return exigirId(await escrever("contrato.criar", { propostaId: proposta.id }), "Não foi possível criar o contrato.");
}

export type ContratoItem = {
  id: string;
  propostaId: string;
  numero: string;
  versao: number;
  clienteId: string;
  clienteNome: string;
  centroId: string | null;
  centroNome: string | null;
  status: ContratoStatus;
  valor: Cents;
  inicio: string | null;
  fim: string | null;
  texto: string;
};

export type TituloItem = {
  id: string;
  descricao: string;
  valor: Cents;
  vencimento: string;
  competencia: string;
  status: TituloStatus;
  valorRecebido: Cents | null;
  dataRecebimento: string | null;
  meio: MeioRecebimento | null;
  origem: string | null;
  clienteId: string | null;
  clienteNome: string | null;
  formaRecebimento: "boleto" | "pix" | "transferencia" | "outro" | null;
  numeroNf: string | null;
  tipoVencimento: "data_fixa" | "prazo_dias" | null;
  prazoDias: number | null;
  parcela: number | null;
  quantidadeParcelas: number | null;
  propostaId: string | null;
  contratoId: string | null;
  banco: string | null;
  centroId: string | null;
  centroPadraoId: string | null;
  nfse: {
    id: string;
    numero: string;
    valor: Cents;
    vencimento: string;
    dataEmissao: string;
    status: NfseStatus;
    codigo: string | null;
  } | null;
  boleto: {
    id: string;
    numero: string;
    valor: Cents;
    vencimento: string;
    status: BoletoStatus;
    meio: MeioBoleto | null;
    linha: string | null;
  } | null;
};

function mapTitulo(row: any): TituloItem {
  const nfse = um<any>(row.erp_nfse);
  const boleto = um<any>(row.erp_boletos);
  const contrato = um<{ status: string; centro_custo_id: string | null }>(row.erp_contratos);
  const centroId = typeof row.centro_custo_id === "string" ? row.centro_custo_id : null;
  const centroPadraoId = centroId == null && contrato?.status === "vigente" && typeof contrato.centro_custo_id === "string" ? contrato.centro_custo_id : null;
  return {
    id: row.id,
    descricao: row.descricao,
    valor: cents(row.valor),
    vencimento: dia(row.vencimento),
    competencia: dia(row.competencia),
    status: row.status,
    valorRecebido: row.valor_recebido == null ? null : cents(row.valor_recebido),
    dataRecebimento: diaOu(row.data_recebimento),
    meio: row.meio_recebimento,
    origem: typeof row.origem === "string" ? row.origem : null,
    clienteId: typeof row.cliente_id === "string" ? row.cliente_id : null,
    clienteNome: um<{ name: string }>(row.clients)?.name ?? null,
    formaRecebimento: row.forma_recebimento === "boleto" || row.forma_recebimento === "pix" || row.forma_recebimento === "transferencia" || row.forma_recebimento === "outro" ? row.forma_recebimento : null,
    numeroNf: typeof row.numero_nf === "string" ? row.numero_nf : null,
    tipoVencimento: row.tipo_vencimento === "prazo_dias" ? "prazo_dias" : row.tipo_vencimento === "data_fixa" ? "data_fixa" : null,
    prazoDias: typeof row.prazo_dias === "number" ? row.prazo_dias : null,
    parcela: typeof row.parcela === "number" ? row.parcela : null,
    quantidadeParcelas: typeof row.quantidade_parcelas === "number" ? row.quantidade_parcelas : null,
    propostaId: typeof row.proposta_id === "string" ? row.proposta_id : null,
    contratoId: typeof row.contrato_id === "string" ? row.contrato_id : null,
    banco: typeof row.banco === "string" ? row.banco : null,
    centroId,
    centroPadraoId,
    nfse: nfse
      ? {
          id: nfse.id,
          numero: nfse.numero,
          valor: cents(nfse.valor),
          vencimento: dia(nfse.vencimento),
          dataEmissao: dia(nfse.data_emissao),
          status: nfse.status,
          codigo: nfse.codigo_verificacao,
        }
      : null,
    boleto: boleto
      ? {
          id: boleto.id,
          numero: boleto.numero,
          valor: cents(boleto.valor),
          vencimento: dia(boleto.vencimento),
          status: boleto.status,
          meio: boleto.meio,
          linha: boleto.linha_digitavel,
        }
      : null,
  };
}

function mapContrato(row: any): ContratoItem {
  const proposta = um<{ numero: string; versao: number }>(row.erp_propostas);
  const cliente = um<{ name: string }>(row.clients);
  const centro = um<{ nome: string }>(row.centro);
  return {
    id: row.id,
    propostaId: row.proposta_id,
    numero: proposta?.numero ?? "",
    versao: proposta?.versao ?? 1,
    clienteId: row.cliente_id,
    clienteNome: cliente?.name ?? "",
    centroId: row.centro_custo_id,
    centroNome: centro?.nome ?? null,
    status: row.status,
    valor: cents(row.valor_contratado),
    inicio: diaOu(row.inicio),
    fim: diaOu(row.fim),
    texto: row.texto ?? "",
  };
}

const CONTRATO_SELECT =
  "*, erp_propostas(numero, versao), clients(name), centro:erp_centros_custo!erp_contratos_centro_custo_id_fkey(nome)";

export async function listarContratos(): Promise<ContratoItem[]> {
  const data = await ler<any>(banco().from("erp_contratos").select(CONTRATO_SELECT).order("created_at", { ascending: false }));
  return data.map(mapContrato);
}

export async function obterContrato(id: string): Promise<{ contrato: ContratoItem; titulos: TituloItem[] } | null> {
  const data = await ler<any>(banco().from("erp_contratos").select(CONTRATO_SELECT).eq("id", id));
  if (!data[0]) return null;
  const titulos = await ler<any>(
    banco()
      .from("erp_contas_receber")
      .select("*, clients(name), erp_nfse(*), erp_boletos(*), erp_contratos(status, centro_custo_id)")
      .eq("contrato_id", id)
      .order("vencimento"),
  );
  return { contrato: mapContrato(data[0]), titulos: titulos.map(mapTitulo) };
}

export async function salvarVigencia(contrato: ContratoItem, inicio: string, fim: string, texto: string): Promise<void> {
  if (contrato.status !== "rascunho") throw new DomainError("Vigência e texto só mudam no rascunho.");
  assertVigencia(inicio || null, fim || null);
  await escrever("contrato.vigencia", { id: contrato.id, inicio, fim, texto });
}

export async function vigorarContrato(contrato: ContratoItem, inicio: string, fim: string, texto: string): Promise<void> {
  assertVigencia(inicio || null, fim || null);
  if (!inicio) throw new DomainError("Informe o início da vigência.");
  if (contrato.status !== "rascunho") throw new DomainError("Só contrato em rascunho fica vigente.");
  await escrever("contrato.vigorar", { id: contrato.id, inicio, fim, texto });
}

export async function encerrar(contrato: ContratoItem): Promise<void> {
  encerrarContrato(contrato.status);
  await escrever("contrato.encerrar", { id: contrato.id });
}

export async function cancelarContratoAtual(contrato: ContratoItem, titulos: TituloItem[]): Promise<void> {
  cancelarContrato(
    contrato.status,
    titulos.map((titulo) => ({
      id: titulo.id,
      status: titulo.status,
      nfse: titulo.nfse?.status ?? "ausente",
      boleto: titulo.boleto?.status ?? "ausente",
    })),
  );
  await escrever("contrato.cancelar", { id: contrato.id });
}

export async function excluirContrato(contrato: ContratoItem): Promise<void> {
  await escrever("contrato.excluir", { id: contrato.id });
}

export async function criarTitulo(
  contrato: ContratoItem,
  input: { descricao: string; valor: string; vencimento: string; competencia: string },
): Promise<void> {
  novoTitulo({ contratoStatus: contrato.status, ...input });
  await escrever("titulo.criar", { contratoId: contrato.id, ...input });
}

export async function atualizarTitulo(
  titulo: TituloItem,
  input: {
    descricao: string;
    valor: string;
    vencimento: string;
    competencia: string;
    origem?: string;
    clienteId?: string;
    forma: string;
    numeroNf: string;
    tipoVencimento: string;
    prazoDias: string;
    banco: string;
    centroId: string;
  },
): Promise<void> {
  editarTituloPrevisto(titulo.status, input);
  validarRecebimentoTitulo(input);
  validarCentroTitulo(input.centroId);
  if (input.origem != null) validarTituloAvulso({ ...input, origem: input.origem });
  await escrever("titulo.salvar", { id: titulo.id, ...input });
}

export async function preencherTitulosVazios(
  ids: string[],
  entrada: {
    centroId: string;
    forma: string;
    banco: string;
    numeroNf: string;
    tipoVencimento: string;
    prazoDias: string;
    competencia: string;
  },
): Promise<{ atualizados: number; ignorados: number; semVazio: number }> {
  const corpo = await escrever("titulo.preencherVazios", { ids, ...entrada });
  return {
    atualizados: corpo.atualizados ?? 0,
    ignorados: corpo.ignorados ?? 0,
    semVazio: corpo.semVazio ?? 0,
  };
}

export async function listarTitulos(): Promise<TituloItem[]> {
  const corpo = await escrever("titulo.listar", {});
  return (corpo.titulos ?? []).map(mapTitulo);
}

export async function obterTitulo(id: string): Promise<TituloItem> {
  const corpo = await escrever("titulo.obter", { id });
  const row = corpo.titulos?.[0];
  if (!row) throw new DomainError("Título não encontrado.");
  return mapTitulo(row);
}

export async function listarTitulosDaProposta(propostaId: string): Promise<TituloItem[]> {
  const corpo = await escrever("titulo.listarProposta", { propostaId });
  return (corpo.titulos ?? []).map(mapTitulo);
}

export async function listarTitulosAvulsos(): Promise<TituloItem[]> {
  const corpo = await escrever("titulo.listarAvulsos", {});
  return (corpo.titulos ?? []).map(mapTitulo);
}

export async function criarTituloAvulso(input: {
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
}): Promise<void> {
  montarTitulosAvulsos(input);
  await escrever("titulo.avulso", input);
}

export async function faturar(titulo: TituloItem): Promise<void> {
  faturarTitulo(titulo.status);
  await escrever("titulo.faturar", { id: titulo.id });
}

export async function cancelarTitulo(titulo: TituloItem): Promise<void> {
  podeCancelarTitulo({
    id: titulo.id,
    status: titulo.status,
    nfse: titulo.nfse?.status ?? "ausente",
    boleto: titulo.boleto?.status ?? "ausente",
  });
  await escrever("titulo.cancelar", { id: titulo.id });
}

export async function excluirTitulo(titulo: TituloItem): Promise<void> {
  if (titulo.status !== "previsto" || titulo.nfse || titulo.boleto) {
    throw new DomainError("Só um título previsto, sem NFS-e e sem boleto, pode ser excluído.");
  }
  await escrever("titulo.excluir", { id: titulo.id });
}

export async function gravarNfse(
  titulo: TituloItem,
  input: { numero: string; valor: string; vencimento: string; dataEmissao: string; codigo: string },
): Promise<void> {
  registrarNfse({
    tituloStatus: titulo.status,
    jaInformada: titulo.nfse?.status === "informada",
    numero: input.numero,
    valor: input.valor,
    vencimento: input.vencimento,
    dataEmissao: input.dataEmissao,
  });
  await escrever("nfse.salvar", { tituloId: titulo.id, ...input });
}

export async function anularNfse(titulo: TituloItem): Promise<void> {
  cancelarNfse(titulo.nfse?.status ?? "ausente");
  await escrever("nfse.anular", { tituloId: titulo.id });
}

export async function gravarBoleto(
  titulo: TituloItem,
  input: { numero: string; valor: string; vencimento: string; status: "aberto" | "atrasado"; meio: MeioBoleto; linha: string },
): Promise<void> {
  registrarBoleto({
    tituloStatus: titulo.status,
    jaTem: Boolean(titulo.boleto),
    numero: input.numero,
    valor: input.valor,
    vencimento: input.vencimento,
    status: input.status,
    meio: input.meio,
    linhaDigitavel: input.linha,
  });
  await escrever("boleto.salvar", { tituloId: titulo.id, ...input });
}

export async function atualizarBoleto(titulo: TituloItem, status: "aberto" | "atrasado" | "cancelado"): Promise<void> {
  if (!titulo.boleto) throw new DomainError("O título não tem boleto.");
  mudarBoleto(titulo.boleto.status, status);
  await escrever("boleto.status", { id: titulo.boleto.id, status });
}

export async function quitarBoleto(titulo: TituloItem, input: { valor: string; data: string; meio: MeioBoleto }): Promise<void> {
  if (!titulo.boleto) throw new DomainError("O título não tem boleto.");
  pagarBoleto({
    tituloStatus: titulo.status,
    boletoStatus: titulo.boleto.status,
    valor: input.valor,
    data: input.data,
    meio: input.meio,
  });
  await escrever("boleto.quitar", { id: titulo.boleto.id, ...input });
}

export async function quitarManual(titulo: TituloItem, input: { valor: string; data: string; meio: MeioRecebimento }): Promise<void> {
  baixaManual({
    tituloStatus: titulo.status,
    boleto: titulo.boleto?.status ?? "ausente",
    valor: input.valor,
    data: input.data,
    meio: input.meio,
  });
  await escrever("titulo.baixa", { id: titulo.id, ...input });
}

export async function carregarFluxo(de: string, ate: string) {
  const titulos = await ler<any>(banco().from("erp_contas_receber").select("descricao, status, valor, vencimento, valor_recebido, data_recebimento"));
  const contas = await ler<any>(banco().from("erp_contas_pagar").select("status, valor, vencimento, data_pagamento, erp_despesas(descricao)"));
  const movimentos = filtrarPeriodo(
    montarFluxo({
      titulos: titulos.map((row) => ({
        descricao: row.descricao,
        status: row.status,
        valor: cents(row.valor),
        vencimento: dia(row.vencimento),
        valorRecebido: row.valor_recebido == null ? null : cents(row.valor_recebido),
        dataRecebimento: diaOu(row.data_recebimento),
      })),
      contas: contas.map((row) => ({
        descricao: um<{ descricao: string }>(row.erp_despesas)?.descricao ?? "Conta a pagar",
        status: row.status,
        valor: cents(row.valor),
        vencimento: dia(row.vencimento),
        dataPagamento: diaOu(row.data_pagamento),
      })),
    }),
    de,
    ate,
  );
  return { movimentos, totais: somarFluxo(movimentos) };
}

export type LinhaMargem = {
  chave: string;
  nome: string;
  receita: Cents;
  pessoal: Cents;
  operacional: Cents;
  margem: Cents;
};

export async function carregarMargem(inicio: string, fim: string) {
  const [contratos, centros, titulos, custos, despesas] = await Promise.all([
    ler<any>(banco().from("erp_contratos").select("id, status, centro_custo_id, erp_propostas(numero, versao), clients(name)")),
    ler<any>(banco().from("erp_centros_custo").select("id, nome, tipo")),
    ler<any>(banco().from("erp_contas_receber").select("id, centro_custo_id, contrato_id, status, valor, valor_recebido, vencimento, data_recebimento")),
    ler<any>(banco().from("erp_custos_pessoal").select("competencia, salario, encargos, beneficios, status, erp_rateios(centro_custo_id, percentual)").eq("status", "fechado")),
    ler<any>(banco().from("erp_despesas").select("centro_custo_id, competencia, tipo, valor, erp_contas_pagar(status)")),
  ]);
  const pessoal = custos.flatMap((custo) => {
    const total = cents(custo.salario) + cents(custo.encargos) + cents(custo.beneficios);
    const linhas = Array.isArray(custo.erp_rateios) ? custo.erp_rateios : [];
    return linhas.map((linha: any) => ({
      centroId: linha.centro_custo_id as string,
      competencia: dia(custo.competencia),
      valor: valorRateado(total, percentToBp(linha.percentual)),
    }));
  });
  const despesasNorma = despesas.map((row) => ({
    centroId: row.centro_custo_id as string,
    competencia: dia(row.competencia),
    tipo: row.tipo as "operacional" | "financeira",
    valor: cents(row.valor),
    cancelada: um<{ status: string }>(row.erp_contas_pagar)?.status === "cancelada",
  }));
  const titulosNorma = titulos.map((row) => ({
    id: String(row.id),
    centroId: typeof row.centro_custo_id === "string" ? row.centro_custo_id : null,
    contratoId: typeof row.contrato_id === "string" ? row.contrato_id : null,
    status: row.status as TituloStatus,
    valor: cents(row.valor),
    valorRecebido: row.valor_recebido == null ? null : cents(row.valor_recebido),
    vencimento: diaOu(row.vencimento) ?? "",
    dataRecebimento: diaOu(row.data_recebimento),
  }));
  const indiretos = centros.filter((centro) => centro.tipo === "indireto");
  const nomes = new Map<string, string>(centros.map((centro) => [centro.id as string, centro.nome as string]));
  const painel = comporMargem({
    inicio,
    fim,
    contratos: contratos.map((contrato) => ({
      id: contrato.id as string,
      centroId: typeof contrato.centro_custo_id === "string" ? contrato.centro_custo_id : null,
    })),
    centrosIndiretos: indiretos.map((centro) => centro.id as string),
    titulos: titulosNorma,
    pessoal,
    despesas: despesasNorma,
  });
  const porId = new Map(contratos.map((contrato) => [contrato.id as string, contrato]));
  const contratosLinha: LinhaMargem[] = painel.contratos.map((linha) => {
    const contrato = porId.get(linha.id);
    const proposta = um<{ numero: string; versao: number }>(contrato?.erp_propostas);
    const cliente = um<{ name: string }>(contrato?.clients);
    return {
      chave: linha.id,
      nome: `${proposta?.numero ?? "Contrato"} v${proposta?.versao ?? 1} · ${cliente?.name ?? ""}`,
      receita: linha.receita,
      pessoal: linha.pessoal,
      operacional: linha.operacional,
      margem: linha.margem,
    };
  });
  const overhead: LinhaMargem[] = painel.overhead.map((linha) => ({
    chave: linha.centroId,
    nome: nomes.get(linha.centroId) ?? "Centro indireto",
    receita: linha.receita,
    pessoal: linha.pessoal,
    operacional: linha.operacional,
    margem: linha.margem,
  }));
  const avulsos: LinhaMargem[] = painel.avulsos
    .map((linha) => ({
      chave: linha.centroId ?? "sem-centro",
      nome: linha.centroId ? (nomes.get(linha.centroId) ?? "Centro") : "Títulos sem centro",
      receita: linha.receita,
      pessoal: 0,
      operacional: 0,
      margem: linha.receita,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return {
    contratos: contratosLinha,
    overhead,
    avulsos,
    despesaFinanceira: painel.despesaFinanceira,
    receitaJuros: painel.receitaJuros,
  };
}

export function obterPainelAssinatura(tipo: TipoDocumentoAssinatura, documentoId: string): Promise<PainelAssinaturaDados | null> {
  return escrever("assinatura.painel", { tipo, documentoId }).then((corpo) => corpo.painel ?? null);
}

export function enviarAssinatura(tipo: TipoDocumentoAssinatura, documentoId: string, contatoIds: string[]): Promise<{ id?: string; painel?: PainelAssinaturaDados | null; aviso?: string }> {
  return escrever("assinatura.enviar", { tipo, documentoId, contatoIds });
}

export function reenviarAssinatura(tipo: TipoDocumentoAssinatura, documentoId: string): Promise<{ painel?: PainelAssinaturaDados | null; aviso?: string }> {
  return escrever("assinatura.reenviar", { tipo, documentoId });
}

export function incluirContatoAssinatura(
  tipo: TipoDocumentoAssinatura,
  documentoId: string,
  contatoId: string,
): Promise<{ painel?: PainelAssinaturaDados | null; aviso?: string; vez?: boolean }> {
  return escrever("assinatura.incluirContato", { tipo, documentoId, contatoId });
}
