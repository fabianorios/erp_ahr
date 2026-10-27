import { useEffect, useState, type FormEvent } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase, supabaseConfigurado } from "@/integrations/supabase/client";
import { AuthProvider } from "@/lib/auth-context";
import { FinanceiroInicio } from "@/routes/inicio";
import { ClientesPage } from "@/routes/clientes";
import { CentrosPage } from "@/routes/centros";
import { DespesasPage } from "@/routes/despesas";
import { PessoalPage } from "@/routes/pessoal";
import { PropostasPage } from "@/routes/propostas";
import { PropostaPage } from "@/routes/proposta";
import { ContratosPage } from "@/routes/contratos";
import { ContratoPage } from "@/routes/contrato";
import { ContasPage } from "@/routes/contas";
import { ConsultaPage } from "@/routes/consulta";
import { AssinarPage } from "@/routes/assinar";
import { FluxoPage } from "@/routes/fluxo";
import { MargemPage } from "@/routes/margem";

const menu = [
  ["/", "Início"],
  ["/clientes", "Clientes"],
  ["/centros", "Centros"],
  ["/despesas", "Despesas"],
  ["/pessoal", "Pessoal"],
  ["/propostas", "Propostas"],
  ["/contratos", "Contratos"],
  ["/contas", "Manutenção de contas a receber"],
  ["/contas/consulta", "Consulta de títulos a receber"],
  ["/fluxo", "Fluxo"],
  ["/margem", "Margem"],
] as const;

export function App() {
  const caminho = useLocation().pathname;
  const [sessao, setSessao] = useState<Session | null>(null);
  const [pronto, setPronto] = useState(false);
  const [papel, setPapel] = useState("");
  const [avisoPapel, setAvisoPapel] = useState("");

  useEffect(() => {
    if (!supabase) {
      setPronto(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSessao(data.session);
      setPronto(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_evento, nova) => setSessao(nova));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!sessao) {
      setPapel("");
      setAvisoPapel("");
      return;
    }
    let ativo = true;
    fetch("/api/acesso", {
      method: "POST",
      headers: { Authorization: `Bearer ${sessao.access_token}` },
    })
      .then(async (resposta) => {
        const corpo = (await resposta.json().catch(() => ({}))) as { papel?: string; message?: string };
        if (!ativo) return;
        if (!resposta.ok) {
          setPapel("");
          setAvisoPapel(corpo.message ?? "Sem papel de equipe.");
          return;
        }
        setPapel(corpo.papel ?? "");
        setAvisoPapel("");
      })
      .catch(() => {
        if (ativo) setAvisoPapel("A API local de acesso não respondeu.");
      });
    return () => {
      ativo = false;
    };
  }, [sessao]);

  const publica = typeof window !== "undefined" && window.location.pathname.startsWith("/assinar");
  if (publica) {
    return (
      <Routes>
        <Route path="/assinar/:token" element={<AssinarPage />} />
        <Route path="*" element={<p className="p-8 text-sm">Link inválido.</p>} />
      </Routes>
    );
  }

  if (!supabaseConfigurado || !supabase) {
    return (
      <main className="mx-auto max-w-lg p-8">
        <h1 className="text-2xl font-semibold">ERP AHR</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente deste ERP. A service role não entra no navegador.
        </p>
      </main>
    );
  }

  if (!pronto) return <p className="p-8 text-sm text-muted-foreground">Carregando…</p>;
  if (!sessao) return <Entrada />;
  if (!papel) {
    return (
      <main className="mx-auto max-w-lg p-8">
        <h1 className="text-2xl font-semibold">ERP AHR</h1>
        <p className="mt-2 text-sm text-muted-foreground">{avisoPapel || "Conferindo o papel de equipe…"}</p>
      </main>
    );
  }

  return (
    <AuthProvider value={{ canEdit: true, email: sessao.user.email ?? "" }}>
      <div className="min-h-screen md:grid md:grid-cols-[14rem_1fr]">
        <aside className="border-b border-sidebar-border bg-sidebar p-4 text-sidebar-foreground md:border-b-0 md:border-r">
          <div className="mb-4 text-sm font-semibold">ERP AHR</div>
          <nav className="flex flex-wrap gap-2 md:grid">
            {menu.map(([href, rotulo]) => (
              <NavLink
                key={href}
                to={href}
                end={href === "/" || href === "/contas"}
                className={({ isActive }) => {
                  const ativo = href === "/contas"
                    ? caminho === "/contas" || /^\/contas\/(?!consulta$)[^/]+$/.test(caminho)
                    : isActive;
                  return `rounded-md px-2 py-1 text-sm ${ativo ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent"}`;
                }}
              >
                {rotulo}
              </NavLink>
            ))}
          </nav>
          <button
            className="mt-4 text-xs text-sidebar-foreground/80"
            onClick={() => void supabase?.auth.signOut()}
          >
            Sair
          </button>
        </aside>
        <main className="p-4 md:p-8">
          <Routes>
            <Route path="/" element={<FinanceiroInicio />} />
            <Route path="/clientes" element={<ClientesPage />} />
            <Route path="/centros" element={<CentrosPage />} />
            <Route path="/despesas" element={<DespesasPage />} />
            <Route path="/pessoal" element={<PessoalPage />} />
            <Route path="/propostas" element={<PropostasPage />} />
            <Route path="/propostas/:id" element={<PropostaPage />} />
            <Route path="/contratos" element={<ContratosPage />} />
            <Route path="/contratos/:id" element={<ContratoPage />} />
            <Route path="/contas" element={<ContasPage />} />
            <Route path="/contas/consulta" element={<ConsultaPage />} />
            <Route path="/contas/:id" element={<ContasPage />} />
            <Route path="/fluxo" element={<FluxoPage />} />
            <Route path="/margem" element={<MargemPage />} />
          </Routes>
        </main>
      </div>
    </AuthProvider>
  );
}

function Entrada() {
  const [modo, setModo] = useState<"entrar" | "criar">("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");

  async function enviar(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (modo === "entrar") {
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
      if (error) toast.error(error.message);
      return;
    }
    const { error } = await supabase.auth.signUp({ email, password: senha });
    if (error) toast.error(error.message);
    else toast.success("Conta criada. Se o projeto pede confirmação, abra o e-mail e depois entre.");
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">ERP AHR</h1>
      <p className="mt-1 text-sm text-muted-foreground">O financeiro aceita admin, consultor, editor ou beta_tester. O primeiro usuário autenticado recebe admin.</p>
      <form className="mt-6 space-y-3" onSubmit={enviar}>
        <label className="block text-sm">
          E-mail
          <input className="mt-1 w-full rounded-md border px-3 py-2" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block text-sm">
          Senha
          <input className="mt-1 w-full rounded-md border px-3 py-2" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </label>
        <button className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" type="submit">
          {modo === "entrar" ? "Entrar" : "Criar conta"}
        </button>
      </form>
      <button className="mt-3 text-sm text-muted-foreground" onClick={() => setModo(modo === "entrar" ? "criar" : "entrar")}>
        {modo === "entrar" ? "Ainda não tenho conta" : "Já tenho conta"}
      </button>
    </main>
  );
}
