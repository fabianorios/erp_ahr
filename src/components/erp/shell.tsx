import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

type IconeNome = "inicio" | "cadastros" | "financeiro" | "pessoal" | "propostas" | "contratos" | "consulta" | "fluxo" | "margem";
type Item = { href: string; rotulo: string };
type Entrada =
  | { tipo: "link"; href: string; rotulo: string; icone: IconeNome }
  | { tipo: "grupo"; rotulo: string; icone: IconeNome; itens: Item[] };

const menu: Entrada[] = [
  { tipo: "link", href: "/", rotulo: "Início", icone: "inicio" },
  {
    tipo: "grupo",
    rotulo: "Cadastros",
    icone: "cadastros",
    itens: [
      { href: "/clientes", rotulo: "Clientes" },
      { href: "/centros", rotulo: "Centros" },
    ],
  },
  {
    tipo: "grupo",
    rotulo: "Financeiro",
    icone: "financeiro",
    itens: [
      { href: "/despesas", rotulo: "Contas a pagar" },
      { href: "/contas", rotulo: "Contas a receber" },
    ],
  },
  { tipo: "link", href: "/pessoal", rotulo: "Pessoal", icone: "pessoal" },
  { tipo: "link", href: "/propostas", rotulo: "Propostas", icone: "propostas" },
  { tipo: "link", href: "/contratos", rotulo: "Contratos", icone: "contratos" },
  { tipo: "link", href: "/contas/consulta", rotulo: "Consulta de títulos a receber", icone: "consulta" },
  { tipo: "link", href: "/fluxo", rotulo: "Fluxo", icone: "fluxo" },
  { tipo: "link", href: "/margem", rotulo: "Margem", icone: "margem" },
];

export function itemAtivo(href: string, caminho: string): boolean {
  if (href === "/") return caminho === "/";
  if (href === "/contas") return caminho === "/contas" || /^\/contas\/(?!consulta(?:\/|$))[^/]+$/.test(caminho);
  return caminho === href || caminho.startsWith(`${href}/`);
}

export function Shell({
  email,
  papel,
  onSair,
  children,
}: {
  email: string;
  papel: string;
  onSair: () => void;
  children: ReactNode;
}) {
  const caminho = useLocation().pathname;
  const [menuAberto, setMenuAberto] = useState(false);
  const [grupos, setGrupos] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setMenuAberto(false);
  }, [caminho]);

  useEffect(() => {
    setGrupos((atual) => {
      const proximo = { ...atual };
      let mudou = false;
      for (const entrada of menu) {
        if (entrada.tipo === "grupo" && entrada.itens.some((item) => itemAtivo(item.href, caminho)) && !proximo[entrada.rotulo]) {
          proximo[entrada.rotulo] = true;
          mudou = true;
        }
      }
      return mudou ? proximo : atual;
    });
  }, [caminho]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {menuAberto && (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMenuAberto(false)}
        />
      )}
      <div className="md:flex md:min-h-screen">
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-[#003366] text-white transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 ${menuAberto ? "translate-x-0" : "-translate-x-full"}`}
        >
          <div className="border-b border-white/10 px-4 py-4">
            <Marca />
          </div>
          <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="Menu principal">
            <p className="mb-2 px-2 text-xs font-semibold text-white/40">MENU PRINCIPAL</p>
            <ul className="flex flex-col gap-1">
              {menu.map((entrada) =>
                entrada.tipo === "link" ? (
                  <li key={entrada.href}>
                    <LinkMenu href={entrada.href} rotulo={entrada.rotulo} icone={entrada.icone} caminho={caminho} />
                  </li>
                ) : (
                  <li key={entrada.rotulo}>
                    <GrupoMenu
                      entrada={entrada}
                      caminho={caminho}
                      aberto={Boolean(grupos[entrada.rotulo])}
                      onToggle={() => setGrupos((atual) => ({ ...atual, [entrada.rotulo]: !atual[entrada.rotulo] }))}
                    />
                  </li>
                ),
              )}
            </ul>
          </nav>
          <div className="border-t border-white/10 p-4">
            <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-2">
              <div className="truncate text-xs font-medium text-white">{email}</div>
              {papel && <div className="text-[10px] font-bold uppercase text-white/40">{papel}</div>}
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-[#003366] px-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="rounded-md p-2 text-white hover:bg-white/10 md:hidden"
                aria-label="Abrir menu"
                onClick={() => setMenuAberto(true)}
              >
                <Icone nome="painel" />
              </button>
              <div className="text-sm font-bold tracking-tight text-white">
                ERP AHR
                <span className="ml-2 hidden font-normal text-white/50 sm:inline">| AHR BRASIL</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden flex-col items-end leading-tight md:flex">
                <span className="max-w-[150px] truncate text-xs font-medium text-white">{email}</span>
                <span className="text-[10px] font-bold uppercase tracking-tight text-white/50">Conectado</span>
              </div>
              <button type="button" className="text-[10px] text-white/70 hover:text-white hover:underline" onClick={onSair}>
                Sair
              </button>
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 text-sm text-white">
                {(email.trim().charAt(0) || "A").toUpperCase()}
              </div>
            </div>
          </header>
          <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

export function Marca() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <div className="flex h-8 w-8 items-center justify-center rounded bg-[#00A896] text-white">
        <Icone nome="documento" />
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-bold uppercase tracking-tighter text-white">ERP AHR</span>
        <span className="text-[10px] leading-none text-white/90">AHR BRASIL</span>
      </div>
    </div>
  );
}

export function TelaAcesso({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-card-foreground shadow">
        <div className="mb-4 inline-flex rounded-md bg-[#003366] px-3 py-2">
          <Marca />
        </div>
        <h1 className="text-2xl font-semibold">{titulo}</h1>
        <div className="mt-2 text-sm text-muted-foreground">{children}</div>
      </div>
    </main>
  );
}

function LinkMenu({ href, rotulo, icone, caminho }: { href: string; rotulo: string; icone: IconeNome; caminho: string }) {
  const ativo = itemAtivo(href, caminho);
  return (
    <Link to={href} className={classeItem(ativo)} aria-current={ativo ? "page" : undefined}>
      <Icone nome={icone} />
      <span className="truncate">{rotulo}</span>
    </Link>
  );
}

function GrupoMenu({
  entrada,
  caminho,
  aberto,
  onToggle,
}: {
  entrada: Extract<Entrada, { tipo: "grupo" }>;
  caminho: string;
  aberto: boolean;
  onToggle: () => void;
}) {
  const ativo = entrada.itens.some((item) => itemAtivo(item.href, caminho));
  return (
    <div>
      <button type="button" className={classeItem(ativo)} aria-expanded={aberto} onClick={onToggle}>
        <Icone nome={entrada.icone} />
        <span className="truncate">{entrada.rotulo}</span>
        <Icone nome="chevron" className={`ml-auto transition-transform ${aberto ? "rotate-90" : ""}`} />
      </button>
      {aberto && (
        <ul className="ml-4 mt-1 flex flex-col gap-1 border-l border-white/10 px-2.5 py-0.5">
          {entrada.itens.map((item) => {
            const subAtivo = itemAtivo(item.href, caminho);
            return (
              <li key={item.href}>
                <Link
                  to={item.href}
                  className={`flex h-7 items-center gap-2 rounded-md px-2 text-xs ${subAtivo ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/10 hover:text-white"}`}
                  aria-current={subAtivo ? "page" : undefined}
                >
                  <span className="h-1 w-1 shrink-0 rounded-full bg-white/20" />
                  <span className="truncate">{item.rotulo}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function classeItem(ativo: boolean): string {
  return `flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm ${ativo ? "bg-[#00A896] font-medium text-white" : "text-white/70 hover:bg-white/10 hover:text-white"}`;
}

function Icone({ nome, className }: { nome: IconeNome | "documento" | "painel" | "chevron"; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 ${className ?? ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {tracos(nome)}
    </svg>
  );
}

function tracos(nome: IconeNome | "documento" | "painel" | "chevron"): ReactNode {
  switch (nome) {
    case "inicio":
      return <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />;
    case "cadastros":
      return (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="3" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a3 3 0 0 1 0 5.75" />
        </>
      );
    case "financeiro":
      return (
        <>
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10h18" />
        </>
      );
    case "pessoal":
      return (
        <>
          <circle cx="12" cy="8" r="3" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </>
      );
    case "propostas":
      return (
        <>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </>
      );
    case "contratos":
      return (
        <>
          <path d="M8 3h8l4 4v14H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
          <path d="M8 13h8M8 17h5" />
        </>
      );
    case "consulta":
      return (
        <>
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-3.5-3.5" />
        </>
      );
    case "fluxo":
      return <path d="M4 19V5M4 19h16M7 15l4-4 3 3 5-6" />;
    case "margem":
      return <path d="M19 5 5 19M7.5 7.5h.01M16.5 16.5h.01" />;
    case "documento":
      return (
        <>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5M8 13h8M8 17h5" />
        </>
      );
    case "painel":
      return (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
        </>
      );
    case "chevron":
      return <path d="m9 18 6-6-6-6" />;
  }
}
