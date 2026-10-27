import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { AvisoConsulta } from "@/components/erp/apresentacao";
import { AtalhoConsulta } from "@/components/erp/atalho-consulta";
import { textoParcela } from "@/components/erp/rotulos-titulo";
import { listarTitulosDaProposta } from "@/services/erp/api";
import { parcelasPrevistas, type AgendaPagamento } from "@/services/erp/domain";

export function ContasDaProposta({
  propostaId,
  agenda,
}: {
  propostaId: string;
  contratoId: string | null;
  canEdit: boolean;
  clienteNome: string;
  agenda: AgendaPagamento | null;
}) {
  const consulta = useQuery({
    queryKey: ["erp", "titulos", "proposta", propostaId],
    queryFn: () => listarTitulosDaProposta(propostaId),
  });
  const previstas = parcelasPrevistas(agenda);
  const titulos = consulta.data ?? [];
  const rotulos = titulos.length
    ? titulos.map((titulo) => textoParcela(titulo.parcela, titulo.quantidadeParcelas ?? previstas.length) || titulo.descricao)
    : previstas.map((parcela) => textoParcela(parcela.parcela, previstas.length));
  const total = titulos.length || previstas.length;
  const texto = total === 0
    ? "Nenhum título previsto."
    : `${total} ${total === 1 ? "título previsto" : "títulos previstos"}${rotulos.length ? ` · ${rotulos.join(" · ")}` : ""}`;

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <h2 className="text-lg font-semibold">Contas previstas</h2>
        <AvisoConsulta erro={consulta.error} />
        {consulta.isLoading ? <p className="text-sm text-muted-foreground">Carregando parcelas…</p> : <p className="text-sm">{texto}</p>}
        <AtalhoConsulta />
      </CardContent>
    </Card>
  );
}
