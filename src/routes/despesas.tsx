import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvisoConsulta, Campo, CampoDinheiro, CampoDocumento, Pill, TituloPagina, dataBr, executar, mesAtual, reais, reaisInput, rotulo } from "@/components/erp/apresentacao";
import { useAuth } from "@/lib/auth-context";
import { cancelarConta, criarDespesa, encerrarRecorrencia, excluirContaPagar, excluirDespesa, gerarRecorrenciasAbertas, lancarRecorrencia, listarCentros, listarDespesas, pagarConta, salvarDespesa } from "@/services/erp/api";
import type { DespesaItem } from "@/services/erp/api";
import { toast } from "sonner";
import { totaisDoMes, type CentroTipo } from "@/services/erp/domain";

const vazio = {
  tipo: "operacional" as "operacional" | "financeira",
  categoria: "",
  descricao: "",
  favorecidoNome: "",
  favorecidoDocumento: "",
  valor: "",
  vencimento: "",
  centroId: "",
  modo: "avulsa" as "avulsa" | "com_prazo" | "sem_prazo",
  diaVencimento: "",
  quantidadeMeses: "",
};

function textoRecorrencia(item: Pick<DespesaItem, "recorrenciaModo" | "recorrenciaStatus" | "parcela" | "quantidadeMeses">): string | null {
  if (!item.recorrenciaModo) return null;
  const encerrada = item.recorrenciaStatus === "encerrada" ? " · encerrada" : "";
  if (item.recorrenciaModo === "com_prazo") return `Recorrente com prazo · parcela ${item.parcela ?? "—"} de ${item.quantidadeMeses ?? "—"}${encerrada}`;
  return `Recorrente sem prazo${encerrada}`;
}

export function DespesasPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const [mes, setMes] = useState(mesAtual);
  const [form, setForm] = useState(vazio);
  const [editando, setEditando] = useState<string | null>(null);
  const [pagamento, setPagamento] = useState<Record<string, string>>({});
  const centros = useQuery({ queryKey: ["erp", "centros"], queryFn: listarCentros });
  const despesas = useQuery({ queryKey: ["erp", "despesas"], queryFn: listarDespesas });
  const geracao = useRef(false);

  const disponiveis = (centros.data ?? []).filter((centro) => {
    if (!centro.ativo) return false;
    return form.tipo === "financeira" ? centro.tipo === "financeiro" : centro.tipo !== "financeiro";
  });
  const doMes = (despesas.data ?? []).filter((item) => item.competencia.slice(0, 7) === mes);
  const totais = useMemo(
    () =>
      totaisDoMes(
        (despesas.data ?? []).map((item) => ({
          centroId: item.centroId,
          centroNome: item.centroNome,
          tipo: item.tipo,
          valor: item.valor,
          competencia: item.competencia,
          cancelada: item.cancelada,
        })),
        mes,
      ),
    [despesas.data, mes],
  );

  const recarregar = () => qc.invalidateQueries({ queryKey: ["erp"] });
  useEffect(() => {
    if (!canEdit || geracao.current) return;
    geracao.current = true;
    gerarRecorrenciasAbertas()
      .then((criadas) => {
        if (criadas > 0) {
          toast.success(criadas === 1 ? "Título recorrente do mês lançado." : `${criadas} títulos recorrentes lançados até o mês atual.`);
          recarregar();
        }
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Não foi possível gerar a recorrência.");
      });
  }, [canEdit, qc]);
  const centro = disponiveis.find((item) => item.id === form.centroId) ?? disponiveis[0];
  const tituloAberto = id ? (despesas.data ?? []).find((item) => item.id === id) : undefined;

  if (id) {
    return (
      <div className="space-y-6">
        <TituloPagina titulo="Título a pagar" descricao="A exclusão apaga só esta conta. A despesa, os outros títulos e o favorecido permanecem." />
        <AvisoConsulta erro={despesas.error} />
        {!despesas.isLoading && !tituloAberto && <p className="text-sm text-muted-foreground">Título não encontrado.</p>}
        {tituloAberto && (
          <Card>
            <CardContent className="space-y-3 py-4">
              <div className="font-medium">{tituloAberto.descricao}</div>
              <p className="text-sm text-muted-foreground">
                {tituloAberto.favorecidoNome} · {reais(tituloAberto.valor)} · vence {dataBr(tituloAberto.vencimento)}
              </p>
              {textoRecorrencia(tituloAberto) && <p className="text-sm text-muted-foreground">{textoRecorrencia(tituloAberto)}</p>}
              {tituloAberto.contaId ? <Pill valor={tituloAberto.contaStatus} /> : <p className="text-sm text-muted-foreground">Este lançamento não tem título a pagar.</p>}
              {canEdit && tituloAberto.recorrenciaId && tituloAberto.recorrenciaStatus === "ativa" && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    executar(async () => {
                      const mensagem = await encerrarRecorrencia(tituloAberto.recorrenciaId!);
                      await recarregar();
                      return mensagem;
                    }, "Recorrência encerrada")
                  }
                >
                  Encerrar recorrência
                </Button>
              )}
              {canEdit && tituloAberto.contaId && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    executar(async () => {
                      await excluirContaPagar(tituloAberto.contaId!);
                      await recarregar();
                      navigate("/despesas");
                    }, "Título excluído")
                  }
                >
                  Excluir título
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TituloPagina
        titulo="Despesas"
        descricao="Cada despesa abre uma conta a pagar. A recorrência com prazo projeta um título por mês. A sem prazo lança o mês atual e, no mês seguinte, gera o próximo até encerrar. Operacional cai em contrato ou indireto. Financeira cai só no centro financeiro e fica fora da margem."
      />
      <AvisoConsulta erro={centros.error ?? despesas.error} />
      <Campo label="Competência">
        <Input type="month" className="max-w-xs" value={mes} onChange={(e) => setMes(e.target.value)} />
      </Campo>
      <div className="grid gap-3 md:grid-cols-3">
        {totais.length === 0 && <p className="text-sm text-muted-foreground">Nenhum total neste mês.</p>}
        {totais.map((linha) => (
          <Card key={`${linha.centroId}-${linha.tipo}`}>
            <CardContent className="py-4">
              <div className="text-sm text-muted-foreground">{linha.centroNome}</div>
              <div className="font-medium">{rotulo(linha.tipo)}</div>
              <div className="text-lg">{reais(linha.total)}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      {canEdit && (
        <Card>
          <CardContent className="py-4 grid gap-3 md:grid-cols-2">
            <Campo label="Tipo">
              <Select value={form.tipo} onValueChange={(tipo: "operacional" | "financeira") => setForm({ ...form, tipo, categoria: "", centroId: "" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="operacional">Operacional</SelectItem>
                  <SelectItem value="financeira">Financeira</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Categoria">
              {form.tipo === "financeira" ? (
                <Select value={form.categoria || undefined} onValueChange={(categoria) => setForm({ ...form, categoria })}>
                  <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="juros">Juros</SelectItem>
                    <SelectItem value="tarifa_bancaria">Tarifa bancária</SelectItem>
                    <SelectItem value="iof">IOF</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} placeholder="Deslocamento" />
              )}
            </Campo>
            <Campo label="Descrição">
              <Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
            </Campo>
            <Campo label={form.modo === "avulsa" || editando ? "Favorecido" : "Fornecedor"}>
              <Input value={form.favorecidoNome} onChange={(e) => setForm({ ...form, favorecidoNome: e.target.value })} />
            </Campo>
            <Campo label={form.modo === "avulsa" || editando ? "Documento do favorecido" : "Documento do fornecedor"}>
              <CampoDocumento tipo="ambos" value={form.favorecidoDocumento} onChange={(favorecidoDocumento) => setForm({ ...form, favorecidoDocumento })} />
            </Campo>
            <Campo label="Valor">
              <CampoDinheiro value={form.valor} onChange={(valor) => setForm({ ...form, valor })} />
            </Campo>
            {!editando && (
              <Campo label="Recorrência">
                <Select value={form.modo} onValueChange={(modo: "avulsa" | "com_prazo" | "sem_prazo") => setForm({ ...form, modo, quantidadeMeses: modo === "com_prazo" ? form.quantidadeMeses : "" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="avulsa">Não recorrente</SelectItem>
                    <SelectItem value="com_prazo">Com prazo</SelectItem>
                    <SelectItem value="sem_prazo">Sem prazo</SelectItem>
                  </SelectContent>
                </Select>
              </Campo>
            )}
            {form.modo === "avulsa" || editando ? (
              <Campo label="Vencimento da conta">
                <Input type="date" value={form.vencimento} onChange={(e) => setForm({ ...form, vencimento: e.target.value })} />
              </Campo>
            ) : (
              <>
                <Campo label="Dia do vencimento">
                  <Input inputMode="numeric" value={form.diaVencimento} onChange={(e) => setForm({ ...form, diaVencimento: e.target.value })} placeholder="10" />
                </Campo>
                <Campo label="Primeiro vencimento">
                  <Input type="date" value={form.vencimento} onChange={(e) => setForm({ ...form, vencimento: e.target.value })} />
                </Campo>
                {form.modo === "com_prazo" && (
                  <Campo label="Quantidade de meses">
                    <Input inputMode="numeric" value={form.quantidadeMeses} onChange={(e) => setForm({ ...form, quantidadeMeses: e.target.value })} placeholder="12" />
                  </Campo>
                )}
              </>
            )}
            <Campo label="Centro de custo">
              {disponiveis.length > 0 ? (
                <Select value={centro?.id} onValueChange={(centroId) => setForm({ ...form, centroId })}>
                  <SelectTrigger><SelectValue placeholder="Escolha o centro" /></SelectTrigger>
                  <SelectContent>
                    {disponiveis.map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum centro disponível para este tipo.</p>
              )}
            </Campo>
            {form.modo === "com_prazo" && !editando && (
              <p className="text-sm text-muted-foreground md:col-span-2">Um título a pagar por mês, já projetado, do primeiro vencimento até a quantidade informada. O valor se repete em cada parcela.</p>
            )}
            {form.modo === "sem_prazo" && !editando && (
              <p className="text-sm text-muted-foreground md:col-span-2">Lança o título do mês atual. No mês seguinte, esta tela gera o próximo, até alguém encerrar. Não projeta os meses futuros.</p>
            )}
            <div className="md:col-span-2">
              <Button
                onClick={() =>
                  executar(async () => {
                    if (!centro) throw new Error("Cadastre o centro antes da despesa.");
                    if (editando || form.modo === "avulsa") {
                      const entrada = {
                        tipo: form.tipo,
                        categoria: form.categoria,
                        descricao: form.descricao,
                        favorecidoNome: form.favorecidoNome,
                        favorecidoDocumento: form.favorecidoDocumento,
                        valor: form.valor,
                        competencia: mes,
                        vencimento: form.vencimento,
                        centroId: centro.id,
                        tipoCentro: centro.tipo as CentroTipo,
                      };
                      if (editando) await salvarDespesa(editando, entrada);
                      else await criarDespesa(entrada);
                      setEditando(null);
                      setForm(vazio);
                      await recarregar();
                      return;
                    }
                    const mensagem = await lancarRecorrencia({
                      modo: form.modo,
                      tipo: form.tipo,
                      categoria: form.categoria,
                      descricao: form.descricao,
                      favorecidoNome: form.favorecidoNome,
                      favorecidoDocumento: form.favorecidoDocumento,
                      valor: form.valor,
                      diaVencimento: form.diaVencimento,
                      primeiroVencimento: form.vencimento,
                      quantidadeMeses: form.modo === "com_prazo" ? form.quantidadeMeses : "",
                      centroId: centro.id,
                      tipoCentro: centro.tipo as CentroTipo,
                    });
                    setForm(vazio);
                    await recarregar();
                    return mensagem;
                  }, editando ? "Despesa atualizada" : form.modo === "avulsa" ? "Despesa e conta a pagar lançadas" : "Recorrência lançada")
                }
              >
                {editando ? "Salvar despesa" : form.modo === "avulsa" ? "Lançar despesa" : "Lançar recorrência"}
              </Button>
              {editando && (
                <Button variant="ghost" className="ml-2" onClick={() => { setEditando(null); setForm(vazio); }}>Cancelar edição</Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3">
        {doMes.map((item) => (
          <Card key={item.id}>
            <CardContent className="py-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{item.descricao}</div>
                  <div className="text-sm text-muted-foreground">
                    {item.favorecidoNome} · {item.centroNome} · {rotulo(item.categoria)} · vence {dataBr(item.vencimento)}
                  </div>
                  {textoRecorrencia(item) && <div className="text-sm text-muted-foreground">{textoRecorrencia(item)}</div>}
                </div>
                <div className="text-right">
                  <div className="font-medium">{reais(item.valor)}</div>
                  <div className="mt-1 flex justify-end gap-2">
                    <Pill valor={item.tipo} />
                    <Pill valor={item.contaStatus} />
                  </div>
                </div>
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => navigate(`/despesas/${item.id}`)}>Abrir título</Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditando(item.id);
                      setMes(item.competencia.slice(0, 7));
                      setForm({
                        tipo: item.tipo,
                        categoria: item.categoria,
                        descricao: item.descricao,
                        favorecidoNome: item.favorecidoNome,
                        favorecidoDocumento: item.favorecidoDocumento,
                        valor: reaisInput(item.valor),
                        vencimento: item.vencimento ?? "",
                        centroId: item.centroId,
                        modo: "avulsa",
                        diaVencimento: "",
                        quantidadeMeses: "",
                      });
                    }}
                  >
                    Editar
                  </Button>
                  {item.contaStatus !== "paga" && (
                    <Button variant="ghost" onClick={() => executar(() => excluirDespesa(item.id, item.contaStatus).then(recarregar), "Despesa excluída")}>Excluir</Button>
                  )}
                  {item.recorrenciaId && item.recorrenciaStatus === "ativa" && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        executar(async () => {
                          const mensagem = await encerrarRecorrencia(item.recorrenciaId!);
                          await recarregar();
                          return mensagem;
                        }, "Recorrência encerrada")
                      }
                    >
                      Encerrar recorrência
                    </Button>
                  )}
                </div>
              )}
              {canEdit && item.contaStatus === "a_pagar" && item.contaId && (
                <div className="flex flex-wrap items-end gap-2">
                  <Campo label="Data do pagamento">
                    <Input
                      type="date"
                      value={pagamento[item.contaId] ?? ""}
                      onChange={(e) => setPagamento({ ...pagamento, [item.contaId!]: e.target.value })}
                    />
                  </Campo>
                  <Button
                    variant="outline"
                    onClick={() =>
                      executar(async () => {
                        await pagarConta(item.contaId!, item.contaStatus, pagamento[item.contaId!] ?? "");
                        await recarregar();
                      }, "Conta paga")
                    }
                  >
                    Pagar
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      executar(async () => {
                        await cancelarConta(item.contaId!, item.contaStatus);
                        await recarregar();
                      }, "Conta cancelada")
                    }
                  >
                    Cancelar
                  </Button>
                </div>
              )}
              {item.dataPagamento && <p className="text-xs text-muted-foreground">Pago em {dataBr(item.dataPagamento)}.</p>}
            </CardContent>
          </Card>
        ))}
        {doMes.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma despesa nesta competência.</p>}
      </div>
    </div>
  );
}
