import { spawn } from "node:child_process";

const api = spawn("node", ["--experimental-strip-types", "--env-file=.env", "server/index.ts"], { stdio: "inherit" });
const web = spawn("npx", ["vite"], { stdio: "inherit" });

function encerrar(code) {
  api.kill();
  web.kill();
  process.exit(code ?? 0);
}

api.on("exit", (code) => {
  if (code) encerrar(code);
});
web.on("exit", (code) => encerrar(code ?? 0));
process.on("SIGINT", () => encerrar(0));
process.on("SIGTERM", () => encerrar(0));
