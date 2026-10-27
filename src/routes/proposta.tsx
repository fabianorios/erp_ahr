import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvisoConsulta, Campo, Pill, TituloPagina, dataBr, executar, reaisInput } from "@/components/erp/apresentacao";
import { FormaPagamentoCampos } from "@/components/erp/forma-pagamento";
import { ContasDaProposta } from "@/components/erp/contas-previstas";
import { PainelAssinatura } from "@/components/erp/painel-assinatura";
import { TextosPropostaCampos } from "@/components/erp/proposta-textos";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  criarContratoDaProposta,
  criarVersao,
  excluirProposta,
  listarClientesFinanceiros,
  listarPropostas,
  mudarProposta,
  obterProposta,
  salvarProposta,
  formularioPropostaVazio,
} from "@/services/erp/api";

export function PropostaPage() {
  const { id = "" } = useParams();
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const proposta = useQuery({ queryKey: ["erp", "proposta", id], queryFn: () => obterProposta(id) });
  const propostas = useQuery({ queryKey: ["erp", "propostas"], queryFn: listarPropostas });
  const clientes = useQuery({ queryKey: ["erp", "clientes"], queryFn: listarClientesFinanceiros });
  const atual = proposta.data;
  const [form, setForm] = useState(formularioPropostaVazio());

  useEffect(() => {
    if (!atual) return;
    setForm({
      clienteId: atual.clienteId,
      titulo: atual.titulo,
      visaoGeral: atual.visaoGeral,
      escopo: atual.escopo,
      responsabilidades: atual.responsabilidades,
      prazo: atual.prazo,
      execucao: atual.execucao,
      validade: atual.validade,
      formaPagamento: atual.formaPagamento,
      quantidade: atual.agenda ? String(atual.agenda.quantidade) : "",
      modoParcelas: atual.agenda?.modo ?? "datas",
      intervaloDias: atual.agenda?.intervaloDias ? String(atual.agenda.intervaloDias) : "",
      primeiroVencimento: atual.agenda?.primeiroVencimento ?? "",
      vencimentos: atual.agenda?.modo === "datas" ? atual.agenda.parcelas.map((parcela) => parcela.vencimento) : [],
      adicionais: atual.adicionais,
      valor: reaisInput(atual.valor),
      inicio: atual.inicio ?? "",
      fim: atual.fim ?? "",
    });
  }, [atual?.id, atual?.status, atual?.valor, atual?.titulo, atual?.visaoGeral, atual?.escopo, atual?.responsabilidades, atual?.prazo, atual?.execucao, atual?.validade, atual?.formaPagamento, atual?.adicionais, atual?.clienteId, atual?.inicio, atual?.fim, atual?.agenda]);

  const recarregar = async () => {
    await qc.invalidateQueries({ queryKey: ["erp"] });
  };
  const existeRascunho = (propostas.data ?? []).some((item) => item.numero === atual?.numero && item.status === "rascunho");

  if (proposta.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!atual) {
    return (
      <div className="space-y-3">
        <AvisoConsulta erro={proposta.error} />
        <p className="text-sm text-muted-foreground">Proposta não encontrada.</p>
      </div>
    );
  }

  const rascunho = atual.status === "rascunho";

  return (
    <div className="space-y-6">
      <TituloPagina titulo={`${atual.numero} v${atual.versao}`} descricao={atual.clienteNome || "Proposta"} />
      <div className="flex flex-wrap gap-2">
        <Pill valor={atual.status} />
        <Pill valor="mista" />
      </div>
      <Card>
        <CardContent className="py-4 grid gap-3">
          <Campo label="Cliente">
            <Select disabled={!rascunho || !canEdit} value={form.clienteId || undefined} onValueChange={(clienteId) => setForm({ ...form, clienteId })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(clientes.data ?? []).map((cliente) => (
                  <SelectItem key={cliente.id} value={cliente.id}>{cliente.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <TextosPropostaCampos
            value={form}
            disabled={!rascunho || !canEdit}
            onChange={(textos) => setForm({ ...form, ...textos })}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <Campo label="Início sugerido">
              <Input disabled={!rascunho || !canEdit} type="date" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} />
            </Campo>
            <Campo label="Fim sugerido">
              <Input disabled={!rascunho || !canEdit} type="date" value={form.fim} onChange={(e) => setForm({ ...form, fim: e.target.value })} />
            </Campo>
          </div>
          <FormaPagamentoCampos
            valor={form.valor}
            onValorChange={(valor) => setForm({ ...form, valor })}
            disabled={!rascunho || !canEdit}
            value={form}
            onChange={(agenda) => setForm({ ...form, ...agenda })}
          />
          <p className="text-xs text-muted-foreground">
            {atual.enviadaEm ? `Enviada em ${dataBr(atual.enviadaEm.slice(0, 10))}. ` : ""}
            {atual.aceitaEm ? `Aceita em ${dataBr(atual.aceitaEm.slice(0, 10))}.` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                executar(async () => {
                  if (rascunho && canEdit) await salvarProposta(atual, form);
                  await baixarPdf(atual.id, `${atual.numero}-v${atual.versao}.pdf`);
                }, "PDF do cliente gerado")
              }
            >
              Gerar PDF do cliente
            </Button>
            {canEdit && (
            <>
              {!atual.contratoId && (
                <Button variant="ghost" onClick={() => executar(async () => { await excluirProposta(atual); navigate("/propostas"); }, "Proposta excluída")}>Excluir</Button>
              )}
              {rascunho && (
                <>
                  <Button variant="outline" onClick={() => executar(async () => { await salvarProposta(atual, form); await recarregar(); }, "Rascunho salvo")}>Salvar</Button>
                  <Button onClick={() => executar(async () => { await salvarProposta(atual, form); await mudarProposta(atual, "enviar"); await recarregar(); }, "Proposta enviada")}>Enviar</Button>
                  <Button variant="ghost" onClick={() => executar(() => mudarProposta(atual, "recusar").then(recarregar), "Proposta recusada")}>Recusar</Button>
                  <Button variant="ghost" onClick={() => executar(() => mudarProposta(atual, "expirar").then(recarregar), "Proposta expirada")}>Expirar</Button>
                </>
              )}
              {atual.status === "enviada" && (
                <>
                  <Button onClick={() => executar(async () => { const aviso = await mudarProposta(atual, "aceitar"); await recarregar(); if (aviso) toast.message(aviso); }, "Proposta aceita")}>Aceitar</Button>
                  <Button variant="ghost" onClick={() => executar(() => mudarProposta(atual, "recusar").then(recarregar), "Proposta recusada")}>Recusar</Button>
                  <Button variant="ghost" onClick={() => executar(() => mudarProposta(atual, "expirar").then(recarregar), "Proposta expirada")}>Expirar</Button>
                </>
              )}
              {!rascunho && (
                <Button
                  variant="outline"
                  onClick={() =>
                    executar(async () => {
                      const nova = await criarVersao(atual, existeRascunho);
                      await recarregar();
                      navigate(`/propostas/${nova}`);
                    }, "Nova versão criada")
                  }
                >
                  Nova versão
                </Button>
              )}
              {atual.status === "aceita" && !atual.contratoId && (
                <Button
                  onClick={() =>
                    executar(async () => {
                      const contratoId = await criarContratoDaProposta(atual);
                      await recarregar();
                      navigate(`/contratos/${contratoId}`);
                    }, "Contrato criado em rascunho")
                  }
                >
                  Criar contrato
                </Button>
              )}
              {atual.contratoId && (
                <Button variant="outline" asChild>
                  <Link to={`/contratos/${atual.contratoId}`}>Abrir contrato</Link>
                </Button>
              )}
            </>
            )}
            </div>
        </CardContent>
      </Card>
      {atual.status === "aceita" && (
        <ContasDaProposta
          propostaId={atual.id}
          contratoId={atual.contratoId}
          canEdit={canEdit}
          clienteNome={atual.clienteNome}
          agenda={atual.agenda}
        />
      )}
      <PainelAssinatura
        tipo="proposta"
        documentoId={atual.id}
        clienteId={atual.clienteId}
        liberado={canEdit && atual.status !== "recusada" && atual.status !== "expirada"}
      />
    </div>
  );
}

async function baixarPdf(id: string, nome: string): Promise<void> {
  const sessao = await supabase?.auth.getSession();
  const token = sessao?.data.session?.access_token;
  if (!token) throw new Error("Entre de novo.");
  const resposta = await fetch(`/api/propostas/${id}/pdf`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => ({}))) as { message?: string };
    throw new Error(corpo.message ?? "Não foi possível gerar o PDF.");
  }
  const blob = await resposta.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  link.click();
  URL.revokeObjectURL(url);
}
