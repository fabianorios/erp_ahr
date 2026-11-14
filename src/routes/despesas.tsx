import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvisoConsulta, Campo, CampoDinheiro, CampoDocumento, Pill, TituloPagina, dataBr, executar, mesAtual, reais, reaisInput, rotulo } from "@/components/erp/apresentacao";
import { ListaFinanceira, filtroVisivelVazio, type FiltroVisivel, type LinhaLista } from "@/components/erp/lista-financeira";
import { useAuth } from "@/lib/auth-context";
import { cancelarConta, criarDespesa, encerrarRecorrencia, excluirContaPagar, excluirDespesa, gerarRecorrenciasAbertas, lancarRecorrencia, listarCentros, listarDespesas, pagarConta, salvarDespesa } from "@/services/erp/api";
import type { DespesaItem } from "@/services/erp/api";
import { toast } from "sonner";
import { passaFiltro, type CriterioLista } from "@/services/erp/lista";
import { reaisToCents, type CentroTipo } from "@/services/erp/domain";

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

const STATUS_PAGAR = [
  { valor: "a_pagar", rotulo: "A pagar" },
  { valor: "paga", rotulo: "Paga" },
  { valor: "cancelada", rotulo: "Cancelada" },
];

const RECORRENCIAS_PAGAR = [
  { valor: "avulsa", rotulo: "Não recorrente" },
  { valor: "com_prazo", rotulo: "Com prazo" },
  { valor: "sem_prazo", rotulo: "Sem prazo" },
];

function textoRecorrencia(item: Pick<DespesaItem, "recorrenciaModo" | "recorrenciaStatus" | "parcela" | "quantidadeMeses">): string | null {
  if (!item.recorrenciaModo) return null;
  const encerrada = item.recorrenciaStatus === "encerrada" ? " · encerrada" : "";
  if (item.recorrenciaModo === "com_prazo") return `Recorrente com prazo · parcela ${item.parcela ?? "—"} de ${item.quantidadeMeses ?? "—"}${encerrada}`;
  return `Recorrente sem prazo${encerrada}`;
}

function recorrenciaDe(item: DespesaItem): string {
  if (!item.recorrenciaId) return "avulsa";
  return item.recorrenciaModo ?? "com_prazo";
}

function criterioDe(filtro: FiltroVisivel): CriterioLista {
  return {
    de: filtro.de,
    ate: filtro.ate,
    pessoa: filtro.pessoa,
    status: filtro.status,
    valorMin: limite(filtro.valorMin),
    valorMax: limite(filtro.valorMax),
    centro: filtro.centro,
    recorrencia: filtro.recorrencia,
    documento: "todos",
  };
}

function limite(texto: string): number | null {
  if (!texto.trim()) return null;
  try {
    return reaisToCents(texto);
  } catch {
    return null;
  }
}

export function DespesasPage() {
  const { id } = useParams();
  const caminho = useLocation().pathname;
  const incluindo = caminho.endsWith("/novo");
  const alterando = caminho.endsWith("/editar");
  if (!id && !incluindo) return <ListaDespesas />;
  if (id && !alterando) return <VerDespesa id={id} />;
  return <FormularioDespesa id={alterando ? id : undefined} />;
}

function ListaDespesas() {
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const despesas = useQuery({ queryKey: ["erp", "despesas"], queryFn: listarDespesas });
  const centros = useQuery({ queryKey: ["erp", "centros"], queryFn: listarCentros });
  const [filtro, setFiltro] = useState(filtroVisivelVazio);
  const geracao = useRef(false);
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

  const linhas = despesas.data ?? [];
  const criterio = criterioDe(filtro);
  const filtradas = linhas.filter((item) =>
    passaFiltro(
      {
        pessoaId: item.favorecidoNome,
        status: item.contaStatus,
        vencimento: item.vencimento,
        valor: item.valor,
        centroId: item.centroId,
        recorrencia: recorrenciaDe(item),
        nota: false,
        boleto: false,
      },
      criterio,
    ),
  );
  const pessoas = [...new Set(linhas.map((item) => item.favorecidoNome).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")).map((nome) => ({ valor: nome, rotulo: nome }));
  const centrosOpcoes = [...new Map((centros.data ?? []).map((centro) => [centro.id, centro.nome])).entries()].map(([valor, rotuloCentro]) => ({ valor, rotulo: rotuloCentro }));
  const tabela: LinhaLista[] = filtradas.map((item) => ({
    id: item.id,
    pessoa: item.favorecidoNome,
    descricao: item.descricao,
    valor: item.valor,
    vencimento: item.vencimento,
    status: item.contaStatus,
    detalhe: [item.centroNome, textoRecorrencia(item)].filter(Boolean).join(" · "),
    podeExcluir: item.contaStatus !== "paga",
    motivoBloqueio: "Conta paga não pode ser excluída.",
  }));

  return (
    <ListaFinanceira
      titulo="Contas a pagar"
      descricao="A lista de todos os títulos a pagar. Incluir abre o lançamento e, ao gravar ou cancelar, volta para cá."
      erro={despesas.error ?? centros.error}
      carregando={despesas.isLoading}
      canEdit={canEdit}
      rotuloPessoa="Fornecedor"
      pessoas={pessoas}
      statusOpcoes={STATUS_PAGAR}
      centros={centrosOpcoes}
      recorrencias={RECORRENCIAS_PAGAR}
      filtro={filtro}
      onFiltro={setFiltro}
      linhas={tabela}
      onIncluir={() => navigate("/despesas/novo")}
      onVer={(itemId) => navigate(`/despesas/${itemId}`)}
      onAlterar={(itemId) => navigate(`/despesas/${itemId}/editar`)}
      onExcluir={(itemId) => {
        const item = linhas.find((linha) => linha.id === itemId);
        if (!item) return;
        void executar(() => excluirDespesa(item.id, item.contaStatus).then(recarregar), "Despesa excluída");
      }}
    />
  );
}

function VerDespesa({ id }: { id: string }) {
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const despesas = useQuery({ queryKey: ["erp", "despesas"], queryFn: listarDespesas });
  const [pagamento, setPagamento] = useState("");
  const item = (despesas.data ?? []).find((linha) => linha.id === id);
  const recarregar = () => qc.invalidateQueries({ queryKey: ["erp"] });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TituloPagina titulo="Título a pagar" descricao="A exclusão do título apaga só esta conta. A despesa, os outros títulos e o favorecido permanecem." />
        <Button type="button" variant="outline" onClick={() => navigate("/despesas")}>Voltar para a lista</Button>
      </div>
      <AvisoConsulta erro={despesas.error} />
      {!despesas.isLoading && !item && <p className="text-sm text-muted-foreground">Título não encontrado.</p>}
      {item && (
        <Card>
          <CardContent className="space-y-3 py-4">
            <div className="font-medium">{item.descricao}</div>
            <p className="text-sm text-muted-foreground">
              {item.favorecidoNome} · {item.centroNome} · {rotulo(item.categoria)} · {reais(item.valor)} · vence {dataBr(item.vencimento)}
            </p>
            <div className="flex gap-2">
              <Pill valor={item.tipo} />
              <Pill valor={item.contaStatus} />
            </div>
            {textoRecorrencia(item) && <p className="text-sm text-muted-foreground">{textoRecorrencia(item)}</p>}
            {item.dataPagamento && <p className="text-xs text-muted-foreground">Pago em {dataBr(item.dataPagamento)}.</p>}
            {!item.contaId && <p className="text-sm text-muted-foreground">Este lançamento não tem título a pagar.</p>}
            <div className="flex flex-wrap gap-2">
              {canEdit && <Button type="button" variant="outline" onClick={() => navigate(`/despesas/${item.id}/editar`)}>Alterar</Button>}
              {canEdit && item.recorrenciaId && item.recorrenciaStatus === "ativa" && (
                <Button
                  type="button"
                  variant="outline"
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
              {canEdit && item.contaId && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    executar(async () => {
                      await excluirContaPagar(item.contaId!);
                      await recarregar();
                      navigate("/despesas");
                    }, "Título excluído")
                  }
                >
                  Excluir título
                </Button>
              )}
            </div>
            {canEdit && item.contaStatus === "a_pagar" && item.contaId && (
              <div className="flex flex-wrap items-end gap-2">
                <Campo label="Data do pagamento">
                  <Input type="date" value={pagamento} onChange={(event) => setPagamento(event.target.value)} />
                </Campo>
                <Button
                  variant="outline"
                  onClick={() =>
                    executar(async () => {
                      await pagarConta(item.contaId!, item.contaStatus, pagamento);
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FormularioDespesa({ id }: { id?: string }) {
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const [mes, setMes] = useState(mesAtual);
  const [form, setForm] = useState(vazio);
  const [editando, setEditando] = useState<string | null>(id ?? null);
  const centros = useQuery({ queryKey: ["erp", "centros"], queryFn: listarCentros });
  const despesas = useQuery({ queryKey: ["erp", "despesas"], queryFn: listarDespesas });
  const carregado = useRef<string | null>(null);
  const recarregar = () => qc.invalidateQueries({ queryKey: ["erp"] });

  useEffect(() => {
    if (!id || !despesas.data || carregado.current === id) return;
    const item = despesas.data.find((linha) => linha.id === id);
    if (!item) return;
    carregado.current = id;
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
  }, [id, despesas.data]);

  const disponiveis = (centros.data ?? []).filter((centro) => {
    if (!centro.ativo) return false;
    return form.tipo === "financeira" ? centro.tipo === "financeiro" : centro.tipo !== "financeiro";
  });
  const centro = disponiveis.find((item) => item.id === form.centroId) ?? disponiveis[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TituloPagina
          titulo={editando ? "Alterar conta a pagar" : "Incluir conta a pagar"}
          descricao="Cada despesa abre uma conta a pagar. A recorrência com prazo projeta um título por mês. A sem prazo lança o mês atual e, no mês seguinte, gera o próximo até encerrar."
        />
        <Button type="button" variant="outline" onClick={() => navigate("/despesas")}>Cancelar</Button>
      </div>
      <AvisoConsulta erro={centros.error ?? despesas.error} />
      {id && !despesas.isLoading && !despesas.data?.some((item) => item.id === id) && <p className="text-sm text-muted-foreground">Título não encontrado.</p>}
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
            <Campo label="Competência">
              <Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
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
            <div className="md:col-span-2 flex gap-2">
              <Button
                onClick={() =>
                  executar(async () => {
                    if (!centro) throw new Error("Cadastre o centro antes da despesa.");
                    let mensagem: string | undefined;
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
                    } else {
                      mensagem = await lancarRecorrencia({
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
                    }
                    await recarregar();
                    navigate("/despesas");
                    return mensagem;
                  }, editando ? "Despesa atualizada" : form.modo === "avulsa" ? "Despesa e conta a pagar lançadas" : "Recorrência lançada")
                }
              >
                Gravar
              </Button>
              <Button type="button" variant="ghost" onClick={() => navigate("/despesas")}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
