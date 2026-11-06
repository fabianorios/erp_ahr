import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DomainError } from "../../src/services/erp/domain.ts";
import { lerDanfseXml, pdfDaNota, pdfDanfseSimplificado, urlConsultaNfse } from "../../server/danfse-pdf.ts";

const CHAVE = "7".repeat(50);
const CHAVE_MODELO = "35488072242976045000146000000000000426110067290523";

function xmlNota(): string {
  return `<NFSe><infNFSe Id="NFS${CHAVE}">` +
    `<xLocEmi>Campinas</xLocEmi><nNFSe>88</nNFSe><ambGer>2</ambGer><cStat>100</cStat>` +
    `<dhProc>2026-03-02T14:05:09-03:00</dhProc>` +
    `<xTribNac>Análise e desenvolvimento de sistemas.</xTribNac>` +
    `<xLocPrestacao>Campinas</xLocPrestacao><cLocIncid>3509502</cLocIncid><xLocIncid>Campinas</xLocIncid>` +
    `<emit><CNPJ>11222333000181</CNPJ><xNome>OFICINA LESTE LTDA</xNome>` +
    `<enderNac><xLgr>RUA DAS FLORES</xLgr><nro>10</nro><xBairro>CENTRO</xBairro><cMun>3509502</cMun><UF>SP</UF><CEP>13010000</CEP></enderNac>` +
    `</emit><valores><vLiq>250.00</vLiq></valores>` +
    `<DPS><infDPS><tpAmb>1</tpAmb><dhEmi>2026-03-02T14:05:07-03:00</dhEmi><serie>80000</serie><nDPS>42</nDPS>` +
    `<dCompet>2026-03-02</dCompet><tpEmit>1</tpEmit>` +
    `<prest><CNPJ>11222333000181</CNPJ><regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN></regTrib></prest>` +
    `<toma><CNPJ>99888777000166</CNPJ><xNome>MERCADO SUL LTDA</xNome>` +
    `<end><endNac><cMun>3550308</cMun><CEP>01310100</CEP></endNac><xLgr>AVENIDA PAULISTA</xLgr><nro>1000</nro><xBairro>BELA VISTA</xBairro></end></toma>` +
    `<serv><locPrest><cLocPrestacao>3509502</cLocPrestacao></locPrest>` +
    `<cServ><cTribNac>010501</cTribNac><xDescServ>Manutenção de março</xDescServ><cNBS>115013000</cNBS></cServ></serv>` +
    `<valores><vServPrest><vServ>250.00</vServ></vServPrest>` +
    `<trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun>` +
    `<totTrib><pTotTribSN>6.00</pTotTribSN></totTrib></trib></valores>` +
    `</infDPS></DPS></infNFSe></NFSe>`;
}

describe("DANFSe simplificado", () => {
  it("desenha a nota autorizada e deixa o PDF oficial passar quando ele existe", () => {
    const dados = lerDanfseXml(xmlNota(), CHAVE);
    assert.equal(dados.numero, "88");
    assert.equal(dados.prestador.nome, "OFICINA LESTE LTDA");
    assert.equal(dados.tomador.nome, "MERCADO SUL LTDA");
    assert.equal(dados.tomador.municipio, "São Paulo / SP");
    assert.equal(dados.valorServico, "R$ 250,00");
    assert.equal(dados.urlConsulta, `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${CHAVE}`);
    assert.equal(urlConsultaNfse(CHAVE, false), `https://www.producaorestrita.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${CHAVE}`);
    const pdf = pdfDanfseSimplificado(dados);
    assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.equal(pdf.toString("latin1").split("/Type /Page /Parent").length - 1, 1);
    const texto = pdf.toString("latin1");
    assert.match(texto, /DANFSe v2\.0/);
    assert.match(texto, /Documento Auxiliar da NFS-e/);
    assert.match(texto, /OFICINA LESTE LTDA/);
    assert.match(texto, /MERCADO SUL LTDA/);
    assert.match(texto, /R\$ 250,00/);
    assert.match(texto, /Manuten\\347\\343o de mar\\347o/);
    assert.match(texto, new RegExp(CHAVE));
    assert.match(texto, /ConsultaPublica\/\?tpc=1&chave=/);
    assert.equal(texto.includes("TERUYA"), false);
    assert.equal(texto.includes("6.900,00"), false);
    assert.equal(texto.includes(CHAVE_MODELO), false);
    assert.equal(texto.includes("179394742680808"), false);
    const oficial = Buffer.from("%PDF-1.4\noficial\n");
    assert.equal(pdfDaNota(oficial, xmlNota(), CHAVE).toString("latin1"), oficial.toString("latin1"));
    assert.match(pdfDaNota(null, xmlNota(), CHAVE).toString("latin1"), /MERCADO SUL LTDA/);
    assert.throws(() => lerDanfseXml("<NFSe></NFSe>", CHAVE), DomainError);
  });
});
