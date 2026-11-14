import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paginar, passaFiltro, totaisLista, type CriterioLista, type ItemLista } from "../../src/services/erp/lista.ts";

const aberto: CriterioLista = {
  de: "",
  ate: "",
  pessoa: "todos",
  status: "todos",
  valorMin: null,
  valorMax: null,
  centro: "todos",
  recorrencia: "todos",
  documento: "todos",
};

function item(parcial: Partial<ItemLista>): ItemLista {
  return {
    pessoaId: "c1",
    status: "previsto",
    vencimento: "2026-03-10",
    valor: 1000,
    centroId: "cc",
    recorrencia: "avulsa",
    nota: false,
    boleto: false,
    ...parcial,
  };
}

describe("lista de títulos", () => {
  it("sem filtro devolve todos os títulos", () => {
    const itens = [item({}), item({ pessoaId: "c2", valor: 500 })];
    assert.deepEqual(itens.filter((linha) => passaFiltro(linha, aberto)).map((linha) => linha.valor), [1000, 500]);
  });

  it("filtra período, pessoa, status, valor, centro, recorrência e nota ou boleto", () => {
    const linha = item({ nota: true, recorrencia: "parcelado", valor: 2500 });
    assert.equal(passaFiltro(linha, { ...aberto, de: "2026-03-01", ate: "2026-03-31", pessoa: "c1", status: "previsto", valorMin: 2000, valorMax: 3000, centro: "cc", recorrencia: "parcelado", documento: "nota_ou_boleto" }), true);
    assert.equal(passaFiltro(linha, { ...aberto, documento: "com_boleto" }), false);
    assert.equal(passaFiltro(linha, { ...aberto, documento: "sem_nota_boleto" }), false);
    assert.equal(passaFiltro(item({ vencimento: null }), { ...aberto, de: "2026-03-01" }), false);
  });

  it("soma a página de 25 e o filtro inteiro, inclusive as outras páginas", () => {
    const valores = Array.from({ length: 60 }, (_, indice) => (indice + 1) * 100);
    const pagina = paginar(valores, 2, 25);
    assert.equal(pagina.length, 25);
    assert.equal(pagina[0], 2600);
    const totais = totaisLista(pagina, valores);
    assert.equal(totais.quantidadePagina, 25);
    assert.equal(totais.valorPagina, pagina.reduce((soma, valor) => soma + valor, 0));
    assert.equal(totais.quantidadeFiltro, 60);
    assert.equal(totais.valorFiltro, valores.reduce((soma, valor) => soma + valor, 0));
    assert.deepEqual(paginar(valores, 3, 25), valores.slice(50));
  });
});
