/**
 * Cadastra o webhook da Cora no servidor de produção, com o certificado já configurado.
 * A API aceita um trigger por endpoint, então o comando cria invoice/paid, invoice/canceled
 * e invoice/overdue, todos apontando para https://erpahr.ahrbrasil.com.br/api/cora/webhook.
 * Não emite boleto.
 *
 * node --experimental-strip-types --env-file=.env server/registrar-webhook-cora.ts
 */
import { registrarWebhooksCora } from "./boleto-cora.ts";

try {
  const itens = await registrarWebhooksCora();
  for (const item of itens) {
    console.log(`${item.trigger} ${item.acao}${item.id ? ` ${item.id}` : ""}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Não foi possível cadastrar o webhook.";
  console.error(message);
  process.exitCode = 1;
}
