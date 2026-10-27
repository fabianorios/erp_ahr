import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvisoConsulta, Campo, Pill, TituloPagina, executar, reais } from "@/components/erp/apresentacao";
import { FormaPagamentoCampos } from "@/components/erp/forma-pagamento";
import { TextosPropostaCampos } from "@/components/erp/proposta-textos";
import { useAuth } from "@/lib/auth-context";
import { criarProposta, formularioPropostaVazio, listarClientesFinanceiros, listarPropostas } from "@/services/erp/api";

export function PropostasPage() {
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [aberta, setAberta] = useState(false);
  const [form, setForm] = useState(formularioPropostaVazio());
  const propostas = useQuery({ queryKey: ["erp", "propostas"], queryFn: listarPropostas });
  const clientes = useQuery({ queryKey: ["erp", "clientes"], queryFn: listarClientesFinanceiros });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <TituloPagina titulo="Propostas" descricao="A forma de cobrança é mista. O pagamento informa o total, as parcelas e os vencimentos. Enviar congela a versão; correção abre outra." />
        {canEdit && <Button onClick={() => setAberta((valor) => !valor)}>Nova proposta</Button>}
      </div>
      <AvisoConsulta erro={propostas.error ?? clientes.error} />
      {aberta && (
        <Card>
          <CardContent className="py-4 grid gap-3">
            <Campo label="Cliente">
              <Select value={form.clienteId || undefined} onValueChange={(clienteId) => setForm({ ...form, clienteId })}>
                <SelectTrigger><SelectValue placeholder="Escolha o cliente" /></SelectTrigger>
                <SelectContent>
                  {(clientes.data ?? []).map((cliente) => (
                    <SelectItem key={cliente.id} value={cliente.id}>{cliente.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <TextosPropostaCampos value={form} onChange={(textos) => setForm({ ...form, ...textos })} />
            <div className="grid gap-3 md:grid-cols-2">
              <Campo label="Início sugerido">
                <Input type="date" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} />
              </Campo>
              <Campo label="Fim sugerido">
                <Input type="date" value={form.fim} onChange={(e) => setForm({ ...form, fim: e.target.value })} />
              </Campo>
            </div>
            <FormaPagamentoCampos
              valor={form.valor}
              onValorChange={(valor) => setForm({ ...form, valor })}
              value={form}
              onChange={(agenda) => setForm({ ...form, ...agenda })}
            />
            <p className="text-xs text-muted-foreground">Forma de cobrança: mista. O cliente precisa de CPF ou CNPJ.</p>
            <Button
              className="w-fit"
              onClick={() =>
                executar(async () => {
                  const id = await criarProposta(form);
                  await qc.invalidateQueries({ queryKey: ["erp", "propostas"] });
                  navigate(`/propostas/${id}`);
                }, "Proposta criada")
              }
            >
              Criar rascunho
            </Button>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3">
        {(propostas.data ?? []).map((proposta) => (
          <Link key={proposta.id} to={`/propostas/${proposta.id}`}>
            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="py-4 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{proposta.titulo || proposta.numero} · {proposta.clienteNome}</div>
                  <div className="text-sm text-muted-foreground">{proposta.numero} v{proposta.versao} · {reais(proposta.valor)} · mista</div>
                </div>
                <Pill valor={proposta.status} />
              </CardContent>
            </Card>
          </Link>
        ))}
        {propostas.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma proposta.</p>}
      </div>
    </div>
  );
}
