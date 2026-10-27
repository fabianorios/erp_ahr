import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DomainError,
  adicionaisParaJson,
  valoresAdicionaisDe,
  agendaDeJson,
  agendaParaJson,
  assertCustoEditavel,
  assertPodeAceitar,
  assertPropostaEditavel,
  assertVigencia,
  baixaManual,
  cancelarContrato,
  cancelarDespesa,
  cancelarNfse,
  centsToReais,
  editarTituloPrevisto,
  encerrarContrato,
  faturarTitulo,
  fecharRateio,
  mudarBoleto,
  normalizarCliente,
  novaVersao,
  novoTitulo,
  pagarBoleto,
  pagarDespesa,
  percentToBp,
  podeCancelarTitulo,
  proximoNumero,
  reaisToCents,
  registrarBoleto,
  registrarNfse,
  transicionarProposta,
  validarCentroIndireto,
  validarCusto,
  validarDespesa,
  aplicarCamposVazios,
  montarTitulosAvulsos,
  validarCentroTitulo,
  validarOrigemTitulo,
  validarPreenchimentoGrupo,
  validarProposta,
  validarRecebimentoTitulo,
  type Cents,
  type CentroTipo,
  type ModoParcelas,
  type PropostaStatus,
} from "../src/services/erp/domain.ts";
import { validarEmailAssinatura, validarNomeAssinatura } from "../src/services/erp/assinatura.ts";

type Banco = SupabaseClient;

function falhar(error: { message: string; code?: string } | null): void {
  if (!error) return;
  const texto = error.message.replace(/^.*ERROR:\s*/i, "").trim();
  if (error.code === "23503" || /foreign key/i.test(texto)) {
    throw new DomainError("Este registro está em uso e não pode ser excluído.");
  }
  if (error.code === "23505") throw new DomainError("Este registro já existe.");
  if (/schema cache/i.test(texto) && /titulo|visao_geral|execucao|validade|valores_adicionais/.test(texto)) {
    throw new DomainError("Falta atualizar a tabela de propostas. Rode o SQL de valores da proposta.");
  }
  throw new DomainError(texto || "Não foi possível gravar.");
}

function dadosDe(dados: unknown): Record<string, unknown> {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) throw new DomainError("Dados inválidos.");
  return dados as Record<string, unknown>;
}

function texto(dados: Record<string, unknown>, chave: string): string {
  const valor = dados[chave];
  return typeof valor === "string" ? valor : "";
}

function idDe(valor: unknown, rotulo = "Registro"): string {
  const id = typeof valor === "string" ? valor : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError(`${rotulo} inválido.`);
  return id;
}

function dinheiro(cents: Cents): number {
  return Number(centsToReais(cents));
}

function aninhado(valor: unknown): { status?: string } | null {
  if (Array.isArray(valor)) return (valor[0] as { status?: string } | undefined) ?? null;
  if (valor && typeof valor === "object") return valor as { status?: string };
  return null;
}

async function contar(query: PromiseLike<{ count: number | null; error: { message: string; code?: string } | null }>): Promise<number> {
  const { count, error } = await query;
  falhar(error);
  return count ?? 0;
}

export async function executarGravacao(
  db: Banco,
  acao: string,
  bruto: unknown,
): Promise<{ id?: string; aviso?: string; clientes?: ClienteLista[]; contatos?: ContatoLista[]; titulos?: unknown[] }> {
  const dados = bruto == null ? {} : dadosDe(bruto);
  switch (acao) {
    case "cliente.listar":
      return listarClientes(db);
    case "cliente.salvar":
      return salvarCliente(db, dados);
    case "cliente.excluir":
      return excluirCliente(db, dados);
    case "contato.listar":
      return listarContatos(db, dados);
    case "contato.salvar":
      return salvarContato(db, dados);
    case "contato.excluir":
      return excluirContato(db, dados);
    case "centro.criar":
      return criarCentro(db, dados);
    case "centro.renomear":
      return renomearCentro(db, dados);
    case "centro.alternar":
      return alternarCentro(db, dados);
    case "centro.excluir":
      return excluirCentro(db, dados);
    case "despesa.salvar":
      return salvarDespesa(db, dados);
    case "despesa.pagar":
      return pagarConta(db, dados);
    case "despesa.cancelar":
      return cancelarConta(db, dados);
    case "despesa.excluir":
      return excluirDespesa(db, dados);
    case "colaborador.criar":
      return criarColaborador(db, dados);
    case "colaborador.renomear":
      return renomearColaborador(db, dados);
    case "colaborador.alternar":
      return alternarColaborador(db, dados);
    case "colaborador.excluir":
      return excluirColaborador(db, dados);
    case "custo.salvar":
      return salvarCusto(db, dados);
    case "custo.rateio":
      return salvarRateio(db, dados);
    case "custo.excluir":
      return excluirCusto(db, dados);
    case "proposta.criar":
      return criarProposta(db, dados);
    case "proposta.salvar":
      return salvarProposta(db, dados);
    case "proposta.mudar":
      return mudarProposta(db, dados);
    case "proposta.versao":
      return novaVersaoProposta(db, dados);
    case "proposta.excluir":
      return excluirProposta(db, dados);
    case "contrato.criar":
      return criarContrato(db, dados);
    case "contrato.vigencia":
      return salvarVigencia(db, dados);
    case "contrato.vigorar":
      return vigorar(db, dados);
    case "contrato.encerrar":
      return encerrar(db, dados);
    case "contrato.cancelar":
      return cancelarContratoAtual(db, dados);
    case "contrato.excluir":
      return excluirContrato(db, dados);
    case "titulo.criar":
      return criarTitulo(db, dados);
    case "titulo.avulso":
      return criarTituloAvulso(db, dados);
    case "titulo.listar":
      return listarTitulos(db);
    case "titulo.obter":
      return obterTitulo(db, dados);
    case "titulo.listarAvulsos":
      return listarTitulosAvulsos(db);
    case "titulo.listarProposta":
      return listarTitulosDaProposta(db, dados);
    case "titulo.salvar":
      return salvarTitulo(db, dados);
    case "titulo.preencherVazios":
      return preencherTitulosVazios(db, dados);
    case "titulo.faturar":
      return faturarTituloAtual(db, dados);
    case "titulo.cancelar":
      return cancelarTituloAtual(db, dados);
    case "titulo.excluir":
      return excluirTitulo(db, dados);
    case "nfse.salvar":
      return salvarNfse(db, dados);
    case "nfse.anular":
      return anularNfse(db, dados);
    case "boleto.salvar":
      return salvarBoleto(db, dados);
    case "boleto.status":
      return statusBoleto(db, dados);
    case "boleto.quitar":
      return quitarBoleto(db, dados);
    case "titulo.baixa":
      return baixaTitulo(db, dados);
    default:
      throw new DomainError("Operação não reconhecida.");
  }
}

type ClienteLista = {
  id: string;
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

async function listarClientes(db: Banco): Promise<{ clientes: ClienteLista[] }> {
  const { data, error } = await db
    .from("clients")
    .select("id, name, document, email, logradouro, numero, bairro, cidade, uf, cep, complemento")
    .order("name");
  falhar(error);
  return {
    clientes: (data ?? []).map((cliente) => ({
      id: String(cliente.id),
      nome: cliente.name ?? "",
      documento: cliente.document ?? "",
      email: cliente.email ?? "",
      logradouro: cliente.logradouro ?? "",
      numero: cliente.numero ?? "",
      bairro: cliente.bairro ?? "",
      cidade: cliente.cidade ?? "",
      uf: cliente.uf ?? "",
      cep: cliente.cep ?? "",
      complemento: cliente.complemento ?? "",
    })),
  };
}

type ContatoLista = { id: string; clienteId: string; nome: string; email: string };

const MENSAGEM_CONTATOS = "Falta criar as tabelas de contatos. Cole o SQL de contatos da assinatura no projeto do ERP.";

function contatosAusentes(error: { message: string; code?: string } | null): boolean {
  if (!error) return false;
  const texto = error.message;
  const falta = error.code === "PGRST205" || /schema cache|could not find the table|does not exist|42P01/i.test(texto);
  return falta && /erp_cliente_contatos/i.test(texto);
}

function exigirContatos(error: { message: string; code?: string } | null): void {
  if (!error) return;
  if (contatosAusentes(error)) throw new DomainError(MENSAGEM_CONTATOS);
  if (error.code === "23505") throw new DomainError("Este e-mail já está nos contatos deste cliente.");
  falhar(error);
}

async function listarContatos(db: Banco, dados: Record<string, unknown>): Promise<{ contatos: ContatoLista[] }> {
  const clienteId = idDe(dados.clienteId, "Cliente");
  const { data, error } = await db.from("erp_cliente_contatos").select("id, cliente_id, nome, email").eq("cliente_id", clienteId).order("nome");
  exigirContatos(error);
  return {
    contatos: (data ?? []).map((contato) => ({
      id: String(contato.id),
      clienteId: String(contato.cliente_id),
      nome: String(contato.nome ?? ""),
      email: String(contato.email ?? ""),
    })),
  };
}

async function salvarContato(db: Banco, dados: Record<string, unknown>): Promise<{ id: string }> {
  const clienteId = idDe(dados.clienteId, "Cliente");
  const nome = validarNomeAssinatura(dados.nome);
  const email = validarEmailAssinatura(texto(dados, "email"), "Informe o e-mail do contato.", "E-mail do contato inválido.");
  const id = dados.id == null || dados.id === "" ? null : idDe(dados.id, "Contato");
  if (id) {
    const { data, error } = await db
      .from("erp_cliente_contatos")
      .update({ nome, email, atualizado_em: new Date().toISOString() })
      .eq("id", id)
      .eq("cliente_id", clienteId)
      .select("id");
    exigirContatos(error);
    if (!data?.length) throw new DomainError("Contato não encontrado.");
    return { id };
  }
  const { data, error } = await db.from("erp_cliente_contatos").insert({ cliente_id: clienteId, nome, email }).select("id");
  exigirContatos(error);
  const criado = data?.[0]?.id;
  if (!criado) throw new DomainError("Não foi possível gravar o contato.");
  return { id: String(criado) };
}

async function excluirContato(db: Banco, dados: Record<string, unknown>): Promise<{ id: string }> {
  const id = idDe(dados.id, "Contato");
  const { data, error } = await db.from("erp_cliente_contatos").delete().eq("id", id).select("id");
  exigirContatos(error);
  if (!data?.length) throw new DomainError("Contato não encontrado.");
  return { id };
}

async function salvarCliente(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const payload = normalizarCliente(dados);
  const id = dados.id == null || dados.id === "" ? null : idDe(dados.id, "Cliente");
  if (id) {
    const { data, error } = await db.from("clients").update(payload).eq("id", id).select("id");
    falhar(error);
    if (!data?.length) throw new DomainError("Cliente não encontrado.");
    return { id };
  }
  const { data, error } = await db.from("clients").insert(payload).select("id");
  falhar(error);
  if (!data?.[0]?.id) throw new DomainError("Não foi possível gravar o cliente.");
  return { id: String(data[0].id) };
}

async function excluirCliente(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Cliente");
  const propostas = await contar(db.from("erp_propostas").select("id", { count: "exact", head: true }).eq("cliente_id", id));
  const contratos = await contar(db.from("erp_contratos").select("id", { count: "exact", head: true }).eq("cliente_id", id));
  if (propostas || contratos) throw new DomainError("O cliente tem proposta ou contrato e não pode ser excluído.");
  const { data, error } = await db.from("clients").delete().eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Cliente não encontrado.");
  return { id };
}

async function criarCentro(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const nome = validarCentroIndireto(texto(dados, "nome"));
  const { data, error } = await db.from("erp_centros_custo").insert({ nome, tipo: "indireto", ativo: true }).select("id");
  falhar(error);
  if (!data?.[0]?.id) throw new DomainError("Não foi possível criar o centro.");
  return { id: String(data[0].id) };
}

async function renomearCentro(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Centro");
  const nome = validarCentroIndireto(texto(dados, "nome"));
  const { data, error } = await db.from("erp_centros_custo").update({ nome }).eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Centro não encontrado.");
  return { id };
}

async function alternarCentro(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Centro");
  const { data: centro, error: leitura } = await db.from("erp_centros_custo").select("tipo").eq("id", id).maybeSingle();
  falhar(leitura);
  if (!centro) throw new DomainError("Centro não encontrado.");
  if (centro.tipo === "financeiro" && dados.ativo === false) throw new DomainError("O centro financeiro permanece ativo.");
  const { data, error } = await db.from("erp_centros_custo").update({ ativo: dados.ativo === true }).eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Centro não encontrado.");
  return { id };
}

async function excluirCentro(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Centro");
  const { data: centro, error } = await db.from("erp_centros_custo").select("tipo").eq("id", id).maybeSingle();
  falhar(error);
  if (!centro) throw new DomainError("Centro não encontrado.");
  if (centro.tipo === "financeiro") throw new DomainError("O centro financeiro não pode ser excluído.");
  if (centro.tipo === "contrato") throw new DomainError("O centro do contrato sai junto com o contrato.");
  const despesas = await contar(db.from("erp_despesas").select("id", { count: "exact", head: true }).eq("centro_custo_id", id));
  const rateios = await contar(db.from("erp_rateios").select("id", { count: "exact", head: true }).eq("centro_custo_id", id));
  if (despesas || rateios) throw new DomainError("O centro está em uso e não pode ser excluído.");
  const { data, error: exclusao } = await db.from("erp_centros_custo").delete().eq("id", id).select("id");
  falhar(exclusao);
  if (!data?.length) throw new DomainError("Centro não encontrado.");
  return { id };
}

function despesaEntrada(dados: Record<string, unknown>) {
  const tipo = texto(dados, "tipo");
  if (tipo !== "operacional" && tipo !== "financeira") throw new DomainError("Tipo de despesa inválido.");
  const tipoCentro = texto(dados, "tipoCentro") as CentroTipo;
  return validarDespesa({
    tipo,
    categoria: texto(dados, "categoria"),
    descricao: texto(dados, "descricao"),
    favorecidoNome: texto(dados, "favorecidoNome"),
    favorecidoDocumento: texto(dados, "favorecidoDocumento"),
    valor: texto(dados, "valor"),
    competencia: texto(dados, "competencia"),
    vencimento: texto(dados, "vencimento"),
    tipoCentro,
  });
}

async function salvarDespesa(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const despesa = despesaEntrada(dados);
  const centroId = idDe(dados.centroId, "Centro");
  const payload = {
    tipo: despesa.tipo,
    categoria: despesa.categoria,
    descricao: despesa.descricao,
    favorecido_nome: despesa.favorecidoNome,
    favorecido_documento: despesa.favorecidoDocumento,
    valor: dinheiro(despesa.valor),
    competencia: despesa.competencia,
    centro_custo_id: centroId,
  };
  const id = dados.id == null || dados.id === "" ? null : idDe(dados.id, "Despesa");
  if (!id) {
    const { data, error } = await db.rpc("erp_criar_despesa", {
      p_tipo: despesa.tipo,
      p_categoria: despesa.categoria,
      p_descricao: despesa.descricao,
      p_favorecido_nome: despesa.favorecidoNome,
      p_favorecido_documento: despesa.favorecidoDocumento ?? "",
      p_valor: dinheiro(despesa.valor),
      p_competencia: despesa.competencia,
      p_centro_custo_id: centroId,
      p_vencimento: despesa.vencimento,
    });
    falhar(error);
    if (typeof data !== "string") throw new DomainError("Não foi possível lançar a despesa.");
    return { id: data };
  }
  const { data: conta, error: leitura } = await db.from("erp_contas_pagar").select("id, status").eq("despesa_id", id).maybeSingle();
  falhar(leitura);
  if (!conta) throw new DomainError("Despesa não encontrada.");
  if (conta.status === "paga") {
    const { data, error } = await db
      .from("erp_despesas")
      .update({ descricao: despesa.descricao, favorecido_nome: despesa.favorecidoNome, favorecido_documento: despesa.favorecidoDocumento })
      .eq("id", id)
      .select("id");
    falhar(error);
    if (!data?.length) throw new DomainError("Despesa não encontrada.");
    return { id };
  }
  const { data, error } = await db.from("erp_despesas").update(payload).eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Despesa não encontrada.");
  if (conta.status === "a_pagar") {
    const { error: contaErro } = await db.from("erp_contas_pagar").update({ vencimento: despesa.vencimento }).eq("id", conta.id);
    falhar(contaErro);
  }
  return { id };
}

async function pagarConta(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.contaId, "Conta");
  const { data: conta, error: leitura } = await db.from("erp_contas_pagar").select("status").eq("id", id).maybeSingle();
  falhar(leitura);
  if (!conta) throw new DomainError("Conta não encontrada.");
  const dataPagamento = pagarDespesa(conta.status, texto(dados, "data"));
  const { data, error } = await db.from("erp_contas_pagar").update({ status: "paga", data_pagamento: dataPagamento }).eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Conta não encontrada.");
  return { id };
}

async function cancelarConta(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.contaId, "Conta");
  const { data: conta, error: leitura } = await db.from("erp_contas_pagar").select("status").eq("id", id).maybeSingle();
  falhar(leitura);
  if (!conta) throw new DomainError("Conta não encontrada.");
  cancelarDespesa(conta.status);
  const { data, error } = await db.from("erp_contas_pagar").update({ status: "cancelada" }).eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Conta não encontrada.");
  return { id };
}

async function excluirDespesa(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Despesa");
  const { data: conta, error: leitura } = await db.from("erp_contas_pagar").select("status").eq("despesa_id", id).maybeSingle();
  falhar(leitura);
  if (conta?.status === "paga") throw new DomainError("Conta paga não pode ser excluída.");
  const { data, error } = await db.from("erp_despesas").delete().eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Despesa não encontrada.");
  return { id };
}

async function criarColaborador(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const nome = texto(dados, "nome").trim();
  if (!nome) throw new DomainError("Informe o nome do colaborador.");
  const { data, error } = await db.from("erp_colaboradores").insert({ nome, ativo: true }).select("id");
  falhar(error);
  if (!data?.[0]?.id) throw new DomainError("Não foi possível cadastrar o colaborador.");
  return { id: String(data[0].id) };
}

async function renomearColaborador(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Colaborador");
  const nome = texto(dados, "nome").trim();
  if (!nome) throw new DomainError("Informe o nome do colaborador.");
  const { data, error } = await db.from("erp_colaboradores").update({ nome }).eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Colaborador não encontrado.");
  return { id };
}

async function alternarColaborador(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Colaborador");
  const { data, error } = await db.from("erp_colaboradores").update({ ativo: dados.ativo === true }).eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Colaborador não encontrado.");
  return { id };
}

async function excluirColaborador(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Colaborador");
  const { data: custos, error } = await db.from("erp_custos_pessoal").select("id, status").eq("colaborador_id", id);
  falhar(error);
  if ((custos ?? []).some((custo) => custo.status === "fechado")) {
    throw new DomainError("Colaborador com custo fechado não pode ser excluído.");
  }
  const ids = (custos ?? []).map((custo) => custo.id as string);
  if (ids.length) {
    const { error: rateioErro } = await db.from("erp_rateios").delete().in("custo_pessoal_id", ids);
    falhar(rateioErro);
    const { error: custoErro } = await db.from("erp_custos_pessoal").delete().eq("colaborador_id", id);
    falhar(custoErro);
  }
  const { data, error: exclusao } = await db.from("erp_colaboradores").delete().eq("id", id).select("id");
  falhar(exclusao);
  if (!data?.length) throw new DomainError("Colaborador não encontrado.");
  return { id };
}

async function salvarCusto(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = dados.id == null || dados.id === "" ? null : idDe(dados.id, "Custo");
  if (id) {
    const { data: atual, error: leitura } = await db.from("erp_custos_pessoal").select("status").eq("id", id).maybeSingle();
    falhar(leitura);
    if (!atual) throw new DomainError("Custo não encontrado.");
    assertCustoEditavel(atual.status);
  }
  const custo = validarCusto({
    salario: texto(dados, "salario"),
    encargos: texto(dados, "encargos"),
    beneficios: texto(dados, "beneficios"),
    competencia: texto(dados, "competencia"),
  });
  if (id) {
    const { data, error } = await db
      .from("erp_custos_pessoal")
      .update({ salario: dinheiro(custo.salario), encargos: dinheiro(custo.encargos), beneficios: dinheiro(custo.beneficios) })
      .eq("id", id)
      .select("id");
    falhar(error);
    if (!data?.length) throw new DomainError("Custo não encontrado.");
    return { id };
  }
  const { data, error } = await db
    .from("erp_custos_pessoal")
    .insert({
      colaborador_id: idDe(dados.colaboradorId, "Colaborador"),
      competencia: custo.competencia,
      salario: dinheiro(custo.salario),
      encargos: dinheiro(custo.encargos),
      beneficios: dinheiro(custo.beneficios),
      status: "rascunho",
    })
    .select("id");
  falhar(error);
  if (!data?.[0]?.id) throw new DomainError("Não foi possível gravar o custo.");
  return { id: String(data[0].id) };
}

async function salvarRateio(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const custoId = idDe(dados.custoId, "Custo");
  const { data: atual, error: leitura } = await db.from("erp_custos_pessoal").select("status, salario, encargos, beneficios").eq("id", custoId).maybeSingle();
  falhar(leitura);
  if (!atual) throw new DomainError("Custo não encontrado.");
  assertCustoEditavel(atual.status);
  const linhasBrutas = Array.isArray(dados.linhas) ? dados.linhas : [];
  const linhas = linhasBrutas.map((linha) => {
    const item = dadosDe(linha);
    const tipoCentro = texto(item, "tipoCentro") as CentroTipo;
    return { centroId: texto(item, "centroId"), tipoCentro, percentual: texto(item, "percentual") };
  });
  const total = reaisToCents(atual.salario) + reaisToCents(atual.encargos) + reaisToCents(atual.beneficios);
  if (dados.fechar === true) fecharRateio(linhas, total);
  else if (linhas.some((linha) => linha.tipoCentro === "financeiro" || !linha.centroId)) {
    throw new DomainError("O rateio só aceita centro de contrato ou indireto.");
  }
  const { error } = await db.rpc("erp_substituir_rateio", {
    p_custo_id: custoId,
    p_linhas: linhas.map((linha) => ({
      centro_custo_id: linha.centroId,
      percentual: Number(centsToReais(percentToBp(linha.percentual || "0"))),
    })),
  });
  falhar(error);
  if (dados.fechar === true) {
    const { error: fecha } = await db.from("erp_custos_pessoal").update({ status: "fechado" }).eq("id", custoId);
    falhar(fecha);
  }
  return { id: custoId };
}

async function excluirCusto(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Custo");
  const { data: atual, error: leitura } = await db.from("erp_custos_pessoal").select("status").eq("id", id).maybeSingle();
  falhar(leitura);
  if (!atual) throw new DomainError("Custo não encontrado.");
  if (atual.status === "fechado") throw new DomainError("Custo de pessoal fechado não pode ser excluído.");
  const { error: rateioErro } = await db.from("erp_rateios").delete().eq("custo_pessoal_id", id);
  falhar(rateioErro);
  const { data, error } = await db.from("erp_custos_pessoal").delete().eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Custo não encontrado.");
  return { id };
}

function formularioProposta(dados: Record<string, unknown>) {
  const modo = texto(dados, "modoParcelas");
  const modoParcelas: ModoParcelas = modo === "intervalo" ? "intervalo" : "datas";
  return {
    clienteId: texto(dados, "clienteId"),
    titulo: texto(dados, "titulo"),
    visaoGeral: texto(dados, "visaoGeral"),
    escopo: texto(dados, "escopo"),
    responsabilidades: texto(dados, "responsabilidades"),
    prazo: texto(dados, "prazo"),
    execucao: texto(dados, "execucao"),
    validade: texto(dados, "validade"),
    formaPagamento: texto(dados, "formaPagamento"),
    valor: texto(dados, "valor"),
    inicio: texto(dados, "inicio"),
    fim: texto(dados, "fim"),
    quantidade: texto(dados, "quantidade"),
    modoParcelas,
    intervaloDias: texto(dados, "intervaloDias"),
    primeiroVencimento: texto(dados, "primeiroVencimento"),
    vencimentos: Array.isArray(dados.vencimentos) ? dados.vencimentos.map((item) => String(item)) : [],
    adicionais: valoresAdicionaisDe(dados.adicionais),
  };
}

async function criarProposta(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const proposta = validarProposta(formularioProposta(dados));
  const { data: numeros, error: leitura } = await db.from("erp_propostas").select("numero");
  falhar(leitura);
  const { data, error } = await db
    .from("erp_propostas")
    .insert({
      cliente_id: texto(dados, "clienteId"),
      numero: proximoNumero((numeros ?? []).map((item) => String(item.numero))),
      versao: 1,
      status: "rascunho",
      titulo: proposta.titulo,
      visao_geral: proposta.visaoGeral,
      escopo: proposta.escopo,
      responsabilidades: proposta.responsabilidades,
      prazo: proposta.prazo,
      execucao: proposta.execucao,
      validade: proposta.validade,
      forma_pagamento: proposta.formaPagamento,
      agenda_pagamento: agendaParaJson(proposta.agenda),
      valores_adicionais: adicionaisParaJson(proposta.adicionais),
      valor_total: dinheiro(proposta.valor),
      inicio_sugerido: proposta.inicio,
      fim_sugerido: proposta.fim,
      forma_cobranca: "mista",
    })
    .select("id");
  falhar(error);
  if (!data?.[0]?.id) throw new DomainError("Não foi possível criar a proposta.");
  return { id: String(data[0].id) };
}

async function salvarProposta(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Proposta");
  const { data: atual, error: leitura } = await db.from("erp_propostas").select("status").eq("id", id).maybeSingle();
  falhar(leitura);
  if (!atual) throw new DomainError("Proposta não encontrada.");
  assertPropostaEditavel(atual.status as PropostaStatus);
  const proposta = validarProposta(formularioProposta(dados));
  const { data, error } = await db
    .from("erp_propostas")
    .update({
      cliente_id: texto(dados, "clienteId"),
      titulo: proposta.titulo,
      visao_geral: proposta.visaoGeral,
      escopo: proposta.escopo,
      responsabilidades: proposta.responsabilidades,
      prazo: proposta.prazo,
      execucao: proposta.execucao,
      validade: proposta.validade,
      forma_pagamento: proposta.formaPagamento,
      agenda_pagamento: agendaParaJson(proposta.agenda),
      valores_adicionais: adicionaisParaJson(proposta.adicionais),
      valor_total: dinheiro(proposta.valor),
      inicio_sugerido: proposta.inicio,
      fim_sugerido: proposta.fim,
    })
    .eq("id", id)
    .select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Proposta não encontrada.");
  return { id };
}

async function mudarProposta(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Proposta");
  const acao = texto(dados, "acao");
  if (acao !== "enviar" && acao !== "aceitar" && acao !== "recusar" && acao !== "expirar") {
    throw new DomainError("Ação da proposta inválida.");
  }
  const { data: atual, error: leitura } = await db.from("erp_propostas").select("status, valor_total, agenda_pagamento").eq("id", id).maybeSingle();
  falhar(leitura);
  if (!atual) throw new DomainError("Proposta não encontrada.");
  const status = transicionarProposta(atual.status as PropostaStatus, acao);
  if (acao === "aceitar") {
    const valor = reaisToCents(atual.valor_total);
    assertPodeAceitar(valor);
    const agenda = agendaDeJson(atual.agenda_pagamento);
    const soma = (agenda?.parcelas ?? []).reduce((total, parcela) => total + parcela.valor, 0);
    if (!agenda || soma !== valor) throw new DomainError("A proposta aceita precisa das parcelas somando o valor total.");
  }
  const { data, error } = await db.from("erp_propostas").update({ status }).eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Proposta não encontrada.");
  if (acao === "aceitar") {
    const gerado = await db.rpc("erp_gerar_titulos_proposta", { p_proposta_id: id });
    if (gerado.error && (gerado.error.code === "PGRST202" || /erp_gerar_titulos_proposta|schema cache/i.test(gerado.error.message))) {
      return { id, aviso: "A proposta foi aceita. As parcelas previstas entram quando o SQL de títulos previstos for aplicado." };
    }
    falhar(gerado.error);
  }
  return { id };
}

async function novaVersaoProposta(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Proposta");
  const { data: atual, error: leitura } = await db.from("erp_propostas").select("status, versao, numero").eq("id", id).maybeSingle();
  falhar(leitura);
  if (!atual) throw new DomainError("Proposta não encontrada.");
  const rascunhos = await contar(
    db.from("erp_propostas").select("id", { count: "exact", head: true }).eq("numero", atual.numero).eq("status", "rascunho"),
  );
  novaVersao(atual.status as PropostaStatus, Number(atual.versao), rascunhos > 0);
  const { data, error } = await db.rpc("erp_nova_versao", { p_id: id });
  falhar(error);
  if (typeof data !== "string") throw new DomainError("Não foi possível criar a versão.");
  return { id: data };
}

async function excluirProposta(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Proposta");
  const contratos = await contar(db.from("erp_contratos").select("id", { count: "exact", head: true }).eq("proposta_id", id));
  if (contratos) throw new DomainError("A proposta já tem contrato e não pode ser excluída.");
  const titulosDaProposta = await db.from("erp_contas_receber").select("id", { count: "exact", head: true }).eq("proposta_id", id);
  if (!titulosSemColuna(titulosDaProposta.error)) {
    falhar(titulosDaProposta.error);
    if ((titulosDaProposta.count ?? 0) > 0) throw new DomainError("A proposta tem contas a receber e não pode ser excluída.");
  }
  const { data, error } = await db.from("erp_propostas").delete().eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Proposta não encontrada.");
  return { id };
}

async function criarContrato(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const propostaId = idDe(dados.propostaId, "Proposta");
  const { data: proposta, error } = await db.from("erp_propostas").select("status").eq("id", propostaId).maybeSingle();
  falhar(error);
  if (!proposta) throw new DomainError("Proposta não encontrada.");
  if (proposta.status !== "aceita") throw new DomainError("Contrato nasce de uma proposta aceita.");
  const existentes = await contar(db.from("erp_contratos").select("id", { count: "exact", head: true }).eq("proposta_id", propostaId));
  if (existentes) throw new DomainError("Uma versão aceita gera no máximo um contrato.");
  const { data, error: rpcErro } = await db.rpc("erp_criar_contrato", { p_proposta_id: propostaId });
  falhar(rpcErro);
  if (typeof data !== "string") throw new DomainError("Não foi possível criar o contrato.");
  return { id: data };
}

async function salvarVigencia(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Contrato");
  const { data: contrato, error: leitura } = await db.from("erp_contratos").select("status").eq("id", id).maybeSingle();
  falhar(leitura);
  if (!contrato) throw new DomainError("Contrato não encontrado.");
  if (contrato.status !== "rascunho") throw new DomainError("Vigência e texto só mudam no rascunho.");
  const inicio = texto(dados, "inicio") || null;
  const fim = texto(dados, "fim") || null;
  assertVigencia(inicio, fim);
  const { data, error } = await db.from("erp_contratos").update({ inicio, fim, texto: texto(dados, "texto") }).eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Contrato não encontrado.");
  return { id };
}

async function vigorar(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Contrato");
  const { data: contrato, error: leitura } = await db.from("erp_contratos").select("status").eq("id", id).maybeSingle();
  falhar(leitura);
  if (!contrato) throw new DomainError("Contrato não encontrado.");
  const inicio = texto(dados, "inicio");
  const fim = texto(dados, "fim") || null;
  assertVigencia(inicio || null, fim);
  if (!inicio) throw new DomainError("Informe o início da vigência.");
  if (contrato.status !== "rascunho") throw new DomainError("Só contrato em rascunho fica vigente.");
  const { error } = await db.rpc("erp_vigorar_contrato", { p_id: id, p_inicio: inicio, p_fim: fim, p_texto: texto(dados, "texto") });
  falhar(error);
  return { id };
}

async function encerrar(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Contrato");
  const { data: contrato, error: leitura } = await db.from("erp_contratos").select("status").eq("id", id).maybeSingle();
  falhar(leitura);
  if (!contrato) throw new DomainError("Contrato não encontrado.");
  encerrarContrato(contrato.status);
  const { data, error } = await db.from("erp_contratos").update({ status: "encerrado" }).eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Contrato não encontrado.");
  return { id };
}

async function cancelarContratoAtual(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Contrato");
  const { data: contrato, error: leitura } = await db.from("erp_contratos").select("status").eq("id", id).maybeSingle();
  falhar(leitura);
  if (!contrato) throw new DomainError("Contrato não encontrado.");
  const { data: titulos, error } = await db.from("erp_contas_receber").select("id, status, erp_nfse(status), erp_boletos(status)").eq("contrato_id", id);
  falhar(error);
  cancelarContrato(
    contrato.status,
    (titulos ?? []).map((titulo) => ({
      id: String(titulo.id),
      status: titulo.status,
      nfse: aninhado(titulo.erp_nfse)?.status ?? "ausente",
      boleto: aninhado(titulo.erp_boletos)?.status ?? "ausente",
    })),
  );
  const { data, error: gravacao } = await db.from("erp_contratos").update({ status: "cancelado" }).eq("id", id).select("id");
  falhar(gravacao);
  if (!data?.length) throw new DomainError("Contrato não encontrado.");
  return { id };
}

async function excluirContrato(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Contrato");
  const { data: contrato, error: leitura } = await db.from("erp_contratos").select("status").eq("id", id).maybeSingle();
  falhar(leitura);
  if (!contrato) throw new DomainError("Contrato não encontrado.");
  if (contrato.status !== "rascunho") {
    throw new DomainError("Só o contrato em rascunho pode ser excluído. Vigente, encerrado e cancelado ficam no histórico.");
  }
  const titulos = await contar(db.from("erp_contas_receber").select("id", { count: "exact", head: true }).eq("contrato_id", id));
  if (titulos) throw new DomainError("Exclua as contas a receber antes do contrato.");
  const { data, error } = await db.from("erp_contratos").delete().eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Contrato não encontrado.");
  return { id };
}

const MENSAGEM_TITULOS = "Falta atualizar as contas a receber. Cole o SQL titulos-grupo.sql no projeto do ERP.";

function titulosSemColuna(error: { message: string; code?: string } | null): boolean {
  if (!error) return false;
  const texto = error.message;
  const falta = error.code === "PGRST204" || error.code === "PGRST205" || error.code === "42703" || /schema cache|could not find the|does not exist/i.test(texto);
  return falta && /proposta_id|\borigem\b|parcela|forma_recebimento|numero_nf|tipo_vencimento|prazo_dias|quantidade_parcelas|\bbanco\b/i.test(texto);
}

function exigirTitulos(error: { message: string; code?: string } | null): void {
  if (titulosSemColuna(error)) throw new DomainError(MENSAGEM_TITULOS);
  if (error && /não leva centro|nem ganha origem|entra quando o contrato fica vigente|centro da conta vêm do contrato/i.test(error.message)) {
    throw new DomainError(MENSAGEM_TITULOS);
  }
  falhar(error);
}

const TITULO_SELECT = "*, clients(name), erp_nfse(*), erp_boletos(*), erp_contratos(status, centro_custo_id)";

async function listarTitulos(db: Banco): Promise<{ titulos: unknown[] }> {
  const { data, error } = await db.from("erp_contas_receber").select(TITULO_SELECT).order("vencimento");
  exigirTitulos(error);
  return { titulos: data ?? [] };
}

async function obterTitulo(db: Banco, dados: Record<string, unknown>): Promise<{ titulos: unknown[] }> {
  const id = idDe(dados.id, "Título");
  const { data, error } = await db.from("erp_contas_receber").select(TITULO_SELECT).eq("id", id).maybeSingle();
  exigirTitulos(error);
  if (!data) throw new DomainError("Título não encontrado.");
  return { titulos: [data] };
}

async function listarTitulosAvulsos(db: Banco): Promise<{ titulos: unknown[] }> {
  const { data, error } = await db
    .from("erp_contas_receber")
    .select(TITULO_SELECT)
    .is("proposta_id", null)
    .is("contrato_id", null)
    .order("vencimento");
  exigirTitulos(error);
  return { titulos: data ?? [] };
}

async function listarTitulosDaProposta(db: Banco, dados: Record<string, unknown>): Promise<{ titulos: unknown[] }> {
  const propostaId = idDe(dados.propostaId, "Proposta");
  const { data, error } = await db
    .from("erp_contas_receber")
    .select(TITULO_SELECT)
    .eq("proposta_id", propostaId)
    .order("parcela");
  exigirTitulos(error);
  return { titulos: data ?? [] };
}

function listaTexto(dados: Record<string, unknown>, chave: string): string[] {
  const valor = dados[chave];
  if (!Array.isArray(valor)) return [];
  return valor.map((item) => (item == null ? "" : String(item)));
}

async function criarTituloAvulso(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const titulos = montarTitulosAvulsos({
    descricao: texto(dados, "descricao"),
    valor: texto(dados, "valor"),
    origem: texto(dados, "origem"),
    clienteId: texto(dados, "clienteId"),
    forma: texto(dados, "forma"),
    numeroNf: texto(dados, "numeroNf"),
    tipoVencimento: texto(dados, "tipoVencimento"),
    prazoDias: texto(dados, "prazoDias"),
    quantidade: texto(dados, "quantidade"),
    vencimentos: listaTexto(dados, "vencimentos"),
    primeiroVencimento: texto(dados, "primeiroVencimento"),
    banco: texto(dados, "banco"),
    centroId: texto(dados, "centroId"),
  });
  const centroId = validarCentroTitulo(titulos[0].centroId);
  const { data: cliente, error: clienteErro } = await db.from("clients").select("id").eq("id", titulos[0].clienteId).maybeSingle();
  falhar(clienteErro);
  if (!cliente) throw new DomainError("Informe o cliente.");
  const { data: centro, error: centroErro } = await db.from("erp_centros_custo").select("id, ativo").eq("id", centroId).maybeSingle();
  falhar(centroErro);
  if (!centro?.ativo) throw new DomainError("Informe o centro de custo.");
  const { data, error } = await db
    .from("erp_contas_receber")
    .insert(titulos.map((titulo) => ({
      cliente_id: titulo.clienteId,
      centro_custo_id: centroId,
      descricao: titulo.descricao,
      valor: dinheiro(titulo.valor),
      vencimento: titulo.vencimento,
      competencia: titulo.competencia,
      origem: titulo.origem,
      parcela: titulo.parcela,
      quantidade_parcelas: titulo.quantidade,
      forma_recebimento: titulo.forma,
      numero_nf: titulo.numeroNf,
      tipo_vencimento: titulo.tipoVencimento,
      prazo_dias: titulo.prazoDias,
      banco: titulo.banco,
      status: "previsto",
    })))
    .select("id, centro_custo_id");
  exigirTitulos(error);
  if (!data?.[0]?.id) throw new DomainError("Não foi possível abrir o título.");
  if (data.some((linha) => !linha.centro_custo_id)) {
    await db.from("erp_contas_receber").delete().in("id", data.map((linha) => linha.id));
    throw new DomainError(MENSAGEM_TITULOS);
  }
  return { id: String(data[0].id) };
}

async function criarTitulo(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const contratoId = idDe(dados.contratoId, "Contrato");
  const { data: contrato, error: leitura } = await db.from("erp_contratos").select("status, cliente_id, centro_custo_id").eq("id", contratoId).maybeSingle();
  falhar(leitura);
  if (!contrato) throw new DomainError("Contrato não encontrado.");
  const titulo = novoTitulo({
    contratoStatus: contrato.status,
    descricao: texto(dados, "descricao"),
    valor: texto(dados, "valor"),
    vencimento: texto(dados, "vencimento"),
    competencia: texto(dados, "competencia"),
  });
  const { data, error } = await db
    .from("erp_contas_receber")
    .insert({
      contrato_id: contratoId,
      cliente_id: contrato.cliente_id,
      centro_custo_id: contrato.centro_custo_id,
      descricao: titulo.descricao,
      valor: dinheiro(titulo.valor),
      vencimento: titulo.vencimento,
      competencia: titulo.competencia,
      status: "previsto",
    })
    .select("id");
  falhar(error);
  if (!data?.[0]?.id) throw new DomainError("Não foi possível abrir o título.");
  return { id: String(data[0].id) };
}

async function salvarTitulo(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Título");
  const { data: titulo, error: leitura } = await db.from("erp_contas_receber").select("status, proposta_id, contrato_id").eq("id", id).maybeSingle();
  exigirTitulos(leitura);
  if (!titulo) throw new DomainError("Título não encontrado.");
  const editado = editarTituloPrevisto(titulo.status, {
    descricao: texto(dados, "descricao"),
    valor: texto(dados, "valor"),
    vencimento: texto(dados, "vencimento"),
    competencia: texto(dados, "competencia"),
  });
  const recebimento = validarRecebimentoTitulo({
    forma: texto(dados, "forma"),
    numeroNf: texto(dados, "numeroNf"),
    tipoVencimento: texto(dados, "tipoVencimento"),
    prazoDias: texto(dados, "prazoDias"),
    banco: texto(dados, "banco"),
  });
  const centroId = validarCentroTitulo(texto(dados, "centroId"));
  const { data: centro, error: centroErro } = await db.from("erp_centros_custo").select("id, ativo").eq("id", centroId).maybeSingle();
  falhar(centroErro);
  if (!centro?.ativo) throw new DomainError("Informe o centro de custo.");
  const campos: Record<string, unknown> = {
    descricao: editado.descricao,
    valor: dinheiro(editado.valor),
    vencimento: editado.vencimento,
    competencia: editado.competencia,
    forma_recebimento: recebimento.forma,
    numero_nf: recebimento.numeroNf,
    tipo_vencimento: recebimento.tipoVencimento,
    prazo_dias: recebimento.prazoDias,
    banco: recebimento.banco,
    centro_custo_id: centroId,
  };
  if (!titulo.proposta_id && !titulo.contrato_id) {
    const clienteId = idDe(dados.clienteId, "Cliente");
    const { data: cliente, error: clienteErro } = await db.from("clients").select("id").eq("id", clienteId).maybeSingle();
    falhar(clienteErro);
    if (!cliente) throw new DomainError("Informe o cliente.");
    campos.cliente_id = clienteId;
    campos.origem = validarOrigemTitulo(texto(dados, "origem"));
  }
  const { data, error } = await db.from("erp_contas_receber").update(campos).eq("id", id).select("id");
  exigirTitulos(error);
  if (!data?.length) throw new DomainError("Título não encontrado.");
  return { id };
}

async function preencherTitulosVazios(db: Banco, dados: Record<string, unknown>): Promise<{ atualizados: number; ignorados: number; semVazio: number }> {
  const bruto = dados.ids;
  if (!Array.isArray(bruto) || bruto.length === 0) throw new DomainError("Selecione ao menos um título.");
  const ids = bruto.map((item) => idDe(item, "Título"));
  const preenchimento = validarPreenchimentoGrupo({
    centroId: texto(dados, "centroId"),
    forma: texto(dados, "forma"),
    banco: texto(dados, "banco"),
    numeroNf: texto(dados, "numeroNf"),
    tipoVencimento: texto(dados, "tipoVencimento"),
    prazoDias: texto(dados, "prazoDias"),
    competencia: texto(dados, "competencia"),
  });
  if (preenchimento.centroId) {
    const { data: centro, error: centroErro } = await db.from("erp_centros_custo").select("id, ativo").eq("id", preenchimento.centroId).maybeSingle();
    falhar(centroErro);
    if (!centro?.ativo) throw new DomainError("Informe o centro de custo.");
  }
  let atualizados = 0;
  let ignorados = 0;
  let semVazio = 0;
  for (const id of ids) {
    const { data: titulo, error } = await db
      .from("erp_contas_receber")
      .select("id, status, centro_custo_id, forma_recebimento, banco, numero_nf, tipo_vencimento, competencia, erp_nfse(id), erp_boletos(id)")
      .eq("id", id)
      .maybeSingle();
    exigirTitulos(error);
    if (!titulo) {
      ignorados += 1;
      continue;
    }
    const patch = aplicarCamposVazios(
      {
        status: String(titulo.status ?? ""),
        temNfse: Boolean(aninhado(titulo.erp_nfse)),
        temBoleto: Boolean(aninhado(titulo.erp_boletos)),
        centroId: typeof titulo.centro_custo_id === "string" ? titulo.centro_custo_id : null,
        forma: typeof titulo.forma_recebimento === "string" ? titulo.forma_recebimento : null,
        banco: typeof titulo.banco === "string" ? titulo.banco : null,
        numeroNf: typeof titulo.numero_nf === "string" ? titulo.numero_nf : null,
        tipoVencimento: typeof titulo.tipo_vencimento === "string" ? titulo.tipo_vencimento : null,
        competencia: typeof titulo.competencia === "string" ? titulo.competencia : null,
      },
      preenchimento,
    );
    if (patch === "ignorar") {
      ignorados += 1;
      continue;
    }
    if (patch === "vazio") {
      semVazio += 1;
      continue;
    }
    const { error: gravacao } = await db.from("erp_contas_receber").update(patch).eq("id", id);
    if (gravacao && /Informe o centro de custo|Informe a forma de recebimento|Informe o banco de recebimento|não leva centro|entra quando o contrato fica vigente|centro da conta vêm do contrato|nem ganha origem/i.test(gravacao.message)) {
      throw new DomainError(MENSAGEM_TITULOS);
    }
    exigirTitulos(gravacao);
    atualizados += 1;
  }
  return { atualizados, ignorados, semVazio };
}

async function faturarTituloAtual(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Título");
  const { data: titulo, error: leitura } = await db.from("erp_contas_receber").select("status").eq("id", id).maybeSingle();
  falhar(leitura);
  if (!titulo) throw new DomainError("Título não encontrado.");
  faturarTitulo(titulo.status);
  const { data, error } = await db.from("erp_contas_receber").update({ status: "faturado" }).eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Título não encontrado.");
  return { id };
}

async function documentosDoTitulo(db: Banco, id: string) {
  const { data: titulo, error } = await db.from("erp_contas_receber").select("id, status").eq("id", id).maybeSingle();
  falhar(error);
  if (!titulo) throw new DomainError("Título não encontrado.");
  const { data: nfse, error: nfseErro } = await db.from("erp_nfse").select("id, status").eq("conta_receber_id", id).maybeSingle();
  falhar(nfseErro);
  const { data: boleto, error: boletoErro } = await db.from("erp_boletos").select("id, status").eq("conta_receber_id", id).maybeSingle();
  falhar(boletoErro);
  return { titulo, nfse, boleto };
}

async function cancelarTituloAtual(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Título");
  const { titulo, nfse, boleto } = await documentosDoTitulo(db, id);
  podeCancelarTitulo({
    id,
    status: titulo.status,
    nfse: nfse?.status ?? "ausente",
    boleto: boleto?.status ?? "ausente",
  });
  const { data, error } = await db.from("erp_contas_receber").update({ status: "cancelado" }).eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Título não encontrado.");
  return { id };
}

async function excluirTitulo(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Título");
  const { titulo, nfse, boleto } = await documentosDoTitulo(db, id);
  if (titulo.status !== "previsto" || nfse || boleto) {
    throw new DomainError("Só um título previsto, sem NFS-e e sem boleto, pode ser excluído.");
  }
  const { data, error } = await db.from("erp_contas_receber").delete().eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Título não encontrado.");
  return { id };
}

async function salvarNfse(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const tituloId = idDe(dados.tituloId, "Título");
  const { titulo, nfse } = await documentosDoTitulo(db, tituloId);
  const nota = registrarNfse({
    tituloStatus: titulo.status,
    jaInformada: nfse?.status === "informada",
    numero: texto(dados, "numero"),
    valor: texto(dados, "valor"),
    vencimento: texto(dados, "vencimento"),
    dataEmissao: texto(dados, "dataEmissao"),
  });
  const payload = {
    numero: nota.numero,
    valor: dinheiro(nota.valor),
    vencimento: nota.vencimento,
    data_emissao: nota.dataEmissao,
    status: "informada",
    emissor: "manual",
    municipio: nota.municipio,
    codigo_verificacao: texto(dados, "codigo").trim() || null,
  };
  if (nfse) {
    const { data, error } = await db.from("erp_nfse").update(payload).eq("id", nfse.id).select("id");
    falhar(error);
    if (!data?.length) throw new DomainError("NFS-e não encontrada.");
    return { id: nfse.id };
  }
  const { data, error } = await db.from("erp_nfse").insert({ ...payload, conta_receber_id: tituloId }).select("id");
  falhar(error);
  if (!data?.[0]?.id) throw new DomainError("Não foi possível registrar a NFS-e.");
  return { id: String(data[0].id) };
}

async function anularNfse(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const tituloId = idDe(dados.tituloId, "Título");
  const { nfse } = await documentosDoTitulo(db, tituloId);
  cancelarNfse(nfse?.status ?? "ausente");
  if (!nfse) return {};
  const { error } = await db.from("erp_nfse").update({ status: "cancelada" }).eq("id", nfse.id);
  falhar(error);
  return { id: nfse.id };
}

async function salvarBoleto(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const tituloId = idDe(dados.tituloId, "Título");
  const { titulo, boleto: existente } = await documentosDoTitulo(db, tituloId);
  const status = texto(dados, "status");
  const meio = texto(dados, "meio");
  if (status !== "aberto" && status !== "atrasado") throw new DomainError("Status do boleto inválido.");
  if (meio !== "boleto" && meio !== "pix") throw new DomainError("Meio do boleto inválido.");
  const boleto = registrarBoleto({
    tituloStatus: titulo.status,
    jaTem: Boolean(existente),
    numero: texto(dados, "numero"),
    valor: texto(dados, "valor"),
    vencimento: texto(dados, "vencimento"),
    status,
    meio,
    linhaDigitavel: texto(dados, "linha"),
  });
  const { data, error } = await db
    .from("erp_boletos")
    .insert({
      conta_receber_id: tituloId,
      numero: boleto.numero,
      valor: dinheiro(boleto.valor),
      vencimento: boleto.vencimento,
      status: boleto.status,
      meio: boleto.meio,
      linha_digitavel: boleto.linhaDigitavel,
    })
    .select("id");
  falhar(error);
  if (!data?.[0]?.id) throw new DomainError("Não foi possível registrar o boleto.");
  return { id: String(data[0].id) };
}

async function statusBoleto(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Boleto");
  const proximo = texto(dados, "status");
  if (proximo !== "aberto" && proximo !== "atrasado" && proximo !== "cancelado") throw new DomainError("Status do boleto inválido.");
  const { data: boleto, error: leitura } = await db.from("erp_boletos").select("status").eq("id", id).maybeSingle();
  falhar(leitura);
  if (!boleto) throw new DomainError("O título não tem boleto.");
  mudarBoleto(boleto.status, proximo);
  const { data, error } = await db.from("erp_boletos").update({ status: proximo }).eq("id", id).select("id");
  falhar(error);
  if (!data?.length) throw new DomainError("Boleto não encontrado.");
  return { id };
}

async function quitarBoleto(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Boleto");
  const { data: boleto, error: leitura } = await db.from("erp_boletos").select("status, conta_receber_id").eq("id", id).maybeSingle();
  falhar(leitura);
  if (!boleto) throw new DomainError("O título não tem boleto.");
  const { data: titulo, error } = await db.from("erp_contas_receber").select("status").eq("id", boleto.conta_receber_id).maybeSingle();
  falhar(error);
  if (!titulo) throw new DomainError("Título não encontrado.");
  const meio = texto(dados, "meio");
  if (meio !== "boleto" && meio !== "pix") throw new DomainError("Meio do boleto inválido.");
  const baixa = pagarBoleto({
    tituloStatus: titulo.status,
    boletoStatus: boleto.status,
    valor: texto(dados, "valor"),
    data: texto(dados, "data"),
    meio,
  });
  const { error: rpcErro } = await db.rpc("erp_pagar_boleto", {
    p_boleto_id: id,
    p_data: baixa.data,
    p_valor_recebido: dinheiro(baixa.valorRecebido),
    p_meio: baixa.meio,
  });
  falhar(rpcErro);
  return { id };
}

async function baixaTitulo(db: Banco, dados: Record<string, unknown>): Promise<{ id?: string }> {
  const id = idDe(dados.id, "Título");
  const { titulo, boleto } = await documentosDoTitulo(db, id);
  const meio = texto(dados, "meio");
  if (meio !== "boleto" && meio !== "pix" && meio !== "manual") throw new DomainError("Meio da baixa inválido.");
  const baixa = baixaManual({
    tituloStatus: titulo.status,
    boleto: boleto?.status ?? "ausente",
    valor: texto(dados, "valor"),
    data: texto(dados, "data"),
    meio,
  });
  const { error } = await db.rpc("erp_baixa_manual", {
    p_titulo_id: id,
    p_data: baixa.data,
    p_valor_recebido: dinheiro(baixa.valorRecebido),
    p_meio: baixa.meio,
  });
  falhar(error);
  return { id };
}
