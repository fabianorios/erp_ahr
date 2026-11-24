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
  it("coloca cliente e AHR na seção de responsabilidades, antes do planejamento", () => {
    const xml = documentoDe(
      preencherModelo(
        readFileSync(MODELO),
        dados({
          responsabilidades: "<p>Texto antigo que não deve sair.</p>",
          responsabilidadeCliente: "<p>Entregar os documentos.</p>",
          responsabilidadeAhr: "<p>Executar o serviço.</p>",
        }),
      ),
    );
    const secao = xml.lastIndexOf("Definição de responsabilidades");
    const cliente = xml.indexOf("Responsabilidade do cliente");
    const ahr = xml.indexOf("Responsabilidade da AHR Brasil");
    const planejamento = xml.lastIndexOf("Planejamento de Trabalho");
    const validade = xml.lastIndexOf("Validade da proposta");
    assert.ok(secao >= 0 && cliente > secao && ahr > cliente && planejamento > ahr && validade > planejamento);
    assert.ok(xml.indexOf("Entregar os documentos.") > cliente && xml.indexOf("Entregar os documentos.") < ahr);
    assert.ok(xml.indexOf("Executar o serviço.") > ahr && xml.indexOf("Executar o serviço.") < planejamento);
    assert.equal(xml.includes("Texto antigo que não deve sair."), false);
  });

  it("mantém os títulos vazios e o texto antigo só enquanto os dois campos estão em branco", () => {
    const vazio = documentoDe(preencherModelo(readFileSync(MODELO), dados()));
    const cliente = vazio.indexOf("Responsabilidade do cliente");
    const ahr = vazio.indexOf("Responsabilidade da AHR Brasil");
    const planejamento = vazio.lastIndexOf("Planejamento de Trabalho");
    assert.ok(cliente >= 0 && ahr > cliente && planejamento > ahr);
    const antigo = documentoDe(
      preencherModelo(readFileSync(MODELO), dados({ responsabilidades: "<p>Texto antigo das duas partes.</p>" })),
    );
    const tituloAntigo = antigo.indexOf("Responsabilidade do cliente");
    const textoAntigo = antigo.indexOf("Texto antigo das duas partes.");
    assert.ok(textoAntigo >= 0 && textoAntigo < tituloAntigo);
    assert.ok(tituloAntigo < antigo.lastIndexOf("Planejamento de Trabalho"));
  });
});
