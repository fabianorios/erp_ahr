import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Campo } from "@/components/erp/apresentacao";
import type { ConsultaAssinatura } from "@/services/erp/assinatura";
import { confirmarAssinatura, consultarAssinatura, devolverAssinatura, reenviarCodigoAssinatura, validarCodigoAssinatura } from "@/services/erp/assinar";

export function AssinarPage() {
  const { token = "" } = useParams();
  const [consulta, setConsulta] = useState<ConsultaAssinatura | null>(null);
  const [erro, setErro] = useState("");
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState("");
  const [codigoOk, setCodigoOk] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [devolvendo, setDevolvendo] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function carregar() {
    setErro("");
    try {
      setConsulta(await consultarAssinatura(token));
    } catch (error) {
      setConsulta(null);
      setErro(error instanceof Error ? error.message : "Não foi possível abrir o link.");
    }
  }

  useEffect(() => {
    if (token) void carregar();
    else setErro("Link inválido.");
  }, [token]);

  async function validarCodigo(event: FormEvent) {
    event.preventDefault();
    setOcupado(true);
    try {
      const resultado = await validarCodigoAssinatura(token, codigo);
      setNome(resultado.nome);
      setCodigoOk(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Código inválido.");
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar(event: FormEvent) {
    event.preventDefault();
    setOcupado(true);
    try {
      const resultado = await confirmarAssinatura(token, codigo, nome);
      toast.success(
        resultado.concluida
          ? "Assinatura concluída."
          : resultado.proxima === "contato"
            ? "Assinatura registrada. O próximo contato recebe o código."
            : "Assinatura registrada. A AHR recebe o próximo código.",
      );
      if (resultado.aviso) toast.error(resultado.aviso);
      setCodigoOk(false);
      setCodigo("");
      await carregar();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível assinar.");
    } finally {
      setOcupado(false);
    }
  }

  async function reenviar() {
    setOcupado(true);
    try {
      const resultado = await reenviarCodigoAssinatura(token);
      if (resultado.aviso) toast.error(resultado.aviso);
      else toast.success("Código reenviado.");
      await carregar();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível reenviar.");
    } finally {
      setOcupado(false);
    }
  }

  async function devolver(event: FormEvent) {
    event.preventDefault();
    setOcupado(true);
    try {
      const resultado = await devolverAssinatura(token, codigo, motivo);
      toast.success("Documento devolvido para ajuste.");
      if (resultado.aviso) toast.error(resultado.aviso);
      setDevolvendo(false);
      setCodigoOk(false);
      await carregar();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível devolver.");
    } finally {
      setOcupado(false);
    }
  }

  const etapa = consulta?.etapa === "ahr" ? "AHR" : "contato";

  return (
    <main className={`mx-auto space-y-4 p-8 ${consulta?.pdf ? "max-w-4xl" : "max-w-lg"}`}>
      <h1 className="text-2xl font-semibold">Assinatura eletrônica</h1>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {!consulta && !erro && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {consulta && (
        <div className="space-y-4">
          <p className="text-sm">
            {consulta.tipo} {consulta.titulo}, do cliente {consulta.empresa}.
          </p>
          {consulta.pdf && (
            <div className="space-y-2">
              <a className="text-sm underline" href={consulta.pdf} target="_blank" rel="noreferrer">
                Abrir a proposta em PDF
              </a>
              <iframe title="Proposta em PDF" src={consulta.pdf} className="h-[70vh] w-full rounded-md border border-border bg-card" />
            </div>
          )}
          {consulta.mensagem && <p className="text-sm">{consulta.mensagem}</p>}
          {consulta.etapa && !consulta.mensagem && (
            <>
              <p className="text-sm text-muted-foreground">
                Sua vez: {etapa}. O código foi enviado para {consulta.emailMascarado} e vale por 7 dias.
              </p>
              {!codigoOk ? (
                <form className="space-y-3" onSubmit={validarCodigo}>
                  <Campo label="Código de verificação">
                    <Input inputMode="numeric" maxLength={6} value={codigo} onChange={(event) => setCodigo(event.target.value)} required />
                  </Campo>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={ocupado} type="submit">Continuar</Button>
                    <Button variant="outline" disabled={ocupado} type="button" onClick={() => void reenviar()}>Reenviar código</Button>
                  </div>
                </form>
              ) : (
                <form className="space-y-3" onSubmit={confirmar}>
                  <Campo label="Nome de quem assina">
                    <Input value={nome} onChange={(event) => setNome(event.target.value)} required />
                  </Campo>
                  <Button disabled={ocupado} type="submit">Assinar</Button>
                </form>
              )}
              <div className="space-y-3 border-t border-border pt-3">
                <button className="text-sm text-muted-foreground" type="button" onClick={() => setDevolvendo((valor) => !valor)}>
                  Devolver para ajuste
                </button>
                {devolvendo && (
                  <form className="space-y-3" onSubmit={devolver}>
                    {!codigoOk && (
                      <Campo label="Código de verificação">
                        <Input inputMode="numeric" maxLength={6} value={codigo} onChange={(event) => setCodigo(event.target.value)} required />
                      </Campo>
                    )}
                    <Campo label="Ressalva">
                      <Textarea value={motivo} onChange={(event) => setMotivo(event.target.value)} required />
                    </Campo>
                    <Button variant="outline" disabled={ocupado} type="submit">Devolver</Button>
                  </form>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}
