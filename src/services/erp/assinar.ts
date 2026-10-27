import { DomainError } from "@/services/erp/domain";
import type { ConsultaAssinatura } from "@/services/erp/assinatura";

async function postar<T>(dados: Record<string, unknown>): Promise<T> {
  const resposta = await fetch("/api/assinar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(dados),
  });
  const corpo = (await resposta.json().catch(() => ({}))) as T & { message?: string; aviso?: string };
  if (!resposta.ok) throw new DomainError(corpo.message ?? "Não foi possível continuar.");
  return corpo;
}

export function consultarAssinatura(token: string): Promise<ConsultaAssinatura> {
  return postar({ acao: "consultar", token });
}

export function validarCodigoAssinatura(token: string, otp: string): Promise<{ ok: true; nome: string }> {
  return postar({ acao: "codigo", token, otp });
}

export function confirmarAssinatura(token: string, otp: string, nome: string): Promise<{ ok: true; concluida: boolean; proxima?: "contato" | "ahr"; aviso?: string }> {
  return postar({ acao: "confirmar", token, otp, nome });
}

export function reenviarCodigoAssinatura(token: string): Promise<{ ok: true; aviso?: string }> {
  return postar({ acao: "reenviar", token });
}

export function devolverAssinatura(token: string, otp: string, motivo: string): Promise<{ ok: true; aviso?: string }> {
  return postar({ acao: "devolver", token, otp, motivo });
}
