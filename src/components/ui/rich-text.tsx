import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

const CORES_AHR = ["#003366", "#00A896", "#B8860B", "#B91C1C", "#111827"];

/** O mesmo conjunto do editor da Gestão: negrito, listas, títulos, cores, links, tabelas, imagem e limpar. */
export function isRichHtml(value?: string | null): boolean {
  return !!value && /<\/?(p|br|ul|ol|li|strong|em|u|b|i|h[1-6]|span|a|table|div|img|font)\b/i.test(value);
}

function imgSrcFromTag(tag: string): string {
  const src = tag.match(/src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return (src?.[1] || src?.[2] || src?.[3] || "").trim().replace(/&amp;/g, "&");
}

function normalizeImgTag(tag: string): string {
  const url = imgSrcFromTag(tag);
  const ok = /^https?:\/\//i.test(url) || /^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(url);
  if (!ok) return "";
  const altMatch = tag.match(/alt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const alt = (altMatch?.[1] || altMatch?.[2] || "Imagem").replace(/"/g, "");
  const src = url.replace(/&/g, "&amp;");
  const largura = tag.match(/data-width\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.[1];
  const extra = largura ? ` data-width="${largura.replace(/"/g, "")}"` : "";
  return `<img src="${src}" alt="${alt}"${extra} />`;
}

export function sanitizeRichHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/\sdata-(?:table-active|new-table)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/<img\b[^>]*>/gi, normalizeImgTag);
}

export function RichText({ value, className }: { value?: string | null; className?: string }) {
  if (!value) return null;
  if (!isRichHtml(value)) return <div className={`whitespace-pre-wrap ${className ?? ""}`}>{value}</div>;
  return <div className={`rich-content ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(value) }} />;
}

function Icone({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const botao = "inline-flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-200 hover:text-[#003366] disabled:opacity-40";
const botaoTabela = "inline-flex h-7 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200 hover:text-[#003366]";

function celulaDaSelecao(raiz: HTMLElement): HTMLTableCellElement | null {
  const selecao = window.getSelection();
  if (!selecao || selecao.rangeCount === 0) return null;
  const no = selecao.anchorNode;
  if (!no || !raiz.contains(no)) return null;
  const elemento = no instanceof Element ? no : no.parentElement;
  const celula = elemento?.closest("td, th");
  if (!(celula instanceof HTMLTableCellElement) || !raiz.contains(celula)) return null;
  return celula;
}

function focar(no: HTMLElement) {
  const faixa = document.createRange();
  faixa.selectNodeContents(no);
  faixa.collapse(true);
  const selecao = window.getSelection();
  selecao?.removeAllRanges();
  selecao?.addRange(faixa);
}

function celulaVazia(tag: "td" | "th"): HTMLTableCellElement {
  const celula = document.createElement(tag);
  if (tag === "th") celula.textContent = "Coluna";
  else celula.innerHTML = "<br>";
  return celula;
}

function inserirLinha(celula: HTMLTableCellElement, onde: "acima" | "abaixo"): HTMLTableCellElement | null {
  const linha = celula.parentElement;
  if (!(linha instanceof HTMLTableRowElement) || linha.cells.length === 0) return null;
  const nova = document.createElement("tr");
  for (let i = 0; i < linha.cells.length; i += 1) nova.appendChild(celulaVazia("td"));
  if (onde === "acima") linha.before(nova);
  else linha.after(nova);
  return nova.cells[Math.min(celula.cellIndex, nova.cells.length - 1)] ?? null;
}

function inserirColuna(celula: HTMLTableCellElement, onde: "esquerda" | "direita"): HTMLTableCellElement | null {
  const tabela = celula.closest("table");
  const linha = celula.parentElement;
  if (!tabela || !(linha instanceof HTMLTableRowElement)) return null;
  const em = celula.cellIndex + (onde === "direita" ? 1 : 0);
  let foco: HTMLTableCellElement | null = null;
  for (const atual of Array.from(tabela.rows)) {
    const cabecalho = atual.cells.length > 0 && Array.from(atual.cells).every((item) => item.tagName === "TH");
    const criada = celulaVazia(cabecalho ? "th" : "td");
    const referencia = atual.cells[em] ?? null;
    if (referencia) atual.insertBefore(criada, referencia);
    else atual.appendChild(criada);
    if (atual === linha) foco = criada;
  }
  return foco;
}

function trocarTabelaPorParagrafo(tabela: HTMLTableElement): HTMLElement {
  const paragrafo = document.createElement("p");
  paragrafo.innerHTML = "<br>";
  tabela.replaceWith(paragrafo);
  return paragrafo;
}

function excluirLinha(celula: HTMLTableCellElement): HTMLElement | null {
  const linha = celula.parentElement;
  const tabela = celula.closest("table");
  if (!(linha instanceof HTMLTableRowElement) || !tabela) return null;
  const vizinha = (linha.nextElementSibling instanceof HTMLTableRowElement ? linha.nextElementSibling : linha.previousElementSibling) as HTMLTableRowElement | null;
  const indice = celula.cellIndex;
  if (tabela.rows.length <= 1) return trocarTabelaPorParagrafo(tabela);
  linha.remove();
  const alvo = vizinha && tabela.contains(vizinha) ? vizinha : tabela.rows[0];
  return alvo?.cells[Math.min(indice, Math.max(0, alvo.cells.length - 1))] ?? null;
}

function excluirColuna(celula: HTMLTableCellElement): HTMLElement | null {
  const tabela = celula.closest("table");
  const linha = celula.parentElement;
  if (!tabela || !(linha instanceof HTMLTableRowElement)) return null;
  const indice = celula.cellIndex;
  const unica = Array.from(tabela.rows).every((item) => item.cells.length <= 1);
  if (unica) return trocarTabelaPorParagrafo(tabela);
  for (const atual of Array.from(tabela.rows)) atual.cells[indice]?.remove();
  const alvo = tabela.contains(linha) ? linha : tabela.rows[0];
  return alvo?.cells[Math.min(indice, Math.max(0, (alvo?.cells.length ?? 1) - 1))] ?? null;
}

function celulaVizinha(celula: HTMLTableCellElement, direcao: "proxima" | "anterior"): { cell: HTMLElement; inserted: boolean } | null {
  const linha = celula.parentElement;
  if (!(linha instanceof HTMLTableRowElement)) return null;
  if (direcao === "proxima") {
    const proxima = linha.cells[celula.cellIndex + 1];
    if (proxima) return { cell: proxima, inserted: false };
    const linhaSeguinte = linha.nextElementSibling;
    if (linhaSeguinte instanceof HTMLTableRowElement && linhaSeguinte.cells[0]) return { cell: linhaSeguinte.cells[0], inserted: false };
    const criada = inserirLinha(celula, "abaixo");
    return criada ? { cell: criada, inserted: true } : null;
  }
  const anterior = linha.cells[celula.cellIndex - 1];
  if (anterior) return { cell: anterior, inserted: false };
  const linhaAnterior = linha.previousElementSibling;
  if (linhaAnterior instanceof HTMLTableRowElement) {
    const ultima = linhaAnterior.cells[linhaAnterior.cells.length - 1];
    if (ultima) return { cell: ultima, inserted: false };
  }
  return null;
}

async function arquivoParaDataUrl(arquivo: File): Promise<string> {
  if (arquivo.type === "image/png" || arquivo.type === "image/jpeg" || arquivo.type === "image/gif") {
    return await lerArquivo(arquivo);
  }
  const bitmap = await createImageBitmap(arquivo);
  const tela = document.createElement("canvas");
  tela.width = bitmap.width;
  tela.height = bitmap.height;
  tela.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return tela.toDataURL("image/png");
}

function lerArquivo(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result ?? ""));
    leitor.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    leitor.readAsDataURL(arquivo);
  });
}

async function capturarTela(): Promise<File> {
  const fluxo = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement("video");
    video.srcObject = fluxo;
    await video.play();
    const tela = document.createElement("canvas");
    tela.width = video.videoWidth || 1280;
    tela.height = video.videoHeight || 720;
    tela.getContext("2d")?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      tela.toBlob((item) => (item ? resolve(item) : reject(new Error("Não foi possível gerar a imagem."))), "image/png");
    });
    return new File([blob], `captura-${Date.now()}.png`, { type: "image/png" });
  } finally {
    fluxo.getTracks().forEach((faixa) => faixa.stop());
  }
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  disabled,
  minHeight = 140,
}: {
  value?: string | null;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const ultimo = useRef("");
  const celulaRef = useRef<HTMLTableCellElement | null>(null);
  const [focado, setFocado] = useState(false);
  const [naTabela, setNaTabela] = useState(false);
  const [ampliado, setAmpliado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    const chegando = value ?? "";
    if (chegando === ultimo.current) return;
    el.innerHTML = isRichHtml(chegando)
      ? sanitizeRichHtml(chegando)
      : chegando
        ? `<p>${chegando.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`
        : "";
    ultimo.current = chegando;
  }, [value, disabled]);

  const emitir = () => {
    const raiz = ref.current;
    const ativa = raiz?.querySelector("[data-table-active]");
    ativa?.removeAttribute("data-table-active");
    const html = raiz?.innerHTML ?? "";
    if (ativa instanceof HTMLElement) ativa.setAttribute("data-table-active", "1");
    const vazio = html.replace(/<br\s*\/?>|&nbsp;|\s|<p>|<\/p>|<div>|<\/div>/gi, "") === "";
    const proximo = vazio ? "" : sanitizeRichHtml(html);
    ultimo.current = proximo;
    onChange(proximo);
  };

  const executar = (comando: string, argumento?: string) => {
    ref.current?.focus();
    document.execCommand(comando, false, argumento);
    emitir();
  };

  const editarTabela = (acao: (celula: HTMLTableCellElement) => HTMLElement | null) => {
    const raiz = ref.current;
    if (!raiz) return;
    const selecionada = celulaDaSelecao(raiz);
    const lembrada = celulaRef.current;
    const celula = selecionada ?? (lembrada && raiz.contains(lembrada) ? lembrada : null);
    if (!celula) return;
    raiz.focus();
    const alvo = acao(celula);
    if (alvo && raiz.contains(alvo)) {
      focar(alvo);
      celulaRef.current = alvo instanceof HTMLTableCellElement ? alvo : null;
      setNaTabela(alvo instanceof HTMLTableCellElement);
    } else {
      celulaRef.current = null;
      setNaTabela(false);
    }
    emitir();
  };

  const inserirTabela = () => {
    const marca = `t${Date.now()}`;
    const html =
      `<table data-new-table="${marca}"><tbody><tr><th>Coluna 1</th><th>Coluna 2</th></tr>` +
      "<tr><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>";
    ref.current?.focus();
    document.execCommand("insertHTML", false, html);
    const tabela = ref.current?.querySelector(`table[data-new-table="${marca}"]`);
    tabela?.removeAttribute("data-new-table");
    const celula = tabela?.querySelector("td");
    if (celula instanceof HTMLTableCellElement) {
      focar(celula);
      celulaRef.current = celula;
      celula.setAttribute("data-table-active", "1");
      setNaTabela(true);
    }
    emitir();
  };

  const inserirArquivos = async (arquivos: File[]) => {
    const imagens = arquivos.filter((arquivo) => arquivo.type.startsWith("image/"));
    if (!imagens.length) return;
    setEnviando(true);
    try {
      ref.current?.focus();
      for (const arquivo of imagens) {
        if (arquivo.size > 1_200_000) throw new Error("A imagem passa de 1,2 MB.");
        const src = await arquivoParaDataUrl(arquivo);
        document.execCommand("insertHTML", false, `<p><img src="${src}" alt="Imagem" /></p>`);
      }
      emitir();
      toast.success(imagens.length > 1 ? "Imagens inseridas." : "Imagem inserida.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível inserir a imagem.");
    } finally {
      setEnviando(false);
    }
  };

  useEffect(() => {
    const raiz = ref.current;
    if (!raiz || disabled) return;
    const sincronizar = () => {
      const celula = celulaDaSelecao(raiz);
      celulaRef.current = celula;
      setNaTabela((atual) => (atual === !!celula ? atual : !!celula));
      const anterior = raiz.querySelector("[data-table-active]");
      if (anterior === celula) return;
      anterior?.removeAttribute("data-table-active");
      celula?.setAttribute("data-table-active", "1");
    };
    document.addEventListener("selectionchange", sincronizar);
    return () => {
      document.removeEventListener("selectionchange", sincronizar);
      raiz.querySelectorAll("[data-table-active]").forEach((no) => no.removeAttribute("data-table-active"));
    };
  }, [disabled]);

  if (disabled) {
    return (
      <div className="rounded-md border border-input bg-muted px-3 py-2 text-sm">
        {value ? <RichText value={value} /> : <span className="text-muted-foreground">{placeholder}</span>}
      </div>
    );
  }

  return (
    <div className={`rounded-md border border-input bg-card ${focado ? "ring-2 ring-[#00A896]/40" : ""}`}>
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-slate-50 px-1.5 py-1">
        <button type="button" className={botao} title="Negrito" onMouseDown={(e) => e.preventDefault()} onClick={() => executar("bold")}><Icone><path d="M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z" /></Icone></button>
        <button type="button" className={botao} title="Itálico" onMouseDown={(e) => e.preventDefault()} onClick={() => executar("italic")}><Icone><path d="M19 4h-9M14 20H5M15 4 9 20" /></Icone></button>
        <button type="button" className={botao} title="Sublinhado" onMouseDown={(e) => e.preventDefault()} onClick={() => executar("underline")}><Icone><path d="M6 4v6a6 6 0 0 0 12 0V4M4 20h16" /></Icone></button>
        <span className="mx-1 h-4 w-px bg-slate-300" />
        <button type="button" className={botao} title="Lista com marcadores" onMouseDown={(e) => e.preventDefault()} onClick={() => executar("insertUnorderedList")}><Icone><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></Icone></button>
        <button type="button" className={botao} title="Lista numerada" onMouseDown={(e) => e.preventDefault()} onClick={() => executar("insertOrderedList")}><Icone><path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" /></Icone></button>
        <span className="mx-1 h-4 w-px bg-slate-300" />
        <button type="button" className={botao} title="Título" onMouseDown={(e) => e.preventDefault()} onClick={() => executar("formatBlock", "<h3>")}><Icone><path d="M4 12h8M4 18V6M12 18V6M17 12l3-2v8" /></Icone></button>
        <button type="button" className={botao} title="Subtítulo" onMouseDown={(e) => e.preventDefault()} onClick={() => executar("formatBlock", "<h4>")}><Icone><path d="M4 12h8M4 18V6M12 18V6M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1" /></Icone></button>
        <span className="mx-1 h-4 w-px bg-slate-300" />
        {CORES_AHR.map((cor) => (
          <button
            key={cor}
            type="button"
            title={`Cor do texto ${cor}`}
            className="h-4 w-4 rounded-full border border-white shadow ring-1 ring-slate-300"
            style={{ backgroundColor: cor }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => executar("foreColor", cor)}
          />
        ))}
        <span className="mx-1 h-4 w-px bg-slate-300" />
        <button type="button" className={botao} title="Inserir link" onMouseDown={(e) => e.preventDefault()} onClick={() => { const url = window.prompt("Endereço do link (https://...)"); if (url) executar("createLink", url); }}><Icone><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></Icone></button>
        <button type="button" className={botao} title="Inserir tabela" onMouseDown={(e) => e.preventDefault()} onClick={inserirTabela}><Icone><path d="M12 3v18M3 9h18M3 15h18M3 3h18v18H3z" /></Icone></button>
        <button
          type="button"
          className={botao}
          title="Capturar tela e inserir no texto"
          disabled={enviando}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            void capturarTela()
              .then((arquivo) => inserirArquivos([arquivo]))
              .catch((error: unknown) => {
                if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError")) return;
                toast.error(error instanceof Error ? error.message : "Não foi possível capturar a tela.");
              });
          }}
        >
          <Icone><path d="M8 21h8M12 17v4M4 3h16v12H4z" /></Icone>
        </button>
        <button type="button" className={botao} title="Inserir imagem salva" disabled={enviando} onMouseDown={(e) => e.preventDefault()} onClick={() => arquivoRef.current?.click()}><Icone><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></Icone></button>
        <button type="button" className={botao} title="Limpar formatação" onMouseDown={(e) => e.preventDefault()} onClick={() => executar("removeFormat")}><Icone><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21M22 21H7M5 11l9 9" /></Icone></button>
        <button type="button" className={`${botao} ml-auto`} title={ampliado ? "Reduzir campo" : "Ampliar campo"} onMouseDown={(e) => e.preventDefault()} onClick={() => setAmpliado((valor) => !valor)}>
          <Icone><path d={ampliado ? "M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" : "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"} /></Icone>
        </button>
      </div>
      {naTabela ? (
        <div className="flex flex-wrap items-center gap-0.5 border-b bg-slate-50 px-1.5 py-1">
          <span className="mr-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-[#003366]">Tabela</span>
          <button type="button" className={botaoTabela} title="Inserir linha acima" onMouseDown={(e) => e.preventDefault()} onClick={() => editarTabela((celula) => inserirLinha(celula, "acima"))}>Linha acima</button>
          <button type="button" className={botaoTabela} title="Inserir linha abaixo" onMouseDown={(e) => e.preventDefault()} onClick={() => editarTabela((celula) => inserirLinha(celula, "abaixo"))}>Linha abaixo</button>
          <button type="button" className={botaoTabela} title="Inserir coluna à esquerda" onMouseDown={(e) => e.preventDefault()} onClick={() => editarTabela((celula) => inserirColuna(celula, "esquerda"))}>Coluna à esquerda</button>
          <button type="button" className={botaoTabela} title="Inserir coluna à direita" onMouseDown={(e) => e.preventDefault()} onClick={() => editarTabela((celula) => inserirColuna(celula, "direita"))}>Coluna à direita</button>
          <button type="button" className={`${botaoTabela} text-[#B91C1C]`} title="Excluir linha" onMouseDown={(e) => e.preventDefault()} onClick={() => editarTabela(excluirLinha)}>Excluir linha</button>
          <button type="button" className={`${botaoTabela} text-[#B91C1C]`} title="Excluir coluna" onMouseDown={(e) => e.preventDefault()} onClick={() => editarTabela(excluirColuna)}>Excluir coluna</button>
        </div>
      ) : null}
      <input
        ref={arquivoRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(evento) => {
          void inserirArquivos(Array.from(evento.target.files ?? []));
          evento.target.value = "";
        }}
      />
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        className="rich-content rich-editor w-full px-3 py-2 text-sm outline-none"
        style={{ minHeight: ampliado ? Math.max(minHeight, 420) : minHeight, maxHeight: ampliado ? undefined : 320, overflowY: ampliado ? "visible" : "auto" }}
        onInput={emitir}
        onKeyDown={(evento) => {
          if (evento.key !== "Tab") return;
          const raiz = ref.current;
          if (!raiz) return;
          const celula = celulaDaSelecao(raiz);
          if (!celula) return;
          const movida = celulaVizinha(celula, evento.shiftKey ? "anterior" : "proxima");
          if (!movida) return;
          evento.preventDefault();
          focar(movida.cell);
          if (movida.inserted) emitir();
        }}
        onBlur={() => {
          setFocado(false);
          emitir();
        }}
        onFocus={() => setFocado(true)}
        onDragOver={(evento) => {
          if (Array.from(evento.dataTransfer.types).includes("Files")) evento.preventDefault();
        }}
        onDrop={(evento) => {
          const arquivos = Array.from(evento.dataTransfer.files).filter((arquivo) => arquivo.type.startsWith("image/"));
          if (!arquivos.length) return;
          evento.preventDefault();
          void inserirArquivos(arquivos);
        }}
        onPaste={(evento) => {
          const imagens = Array.from(evento.clipboardData.files).filter((arquivo) => arquivo.type.startsWith("image/"));
          if (imagens.length) {
            evento.preventDefault();
            void inserirArquivos(imagens);
            return;
          }
          evento.preventDefault();
          document.execCommand("insertText", false, evento.clipboardData.getData("text/plain"));
          emitir();
        }}
      />
    </div>
  );
}
