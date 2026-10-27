import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvisoConsulta, Campo, CampoDinheiro, CampoDocumento, Pill, TituloPagina, dataBr, executar, mesAtual, reais, reaisInput, rotulo } from "@/components/erp/apresentacao";
import { useAuth } from "@/lib/auth-context";
import { cancelarConta, criarDespesa, excluirDespesa, listarCentros, listarDespesas, pagarConta, salvarDespesa } from "@/services/erp/api";
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
};

export function DespesasPage() {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const [mes, setMes] = useState(mesAtual);
  const [form, setForm] = useState(vazio);
  const [editando, setEditando] = useState<string | null>(null);
  const [pagamento, setPagamento] = useState<Record<string, string>>({});
  const centros = useQuery({ queryKey: ["erp", "centros"], queryFn: listarCentros });
  const despesas = useQuery({ queryKey: ["erp", "despesas"], queryFn: listarDespesas });

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
  const centro = disponiveis.find((item) => item.id === form.centroId) ?? disponiveis[0];

  return (
    <div className="space-y-6">
      <TituloPagina
        titulo="Despesas"
        descricao="Cada despesa abre uma conta a pagar. Operacional cai em contrato ou indireto. Financeira cai só no centro financeiro e fica fora da margem."
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
            <Campo label="Favorecido">
              <Input value={form.favorecidoNome} onChange={(e) => setForm({ ...form, favorecidoNome: e.target.value })} />
            </Campo>
            <Campo label="Documento do favorecido">
              <CampoDocumento tipo="ambos" value={form.favorecidoDocumento} onChange={(favorecidoDocumento) => setForm({ ...form, favorecidoDocumento })} />
            </Campo>
            <Campo label="Valor">
              <CampoDinheiro value={form.valor} onChange={(valor) => setForm({ ...form, valor })} />
            </Campo>
            <Campo label="Vencimento da conta">
              <Input type="date" value={form.vencimento} onChange={(e) => setForm({ ...form, vencimento: e.target.value })} />
            </Campo>
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
            <div className="md:col-span-2">
              <Button
                onClick={() =>
                  executar(async () => {
                    if (!centro) throw new Error("Cadastre o centro antes da despesa.");
                    const entrada = { ...form, centroId: centro.id, tipoCentro: centro.tipo as CentroTipo, competencia: mes };
                    if (editando) await salvarDespesa(editando, entrada);
                    else await criarDespesa(entrada);
                    setEditando(null);
                    setForm(vazio);
                    await recarregar();
                  }, editando ? "Despesa atualizada" : "Despesa e conta a pagar lançadas")
                }
              >
                {editando ? "Salvar despesa" : "Lançar despesa"}
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
                      });
                    }}
                  >
                    Editar
                  </Button>
                  {item.contaStatus !== "paga" && (
                    <Button variant="ghost" onClick={() => executar(() => excluirDespesa(item.id, item.contaStatus).then(recarregar), "Despesa excluída")}>Excluir</Button>
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
