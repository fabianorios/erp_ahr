import { createHash, timingSafeEqual } from "node:crypto";

export type GraphMailConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  fromEmail: string;
  fromName: string;
};

type TokenCache = { key: string; accessToken: string; expiresAt: number };

let tokenCache: TokenCache | null = null;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function limpar(valor: string): string {
  return valor.trim().replace(/^["']+|["']+$/g, "");
}

function codigoGraph(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: string | { code?: string } };
    if (typeof parsed.error === "string") return parsed.error;
    return parsed.error?.code ?? "";
  } catch {
    return "";
  }
}

function aadsts(body: string): string {
  return body.match(/AADSTS\d+/i)?.[0]?.toUpperCase() ?? "";
}

export function graphFriendlyError(status: number, body: string): string {
  const code = codigoGraph(body);
  const aad = aadsts(body);
  const lower = `${code} ${aad} ${body}`.toLowerCase();
  if (/aadsts7000215|invalid client secret/i.test(lower)) {
    return "O Entra recusou o secret (invalid token / AADSTS7000215). Cole o Valor do client secret, não o Secret ID (GUID). O valor só aparece uma vez, na criação: Entra → o app → Certificados e segredos → Novo segredo.";
  }
  if (/aadsts7000222|expired/i.test(lower)) {
    return "O client secret expirou. Crie um novo em Entra → o app → Certificados e segredos e cole o Valor em Configurações → E-mails.";
  }
  if (/aadsts700016|application.*not found/i.test(lower)) {
    return "O Application (client) ID não existe neste tenant. Confira o ID do aplicativo e o Directory (tenant) ID no mesmo registro Entra.";
  }
  if (/aadsts900023|invalid tenant/i.test(lower)) {
    return "O Directory (tenant) ID está inválido. Use o GUID em Entra → Visão geral do diretório.";
  }
  if (/invalidauthenticationtoken|compacttoken|invalid_token/i.test(lower)) {
    return "O Entra/Graph recusou o token. Em geral o secret está errado: gere um novo Valor (não o Secret ID), cole em Configurações → E-mails e salve. Tenant e client ID também precisam ser os GUIDs do mesmo aplicativo.";
  }
  if (status === 401 || /invalid_client|unauthorized_client|invalid_grant/i.test(lower)) {
    return "O Microsoft Graph recusou o aplicativo (tenant, client ID ou secret incorretos). Use o Valor do secret, não o Secret ID.";
  }
  if (/mailboxnotenabledforrestapi/i.test(lower)) {
    return "A caixa remetente não tem Exchange Online (não está licenciada ou é só um usuário sem e-mail). Use uma caixa com licença ou uma caixa compartilhada.";
  }
  if (/erroraccessdenied|accessdenied/i.test(lower)) {
    return "O Graph recusou o envio (Access Denied). No Entra: permissão Mail.Send de aplicativo + consentimento do admin. Se o tenant usa política de acesso a aplicativo, autorize este app na caixa remetente.";
  }
  if (status === 403 || /authorization_requestdenied/i.test(lower)) {
    return "Falta Mail.Send de aplicativo com consentimento do administrador. Entra → o app → Permissões de API → Microsoft Graph → Permissões de aplicativo → Mail.Send → Conceder consentimento.";
  }
  if (status === 404) {
    return "A caixa remetente não foi encontrada no tenant. Confira o remetente configurado na Gestão.";
  }
  const snippet = body.replace(/\s+/g, " ").slice(0, 180);
  return `Microsoft Graph ${status}${code || aad ? ` (${code || aad})` : ""}: ${snippet || "falha no envio"}`;
}

function configGraph(): GraphMailConfig {
  const tenantId = limpar(process.env.GRAPH_TENANT_ID ?? "");
  const clientId = limpar(process.env.GRAPH_CLIENT_ID ?? "");
  const clientSecret = limpar(process.env.GRAPH_CLIENT_SECRET ?? "");
  const fromEmail = limpar(process.env.GRAPH_FROM_EMAIL ?? "");
  const fromName = limpar(process.env.GRAPH_FROM_NAME ?? "") || "AHR Brasil";
  if (!tenantId || !clientId || !clientSecret || !fromEmail) {
    throw new Error("O ERP não tem a caixa Microsoft Graph da AHR configurada.");
  }
  if (GUID.test(clientSecret)) {
    throw new Error(
      "O campo Client secret está com um GUID — isso é o Secret ID. Cole o Valor do secret (aparece só na criação). Entra → o app → Certificados e segredos → Novo segredo do cliente.",
    );
  }
  return { tenantId, clientId, clientSecret, fromEmail, fromName };
}

async function tokenGraph(config: GraphMailConfig): Promise<string> {
  const key = `${config.tenantId}|${config.clientId}|${config.clientSecret.length}`;
  if (tokenCache && tokenCache.key === key && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.accessToken;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(graphFriendlyError(response.status, raw));
  let json: { access_token?: string; expires_in?: number };
  try {
    json = JSON.parse(raw) as { access_token?: string; expires_in?: number };
  } catch {
    throw new Error("O Microsoft Graph devolveu um token inválido.");
  }
  if (!json.access_token) throw new Error("O Microsoft Graph não devolveu access_token.");
  tokenCache = {
    key,
    accessToken: json.access_token,
    expiresAt: Date.now() + Math.max(60, Number(json.expires_in) || 3600) * 1000,
  };
  return json.access_token;
}

function htmlDe(texto: string): string {
  const corpo = texto
    .replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char)
    .replace(/https:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`)
    .replace(/\n/g, "<br>");
  return `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">${corpo}</div>`;
}

export async function enviarEmail(input: { para: string; assunto: string; texto: string }): Promise<void> {
  const config = configGraph();
  const payload = {
    message: {
      subject: input.assunto,
      body: { contentType: "HTML", content: htmlDe(input.texto) },
      toRecipients: [{ emailAddress: { address: input.para } }],
      from: { emailAddress: { address: config.fromEmail, name: config.fromName } },
    },
    saveToSentItems: true,
  };
  const postar = (token: string) =>
    fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.fromEmail)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  let token = await tokenGraph(config);
  let response = await postar(token);
  if (response.status === 202 || response.status === 200) return;
  const firstBody = await response.text();
  console.error("[Graph sendMail]", response.status, codigoGraph(firstBody) || aadsts(firstBody) || "sem_codigo");
  if (response.status === 401 || response.status === 403) {
    tokenCache = null;
    token = await tokenGraph(config);
    response = await postar(token);
    if (response.status === 202 || response.status === 200) return;
    throw new Error(graphFriendlyError(response.status, await response.text()));
  }
  throw new Error(graphFriendlyError(response.status, firstBody));
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}

export function hashesIguais(esquerda: string, direita: string): boolean {
  const a = Buffer.from(esquerda);
  const b = Buffer.from(direita);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
