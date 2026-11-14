import { useEffect, useState, type FormEvent } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase, supabaseConfigurado } from "@/integrations/supabase/client";
import { AuthProvider } from "@/lib/auth-context";
import { FinanceiroInicio } from "@/routes/inicio";
import { PessoasPage } from "@/routes/pessoas";
import { CentrosPage } from "@/routes/centros";
import { DespesasPage } from "@/routes/despesas";
import { PessoalPage } from "@/routes/pessoal";
import { PropostasPage } from "@/routes/propostas";
import { PropostaPage } from "@/routes/proposta";
import { ContratosPage } from "@/routes/contratos";
import { ContratoPage } from "@/routes/contrato";
import { ContasPage } from "@/routes/contas";
import { AssinarPage } from "@/routes/assinar";
import { FluxoPage } from "@/routes/fluxo";
import { MargemPage } from "@/routes/margem";
import { Shell, TelaAcesso } from "@/components/erp/shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function App() {
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
      <TelaAcesso titulo="ERP AHR">
        Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente deste ERP. A service role não entra no navegador.
      </TelaAcesso>
    );
  }

  if (!pronto) return <p className="p-8 text-sm text-muted-foreground">Carregando…</p>;
  if (!sessao) return <Entrada />;
  if (!papel) {
    return (
      <TelaAcesso titulo="ERP AHR">
        {avisoPapel || "Conferindo o papel de equipe…"}
      </TelaAcesso>
    );
  }

  return (
    <AuthProvider value={{ canEdit: true, email: sessao.user.email ?? "" }}>
      <Shell email={sessao.user.email ?? ""} papel={papel} onSair={() => void supabase?.auth.signOut()}>
        <Rotas />
      </Shell>
    </AuthProvider>
  );
}

function Rotas() {
  return (
    <Routes>
      <Route path="/" element={<FinanceiroInicio />} />
      <Route path="/pessoas" element={<PessoasPage />} />
      <Route path="/clientes" element={<Navigate to="/pessoas" replace />} />
      <Route path="/centros" element={<CentrosPage />} />
      <Route path="/despesas" element={<DespesasPage />} />
      <Route path="/despesas/novo" element={<DespesasPage />} />
      <Route path="/despesas/:id/editar" element={<DespesasPage />} />
      <Route path="/despesas/:id" element={<DespesasPage />} />
      <Route path="/pessoal" element={<PessoalPage />} />
      <Route path="/propostas" element={<PropostasPage />} />
      <Route path="/propostas/:id" element={<PropostaPage />} />
      <Route path="/contratos" element={<ContratosPage />} />
      <Route path="/contratos/:id" element={<ContratoPage />} />
      <Route path="/contas" element={<ContasPage />} />
      <Route path="/contas/consulta" element={<Navigate to="/contas" replace />} />
      <Route path="/contas/novo" element={<ContasPage />} />
      <Route path="/contas/:id/editar" element={<ContasPage />} />
      <Route path="/contas/:id" element={<ContasPage />} />
      <Route path="/fluxo" element={<FluxoPage />} />
      <Route path="/margem" element={<MargemPage />} />
    </Routes>
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
    <TelaAcesso titulo="ERP AHR">
      <p>O financeiro aceita admin, consultor, editor ou beta_tester. O primeiro usuário autenticado recebe admin.</p>
      <form className="mt-6 space-y-3" onSubmit={enviar}>
        <label className="block text-sm text-foreground">
          E-mail
          <Input className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block text-sm text-foreground">
          Senha
          <Input className="mt-1" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </label>
        <Button type="submit">{modo === "entrar" ? "Entrar" : "Criar conta"}</Button>
      </form>
      <button className="mt-3 text-sm text-muted-foreground" type="button" onClick={() => setModo(modo === "entrar" ? "criar" : "entrar")}>
        {modo === "entrar" ? "Ainda não tenho conta" : "Já tenho conta"}
      </button>
    </TelaAcesso>
  );
}
