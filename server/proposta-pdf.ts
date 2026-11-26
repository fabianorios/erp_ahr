import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, adicionaisDeJson, agendaDeJson, formatBrl, htmlAdicionais, htmlAgenda, reaisToCents } from "../src/services/erp/domain.ts";
import { dataPropostaExtenso, docxParaPdf, preencherModeloDoDisco } from "./proposta-docx.ts";

export async function gerarPdfDaProposta(
  db: SupabaseClient,
  id: string,
): Promise<{ status: number; message?: string; pdf?: Buffer; nome?: string }> {
  try {
    const { data, error } = await db.from("erp_propostas").select("*, clients(name)").eq("id", id).maybeSingle();
    if (error) return { status: 500, message: "Não foi possível ler a proposta." };
    if (!data) return { status: 404, message: "Proposta não encontrada." };
    const embutido = Array.isArray(data.clients) ? data.clients[0] : data.clients;
    let clienteNome = typeof embutido?.name === "string" ? embutido.name.trim() : "";
    if (!clienteNome && data.cliente_id) {
      const { data: cliente } = await db.from("clients").select("name").eq("id", data.cliente_id).maybeSingle();
      clienteNome = typeof cliente?.name === "string" ? cliente.name.trim() : "";
    }
    const agenda = agendaDeJson(data.agenda_pagamento);
    const adicionais = htmlAdicionais(adicionaisDeJson(data.valores_adicionais));
    const nota = typeof data.forma_pagamento === "string" ? data.forma_pagamento : "";
    const valor = typeof data.valor_total === "number" || typeof data.valor_total === "string" ? formatBrl(reaisToCents(data.valor_total)) : "R$ 0,00";
    const docx = preencherModeloDoDisco({
      titulo: typeof data.titulo === "string" ? data.titulo : "",
      clienteNome,
      visaoGeral: typeof data.visao_geral === "string" ? data.visao_geral : "",
      escopo: String(data.escopo ?? ""),
      responsabilidades: String(data.responsabilidades ?? ""),
      prazo: String(data.prazo ?? ""),
      execucao: typeof data.execucao === "string" ? data.execucao : "",
      validade: typeof data.validade === "string" ? data.validade : "",
      responsabilidadeCliente: typeof data.responsabilidade_cliente === "string" ? data.responsabilidade_cliente : "",
      responsabilidadeAhr: typeof data.responsabilidade_ahr === "string" ? data.responsabilidade_ahr : "",
      formaPagamento: `${agenda ? htmlAgenda(agenda) : ""}${adicionais}${nota}`,
      valorTotal: valor,
      dataExtenso: dataPropostaExtenso(),
    });
    const pdf = docxParaPdf(docx);
    const nome = `${String(data.numero ?? "proposta").replace(/[^A-Za-z0-9._-]/g, "")}-v${Number(data.versao ?? 1)}.pdf`;
    return { status: 200, pdf, nome };
  } catch (error) {
    if (error instanceof DomainError) return { status: 400, message: error.message };
    return { status: 500, message: "Não foi possível gerar o PDF." };
  }
}
