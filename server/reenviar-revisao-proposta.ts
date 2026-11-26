/**
 * Reenvia o e-mail de revisão da proposta, com o mesmo PDF, sem mudar o status.
 *
 * node --experimental-strip-types --env-file=.env server/reenviar-revisao-proposta.ts <proposta-id>
 */
import { clienteAdmin } from "./admin.ts";
import { reenviarRevisaoDaProposta } from "./gravacoes.ts";

const id = process.argv[2]?.trim();
if (!id) {
  console.error("Informe o id da proposta.");
  process.exitCode = 1;
} else {
  try {
    await reenviarRevisaoDaProposta(clienteAdmin(), id);
    console.log(`Revisão reenviada: ${id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível reenviar a revisão.";
    console.error(message);
    process.exitCode = 1;
  }
}
