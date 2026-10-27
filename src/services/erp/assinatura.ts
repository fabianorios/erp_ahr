import { DomainError } from "./domain.ts";

export type TipoDocumentoAssinatura = "proposta" | "contrato";
export type StatusAssinatura = "enviada" | "concluida" | "devolvida";
export type StatusParte = "pendente" | "solicitado" | "assinado";
export type PapelAssinatura = "contato" | "ahr";

export const PRAZO_CODIGO_MS = 7 * 24 * 60 * 60 * 1000;
export const REENVIO_MS = 60_000;
export const MAX_TENTATIVAS = 5;
export const PRAZO_CODIGO_TEXTO = "O código vale por 7 dias.";

export type ParteAssinatura = {
  ordem: number;
  papel: PapelAssinatura;
  contatoId: string | null;
  nome: string;
  email: string;
  status: StatusParte;
  solicitadoEm: string | null;
  assinadoEm: string | null;
  assinouComo: string | null;
};

export const MSG_INCLUIR_CONCLUIDA = "Este pedido está concluído. Não é possível incluir outro contato.";
export const MSG_INCLUIR_DEVOLVIDA = "Este pedido foi devolvido. Não é possível incluir outro contato.";
export const MSG_INCLUIR_AHR = "A AHR já assinou este pedido. Não é possível incluir outro contato.";
export const MSG_INCLUIR_REPETIDO = "Este contato já está neste pedido.";

export type ParteInclusao = {
  ordem: number;
  papel: PapelAssinatura;
  status: StatusParte;
  email: string;
  contatoId: string | null;
};

export function motivoRecusaIncluirContato(status: StatusAssinatura | null, ahrAssinou: boolean): string | null {
  if (status === "concluida") return MSG_INCLUIR_CONCLUIDA;
  if (status === "devolvida") return MSG_INCLUIR_DEVOLVIDA;
  if (ahrAssinou) return MSG_INCLUIR_AHR;
  if (status !== "enviada") return "Não há pedido de assinatura em aberto.";
  return null;
}

export function planejarInclusaoContato(
  partes: ParteInclusao[],
  contato: { id: string; email: string },
): { ordem: number; ahrOrdem: number; vez: boolean } {
  const ahr = partes.filter((parte) => parte.papel === "ahr").sort((a, b) => a.ordem - b.ordem)[0];
  if (!ahr) throw new DomainError("Este pedido não tem a assinatura da AHR.");
  if (ahr.status === "assinado") throw new DomainError(MSG_INCLUIR_AHR);
  const email = contato.email.trim().toLowerCase();
  const id = contato.id.toLowerCase();
  const repetido = partes.some((parte) => {
    if (parte.papel !== "contato") return false;
    if (parte.contatoId && parte.contatoId.toLowerCase() === id) return true;
    return parte.email.trim().toLowerCase() === email;
  });
  if (repetido) throw new DomainError(MSG_INCLUIR_REPETIDO);
  const vez = partes.filter((parte) => parte.papel === "contato").every((parte) => parte.status === "assinado");
  return { ordem: ahr.ordem, ahrOrdem: ahr.ordem + 1, vez };
}

export type PainelAssinaturaDados = {
  id: string;
  status: StatusAssinatura;
  criadaEm: string;
  concluidaEm: string | null;
  devolutiva: string | null;
  partes: ParteAssinatura[];
};

export type ConsultaAssinatura = {
  status: StatusAssinatura;
  tipo: string;
  titulo: string;
  empresa: string;
  etapa: PapelAssinatura | null;
  nome: string;
  emailMascarado: string;
  mensagem: string | null;
  pdf: string | null;
};

export function caminhoPdfProposta(token: string): string {
  return `/api/assinar/${token}/pdf`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function rotuloTipo(tipo: TipoDocumentoAssinatura): "Proposta" | "Contrato" {
  return tipo === "proposta" ? "Proposta" : "Contrato";
}

function flexao(tipo: TipoDocumentoAssinatura): { rotulo: string; artigo: string; artigoMin: string; assinado: string; concluido: string; devolvido: string } {
  if (tipo === "proposta") {
    return { rotulo: "Proposta", artigo: "A", artigoMin: "a", assinado: "assinada", concluido: "concluída", devolvido: "devolvida" };
  }
  return { rotulo: "Contrato", artigo: "O", artigoMin: "o", assinado: "assinado", concluido: "concluído", devolvido: "devolvido" };
}

export function podePedirAssinatura(tipo: TipoDocumentoAssinatura, status: string): boolean {
  if (tipo === "proposta") return status === "rascunho" || status === "enviada" || status === "aceita";
  return status === "rascunho" || status === "vigente";
}

export function motivoRecusaAssinatura(tipo: TipoDocumentoAssinatura, status: string): string | null {
  if (podePedirAssinatura(tipo, status)) return null;
  if (tipo === "proposta") return "Proposta recusada ou expirada não entra em assinatura.";
  return "Contrato cancelado ou encerrado não entra em assinatura.";
}

export function validarEmailAssinatura(valor: string, ausente: string, invalido: string): string {
  const email = valor.trim();
  if (!email) throw new DomainError(ausente);
  if (!EMAIL.test(email)) throw new DomainError(invalido);
  return email;
}

export function ordenarContatos(valor: unknown): string[] {
  if (!Array.isArray(valor) || valor.length === 0) throw new DomainError("Escolha ao menos um contato.");
  const ids: string[] = [];
  for (const item of valor) {
    const id = typeof item === "string" ? item : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("Contato inválido.");
    if (ids.some((visto) => visto.toLowerCase() === id.toLowerCase())) {
      throw new DomainError("O mesmo contato não pode aparecer duas vezes.");
    }
    ids.push(id);
  }
  return ids;
}

export function validarNomeAssinatura(valor: unknown): string {
  const nome = typeof valor === "string" ? valor.trim() : "";
  if (nome.length < 2) throw new DomainError("Informe o nome de quem assina.");
  if (nome.length > 200) throw new DomainError("O nome passou de 200 caracteres.");
  return nome;
}

export function validarMotivoDevolucao(valor: unknown): string {
  const motivo = typeof valor === "string" ? valor.trim() : "";
  if (motivo.length < 5) throw new DomainError("Descreva a ressalva (mínimo de 5 caracteres).");
  if (motivo.length > 4000) throw new DomainError("A ressalva passou do limite de 4.000 caracteres.");
  return motivo;
}

export function mascararEmail(email: string): string {
  const [nome, dominio] = email.split("@");
  if (!nome || !dominio) return "***";
  return `${nome.slice(0, 1)}***@${dominio}`;
}

export function mensagemDevolvida(): string {
  return "Este documento foi devolvido para ajuste da AHR. Aguarde um novo envio neste mesmo link.";
}

export function mensagemConcluida(): string {
  return "Este documento já foi assinado pelo cliente e pela AHR.";
}

type EmailAssinatura = { assunto: string; texto: string };

export function emailParaCliente(input: { tipo: TipoDocumentoAssinatura; titulo: string; empresa: string; nome: string; otp: string; link: string }): EmailAssinatura {
  const item = flexao(input.tipo);
  return {
    assunto: `${item.rotulo} ${input.titulo} — sua assinatura é necessária`,
    texto: `Olá, ${input.nome}.

${item.artigo} ${item.rotulo} ${input.titulo}, do cliente ${input.empresa}, está disponível para sua assinatura eletrônica.
${input.tipo === "proposta" ? "\nLeia a proposta em PDF nesta página antes de assinar.\n" : ""}
Código de verificação: ${input.otp}

${PRAZO_CODIGO_TEXTO}

${input.link}`,
  };
}

export function emailParaAhr(input: { tipo: TipoDocumentoAssinatura; titulo: string; nome: string; anterior: string; otp: string; link: string }): EmailAssinatura {
  const item = flexao(input.tipo);
  return {
    assunto: `${item.rotulo} ${input.titulo} — aguardando sua assinatura`,
    texto: `Olá, ${input.nome}.

${input.anterior} assinou ${item.artigoMin} ${item.rotulo} ${input.titulo}. Agora é necessária a sua assinatura como AHR.

Código de verificação: ${input.otp}

${PRAZO_CODIGO_TEXTO}

${input.link}`,
  };
}

export function emailConcluida(input: { tipo: TipoDocumentoAssinatura; titulo: string; empresa: string; nome: string; link: string }): EmailAssinatura {
  const item = flexao(input.tipo);
  return {
    assunto: `${item.rotulo} ${input.titulo} ${item.concluido}`,
    texto: `Olá, ${input.nome}.

${item.artigo} ${item.rotulo} ${input.titulo} (${input.empresa}) foi ${item.assinado} pelo cliente e pela AHR e está ${item.concluido}.

${input.link}`,
  };
}

export function emailDevolvida(input: { tipo: TipoDocumentoAssinatura; titulo: string; quem: string; motivo: string }): EmailAssinatura {
  const item = flexao(input.tipo);
  return {
    assunto: `${item.rotulo} ${input.titulo} ${item.devolvido} para ajuste`,
    texto: `Olá.

${input.quem} devolveu ${item.artigoMin} ${item.rotulo} ${input.titulo} para ajuste da AHR.

Motivo: ${input.motivo}`,
  };
}
