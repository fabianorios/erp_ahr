import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { AvisoConsulta, Pill, TituloPagina, dataBr, reais } from "@/components/erp/apresentacao";
import { listarContratos } from "@/services/erp/api";

export function ContratosPage() {
  const contratos = useQuery({ queryKey: ["erp", "contratos"], queryFn: listarContratos });
  return (
    <div className="space-y-6">
      <TituloPagina titulo="Contratos" descricao="Nasce em rascunho da proposta aceita. As parcelas previstas já podem existir antes da vigência. Vigente cria o centro e libera o título manual." />
      <AvisoConsulta erro={contratos.error} />
      <div className="grid gap-3">
        {(contratos.data ?? []).map((contrato) => (
          <Link key={contrato.id} to={`/contratos/${contrato.id}`}>
            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="py-4 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{contrato.numero} v{contrato.versao} · {contrato.clienteNome}</div>
                  <div className="text-sm text-muted-foreground">
                    {reais(contrato.valor)} · mista · {dataBr(contrato.inicio)} a {dataBr(contrato.fim)}
                  </div>
                </div>
                <Pill valor={contrato.status} />
              </CardContent>
            </Card>
          </Link>
        ))}
        {contratos.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum contrato. Aceite uma proposta para abrir o primeiro.</p>}
      </div>
    </div>
  );
}
