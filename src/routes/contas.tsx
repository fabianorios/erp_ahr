import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvisoConsulta, Campo, CampoDinheiro, TituloPagina, executar, hoje, reaisInput } from "@/components/erp/apresentacao";
import { AtalhoConsulta } from "@/components/erp/atalho-consulta";
import { BoletoTitulo } from "@/components/erp/boleto-titulo";
import { textoParcela } from "@/components/erp/rotulos-titulo";
import { useAuth } from "@/lib/auth-context";
import { anularNfse, atualizarTitulo, criarTituloAvulso, excluirTitulo, gravarNfse, listarCentros, listarClientesFinanceiros, obterTitulo, type TituloItem } from "@/services/erp/api";
import { MUNICIPIO_NFSE, reaisToCents } from "@/services/erp/domain";

const ORIGENS = ["Word", "Outro sistema"] as const;
const vazio = {
  descricao: "",
  valor: "",
  clienteId: "",
  forma: "",
  numeroNf: "",
  tipoVencimento: "data_fixa",
  prazoDias: "",
  quantidade: "1",
  vencimentos: [""],
  primeiroVencimento: "",
  competencia: "",
  banco: "",
  centroId: "",
  modo: "Word" as "Word" | "Outro sistema" | "texto",
  texto: "",
};

export function ContasPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const clientes = useQuery({ queryKey: ["erp", "clientes"], queryFn: listarClientesFinanceiros });
  const centros = useQuery({ queryKey: ["erp", "centros"], queryFn: listarCentros });
  const aberto = useQuery({ queryKey: ["erp", "titulos", "um", id], queryFn: () => obterTitulo(id ?? ""), enabled: Boolean(id) });
  const [form, setForm] = useState(vazio);
  const [editando, setEditando] = useState<TituloItem | null>(null);
  const [nfAberta, setNfAberta] = useState(false);
  const [nfForm, setNfForm] = useState({ numero: "", valor: "", vencimento: "", data: "", codigo: "" });

  const origem = form.modo === "texto" ? form.texto : form.modo;
  const quantidade = Math.max(1, Number(form.quantidade) || 1);

  function definirQuantidade(valor: string) {
    const total = Math.max(1, Number(valor) || 1);
    const vencimentos = Array.from({ length: total }, (_, indice) => form.vencimentos[indice] ?? "");
    setForm({ ...form, quantidade: valor, vencimentos });
  }

  function limpar() {
    setEditando(null);
    setForm(vazio);
  }

  function abrir(titulo: TituloItem) {
    setEditando(titulo);
    const modo = titulo.origem === "Word" || titulo.origem === "Outro sistema" ? titulo.origem : "texto";
    setForm({
      descricao: titulo.descricao,
      valor: reaisInput(titulo.valor),
      clienteId: titulo.clienteId ?? "",
      forma: titulo.formaRecebimento ?? "",
      numeroNf: titulo.numeroNf ?? "",
      tipoVencimento: titulo.tipoVencimento ?? "data_fixa",
      prazoDias: titulo.prazoDias ? String(titulo.prazoDias) : "",
      quantidade: String(titulo.quantidadeParcelas ?? 1),
      vencimentos: [titulo.vencimento],
      primeiroVencimento: titulo.vencimento,
      competencia: titulo.competencia.slice(0, 7),
      banco: titulo.banco ?? "",
      centroId: titulo.centroId ?? titulo.centroPadraoId ?? "",
      modo,
      texto: modo === "texto" ? titulo.origem ?? "" : "",
    });
  }

  useEffect(() => {
    if (!id) {
      setEditando(null);
      setForm(vazio);
      return;
    }
    if (aberto.data?.id === id) abrir(aberto.data);
  }, [id, aberto.data]);

  const avulso = !editando || (!editando.propostaId && !editando.contratoId);
  const podeMudar = !editando || (editando.status === "previsto" && !editando.nfse && !editando.boleto);
  const alterado = Boolean(
    editando &&
      (form.descricao.trim() !== editando.descricao ||
        form.clienteId !== (editando.clienteId ?? "") ||
        (form.vencimentos[0] ?? "") !== editando.vencimento ||
        centavosDoForm(form.valor) !== editando.valor),
  );

  async function recarregar() {
    await qc.invalidateQueries({ queryKey: ["erp", "titulos"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TituloPagina
          titulo="Manutenção de contas a receber"
          descricao="Cadastro do título, depois os dados financeiros. No título salvo, Emitir boleto registra a cobrança na Cora e guarda o PDF aqui. Um título previsto, sem NFS-e e sem boleto, pode ser editado ou excluído."
        />
        <AtalhoConsulta />
      </div>
      <AvisoConsulta erro={aberto.error ?? centros.error} />
      {canEdit && (
        <Card>
          <CardContent className="py-4">
            <fieldset disabled={!podeMudar} className="grid gap-3">
            <Campo label="Cliente">
              {avulso ? (
                <Select value={form.clienteId || undefined} onValueChange={(clienteId) => setForm({ ...form, clienteId })} disabled={!podeMudar}>
                  <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                  <SelectContent>
                    {(clientes.data ?? []).map((cliente) => (
                      <SelectItem key={cliente.id} value={cliente.id}>{cliente.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={editando?.clienteNome ?? ""} disabled />
              )}
            </Campo>
            {avulso && <Campo label="Origem">
              <Select value={form.modo} onValueChange={(modo: "Word" | "Outro sistema" | "texto") => setForm({ ...form, modo })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ORIGENS.map((item) => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                  <SelectItem value="texto">Texto livre</SelectItem>
                </SelectContent>
              </Select>
            </Campo>}
            {avulso && form.modo === "texto" && (
              <Campo label="De onde veio">
                <Input value={form.texto} onChange={(event) => setForm({ ...form, texto: event.target.value })} />
              </Campo>
            )}
            <Campo label="Descrição">
              <Input value={form.descricao} onChange={(event) => setForm({ ...form, descricao: event.target.value })} />
            </Campo>
            <Campo label="Número da NF">
              <Input value={form.numeroNf} onChange={(event) => setForm({ ...form, numeroNf: event.target.value })} placeholder="Opcional. A nota sai no GissOnline." />
            </Campo>
            <Campo label="Valor da parcela">
              <CampoDinheiro value={form.valor} onChange={(valor) => setForm({ ...form, valor })} disabled={!podeMudar} />
            </Campo>
            <Campo label="Forma de recebimento">
              <Select value={form.forma || undefined} onValueChange={(forma) => setForm({ ...form, forma })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="transferencia">Transferência</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Tipo de vencimento">
              <Select value={form.tipoVencimento} onValueChange={(tipoVencimento) => setForm({ ...form, tipoVencimento })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="data_fixa">Data fixa</SelectItem>
                  <SelectItem value="prazo_dias">Prazo em dias</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Quantidade de parcelas">
              {editando ? (
                <Input value={textoParcela(editando.parcela, editando.quantidadeParcelas) || editando.descricao} disabled />
              ) : (
                <Input inputMode="numeric" value={form.quantidade} onChange={(event) => definirQuantidade(event.target.value)} />
              )}
            </Campo>
            {!editando && form.tipoVencimento === "data_fixa" && Array.from({ length: quantidade }, (_, indice) => (
              <Campo key={indice} label={quantidade === 1 ? "Vencimento" : `Vencimento da parcela ${indice + 1}`}>
                <Input
                  type="date"
                  value={form.vencimentos[indice] ?? ""}
                  onChange={(event) => {
                    const vencimentos = [...form.vencimentos];
                    vencimentos[indice] = event.target.value;
                    setForm({ ...form, vencimentos });
                  }}
                />
              </Campo>
            ))}
            {!editando && form.tipoVencimento === "prazo_dias" && (
              <div className="grid gap-3 md:grid-cols-2">
                <Campo label="Prazo em dias">
                  <Input inputMode="numeric" value={form.prazoDias} onChange={(event) => setForm({ ...form, prazoDias: event.target.value })} />
                </Campo>
                <Campo label="Primeiro vencimento">
                  <Input type="date" value={form.primeiroVencimento} onChange={(event) => setForm({ ...form, primeiroVencimento: event.target.value })} />
                </Campo>
              </div>
            )}
            {editando && form.tipoVencimento === "data_fixa" && (
              <Campo label="Vencimento">
                <Input type="date" value={form.vencimentos[0]} onChange={(event) => setForm({ ...form, vencimentos: [event.target.value] })} />
              </Campo>
            )}
            {editando && form.tipoVencimento === "prazo_dias" && (
              <div className="grid gap-3 md:grid-cols-2">
                <Campo label="Prazo em dias">
                  <Input inputMode="numeric" value={form.prazoDias} onChange={(event) => setForm({ ...form, prazoDias: event.target.value })} />
                </Campo>
                <Campo label="Vencimento">
                  <Input type="date" value={form.vencimentos[0]} onChange={(event) => setForm({ ...form, vencimentos: [event.target.value] })} />
                </Campo>
              </div>
            )}
            <Campo label="Banco de recebimento">
              <Input value={form.banco} placeholder="Ex.: Cora" onChange={(event) => setForm({ ...form, banco: event.target.value })} />
            </Campo>
            <Campo label="Centro de custo">
              <Select value={form.centroId || undefined} onValueChange={(centroId) => setForm({ ...form, centroId })} disabled={!podeMudar}>
                <SelectTrigger><SelectValue placeholder="Selecione o centro" /></SelectTrigger>
                <SelectContent>
                  {(centros.data ?? []).filter((centro) => centro.ativo).map((centro) => (
                    <SelectItem key={centro.id} value={centro.id}>{centro.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            {editando && (
              <Campo label="Competência">
                <Input type="month" value={form.competencia} onChange={(event) => setForm({ ...form, competencia: event.target.value })} />
              </Campo>
            )}
            {podeMudar && <div className="flex gap-2">
              <Button
                onClick={() =>
                  executar(async () => {
                    if (editando) {
                      await atualizarTitulo(editando, {
                        descricao: form.descricao,
                        valor: form.valor,
                        vencimento: form.vencimentos[0],
                        competencia: form.competencia,
                        ...(avulso ? { origem, clienteId: form.clienteId } : {}),
                        forma: form.forma,
                        numeroNf: form.numeroNf,
                        tipoVencimento: form.tipoVencimento,
                        prazoDias: form.prazoDias,
                        banco: form.banco,
                        centroId: form.centroId,
                      });
                      await recarregar();
                    } else {
                      await criarTituloAvulso({
                        descricao: form.descricao,
                        valor: form.valor,
                        origem,
                        clienteId: form.clienteId,
                        forma: form.forma,
                        numeroNf: form.numeroNf,
                        tipoVencimento: form.tipoVencimento,
                        prazoDias: form.prazoDias,
                        quantidade: form.quantidade,
                        vencimentos: form.vencimentos.slice(0, quantidade),
                        primeiroVencimento: form.primeiroVencimento,
                        banco: form.banco,
                        centroId: form.centroId,
                      });
                    }
                    if (!editando) {
                      limpar();
                      await recarregar();
                    }
                  }, editando ? "Título atualizado" : "Título previsto criado")
                }
              >
                {editando ? "Salvar título" : "Criar título previsto"}
              </Button>
              {editando && podeMudar && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    executar(async () => {
                      await excluirTitulo(editando);
                      await recarregar();
                      navigate("/contas");
                    }, "Título excluído")
                  }
                >
                  Excluir
                </Button>
              )}
            </div>}
            </fieldset>
          </CardContent>
        </Card>
      )}
      {canEdit && editando && (
        <Card>
          <CardContent className="space-y-3 py-4">
            <div>
              <h2 className="text-lg font-semibold">Nota fiscal</h2>
              <p className="text-sm text-muted-foreground">
                Gerar NF grava a nota já autorizada neste título ({MUNICIPIO_NFSE}). Não chama o Emissor Nacional. O botão fica ativo com o título faturado ou recebido, enquanto a NFS-e não está informada.
              </p>
            </div>
            {editando.nfse?.status === "informada" ? (
              <div className="space-y-2">
                <p className="text-sm">NFS-e {editando.nfse.numero} · {editando.nfse.status}</p>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => executar(() => anularNfse(editando).then(recarregar), "NFS-e cancelada")}
                >
                  Cancelar NFS-e
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={editando.status !== "faturado" && editando.status !== "recebido"}
                  onClick={() => {
                    setNfForm({
                      numero: editando.numeroNf ?? "",
                      valor: reaisInput(editando.valor),
                      vencimento: editando.vencimento,
                      data: hoje(),
                      codigo: "",
                    });
                    setNfAberta(true);
                  }}
                >
                  Gerar NF
                </Button>
                {editando.status !== "faturado" && editando.status !== "recebido" && (
                  <p className="text-sm text-muted-foreground">Fature o título para gerar a NF. Previsto e cancelado não gravam nota.</p>
                )}
                {nfAberta && (editando.status === "faturado" || editando.status === "recebido") && (
                  <div className="grid gap-3">
                    <Campo label="Número"><Input value={nfForm.numero} onChange={(event) => setNfForm({ ...nfForm, numero: event.target.value })} /></Campo>
                    <Campo label="Valor"><CampoDinheiro value={nfForm.valor} onChange={(valor) => setNfForm({ ...nfForm, valor })} /></Campo>
                    <Campo label="Vencimento"><Input type="date" value={nfForm.vencimento} onChange={(event) => setNfForm({ ...nfForm, vencimento: event.target.value })} /></Campo>
                    <Campo label="Data de emissão"><Input type="date" value={nfForm.data} onChange={(event) => setNfForm({ ...nfForm, data: event.target.value })} /></Campo>
                    <Campo label="Código de verificação"><Input value={nfForm.codigo} onChange={(event) => setNfForm({ ...nfForm, codigo: event.target.value })} /></Campo>
                    <Button
                      type="button"
                      onClick={() =>
                        executar(async () => {
                          await gravarNfse(editando, {
                            numero: nfForm.numero,
                            valor: nfForm.valor,
                            vencimento: nfForm.vencimento,
                            dataEmissao: nfForm.data,
                            codigo: nfForm.codigo,
                          });
                          setNfAberta(false);
                          await recarregar();
                        }, "NFS-e registrada")
                      }
                    >
                      Gerar NF
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {canEdit && editando && <BoletoTitulo titulo={editando} alterado={alterado} onMudou={recarregar} />}
    </div>
  );
}

function centavosDoForm(valor: string): number | null {
  try {
    return reaisToCents(valor);
  } catch {
    return null;
  }
}
