import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DomainError } from "../../src/services/erp/domain.ts";
import {
  decidirEmissao,
  ehPdf,
  executarEmissao,
  lerFaturaCora,
  pedidoCora,
  urlsCora,
  type TituloParaCora,
} from "../../src/services/erp/cora.ts";
import { caminhoPdf, gravarPdfEm, lerPdfEm } from "../../server/boleto-cora.ts";

const TITULO = "11111111-1111-4111-8111-111111111111";
const HOJE = "2026-11-05";

function titulo(patch: Partial<TituloParaCora> = {}): TituloParaCora {
  return {
    id: TITULO,
    status: "faturado",
    valorCents: 150050,
    vencimento: "2026-11-20",
    descricao: "Consultoria DIRF",
    clienteNome: "Vis Ltda",
    documento: "42976045000146",
    email: "financeiro@vis.com.br",
    endereco: {
      street: "Rua A",
      number: "10",
      district: "Centro",
      city: "São Caetano do Sul",
      state: "sp",
      complement: "sala 1",
      zip: "09510-000",
    },
    boleto: null,
    ...patch,
  };
}

const FATURA = {
  id: "inv_teste",
  status: "OPEN",
  payment_options: {
    bank_slip: {
      barcode: "34191790010104351004791020150008891070026000",
      digitable: "34191.79001 01043.510047 91020.150008 8 91070026000",
      url: "https://storage.googleapis.com/boletos/boleto.pdf",
      our_number: "998877",
    },
  },
  pix: { emv: "000201010212" },
};

describe("pedido do boleto Cora", () => {
  it("manda o id do título, o valor em centavos e o vencimento, sem chamar a rede", () => {
    const pedido = pedidoCora(titulo(), HOJE);
    assert.equal(pedido.code, TITULO);
    assert.equal(pedido.services[0].amount, 150050);
    assert.equal(pedido.payment_terms.due_date, "2026-11-20");
    assert.equal(pedido.customer.document.type, "CNPJ");
    assert.equal(pedido.customer.document.identity, "42976045000146");
    assert.equal(pedido.customer.email, "financeiro@vis.com.br");
    assert.deepEqual(pedido.payment_forms, ["BANK_SLIP", "PIX"]);
    assert.equal(pedido.customer.address?.zip_code, "09510000");
    assert.equal(pedido.customer.address?.state, "SP");
    assert.equal("notification" in pedido, false);
  });

  it("diz qual campo falta", () => {
    assert.throws(
      () => pedidoCora(titulo({ documento: "", valorCents: 0, vencimento: "" }), HOJE),
      (erro: unknown) =>
        erro instanceof DomainError &&
        erro.message.includes("Falta o documento do cliente.") &&
        erro.message.includes("Falta o valor.") &&
        erro.message.includes("Falta o vencimento."),
    );
  });

  it("recusa documento inválido, valor abaixo de R$ 5 e vencimento passado", () => {
    assert.throws(() => pedidoCora(titulo({ documento: "123" }), HOJE), /CPF nem CNPJ/);
    assert.throws(() => pedidoCora(titulo({ valorCents: 499 }), HOJE), /R\$ 5,00/);
    assert.throws(() => pedidoCora(titulo({ vencimento: "2026-11-04" }), HOJE), /anterior a hoje/);
  });

  it("não cria outra fatura quando o título já tem id da Cora", () => {
    const decisao = decidirEmissao(titulo({ boleto: { id: "bol-1", coraId: "inv_pronta" } }), HOJE);
    assert.deepEqual(decisao, { tipo: "mostrar", boletoId: "bol-1" });
  });

  it("só aceita a base de produção", () => {
    assert.equal(urlsCora("https://matls-clients.api.cora.com.br/").invoices, "https://matls-clients.api.cora.com.br/v2/invoices");
    assert.throws(() => urlsCora("https://matls-clients.api.stage.cora.com.br"), /produção/);
  });
});

describe("emissão com transporte falso", () => {
  it("grava a fatura e o PDF sem consultar a Cora de novo quando o boleto já existe", async () => {
    let chamadas = 0;
    const resultado = await executarEmissao({
      titulo: titulo({ boleto: { id: "bol-1", coraId: "inv_pronta" } }),
      hoje: HOJE,
      preparar: async () => {
        chamadas += 1;
      },
      chamar: async () => {
        chamadas += 1;
        return FATURA;
      },
      baixar: async () => {
        chamadas += 1;
        return new Uint8Array();
      },
      gravarPdf: async () => {
        chamadas += 1;
      },
      faturar: async () => {
        chamadas += 1;
      },
      inserir: async () => {
        chamadas += 1;
        return "novo";
      },
    });
    assert.equal(resultado.chamouCora, false);
    assert.equal(resultado.id, "bol-1");
    assert.equal(chamadas, 0);
  });

  it("fatura o título previsto, baixa o PDF uma vez e grava linha, barras, PIX e id", async () => {
    const passos: string[] = [];
    let baixado = "";
    const resultado = await executarEmissao({
      titulo: titulo({ status: "previsto" }),
      hoje: HOJE,
      preparar: async () => {
        passos.push("preparar");
      },
      faturar: async () => {
        passos.push("faturar");
      },
      chamar: async (pedido, chave) => {
        passos.push("chamar");
        assert.equal(chave, TITULO);
        assert.equal(pedido.code, TITULO);
        assert.equal(pedido.services[0].amount, 150050);
        return FATURA;
      },
      baixar: async (url) => {
        passos.push("baixar");
        baixado = url;
        return new TextEncoder().encode("%PDF-1.4");
      },
      gravarPdf: async (pdf) => {
        passos.push("gravar");
        assert.equal(ehPdf(pdf), true);
      },
      inserir: async (boleto) => {
        passos.push("inserir");
        assert.equal(boleto.coraId, "inv_teste");
        assert.equal(boleto.linha, FATURA.payment_options.bank_slip.digitable);
        assert.equal(boleto.codigoBarras, FATURA.payment_options.bank_slip.barcode);
        assert.equal(boleto.pix, "000201010212");
        assert.equal(boleto.pdfPath, `${TITULO}.pdf`);
        assert.equal(boleto.status, "aberto");
        return "bol-novo";
      },
    });
    assert.deepEqual(passos, ["preparar", "faturar", "chamar", "baixar", "gravar", "inserir"]);
    assert.equal(baixado, FATURA.payment_options.bank_slip.url);
    assert.equal(resultado.chamouCora, true);
    assert.equal(resultado.id, "bol-novo");
  });

  it("não fatura de novo um título que já está faturado", async () => {
    let faturou = false;
    await executarEmissao({
      titulo: titulo({ status: "faturado" }),
      hoje: HOJE,
      preparar: async () => {},
      faturar: async () => {
        faturou = true;
      },
      chamar: async () => FATURA,
      baixar: async () => new TextEncoder().encode("%PDF-1.4"),
      gravarPdf: async () => {},
      inserir: async () => "bol-novo",
    });
    assert.equal(faturou, false);
  });

  it("não chama a Cora se a preparação falha", async () => {
    let chamou = false;
    await assert.rejects(
      () =>
        executarEmissao({
          titulo: titulo(),
          hoje: HOJE,
          preparar: async () => {
            throw new DomainError("A Cora não está configurada no servidor.");
          },
          chamar: async () => {
            chamou = true;
            return FATURA;
          },
          baixar: async () => new Uint8Array(),
          gravarPdf: async () => {},
          faturar: async () => {
            throw new Error("não devia faturar");
          },
          inserir: async () => "x",
        }),
      /não está configurada/,
    );
    assert.equal(chamou, false);
  });
});

describe("PDF salvo", () => {
  it("grava o arquivo no servidor e a leitura seguinte não recebe URL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "boleto-cora-"));
    try {
      const pdf = new TextEncoder().encode("%PDF-1.4\nlocal");
      await gravarPdfEm(dir, TITULO, pdf);
      const caminho = caminhoPdf(dir, TITULO);
      assert.equal((await stat(caminho)).mode & 0o777, 0o600);
      assert.equal((await stat(dir)).mode & 0o777, 0o700);
      const lido = await lerPdfEm(dir, TITULO);
      assert.equal(Buffer.compare(lido, Buffer.from(pdf)), 0);
      assert.equal(await readFile(caminho, "utf8"), "%PDF-1.4\nlocal");
      await chmod(caminho, 0o644);
      await chmod(caminho, 0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejeita PDF que não veio da emissão e URL local", () => {
    assert.throws(() => lerFaturaCora({ ...FATURA, payment_options: { bank_slip: { ...FATURA.payment_options.bank_slip, url: "http://127.0.0.1/boleto.pdf" } } }), /PDF/);
    assert.equal(ehPdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), true);
    assert.equal(ehPdf(new TextEncoder().encode("nao")), false);
  });
});
