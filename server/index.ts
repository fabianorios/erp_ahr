import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { DomainError, adicionaisDeJson, agendaDeJson, formatBrl, htmlAdicionais, htmlAgenda, reaisToCents } from "../src/services/erp/domain.ts";
import { executarAssinatura, executarAssinaturaPublica, propostaIdDaAssinatura } from "./assinaturas.ts";
import { executarGravacao } from "./gravacoes.ts";
import { dataPropostaExtenso, docxParaPdf, preencherModeloDoDisco } from "./proposta-docx.ts";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const port = Number(process.env.PORT || 3001);
const papeis = ["admin", "consultor", "editor", "beta_tester"] as const;

if (!url || !anon || !service) {
  console.error("Defina VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const publico = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

function json(res: import("node:http").ServerResponse, status: number, corpo: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(corpo));
}

async function papelDe(token: string, criarPrimeiro = false): Promise<{ status: number; papel?: string; message?: string; email?: string; nome?: string }> {
  if (!token) return { status: 401, message: "Entre de novo." };
  const { data: usuario, error } = await publico.auth.getUser(token);
  if (error || !usuario.user) return { status: 401, message: "Sessão inválida." };
  const userId = usuario.user.id;
  const meta = usuario.user.user_metadata as Record<string, unknown> | undefined;
  const bruto = typeof meta?.full_name === "string" ? meta.full_name : typeof meta?.name === "string" ? meta.name : "";
  const nome = bruto.trim() || "AHR";
  const email = usuario.user.email ?? "";
  const { data: meus, error: erroMeus } = await admin.from("user_roles").select("role").eq("user_id", userId);
  if (erroMeus) return { status: 500, message: "Não foi possível ler os papéis." };
  const papel = (meus ?? []).map((row) => String(row.role)).find((role) => (papeis as readonly string[]).includes(role));
  if (papel) return { status: 200, papel, email, nome };
  if (!criarPrimeiro) return { status: 403, message: "Peça a um admin para incluir seu usuário em user_roles." };
  const { count, error: erroConta } = await admin.from("user_roles").select("user_id", { count: "exact", head: true });
  if (erroConta) return { status: 500, message: "Não foi possível ler os papéis." };
  if ((count ?? 0) > 0) return { status: 403, message: "Peça a um admin para incluir seu usuário em user_roles." };
  const { error: erroInsert } = await admin.from("user_roles").insert({ user_id: userId, role: "admin" });
  if (erroInsert) return { status: 500, message: "Não foi possível gravar o papel admin." };
  return { status: 200, papel: "admin", email, nome };
}

function ipDe(req: import("node:http").IncomingMessage): string {
  const encaminhado = req.headers["x-forwarded-for"];
  const bruto = Array.isArray(encaminhado) ? encaminhado[0] : encaminhado ?? "";
  const primeiro = bruto.split(",")[0]?.trim();
  return (primeiro || req.socket.remoteAddress || "").slice(0, 80);
}

function tokenDe(req: import("node:http").IncomingMessage): string {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function lerCorpo(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let tamanho = 0;
    req.on("data", (chunk: Buffer) => {
      tamanho += chunk.length;
      if (tamanho > 4_000_000) {
        reject(new Error("grande"));
        req.destroy();
        return;
      }
      partes.push(chunk);
    });
    req.on("end", () => {
      const texto = Buffer.concat(partes).toString("utf8");
      if (!texto) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(texto));
      } catch {
        reject(new Error("json"));
      }
    });
    req.on("error", reject);
  });
}

async function gravar(token: string, acao: string, corpo: unknown): Promise<{ status: number; corpo: unknown }> {
  const acesso = await papelDe(token);
  if (!acesso.papel) return { status: acesso.status, corpo: { message: acesso.message ?? "Sem papel de equipe." } };
  try {
    if (acao.startsWith("assinatura.")) {
      const resultado = await executarAssinatura(admin, acao, corpo, { email: acesso.email ?? "", nome: acesso.nome ?? "AHR" });
      return { status: 200, corpo: resultado };
    }
    const resultado = await executarGravacao(admin, acao, corpo);
    return { status: 200, corpo: resultado };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível gravar.";
    return { status: error instanceof DomainError ? 400 : 500, corpo: { message } };
  }
}

async function pdfDaProposta(id: string): Promise<{ status: number; message?: string; pdf?: Buffer; nome?: string }> {
  try {
  const { data, error } = await admin.from("erp_propostas").select("*, clients(name)").eq("id", id).maybeSingle();
  if (error) return { status: 500, message: "Não foi possível ler a proposta." };
  if (!data) return { status: 404, message: "Proposta não encontrada." };
  const embutido = Array.isArray(data.clients) ? data.clients[0] : data.clients;
  let clienteNome = typeof embutido?.name === "string" ? embutido.name.trim() : "";
  if (!clienteNome && data.cliente_id) {
    const { data: cliente } = await admin.from("clients").select("name").eq("id", data.cliente_id).maybeSingle();
    clienteNome = typeof cliente?.name === "string" ? cliente.name.trim() : "";
  }
  const agenda = agendaDeJson(data.agenda_pagamento);
  const adicionais = htmlAdicionais(adicionaisDeJson(data.valores_adicionais));
  const nota = typeof data.forma_pagamento === "string" ? data.forma_pagamento : "";
  const valor = typeof data.valor_total === "number" || typeof data.valor_total === "string" ? formatBrl(reaisToCents(data.valor_total)) : "R$ 0,00";
  const docx = preencherModeloDoDisco({
    titulo: typeof data.titulo === "string" ? data.titulo : "",
    clienteNome,
    visaoGeral: typeof data.visao_geral === "string" ? data.visao_geral : "",
    escopo: String(data.escopo ?? ""),
    responsabilidades: String(data.responsabilidades ?? ""),
    prazo: String(data.prazo ?? ""),
    execucao: typeof data.execucao === "string" ? data.execucao : "",
    validade: typeof data.validade === "string" ? data.validade : "",
    formaPagamento: `${agenda ? htmlAgenda(agenda) : ""}${adicionais}${nota}`,
    valorTotal: valor,
    dataExtenso: dataPropostaExtenso(),
  });
  const pdf = docxParaPdf(docx);
  const nome = `${String(data.numero ?? "proposta").replace(/[^A-Za-z0-9._-]/g, "")}-v${Number(data.versao ?? 1)}.pdf`;
  return { status: 200, pdf, nome };
  } catch (error) {
    if (error instanceof DomainError) return { status: 400, message: error.message };
    return { status: 500, message: "Não foi possível gerar o PDF." };
  }
}

const server = createServer((req, res) => {
  void (async () => {
    const url = req.url ?? "";
    const caminho = url.split("?")[0];
    const pdfAssinatura = /^\/api\/assinar\/([A-Za-z0-9_-]{20,128})\/pdf$/.exec(caminho);
    if (req.method === "GET" && pdfAssinatura) {
      try {
        const propostaId = await propostaIdDaAssinatura(admin, pdfAssinatura[1]);
        const gerado = await pdfDaProposta(propostaId);
        if (!gerado.pdf) {
          json(res, gerado.status, { message: gerado.message ?? "Não foi possível gerar o PDF." });
          return;
        }
        res.writeHead(200, {
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="${gerado.nome ?? "proposta.pdf"}"`,
          "cache-control": "no-store",
        });
        res.end(gerado.pdf);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Não foi possível abrir o PDF.";
        json(res, error instanceof DomainError ? 400 : 500, { message });
      }
      return;
    }
    if (req.method === "POST" && url === "/api/assinar") {
      let corpo: unknown = {};
      try {
        corpo = await lerCorpo(req);
      } catch {
        json(res, 400, { message: "Dados inválidos." });
        return;
      }
      try {
        json(res, 200, await executarAssinaturaPublica(admin, corpo, ipDe(req)));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Não foi possível continuar.";
        json(res, error instanceof DomainError ? 400 : 500, { message });
      }
      return;
    }
    if (req.method === "POST" && (url === "/api/clientes" || url === "/api/erp")) {
      let corpo: unknown = {};
      try {
        corpo = await lerCorpo(req);
      } catch {
        json(res, 400, { message: "Dados inválidos." });
        return;
      }
      const pedido = corpo && typeof corpo === "object" ? (corpo as { acao?: unknown; dados?: unknown }) : {};
      const acao = url === "/api/clientes" ? "cliente.salvar" : typeof pedido.acao === "string" ? pedido.acao : "";
      const dados = url === "/api/clientes" ? corpo : pedido.dados;
      const gravado = await gravar(tokenDe(req), acao, dados);
      json(res, gravado.status, gravado.corpo);
      return;
    }
    if (req.method === "POST" && url === "/api/acesso") {
      const acesso = await papelDe(tokenDe(req), true);
      if (acesso.papel) json(res, 200, { papel: acesso.papel });
      else json(res, acesso.status, { message: acesso.message ?? "Sem papel de equipe." });
      return;
    }
    const pdf = /^\/api\/propostas\/([0-9a-f-]{36})\/pdf$/i.exec(url);
    if (req.method === "POST" && pdf) {
      const acesso = await papelDe(tokenDe(req));
      if (!acesso.papel) {
        json(res, acesso.status, { message: acesso.message ?? "Sem papel de equipe." });
        return;
      }
      const gerado = await pdfDaProposta(pdf[1]);
      if (!gerado.pdf) {
        json(res, gerado.status, { message: gerado.message ?? "Não foi possível gerar o PDF." });
        return;
      }
      res.writeHead(200, {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${gerado.nome ?? "proposta.pdf"}"`,
        "cache-control": "no-store",
      });
      res.end(gerado.pdf);
      return;
    }
    json(res, 404, { message: "Não encontrado." });
  })().catch(() => {
    if (!res.headersSent) json(res, 500, { message: "Não foi possível concluir." });
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`API de acesso em 127.0.0.1:${port}`);
});
