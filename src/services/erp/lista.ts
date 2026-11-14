export type CriterioLista = {
  de: string;
  ate: string;
  pessoa: string;
  status: string;
  valorMin: number | null;
  valorMax: number | null;
  centro: string;
  recorrencia: string;
  documento: string;
};

export type ItemLista = {
  pessoaId: string;
  status: string;
  vencimento: string | null;
  valor: number;
  centroId: string;
  recorrencia: string;
  nota: boolean;
  boleto: boolean;
};

export function passaFiltro(item: ItemLista, criterio: CriterioLista): boolean {
  if (criterio.pessoa !== "todos" && item.pessoaId !== criterio.pessoa) return false;
  if (criterio.status !== "todos" && item.status !== criterio.status) return false;
  if (criterio.de && (!item.vencimento || item.vencimento < criterio.de)) return false;
  if (criterio.ate && (!item.vencimento || item.vencimento > criterio.ate)) return false;
  if (criterio.valorMin != null && item.valor < criterio.valorMin) return false;
  if (criterio.valorMax != null && item.valor > criterio.valorMax) return false;
  if (criterio.centro !== "todos" && item.centroId !== criterio.centro) return false;
  if (criterio.recorrencia !== "todos" && item.recorrencia !== criterio.recorrencia) return false;
  if (criterio.documento === "com_nota" && !item.nota) return false;
  if (criterio.documento === "com_boleto" && !item.boleto) return false;
  if (criterio.documento === "nota_ou_boleto" && !item.nota && !item.boleto) return false;
  if (criterio.documento === "sem_nota_boleto" && (item.nota || item.boleto)) return false;
  return true;
}

export function paginar<T>(itens: T[], pagina: number, tamanho: number): T[] {
  const inicio = (Math.max(1, pagina) - 1) * tamanho;
  return itens.slice(inicio, inicio + tamanho);
}

export function totaisLista(valoresPagina: number[], valoresFiltro: number[]): {
  quantidadePagina: number;
  valorPagina: number;
  quantidadeFiltro: number;
  valorFiltro: number;
} {
  return {
    quantidadePagina: valoresPagina.length,
    valorPagina: valoresPagina.reduce((soma, valor) => soma + valor, 0),
    quantidadeFiltro: valoresFiltro.length,
    valorFiltro: valoresFiltro.reduce((soma, valor) => soma + valor, 0),
  };
}
