import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AvisoConsulta, Pill, executar, reais, dataBr } from "@/components/erp/apresentacao";
import { abrirPdfBoleto, alterarVencimentoBoletoCora, cancelarBoletoCora, consultarKit, emitirBoletoCora, enviarBoletoCora, enviarKit, listarContatos, type TituloItem } from "@/services/erp/api";
import { DomainError } from "@/services/erp/domain";

const STATUS_CORA: Record<string, string> = {
  DRAFT: "Rascunho",
  OPEN: "Aberto",
  LATE: "Atrasado",
  IN_PAYMENT: "Em pagamento",
  PAID: "Pago",
  CANCELLED: "Cancelado",
};

export function BoletoTitulo({
  titulo,
  alterado,
  erroBoleto,
  onMudou,
}: {
  titulo: TituloItem;
  alterado: boolean;
  erroBoleto?: string | null;
  onMudou: () => Promise<void>;
}) {
  const boleto = titulo.boleto;
  const cora = Boolean(boleto?.coraId);
  const podeEmitir = !boleto && (titulo.status === "previsto" || titulo.status === "faturado");
  const [envio, setEnvio] = useState<null | "boleto" | "kit">(null);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [vencimento, setVencimento] = useState(boleto?.vencimento ?? "");
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const podeMexer = cora && (boleto?.status === "aberto" || boleto?.status === "atrasado");
  const kit = useQuery({
    queryKey: ["erp", "kit", titulo.id, titulo.nfse?.status, boleto?.temPdf, boleto?.coraId],
    queryFn: () => consultarKit(titulo.id),
  });
  const podeKit = kit.isError
    ? titulo.nfse?.status === "informada" && Boolean(boleto?.temPdf && cora)
    : Boolean(kit.data?.nfse && kit.data?.boleto);
  const contatos = useQuery({
    queryKey: ["erp", "contatos", titulo.clienteId],
    queryFn: () => listarContatos(titulo.clienteId ?? ""),
    enabled: envio !== null && Boolean(titulo.clienteId),
  });

  function alternar(id: string) {
    setMarcados((atual) => (atual.includes(id) ? atual.filter((item) => item !== id) : [...atual, id]));
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        {erroBoleto && <p className="text-sm text-destructive">{erroBoleto}</p>}
        <div>
          <h2 className="text-lg font-semibold">Boleto</h2>
          <p className="text-sm text-muted-foreground">
            Emitir grava a cobrança na Cora e o PDF neste ERP. Se o título ainda está previsto, ele passa a faturado. Abrir o PDF de novo não consulta a Cora. O e-mail só sai em Enviar boleto.
          </p>
        </div>
        {boleto && (
          <div className="space-y-2 text-sm">
            <p>
              Status <Pill valor={boleto.status} />
              {boleto.coraStatus ? ` · Cora ${STATUS_CORA[boleto.coraStatus] ?? boleto.coraStatus}` : ""}
              {boleto.coraId ? ` · Fatura ${boleto.coraId}` : ""}
            </p>
            <p>
              {reais(boleto.valor)} · vencimento {dataBr(boleto.vencimento)}
            </p>
            {boleto.linha && (
              <p className="break-all">
                <span className="text-muted-foreground">Linha digitável </span>
                <span className="font-mono">{boleto.linha}</span>
              </p>
            )}
            {boleto.codigoBarras && (
              <p className="break-all">
                <span className="text-muted-foreground">Código de barras </span>
                <span className="font-mono">{boleto.codigoBarras}</span>
              </p>
            )}
            {cora && (
              <p className="break-all">
                <span className="text-muted-foreground">PIX copia e cola </span>
                {boleto.pix ? <span className="font-mono">{boleto.pix}</span> : "A Cora não devolveu o PIX copia e cola."}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {podeEmitir && (
            <Button
              disabled={ocupado}
              onClick={() => {
                setOcupado(true);
                void executar(async () => {
                  if (alterado) throw new DomainError("Salve o título antes de emitir o boleto.");
                  const aviso = await emitirBoletoCora(titulo.id);
                  await onMudou();
                  return aviso;
                }, "Boleto emitido e salvo no ERP.").finally(() => setOcupado(false));
              }}
            >
              Emitir boleto
            </Button>
          )}
          {boleto?.temPdf && (
            <Button
              variant="outline"
              disabled={ocupado}
              onClick={() => {
                setOcupado(true);
                void executar(() => abrirPdfBoleto(titulo.id), "PDF do boleto aberto.").finally(() => setOcupado(false));
              }}
            >
              Abrir PDF do boleto
            </Button>
          )}
          {boleto?.temPdf && envio !== "boleto" && (
            <Button variant="outline" disabled={ocupado} onClick={() => { setEnvio("boleto"); setMarcados([]); }}>
              Enviar boleto
            </Button>
          )}
          <Button type="button" variant="outline" disabled={ocupado || !podeKit} onClick={() => { setEnvio("kit"); setMarcados([]); }}>
            Enviar kit
          </Button>
          {podeMexer && (
            <Button variant="outline" disabled={ocupado} onClick={() => setConfirmando((atual) => !atual)}>
              Cancelar boleto
            </Button>
          )}
        </div>
        {podeMexer && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              Novo vencimento
              <input
                type="date"
                className="mt-1 block rounded-md border border-input bg-card px-3 py-2 text-sm"
                value={vencimento}
                onChange={(evento) => setVencimento(evento.target.value)}
              />
            </label>
            <Button
              variant="outline"
              disabled={ocupado || !vencimento}
              onClick={() => {
                setOcupado(true);
                void executar(async () => {
                  if (alterado) throw new DomainError("Salve o título antes de alterar o vencimento.");
                  const aviso = await alterarVencimentoBoletoCora(titulo.id, vencimento);
                  await onMudou();
                  return aviso;
                }, "Vencimento alterado na Cora e no título.").finally(() => setOcupado(false));
              }}
            >
              Alterar vencimento
            </Button>
          </div>
        )}
        {confirmando && podeMexer && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">O título permanece. Só o boleto é cancelado na Cora e marcado como cancelado aqui.</p>
            <Button
              disabled={ocupado}
              onClick={() => {
                setOcupado(true);
                void executar(async () => {
                  const aviso = await cancelarBoletoCora(titulo.id);
                  setConfirmando(false);
                  await onMudou();
                  return aviso;
                }, "Boleto cancelado.").finally(() => setOcupado(false));
              }}
            >
              Confirmar cancelamento
            </Button>
          </div>
        )}
        {boleto && !cora && <p className="text-sm text-muted-foreground">O título já tem boleto.</p>}
        {boleto && !boleto.temPdf && cora && (
          <p className="text-sm text-muted-foreground">O PDF deste boleto não está no servidor.</p>
        )}
        <AvisoConsulta erro={kit.error} />
        {!podeKit && !kit.isLoading && !kit.error && (
          <p className="text-sm text-muted-foreground">
            {titulo.nfse?.status === "informada" && !titulo.nfse.temPdf
              ? "O PDF desta NFS-e não está no servidor."
              : "Enviar kit fica disponível quando o PDF da NFS-e e o PDF do boleto Cora estão no servidor."}
          </p>
        )}
        {envio && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Contatos do cliente</p>
            <p className="text-sm text-muted-foreground">
              {envio === "kit"
                ? "Os mesmos contatos da NFS-e. Um único e-mail leva os dois PDFs."
                : "Os mesmos contatos da NFS-e e da assinatura. Marque quem recebe o PDF."}
            </p>
            {!titulo.clienteId && <p className="text-sm text-muted-foreground">Este título não tem cliente.</p>}
            <AvisoConsulta erro={contatos.error} />
            {contatos.isLoading && <p className="text-sm text-muted-foreground">Carregando contatos…</p>}
            {titulo.clienteId && !contatos.isLoading && !contatos.error && (contatos.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Este cliente ainda não tem contatos. Cadastre nome e e-mail na tela de Pessoas.</p>
            )}
            {(contatos.data ?? []).map((contato) => (
              <label key={contato.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={marcados.includes(contato.id)} onChange={() => alternar(contato.id)} />
                {contato.nome} ({contato.email})
              </label>
            ))}
            <Button
              type="button"
              disabled={ocupado || marcados.length === 0 || (envio === "kit" && !podeKit) || (envio === "boleto" && !boleto?.temPdf)}
              onClick={() => {
                setOcupado(true);
                void executar(async () => {
                  const aviso = envio === "kit" ? await enviarKit(titulo.id, marcados) : await enviarBoletoCora(titulo.id, marcados);
                  setEnvio(null);
                  setMarcados([]);
                  return aviso;
                }, envio === "kit" ? "Kit enviado." : "Boleto enviado.").finally(() => setOcupado(false));
              }}
            >
              {envio === "kit" ? "Enviar kit" : "Enviar boleto"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
