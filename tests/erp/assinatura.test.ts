import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DomainError } from "../../src/services/erp/domain.ts";
import {
  PRAZO_CODIGO_MS,
  PRAZO_CODIGO_TEXTO,
  caminhoPdfProposta,
  emailConcluida,
  emailParaAhr,
  emailParaCliente,
  mascararEmail,
  motivoRecusaAssinatura,
  motivoRecusaIncluirContato,
  MSG_INCLUIR_AHR,
  MSG_INCLUIR_CONCLUIDA,
  MSG_INCLUIR_DEVOLVIDA,
  MSG_INCLUIR_REPETIDO,
  ordenarContatos,
  planejarInclusaoContato,
  podePedirAssinatura,
  validarMotivoDevolucao,
  validarNomeAssinatura,
} from "../../src/services/erp/assinatura.ts";

describe("assinatura de duas partes", () => {
  it("aceita proposta em rascunho, enviada ou aceita e recusa o resto", () => {
    assert.equal(podePedirAssinatura("proposta", "rascunho"), true);
    assert.equal(podePedirAssinatura("proposta", "enviada"), true);
    assert.equal(podePedirAssinatura("proposta", "aceita"), true);
    assert.equal(podePedirAssinatura("proposta", "recusada"), false);
    assert.equal(podePedirAssinatura("proposta", "expirada"), false);
    assert.match(motivoRecusaAssinatura("proposta", "recusada") ?? "", /recusada ou expirada/);
  });

  it("aceita contrato em rascunho ou vigente", () => {
    assert.equal(podePedirAssinatura("contrato", "rascunho"), true);
    assert.equal(podePedirAssinatura("contrato", "vigente"), true);
    assert.equal(podePedirAssinatura("contrato", "cancelado"), false);
    assert.equal(podePedirAssinatura("contrato", "encerrado"), false);
  });

  it("o código cobrado no e-mail é o de 7 dias", () => {
    assert.equal(PRAZO_CODIGO_MS, 7 * 24 * 60 * 60 * 1000);
    const cliente = emailParaCliente({
      tipo: "proposta",
      titulo: "DIRF",
      empresa: "VIS",
      nome: "VIS",
      otp: "123456",
      link: "https://erpahr.ahrbrasil.com.br/assinar/abc",
    });
    assert.equal(cliente.assunto, "Proposta DIRF — sua assinatura é necessária");
    assert.match(cliente.texto, /assinatura eletrônica/);
    assert.match(cliente.texto, /Código de verificação: 123456/);
    assert.match(cliente.texto, /Leia a proposta em PDF nesta página antes de assinar/);
    assert.match(cliente.texto, /https:\/\/erpahr\.ahrbrasil\.com\.br\/assinar\/abc/);
    assert.equal(caminhoPdfProposta("abc"), "/api/assinar/abc/pdf");
    assert.match(cliente.texto, new RegExp(PRAZO_CODIGO_TEXTO));
    assert.doesNotMatch(cliente.texto, /30 minutos|Solicitante|Gestor|testemunha|Documento de Escopo/i);
    const ahr = emailParaAhr({ tipo: "contrato", titulo: "C-1 v1", nome: "AHR", anterior: "VIS", otp: "654321", link: "https://erpahr.ahrbrasil.com.br/assinar/abc" });
    assert.match(ahr.texto, /assinou o Contrato C-1 v1/);
    assert.match(ahr.texto, /sua assinatura como AHR/);
    assert.match(ahr.texto, new RegExp(PRAZO_CODIGO_TEXTO));
    const fim = emailConcluida({ tipo: "proposta", titulo: "DIRF", empresa: "VIS", nome: "VIS", link: "https://erpahr.ahrbrasil.com.br/assinar/abc" });
    assert.match(fim.texto, /assinada pelo cliente e pela AHR/);
    assert.doesNotMatch(fim.texto, /quatro/);
  });

  it("aceita uma lista ordenada de contatos, sem repetir", () => {
    const primeiro = "11111111-1111-4111-8111-111111111111";
    const segundo = "22222222-2222-4222-8222-222222222222";
    assert.deepEqual(ordenarContatos([primeiro, segundo]), [primeiro, segundo]);
    assert.throws(() => ordenarContatos([]), (erro: unknown) => erro instanceof DomainError && /ao menos um contato/.test(erro.message));
    assert.throws(() => ordenarContatos([primeiro, primeiro.toUpperCase()]), (erro: unknown) => erro instanceof DomainError && /duas vezes/.test(erro.message));
    assert.throws(() => ordenarContatos(["contato"]), (erro: unknown) => erro instanceof DomainError && /inválido/.test(erro.message));
  });

  it("inclui o contato antes da AHR e só marca a vez quando os anteriores já assinaram", () => {
    const antigo = "11111111-1111-4111-8111-111111111111";
    const novo = "22222222-2222-4222-8222-222222222222";
    const partes = [
      { ordem: 1, papel: "contato" as const, status: "solicitado" as const, email: "ana@vis.com.br", contatoId: antigo },
      { ordem: 2, papel: "ahr" as const, status: "pendente" as const, email: "ahr@ahrbrasil.com.br", contatoId: null },
    ];
    const plano = planejarInclusaoContato(partes, { id: novo, email: "bia@vis.com.br" });
    assert.deepEqual(plano, { ordem: 2, ahrOrdem: 3, vez: false });
    const naVez = planejarInclusaoContato(
      [{ ...partes[0], status: "assinado" }, partes[1]],
      { id: novo, email: "bia@vis.com.br" },
    );
    assert.equal(naVez.vez, true);
    assert.equal(naVez.ordem, 2);
    assert.equal(motivoRecusaIncluirContato("enviada", false), null);
    assert.equal(motivoRecusaIncluirContato("concluida", true), MSG_INCLUIR_CONCLUIDA);
    assert.equal(motivoRecusaIncluirContato("devolvida", false), MSG_INCLUIR_DEVOLVIDA);
    assert.equal(motivoRecusaIncluirContato("enviada", true), MSG_INCLUIR_AHR);
    assert.throws(() => planejarInclusaoContato([{ ...partes[1], status: "assinado" }], { id: novo, email: "bia@vis.com.br" }), (erro: unknown) => erro instanceof DomainError && erro.message === MSG_INCLUIR_AHR);
    assert.throws(() => planejarInclusaoContato(partes, { id: antigo, email: "outro@vis.com.br" }), (erro: unknown) => erro instanceof DomainError && erro.message === MSG_INCLUIR_REPETIDO);
    assert.throws(() => planejarInclusaoContato(partes, { id: novo, email: "Ana@vis.com.br" }), (erro: unknown) => erro instanceof DomainError && erro.message === MSG_INCLUIR_REPETIDO);
  });

  it("mascara o e-mail e exige nome e ressalva", () => {
    assert.equal(mascararEmail("ana@vis.com.br"), "a***@vis.com.br");
    assert.throws(() => validarNomeAssinatura("A"), DomainError);
    assert.equal(validarNomeAssinatura("Ana"), "Ana");
    assert.throws(() => validarMotivoDevolucao("não"), DomainError);
    assert.equal(validarMotivoDevolucao("Valor divergente"), "Valor divergente");
  });
});
