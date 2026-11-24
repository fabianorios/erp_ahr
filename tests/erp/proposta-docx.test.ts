import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { preencherModelo, type DadosPropostaDocx } from "../../server/proposta-docx.ts";

const MODELO = join(import.meta.dirname, "../../templates/template-proposta-ahr.docx");

function documentoDe(docx: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "proposta-teste-"));
  try {
    const arquivo = join(dir, "proposta.docx");
    writeFileSync(arquivo, docx);
    return execFileSync(
      "python3",
      ["-c", "import zipfile,sys; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read('word/document.xml'))", arquivo],
    ).toString("utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function dados(extra: Partial<DadosPropostaDocx> = {}): DadosPropostaDocx {
  return {
    titulo: "Demanda teste",
    clienteNome: "Cliente Teste Ltda",
    visaoGeral: "<p>Panorama do trabalho.</p>",
    escopo: "",
    responsabilidades: "",
    prazo: "",
    execucao: "",
    validade: "30 dias",
    responsabilidadeCliente: "",
    responsabilidadeAhr: "",
    formaPagamento: "",
    valorTotal: "R$ 100,00",
    dataExtenso: "24 de novembro de 2026",
    ...extra,
  };
}

describe("responsabilidades no documento da proposta", () => {
  it("coloca cliente e AHR depois do conteúdo e antes do fecho", () => {
    const xml = documentoDe(
      preencherModelo(
        readFileSync(MODELO),
        dados({
          responsabilidadeCliente: "<p>Entregar os documentos.</p>",
          responsabilidadeAhr: "<p>Executar o serviço.</p>",
        }),
      ),
    );
    const validade = xml.lastIndexOf("Validade da proposta");
    const cliente = xml.indexOf("Responsabilidade do cliente");
    const ahr = xml.indexOf("Responsabilidade da AHR Brasil");
    const fecho = xml.indexOf("Atenciosamente,");
    assert.ok(validade >= 0 && cliente > validade && ahr > cliente && fecho > ahr);
    assert.ok(xml.indexOf("Panorama do trabalho.") < cliente);
    assert.ok(xml.indexOf("Entregar os documentos.") > cliente && xml.indexOf("Entregar os documentos.") < ahr);
    assert.ok(xml.indexOf("Executar o serviço.") > ahr && xml.indexOf("Executar o serviço.") < fecho);
    assert.equal(xml.includes("O que fica a cargo"), false);
  });

  it("mantém os títulos quando os campos estão vazios", () => {
    const xml = documentoDe(preencherModelo(readFileSync(MODELO), dados()));
    const cliente = xml.indexOf("Responsabilidade do cliente");
    const ahr = xml.indexOf("Responsabilidade da AHR Brasil");
    const fecho = xml.indexOf("Atenciosamente,");
    assert.ok(cliente >= 0 && ahr > cliente && fecho > ahr);
    assert.equal(xml.includes("Entregar os documentos."), false);
    assert.equal(xml.includes("Executar o serviço."), false);
  });
});
