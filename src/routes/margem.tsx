import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AvisoConsulta, Campo, TituloPagina, dataBr, fimDoMes, mesAtual, reais } from "@/components/erp/apresentacao";
import { carregarMargem, type LinhaMargem } from "@/services/erp/api";

function Tabela({ linhas }: { linhas: LinhaMargem[] }) {
  if (linhas.length === 0) return <p className="text-sm text-muted-foreground">Nada neste período.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Nome</th>
            <th className="py-2 pr-3 font-medium">Receita</th>
            <th className="py-2 pr-3 font-medium">Pessoal</th>
            <th className="py-2 pr-3 font-medium">Operacional</th>
            <th className="py-2 font-medium">Margem</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <tr key={linha.chave} className="border-b">
              <td className="py-2 pr-3">{linha.nome}</td>
              <td className="py-2 pr-3">{reais(linha.receita)}</td>
              <td className="py-2 pr-3">{reais(linha.pessoal)}</td>
              <td className="py-2 pr-3">{reais(linha.operacional)}</td>
              <td className="py-2 font-medium">{reais(linha.margem)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MargemPage() {
  const [inicio, setInicio] = useState(`${mesAtual()}-01`);
  const [fim, setFim] = useState(fimDoMes(mesAtual()));
  const completo = Boolean(inicio && fim);
  const ordem = completo && fim >= inicio;
  const painel = useQuery({
    queryKey: ["erp", "margem", inicio, fim],
    queryFn: () => carregarMargem(inicio, fim),
    enabled: ordem,
  });

  return (
    <div className="space-y-6">
      <TituloPagina
        titulo="Margem do contrato"
        descricao="No período, a receita soma os títulos previstos e faturados pelo vencimento e os recebidos pela data do recebimento, pelo valor do título. Título já ligado ao contrato entra só nessa linha. Cancelado fica de fora. Pessoal fechado e despesa operacional entram quando a competência cai no período. Juro, tarifa, IOF e excedente de recebimento ficam fora dessa conta."
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
      <AvisoConsulta erro={painel.error} />
      <Card>
        <CardContent className="py-4 space-y-3">
          <h2 className="font-medium">Contratos</h2>
          <Tabela linhas={painel.data?.contratos ?? []} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-4 space-y-3">
          <h2 className="font-medium">Contas a receber fora do contrato</h2>
          <Tabela linhas={painel.data?.avulsos ?? []} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-4 space-y-3">
          <h2 className="font-medium">Overhead dos centros indiretos</h2>
          <Tabela linhas={painel.data?.overhead ?? []} />
        </CardContent>
      </Card>
      {painel.data && (
        <Card>
          <CardContent className="py-4">
            <h2 className="font-medium">Resultado financeiro da empresa</h2>
            <p className="text-sm mt-2">Despesas financeiras {reais(painel.data.despesaFinanceira)}</p>
            <p className="text-sm">Excedente recebido sobre o título {reais(painel.data.receitaJuros)}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
