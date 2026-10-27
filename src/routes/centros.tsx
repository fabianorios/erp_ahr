import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AvisoConsulta, Campo, Pill, TituloPagina, executar } from "@/components/erp/apresentacao";
import { useAuth } from "@/lib/auth-context";
import { alternarCentro, criarCentroIndireto, excluirCentro, listarCentros, renomearCentro } from "@/services/erp/api";

export function CentrosPage() {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const centros = useQuery({ queryKey: ["erp", "centros"], queryFn: listarCentros });

  const recarregar = () => qc.invalidateQueries({ queryKey: ["erp", "centros"] });

  return (
    <div className="space-y-6">
      <TituloPagina
        titulo="Centros de custo"
        descricao="O financeiro recebe juro, tarifa e IOF. O indireto recebe o que não é de um contrato. O centro do contrato nasce quando o contrato fica vigente."
      />
      <AvisoConsulta erro={centros.error} />
      {canEdit && (
        <Card>
          <CardContent className="py-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Campo label="Novo centro indireto">
                <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Comercial" />
              </Campo>
            </div>
            <Button
              onClick={() =>
                executar(async () => {
                  await criarCentroIndireto(nome);
                  setNome("");
                  await recarregar();
                }, "Centro indireto criado")
              }
            >
              Criar
            </Button>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3">
        {(centros.data ?? []).map((centro) => (
          <Card key={centro.id}>
            <CardContent className="py-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{centro.nome}</div>
                <div className="mt-1 flex gap-2">
                  <Pill valor={centro.tipo} />
                  <Pill valor={centro.ativo ? "ativo" : "inativo"} />
                </div>
              </div>
              {canEdit && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {centro.tipo !== "financeiro" && (
                    <Input
                      className="w-40"
                      value={nomes[centro.id] ?? centro.nome}
                      onChange={(evento) => setNomes({ ...nomes, [centro.id]: evento.target.value })}
                    />
                  )}
                  {centro.tipo !== "financeiro" && (
                    <Button variant="outline" onClick={() => executar(async () => { await renomearCentro(centro.id, nomes[centro.id] ?? centro.nome); await recarregar(); }, "Centro atualizado")}>Salvar</Button>
                  )}
                  {centro.tipo !== "financeiro" && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        executar(async () => {
                          await alternarCentro(centro, !centro.ativo);
                          await recarregar();
                        }, centro.ativo ? "Centro inativado" : "Centro reativado")
                      }
                    >
                      {centro.ativo ? "Inativar" : "Reativar"}
                    </Button>
                  )}
                  {centro.tipo === "indireto" && (
                    <Button variant="ghost" onClick={() => executar(() => excluirCentro(centro).then(recarregar), "Centro excluído")}>Excluir</Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {centros.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum centro cadastrado.</p>}
      </div>
    </div>
  );
}
