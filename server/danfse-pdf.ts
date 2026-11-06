/** DANFSe v2.0 simplificado, uma página, com os dados da nota autorizada. */

import { readFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import { DomainError } from "../src/services/erp/domain.ts";
import { nomeMunicipio, ufDoIbge } from "./municipios-ibge.ts";
import { matrizQr } from "./qrcode.ts";

export type DanfseDados = {
  chave: string;
  numero: string;
  competencia: string;
  emissao: string;
  numeroDps: string;
  serieDps: string;
  emissaoDps: string;
  municipio: string;
  ambienteGerador: string;
  tipoAmbiente: string;
  emitente: string;
  situacao: string;
  urlConsulta: string;
  prestador: PessoaDanfse;
  tomador: PessoaDanfse;
  simples: string;
  regime: string;
  servicoCodigo: string;
  servicoNbs: string;
  servicoLocal: string;
  servicoItem: string;
  servicoDescricao: string;
  issqnTipo: string;
  issqnLocal: string;
  issqnBase: string;
  issqnAliquota: string;
  issqnRetencao: string;
  issqnValor: string;
  irrf: string;
  previdencia: string;
  sociais: string;
  pis: string;
  cofins: string;
  valorServico: string;
  descontoIncondicionado: string;
  descontoCondicionado: string;
  retencoes: string;
  valorLiquido: string;
  totalIbsCbs: string;
  valorLiquidoIbs: string;
  complementares: string;
};

type PessoaDanfse = {
  documento: string;
  inscricao: string;
  telefone: string;
  nome: string;
  municipio: string;
  ibgeCep: string;
  endereco: string;
  email: string;
};

const SIMPLES: Record<string, string> = {
  "1": "Não optante",
  "2": "Optante - Microempreendedor Individual (MEI)",
  "3": "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)",
};

const REGIME: Record<string, string> = {
  "1": "Regime de apuração dos tributos federais e municipal pelo Simples Nacional",
  "2": "Regime de apuração dos tributos federais pelo Simples Nacional e ISSQN por fora do Simples Nacional",
  "3": "Regime de apuração dos tributos federais e municipal pela NFS-e",
};

const RETENCAO: Record<string, string> = {
  "1": "Não Retido",
  "2": "Retido pelo Tomador",
  "3": "Retido pelo Intermediário",
};

const TRIBUTACAO: Record<string, string> = {
  "1": "Operação Tributável",
  "2": "Imunidade",
  "3": "Exportação de serviço",
  "4": "Não Incidência",
};

const SITUACAO: Record<string, string> = {
  "100": "NFS-e Gerada",
  "101": "NFS-e Cancelada",
  "102": "NFS-e Substituída",
};

const EMITENTE: Record<string, string> = {
  "1": "Prestador",
  "2": "Tomador",
  "3": "Intermediário",
};

export function urlConsultaNfse(chave: string, producao: boolean): string {
  if (!/^\d{50}$/.test(chave)) throw new DomainError("A NFS-e não tem chave de acesso.");
  const host = producao ? "https://www.nfse.gov.br" : "https://www.producaorestrita.nfse.gov.br";
  return `${host}/ConsultaPublica/?tpc=1&chave=${chave}`;
}

export function lerDanfseXml(xml: string, chaveInformada = ""): DanfseDados {
  const inf = bloco(xml, "infNFSe") || xml;
  const dps = bloco(inf, "DPS");
  const capa = semBloco(inf, "DPS");
  const emit = bloco(capa, "emit");
  const valoresNota = bloco(capa, "valores");
  const infDps = bloco(dps, "infDPS") || dps;
  const prest = bloco(infDps, "prest");
  const toma = bloco(infDps, "toma");
  const serv = bloco(infDps, "serv");
  const valoresDps = bloco(infDps, "valores");
  const ibs = bloco(capa, "IBSCBS");
  const chave = /^\d{50}$/.test(chaveInformada) ? chaveInformada : chaveNoXml(inf);
  if (!/^\d{50}$/.test(chave)) throw new DomainError("A NFS-e não tem chave de acesso.");
  const numero = tag(capa, "nNFSe").replace(/\D/g, "");
  if (!numero) throw new DomainError("A NFS-e autorizada não tem número.");
  const cMunEmit = tag(emit, "cMun") || tag(capa, "cLocEmi") || tag(infDps, "cLocEmi");
  const ufEmit = tag(emit, "UF") || ufDoIbge(cMunEmit);
  const nomeEmit = tag(capa, "xLocEmi") || nomeMunicipio(cMunEmit);
  const tpAmb = tag(infDps, "tpAmb") || "1";
  const prestador = pessoa(emit, cMunEmit, ufEmit);
  if (!prestador.nome) prestador.nome = tag(prest, "xNome");
  if (prestador.documento === "-") prestador.documento = documento(prest);
  const tomador = pessoa(toma, tag(toma, "cMun"), tag(toma, "UF") || ufDoIbge(tag(toma, "cMun")));
  const cLocPrest = tag(serv, "cLocPrestacao");
  const localPrest = [tag(capa, "xLocPrestacao") || nomeMunicipio(cLocPrest), ufDoIbge(cLocPrest) || ufEmit, "-"].filter(Boolean).join(" / ");
  const cLocIncid = tag(capa, "cLocIncid");
  const localIss = [tag(capa, "xLocIncid") || nomeMunicipio(cLocIncid), ufDoIbge(cLocIncid), "-"].filter(Boolean).join(" / ");
  const codigoNac = formatarTributacao(tag(serv, "cTribNac"));
  const codigoMun = tag(serv, "cTribMun");
  const vServ = tag(valoresDps, "vServ") || tag(valoresNota, "vLiq");
  const vLiquido = tag(valoresNota, "vLiq") || vServ;
  const vIbs = primeiro(ibs, ["vIBS", "vIBSUF", "vIBSMun"]);
  const vCbs = tag(ibs, "vCBS");
  return {
    chave,
    numero,
    competencia: dataCurta(tag(infDps, "dCompet")),
    emissao: dataHora(tag(capa, "dhProc") || tag(infDps, "dhEmi")),
    numeroDps: tag(infDps, "nDPS") || "-",
    serieDps: tag(infDps, "serie") || "-",
    emissaoDps: dataHora(tag(infDps, "dhEmi")),
    municipio: nomeEmit ? `${nomeEmit}${ufEmit ? ` - ${ufEmit}` : ""}` : "-",
    ambienteGerador: tag(capa, "ambGer") || "-",
    tipoAmbiente: tpAmb,
    emitente: EMITENTE[tag(infDps, "tpEmit")] ?? "Prestador",
    situacao: SITUACAO[tag(capa, "cStat")] ?? (tag(capa, "cStat") ? `Situação ${tag(capa, "cStat")}` : "NFS-e Gerada"),
    urlConsulta: urlConsultaNfse(chave, tpAmb !== "2"),
    prestador,
    tomador,
    simples: SIMPLES[tag(prest, "opSimpNac")] ?? "-",
    regime: REGIME[tag(prest, "regApTribSN")] ?? "-",
    servicoCodigo: codigoMun ? `${codigoNac} / ${formatarTributacao(codigoMun)}` : `${codigoNac} / -`,
    servicoNbs: formatarNbs(tag(serv, "cNBS")),
    servicoLocal: localPrest || "-",
    servicoItem: tag(capa, "xTribNac") || "-",
    servicoDescricao: tag(serv, "xDescServ") || "-",
    issqnTipo: TRIBUTACAO[tag(valoresDps, "tribISSQN")] ?? "-",
    issqnLocal: localIss || "-",
    issqnBase: dinheiro(tag(valoresNota, "vBC")),
    issqnAliquota: percentual(tag(valoresNota, "pAliqAplic")),
    issqnRetencao: RETENCAO[tag(valoresDps, "tpRetISSQN")] ?? "-",
    issqnValor: dinheiro(tag(valoresNota, "vISSQN")),
    irrf: dinheiro(tag(valoresDps, "vRetIRRF")),
    previdencia: dinheiro(tag(valoresDps, "vRetCP")),
    sociais: dinheiro(tag(valoresDps, "vRetCSLL")),
    pis: dinheiro(tag(valoresDps, "vPis")),
    cofins: dinheiro(tag(valoresDps, "vCofins")),
    valorServico: dinheiro(vServ),
    descontoIncondicionado: dinheiro(tag(valoresDps, "vDescIncond")),
    descontoCondicionado: dinheiro(tag(valoresDps, "vDescCond")),
    retencoes: dinheiro(tag(valoresNota, "vTotalRet")),
    valorLiquido: dinheiro(vLiquido),
    totalIbsCbs: somaDinheiro(vIbs, vCbs),
    valorLiquidoIbs: somaDinheiro(vLiquido, vIbs, vCbs),
    complementares: complementares(capa, infDps, valoresDps),
  };
}

export function pdfDaNota(oficial: Buffer | null, xml: string, chave: string): Buffer {
  if (oficial && oficial.subarray(0, 5).toString("latin1") === "%PDF-") return oficial;
  return pdfDanfseSimplificado(lerDanfseXml(xml, chave));
}

export function pdfDanfseSimplificado(dados: DanfseDados): Buffer {
  const logo = logoNfse();
  const qr = matrizQr(dados.urlConsulta);
  const comandos = desenhar(dados, qr);
  const rgb = deflateSync(logo.rgb);
  const alfa = deflateSync(logo.alfa);
  const fluxo = Buffer.from(comandos, "latin1");
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /XObject << /Im1 8 0 R >> >> /Annots [9 0 R] >>`,
    `<< /Length ${fluxo.length} >>\nstream\n${comandos}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Type /XObject /Subtype /Image /Width ${logo.largura} /Height ${logo.altura} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${alfa.length} /Filter /FlateDecode >>\nstream\n${alfa.toString("latin1")}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width ${logo.largura} /Height ${logo.altura} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 7 0 R /Length ${rgb.length} /Filter /FlateDecode >>\nstream\n${rgb.toString("latin1")}\nendstream`,
    `<< /Type /Annot /Subtype /Link /Rect [530 700 578 748] /Border [0 0 0] /A << /S /URI /URI ${literalPdf(dados.urlConsulta)} >> >>`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objetos.forEach((objeto, indice) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${indice + 1} 0 obj\n${objeto}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objetos.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function desenhar(dados: DanfseDados, qr: boolean[][]): string {
  const c: string[] = ["0.6 w", "8 8 579 826 re", "S", "0.4 w"];
  faixa(c, 8, 802, 579, 28, "0.95");
  texto(c, 14, 820, "F1", 6, "DATA CIENTIFICAÇÃO");
  texto(c, 160, 820, "F1", 6, "IDENTIFICAÇÃO E ASSINATURA");
  texto(c, 360, 820, "F1", 6, "N° NFS-e / CHAVE NFS-e");
  texto(c, 356, 808, "F2", 5.5, `${dados.numero} / ${dados.chave}`);
  linha(c, 150, 802, 150, 830);
  linha(c, 350, 802, 350, 830);
  faixa(c, 8, 762, 142, 38, "0.95");
  faixa(c, 150, 762, 292, 38, "0.95");
  faixa(c, 442, 762, 145, 38, "0.95");
  c.push("q 118 0 0 24 16 770 cm /Im1 Do Q");
  texto(c, 168, 786, "F1", 9, "DANFSe v2.0");
  texto(c, 168, 772, "F1", 8, "Documento Auxiliar da NFS-e");
  texto(c, 448, 788, "F2", 6, `Município: ${dados.municipio}`);
  texto(c, 448, 777, "F2", 6, `Ambiente Gerador: ${dados.ambienteGerador}`);
  texto(c, 448, 767, "F2", 6, `Tipo de Ambiente: ${dados.tipoAmbiente}`);
  linha(c, 8, 762, 587, 762);
  texto(c, 14, 748, "F1", 7, "CHAVE DE ACESSO DA NFS-e");
  texto(c, 14, 736, "F2", 7.5, dados.chave);
  desenharQr(c, qr, 530, 700, 48);
  const aviso = quebrar("A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e", 62);
  aviso.forEach((linhaTexto, indice) => texto(c, 14, 720 - indice * 8, "F2", 6, linhaTexto));
  let y = 692;
  y = grade(c, y, [
    ["NÚMERO DA NFS-e", dados.numero],
    ["COMPETÊNCIA DA NFS-e", dados.competencia],
    ["DATA E HORA DA EMISSÃO DA NFS-e", dados.emissao],
  ]);
  y = grade(c, y, [
    ["NÚMERO DA DPS", dados.numeroDps],
    ["SÉRIE DA DPS", dados.serieDps],
    ["DATA E HORA DA EMISSÃO DA DPS", dados.emissaoDps],
  ]);
  y = grade(c, y, [
    ["EMITENTE DA NFS-e", dados.emitente],
    ["SITUAÇÃO DA NFS-e", dados.situacao],
    ["FINALIDADE", "-"],
  ]);
  y = pessoaBloco(c, y, "PRESTADOR / FORNECEDOR", dados.prestador, dados.simples, dados.regime);
  y = pessoaBloco(c, y, "TOMADOR / ADQUIRENTE", dados.tomador);
  y = tarja(c, y, "DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e");
  y = tarja(c, y, "INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e");
  y = titulo(c, y, "SERVIÇO PRESTADO");
  y = par(c, y, "Código de Tributação Nacional/Municipal", dados.servicoCodigo, "Código da NBS", dados.servicoNbs);
  y = par(c, y, "Local da Prestação / Sigla UF / País", dados.servicoLocal, "", "");
  texto(c, 14, y - 4, "F2", 6.5, cortar(dados.servicoItem, 110));
  y -= 12;
  const descricao = quebrar(dados.servicoDescricao, 108).slice(0, 3);
  descricao.forEach((linhaTexto) => {
    texto(c, 14, y - 3, "F2", 7, linhaTexto);
    y -= 9;
  });
  y = titulo(c, y, "TRIBUTAÇÃO MUNICIPAL (ISSQN)");
  y = par(c, y, "Tipo de Tributação do ISSQN", dados.issqnTipo, "Retenção do ISSQN", dados.issqnRetencao);
  y = par(c, y, "Município / Sigla UF / País de Incidência do ISSQN", dados.issqnLocal, "ISSQN Apurado", dados.issqnValor);
  y = par(c, y, "BC ISSQN", dados.issqnBase, "Alíquota Aplicada", dados.issqnAliquota);
  y = titulo(c, y, "TRIBUTAÇÃO FEDERAL (EXCETO CBS)");
  y = par(c, y, "IRRF", dados.irrf, "Contribuição Previdenciária - Retida", dados.previdencia);
  y = par(c, y, "Contribuições Sociais - Retidas", dados.sociais, "PIS - Débito Apuração Própria", dados.pis);
  y = par(c, y, "COFINS - Débito Apuração Própria", dados.cofins, "Descrição Contrib. Sociais - Retidas", "-");
  y = titulo(c, y, "TRIBUTAÇÃO IBS/CBS");
  y = par(c, y, "CST / cClassTrib", "- / -", "Total do IBS/CBS", dados.totalIbsCbs);
  y = titulo(c, y, "VALOR TOTAL DA NFS-e");
  y = par(c, y, "VALOR DA OPERAÇÃO / SERVIÇO", dados.valorServico, "VALOR LÍQUIDO DA NFS-e", dados.valorLiquido);
  y = par(c, y, "Desconto Incondicionado", dados.descontoIncondicionado, "Desconto Condicionado", dados.descontoCondicionado);
  y = par(c, y, "Total das Retenções (ISSQN / Federais)", dados.retencoes, "VALOR LÍQUIDO DA NFS-e + IBS/CBS", dados.valorLiquidoIbs);
  y = titulo(c, y, "INFORMAÇÕES COMPLEMENTARES");
  quebrar(dados.complementares, 108).slice(0, 2).forEach((linhaTexto, indice) => {
    texto(c, 14, y - 11 - indice * 8, "F2", 6.5, linhaTexto);
  });
  return c.join("\n");
}

function grade(c: string[], y: number, celulas: [string, string][]): number {
  const largura = 579 / celulas.length;
  faixa(c, 8, y - 22, 579, 22, "0.96");
  celulas.forEach(([rotulo, valor], indice) => {
    const x = 8 + indice * largura;
    if (indice) linha(c, x, y - 22, x, y);
    texto(c, x + 4, y - 9, "F1", 6, cortar(rotulo, 42));
    texto(c, x + 4, y - 18, "F2", 7.5, cortar(valor, 36));
  });
  linha(c, 8, y - 22, 587, y - 22);
  return y - 22;
}

function pessoaBloco(c: string[], y: number, nome: string, pessoaDados: PessoaDanfse, simples = "", regime = ""): number {
  y = titulo(c, y, nome);
  texto(c, 14, y - 8, "F1", 6, "CNPJ / CPF / NIF");
  texto(c, 14, y - 17, "F2", 7, pessoaDados.documento);
  texto(c, 210, y - 8, "F1", 6, "Indicador Municipal (Inscrição)");
  texto(c, 210, y - 17, "F2", 7, pessoaDados.inscricao);
  texto(c, 430, y - 8, "F1", 6, "Telefone");
  texto(c, 430, y - 17, "F2", 7, pessoaDados.telefone);
  linha(c, 8, y - 20, 587, y - 20);
  y -= 20;
  y = par(c, y, "Nome / Nome Empresarial", pessoaDados.nome, "Município / Sigla UF", pessoaDados.municipio);
  y = par(c, y, "Endereço", pessoaDados.endereco, "Código IBGE / CEP", pessoaDados.ibgeCep);
  y = par(c, y, "E-mail", pessoaDados.email, "", "");
  if (simples) {
    const linhas = quebrar(`${simples}. ${regime}`.trim(), 100).slice(0, 2);
    linhas.forEach((linhaTexto, indice) => texto(c, 14, y - 10 - indice * 8, "F2", 6, linhaTexto));
    y -= 8 + linhas.length * 8;
    linha(c, 8, y, 587, y);
  }
  return y;
}

function titulo(c: string[], y: number, nome: string): number {
  faixa(c, 8, y - 12, 579, 12, "0.90");
  texto(c, 12, y - 9, "F1", 7, nome);
  return y - 12;
}

function tarja(c: string[], y: number, nome: string): number {
  faixa(c, 8, y - 11, 579, 11, "0.96");
  texto(c, 12, y - 8, "F1", 6.5, nome);
  return y - 11;
}

function par(c: string[], y: number, esquerdo: string, valorEsquerdo: string, direito: string, valorDireito: string): number {
  texto(c, 14, y - 8, "F1", 6, cortar(esquerdo, 62));
  texto(c, 14, y - 17, "F2", 7, cortar(valorEsquerdo, 58));
  if (direito) {
    texto(c, 300, y - 8, "F1", 6, cortar(direito, 52));
    texto(c, 300, y - 17, "F2", 7, cortar(valorDireito, 46));
  }
  linha(c, 8, y - 20, 587, y - 20);
  return y - 20;
}

function faixa(c: string[], x: number, y: number, largura: number, altura: number, cinza: string): void {
  c.push(`${cinza} ${cinza} ${cinza} rg`, `${x} ${y} ${largura} ${altura} re`, "f", "0 0 0 rg");
}

function linha(c: string[], x1: number, y1: number, x2: number, y2: number): void {
  c.push(`${num(x1)} ${num(y1)} m`, `${num(x2)} ${num(y2)} l`, "S");
}

function texto(c: string[], x: number, y: number, fonte: string, tamanho: number, valor: string): void {
  c.push("BT", `/${fonte} ${tamanho} Tf`, `${num(x)} ${num(y)} Td`, `${literalPdf(valor)} Tj`, "ET");
}

function desenharQr(c: string[], matriz: boolean[][], x: number, y: number, tamanho: number): void {
  const n = matriz.length;
  const modulo = tamanho / n;
  c.push("0 0 0 rg");
  for (let linhaQr = 0; linhaQr < n; linhaQr += 1) {
    let coluna = 0;
    while (coluna < n) {
      if (!matriz[linhaQr][coluna]) {
        coluna += 1;
        continue;
      }
      let fim = coluna;
      while (fim < n && matriz[linhaQr][fim]) fim += 1;
      const px = x + coluna * modulo;
      const py = y + (n - 1 - linhaQr) * modulo;
      c.push(`${num(px)} ${num(py)} ${num((fim - coluna) * modulo)} ${num(modulo)} re f`);
      coluna = fim;
    }
  }
}

function num(valor: number): string {
  return Number(valor.toFixed(2)).toString();
}

function cortar(valor: string, limite: number): string {
  const textoLimpo = valor.replace(/\s+/g, " ").trim();
  if (textoLimpo.length <= limite) return textoLimpo;
  return `${textoLimpo.slice(0, limite - 1)}…`;
}

function quebrar(valor: string, limite: number): string[] {
  const palavras = valor.replace(/\s+/g, " ").trim().split(" ");
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of palavras) {
    const proxima = atual ? `${atual} ${palavra}` : palavra;
    if (proxima.length > limite && atual) {
      linhas.push(atual);
      atual = palavra;
    } else atual = proxima;
  }
  if (atual) linhas.push(atual);
  return linhas.length ? linhas : ["-"];
}

function pessoa(trecho: string, cMun: string, uf: string): PessoaDanfse {
  const nomeCidade = nomeMunicipio(cMun);
  const partes = [tag(trecho, "xLgr"), tag(trecho, "nro"), tag(trecho, "xCpl"), tag(trecho, "xBairro")].filter(Boolean);
  return {
    documento: documento(trecho),
    inscricao: tag(trecho, "IM") || "-",
    telefone: tag(trecho, "fone") || "-",
    nome: tag(trecho, "xNome") || "-",
    municipio: nomeCidade || uf ? `${nomeCidade || cMun || "-"} / ${uf || "-"}` : "-",
    ibgeCep: `${formatarIbge(cMun)} / ${formatarCep(tag(trecho, "CEP"))}`,
    endereco: partes.join(", ") || "-",
    email: tag(trecho, "email") || "-",
  };
}

function documento(trecho: string): string {
  const cnpj = tag(trecho, "CNPJ").replace(/\D/g, "");
  const cpf = tag(trecho, "CPF").replace(/\D/g, "");
  if (cnpj.length === 14) return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
  if (cpf.length === 11) return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
  return tag(trecho, "NIF") || "-";
}

function formatarIbge(codigo: string): string {
  if (!/^\d{7}$/.test(codigo)) return "-";
  return `${codigo.slice(0, 2)}.${codigo.slice(2)}`;
}

function formatarCep(cep: string): string {
  const digitos = cep.replace(/\D/g, "");
  if (digitos.length !== 8) return "-";
  return `${digitos.slice(0, 5)}-${digitos.slice(5)}`;
}

function formatarTributacao(codigo: string): string {
  const digitos = codigo.replace(/\D/g, "");
  if (digitos.length !== 6) return digitos || "-";
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 4)}.${digitos.slice(4)}`;
}

function formatarNbs(codigo: string): string {
  const digitos = codigo.replace(/\D/g, "");
  if (digitos.length !== 9) return digitos || "-";
  return `${digitos.slice(0, 1)}.${digitos.slice(1, 5)}.${digitos.slice(5, 7)}.${digitos.slice(7)}`;
}

function dataCurta(iso: string): string {
  const achado = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (achado) return `${achado[3]}/${achado[2]}/${achado[1]}`;
  const mes = /^(\d{4})-(\d{2})$/.exec(iso);
  return mes ? `${mes[2]}/${mes[1]}` : "-";
}

function dataHora(iso: string): string {
  const achado = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/.exec(iso);
  if (!achado) return "-";
  const data = `${achado[3]}/${achado[2]}/${achado[1]}`;
  return achado[4] ? `${data} ${achado[4]}:${achado[5]}:${achado[6]}` : data;
}

function dinheiro(valor: string): string {
  const textoValor = valor.trim();
  if (!textoValor) return "-";
  const numero = Number(textoValor.replace(",", "."));
  if (!Number.isFinite(numero)) return "-";
  const sinal = numero < 0 ? "-" : "";
  const [inteiro, frac] = Math.abs(numero).toFixed(2).split(".");
  return `${sinal}R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
}

function percentual(valor: string): string {
  const textoValor = valor.trim();
  if (!textoValor) return "-";
  const numero = Number(textoValor.replace(",", "."));
  if (!Number.isFinite(numero)) return "-";
  return `${numero.toFixed(2).replace(".", ",")}%`;
}

function somaDinheiro(...valores: string[]): string {
  const numeros = valores.map((valor) => valor.trim()).filter(Boolean).map((valor) => Number(valor.replace(",", ".")));
  if (!numeros.length || numeros.some((numero) => !Number.isFinite(numero))) return "-";
  return dinheiro(numeros.reduce((soma, numero) => soma + numero, 0).toFixed(2));
}

function primeiro(trecho: string, nomes: string[]): string {
  for (const nome of nomes) {
    const valor = tag(trecho, nome);
    if (valor) return valor;
  }
  return "";
}

function complementares(capa: string, infDps: string, valores: string): string {
  const livre = tag(capa, "xOutInf") || tag(infDps, "xInfComp");
  const federal = tag(valores, "vTotTribFed");
  const estadual = tag(valores, "vTotTribEst");
  const municipal = tag(valores, "vTotTribMun");
  const simples = tag(valores, "pTotTribSN");
  const partes = [`Federais: ${federal ? dinheiro(federal) : "-"}`, `Estaduais: ${estadual ? dinheiro(estadual) : "-"}`, `Municipais: ${municipal ? dinheiro(municipal) : "-"}`];
  if (simples) partes.push(`Simples Nacional: ${percentual(simples)}`);
  const lei = `Totais aproximados dos Tributos cfe. Lei n° 12.741/2012: ${partes.join("; ")}.`;
  return livre ? `${livre} ${lei}` : lei;
}

function chaveNoXml(inf: string): string {
  const id = /Id="NFS(\d{50})"/i.exec(inf)?.[1] ?? "";
  return id || (tag(inf, "chaveAcesso").replace(/\D/g, "").length === 50 ? tag(inf, "chaveAcesso").replace(/\D/g, "") : "");
}

function bloco(xml: string, nome: string): string {
  return new RegExp(`<(?:[\\w.-]+:)?${nome}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${nome}>`, "i").exec(xml)?.[1] ?? "";
}

function semBloco(xml: string, nome: string): string {
  return xml.replace(new RegExp(`<(?:[\\w.-]+:)?${nome}\\b[^>]*>[\\s\\S]*?</(?:[\\w.-]+:)?${nome}>`, "i"), "");
}

function tag(xml: string, nome: string): string {
  const valor = new RegExp(`<(?:[\\w.-]+:)?${nome}\\b[^>]*>([^<]*)</(?:[\\w.-]+:)?${nome}>`, "i").exec(xml)?.[1] ?? "";
  return decodificar(valor).trim();
}

function decodificar(texto: string): string {
  return texto
    .replace(/&#(\d+);/g, (_, numero: string) => String.fromCodePoint(Number(numero)))
    .replace(/&#x([0-9a-f]+);/gi, (_, numero: string) => String.fromCodePoint(parseInt(numero, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function literalPdf(valor: string): string {
  let saida = "";
  for (const caractere of valor) {
    const byte = byteWinAnsi(caractere);
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) saida += `\\${String.fromCharCode(byte)}`;
    else if (byte < 32 || byte > 126) saida += `\\${byte.toString(8).padStart(3, "0")}`;
    else saida += String.fromCharCode(byte);
  }
  return `(${saida})`;
}

function byteWinAnsi(caractere: string): number {
  const codigo = caractere.codePointAt(0) ?? 0x3f;
  if (codigo === 0x20ac) return 0x80;
  if (codigo >= 32 && codigo <= 126) return codigo;
  if (codigo >= 160 && codigo <= 255) return codigo;
  if (codigo === 0x2026) return 0x85;
  if (codigo === 0x2014) return 0x97;
  if (codigo === 0x2013) return 0x96;
  if (codigo === 0x00b0) return 0xb0;
  return 0x3f;
}

type Logo = { largura: number; altura: number; rgb: Buffer; alfa: Buffer };

let logoCache: Logo | null = null;

function logoNfse(): Logo {
  if (logoCache) return logoCache;
  const png = readFileSync(new URL("./danfse-logo.png", import.meta.url));
  const rgba = pngRgba(png);
  const pixels = rgba.largura * rgba.altura;
  const rgb = Buffer.alloc(pixels * 3);
  const alfa = Buffer.alloc(pixels);
  for (let i = 0; i < pixels; i += 1) {
    rgb[i * 3] = rgba.dados[i * 4];
    rgb[i * 3 + 1] = rgba.dados[i * 4 + 1];
    rgb[i * 3 + 2] = rgba.dados[i * 4 + 2];
    alfa[i] = rgba.dados[i * 4 + 3];
  }
  logoCache = { largura: rgba.largura, altura: rgba.altura, rgb, alfa };
  return logoCache;
}

function pngRgba(png: Buffer): { largura: number; altura: number; dados: Buffer } {
  let offset = 8;
  let largura = 0;
  let altura = 0;
  const partes: Buffer[] = [];
  while (offset + 8 <= png.length) {
    const tamanho = png.readUInt32BE(offset);
    const tipo = png.subarray(offset + 4, offset + 8).toString("ascii");
    const dados = png.subarray(offset + 8, offset + 8 + tamanho);
    if (tipo === "IHDR") {
      largura = dados.readUInt32BE(0);
      altura = dados.readUInt32BE(4);
    } else if (tipo === "IDAT") partes.push(dados);
    else if (tipo === "IEND") break;
    offset += 12 + tamanho;
  }
  const cru = inflateSync(Buffer.concat(partes));
  const canais = 4;
  const passo = largura * canais;
  const saida = Buffer.alloc(altura * passo);
  let cursor = 0;
  for (let y = 0; y < altura; y += 1) {
    const filtro = cru[cursor];
    cursor += 1;
    for (let i = 0; i < passo; i += 1) {
      const bruto = cru[cursor];
      cursor += 1;
      const esquerda = i >= canais ? saida[y * passo + i - canais] : 0;
      const acima = y > 0 ? saida[(y - 1) * passo + i] : 0;
      const diagonal = y > 0 && i >= canais ? saida[(y - 1) * passo + i - canais] : 0;
      let valor = bruto;
      if (filtro === 1) valor = (bruto + esquerda) & 255;
      else if (filtro === 2) valor = (bruto + acima) & 255;
      else if (filtro === 3) valor = (bruto + Math.floor((esquerda + acima) / 2)) & 255;
      else if (filtro === 4) valor = (bruto + paeth(esquerda, acima, diagonal)) & 255;
      saida[y * passo + i] = valor;
    }
  }
  return { largura, altura, dados: saida };
}

function paeth(esquerda: number, acima: number, diagonal: number): number {
  const estimado = esquerda + acima - diagonal;
  const da = Math.abs(estimado - esquerda);
  const db = Math.abs(estimado - acima);
  const dc = Math.abs(estimado - diagonal);
  if (da <= db && da <= dc) return esquerda;
  return db <= dc ? acima : diagonal;
}
