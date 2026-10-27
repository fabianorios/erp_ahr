import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DomainError, validadeNoDocumento } from "../src/services/erp/domain.ts";

export type DadosPropostaDocx = {
  titulo: string;
  clienteNome: string;
  visaoGeral: string;
  escopo: string;
  responsabilidades: string;
  prazo: string;
  execucao: string;
  validade: string;
  formaPagamento: string;
  valorTotal: string;
  dataExtenso: string;
};

type Run = { text: string; bold: boolean; italic: boolean; underline: boolean; color: string; href: string };
type Para = { kind: "p"; level: "p" | "h3" | "h4" | "li"; marker: string; runs: Run[] };
type Image = { kind: "img"; bytes: Buffer; ext: "png" | "jpeg" | "gif"; cx: number; cy: number };
type Table = { kind: "table"; rows: { header: boolean; cells: Para[][] }[] };
type Block = Para | Image | Table;
type El = { type: "el"; tag: string; attrs: Record<string, string>; children: Node[] };
type TextNode = { type: "text"; text: string };
type Node = El | TextNode;
type Style = { bold: boolean; italic: boolean; underline: boolean; color: string; href: string };
type State = { runs: Run[]; level: Para["level"]; marker: string };

const VAZIO: Style = { bold: false, italic: false, underline: false, color: "", href: "" };
const MODELO = join(import.meta.dirname, "../templates/template-proposta-ahr.docx");

export function dataPropostaExtenso(agora = new Date()): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(agora);
}

export function nomeDemanda(titulo: string): string {
  const nome = titulo.trim();
  if (!nome) throw new DomainError("Informe o título da proposta.");
  return nome;
}

function xml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodificar(valor: string): string {
  return valor
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

function sanitizar(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

function parseAtributos(bruto: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let achou: RegExpExecArray | null;
  while ((achou = re.exec(bruto))) attrs[achou[1].toLowerCase()] = decodificar(achou[2] ?? achou[3] ?? achou[4] ?? "");
  return attrs;
}

function parseHtml(html: string): El {
  const raiz: El = { type: "el", tag: "div", attrs: {}, children: [] };
  const pilha: El[] = [raiz];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)(\s[^<>]*?)?\s*(\/?)>|([^<]+)/g;
  const vazios = new Set(["br", "img", "hr"]);
  let achou: RegExpExecArray | null;
  while ((achou = re.exec(html))) {
    if (achou[0].startsWith("<!--")) continue;
    if (achou[1]) {
      const tag = achou[1].toLowerCase();
      for (let i = pilha.length - 1; i > 0; i -= 1) {
        if (pilha[i].tag === tag) {
          pilha.length = i;
          break;
        }
      }
      continue;
    }
    if (achou[2]) {
      const tag = achou[2].toLowerCase();
      const el: El = { type: "el", tag, attrs: parseAtributos(achou[3] ?? ""), children: [] };
      pilha[pilha.length - 1].children.push(el);
      if (!achou[4] && !vazios.has(tag)) pilha.push(el);
      continue;
    }
    const texto = decodificar(achou[5] ?? "").replace(/\u00a0/g, " ");
    if (texto) pilha[pilha.length - 1].children.push({ type: "text", text: texto });
  }
  return raiz;
}

function corDe(el: El): string {
  const estilo = el.attrs.style ?? "";
  const hex = /(?:^|;)\s*color\s*:\s*#([0-9a-f]{3}|[0-9a-f]{6})/i.exec(estilo)?.[1] ?? "";
  if (hex) return hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const rgb = /(?:^|;)\s*color\s*:\s*rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(estilo);
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  const attr = (el.attrs.color ?? "").replace("#", "");
  if (/^[0-9a-f]{6}$/i.test(attr)) return attr;
  if (/^[0-9a-f]{3}$/i.test(attr)) return attr.split("").map((c) => c + c).join("");
  return "";
}

function hrefSeguro(valor: string | undefined): string {
  const href = (valor ?? "").trim();
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return href;
  return "";
}

function imagemDe(el: El): Image | null {
  const src = el.attrs.src ?? "";
  const cabeca = /^data:image\/(png|jpeg|jpg|gif);base64,/i.exec(src);
  if (!cabeca) return null;
  const ext = cabeca[1].toLowerCase() === "jpg" ? "jpeg" : (cabeca[1].toLowerCase() as Image["ext"]);
  const bytes = Buffer.from(src.slice(cabeca[0].length).replace(/\s/g, ""), "base64");
  if (bytes.length < 16 || bytes.length > 1_500_000) return null;
  const natural = dimensoes(bytes, ext);
  const pct = Math.max(1, Math.min(200, Number(el.attrs["data-width"] || "100") || 100));
  const cx = Math.round((15 * 360000 * pct) / 100);
  const cy = Math.max(1, Math.round((cx * natural.altura) / Math.max(1, natural.largura)));
  return { kind: "img", bytes, ext, cx, cy };
}

function dimensoes(bytes: Buffer, ext: Image["ext"]): { largura: number; altura: number } {
  if (ext === "png" && bytes.length >= 24) {
    return { largura: bytes.readUInt32BE(16) || 1, altura: bytes.readUInt32BE(20) || 1 };
  }
  if (ext === "gif" && bytes.length >= 10) {
    return { largura: bytes.readUInt16LE(6) || 1, altura: bytes.readUInt16LE(8) || 1 };
  }
  if (ext === "jpeg") {
    let i = 2;
    while (i < bytes.length - 8) {
      if (bytes[i] !== 0xff) break;
      const marca = bytes[i + 1];
      const tam = bytes.readUInt16BE(i + 2);
      if (marca === 0xc0 || marca === 0xc1 || marca === 0xc2) {
        return { altura: bytes.readUInt16BE(i + 5) || 1, largura: bytes.readUInt16BE(i + 7) || 1 };
      }
      i += 2 + tam;
    }
  }
  return { largura: 1, altura: 1 };
}

function flush(estado: State, saida: Block[]): void {
  const temTexto = estado.runs.some((run) => run.text.trim() !== "");
  if (!temTexto && !estado.marker) {
    estado.runs = [];
    estado.marker = "";
    estado.level = "p";
    return;
  }
  saida.push({ kind: "p", level: estado.level, marker: estado.marker, runs: estado.runs.length ? estado.runs : [{ ...VAZIO, text: "" }] });
  estado.runs = [];
  estado.marker = "";
  estado.level = "p";
}

function walk(nos: Node[], estilo: Style, estado: State, saida: Block[]): void {
  for (const no of nos) {
    if (no.type === "text") {
      if (no.text) estado.runs.push({ ...estilo, text: no.text });
      continue;
    }
    const tag = no.tag;
    if (tag === "br") {
      flush(estado, saida);
      continue;
    }
    if (tag === "strong" || tag === "b") {
      walk(no.children, { ...estilo, bold: true }, estado, saida);
      continue;
    }
    if (tag === "em" || tag === "i") {
      walk(no.children, { ...estilo, italic: true }, estado, saida);
      continue;
    }
    if (tag === "u") {
      walk(no.children, { ...estilo, underline: true }, estado, saida);
      continue;
    }
    if (tag === "span" || tag === "font") {
      walk(no.children, { ...estilo, color: corDe(no) || estilo.color }, estado, saida);
      continue;
    }
    if (tag === "a") {
      const href = hrefSeguro(no.attrs.href);
      walk(no.children, { ...estilo, href: href || estilo.href, underline: true, color: estilo.color || (href ? "00A896" : "") }, estado, saida);
      continue;
    }
    if (tag === "img") {
      flush(estado, saida);
      const imagem = imagemDe(no);
      if (imagem) saida.push(imagem);
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      flush(estado, saida);
      let n = 1;
      for (const filho of no.children) {
        if (filho.type !== "el" || filho.tag !== "li") continue;
        const item: State = { runs: [], level: "li", marker: tag === "ol" ? `${n}. ` : "• " };
        n += 1;
        walk(filho.children, estilo, item, saida);
        flush(item, saida);
      }
      continue;
    }
    if (tag === "table") {
      flush(estado, saida);
      const tabela = tabelaDe(no, estilo);
      if (tabela.rows.length) saida.push(tabela);
      continue;
    }
    if (tag === "h3" || tag === "h4") {
      flush(estado, saida);
      estado.level = tag;
      walk(no.children, { ...estilo, bold: true, color: estilo.color || "003366" }, estado, saida);
      flush(estado, saida);
      continue;
    }
    if (tag === "p" || tag === "div" || tag === "blockquote" || tag === "li") {
      if (estado.runs.length) flush(estado, saida);
      walk(no.children, estilo, estado, saida);
      flush(estado, saida);
      continue;
    }
    walk(no.children, estilo, estado, saida);
  }
}

function paragrafosDe(nos: Node[], estilo: Style): Para[] {
  const saida: Block[] = [];
  const estado: State = { runs: [], level: "p", marker: "" };
  walk(nos, estilo, estado, saida);
  flush(estado, saida);
  const paragrafos = saida.filter((bloco): bloco is Para => bloco.kind === "p");
  return paragrafos.length ? paragrafos : [{ kind: "p", level: "p", marker: "", runs: [{ ...VAZIO, text: "" }] }];
}

function tabelaDe(no: El, estilo: Style): Table {
  const rows: Table["rows"] = [];
  const visitar = (el: El) => {
    if (el.tag === "tr") {
      const celulas = el.children.filter((filho): filho is El => filho.type === "el" && (filho.tag === "td" || filho.tag === "th"));
      if (!celulas.length) return;
      rows.push({
        header: celulas.every((celula) => celula.tag === "th"),
        cells: celulas.map((celula) => paragrafosDe(celula.children, estilo)),
      });
      return;
    }
    for (const filho of el.children) if (filho.type === "el") visitar(filho);
  };
  visitar(no);
  return { kind: "table", rows };
}

export function htmlParaBlocos(html: string): Block[] {
  const raiz = parseHtml(sanitizar(html));
  const saida: Block[] = [];
  const estado: State = { runs: [], level: "p", marker: "" };
  walk(raiz.children, VAZIO, estado, saida);
  flush(estado, saida);
  return saida;
}

type ImagemPacote = { id: string; nome: string; bytes: Buffer };
type Pacote = { xml: string; imagens: ImagemPacote[]; links: { id: string; href: string }[] };

function blocoParaXml(blocos: Block[], proximo: { id: number; desenho: number }): Pacote {
  const imagens: Pacote["imagens"] = [];
  const links: Pacote["links"] = [];
  const partes: string[] = [];
  for (const bloco of blocos) {
    if (bloco.kind === "img") {
      proximo.id += 1;
      proximo.desenho += 1;
      const id = `rId${proximo.id}`;
      const nome = `proposta-${proximo.desenho}.${bloco.ext === "jpeg" ? "jpg" : bloco.ext}`;
      imagens.push({ id, nome, bytes: bloco.bytes });
      partes.push(desenhoXml(id, proximo.desenho, nome, bloco.cx, bloco.cy));
      continue;
    }
    if (bloco.kind === "table") {
      partes.push(tabelaXml(bloco, links, proximo));
      continue;
    }
    partes.push(paragrafoXml(bloco, links, proximo, false));
  }
  return { xml: partes.join(""), imagens, links };
}

function paragrafoXml(paragrafo: Para, links: Pacote["links"], proximo: { id: number }, cabecalho: boolean): string {
  const tamanho = paragrafo.level === "h3" ? "24" : "22";
  const recuo = paragrafo.level === "li" ? `<w:ind w:left="420" w:hanging="220"/>` : "";
  const runs = paragrafo.marker ? [{ ...VAZIO, text: paragrafo.marker }, ...paragrafo.runs] : paragrafo.runs;
  const corpo = runs.map((run) => runXml(run, tamanho, cabecalho || paragrafo.level === "h3" || paragrafo.level === "h4", links, proximo)).join("");
  return `<w:p><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/><w:jc w:val="both"/>${recuo}</w:pPr>${corpo}</w:p>`;
}

function runXml(run: Run, tamanho: string, forcarNegrito: boolean, links: Pacote["links"], proximo: { id: number }): string {
  const negrito = run.bold || forcarNegrito ? "<w:b/><w:bCs/>" : "";
  const italico = run.italic ? "<w:i/><w:iCs/>" : "";
  const sublinhado = run.underline || run.href ? `<w:u w:val="single"/>` : "";
  const cor = /^[0-9a-f]{6}$/i.test(run.color) ? `<w:color w:val="${run.color.toUpperCase()}"/>` : "";
  const miolo = `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>${negrito}${italico}${sublinhado}${cor}<w:sz w:val="${tamanho}"/><w:szCs w:val="${tamanho}"/></w:rPr><w:t xml:space="preserve">${xml(run.text)}</w:t></w:r>`;
  if (!run.href) return miolo;
  proximo.id += 1;
  const id = `rId${proximo.id}`;
  links.push({ id, href: run.href });
  return `<w:hyperlink r:id="${id}">${miolo}</w:hyperlink>`;
}

function tabelaXml(tabela: Table, links: Pacote["links"], proximo: { id: number }): string {
  const borda = (lado: string) => `<w:${lado} w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>`;
  const linhas = tabela.rows
    .map((linha) => {
      const celulas = linha.cells
        .map((paras) => {
          const fundo = linha.header ? `<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>` : "";
          const conteudo = paras.map((para) => paragrafoXml(para, links, proximo, linha.header)).join("");
          return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${fundo}</w:tcPr>${conteudo}</w:tc>`;
        })
        .join("");
      return `<w:tr>${celulas}</w:tr>`;
    })
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${borda("top")}${borda("left")}${borda("bottom")}${borda("right")}${borda("insideH")}${borda("insideV")}</w:tblBorders></w:tblPr>${linhas}</w:tbl>`;
}

function desenhoXml(rel: string, id: number, nome: string, cx: number, cy: number): string {
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="${xml(nome)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${xml(nome)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function inserirAposTitulo(documento: string, titulo: string, bloco: string): string {
  if (!bloco) return documento;
  const agulha = `<w:t>${titulo}</w:t>`;
  let de = 0;
  while (de < documento.length) {
    const em = documento.indexOf(agulha, de);
    if (em < 0) break;
    const inicio = Math.max(documento.lastIndexOf("<w:p ", em), documento.lastIndexOf("<w:p>", em));
    const cabeca = documento.slice(inicio, em);
    if (cabeca.includes('w:val="Ttulo1"') || cabeca.includes('w:val="Ttulo3"')) {
      const fim = documento.indexOf("</w:p>", em);
      if (fim < 0) throw new Error(`Parágrafo sem fim no modelo: ${titulo}`);
      return documento.slice(0, fim + 6) + bloco + documento.slice(fim + 6);
    }
    de = em + agulha.length;
  }
  throw new Error(`Seção não encontrada no modelo: ${titulo}`);
}

function maiorRel(rels: string): number {
  let maior = 0;
  for (const achou of rels.matchAll(/Id="rId(\d+)"/g)) maior = Math.max(maior, Number(achou[1]));
  return maior;
}

function aplicarData(documento: string, data: string): string {
  const segura = xml(data).replace(/"/g, "");
  const comCampo = documento.replace(
    /<w:instrText([^>]*)>\s*DATE\b[\s\S]*?<\/w:instrText>/,
    `<w:instrText xml:space="preserve"> QUOTE "${segura}" </w:instrText>`,
  );
  if (!comCampo.includes(`<w:t>${data}</w:t>`) && comCampo.includes("<w:t>22 de outubro de 2026</w:t>")) {
    return comCampo.replace("<w:t>22 de outubro de 2026</w:t>", `<w:t>${segura}</w:t>`);
  }
  return comCampo.replace("<w:t>22 de outubro de 2026</w:t>", `<w:t>${segura}</w:t>`);
}

function trocarConteudo(documento: string, tag: string, valor: string): string {
  const re = new RegExp(`(<${tag}(?:\\s[^>]*)?>)[\\s\\S]*?(</${tag}>)`);
  if (!re.test(documento)) throw new Error(`O modelo não tem a propriedade ${tag}.`);
  return documento.replace(re, `$1${xml(valor)}$2`);
}

function htmlValidade(valor: string): string {
  const texto = validadeNoDocumento(valor);
  if (!texto) return "";
  return `<p>${xmlTexto(texto)}</p>`;
}

export function preencherModelo(modelo: Buffer, dados: DadosPropostaDocx): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "proposta-docx-"));
  try {
    const origem = join(dir, "modelo.docx");
    writeFileSync(origem, modelo);
    const extraido = join(dir, "xml");
    execFileSync("python3", ["-c", "import zipfile,sys,os\nz=zipfile.ZipFile(sys.argv[1])\nos.makedirs(sys.argv[2], exist_ok=True)\nfor n in ['word/document.xml','word/header2.xml','word/_rels/document.xml.rels','[Content_Types].xml','docProps/core.xml','docProps/app.xml']:\n p=os.path.join(sys.argv[2], n); os.makedirs(os.path.dirname(p), exist_ok=True); open(p,'wb').write(z.read(n))", origem, extraido]);
    let documento = readFileSync(join(extraido, "word/document.xml"), "utf8");
    let cabecalho = readFileSync(join(extraido, "word/header2.xml"), "utf8");
    let rels = readFileSync(join(extraido, "word/_rels/document.xml.rels"), "utf8");
    let tipos = readFileSync(join(extraido, "[Content_Types].xml"), "utf8");
    let nucleo = readFileSync(join(extraido, "docProps/core.xml"), "utf8");
    let aplicativo = readFileSync(join(extraido, "docProps/app.xml"), "utf8");
    const razao = dados.clienteNome.trim();
    if (!razao) throw new DomainError("O cliente da proposta não tem razão social.");
    const demanda = xml(nomeDemanda(dados.titulo));
    const cliente = xml(razao);
    documento = documento.replaceAll("<w:t>Nome da Demanda</w:t>", `<w:t>${demanda}</w:t>`);
    documento = documento.replaceAll("<w:t>Nome do Cliente</w:t>", `<w:t>${cliente}</w:t>`);
    cabecalho = cabecalho.replaceAll("<w:t>Revisão DIRF Mensal</w:t>", `<w:t>${demanda}</w:t>`);
    nucleo = trocarConteudo(nucleo, "dc:subject", nomeDemanda(dados.titulo));
    aplicativo = trocarConteudo(aplicativo, "Company", `Cliente: ${razao}`);
    documento = aplicarData(documento, dados.dataExtenso);
    const proximo = { id: maiorRel(rels), desenho: 900000 };
    const secoes: Array<[string, string]> = [
      ["Visão geral", dados.visaoGeral],
      ["Definição de Escopo", dados.escopo],
      ["Definição de responsabilidades", dados.responsabilidades],
      ["Planejamento de Trabalho", dados.prazo],
      ["Execução das atividades", dados.execucao],
      ["Validade da proposta", htmlValidade(dados.validade)],
    ];
    const imagens: Pacote["imagens"] = [];
    const links: Pacote["links"] = [];
    for (const [titulo, html] of secoes) {
      const pacote = blocoParaXml(htmlParaBlocos(html), proximo);
      imagens.push(...pacote.imagens);
      links.push(...pacote.links);
      documento = inserirAposTitulo(documento, titulo, pacote.xml);
    }
    const valores = htmlParaBlocos(`<p>Valor total: ${xmlTexto(dados.valorTotal)}</p>${dados.formaPagamento}`);
    const pacoteValores = blocoParaXml(valores, proximo);
    imagens.push(...pacoteValores.imagens);
    links.push(...pacoteValores.links);
    documento = inserirAposTitulo(documento, "Valores", pacoteValores.xml);
    if (!rels.includes("</Relationships>")) throw new Error("Relações do modelo inválidas.");
    const relLinks = links.map((link) => `<Relationship Id="${link.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(link.href)}" TargetMode="External"/>`);
    const relMidia = imagens.map((imagem) => `<Relationship Id="${imagem.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${imagem.nome}"/>`);
    rels = rels.replace("</Relationships>", `${relLinks.join("")}${relMidia.join("")}</Relationships>`);
    for (const imagem of imagens) {
      const pasta = join(extraido, "word/media");
      mkdirSync(pasta, { recursive: true });
      writeFileSync(join(pasta, imagem.nome), imagem.bytes);
      const ext = imagem.nome.split(".").pop() ?? "png";
      if (!tipos.includes(`Extension="${ext}"`)) {
        const tipo = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : "image/png";
        tipos = tipos.replace("</Types>", `<Default Extension="${ext}" ContentType="${tipo}"/></Types>`);
      }
    }
    writeFileSync(join(extraido, "word/document.xml"), documento);
    writeFileSync(join(extraido, "word/header2.xml"), cabecalho);
    writeFileSync(join(extraido, "word/_rels/document.xml.rels"), rels);
    writeFileSync(join(extraido, "[Content_Types].xml"), tipos);
    writeFileSync(join(extraido, "docProps/core.xml"), nucleo);
    writeFileSync(join(extraido, "docProps/app.xml"), aplicativo);
    const destino = join(dir, "proposta.docx");
    execFileSync("python3", [join(import.meta.dirname, "rezip-docx.py"), origem, destino, extraido]);
    return readFileSync(destino);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function xmlTexto(valor: string): string {
  return valor.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function preencherModeloDoDisco(dados: DadosPropostaDocx): Buffer {
  return preencherModelo(readFileSync(MODELO), dados);
}

export function docxParaPdf(docx: Buffer): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "proposta-pdf-"));
  const perfil = mkdtempSync(join(tmpdir(), "lo-perfil-"));
  try {
    const entrada = join(dir, "proposta.docx");
    writeFileSync(entrada, docx);
    execFileSync(
      "/usr/bin/soffice",
      [
        "--headless",
        "--nologo",
        "--nofirststartwizard",
        "--norestore",
        `-env:UserInstallation=file://${perfil}`,
        "--convert-to",
        "pdf",
        "--outdir",
        dir,
        entrada,
      ],
      { timeout: 90000 },
    );
    return readFileSync(join(dir, "proposta.pdf"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(perfil, { recursive: true, force: true });
  }
}
