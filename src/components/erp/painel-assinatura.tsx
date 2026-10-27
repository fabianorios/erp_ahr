import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AvisoConsulta, Pill, executar } from "@/components/erp/apresentacao";
import { enviarAssinatura, incluirContatoAssinatura, listarContatos, obterPainelAssinatura, reenviarAssinatura } from "@/services/erp/api";
import type { ParteAssinatura, TipoDocumentoAssinatura } from "@/services/erp/assinatura";

function quando(iso: string | null): string {
  if (!iso) return "—";
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "—";
  return data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function LinhaParte({ parte }: { parte: ParteAssinatura }) {
  const pedido = parte.papel === "ahr" ? "AHR" : `${parte.ordem}. ${parte.nome}`;
  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{pedido}</span>
        <Pill valor={parte.status} />
      </div>
      <p className="mt-2">Pedido para {parte.nome} ({parte.email})</p>
      <p className="text-muted-foreground">Solicitado em {quando(parte.solicitadoEm)}</p>
      <p className="text-muted-foreground">
        Assinado em {quando(parte.assinadoEm)}
        {parte.assinouComo ? ` como ${parte.assinouComo}` : ""}
      </p>
    </div>
  );
}

export function PainelAssinatura({
  tipo,
  documentoId,
  clienteId,
  liberado,
}: {
  tipo: TipoDocumentoAssinatura;
  documentoId: string;
  clienteId: string;
  liberado: boolean;
}) {
  const qc = useQueryClient();
  const [ocupado, setOcupado] = useState(false);
  const [ordem, setOrdem] = useState<string[]>([]);
  const [incluso, setIncluso] = useState("");
  const consulta = useQuery({
    queryKey: ["erp", "assinatura", tipo, documentoId],
    queryFn: () => obterPainelAssinatura(tipo, documentoId),
  });
  const painel = consulta.data;
  const aberta = painel?.status === "enviada";
  const ahrAssinou = painel?.partes.some((parte) => parte.papel === "ahr" && parte.status === "assinado") ?? false;
  const podePedir = liberado && (!painel || painel.status === "devolvida");
  const podeIncluir = liberado && aberta && !ahrAssinou;
  const contatos = useQuery({
    queryKey: ["erp", "contatos", clienteId],
    queryFn: () => listarContatos(clienteId),
    enabled: Boolean(clienteId) && (podePedir || podeIncluir),
  });

  useEffect(() => {
    const ids = new Set((contatos.data ?? []).map((contato) => contato.id));
    setOrdem((atual) => atual.filter((id) => ids.has(id)));
    setIncluso((atual) => (ids.has(atual) ? atual : ""));
  }, [contatos.data]);

  function alternar(id: string) {
    setOrdem((atual) => (atual.includes(id) ? atual.filter((item) => item !== id) : [...atual, id]));
  }

  function mover(indice: number, delta: number) {
    setOrdem((atual) => {
      const destino = indice + delta;
      if (destino < 0 || destino >= atual.length) return atual;
      const copia = [...atual];
      const [item] = copia.splice(indice, 1);
      copia.splice(destino, 0, item);
      return copia;
    });
  }

  async function pedir() {
    setOcupado(true);
    try {
      await executar(async () => {
        const resultado = await enviarAssinatura(tipo, documentoId, ordem);
        await qc.invalidateQueries({ queryKey: ["erp", "assinatura", tipo, documentoId] });
        if (resultado.aviso) throw new Error(resultado.aviso);
      }, "Pedido de assinatura enviado ao primeiro contato");
    } finally {
      setOcupado(false);
    }
  }

  async function incluir() {
    setOcupado(true);
    try {
      await executar(async () => {
        const resultado = await incluirContatoAssinatura(tipo, documentoId, incluso);
        await qc.invalidateQueries({ queryKey: ["erp", "assinatura", tipo, documentoId] });
        setIncluso("");
        if (resultado.aviso) throw new Error(resultado.aviso);
        return resultado.vez ? "Código enviado ao novo contato" : "Contato incluído. O código sai quando for a vez dele.";
      }, "Contato incluído. O código sai quando for a vez dele.");
    } finally {
      setOcupado(false);
    }
  }

  async function reenviar() {
    setOcupado(true);
    try {
      await executar(async () => {
        const resultado = await reenviarAssinatura(tipo, documentoId);
        await qc.invalidateQueries({ queryKey: ["erp", "assinatura", tipo, documentoId] });
        if (resultado.aviso) throw new Error(resultado.aviso);
      }, "Código reenviado");
    } finally {
      setOcupado(false);
    }
  }

  const lista = contatos.data ?? [];
  const usados = new Set(
    (painel?.partes ?? [])
      .filter((parte) => parte.papel === "contato")
      .flatMap((parte) => [parte.contatoId?.toLowerCase(), parte.email.trim().toLowerCase()].filter((item): item is string => Boolean(item))),
  );
  const disponiveis = lista.filter((contato) => !usados.has(contato.id.toLowerCase()) && !usados.has(contato.email.trim().toLowerCase()));

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Assinaturas</h2>
          {painel && <Pill valor={painel.status} />}
        </div>
        <p className="text-sm text-muted-foreground">
          Os contatos assinam na ordem escolhida. Enquanto o pedido está em aberto e a AHR não assinou, dá para incluir outro contato deste cliente: ele entra antes da AHR e recebe o código só na vez dele. O código vale por 7 dias.
        </p>
        <AvisoConsulta erro={consulta.error} />
        {consulta.isLoading && <p className="text-sm text-muted-foreground">Carregando assinaturas…</p>}
        {painel ? (
          <div className="grid gap-3">
            {painel.partes.map((parte) => (
              <LinhaParte key={`${parte.ordem}-${parte.papel}`} parte={parte} />
            ))}
            {painel.devolutiva && <p className="text-sm">Devolutiva: {painel.devolutiva}</p>}
          </div>
        ) : (
          !consulta.isLoading && !consulta.error && <p className="text-sm text-muted-foreground">Nenhum pedido de assinatura.</p>
        )}
        {podePedir && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Contatos que assinam</p>
            <AvisoConsulta erro={contatos.error} />
            {contatos.isLoading && <p className="text-sm text-muted-foreground">Carregando contatos…</p>}
            {lista.length === 0 && !contatos.isLoading && !contatos.error && (
              <p className="text-sm text-muted-foreground">Este cliente ainda não tem contatos. Cadastre nome e e-mail na tela de clientes.</p>
            )}
            {lista.map((contato) => {
              const indice = ordem.indexOf(contato.id);
              const marcado = indice >= 0;
              return (
                <div key={contato.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input type="checkbox" checked={marcado} onChange={() => alternar(contato.id)} />
                    <span>
                      {marcado ? `${indice + 1}. ` : ""}
                      {contato.nome} ({contato.email})
                    </span>
                  </label>
                  {marcado && (
                    <>
                      <Button type="button" variant="outline" disabled={indice === 0} onClick={() => mover(indice, -1)}>
                        Subir
                      </Button>
                      <Button type="button" variant="outline" disabled={indice === ordem.length - 1} onClick={() => mover(indice, 1)}>
                        Descer
                      </Button>
                    </>
                  )}
                </div>
              );
            })}
            <p className="text-sm text-muted-foreground">AHR assina por último e não entra nesta lista.</p>
          </div>
        )}
        {podeIncluir && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Incluir contato</p>
            <AvisoConsulta erro={contatos.error} />
            {contatos.isLoading && <p className="text-sm text-muted-foreground">Carregando contatos…</p>}
            {disponiveis.length === 0 && !contatos.isLoading && !contatos.error && (
              <p className="text-sm text-muted-foreground">Este cliente não tem outro contato fora deste pedido. Cadastre nome e e-mail na tela de clientes.</p>
            )}
            {disponiveis.map((contato) => (
              <label key={contato.id} className="flex items-center gap-2 text-sm">
                <input type="radio" name="incluir-contato" checked={incluso === contato.id} onChange={() => setIncluso(contato.id)} />
                <span>
                  {contato.nome} ({contato.email})
                </span>
              </label>
            ))}
            <p className="text-sm text-muted-foreground">O contato entra depois dos que já estão na lista e antes da AHR. O PDF e o link continuam os mesmos.</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {podePedir && (
            <Button disabled={ocupado || ordem.length === 0} onClick={() => void pedir()}>
              {painel?.status === "devolvida" ? "Pedir assinaturas de novo" : "Pedir assinaturas"}
            </Button>
          )}
          {podeIncluir && (
            <Button disabled={ocupado || !incluso} onClick={() => void incluir()}>
              Incluir contato
            </Button>
          )}
          {aberta && (
            <Button variant="outline" disabled={ocupado} onClick={() => void reenviar()}>
              Reenviar código
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
