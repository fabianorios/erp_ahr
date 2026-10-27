import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvisoConsulta, Campo, Pill, TituloPagina, dataBr, executar, reais } from "@/components/erp/apresentacao";
import { ROTULO_FORMA, textoParcela } from "@/components/erp/rotulos-titulo";
import { useAuth } from "@/lib/auth-context";
import { listarCentros, listarTitulos, preencherTitulosVazios, type TituloItem } from "@/services/erp/api";

const STATUS = [
  ["todos", "Todos"],
  ["previsto", "Previsto"],
  ["faturado", "Faturado"],
  ["recebido", "Recebido"],
  ["cancelado", "Cancelado"],
] as const;

const grupoVazio = {
  centroId: "",
  forma: "",
  banco: "",
  numeroNf: "",
  tipoVencimento: "",
  prazoDias: "",
  competencia: "",
};

export function ConsultaPage() {
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const titulos = useQuery({ queryKey: ["erp", "titulos", "lista"], queryFn: listarTitulos });
  const centros = useQuery({ queryKey: ["erp", "centros"], queryFn: listarCentros });
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [grupo, setGrupo] = useState(grupoVazio);
  const [clienteId, setClienteId] = useState("todos");
  const [status, setStatus] = useState("todos");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [origem, setOrigem] = useState("todas");
  const [centroId, setCentroId] = useState("todos");

  const linhas = titulos.data ?? [];
  const clientes = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const titulo of linhas) {
      if (titulo.clienteId) mapa.set(titulo.clienteId, titulo.clienteNome || "Cliente");
    }
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [linhas]);
  const origens = useMemo(
    () => [...new Set(linhas.map((titulo) => titulo.origem).filter((item): item is string => Boolean(item)))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [linhas],
  );
  const nomesCentro = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const centro of centros.data ?? []) mapa.set(centro.id, centro.nome);
    return mapa;
  }, [centros.data]);
  const centrosFiltro = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const centro of centros.data ?? []) {
      if (centro.ativo) mapa.set(centro.id, centro.nome);
    }
    for (const titulo of linhas) {
      if (titulo.centroId && !mapa.has(titulo.centroId)) mapa.set(titulo.centroId, nomesCentro.get(titulo.centroId) || "Centro");
    }
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [centros.data, linhas, nomesCentro]);

  const filtrados = linhas.filter((titulo) => {
    if (clienteId !== "todos" && titulo.clienteId !== clienteId) return false;
    if (status !== "todos" && titulo.status !== status) return false;
    if (de && titulo.vencimento < de) return false;
    if (ate && titulo.vencimento > ate) return false;
    if (origem === "sem" && titulo.origem) return false;
    if (origem !== "todas" && origem !== "sem" && titulo.origem !== origem) return false;
    if (centroId === "sem" && titulo.centroId) return false;
    if (centroId !== "todos" && centroId !== "sem" && titulo.centroId !== centroId) return false;
    return true;
  });
  const idsFiltrados = filtrados.map((titulo) => titulo.id);
  const todosMarcados = idsFiltrados.length > 0 && idsFiltrados.every((id) => selecionados.includes(id));
  const ativos = (centros.data ?? []).filter((centro) => centro.ativo);

  function marcar(id: string, marcado: boolean) {
    setSelecionados((atual) => (marcado ? [...new Set([...atual, id])] : atual.filter((item) => item !== id)));
  }

  return (
    <div className="space-y-6">
      <TituloPagina
        titulo="Consulta de títulos a receber"
        descricao="A lista dos títulos. Abrir uma linha volta para a manutenção daquele título."
      />
      <AvisoConsulta erro={titulos.error ?? centros.error} />
      <div className="grid gap-3 md:grid-cols-3">
        <Campo label="Cliente">
          <Select value={clienteId} onValueChange={setClienteId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {clientes.map(([id, nome]) => (
                <SelectItem key={id} value={id}>{nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo label="Status">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS.map(([valor, rotulo]) => (
                <SelectItem key={valor} value={valor}>{rotulo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo label="Origem">
          <Select value={origem} onValueChange={setOrigem}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="sem">Sem origem</SelectItem>
              {origens.map((item) => (
                <SelectItem key={item} value={item}>{item}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo label="Vencimento de">
          <Input type="date" value={de} onChange={(event) => setDe(event.target.value)} />
        </Campo>
        <Campo label="Vencimento até">
          <Input type="date" value={ate} onChange={(event) => setAte(event.target.value)} />
        </Campo>
        <Campo label="Centro de custo">
          <Select value={centroId} onValueChange={setCentroId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="sem">Sem centro</SelectItem>
              {centrosFiltro.map(([id, nome]) => (
                <SelectItem key={id} value={id}>{nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
      </div>
      {canEdit && (
        <Card>
          <CardContent className="grid gap-3 py-4">
            <div>
              <h2 className="font-medium">Manutenção em grupo</h2>
              <p className="text-sm text-muted-foreground">
                Preenche só o campo que ainda está vazio nos títulos previstos selecionados, sem NFS-e e sem boleto. Um valor já gravado permanece.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Campo label="Centro de custo">
                <Select value={grupo.centroId || undefined} onValueChange={(centroId) => setGrupo({ ...grupo, centroId })}>
                  <SelectTrigger><SelectValue placeholder="Só se estiver vazio" /></SelectTrigger>
                  <SelectContent>
                    {ativos.map((centro) => (
                      <SelectItem key={centro.id} value={centro.id}>{centro.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo label="Forma de recebimento">
                <Select value={grupo.forma || undefined} onValueChange={(forma) => setGrupo({ ...grupo, forma })}>
                  <SelectTrigger><SelectValue placeholder="Só se estiver vazia" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="boleto">Boleto</SelectItem>
                    <SelectItem value="pix">PIX</SelectItem>
                    <SelectItem value="transferencia">Transferência</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </Campo>
              <Campo label="Banco de recebimento">
                <Input value={grupo.banco} placeholder="Ex.: Cora" onChange={(event) => setGrupo({ ...grupo, banco: event.target.value })} />
              </Campo>
              <Campo label="Número da NF">
                <Input value={grupo.numeroNf} onChange={(event) => setGrupo({ ...grupo, numeroNf: event.target.value })} />
              </Campo>
              <Campo label="Tipo de vencimento">
                <Select value={grupo.tipoVencimento || undefined} onValueChange={(tipoVencimento) => setGrupo({ ...grupo, tipoVencimento })}>
                  <SelectTrigger><SelectValue placeholder="Só se estiver vazio" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="data_fixa">Data fixa</SelectItem>
                    <SelectItem value="prazo_dias">Prazo em dias</SelectItem>
                  </SelectContent>
                </Select>
              </Campo>
              {grupo.tipoVencimento === "prazo_dias" && (
                <Campo label="Prazo em dias">
                  <Input inputMode="numeric" value={grupo.prazoDias} onChange={(event) => setGrupo({ ...grupo, prazoDias: event.target.value })} />
                </Campo>
              )}
              <Campo label="Competência">
                <Input type="month" value={grupo.competencia} onChange={(event) => setGrupo({ ...grupo, competencia: event.target.value })} />
              </Campo>
            </div>
            <Button
              onClick={() =>
                executar(async () => {
                  const resultado = await preencherTitulosVazios(selecionados, grupo);
                  await qc.invalidateQueries({ queryKey: ["erp", "titulos"] });
                  setSelecionados([]);
                  setGrupo(grupoVazio);
                  return `${resultado.atualizados} título(s) atualizado(s). ${resultado.ignorados} ignorado(s). ${resultado.semVazio} já tinham esses campos.`;
                }, "Manutenção em grupo aplicada")
              }
            >
              Manutenção em grupo
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="py-4">
          {titulos.isLoading && <p className="text-sm text-muted-foreground">Carregando títulos…</p>}
          {!titulos.isLoading && filtrados.length === 0 && <p className="text-sm text-muted-foreground">Nenhum título neste filtro.</p>}
          {filtrados.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">
                      <input
                        type="checkbox"
                        aria-label="Selecionar títulos da consulta"
                        checked={todosMarcados}
                        onChange={(event) => setSelecionados(event.target.checked ? idsFiltrados : selecionados.filter((id) => !idsFiltrados.includes(id)))}
                      />
                    </th>
                    <th className="py-2 pr-3 font-medium">Cliente</th>
                    <th className="py-2 pr-3 font-medium">Descrição</th>
                    <th className="py-2 pr-3 font-medium">Valor</th>
                    <th className="py-2 pr-3 font-medium">Vencimento</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Parcela</th>
                    <th className="py-2 pr-3 font-medium">Forma de recebimento</th>
                    <th className="py-2 pr-3 font-medium">Banco</th>
                    <th className="py-2 pr-3 font-medium">Número da NF</th>
                    <th className="py-2 pr-3 font-medium">Centro de custo</th>
                    <th className="py-2 font-medium">Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((titulo) => (
                    <Linha
                      key={titulo.id}
                      titulo={titulo}
                      centroNome={nomeCentro(titulo, nomesCentro)}
                      marcado={selecionados.includes(titulo.id)}
                      onMarcar={(marcado) => marcar(titulo.id, marcado)}
                      onOpen={() => navigate(`/contas/${titulo.id}`)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function nomeCentro(titulo: TituloItem, nomes: Map<string, string>): string {
  if (!titulo.centroId) return "";
  return nomes.get(titulo.centroId) || "";
}

function Linha({
  titulo,
  centroNome,
  marcado,
  onMarcar,
  onOpen,
}: {
  titulo: TituloItem;
  centroNome: string;
  marcado: boolean;
  onMarcar: (marcado: boolean) => void;
  onOpen: () => void;
}) {
  return (
    <tr className="cursor-pointer border-b hover:bg-muted/40" onClick={onOpen}>
      <td className="py-2 pr-3" onClick={(event) => event.stopPropagation()}>
        <input type="checkbox" aria-label={`Selecionar ${titulo.descricao}`} checked={marcado} onChange={(event) => onMarcar(event.target.checked)} />
      </td>
      <td className="py-2 pr-3">{titulo.clienteNome || "—"}</td>
      <td className="py-2 pr-3">{titulo.descricao}</td>
      <td className="py-2 pr-3">{reais(titulo.valor)}</td>
      <td className="py-2 pr-3">{dataBr(titulo.vencimento)}</td>
      <td className="py-2 pr-3"><Pill valor={titulo.status} /></td>
      <td className="py-2 pr-3">{textoParcela(titulo.parcela, titulo.quantidadeParcelas) || "—"}</td>
      <td className="py-2 pr-3">{ROTULO_FORMA[titulo.formaRecebimento ?? ""] ?? "—"}</td>
      <td className="py-2 pr-3">{titulo.banco || "—"}</td>
      <td className="py-2 pr-3">{titulo.numeroNf || "—"}</td>
      <td className="py-2 pr-3">{centroNome || "—"}</td>
      <td className="py-2">{titulo.origem ?? ""}</td>
    </tr>
  );
}
