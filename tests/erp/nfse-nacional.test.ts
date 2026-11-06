import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, it } from "node:test";
import { DomainError } from "../../src/services/erp/domain.ts";
import {
  idDps,
  instanteBrasil,
  lerNotaAutorizada,
  montarDps,
  tituloDaNota,
  validarBaseSefin,
  type PedidoNfse,
} from "../../src/services/erp/nfse-nacional.ts";
import { aplicarNota, assinarDps, incorporarXml } from "../../server/nfse-nacional.ts";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const CENTRO = "22222222-2222-4222-8222-222222222222";
const CHAVE = "35488072250516724000160000000000002126046985535602";

function pedido(parcial: Partial<PedidoNfse> = {}): PedidoNfse {
  return {
    clienteId: CLIENTE,
    descricao: "Consultoria mensal",
    valor: "169,00",
    vencimento: "2026-11-20",
    centroId: CENTRO,
    forma: "boleto",
    banco: "Cora",
    documento: "19678493000141",
    nome: "Cliente da Silva",
    email: "financeiro@cliente.example",
    logradouro: "Rua das Flores",
    numero: "100",
    bairro: "Centro",
    cidade: "São Caetano do Sul",
    uf: "SP",
    cep: "09510-000",
    complemento: "",
    cMunTomador: "3548807",
    cnpjPrestador: "50516724000160",
    inscricaoMunicipal: "",
    codigoServico: "010501",
    serie: "1",
    numeroDps: "100000000000001",
    emitidoEm: "2026-11-06T08:00:00-03:00",
    ambiente: 1,
    ...parcial,
  };
}

function xmlNota(): string {
  return "<NFSe><nNFSe>321</nNFSe><dhProc>2026-11-06T08:00:01-03:00</dhProc><vServ>169.00</vServ><xDescServ>Consultoria mensal</xDescServ></NFSe>";
}

describe("emissão no Emissor Nacional", () => {
  it("monta o id da DPS como o Emissor Nacional e não chama a rede", () => {
    assert.equal(idDps("3106200", "50516724000160", "1", "100000000000001"), "DPS310620025051672400016000001100000000000001");
    assert.match(idDps("3106200", "50516724000160", "1", "100000000000001"), /^DPS\d{42}$/);
    assert.equal(validarBaseSefin("https://sefin.nfse.gov.br/SefinNacional"), "https://sefin.nfse.gov.br/SefinNacional");
    assert.throws(() => validarBaseSefin("https://exemplo.invalid/SefinNacional"), DomainError);
    const xml = montarDps(pedido());
    assert.match(xml, /Consultoria mensal/);
    assert.match(xml, /19678493000141/);
    assert.match(xml, /<vServ>169\.00<\/vServ>/);
    assert.equal(instanteBrasil(new Date("2026-11-06T11:00:00Z")).startsWith("2026-11-06T08:00:00"), true);
  });

  it("rejeição não cria título; nota autorizada nasce com cliente, valor, número e descrição", async () => {
    const chamadas: string[] = [];
    const gravar = {
      async inserir(row: Record<string, unknown>) {
        chamadas.push(`inserir:${row.cliente_id}:${row.numero_nf}:${row.descricao}:${row.valor}:${row.status}`);
        return "33333333-3333-4333-8333-333333333333";
      },
      async faturar() {
        chamadas.push("faturar");
      },
      async inserirNfse(row: Record<string, unknown>) {
        chamadas.push(`nfse:${row.numero}:${row.emissor}:${row.id_externo}`);
      },
    };
    await assert.rejects(
      () => aplicarNota(gravar, pedido(), 400, JSON.stringify({ erros: [{ Codigo: "E001", Descricao: "DPS inválida" }] })),
      /recusou a nota/,
    );
    assert.deepEqual(chamadas, []);

    const corpo = JSON.stringify({
      chaveAcesso: CHAVE,
      nfseXmlGZipB64: gzipSync(Buffer.from(xmlNota())).toString("base64"),
    });
    assert.match(incorporarXml(corpo), /nNFSe/);
    const id = await aplicarNota(gravar, pedido(), 201, corpo);
    assert.equal(id, "33333333-3333-4333-8333-333333333333");
    assert.deepEqual(chamadas, [
      `inserir:${CLIENTE}:321:Consultoria mensal:169.00:previsto`,
      "faturar",
      `nfse:321:nacional:${CHAVE}`,
    ]);
    const nota = lerNotaAutorizada(201, incorporarXml(corpo), "Consultoria mensal", "169.00");
    const titulo = tituloDaNota(pedido(), nota);
    assert.equal(titulo.origem, "Emissor Nacional");
    assert.equal(titulo.numeroNf, "321");
    assert.equal(titulo.valorCents, 16900);
  });

  it("assina a DPS sem enviar", () => {
    const par = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const chave = par.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const certificado = par.publicKey.export({ type: "spki", format: "pem" }).toString();
    const assinado = assinarDps(montarDps(pedido()), chave, certificado);
    assert.match(assinado, /<Signature/);
    assert.match(assinado, /Consultoria mensal/);
  });
});
