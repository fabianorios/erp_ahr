import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AvisoConsulta, Campo, Pill, TituloPagina, executar, reais } from "@/components/erp/apresentacao";
import { AtalhoConsulta } from "@/components/erp/atalho-consulta";
import { PainelAssinatura } from "@/components/erp/painel-assinatura";
import { useAuth } from "@/lib/auth-context";
import { cancelarContratoAtual, encerrar, excluirContrato, obterContrato, salvarVigencia, vigorarContrato } from "@/services/erp/api";

export function ContratoPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const detalhe = useQuery({ queryKey: ["erp", "contrato", id], queryFn: () => obterContrato(id) });
  const contrato = detalhe.data?.contrato;
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [texto, setTexto] = useState("");

  useEffect(() => {
    if (!contrato) return;
    setInicio(contrato.inicio ?? "");
    setFim(contrato.fim ?? "");
    setTexto(contrato.texto);
  }, [contrato?.id, contrato?.status, contrato?.inicio, contrato?.fim, contrato?.texto]);

  const recarregar = async () => {
    await qc.invalidateQueries({ queryKey: ["erp"] });
  };

  if (detalhe.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!contrato || !detalhe.data) {
    return (
      <div className="space-y-3">
        <AvisoConsulta erro={detalhe.error} />
        <p className="text-sm text-muted-foreground">Contrato não encontrado.</p>
      </div>
    );
  }

  const rascunho = contrato.status === "rascunho";

  return (
    <div className="space-y-6">
      <TituloPagina titulo={`${contrato.numero} v${contrato.versao}`} descricao={contrato.clienteNome} />
      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Pill valor={contrato.status} />
            <Pill valor="mista" />
          </div>
          <p className="text-sm">Valor contratado {reais(contrato.valor)}. Cliente, valor e forma de cobrança vieram da proposta e não se editam aqui.</p>
          {contrato.centroNome && <p className="text-sm text-muted-foreground">Centro de custo: {contrato.centroNome}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            <Campo label="Início">
              <Input type="date" disabled={!rascunho || !canEdit} value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </Campo>
            <Campo label="Fim">
              <Input type="date" disabled={!rascunho || !canEdit} value={fim} onChange={(e) => setFim(e.target.value)} />
            </Campo>
          </div>
          <Campo label="Texto">
            <Textarea disabled={!rascunho || !canEdit} value={texto} onChange={(e) => setTexto(e.target.value)} />
          </Campo>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              {rascunho && (
                <>
                  <Button variant="outline" onClick={() => executar(() => salvarVigencia(contrato, inicio, fim, texto).then(recarregar), "Rascunho salvo")}>Salvar</Button>
                  <Button onClick={() => executar(() => vigorarContrato(contrato, inicio, fim, texto).then(recarregar), "Contrato vigente")}>Tornar vigente</Button>
                </>
              )}
              {contrato.status === "vigente" && (
                <Button variant="outline" onClick={() => executar(() => encerrar(contrato).then(recarregar), "Contrato encerrado")}>Encerrar</Button>
              )}
              {rascunho && (
                <Button variant="ghost" onClick={() => executar(async () => { await excluirContrato(contrato); navigate("/contratos"); }, "Contrato excluído")}>Excluir</Button>
              )}
              {(rascunho || contrato.status === "vigente") && (
                <Button variant="ghost" onClick={() => executar(() => cancelarContratoAtual(contrato, detalhe.data?.titulos ?? []).then(recarregar), "Contrato cancelado")}>
                  Cancelar contrato
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <PainelAssinatura
        tipo="contrato"
        documentoId={contrato.id}
        clienteId={contrato.clienteId}
        liberado={canEdit && (contrato.status === "rascunho" || contrato.status === "vigente")}
      />
      <Card>
        <CardContent className="space-y-3 py-4">
          <p className="text-sm">
            {detalhe.data.titulos.length} {detalhe.data.titulos.length === 1 ? "título a receber" : "títulos a receber"}.
          </p>
          <AtalhoConsulta />
        </CardContent>
      </Card>
    </div>
  );
}
