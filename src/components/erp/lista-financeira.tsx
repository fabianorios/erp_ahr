import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvisoConsulta, Campo, Pill, TituloPagina, dataBr, reais } from "@/components/erp/apresentacao";
import { paginar, totaisLista } from "@/services/erp/lista";

export type OpcaoLista = { valor: string; rotulo: string };

export type FiltroVisivel = {
  de: string;
  ate: string;
  pessoa: string;
  status: string;
  valorMin: string;
  valorMax: string;
  centro: string;
  recorrencia: string;
  documento: string;
};

export const filtroVisivelVazio: FiltroVisivel = {
  de: "",
  ate: "",
  pessoa: "todos",
  status: "todos",
  valorMin: "",
  valorMax: "",
  centro: "todos",
  recorrencia: "todos",
  documento: "todos",
};

export type LinhaLista = {
  id: string;
  pessoa: string;
  descricao: string;
  valor: number;
  vencimento: string | null;
  status: string;
  detalhe?: string;
  podeExcluir: boolean;
  motivoBloqueio: string;
};

const TAMANHOS = [10, 25, 50];

export function ListaFinanceira({
  titulo,
  descricao,
  erro,
  carregando,
  canEdit,
  rotuloPessoa,
  pessoas,
  statusOpcoes,
  centros,
  recorrencias,
  documentos,
  filtro,
  onFiltro,
  linhas,
  onIncluir,
  onVer,
  onAlterar,
  onExcluir,
}: {
  titulo: string;
  descricao: string;
  erro: unknown;
  carregando: boolean;
  canEdit: boolean;
  rotuloPessoa: string;
  pessoas: OpcaoLista[];
  statusOpcoes: OpcaoLista[];
  centros: OpcaoLista[];
  recorrencias: OpcaoLista[];
  documentos?: OpcaoLista[];
  filtro: FiltroVisivel;
  onFiltro: (filtro: FiltroVisivel) => void;
  linhas: LinhaLista[];
  onIncluir: () => void;
  onVer: (id: string) => void;
  onAlterar: (id: string) => void;
  onExcluir: (id: string) => void;
}) {
  const [avancado, setAvancado] = useState(false);
  const [tamanho, setTamanho] = useState(25);
  const [pagina, setPagina] = useState(1);
  const chave = JSON.stringify(filtro);

  useEffect(() => {
    setPagina(1);
  }, [chave, tamanho]);

  const paginas = Math.max(1, Math.ceil(linhas.length / tamanho));
  const atual = Math.min(pagina, paginas);
  const visiveis = paginar(linhas, atual, tamanho);
  const totais = totaisLista(
    visiveis.map((linha) => linha.valor),
    linhas.map((linha) => linha.valor),
  );

  function mudar<K extends keyof FiltroVisivel>(campo: K, valor: FiltroVisivel[K]) {
    onFiltro({ ...filtro, [campo]: valor });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TituloPagina titulo={titulo} descricao={descricao} />
        {canEdit && <Button type="button" onClick={onIncluir}>Incluir</Button>}
      </div>
      <AvisoConsulta erro={erro} />
      <div className="grid gap-3 md:grid-cols-4">
        <Campo label="Período de">
          <Input type="date" value={filtro.de} onChange={(event) => mudar("de", event.target.value)} />
        </Campo>
        <Campo label="Período até">
          <Input type="date" value={filtro.ate} onChange={(event) => mudar("ate", event.target.value)} />
        </Campo>
        <Campo label={rotuloPessoa}>
          <Select value={filtro.pessoa} onValueChange={(pessoa) => mudar("pessoa", pessoa)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {pessoas.map((opcao) => (
                <SelectItem key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo label="Status">
          <Select value={filtro.status} onValueChange={(status) => mudar("status", status)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {statusOpcoes.map((opcao) => (
                <SelectItem key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
      </div>
      <div>
        <Button type="button" variant="outline" onClick={() => setAvancado((aberto) => !aberto)}>
          {avancado ? "Ocultar filtros avançados" : "Filtros avançados"}
        </Button>
        {avancado && (
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <Campo label="Valor mínimo">
              <Input value={filtro.valorMin} onChange={(event) => mudar("valorMin", event.target.value)} placeholder="0,00" />
            </Campo>
            <Campo label="Valor máximo">
              <Input value={filtro.valorMax} onChange={(event) => mudar("valorMax", event.target.value)} placeholder="0,00" />
            </Campo>
            <Campo label="Centro">
              <Select value={filtro.centro} onValueChange={(centro) => mudar("centro", centro)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {centros.map((opcao) => (
                    <SelectItem key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Recorrência">
              <Select value={filtro.recorrencia} onValueChange={(recorrencia) => mudar("recorrencia", recorrencia)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas</SelectItem>
                  {recorrencias.map((opcao) => (
                    <SelectItem key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            {documentos && (
              <Campo label="Nota ou boleto">
                <Select value={filtro.documento} onValueChange={(documento) => mudar("documento", documento)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {documentos.map((opcao) => (
                      <SelectItem key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
            )}
          </div>
        )}
      </div>
      <Card>
        <CardContent className="py-4">
          {carregando && <p className="text-sm text-muted-foreground">Carregando títulos…</p>}
          {!carregando && linhas.length === 0 && <p className="text-sm text-muted-foreground">Nenhum título neste filtro.</p>}
          {linhas.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">{rotuloPessoa}</th>
                    <th className="py-2 pr-3 font-medium">Descrição</th>
                    <th className="py-2 pr-3 font-medium">Valor</th>
                    <th className="py-2 pr-3 font-medium">Vencimento</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((linha) => (
                    <tr key={linha.id} className="border-b">
                      <td className="py-2 pr-3">{linha.pessoa || "—"}</td>
                      <td className="py-2 pr-3">
                        <div>{linha.descricao}</div>
                        {linha.detalhe && <div className="text-xs text-muted-foreground">{linha.detalhe}</div>}
                      </td>
                      <td className="py-2 pr-3">{reais(linha.valor)}</td>
                      <td className="py-2 pr-3">{dataBr(linha.vencimento)}</td>
                      <td className="py-2 pr-3"><Pill valor={linha.status} /></td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          <Button type="button" variant="outline" size="sm" onClick={() => onVer(linha.id)}>Visualizar</Button>
                          {canEdit && <Button type="button" variant="outline" size="sm" onClick={() => onAlterar(linha.id)}>Alterar</Button>}
                          {canEdit && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={!linha.podeExcluir}
                              title={linha.podeExcluir ? "Excluir" : linha.motivoBloqueio}
                              onClick={() => onExcluir(linha.id)}
                            >
                              Excluir
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          Por página
          <Select value={String(tamanho)} onValueChange={(valor) => setTamanho(Number(valor))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TAMANHOS.map((opcao) => (
                <SelectItem key={opcao} value={String(opcao)}>{opcao}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" disabled={atual <= 1} onClick={() => setPagina(atual - 1)}>Anterior</Button>
          <span className="text-sm text-muted-foreground">Página {atual} de {paginas}</span>
          <Button type="button" variant="outline" disabled={atual >= paginas} onClick={() => setPagina(atual + 1)}>Próxima</Button>
        </div>
      </div>
      <div className="grid gap-2 text-sm md:grid-cols-2">
        <p>Total da página: {totais.quantidadePagina} {totais.quantidadePagina === 1 ? "título" : "títulos"} · {reais(totais.valorPagina)}</p>
        <p>Total do filtro: {totais.quantidadeFiltro} {totais.quantidadeFiltro === 1 ? "título" : "títulos"} · {reais(totais.valorFiltro)}</p>
      </div>
    </div>
  );
}
