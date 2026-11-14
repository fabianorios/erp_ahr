import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvisoConsulta, Campo, CampoDinheiro, Pill, TituloPagina, executar, mesAtual, reais, reaisInput } from "@/components/erp/apresentacao";
import { useAuth } from "@/lib/auth-context";
import { excluirCusto, listarCentros, listarColaboradores, obterCusto, salvarCusto, salvarRateio } from "@/services/erp/api";
import { formatPercentBp, percentToBp, validarCusto, valorRateado } from "@/services/erp/domain";

export function PessoalPage() {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const [colaboradorId, setColaboradorId] = useState("");
  const [mes, setMes] = useState(mesAtual);
  const [salario, setSalario] = useState("0,00");
  const [encargos, setEncargos] = useState("0,00");
  const [beneficios, setBeneficios] = useState("0,00");
  const [linhas, setLinhas] = useState<{ centroId: string; percentual: string }[]>([]);
  const colaboradores = useQuery({ queryKey: ["erp", "colaboradores"], queryFn: listarColaboradores });
  const centros = useQuery({ queryKey: ["erp", "centros"], queryFn: listarCentros });
  const custo = useQuery({
    queryKey: ["erp", "custo", colaboradorId, mes],
    queryFn: () => obterCusto(colaboradorId, mes),
    enabled: Boolean(colaboradorId),
  });
  const destinos = (centros.data ?? []).filter((centro) => centro.ativo && centro.tipo !== "financeiro");
  const chave = custo.data ? `${custo.data.id}:${custo.data.status}` : `novo:${colaboradorId}:${mes}`;

  useEffect(() => {
    if (custo.data) {
      setSalario(reaisInput(custo.data.salario));
      setEncargos(reaisInput(custo.data.encargos));
      setBeneficios(reaisInput(custo.data.beneficios));
      setLinhas(custo.data.linhas);
      return;
    }
    setSalario("0,00");
    setEncargos("0,00");
    setBeneficios("0,00");
    setLinhas([]);
  }, [chave, custo.data]);

  const fechado = custo.data?.status === "fechado";
  let total = 0;
  try {
    total = validarCusto({ salario, encargos, beneficios, competencia: mes }).total;
  } catch {
    total = 0;
  }
  const soma = linhas.reduce((acc, linha) => {
    try {
      return acc + percentToBp(linha.percentual || "0");
    } catch {
      return acc;
    }
  }, 0);

  const recarregar = async () => {
    await qc.invalidateQueries({ queryKey: ["erp"] });
  };

  const gravar = (fechar: boolean) =>
    executar(async () => {
      const id = await salvarCusto({
        id: custo.data?.id ?? null,
        colaboradorId,
        competencia: mes,
        salario,
        encargos,
        beneficios,
        status: custo.data?.status ?? null,
      });
      await salvarRateio({
        custoId: id,
        status: custo.data?.status ?? "rascunho",
        total,
        fechar,
        linhas: linhas.map((linha) => ({
          ...linha,
          tipoCentro: centros.data?.find((centro) => centro.id === linha.centroId)?.tipo ?? "indireto",
        })),
      });
      await recarregar();
    }, fechar ? "Custo fechado" : "Custo salvo");

  return (
    <div className="space-y-6">
      <TituloPagina
        titulo="Custo de pessoal"
        descricao="O colaborador é uma pessoa do tipo colaborador, em Cadastros. Aqui ficam o custo do mês e o rateio, que fecha em 100%."
      />
      <AvisoConsulta erro={colaboradores.error ?? centros.error ?? custo.error} />
      <div className="grid gap-3 md:grid-cols-2">
        <Campo label="Colaborador">
          <Select value={colaboradorId || undefined} onValueChange={setColaboradorId}>
            <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
            <SelectContent>
              {(colaboradores.data ?? []).map((pessoa) => (
                <SelectItem key={pessoa.id} value={pessoa.id}>{pessoa.nome}{pessoa.ativo ? "" : " (inativo)"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo label="Competência">
          <Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
        </Campo>
      </div>
      {colaboradorId && (
        <Card>
          <CardContent className="py-4 space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="font-medium">Custo do mês</h2>
              {custo.data && <Pill valor={custo.data.status} />}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Campo label="Salário">
                <CampoDinheiro disabled={fechado || !canEdit} value={salario} onChange={setSalario} />
              </Campo>
              <Campo label="Encargos">
                <CampoDinheiro disabled={fechado || !canEdit} value={encargos} onChange={setEncargos} />
              </Campo>
              <Campo label="Benefícios">
                <CampoDinheiro disabled={fechado || !canEdit} value={beneficios} onChange={setBeneficios} />
              </Campo>
            </div>
            <p className="text-sm">Total {reais(total)}. Rateio {formatPercentBp(soma)}.</p>
            <div className="space-y-2">
              {linhas.map((linha, index) => {
                let valor = 0;
                try {
                  valor = valorRateado(total, percentToBp(linha.percentual || "0"));
                } catch {
                  valor = 0;
                }
                return (
                  <div key={index} className="grid gap-2 md:grid-cols-[1fr_8rem_8rem_auto] items-end">
                    <Campo label="Centro">
                      <Select
                        disabled={fechado || !canEdit}
                        value={linha.centroId || undefined}
                        onValueChange={(centroId) => setLinhas(linhas.map((item, i) => (i === index ? { ...item, centroId } : item)))}
                      >
                        <SelectTrigger><SelectValue placeholder="Centro" /></SelectTrigger>
                        <SelectContent>
                          {destinos.map((centro) => (
                            <SelectItem key={centro.id} value={centro.id}>{centro.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Campo>
                    <Campo label="Percentual">
                      <Input
                        disabled={fechado || !canEdit}
                        value={linha.percentual}
                        onChange={(e) => setLinhas(linhas.map((item, i) => (i === index ? { ...item, percentual: e.target.value } : item)))}
                      />
                    </Campo>
                    <Campo label={fechado ? "No centro" : "Prévia"}>
                      <Input readOnly value={reais(valor)} />
                    </Campo>
                    {canEdit && !fechado && (
                      <Button variant="ghost" onClick={() => setLinhas(linhas.filter((_, i) => i !== index))}>Tirar</Button>
                    )}
                  </div>
                );
              })}
            </div>
            {canEdit && !fechado && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setLinhas([...linhas, { centroId: destinos[0]?.id ?? "", percentual: "" }])}>
                  Adicionar centro
                </Button>
                <Button variant="outline" onClick={() => gravar(false)}>Salvar rascunho</Button>
                <Button onClick={() => gravar(true)} disabled={soma !== 10000}>Fechar em 100%</Button>
                {custo.data && (
                  <Button variant="ghost" onClick={() => executar(() => excluirCusto(custo.data!.id, custo.data!.status).then(recarregar), "Custo excluído")}>Excluir custo</Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
