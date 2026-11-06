import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, it } from "node:test";
import { DomainError } from "../../src/services/erp/domain.ts";
import forge from "node-forge";
import {
  ambienteNfse,
  idDps,
  codigoTributacaoNacional,
  instanteBrasil,
  lerNotaAutorizada,
  montarDps,
  tituloDaNota,
  validarBaseSefin,
  type PedidoNfse,
} from "../../src/services/erp/nfse-nacional.ts";
import { abrirPfx, aplicarNota, assinarDps, certificadoDaEmissao, certificadoDaGestao, cookiesSessao, deveSeguirRedirecionamentoDanfse, enderecoDanfse, enderecoLoginDanfse, falhaPdfDanfse, hrefImpressaoNfse, incorporarXml, pdfDaPaginaNfse, pdfDanfse } from "../../server/nfse-nacional.ts";

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
    cMunPrestador: "3548807",
    cnpjPrestador: "50516724000160",
    inscricaoMunicipal: "",
    codigoServico: "170101",
    codigoMunicipal: "3360500",
    cNbs: "114011900",
    aliquota: "2,00",
    serie: "1",
    numeroDps: "100000000000001",
    emitidoEm: "2026-11-06T08:00:00-03:00",
    competencia: "2026-11-06",
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
    assert.equal(ambienteNfse("producao").ambiente, 1);
    assert.equal(ambienteNfse("2").base, "https://sefin.producaorestrita.nfse.gov.br/SefinNacional");
    assert.throws(() => ambienteNfse("valor-que-nao-pode-vazar"), (error: unknown) => error instanceof DomainError && !String(error.message).includes("valor-que-nao-pode-vazar"));
    assert.equal(validarBaseSefin("https://sefin.nfse.gov.br/SefinNacional"), "https://sefin.nfse.gov.br/SefinNacional");
    assert.throws(() => validarBaseSefin("https://exemplo.invalid/SefinNacional"), DomainError);
    const xml = montarDps(pedido());
    assert.match(xml, /Consultoria mensal/);
    assert.match(xml, /19678493000141/);
    assert.match(xml, /<vServ>169\.00<\/vServ>/);
    assert.match(xml, /versao="1.01"/);
    assert.match(xml, /<verAplic>ERP-AHR-1.0<\/verAplic>/);
    assert.match(xml, /<serie>1<\/serie>/);
    assert.match(xml, /<nDPS>100000000000001<\/nDPS>/);
    assert.match(xml, /<cTribNac>170101<\/cTribNac>/);
    assert.doesNotMatch(xml, /<cTribMun>/);
    assert.match(xml, /<cNBS>114011900<\/cNBS>/);
    assert.match(xml, /<opSimpNac>3<\/opSimpNac><regApTribSN>1<\/regApTribSN><regEspTrib>0<\/regEspTrib>/);
    assert.match(xml, /<pTotTribSN>2.00<\/pTotTribSN>/);
    assert.doesNotMatch(xml, /<email>/);
    assert.doesNotMatch(xml, /<IM>/);
    assert.doesNotMatch(xml, /indTotTrib/);
    assert.equal(codigoTributacaoNacional("17.01"), "170101");
    assert.equal(codigoTributacaoNacional("010601"), "010601");
    assert.match(montarDps(pedido({ codigoServico: "010601" })), /<cTribNac>010601<\/cTribNac>/);
    assert.match(xml, /<dhEmi>2026-11-06T08:00:00-03:00<\/dhEmi>/);
    assert.match(xml, /<dCompet>2026-11-06<\/dCompet>/);
    assert.match(montarDps(pedido({ numeroDps: "1" })), /<nDPS>1<\/nDPS>/);
    assert.doesNotMatch(montarDps(pedido({ inscricaoMunicipal: "12345678" })), /<IM>/);
    assert.match(montarDps(pedido({ codigoMunicipal: "020" })), /<cTribMun>020<\/cTribMun>/);
    assert.doesNotMatch(montarDps(pedido({ codigoMunicipal: "3360500" })), /<cTribMun>/);
    assert.equal(instanteBrasil(new Date("2026-11-06T11:00:00Z")).startsWith("2026-11-06T08:00:00"), true);
    const futuro = montarDps(pedido({ vencimento: "2026-11-02", competencia: "2026-11-02" }));
    assert.match(futuro, /<dCompet>2026-11-06<\/dCompet>/);
    assert.doesNotMatch(montarDps(pedido({ vencimento: "2026-12-20", competencia: "2026-12-20" })), /<dCompet>2026-12/);
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

  it("abre o PFX com a senha e não devolve a senha no erro", () => {
    const senha = "senha-de-teste";
    const chaves = forge.pki.rsa.generateKeyPair(2048);
    const certificado = forge.pki.createCertificate();
    certificado.publicKey = chaves.publicKey;
    certificado.serialNumber = "01";
    certificado.validity.notBefore = new Date();
    certificado.validity.notAfter = new Date();
    certificado.validity.notAfter.setFullYear(certificado.validity.notBefore.getFullYear() + 1);
    const nome = [{ name: "commonName", value: "teste" }];
    certificado.setSubject(nome);
    certificado.setIssuer(nome);
    certificado.sign(chaves.privateKey);
    const asn1 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [certificado], senha, { algorithm: "3des" });
    const pfx = Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary");
    const aberto = abrirPfx(pfx, senha);
    assert.match(aberto.chave, /BEGIN RSA PRIVATE KEY|BEGIN PRIVATE KEY/);
    assert.match(aberto.certificado, /BEGIN CERTIFICATE/);
    assert.throws(() => abrirPfx(pfx, `${senha}-errada`), (error: unknown) => error instanceof DomainError && !String(error.message).includes(senha));
  });

  it("usa o PFX configurado no Gestão e abre o formato antigo com openssl -legacy", () => {
    const dir = mkdtempSync(join(tmpdir(), "gestao-cert-"));
    const senha = "senha-de-teste";
    const pfx = join(dir, "certificado.pfx");
    const chave = join(dir, "key.pem");
    const cert = join(dir, "cert.pem");
    try {
      writeFileSync(join(dir, ".env"), `CERTIFICADO_A1=${pfx}\nCERTIFICADO_A1_SENHA=${senha}\n`);
      const achado = certificadoDaGestao(dir);
      assert.equal(achado?.caminho, pfx);
      assert.equal(achado?.senha, senha);
      const pedido = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", chave, "-out", cert, "-days", "2", "-nodes", "-subj", "/CN=teste"], { encoding: "utf8" });
      assert.equal(pedido.status, 0);
      const pacote = spawnSync("openssl", ["pkcs12", "-export", "-legacy", "-certpbe", "PBE-SHA1-RC2-40", "-keypbe", "PBE-SHA1-RC2-40", "-macalg", "SHA1", "-inkey", chave, "-in", cert, "-out", pfx, "-passout", `pass:${senha}`], { encoding: "utf8" });
      assert.equal(pacote.status, 0);
      const emissao = certificadoDaEmissao(dir, { NFSE_CERT_PATH: "/tmp/outro.pfx", NFSE_CERT_PASSWORD: "outra" });
      assert.equal(emissao.caminho, pfx);
      mkdirSync(join(dir, "vazio"));
      assert.throws(
        () => certificadoDaEmissao(join(dir, "vazio"), { NFSE_CERT_PATH: "/tmp/outro.pfx", NFSE_CERT_PASSWORD: "outra" }),
        (error: unknown) => error instanceof DomainError && !String(error.message).includes("outra"),
      );
      const semGestao = certificadoDaEmissao(join(dir, "nao-existe"), { NFSE_CERT_PATH: pfx, NFSE_CERT_PASSWORD: senha });
      assert.equal(semGestao.caminho, pfx);
      const aberto = abrirPfx(Buffer.from("nao-e-pfx"), senha, pfx);
      assert.match(aberto.chave, /BEGIN (RSA )?PRIVATE KEY/);
      assert.match(aberto.certificado, /BEGIN CERTIFICATE/);
      assert.throws(() => abrirPfx(Buffer.from("nao-e-pfx"), `${senha}-errada`, pfx), (error: unknown) => error instanceof DomainError && !String(error.message).includes(senha));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefere o esocial.pfx do Gestão e entra no host do certificado", () => {
    const dir = mkdtempSync(join(tmpdir(), "gestao-esocial-"));
    const senha = "senha-esocial-teste";
    try {
      mkdirSync(join(dir, "secrets"));
      const pfx = join(dir, "secrets", "esocial.pfx");
      writeFileSync(pfx, "pfx");
      writeFileSync(join(dir, "secrets", "esocial.env"), `ESOCIAL_CERT_PASSWORD=${senha}\n`);
      writeFileSync(join(dir, ".env"), "NFSE_CERT_PATH=/tmp/erpahr.pfx\nNFSE_CERT_PASSWORD=outra-senha\n");
      const achado = certificadoDaGestao(dir);
      assert.equal(achado?.caminho, pfx);
      assert.equal(achado?.senha, senha);
      const emissao = certificadoDaEmissao(dir, { NFSE_CERT_PATH: "/tmp/erpahr.pfx", NFSE_CERT_PASSWORD: "outra-senha" });
      assert.equal(emissao.caminho, pfx);
      assert.equal(emissao.senha, senha);
      assert.equal(enderecoLoginDanfse(true), "https://certificado.nfse.gov.br/EmissorNacional/Certificado");
      assert.equal(enderecoLoginDanfse(false), "https://certificado.producaorestrita.nfse.gov.br/EmissorNacional/Certificado");
      const chaveNota = "2".repeat(50);
      assert.equal(enderecoDanfse(true, chaveNota), `https://www.nfse.gov.br/EmissorNacional/Notas/Visualizar/Index/${chaveNota}`);
      assert.equal(enderecoDanfse(false, chaveNota), `https://www.producaorestrita.nfse.gov.br/EmissorNacional/Notas/Visualizar/Index/${chaveNota}`);
      const pagina = `<a href="/EmissorNacional/Notas/Visualizar/Impressao?chave=${chaveNota}">chave</a><a href="/EmissorNacional/Notas/Visualizar/Impressao?chave=tok-en_abc&amp;origem=nota">Imprimir</a>`;
      assert.equal(hrefImpressaoNfse(pagina, enderecoDanfse(true, chaveNota)), "https://www.nfse.gov.br/EmissorNacional/Notas/Visualizar/Impressao?chave=tok-en_abc&origem=nota");
      assert.equal(hrefImpressaoNfse(`<a href="/EmissorNacional/Notas/Visualizar/Impressao?chave=${chaveNota}">só a chave</a>`, enderecoDanfse(true, chaveNota)), null);
      const origem = enderecoDanfse(true, chaveNota);
      assert.equal(deveSeguirRedirecionamentoDanfse(301, `https://www.nfse.gov.br/EmissorNacional/Notas/Download/DANFSe/${chaveNota}`, origem), true);
      assert.equal(deveSeguirRedirecionamentoDanfse(302, "https://www.nfse.gov.br/EmissorNacional/Login", "https://certificado.nfse.gov.br/EmissorNacional/Certificado"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reconhece o PDF cru ou em base64 e descreve a falha sem a chave", () => {
    const cru = Buffer.from("%PDF-1.4\n%teste\n");
    assert.equal(pdfDanfse(cru)?.toString("utf8"), cru.toString("utf8"));
    const embrulhado = Buffer.from(JSON.stringify({ arquivo: { conteudo: cru.toString("base64") } }));
    assert.equal(pdfDanfse(embrulhado)?.subarray(0, 5).toString("utf8"), "%PDF-");
    assert.equal(pdfDanfse(Buffer.from("<html>senha-super-secreta</html>")), null);
    assert.deepEqual(cookiesSessao(["ASP.NET_SessionId=abc; path=/; HttpOnly", "ARRAffinity=zzz; Path=/"]), ["ASP.NET_SessionId=abc", "ARRAffinity=zzz"]);
    const chave = "1".repeat(50);
    const mensagem = falhaPdfDanfse([
      { url: `https://adn.nfse.gov.br/danfse/${chave}`, status: 404 },
      { url: `https://www.nfse.gov.br/EmissorNacional/Notas/Download/DANFSe/${chave}`, status: 200 },
    ]);
    assert.equal(mensagem, "O PDF da NFS-e não foi obtido (adn.nfse.gov.br/danfse HTTP 404; www.nfse.gov.br/EmissorNacional/Notas/Download/DANFSe HTTP 200).");
    assert.equal(mensagem.includes(chave), false);
    assert.equal(mensagem.includes("senha-super-secreta"), false);
    assert.equal(mensagem.includes("BEGIN"), false);
    const html = `<html><head><title>NFS-e | Emissor Nacional</title></head><body><table><tr><td>Prestador</td><td>AHR Consultoria</td></tr><tr><td>Servi&ccedil;o</td><td>S&atilde;o Caetano</td></tr><tr><td>Valor</td><td>R$ 169,00</td></tr></table></body></html>`;
    const pdf = pdfDaPaginaNfse(html);
    assert.ok(pdf);
    assert.equal(pdf.subarray(0, 5).toString("utf8"), "%PDF-");
    const texto = pdf.toString("latin1");
    assert.match(texto, /AHR Consultoria/);
    assert.match(texto, /S\\343o Caetano/);
    assert.match(texto, /169,00/);
    assert.equal(pdfDaPaginaNfse("<html><head><title>NFS-e | Portal Contribuinte</title></head><body><input type=\"password\"></body></html>"), null);
    assert.equal(pdfDaPaginaNfse(""), null);
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
