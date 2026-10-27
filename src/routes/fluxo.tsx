import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AvisoConsulta, Campo, Pill, TituloPagina, dataBr, fimDoMes, mesAtual, reais, rotulo } from "@/components/erp/apresentacao";
import { carregarFluxo } from "@/services/erp/api";

export function FluxoPage() {
  const [inicio, setInicio] = useState(`${mesAtual()}-01`);
  const [fim, setFim] = useState(fimDoMes(mesAtual()));
  const completo = Boolean(inicio && fim);
  const ordem = completo && fim >= inicio;
  const fluxo = useQuery({
    queryKey: ["erp", "fluxo", inicio, fim],
    queryFn: () => carregarFluxo(inicio, fim),
    enabled: ordem,
  });
  const totais = fluxo.data?.totais;

  return (
    <div className="space-y-6">
      <TituloPagina
        titulo="Fluxo de caixa"
        descricao="O previsto usa o vencimento dos títulos em aberto e das contas a pagar. O realizado usa a data da baixa e a data do pagamento. Só entram movimentos entre a data início e a data fim, inclusive. Registrar nota ou boleto não mexe no caixa."
      />
      <div className="flex flex-wrap gap-4">
        <Campo label="Data início">
          <Input type="date" required className="max-w-xs" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </Campo>
        <Campo label="Data fim">
          <Input type="date" required className="max-w-xs" value={fim} onChange={(e) => setFim(e.target.value)} />
        </Campo>
      </div>
      {completo ? (
        <p className="text-sm text-muted-foreground">Período: {dataBr(inicio)} a {dataBr(fim)}</p>
      ) : (
        <p className="text-sm text-muted-foreground">Informe a data início e a data fim.</p>
      )}
      {completo && !ordem && <p className="text-sm text-destructive">O fim do período não pode ser antes do início.</p>}
      <AvisoConsulta erro={fluxo.error} />
      {totais && (
        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <CardContent className="py-4">
              <div className="text-sm text-muted-foreground">Previsto</div>
              <div>Entradas {reais(totais.previstoEntradas)}</div>
              <div>Saídas {reais(totais.previstoSaidas)}</div>
              <div className="font-medium">Saldo {reais(totais.previstoEntradas - totais.previstoSaidas)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="text-sm text-muted-foreground">Realizado</div>
              <div>Entradas {reais(totais.realizadoEntradas)}</div>
              <div>Saídas {reais(totais.realizadoSaidas)}</div>
              <div className="font-medium">Saldo {reais(totais.realizadoEntradas - totais.realizadoSaidas)}</div>
            </CardContent>
          </Card>
        </div>
      )}
      <div className="grid gap-2">
        {(fluxo.data?.movimentos ?? []).map((movimento, index) => (
          <Card key={`${movimento.data}-${movimento.descricao}-${index}`}>
            <CardContent className="py-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{movimento.descricao}</div>
                <div className="text-xs text-muted-foreground">{dataBr(movimento.data)} · {movimento.natureza === "entrada" ? "Entrada" : "Saída"}</div>
              </div>
              <div className="text-right">
                <div>{reais(movimento.valor)}</div>
                <Pill valor={movimento.situacao} />
                <div className="text-xs text-muted-foreground">{rotulo(movimento.origem === "receber" ? "receber" : "pagar")}</div>
              </div>
            </CardContent>
          </Card>
        ))}
        {fluxo.data?.movimentos.length === 0 && <p className="text-sm text-muted-foreground">Nenhum movimento neste período.</p>}
      </div>
    </div>
  );
}
