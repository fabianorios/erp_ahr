import { useEffect, useRef, useState, type ReactNode } from "react";
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
  centro: string;
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
  const [menu, setMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const chave = JSON.stringify(filtro);

  useEffect(() => {
    setPagina(1);
  }, [chave, tamanho]);

  useEffect(() => {
    if (!menu) return;
    function fechar(evento: MouseEvent) {
      const alvo = evento.target;
      if (!(alvo instanceof Element)) return;
      if (alvo.closest("[data-menu-acao]")) return;
      if (menuRef.current?.contains(alvo)) return;
      setMenu(null);
    }
    function tecla(evento: KeyboardEvent) {
      if (evento.key === "Escape") setMenu(null);
    }
    function recolher() {
      setMenu(null);
    }
    document.addEventListener("mousedown", fechar);
    document.addEventListener("keydown", tecla);
    window.addEventListener("resize", recolher);
    return () => {
      document.removeEventListener("mousedown", fechar);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("resize", recolher);
    };
  }, [menu]);

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
                    <th className="py-2 pr-3 font-medium">Centro de custo</th>
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
                      <td className="py-2 pr-3">{linha.centro}</td>
                      <td className="py-2 pr-3">
                        <div>{linha.descricao}</div>
                        {linha.detalhe && <div className="text-xs text-muted-foreground">{linha.detalhe}</div>}
                      </td>
                      <td className="py-2 pr-3">{reais(linha.valor)}</td>
                      <td className="py-2 pr-3">{dataBr(linha.vencimento)}</td>
                      <td className="py-2 pr-3"><Pill valor={linha.status} /></td>
                      <td className="py-2">
                        <div className="flex items-center gap-1">
                          <BotaoAcao rotulo="Visualizar" onClick={() => onVer(linha.id)}>
                            <IconeOlho />
                          </BotaoAcao>
                          {canEdit && (
                            <BotaoAcao rotulo="Alterar" onClick={() => onAlterar(linha.id)}>
                              <IconeLapis />
                            </BotaoAcao>
                          )}
                          {canEdit && (
                            <BotaoAcao
                              rotulo="Excluir"
                              dica={linha.podeExcluir ? "Excluir" : linha.motivoBloqueio}
                              disabled={!linha.podeExcluir}
                              onClick={() => onExcluir(linha.id)}
                            >
                              <IconeLixeira />
                            </BotaoAcao>
                          )}
                          <button
                            type="button"
                            data-menu-acao=""
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none text-foreground hover:bg-accent"
                            aria-label="Mais ações"
                            aria-haspopup="menu"
                            aria-expanded={menu?.id === linha.id}
                            title="Mais ações"
                            onClick={(evento) => {
                              if (menu?.id === linha.id) {
                                setMenu(null);
                                return;
                              }
                              const rect = evento.currentTarget.getBoundingClientRect();
                              setMenu({ id: linha.id, top: rect.bottom + 4, left: rect.right });
                            }}
                          >
                            …
                          </button>
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
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Mais ações"
          className="fixed z-50 min-w-36 rounded-md border bg-card py-1 text-sm shadow"
          style={{ top: menu.top, left: menu.left, transform: "translateX(-100%)" }}
        >
          <div role="menuitem" className="px-3 py-1.5">Baixar</div>
          <div role="menuitem" className="px-3 py-1.5">Prorrogar</div>
          <div role="menuitem" className="px-3 py-1.5">Bloquear</div>
        </div>
      )}
    </div>
  );
}

function BotaoAcao({ rotulo, dica, disabled, onClick, children }: { rotulo: string; dica?: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  const texto = dica ?? rotulo;
  const botao = (
    <button
      type="button"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
      aria-label={rotulo}
      title={texto}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
  if (!disabled) return botao;
  return <span title={texto} className="inline-flex">{botao}</span>;
}

function IconeOlho() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconeLapis() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function IconeLixeira() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
    </svg>
  );
}
