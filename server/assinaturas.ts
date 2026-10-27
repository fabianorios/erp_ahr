import { randomBytes, randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError } from "../src/services/erp/domain.ts";
import {
  MAX_TENTATIVAS,
  PRAZO_CODIGO_MS,
  REENVIO_MS,
  emailConcluida,
  emailDevolvida,
  emailParaAhr,
  caminhoPdfProposta,
  emailParaCliente,
  mascararEmail,
  mensagemConcluida,
  mensagemDevolvida,
  motivoRecusaAssinatura,
  motivoRecusaIncluirContato,
  ordenarContatos,
  planejarInclusaoContato,
  rotuloTipo,
  validarEmailAssinatura,
  validarMotivoDevolucao,
  validarNomeAssinatura,
  type ConsultaAssinatura,
  type PainelAssinaturaDados,
  type ParteAssinatura,
  type StatusAssinatura,
  type StatusParte,
  type TipoDocumentoAssinatura,
} from "../src/services/erp/assinatura.ts";
import { enviarEmail, hashesIguais, sha256 } from "./email.ts";

type Banco = SupabaseClient;
type Ator = { email: string; nome: string };

type Linha = {
  id: string;
  documento_tipo: TipoDocumentoAssinatura;
  documento_id: string;
  status: StatusAssinatura;
  token: string;
  titulo: string;
  empresa: string;
  cliente_nome: string;
  cliente_email: string;
  cliente_documento: string;
  cliente_status: StatusParte;
  cliente_solicitado_em: string | null;
  cliente_assinado_em: string | null;
  cliente_assinou_como: string | null;
  cliente_otp_hash: string | null;
  cliente_otp_expira_em: string | null;
  cliente_tentativas: number;
  cliente_ip: string | null;
  cliente_hash: string | null;
  ahr_nome: string;
  ahr_email: string;
  ahr_status: StatusParte;
  ahr_solicitado_em: string | null;
  ahr_assinado_em: string | null;
  ahr_assinou_como: string | null;
  ahr_otp_hash: string | null;
  ahr_otp_expira_em: string | null;
  ahr_tentativas: number;
  ahr_ip: string | null;
  ahr_hash: string | null;
  devolutiva: string | null;
  criada_em: string;
  concluida_em: string | null;
};

type ParteLinha = {
  id: string;
  assinatura_id: string;
  ordem: number;
  papel: "contato" | "ahr";
  contato_id: string | null;
  nome: string;
  email: string;
  status: StatusParte;
  solicitado_em: string | null;
  assinado_em: string | null;
  assinou_como: string | null;
  otp_hash: string | null;
  otp_expira_em: string | null;
  tentativas: number;
  ip: string | null;
  hash: string | null;
};

type ParteVista = {
  id: string | null;
  ordem: number;
  papel: "contato" | "ahr";
  contatoId: string | null;
  nome: string;
  email: string;
  status: StatusParte;
  solicitadoEm: string | null;
  assinadoEm: string | null;
  assinouComo: string | null;
  otpHash: string | null;
  otpExpira: string | null;
  tentativas: number;
};

type ContatoEscolhido = { id: string; nome: string; email: string };

const MENSAGEM_CONTATOS = "Falta criar as tabelas de contatos. Cole o SQL de contatos da assinatura no projeto do ERP.";

const COLUNAS =
  "id, documento_tipo, documento_id, status, token, titulo, empresa, cliente_nome, cliente_email, cliente_documento, cliente_status, cliente_solicitado_em, cliente_assinado_em, cliente_assinou_como, cliente_otp_hash, cliente_otp_expira_em, cliente_tentativas, cliente_ip, cliente_hash, ahr_nome, ahr_email, ahr_status, ahr_solicitado_em, ahr_assinado_em, ahr_assinou_como, ahr_otp_hash, ahr_otp_expira_em, ahr_tentativas, ahr_ip, ahr_hash, devolutiva, criada_em, concluida_em";

const COLUNAS_PARTE =
  "id, assinatura_id, ordem, papel, contato_id, nome, email, status, solicitado_em, assinado_em, assinou_como, otp_hash, otp_expira_em, tentativas, ip, hash";

function textoErro(error: { message: string }): string {
  return error.message.replace(/^.*ERROR:\s*/i, "").trim() || "Não foi possível gravar.";
}

function tabelaAusente(error: { message: string; code?: string } | null, nome: string): boolean {
  if (!error) return false;
  const texto = error.message;
  const falta = error.code === "PGRST205" || /schema cache|could not find the table|does not exist|42P01/i.test(texto);
  return falta && new RegExp(nome, "i").test(texto);
}

function falharLeitura(error: { message: string } | null): void {
  if (!error) return;
  throw new DomainError(textoErro(error));
}

function falhar(error: { message: string; code?: string } | null): void {
  if (!error) return;
  const texto = error.message;
  if (error.code === "PGRST205" || /erp_assinaturas|schema cache|could not find the table|does not exist|42P01/i.test(texto)) {
    throw new DomainError("Falta criar a tabela de assinaturas. Cole o SQL de assinaturas no projeto do ERP.");
  }
  if (error.code === "23505") throw new DomainError("Já existe um pedido de assinatura em aberto para este documento.");
  throw new DomainError(textoErro(error) || "Não foi possível gravar a assinatura.");
}

function dadosDe(dados: unknown): Record<string, unknown> {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) throw new DomainError("Dados inválidos.");
  return dados as Record<string, unknown>;
}

function tipoDe(valor: unknown): TipoDocumentoAssinatura {
  if (valor === "proposta" || valor === "contrato") return valor;
  throw new DomainError("Documento inválido.");
}

function idDe(valor: unknown): string {
  const id = typeof valor === "string" ? valor : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("Documento inválido.");
  return id;
}

function tokenDe(valor: unknown): string {
  const token = typeof valor === "string" ? valor : "";
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) throw new DomainError("Link inválido.");
  return token;
}

function codigoDe(valor: unknown): string {
  const codigo = typeof valor === "string" ? valor.trim() : "";
  if (!/^\d{6}$/.test(codigo)) throw new DomainError("Código inválido.");
  return codigo;
}

function avisoDe(error: unknown): string {
  return error instanceof Error ? error.message : "O provedor de e-mail recusou o envio.";
}

function otp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function tokenNovo(): string {
  return randomBytes(32).toString("base64url");
}

function expiraCodigo(): string {
  return new Date(Date.now() + PRAZO_CODIGO_MS).toISOString();
}

function linkDe(token: string): string {
  const base = (process.env.ERP_PUBLIC_URL || "https://erpahr.ahrbrasil.com.br").trim().replace(/\/+$/, "");
  return `${base}/assinar/${token}`;
}

function vistaDe(parte: ParteLinha): ParteVista {
  return {
    id: parte.id,
    ordem: parte.ordem,
    papel: parte.papel,
    contatoId: parte.contato_id,
    nome: parte.nome,
    email: parte.email,
    status: parte.status,
    solicitadoEm: parte.solicitado_em,
    assinadoEm: parte.assinado_em,
    assinouComo: parte.assinou_como,
    otpHash: parte.otp_hash,
    otpExpira: parte.otp_expira_em,
    tentativas: Number(parte.tentativas) || 0,
  };
}

function vistasDe(row: Linha, partes: ParteLinha[] | null): ParteVista[] {
  if (partes && partes.length > 0) {
    return [...partes].sort((a, b) => a.ordem - b.ordem).map(vistaDe);
  }
  return [
    {
      id: null,
      ordem: 1,
      papel: "contato",
      contatoId: null,
      nome: row.cliente_nome,
      email: row.cliente_email,
      status: row.cliente_status,
      solicitadoEm: row.cliente_solicitado_em,
      assinadoEm: row.cliente_assinado_em,
      assinouComo: row.cliente_assinou_como,
      otpHash: row.cliente_otp_hash,
      otpExpira: row.cliente_otp_expira_em,
      tentativas: Number(row.cliente_tentativas) || 0,
    },
    {
      id: null,
      ordem: 2,
      papel: "ahr",
      contatoId: null,
      nome: row.ahr_nome,
      email: row.ahr_email,
      status: row.ahr_status,
      solicitadoEm: row.ahr_solicitado_em,
      assinadoEm: row.ahr_assinado_em,
      assinouComo: row.ahr_assinou_como,
      otpHash: row.ahr_otp_hash,
      otpExpira: row.ahr_otp_expira_em,
      tentativas: Number(row.ahr_tentativas) || 0,
    },
  ];
}

function paraPainel(parte: ParteVista): ParteAssinatura {
  return {
    ordem: parte.ordem,
    papel: parte.papel,
    contatoId: parte.contatoId,
    nome: parte.nome,
    email: parte.email,
    status: parte.status,
    solicitadoEm: parte.solicitadoEm,
    assinadoEm: parte.assinadoEm,
    assinouComo: parte.assinouComo,
  };
}

function painelDe(row: Linha, partes: ParteLinha[] | null): PainelAssinaturaDados {
  return {
    id: row.id,
    status: row.status,
    criadaEm: row.criada_em,
    concluidaEm: row.concluida_em,
    devolutiva: row.devolutiva,
    partes: vistasDe(row, partes).map(paraPainel),
  };
}

function atualDe(row: Linha, partes: ParteLinha[] | null): ParteVista | null {
  if (row.status !== "enviada") return null;
  return vistasDe(row, partes).find((parte) => parte.status === "solicitado") ?? null;
}

function anteriorDe(vistas: ParteVista[], parte: ParteVista): string {
  const previa = [...vistas].reverse().find((item) => item.ordem < parte.ordem && item.status === "assinado");
  return previa?.assinouComo || previa?.nome || "";
}

function etiquetaHash(parte: ParteVista): "contato" | "ahr" | "cliente" {
  if (parte.id) return parte.papel;
  return parte.papel === "ahr" ? "ahr" : "cliente";
}

async function ler(db: Banco, filtro: { coluna: string; valor: string }): Promise<Linha | null> {
  const { data, error } = await db.from("erp_assinaturas").select(COLUNAS).eq(filtro.coluna, filtro.valor).maybeSingle();
  falhar(error);
  return (data as Linha | null) ?? null;
}

async function ultima(db: Banco, tipo: TipoDocumentoAssinatura, documentoId: string): Promise<Linha | null> {
  const { data, error } = await db
    .from("erp_assinaturas")
    .select(COLUNAS)
    .eq("documento_tipo", tipo)
    .eq("documento_id", documentoId)
    .order("criada_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  falhar(error);
  return (data as Linha | null) ?? null;
}

async function aberta(db: Banco, tipo: TipoDocumentoAssinatura, documentoId: string): Promise<Linha | null> {
  const { data, error } = await db
    .from("erp_assinaturas")
    .select(COLUNAS)
    .eq("documento_tipo", tipo)
    .eq("documento_id", documentoId)
    .eq("status", "enviada")
    .maybeSingle();
  falhar(error);
  return (data as Linha | null) ?? null;
}

async function gravar(db: Banco, id: string, campos: Record<string, unknown>): Promise<Linha> {
  const { data, error } = await db.from("erp_assinaturas").update(campos).eq("id", id).select(COLUNAS).maybeSingle();
  falhar(error);
  if (!data) throw new DomainError("Não foi possível gravar a assinatura.");
  return data as Linha;
}

async function partesDe(db: Banco, assinaturaId: string): Promise<ParteLinha[] | null> {
  const { data, error } = await db.from("erp_assinatura_partes").select(COLUNAS_PARTE).eq("assinatura_id", assinaturaId).order("ordem");
  if (tabelaAusente(error, "erp_assinatura_partes")) return null;
  if (error) throw new DomainError(textoErro(error));
  return (data ?? []) as ParteLinha[];
}

async function gravarParte(db: Banco, id: string, campos: Record<string, unknown>): Promise<void> {
  const { error } = await db.from("erp_assinatura_partes").update(campos).eq("id", id);
  if (tabelaAusente(error, "erp_assinatura_partes")) throw new DomainError(MENSAGEM_CONTATOS);
  if (error) throw new DomainError(textoErro(error));
}

async function contarErro(db: Banco, id: string, coluna: "cliente_tentativas" | "ahr_tentativas", visto: number): Promise<void> {
  let query = db.from("erp_assinaturas").update({ [coluna]: visto + 1 }).eq("id", id);
  query = visto <= 0 ? query.or(`${coluna}.eq.0,${coluna}.is.null`) : query.eq(coluna, visto);
  const { error } = await query;
  falhar(error);
}

async function contarErroParte(db: Banco, row: Linha, parte: ParteVista): Promise<void> {
  if (parte.id) {
    let query = db.from("erp_assinatura_partes").update({ tentativas: parte.tentativas + 1 }).eq("id", parte.id);
    query = parte.tentativas <= 0 ? query.or("tentativas.eq.0,tentativas.is.null") : query.eq("tentativas", parte.tentativas);
    const { error } = await query;
    if (error) throw new DomainError(textoErro(error));
  }
  if (parte.papel === "ahr" || !parte.id || parte.ordem === 1) {
    await contarErro(db, row.id, parte.papel === "ahr" ? "ahr_tentativas" : "cliente_tentativas", parte.tentativas);
  }
}

async function clienteDe(db: Banco, clienteId: string): Promise<{ nome: string; documento: string }> {
  const { data, error } = await db.from("clients").select("name, document").eq("id", clienteId).maybeSingle();
  falharLeitura(error);
  if (!data) throw new DomainError("Cliente não encontrado.");
  return {
    nome: String(data.name ?? "").trim() || "Cliente",
    documento: String(data.document ?? "").replace(/\D/g, ""),
  };
}

async function contatosEscolhidos(db: Banco, clienteId: string, ids: string[]): Promise<ContatoEscolhido[]> {
  const { data, error } = await db.from("erp_cliente_contatos").select("id, cliente_id, nome, email").in("id", ids);
  if (tabelaAusente(error, "erp_cliente_contatos")) throw new DomainError(MENSAGEM_CONTATOS);
  if (error) throw new DomainError(textoErro(error));
  const porId = new Map((data ?? []).map((item) => [String(item.id).toLowerCase(), item]));
  return ids.map((id) => {
    const contato = porId.get(id.toLowerCase());
    if (!contato || String(contato.cliente_id) !== clienteId) throw new DomainError("Escolha contatos deste cliente.");
    return {
      id: String(contato.id),
      nome: validarNomeAssinatura(contato.nome),
      email: validarEmailAssinatura(String(contato.email ?? ""), "O contato não tem e-mail para receber a assinatura.", "E-mail do contato inválido."),
    };
  });
}

async function documentoDe(db: Banco, tipo: TipoDocumentoAssinatura, id: string): Promise<{ status: string; titulo: string; clienteId: string }> {
  if (tipo === "proposta") {
    const comTitulo = await db.from("erp_propostas").select("id, numero, versao, status, titulo, cliente_id").eq("id", id).maybeSingle();
    const semColuna = comTitulo.error && /titulo|schema cache/i.test(comTitulo.error.message);
    const lido = semColuna
      ? await db.from("erp_propostas").select("id, numero, versao, status, cliente_id").eq("id", id).maybeSingle()
      : comTitulo;
    falharLeitura(lido.error);
    if (!lido.data) throw new DomainError("Proposta não encontrada.");
    const titulo = String(lido.data.titulo ?? "").trim();
    return {
      status: String(lido.data.status ?? ""),
      titulo: titulo || `${lido.data.numero} v${lido.data.versao}`,
      clienteId: String(lido.data.cliente_id ?? ""),
    };
  }
  const { data, error } = await db.from("erp_contratos").select("id, numero, versao, status, cliente_id").eq("id", id).maybeSingle();
  falharLeitura(error);
  if (!data) throw new DomainError("Contrato não encontrado.");
  return {
    status: String(data.status ?? ""),
    titulo: `${data.numero} v${data.versao}`,
    clienteId: String(data.cliente_id ?? ""),
  };
}

async function exigirCodigo(db: Banco, row: Linha, partes: ParteLinha[] | null, codigo: string): Promise<ParteVista> {
  if (row.status === "devolvida") throw new DomainError(mensagemDevolvida());
  if (row.status === "concluida") throw new DomainError(mensagemConcluida());
  const parte = atualDe(row, partes);
  if (!parte) throw new DomainError("Não há assinatura pendente neste link.");
  const tentativas = parte.tentativas;
  if (!parte.otpExpira || new Date(parte.otpExpira).getTime() < Date.now()) {
    throw new DomainError("Código expirado. Solicite um novo envio ao remetente.");
  }
  if (tentativas >= MAX_TENTATIVAS) throw new DomainError("Muitas tentativas. Solicite um novo envio.");
  if (!parte.otpHash || !hashesIguais(sha256(`${row.token}:${codigo}`), parte.otpHash)) {
    await contarErroParte(db, row, parte);
    throw new DomainError("Código incorreto.");
  }
  return parte;
}

async function enviarConvite(row: Linha, parte: ParteVista, codigo: string, anterior: string): Promise<string | undefined> {
  const link = linkDe(row.token);
  try {
    if (parte.papel === "ahr") {
      const email = emailParaAhr({
        tipo: row.documento_tipo,
        titulo: row.titulo,
        nome: parte.nome,
        anterior: anterior || row.cliente_nome,
        otp: codigo,
        link,
      });
      await enviarEmail({ para: parte.email, assunto: email.assunto, texto: email.texto });
    } else {
      const email = emailParaCliente({
        tipo: row.documento_tipo,
        titulo: row.titulo,
        empresa: row.empresa,
        nome: parte.nome,
        otp: codigo,
        link,
      });
      await enviarEmail({ para: parte.email, assunto: email.assunto, texto: email.texto });
    }
    return undefined;
  } catch (error) {
    return avisoDe(error);
  }
}

async function avisarConclusao(row: Linha, vistas: ParteVista[], parte: ParteVista, nome: string): Promise<string | undefined> {
  const link = linkDe(row.token);
  const avisos: string[] = [];
  const vistos = new Set<string>();
  for (const item of vistas) {
    const destino = item.email.trim();
    const chave = destino.toLowerCase();
    if (!destino || vistos.has(chave)) continue;
    vistos.add(chave);
    try {
      const email = emailConcluida({
        tipo: row.documento_tipo,
        titulo: row.titulo,
        empresa: row.empresa,
        nome: item.ordem === parte.ordem ? nome : item.assinouComo || item.nome,
        link,
      });
      await enviarEmail({ para: destino, assunto: email.assunto, texto: email.texto });
    } catch (error) {
      const texto = avisoDe(error);
      if (!avisos.includes(texto)) avisos.push(texto);
    }
  }
  return avisos.length ? `A assinatura foi registrada, mas o e-mail de conclusão falhou: ${avisos.join(" ")}` : undefined;
}

async function reenviar(db: Banco, row: Linha, partes: ParteLinha[] | null): Promise<{ painel: PainelAssinaturaDados; aviso?: string }> {
  if (row.status === "devolvida") throw new DomainError(mensagemDevolvida());
  const vistas = vistasDe(row, partes);
  if (row.status === "concluida" || (vistas.length > 0 && vistas.every((item) => item.status === "assinado"))) {
    throw new DomainError(mensagemConcluida());
  }
  const parte = atualDe(row, partes);
  if (!parte) throw new DomainError("Não há código pendente para reenviar.");
  if (parte.tentativas >= MAX_TENTATIVAS) throw new DomainError("Muitas tentativas. Peça um novo envio à AHR.");
  if (parte.solicitadoEm && Date.now() - new Date(parte.solicitadoEm).getTime() < REENVIO_MS) {
    throw new DomainError("O código foi enviado agora há pouco. Aguarde um minuto e tente de novo.");
  }
  const codigo = otp();
  const hash = sha256(`${row.token}:${codigo}`);
  const agora = new Date().toISOString();
  const expira = expiraCodigo();
  if (parte.id) await gravarParte(db, parte.id, { otp_hash: hash, otp_expira_em: expira, solicitado_em: agora });
  const campos: Record<string, unknown> = {};
  if (parte.papel === "contato" && (!parte.id || parte.ordem === 1)) {
    campos.cliente_otp_hash = hash;
    campos.cliente_otp_expira_em = expira;
    campos.cliente_solicitado_em = agora;
  }
  if (parte.papel === "ahr") {
    campos.ahr_otp_hash = hash;
    campos.ahr_otp_expira_em = expira;
    campos.ahr_solicitado_em = agora;
  }
  const gravada = Object.keys(campos).length ? await gravar(db, row.id, campos) : row;
  const aviso = await enviarConvite(gravada, parte, codigo, anteriorDe(vistas, parte));
  return { painel: painelDe(gravada, await partesDe(db, gravada.id)), ...(aviso ? { aviso } : {}) };
}

async function enviar(db: Banco, dados: Record<string, unknown>, ator: Ator): Promise<{ id: string; painel: PainelAssinaturaDados; aviso?: string }> {
  const tipo = tipoDe(dados.tipo);
  const documentoId = idDe(dados.documentoId);
  const contatoIds = ordenarContatos(dados.contatoIds);
  const documento = await documentoDe(db, tipo, documentoId);
  const recusa = motivoRecusaAssinatura(tipo, documento.status);
  if (recusa) throw new DomainError(recusa);
  const cliente = await clienteDe(db, documento.clienteId);
  const escolhidos = await contatosEscolhidos(db, documento.clienteId, contatoIds);
  const emailAhr = validarEmailAssinatura(ator.email, "Sua conta não tem e-mail para assinar como AHR.", "E-mail da AHR inválido.");
  if (await aberta(db, tipo, documentoId)) throw new DomainError("Já existe um pedido de assinatura em aberto para este documento.");
  const primeiro = escolhidos[0];
  const token = tokenNovo();
  const codigo = otp();
  const agora = new Date().toISOString();
  const hash = sha256(`${token}:${codigo}`);
  const expira = expiraCodigo();
  const { data, error } = await db
    .from("erp_assinaturas")
    .insert({
      documento_tipo: tipo,
      documento_id: documentoId,
      status: "enviada",
      token,
      titulo: documento.titulo,
      empresa: cliente.nome,
      cliente_nome: primeiro.nome,
      cliente_email: primeiro.email,
      cliente_documento: cliente.documento,
      cliente_status: "solicitado",
      cliente_solicitado_em: agora,
      cliente_otp_hash: hash,
      cliente_otp_expira_em: expira,
      cliente_tentativas: 0,
      ahr_nome: ator.nome.trim() || "AHR",
      ahr_email: emailAhr,
      ahr_status: "pendente",
      ahr_tentativas: 0,
    })
    .select(COLUNAS)
    .maybeSingle();
  falhar(error);
  if (!data) throw new DomainError("Não foi possível gravar a assinatura.");
  const row = data as Linha;
  const linhas = [
    ...escolhidos.map((contato, indice) => ({
      assinatura_id: row.id,
      ordem: indice + 1,
      papel: "contato",
      contato_id: contato.id,
      nome: contato.nome,
      email: contato.email,
      status: indice === 0 ? "solicitado" : "pendente",
      solicitado_em: indice === 0 ? agora : null,
      otp_hash: indice === 0 ? hash : null,
      otp_expira_em: indice === 0 ? expira : null,
      tentativas: 0,
    })),
    {
      assinatura_id: row.id,
      ordem: escolhidos.length + 1,
      papel: "ahr",
      contato_id: null,
      nome: row.ahr_nome,
      email: row.ahr_email,
      status: "pendente",
      solicitado_em: null,
      otp_hash: null,
      otp_expira_em: null,
      tentativas: 0,
    },
  ];
  const { error: erroPartes } = await db.from("erp_assinatura_partes").insert(linhas);
  if (erroPartes) {
    const { error: erroDelete } = await db.from("erp_assinaturas").delete().eq("id", row.id);
    if (tabelaAusente(erroPartes, "erp_assinatura_partes")) throw new DomainError(MENSAGEM_CONTATOS);
    if (erroDelete) throw new DomainError("Não foi possível gravar os contatos da assinatura, e o pedido aberto ficou sem partes.");
    throw new DomainError(textoErro(erroPartes) || "Não foi possível gravar os contatos da assinatura.");
  }
  const primeiroVista = atualDe(row, await partesDe(db, row.id));
  const aviso = primeiroVista ? await enviarConvite(row, primeiroVista, codigo, "") : undefined;
  return { id: row.id, painel: painelDe(row, await partesDe(db, row.id)), ...(aviso ? { aviso } : {}) };
}

async function confirmar(
  db: Banco,
  row: Linha,
  partes: ParteLinha[] | null,
  codigo: string,
  nome: string,
  ip: string,
): Promise<{ ok: true; concluida: boolean; proxima?: "contato" | "ahr"; aviso?: string }> {
  const parte = await exigirCodigo(db, row, partes, codigo);
  const assinadoEm = new Date().toISOString();
  const ipCurto = ip.slice(0, 80);
  const documento = parte.papel === "contato" ? row.cliente_documento : "";
  const hash = sha256(`${row.token}|${etiquetaHash(parte)}|${nome}|${documento}|${parte.email}|${assinadoEm}|${ipCurto}`);
  const vistas = vistasDe(row, partes);
  const seguinte = vistas.find((item) => item.ordem > parte.ordem) ?? null;
  if (parte.id) {
    await gravarParte(db, parte.id, {
      status: "assinado",
      assinado_em: assinadoEm,
      assinou_como: nome,
      ip: ipCurto || null,
      hash,
      otp_hash: null,
      otp_expira_em: null,
    });
  }
  if (!seguinte) {
    const campos: Record<string, unknown> = {
      status: "concluida",
      concluida_em: assinadoEm,
      cliente_otp_hash: null,
      cliente_otp_expira_em: null,
      ahr_otp_hash: null,
      ahr_otp_expira_em: null,
    };
    if (parte.papel === "ahr") {
      campos.ahr_status = "assinado";
      campos.ahr_assinado_em = assinadoEm;
      campos.ahr_assinou_como = nome;
      campos.ahr_ip = ipCurto || null;
      campos.ahr_hash = hash;
    } else if (!parte.id) {
      campos.cliente_status = "assinado";
      campos.cliente_assinado_em = assinadoEm;
      campos.cliente_assinou_como = nome;
      campos.cliente_ip = ipCurto || null;
      campos.cliente_hash = hash;
    }
    const gravada = await gravar(db, row.id, campos);
    const aviso = await avisarConclusao(gravada, vistas, parte, nome);
    return { ok: true, concluida: true, ...(aviso ? { aviso } : {}) };
  }
  const codigoProximo = otp();
  const otpHash = sha256(`${row.token}:${codigoProximo}`);
  const expira = expiraCodigo();
  if (seguinte.id) {
    await gravarParte(db, seguinte.id, {
      status: "solicitado",
      solicitado_em: assinadoEm,
      otp_hash: otpHash,
      otp_expira_em: expira,
      tentativas: 0,
    });
  }
  const campos: Record<string, unknown> = {};
  if (parte.papel === "contato" && (!parte.id || parte.ordem === 1)) {
    campos.cliente_status = "assinado";
    campos.cliente_assinado_em = assinadoEm;
    campos.cliente_assinou_como = nome;
    campos.cliente_ip = ipCurto || null;
    campos.cliente_hash = hash;
    campos.cliente_otp_hash = null;
    campos.cliente_otp_expira_em = null;
  }
  if (seguinte.papel === "ahr") {
    campos.ahr_status = "solicitado";
    campos.ahr_solicitado_em = assinadoEm;
    campos.ahr_otp_hash = otpHash;
    campos.ahr_otp_expira_em = expira;
    campos.ahr_tentativas = 0;
  }
  const gravada = Object.keys(campos).length ? await gravar(db, row.id, campos) : row;
  const aviso = await enviarConvite(gravada, seguinte, codigoProximo, nome);
  return { ok: true, concluida: false, proxima: seguinte.papel, ...(aviso ? { aviso } : {}) };
}

async function devolver(db: Banco, row: Linha, partes: ParteLinha[] | null, codigo: string, motivo: string): Promise<{ ok: true; aviso?: string }> {
  const parte = await exigirCodigo(db, row, partes, codigo);
  const gravada = await gravar(db, row.id, {
    status: "devolvida",
    devolutiva: `${parte.nome}: ${motivo}`,
    cliente_otp_hash: null,
    cliente_otp_expira_em: null,
    ahr_otp_hash: null,
    ahr_otp_expira_em: null,
  });
  if (partes && partes.length > 0) {
    const { error } = await db.from("erp_assinatura_partes").update({ otp_hash: null, otp_expira_em: null }).eq("assinatura_id", row.id);
    if (error && !tabelaAusente(error, "erp_assinatura_partes")) throw new DomainError(textoErro(error));
  }
  let aviso: string | undefined;
  try {
    const email = emailDevolvida({ tipo: gravada.documento_tipo, titulo: gravada.titulo, quem: parte.nome, motivo });
    await enviarEmail({ para: gravada.ahr_email, assunto: email.assunto, texto: email.texto });
  } catch (error) {
    aviso = avisoDe(error);
  }
  return { ok: true, ...(aviso ? { aviso } : {}) };
}

function consultaDe(row: Linha, partes: ParteLinha[] | null): ConsultaAssinatura {
  const parte = atualDe(row, partes);
  const mensagem = row.status === "devolvida" ? mensagemDevolvida() : row.status === "concluida" ? mensagemConcluida() : null;
  return {
    status: row.status,
    tipo: rotuloTipo(row.documento_tipo),
    titulo: row.titulo,
    empresa: row.empresa,
    etapa: parte?.papel ?? null,
    nome: parte?.nome ?? "",
    emailMascarado: parte ? mascararEmail(parte.email) : "",
    mensagem,
    pdf: row.documento_tipo === "proposta" ? caminhoPdfProposta(row.token) : null,
  };
}

export async function propostaIdDaAssinatura(db: Banco, tokenBruto: string): Promise<string> {
  const token = tokenDe(tokenBruto);
  const row = await ler(db, { coluna: "token", valor: token });
  if (!row) throw new DomainError("Link inválido.");
  if (row.documento_tipo !== "proposta") throw new DomainError("Este documento não tem PDF de proposta.");
  return row.documento_id;
}

function contatoIdDe(valor: unknown): string {
  const id = typeof valor === "string" ? valor : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("Contato inválido.");
  return id;
}

function planoDe(partes: ParteLinha[], contato: ContatoEscolhido) {
  return planejarInclusaoContato(
    partes.map((parte) => ({
      ordem: parte.ordem,
      papel: parte.papel,
      status: parte.status,
      email: parte.email,
      contatoId: parte.contato_id,
    })),
    contato,
  );
}

async function incluirContato(
  db: Banco,
  dados: Record<string, unknown>,
): Promise<{ painel: PainelAssinaturaDados; aviso?: string; vez: boolean }> {
  const tipo = tipoDe(dados.tipo);
  const documentoId = idDe(dados.documentoId);
  const contatoId = contatoIdDe(dados.contatoId);
  const abertaRow = await ultima(db, tipo, documentoId);
  const recusa = motivoRecusaIncluirContato(abertaRow?.status ?? null, abertaRow?.ahr_status === "assinado");
  if (recusa || !abertaRow) throw new DomainError(recusa ?? "Não há pedido de assinatura em aberto.");
  const partes = await partesDe(db, abertaRow.id);
  if (partes === null) throw new DomainError(MENSAGEM_CONTATOS);
  const documento = await documentoDe(db, tipo, documentoId);
  const [contato] = await contatosEscolhidos(db, documento.clienteId, [contatoId]);
  const base = partes.length > 0 ? partes : partesSinteticas(abertaRow);
  const plano = planoDe(base, contato);
  const agora = new Date().toISOString();
  const codigo = plano.vez ? otp() : null;
  const hash = codigo ? sha256(`${abertaRow.token}:${codigo}`) : null;
  const expira = codigo ? expiraCodigo() : null;
  if (partes.length === 0) {
    await inserirPartesIniciais(db, abertaRow, contato, plano, agora, hash, expira);
  } else {
    await encaixarParte(db, abertaRow, partes, contato, plano, agora, hash, expira);
  }
  let aviso: string | undefined;
  if (plano.vez && codigo) {
    const anterior = [...base].reverse().find((parte) => parte.papel === "contato" && parte.status === "assinado");
    aviso = await enviarConvite(
      abertaRow,
      {
        id: null,
        ordem: plano.ordem,
        papel: "contato",
        contatoId: contato.id,
        nome: contato.nome,
        email: contato.email,
        status: "solicitado",
        solicitadoEm: agora,
        assinadoEm: null,
        assinouComo: null,
        otpHash: hash,
        otpExpira: expira,
        tentativas: 0,
      },
      codigo,
      anterior?.assinou_como || anterior?.nome || "",
    );
  }
  const gravada = (await ler(db, { coluna: "id", valor: abertaRow.id })) ?? abertaRow;
  return { painel: painelDe(gravada, await partesDe(db, gravada.id)), vez: plano.vez, ...(aviso ? { aviso } : {}) };
}

function partesSinteticas(row: Linha): ParteLinha[] {
  return [
    {
      id: "",
      assinatura_id: row.id,
      ordem: 1,
      papel: "contato",
      contato_id: null,
      nome: row.cliente_nome,
      email: row.cliente_email,
      status: row.cliente_status,
      solicitado_em: row.cliente_solicitado_em,
      assinado_em: row.cliente_assinado_em,
      assinou_como: row.cliente_assinou_como,
      otp_hash: row.cliente_otp_hash,
      otp_expira_em: row.cliente_otp_expira_em,
      tentativas: row.cliente_tentativas,
      ip: row.cliente_ip,
      hash: row.cliente_hash,
    },
    {
      id: "",
      assinatura_id: row.id,
      ordem: 2,
      papel: "ahr",
      contato_id: null,
      nome: row.ahr_nome,
      email: row.ahr_email,
      status: row.ahr_status,
      solicitado_em: row.ahr_solicitado_em,
      assinado_em: row.ahr_assinado_em,
      assinou_como: row.ahr_assinou_como,
      otp_hash: row.ahr_otp_hash,
      otp_expira_em: row.ahr_otp_expira_em,
      tentativas: row.ahr_tentativas,
      ip: row.ahr_ip,
      hash: row.ahr_hash,
    },
  ];
}

async function inserirPartesIniciais(
  db: Banco,
  row: Linha,
  contato: ContatoEscolhido,
  plano: { ordem: number; ahrOrdem: number; vez: boolean },
  agora: string,
  hash: string | null,
  expira: string | null,
): Promise<void> {
  const ahrNaVez = plano.vez && row.ahr_status === "solicitado";
  const linhas = [
    {
      assinatura_id: row.id,
      ordem: 1,
      papel: "contato",
      contato_id: null,
      nome: row.cliente_nome,
      email: row.cliente_email,
      status: row.cliente_status,
      solicitado_em: row.cliente_solicitado_em,
      assinado_em: row.cliente_assinado_em,
      assinou_como: row.cliente_assinou_como,
      otp_hash: row.cliente_otp_hash,
      otp_expira_em: row.cliente_otp_expira_em,
      tentativas: row.cliente_tentativas,
      ip: row.cliente_ip,
      hash: row.cliente_hash,
    },
    {
      assinatura_id: row.id,
      ordem: plano.ordem,
      papel: "contato",
      contato_id: contato.id,
      nome: contato.nome,
      email: contato.email,
      status: plano.vez ? "solicitado" : "pendente",
      solicitado_em: plano.vez ? agora : null,
      otp_hash: hash,
      otp_expira_em: expira,
      tentativas: 0,
    },
    {
      assinatura_id: row.id,
      ordem: plano.ahrOrdem,
      papel: "ahr",
      contato_id: null,
      nome: row.ahr_nome,
      email: row.ahr_email,
      status: ahrNaVez ? "pendente" : row.ahr_status,
      solicitado_em: ahrNaVez ? null : row.ahr_solicitado_em,
      assinado_em: row.ahr_assinado_em,
      assinou_como: row.ahr_assinou_como,
      otp_hash: ahrNaVez ? null : row.ahr_otp_hash,
      otp_expira_em: ahrNaVez ? null : row.ahr_otp_expira_em,
      tentativas: ahrNaVez ? 0 : row.ahr_tentativas,
      ip: row.ahr_ip,
      hash: row.ahr_hash,
    },
  ];
  const { error } = await db.from("erp_assinatura_partes").insert(linhas);
  if (tabelaAusente(error, "erp_assinatura_partes")) throw new DomainError(MENSAGEM_CONTATOS);
  if (error) throw new DomainError(textoErro(error) || "Não foi possível incluir o contato.");
  if (ahrNaVez) {
    await gravar(db, row.id, {
      ahr_status: "pendente",
      ahr_otp_hash: null,
      ahr_otp_expira_em: null,
      ahr_solicitado_em: null,
      ahr_tentativas: 0,
    });
  }
}

async function encaixarParte(
  db: Banco,
  row: Linha,
  partes: ParteLinha[],
  contato: ContatoEscolhido,
  plano: { ordem: number; ahrOrdem: number; vez: boolean },
  agora: string,
  hash: string | null,
  expira: string | null,
): Promise<void> {
  const ahr = partes.find((parte) => parte.papel === "ahr" && parte.ordem === plano.ordem);
  if (!ahr) throw new DomainError("Este pedido não tem a assinatura da AHR.");
  const movida = await db.from("erp_assinatura_partes").update({ ordem: plano.ahrOrdem }).eq("id", ahr.id).eq("ordem", ahr.ordem).select("id");
  if (tabelaAusente(movida.error, "erp_assinatura_partes")) throw new DomainError(MENSAGEM_CONTATOS);
  if (movida.error) throw new DomainError(textoErro(movida.error));
  if (!movida.data?.length) throw new DomainError("O pedido mudou. Atualize a tela e tente de novo.");
  const inclusa = await db.from("erp_assinatura_partes").insert({
    assinatura_id: row.id,
    ordem: plano.ordem,
    papel: "contato",
    contato_id: contato.id,
    nome: contato.nome,
    email: contato.email,
    status: plano.vez ? "solicitado" : "pendente",
    solicitado_em: plano.vez ? agora : null,
    otp_hash: hash,
    otp_expira_em: expira,
    tentativas: 0,
  }).select("id");
  if (inclusa.error || !inclusa.data?.length) {
    await db.from("erp_assinatura_partes").update({ ordem: ahr.ordem }).eq("id", ahr.id).eq("ordem", plano.ahrOrdem);
    if (tabelaAusente(inclusa.error, "erp_assinatura_partes")) throw new DomainError(MENSAGEM_CONTATOS);
    throw new DomainError(textoErro(inclusa.error ?? { message: "" }) || "Não foi possível incluir o contato.");
  }
  if (plano.vez && ahr.status === "solicitado") {
    await gravarParte(db, ahr.id, { status: "pendente", otp_hash: null, otp_expira_em: null, solicitado_em: null, tentativas: 0 });
    await gravar(db, row.id, {
      ahr_status: "pendente",
      ahr_otp_hash: null,
      ahr_otp_expira_em: null,
      ahr_solicitado_em: null,
      ahr_tentativas: 0,
    });
  }
}

export async function executarAssinatura(
  db: Banco,
  acao: string,
  bruto: unknown,
  ator: Ator,
): Promise<{ id?: string; painel: PainelAssinaturaDados | null; aviso?: string; vez?: boolean }> {
  const dados = bruto == null ? {} : dadosDe(bruto);
  if (acao === "assinatura.painel") {
    const row = await ultima(db, tipoDe(dados.tipo), idDe(dados.documentoId));
    return { painel: row ? painelDe(row, await partesDe(db, row.id)) : null };
  }
  if (acao === "assinatura.enviar") return enviar(db, dados, ator);
  if (acao === "assinatura.incluirContato") return incluirContato(db, dados);
  if (acao === "assinatura.reenviar") {
    const row = await aberta(db, tipoDe(dados.tipo), idDe(dados.documentoId));
    if (!row) throw new DomainError("Não há pedido de assinatura em aberto.");
    return reenviar(db, row, await partesDe(db, row.id));
  }
  throw new DomainError("Operação não reconhecida.");
}

export async function executarAssinaturaPublica(
  db: Banco,
  bruto: unknown,
  ip: string,
): Promise<ConsultaAssinatura | { ok: true; nome?: string; concluida?: boolean; proxima?: "contato" | "ahr"; aviso?: string }> {
  const dados = dadosDe(bruto);
  const acao = typeof dados.acao === "string" ? dados.acao : "";
  const token = tokenDe(dados.token);
  const row = await ler(db, { coluna: "token", valor: token });
  if (!row) throw new DomainError("Link inválido.");
  const partes = await partesDe(db, row.id);
  if (acao === "consultar") return consultaDe(row, partes);
  if (acao === "reenviar") {
    const resultado = await reenviar(db, row, partes);
    return { ok: true, ...(resultado.aviso ? { aviso: resultado.aviso } : {}) };
  }
  if (acao === "codigo") {
    const parte = await exigirCodigo(db, row, partes, codigoDe(dados.otp));
    return { ok: true, nome: parte.nome };
  }
  if (acao === "confirmar") {
    return confirmar(db, row, partes, codigoDe(dados.otp), validarNomeAssinatura(dados.nome), ip.slice(0, 80));
  }
  if (acao === "devolver") {
    return devolver(db, row, partes, codigoDe(dados.otp), validarMotivoDevolucao(dados.motivo));
  }
  throw new DomainError("Operação não reconhecida.");
}
