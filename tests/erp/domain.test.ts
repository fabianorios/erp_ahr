import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DomainError,
  MUNICIPIO_NFSE,
  assertPropostaEditavel,
  baixaManual,
  cancelarContrato,
  cancelarDespesa,
  competenciaDoVencimento,
  contratoDaProposta,
  comporMargem,
  despesaFinanceiraDoPeriodo,
  editarTituloPrevisto,
  fecharRateio,
  faturarTitulo,
  filtrarPeriodo,
  formatBrl,
  mascaraCnpj,
  mascaraCpf,
  mascaraDinheiro,
  mascaraDocumento,
  aplicarCamposVazios,
  validarPreenchimentoGrupo,
  FORMA_COBRANCA,
  margemDoCentro,
  montarAgenda,
  normalizarCliente,
  montarFluxo,
  novaVersao,
  montarTitulosAvulsos,
  novoTitulo,
  parcelasPrevistas,
  validarTituloAvulso,
  pagarBoleto,
  pagarDespesa,
  podeCancelarTitulo,
  htmlAdicionais,
  normalizarValidade,
  validarAdicionais,
  proximoNumero,
  validadeNoDocumento,
  validadeNoFormulario,
  validarProposta,
  reaisToCents,
  receitaJurosDoPeriodo,
  registrarBoleto,
  registrarNfse,
  somarFluxo,
  totaisDoMes,
  transicionarProposta,
  validarDespesa,
  validarDocumento,
  valorRateado,
} from "../../src/services/erp/domain.ts";

describe("dinheiro e documento", () => {
  it("guarda reais com duas casas", () => {
    assert.equal(reaisToCents("1.234,56"), 123456);
    assert.equal(reaisToCents("10,5"), 1050);
    assert.equal(formatBrl(-1050), "-R$ 10,50");
    assert.throws(() => reaisToCents("10,555"), DomainError);
  });

  it("aceita CPF ou CNPJ só com dígitos e normaliza o cliente", () => {
    assert.equal(validarDocumento("123.456.789-09"), "12345678909");
    assert.equal(validarDocumento("04.252.011/0001-10"), "04252011000110");
    assert.throws(() => validarDocumento("123"), DomainError);
    const cliente = normalizarCliente({ nome: " AHR ", documento: "04.252.011/0001-10", uf: "sp", cep: "09510-000" });
    assert.equal(cliente.name, "AHR");
    assert.equal(cliente.document, "04252011000110");
    assert.equal(cliente.uf, "SP");
    assert.equal(cliente.cep, "09510000");
    assert.equal(mascaraCpf("12345678901"), "123.456.789-01");
    assert.equal(mascaraCnpj("04252011000110"), "04.252.011/0001-10");
    assert.equal(mascaraDocumento("12345678901"), "123.456.789-01");
    assert.equal(mascaraDocumento("04252011000110"), "04.252.011/0001-10");
    assert.equal(mascaraDinheiro("123456"), "R$ 1.234,56");
    assert.equal(reaisToCents("R$ 1.234,56"), 123456);
  });

  it("preenche só o campo vazio em mais de um título previsto", () => {
    const centro = "11111111-1111-4111-8111-111111111111";
    const preenchimento = validarPreenchimentoGrupo({
      centroId: centro,
      forma: "pix",
      banco: "",
      numeroNf: "",
      tipoVencimento: "",
      prazoDias: "",
      competencia: "",
    });
    const base = {
      status: "previsto",
      temNfse: false,
      temBoleto: false,
      centroId: null as string | null,
      forma: null as string | null,
      banco: null as string | null,
      numeroNf: null,
      tipoVencimento: "data_fixa",
      competencia: "2026-11-01",
    };
    const primeiro = aplicarCamposVazios(base, preenchimento);
    const segundo = aplicarCamposVazios({ ...base, forma: "boleto" }, preenchimento);
    const faturado = aplicarCamposVazios({ ...base, status: "faturado" }, preenchimento);
    const comNota = aplicarCamposVazios({ ...base, temNfse: true }, preenchimento);
    assert.deepEqual(primeiro, { centro_custo_id: centro, forma_recebimento: "pix" });
    assert.deepEqual(segundo, { centro_custo_id: centro });
    assert.equal(faturado, "ignorar");
    assert.equal(comNota, "ignorar");
    assert.equal(aplicarCamposVazios({ ...base, centroId: centro, forma: "pix" }, preenchimento), "vazio");
  });
});

describe("forma de pagamento da proposta", () => {
  it("divide o total e mantém a cobrança mista", () => {
    const porData = montarAgenda({
      valor: "100,00",
      quantidade: "3",
      modoParcelas: "datas",
      intervaloDias: "",
      primeiroVencimento: "",
      vencimentos: ["2026-03-10", "2026-04-10", "2026-05-10"],
    });
    assert.deepEqual(porData.parcelas.map((parcela) => parcela.valor), [3333, 3333, 3334]);
    assert.equal(porData.parcelas.reduce((total, parcela) => total + parcela.valor, 0), 10000);
    const porIntervalo = montarAgenda({
      valor: "90,00",
      quantidade: "3",
      modoParcelas: "intervalo",
      intervaloDias: "30",
      primeiroVencimento: "2026-01-10",
      vencimentos: [],
    });
    assert.deepEqual(porIntervalo.parcelas.map((parcela) => parcela.vencimento), ["2026-01-10", "2026-02-09", "2026-03-11"]);
    assert.equal(porIntervalo.parcelas.reduce((total, parcela) => total + parcela.valor, 0), 9000);
    assert.equal(FORMA_COBRANCA, "mista");
    assert.throws(() => montarAgenda({ valor: "10,00", quantidade: "2", modoParcelas: "datas", intervaloDias: "", primeiroVencimento: "", vencimentos: ["2026-03-10"] }), /cada parcela/);
  });
});

describe("despesa e conta a pagar", () => {
  it("separa operacional e financeira pelo centro", () => {
    const operacional = validarDespesa({
      tipo: "operacional",
      categoria: "Deslocamento",
      descricao: "Visita",
      favorecidoNome: "Taxi",
      favorecidoDocumento: "",
      valor: "200,00",
      competencia: "2026-03",
      vencimento: "2026-03-12",
      tipoCentro: "contrato",
    });
    assert.equal(operacional.competencia, "2026-03-01");
    assert.throws(
      () =>
        validarDespesa({
          ...{
            tipo: "financeira" as const,
            categoria: "juros",
            descricao: "Juros",
            favorecidoNome: "Banco",
            favorecidoDocumento: "",
            valor: "15,00",
            competencia: "2026-03",
            vencimento: "2026-03-05",
            tipoCentro: "contrato" as const,
          },
        }),
      /centro financeiro/,
    );
    assert.throws(() => pagarDespesa("paga", "2026-03-05"), /conta a pagar/);
    assert.doesNotThrow(() => cancelarDespesa("a_pagar"));
    assert.throws(() => cancelarDespesa("paga"), DomainError);
  });
});

describe("pessoal", () => {
  it("só fecha o rateio em 100 e calcula o custo do centro", () => {
    const fechado = fecharRateio(
      [
        { centroId: "c1", tipoCentro: "contrato", percentual: "70" },
        { centroId: "adm", tipoCentro: "indireto", percentual: "30,00" },
      ],
      100000,
    );
    assert.deepEqual(
      fechado.map((linha) => linha.valor),
      [70000, 30000],
    );
    assert.equal(valorRateado(1000, 3333), 333);
    assert.throws(
      () =>
        fecharRateio(
          [
            { centroId: "c1", tipoCentro: "contrato", percentual: "33,33" },
            { centroId: "adm", tipoCentro: "indireto", percentual: "33,33" },
            { centroId: "com", tipoCentro: "indireto", percentual: "33,33" },
          ],
          100000,
        ),
      /soma dos percentuais é 100/,
    );
    assert.throws(
      () => fecharRateio([{ centroId: "fin", tipoCentro: "financeiro", percentual: "100" }], 1000),
      /contrato ou indireto/,
    );
  });
});

describe("proposta, contrato e título", () => {
  it("guarda título, visão geral e validade como data ou texto curto", () => {
    assert.equal(normalizarValidade("31/12/2026"), "2026-12-31");
    assert.equal(validadeNoFormulario("2026-12-31"), "31/12/2026");
    assert.equal(validadeNoDocumento("2026-12-31"), "31 de dezembro de 2026");
    assert.equal(normalizarValidade("30 dias"), "30 dias");
    assert.equal(validadeNoDocumento("30 dias"), "30 dias");
    assert.throws(() => normalizarValidade("31/13/2026"), /Validade/);
    assert.throws(
      () =>
        validarProposta({
          clienteId: "cli",
          titulo: "  ",
          visaoGeral: "",
          escopo: "",
          responsabilidades: "",
          prazo: "",
          execucao: "",
          validade: "",
          formaPagamento: "",
          valor: "100,00",
          inicio: "",
          fim: "",
          quantidade: "1",
          modoParcelas: "datas",
          intervaloDias: "",
          primeiroVencimento: "",
          vencimentos: ["2026-12-31"],
        }),
      /título da proposta/,
    );
  });

  it("leva ao PDF só transporte e refeição cobrados", () => {
    const itens = validarAdicionais({
      transporte: { cobrado: true, regra: "reembolso", valor: "", meio: "reembolso", descricao: "" },
      refeicao: { cobrado: true, regra: "valor_fixo", valor: "80,00", meio: "pix", descricao: "" },
      outras: [{ cobrado: false, regra: "valor_fixo", valor: "999,00", meio: "boleto", descricao: "Hotel" }],
    });
    const html = htmlAdicionais(itens);
    assert.match(html, /Transporte/);
    assert.match(html, /Reembolso mediante comprovante/);
    assert.match(html, /Refeição/);
    assert.match(html, /R\$ 80,00/);
    assert.match(html, /PIX/);
    assert.doesNotMatch(html, /Hotel/);
    assert.doesNotMatch(html, /999/);
    assert.equal(htmlAdicionais(validarAdicionais(null)), "");
  });

  it("aceite gera um contrato e a correção vira versão nova", () => {
    assert.equal(transicionarProposta("rascunho", "enviar"), "enviada");
    assert.equal(transicionarProposta("enviada", "aceitar"), "aceita");
    assert.throws(() => transicionarProposta("rascunho", "aceitar"), DomainError);
    assert.throws(() => assertPropostaEditavel("enviada"), /versão nova/);
    assert.deepEqual(novaVersao("aceita", 1, false), { versao: 2, status: "rascunho" });
    const contrato = contratoDaProposta({
      status: "aceita",
      clienteId: "cli",
      valor: 500000,
      formaCobranca: "mista",
      jaTemContrato: false,
    });
    assert.equal(contrato.formaCobranca, "mista");
    assert.equal(contrato.valorContratado, 500000);
    assert.throws(
      () => contratoDaProposta({ status: "aceita", clienteId: "cli", valor: 1, formaCobranca: "mista", jaTemContrato: true }),
      /no máximo um contrato/,
    );
  });

  it("abre o título na mão e trava o valor ao faturar", () => {
    const previstas = parcelasPrevistas({
      modo: "datas",
      quantidade: 4,
      intervaloDias: null,
      primeiroVencimento: null,
      parcelas: [
        { vencimento: "2026-11-23", valor: 250000 },
        { vencimento: "2026-12-23", valor: 0 },
        { vencimento: "", valor: 250000 },
        { vencimento: "2027-01-22", valor: 250000 },
      ],
    });
    assert.deepEqual(previstas.map((parcela) => parcela.parcela), [1, 4]);
    assert.equal(previstas[0].descricao, "Parcela 1/4");
    assert.equal(previstas[0].competencia, "2026-11-01");
    assert.equal(previstas[1].vencimento, "2027-01-22");
    const avulso = validarTituloAvulso({ descricao: "Sinal", valor: "2.500,00", vencimento: "2026-11-23", competencia: "", origem: "Word" });
    assert.equal(avulso.status, "previsto");
    assert.equal(avulso.origem, "Word");
    assert.equal(validarTituloAvulso({ descricao: "Sinal", valor: "100", vencimento: "2026-11-23", competencia: "", origem: "planilha antiga" }).origem, "planilha antiga");
    assert.throws(() => validarTituloAvulso({ descricao: "Sinal", valor: "100", vencimento: "2026-11-23", competencia: "", origem: " " }), /onde veio/);
    const base = {
      descricao: "Sinal",
      valor: "2.500,00",
      origem: "Word",
      clienteId: "cliente-1",
      forma: "pix",
      numeroNf: "",
      banco: "Cora",
      centroId: "11111111-1111-4111-8111-111111111111",
    };
    const porData = montarTitulosAvulsos({
      ...base,
      tipoVencimento: "data_fixa",
      prazoDias: "",
      quantidade: "2",
      vencimentos: ["2026-11-23", "2026-12-23"],
      primeiroVencimento: "",
    });
    assert.deepEqual(porData.map((titulo) => [titulo.parcela, titulo.quantidade, titulo.vencimento, titulo.clienteId, titulo.forma, titulo.banco]), [
      [1, 2, "2026-11-23", "cliente-1", "pix", "Cora"],
      [2, 2, "2026-12-23", "cliente-1", "pix", "Cora"],
    ]);
    assert.equal(porData[0].numeroNf, null);
    assert.equal(porData[0].centroId, "11111111-1111-4111-8111-111111111111");
    assert.equal(porData[1].centroId, porData[0].centroId);
    const porPrazo = montarTitulosAvulsos({
      ...base,
      tipoVencimento: "prazo_dias",
      prazoDias: "30",
      quantidade: "3",
      vencimentos: [],
      primeiroVencimento: "2026-11-23",
      numeroNf: "123",
    });
    assert.deepEqual(porPrazo.map((titulo) => titulo.vencimento), ["2026-11-23", "2026-12-23", "2027-01-22"]);
    assert.equal(porPrazo[2].prazoDias, 30);
    assert.equal(porPrazo[2].descricao, "Sinal · Parcela 3/3");
    assert.throws(() => montarTitulosAvulsos({ ...base, tipoVencimento: "data_fixa", prazoDias: "", quantidade: "1", vencimentos: ["2026-11-23"], primeiroVencimento: "", clienteId: " " }), /cliente/);
    assert.throws(() => montarTitulosAvulsos({ ...base, tipoVencimento: "data_fixa", prazoDias: "", quantidade: "1", vencimentos: ["2026-11-23"], primeiroVencimento: "", banco: " " }), /banco/);
    assert.throws(() => montarTitulosAvulsos({ ...base, tipoVencimento: "data_fixa", prazoDias: "", quantidade: "1", vencimentos: ["2026-11-23"], primeiroVencimento: "", centroId: " " }), /centro de custo/);
    assert.throws(() => novoTitulo({ contratoStatus: "rascunho", descricao: "Parcela", valor: "100", vencimento: "2026-03-10", competencia: "" }), /vigente/);
    const titulo = novoTitulo({
      contratoStatus: "vigente",
      descricao: "Parcela 1",
      valor: "1.000,00",
      vencimento: "2026-03-10",
      competencia: "",
    });
    assert.equal(titulo.competencia, competenciaDoVencimento("2026-03-10"));
    assert.equal(titulo.status, "previsto");
    faturarTitulo("previsto");
    assert.throws(() => editarTituloPrevisto("faturado", { descricao: "x", valor: "10", vencimento: "2026-03-10", competencia: "2026-03" }), /previsto/);
  });
});

describe("NFS-e e boleto à mão", () => {
  it("grava a nota de São Caetano sem chamada externa e baixa pelo boleto", () => {
    assert.throws(() => registrarNfse({ tituloStatus: "previsto", jaInformada: false, numero: "1", valor: "10", vencimento: "2026-03-10", dataEmissao: "2026-03-01" }), /faturada/);
    const nota = registrarNfse({
      tituloStatus: "faturado",
      jaInformada: false,
      numero: "123",
      valor: "1000,00",
      vencimento: "2026-03-15",
      dataEmissao: "2026-03-02",
    });
    assert.equal(nota.municipio, MUNICIPIO_NFSE);
    assert.equal(nota.emissor, "manual");
    const boleto = registrarBoleto({
      tituloStatus: "faturado",
      jaTem: false,
      numero: "9988",
      valor: "1000,00",
      vencimento: "2026-03-15",
      status: "aberto",
      meio: "pix",
      linhaDigitavel: "",
    });
    assert.equal(boleto.numero, "9988");
    const baixa = pagarBoleto({ tituloStatus: "faturado", boletoStatus: "aberto", valor: "1.050,00", data: "2026-03-20", meio: "pix" });
    assert.equal(baixa.valorRecebido, 105000);
    assert.throws(() => baixaManual({ tituloStatus: "faturado", boleto: "aberto", valor: "1000", data: "2026-03-20", meio: "manual" }), /boleto pago/);
    assert.throws(() => podeCancelarTitulo({ id: "t", status: "faturado", nfse: "informada", boleto: "cancelado" }), /NFS-e/);
  });
});

describe("fase 1 pronta quando", () => {
  it("mostra despesa no centro, pessoal rateado, título, baixa, fluxo e margem", () => {
    const centroContrato = "c1";
    const adm = "adm";
    const fin = "fin";
    const operacional = validarDespesa({
      tipo: "operacional",
      categoria: "Deslocamento",
      descricao: "Visita ao cliente",
      favorecidoNome: "Taxi",
      favorecidoDocumento: "",
      valor: "200,00",
      competencia: "2026-03",
      vencimento: "2026-03-12",
      tipoCentro: "contrato",
    });
    const financeira = validarDespesa({
      tipo: "financeira",
      categoria: "juros",
      descricao: "Juros do limite",
      favorecidoNome: "Banco",
      favorecidoDocumento: "",
      valor: "15,00",
      competencia: "2026-03",
      vencimento: "2026-03-05",
      tipoCentro: "financeiro",
    });
    const cancelada = validarDespesa({
      tipo: "operacional",
      categoria: "Material",
      descricao: "Cancelada",
      favorecidoNome: "Papelaria",
      favorecidoDocumento: "",
      valor: "40,00",
      competencia: "2026-03",
      vencimento: "2026-03-08",
      tipoCentro: "indireto",
    });
    const pessoal = fecharRateio(
      [
        { centroId: centroContrato, tipoCentro: "contrato", percentual: "70" },
        { centroId: adm, tipoCentro: "indireto", percentual: "30" },
      ],
      100000,
    );
    const titulos = [
      { centroId: centroContrato, competencia: "2026-03-01", status: "faturado" as const, valor: 500000, valorRecebido: null, descricao: "Parcela prevista faturada", vencimento: "2026-03-15", dataRecebimento: null },
      { centroId: centroContrato, competencia: "2026-03-01", status: "previsto" as const, valor: 100000, valorRecebido: null, descricao: "Ainda não faturada", vencimento: "2026-03-10", dataRecebimento: null },
      { centroId: centroContrato, competencia: "2026-03-01", status: "recebido" as const, valor: 80000, valorRecebido: 85000, descricao: "Já recebida", vencimento: "2026-03-01", dataRecebimento: "2026-03-20" },
      { centroId: centroContrato, competencia: "2026-03-01", status: "cancelado" as const, valor: 999, valorRecebido: null, descricao: "Cancelada", vencimento: "2026-03-01", dataRecebimento: null },
    ];
    const despesas = [
      { centroId: centroContrato, centroNome: "Contrato", tipo: operacional.tipo, valor: operacional.valor, competencia: operacional.competencia, cancelada: false },
      { centroId: fin, centroNome: "Financeiro", tipo: financeira.tipo, valor: financeira.valor, competencia: financeira.competencia, cancelada: false },
      { centroId: adm, centroNome: "Administrativo", tipo: cancelada.tipo, valor: cancelada.valor, competencia: cancelada.competencia, cancelada: true },
    ];
    const margem = margemDoCentro({
      centroId: centroContrato,
      inicio: "2026-03-01",
      fim: "2026-03-31",
      titulos,
      pessoal: pessoal.map((linha) => ({ centroId: linha.centroId, competencia: "2026-03-01", valor: linha.valor })),
      despesas,
    });
    assert.deepEqual(margem, { receita: 680000, pessoal: 70000, operacional: 20000, margem: 590000 });
    const overhead = margemDoCentro({
      centroId: adm,
      inicio: "2026-03-01",
      fim: "2026-03-31",
      titulos,
      pessoal: pessoal.map((linha) => ({ centroId: linha.centroId, competencia: "2026-03-01", valor: linha.valor })),
      despesas,
    });
    assert.equal(overhead.receita, 0);
    assert.equal(overhead.pessoal, 30000);
    assert.equal(overhead.operacional, 0);
    assert.equal(despesaFinanceiraDoPeriodo(despesas, "2026-03-01", "2026-03-31"), 1500);
    assert.equal(receitaJurosDoPeriodo(titulos, "2026-03-01", "2026-03-31"), 5000);

    const baixa = pagarBoleto({ tituloStatus: "faturado", boletoStatus: "atrasado", valor: "5.000,00", data: "2026-03-21", meio: "boleto" });
    const movimentos = montarFluxo({
      titulos: [
        { ...titulos[1], valorRecebido: null, dataRecebimento: null },
        { ...titulos[0], status: "recebido", valorRecebido: baixa.valorRecebido, dataRecebimento: baixa.data },
      ],
      contas: [
        { descricao: operacional.descricao, status: "a_pagar", valor: operacional.valor, vencimento: operacional.vencimento, dataPagamento: null },
        { descricao: financeira.descricao, status: "paga", valor: financeira.valor, vencimento: financeira.vencimento, dataPagamento: "2026-03-05" },
        { descricao: cancelada.descricao, status: "cancelada", valor: cancelada.valor, vencimento: cancelada.vencimento, dataPagamento: null },
      ],
    });
    const noMes = filtrarPeriodo(movimentos, "2026-03-01", "2026-03-31");
    assert.deepEqual(somarFluxo(noMes), {
      previstoEntradas: 100000,
      previstoSaidas: 20000,
      realizadoEntradas: 500000,
      realizadoSaidas: 1500,
    });
    const totais = totaisDoMes(despesas, "2026-03");
    assert.equal(totais.find((linha) => linha.centroId === centroContrato && linha.tipo === "operacional")?.total, 20000);
    assert.equal(totais.find((linha) => linha.centroId === fin && linha.tipo === "financeira")?.total, 1500);
    assert.equal(proximoNumero(["P-0001", "P-0007"]), "P-0008");
    assert.deepEqual(cancelarContrato("vigente", [{ id: "a", status: "previsto", nfse: "ausente", boleto: "ausente" }]), ["a"]);
  });
});

describe("margem no período", () => {
  it("conta previsto, faturado e recebido uma vez e deixa o cancelado de fora", () => {
    const painel = comporMargem({
      inicio: "2026-03-01",
      fim: "2026-03-31",
      contratos: [
        { id: "ct1", centroId: "cc" },
        { id: "ct2", centroId: "cc" },
      ],
      centrosIndiretos: ["adm"],
      titulos: [
        { id: "no-centro", centroId: "cc", contratoId: null, status: "previsto", valor: 100000, valorRecebido: null, vencimento: "2026-03-10", dataRecebimento: null },
        { id: "pelo-contrato", centroId: null, contratoId: "ct1", status: "faturado", valor: 50000, valorRecebido: null, vencimento: "2026-03-12", dataRecebimento: null },
        { id: "recebido-dentro", centroId: "cc", contratoId: null, status: "recebido", valor: 80000, valorRecebido: 85000, vencimento: "2026-02-01", dataRecebimento: "2026-03-20" },
        { id: "recebido-fora", centroId: "cc", contratoId: null, status: "recebido", valor: 70000, valorRecebido: 70000, vencimento: "2026-03-15", dataRecebimento: "2026-04-02" },
        { id: "previsto-fora", centroId: "cc", contratoId: null, status: "previsto", valor: 60000, valorRecebido: null, vencimento: "2026-04-01", dataRecebimento: null },
        { id: "cancelado", centroId: "cc", contratoId: null, status: "cancelado", valor: 999, valorRecebido: null, vencimento: "2026-03-01", dataRecebimento: null },
        { id: "outro-contrato", centroId: "cc", contratoId: "ct2", status: "faturado", valor: 10000, valorRecebido: null, vencimento: "2026-03-18", dataRecebimento: null },
        { id: "sem-centro", centroId: null, contratoId: null, status: "previsto", valor: 25000, valorRecebido: null, vencimento: "2026-03-22", dataRecebimento: null },
        { id: "indireto", centroId: "adm", contratoId: null, status: "previsto", valor: 5000, valorRecebido: null, vencimento: "2026-03-08", dataRecebimento: null },
      ],
      pessoal: [{ centroId: "cc", competencia: "2026-03-01", valor: 70000 }],
      despesas: [],
    });
    const ct1 = painel.contratos.find((linha) => linha.id === "ct1");
    const ct2 = painel.contratos.find((linha) => linha.id === "ct2");
    assert.equal(ct1?.receita, 230000);
    assert.equal(ct1?.pessoal, 70000);
    assert.equal(ct2?.receita, 10000);
    assert.equal(ct2?.pessoal, 70000);
    assert.equal(painel.avulsos.find((linha) => linha.centroId === null)?.receita, 25000);
    assert.equal(painel.overhead.find((linha) => linha.centroId === "adm")?.receita, 5000);
    assert.equal(painel.receitaJuros, 5000);
    const receita = (ct1?.receita ?? 0) + (ct2?.receita ?? 0) + painel.avulsos.reduce((acc, linha) => acc + linha.receita, 0) + painel.overhead.reduce((acc, linha) => acc + linha.receita, 0);
    assert.equal(receita, 270000);
  });
});
