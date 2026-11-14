import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AvisoConsulta, Campo, CampoDinheiro, Pill, TituloPagina, dataBr, executar, reais, reaisInput } from "@/components/erp/apresentacao";
import { BoletoTitulo } from "@/components/erp/boleto-titulo";
import { ListaFinanceira, filtroVisivelVazio, type LinhaLista } from "@/components/erp/lista-financeira";
import { textoParcela } from "@/components/erp/rotulos-titulo";
import { useAuth } from "@/lib/auth-context";
import { abrirPdfBoleto, abrirPdfNfse, atualizarTitulo, buscarPdfNfse, cancelarNfseNacional, criarTituloAvulso, emitirNfNacional, excluirTitulo, listarCentros, listarClientesFinanceiros, listarTitulos, obterTitulo, type TituloItem } from "@/services/erp/api";
import { DomainError, formatBrl, podeExcluirTitulo, reaisToCents } from "@/services/erp/domain";
import { passaFiltro, type CriterioLista } from "@/services/erp/lista";
import { dividirNota } from "@/services/erp/nfse-nacional";

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
  valores: [""],
  primeiroVencimento: "",
  competencia: "",
  banco: "",
  centroId: "",
  modo: "Word" as "Word" | "Outro sistema" | "texto",
  texto: "",
};

const STATUS_RECEBER = [
  { valor: "previsto", rotulo: "Previsto" },
  { valor: "faturado", rotulo: "Faturado" },
  { valor: "recebido", rotulo: "Recebido" },
  { valor: "cancelado", rotulo: "Cancelado" },
];

const RECORRENCIAS_RECEBER = [
  { valor: "avulsa", rotulo: "Sem parcela" },
  { valor: "parcelado", rotulo: "Parcelada" },
];

const DOCUMENTOS = [
  { valor: "todos", rotulo: "Todas" },
  { valor: "com_nota", rotulo: "Com nota" },
  { valor: "com_boleto", rotulo: "Com boleto" },
  { valor: "nota_ou_boleto", rotulo: "Com nota ou boleto" },
  { valor: "sem_nota_boleto", rotulo: "Sem nota e sem boleto" },
];

export function ContasPage() {
  const { id } = useParams();
  const caminho = useLocation().pathname;
  const incluindo = caminho.endsWith("/novo");
  const alterando = caminho.endsWith("/editar");
  if (!id && !incluindo) return <ListaReceber />;
  return <FormularioReceber id={id} incluindo={incluindo} alterando={alterando} />;
}

function ListaReceber() {
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const titulos = useQuery({ queryKey: ["erp", "titulos", "lista"], queryFn: listarTitulos });
  const centros = useQuery({ queryKey: ["erp", "centros"], queryFn: listarCentros });
  const [filtro, setFiltro] = useState(filtroVisivelVazio);
  const linhas = titulos.data ?? [];
  const criterio: CriterioLista = {
    de: filtro.de,
    ate: filtro.ate,
    pessoa: filtro.pessoa,
    status: filtro.status,
    valorMin: limite(filtro.valorMin),
    valorMax: limite(filtro.valorMax),
    centro: filtro.centro,
    recorrencia: filtro.recorrencia,
    documento: filtro.documento,
  };
  const filtradas = linhas.filter((titulo) =>
    passaFiltro(
      {
        pessoaId: titulo.clienteId ?? "",
        status: titulo.status,
        vencimento: titulo.vencimento,
        valor: titulo.valor,
        centroId: titulo.centroId ?? "",
        recorrencia: titulo.quantidadeParcelas && titulo.quantidadeParcelas > 1 ? "parcelado" : "avulsa",
        nota: Boolean(titulo.nfse),
        boleto: Boolean(titulo.boleto),
      },
      criterio,
    ),
  );
  const pessoas = [...new Map(linhas.filter((titulo) => titulo.clienteId).map((titulo) => [titulo.clienteId as string, titulo.clienteNome || "Cliente"])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
    .map(([valor, rotulo]) => ({ valor, rotulo }));
  const centrosOpcoes = [...new Map((centros.data ?? []).map((centro) => [centro.id, centro.nome])).entries()].map(([valor, rotulo]) => ({ valor, rotulo }));
  const tabela: LinhaLista[] = filtradas.map((titulo) => {
    let podeExcluir = true;
    try {
      podeExcluirTitulo(Boolean(titulo.nfse), Boolean(titulo.boleto));
    } catch {
      podeExcluir = false;
    }
    return {
      id: titulo.id,
      pessoa: titulo.clienteNome || "",
      descricao: titulo.descricao,
      valor: titulo.valor,
      vencimento: titulo.vencimento,
      status: titulo.status,
      detalhe: textoParcela(titulo.parcela, titulo.quantidadeParcelas) || undefined,
      podeExcluir,
      motivoBloqueio: "O título tem nota ou boleto e não pode ser excluído.",
    };
  });

  return (
    <ListaFinanceira
      titulo="Contas a receber"
      descricao="A lista de todos os títulos a receber. Incluir abre o formulário e, ao gravar ou cancelar, volta para cá."
      erro={titulos.error ?? centros.error}
      carregando={titulos.isLoading}
      canEdit={canEdit}
      rotuloPessoa="Cliente"
      pessoas={pessoas}
      statusOpcoes={STATUS_RECEBER}
      centros={centrosOpcoes}
      recorrencias={RECORRENCIAS_RECEBER}
      documentos={DOCUMENTOS}
      filtro={filtro}
      onFiltro={setFiltro}
      linhas={tabela}
      onIncluir={() => navigate("/contas/novo")}
      onVer={(itemId) => navigate(`/contas/${itemId}`)}
      onAlterar={(itemId) => navigate(`/contas/${itemId}/editar`)}
      onExcluir={(itemId) => {
        const titulo = linhas.find((linha) => linha.id === itemId);
        if (!titulo) return;
        void executar(async () => {
          await excluirTitulo(titulo);
          await qc.invalidateQueries({ queryKey: ["erp", "titulos"] });
        }, "Título excluído");
      }}
    />
  );
}

function FormularioReceber({ id, incluindo, alterando }: { id?: string; incluindo: boolean; alterando: boolean }) {
  const vendo = Boolean(id) && !alterando && !incluindo;
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const clientes = useQuery({ queryKey: ["erp", "clientes"], queryFn: listarClientesFinanceiros });
  const centros = useQuery({ queryKey: ["erp", "centros"], queryFn: listarCentros });
  const aberto = useQuery({ queryKey: ["erp", "titulos", "um", id], queryFn: () => obterTitulo(id ?? ""), enabled: Boolean(id) });
  const [form, setForm] = useState(vazio);
  const [editando, setEditando] = useState<TituloItem | null>(null);
  const [cancelandoNfse, setCancelandoNfse] = useState(false);
  const [motivoNfse, setMotivoNfse] = useState("1");
  const [justificativaNfse, setJustificativaNfse] = useState("");
  const [ocupadoNfse, setOcupadoNfse] = useState(false);
  const [erroBoleto, setErroBoleto] = useState<string | null>(null);

  const origem = form.modo === "texto" ? form.texto : form.modo;
  const quantidade = Math.max(1, Number(form.quantidade) || 1);

  function definirQuantidade(valor: string) {
    const total = Math.max(1, Number(valor) || 1);
    const vencimentos = Array.from({ length: total }, (_, indice) => form.vencimentos[indice] ?? "");
    const valores = Array.from({ length: total }, (_, indice) => form.valores[indice] ?? "");
    setForm({ ...form, quantidade: valor, vencimentos, valores });
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
      valores: [reaisInput(titulo.valor)],
      primeiroVencimento: titulo.vencimento,
      competencia: titulo.competencia.slice(0, 7),
      banco: titulo.banco ?? "",
      centroId: titulo.centroId ?? titulo.centroPadraoId ?? "",
      modo,
      texto: modo === "texto" ? titulo.origem ?? "" : "",
    });
  }

  useEffect(() => {
    setCancelandoNfse(false);
    setMotivoNfse("1");
    setJustificativaNfse("");
    setErroBoleto(null);
  }, [id]);

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
          titulo={vendo ? "Título a receber" : alterando ? "Alterar conta a receber" : "Incluir conta a receber"}
          descricao="Gerar NF emite a nota no valor cheio do serviço. Informe a quantidade, o valor e o vencimento de cada parcela; a soma fecha o valor da nota. Uma parcela abre um título. Várias parcelas, se o portal autorizar, abrem um título cada, todos com o mesmo número e o mesmo PDF. No título já criado ficam o boleto, o kit, o vencimento, o cancelamento e a baixa."
        />
        <Button type="button" variant="outline" onClick={() => navigate("/contas")}>{vendo ? "Voltar para a lista" : "Cancelar"}</Button>
      </div>
      <AvisoConsulta erro={aberto.error ?? centros.error} />
      {vendo && editando && (
        <Card>
          <CardContent className="space-y-2 py-4">
            <div className="font-medium">{editando.descricao}</div>
            <p className="text-sm text-muted-foreground">
              {editando.clienteNome || "Sem cliente"} · {reais(editando.valor)} · vence {dataBr(editando.vencimento)}
            </p>
            <Pill valor={editando.status} />
            {canEdit && (
              <div>
                <Button type="button" variant="outline" onClick={() => navigate(`/contas/${editando.id}/editar`)}>Alterar</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {canEdit && !vendo && (
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
            <Campo label={!editando && quantidade > 1 ? "Valor do serviço" : "Valor da parcela"}>
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
            {!editando && quantidade > 1 && (
              <div className="grid gap-3">
                <p className="text-sm text-muted-foreground">
                  Cada parcela da NFS-e tem valor e vencimento. A soma fecha o valor do serviço. Gerar NF usa estas linhas. Criar título previsto repete o valor do serviço em cada parcela.
                </p>
                {Array.from({ length: quantidade }, (_, indice) => (
                  <div key={indice} className="grid gap-3 md:grid-cols-2">
                    <Campo label={`Valor da parcela ${indice + 1}`}>
                      <CampoDinheiro
                        value={form.valores[indice] ?? ""}
                        onChange={(valorParcela) => {
                          const valores = [...form.valores];
                          valores[indice] = valorParcela;
                          setForm({ ...form, valores });
                        }}
                      />
                    </Campo>
                    <Campo label={`Vencimento da parcela ${indice + 1}`}>
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
                  </div>
                ))}
                <p className="text-sm text-muted-foreground">{textoSoma(form.valor, form.valores.slice(0, quantidade))}</p>
              </div>
            )}
            {!editando && quantidade === 1 && form.tipoVencimento === "data_fixa" && (
              <Campo label="Vencimento">
                <Input
                  type="date"
                  value={form.vencimentos[0] ?? ""}
                  onChange={(event) => setForm({ ...form, vencimentos: [event.target.value] })}
                />
              </Campo>
            )}
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
              {!editando && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    executar(async () => {
                      const parcelas = quantidade > 1
                        ? Array.from({ length: quantidade }, (_, indice) => ({
                            valor: form.valores[indice] ?? "",
                            vencimento: form.vencimentos[indice] ?? "",
                          }))
                        : undefined;
                      if (parcelas) dividirNota({ valor: form.valor, vencimento: parcelas[0]?.vencimento ?? "", parcelas });
                      await emitirNfNacional({
                        clienteId: form.clienteId,
                        descricao: form.descricao,
                        valor: form.valor,
                        vencimento: quantidade > 1
                          ? (form.vencimentos[0] ?? "")
                          : form.tipoVencimento === "prazo_dias"
                            ? form.primeiroVencimento
                            : (form.vencimentos[0] ?? ""),
                        centroId: form.centroId,
                        forma: form.forma,
                        banco: form.banco,
                        parcelas,
                      });
                      await recarregar();
                      navigate("/contas");
                    }, quantidade > 1 ? "NFS-e autorizada. Cada parcela virou um título com a mesma nota." : "NFS-e autorizada. O título nasceu da nota.")
                  }
                >
                  Gerar NF
                </Button>
              )}
              <Button
                type="button"
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
                    await recarregar();
                    navigate("/contas");
                  }, editando ? "Título atualizado" : "Título previsto criado")
                }
              >
                Gravar
              </Button>
              <Button type="button" variant="ghost" onClick={() => navigate("/contas")}>Cancelar</Button>
            </div>}
            </fieldset>
          </CardContent>
        </Card>
      )}
      {canEdit && !editando && (
        <p className="text-sm text-muted-foreground">
          Preencha cliente, descrição, valor, vencimento e centro. Com uma parcela, Gerar NF emite a nota nesse valor e abre um título. Com várias, informe o valor e o vencimento de cada uma; a soma fecha o valor do serviço e a nota sai nesse total. Rejeição não cria título.
        </p>
      )}
      {editando?.nfse && (
        <Card>
          <CardContent className="space-y-2 py-4">
            <h2 className="text-lg font-semibold">NFS-e</h2>
            <p className="text-sm">Número {editando.nfse.numero}</p>
            <p className="text-sm">Status {editando.nfse.status}</p>
            <p className="text-sm">Emissão {dataBr(editando.nfse.dataEmissao)}</p>
            {editando.nfse.status === "informada" && editando.nfse.temPdf && (
              <Button type="button" variant="outline" onClick={() => executar(() => abrirPdfNfse(editando.id), "PDF da NFS-e aberto.")}>
                Abrir PDF da NFS-e
              </Button>
            )}
            {editando.nfse.status === "informada" && !editando.nfse.temPdf && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">O PDF desta NFS-e não está no servidor.</p>
                {canEdit && (
                  <Button
                    type="button"
                    onClick={() =>
                      executar(async () => {
                        await buscarPdfNfse(editando.id);
                        await recarregar();
                      }, "PDF da NFS-e gravado")
                    }
                  >
                    Buscar PDF
                  </Button>
                )}
              </div>
            )}
            {canEdit && editando.nfse.status === "informada" && editando.nfse.chave && (
              <div className="space-y-3 pt-2">
                {!cancelandoNfse && (
                  <Button type="button" variant="outline" disabled={ocupadoNfse} onClick={() => setCancelandoNfse(true)}>
                    Cancelar NFS-e
                  </Button>
                )}
                {cancelandoNfse && (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">Se o boleto Cora ainda estiver em aberto ou atrasado, ele também é cancelado.</p>
                    <Campo label="Motivo">
                      <Select value={motivoNfse} onValueChange={setMotivoNfse}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Erro na emissão</SelectItem>
                          <SelectItem value="2">Serviço não prestado</SelectItem>
                        </SelectContent>
                      </Select>
                    </Campo>
                    <Campo label="Justificativa">
                      <Textarea value={justificativaNfse} onChange={(event) => setJustificativaNfse(event.target.value)} />
                    </Campo>
                    <p className="text-sm text-muted-foreground">No mínimo 15 caracteres.</p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        disabled={ocupadoNfse}
                        onClick={() => {
                          setOcupadoNfse(true);
                          void executar(async () => {
                            const resultado = await cancelarNfseNacional(editando, { motivo: motivoNfse, justificativa: justificativaNfse });
                            setCancelandoNfse(false);
                            await recarregar();
                            if (resultado.erroBoleto) {
                              setErroBoleto(resultado.erroBoleto);
                              throw new DomainError(resultado.erroBoleto);
                            }
                            setErroBoleto(null);
                            return resultado.aviso;
                          }, "NFS-e cancelada").finally(() => setOcupadoNfse(false));
                        }}
                      >
                        Confirmar cancelamento
                      </Button>
                      <Button type="button" variant="ghost" disabled={ocupadoNfse} onClick={() => setCancelandoNfse(false)}>
                        Voltar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {editando?.boleto?.temPdf && !canEdit && (
        <Button type="button" variant="outline" onClick={() => executar(() => abrirPdfBoleto(editando.id), "PDF do boleto aberto.")}>
          Abrir PDF do boleto
        </Button>
      )}
      {canEdit && editando && !editando.nfse && !editando.boleto && (
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            executar(async () => {
              await excluirTitulo(editando);
              await recarregar();
              navigate("/contas");
            }, "Título excluído")
          }
        >
          Excluir título
        </Button>
      )}
      {canEdit && editando && <BoletoTitulo titulo={editando} alterado={alterado} erroBoleto={erroBoleto} onMudou={recarregar} />}
    </div>
  );
}

function limite(texto: string): number | null {
  if (!texto.trim()) return null;
  try {
    return reaisToCents(texto);
  } catch {
    return null;
  }
}

function centavosDoForm(valor: string): number | null {
  try {
    return reaisToCents(valor);
  } catch {
    return null;
  }
}

function textoSoma(valor: string, valores: string[]): string {
  let soma = 0;
  for (const item of valores) {
    if (!item.trim()) return "Informe o valor e o vencimento de cada parcela. A soma precisa fechar o valor do serviço.";
    try {
      soma += reaisToCents(item);
    } catch {
      return "Informe o valor de cada parcela em reais.";
    }
  }
  const nota = centavosDoForm(valor);
  const somaTexto = formatBrl(soma);
  if (nota == null) return `Soma das parcelas: ${somaTexto}.`;
  if (soma === nota) return `Soma das parcelas: ${somaTexto}. Fecha o valor do serviço.`;
  return `Soma das parcelas: ${somaTexto}. Ainda não fecha o valor do serviço.`;
}
