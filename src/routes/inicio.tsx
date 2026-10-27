import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { TituloPagina } from "@/components/erp/apresentacao";

const atalhos = [
  { href: "/centros", titulo: "Centros de custo", texto: "Contrato, indireto e o centro financeiro." },
  { href: "/clientes", titulo: "Clientes", texto: "Tomador do serviço, com documento e endereço." },
  { href: "/despesas", titulo: "Despesas", texto: "Gasto operacional, juro, tarifa, IOF e a conta a pagar." },
  { href: "/pessoal", titulo: "Pessoal", texto: "Custo do mês e rateio que fecha em 100%." },
  { href: "/propostas", titulo: "Propostas", texto: "Versão comercial, envio e aceite." },
  { href: "/contratos", titulo: "Contratos", texto: "Vigência, centro do contrato e títulos lançados à mão." },
  { href: "/fluxo", titulo: "Fluxo de caixa", texto: "Previsto pelo vencimento e realizado pela baixa." },
  { href: "/margem", titulo: "Margem", texto: "Receita faturada menos pessoal e despesa do contrato." },
] as const;

export function FinanceiroInicio() {
  return (
    <div className="space-y-6">
      <TituloPagina
        titulo="ERP AHR"
        descricao="Ciclo da consultoria na fase 1: o título nasce à mão, e a NFS-e e o boleto são registrados com número, valor, vencimento e status."
      />
      <div className="grid gap-3 md:grid-cols-2">
        {atalhos.map((atalho) => (
          <Link key={atalho.href} to={atalho.href}>
            <Card className="h-full hover:shadow-md transition-shadow">
              <CardContent className="py-4">
                <h2 className="font-medium">{atalho.titulo}</h2>
                <p className="text-sm text-muted-foreground mt-1">{atalho.texto}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
