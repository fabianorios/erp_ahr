/** Emissão da NFS-e no Emissor Nacional. Não abre conexão. */

import { DomainError, MUNICIPIO_NFSE, assertData, centsToReais, competenciaDoVencimento, reaisToCents, somenteDigitos, type Cents } from "./domain.ts";

export const CODIGO_MUNICIPIO_PRESTADOR = "3548807";
/** 17.01.01 — assessoria ou consultoria, item que o município do prestador administra. */
export const CODIGO_TRIBUTACAO_NACIONAL = "170101";
export const ORIGEM_TITULO_NFSE = "Emissor Nacional";
const HOSTS_SEFIN = ["sefin.nfse.gov.br", "sefin.producaorestrita.nfse.gov.br"] as const;

export type PedidoNfse = {
  clienteId: string;
  descricao: string;
  valor: string;
  vencimento: string;
  centroId: string;
  forma: string;
  banco: string;
  documento: string;
  nome: string;
  email: string;
  logradouro: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  complemento: string;
  cMunTomador: string;
  cMunPrestador: string;
  cnpjPrestador: string;
  inscricaoMunicipal: string;
  codigoServico: string;
  serie: string;
  numeroDps: string;
  emitidoEm: string;
  competencia: string;
  ambiente: 1 | 2;
};

export type NotaAutorizada = {
  numero: string;
  chave: string;
  dataEmissao: string;
  codigo: string;
  valorCents: Cents;
  descricao: string;
};

export type TituloNascido = {
  clienteId: string;
  centroId: string;
  descricao: string;
  valorCents: Cents;
  vencimento: string;
  competencia: string;
  numeroNf: string;
  origem: typeof ORIGEM_TITULO_NFSE;
  forma: "boleto" | "pix" | "transferencia" | "outro";
  banco: string | null;
  nfse: {
    numero: string;
    valorCents: Cents;
    vencimento: string;
    dataEmissao: string;
    chave: string;
    codigo: string;
    emissor: "nacional";
    municipio: typeof MUNICIPIO_NFSE;
  };
};

export function validarBaseSefin(valor: string): string {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new DomainError("A base do Emissor Nacional é inválida.");
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !(HOSTS_SEFIN as readonly string[]).includes(host)) {
    throw new DomainError("A base do Emissor Nacional não é a de produção nem a restrita.");
  }
  const caminho = url.pathname.replace(/\/+$/, "");
  if (caminho !== "/SefinNacional") throw new DomainError("A base do Emissor Nacional não é a de produção nem a restrita.");
  return `${url.origin}${caminho}`;
}

export function ambienteDaBase(base: string): 1 | 2 {
  return new URL(base).hostname === "sefin.producaorestrita.nfse.gov.br" ? 2 : 1;
}

/** Lê só o nome do ambiente. Não devolve o texto configurado. */
export function ambienteNfse(valor: string): { ambiente: 1 | 2; base: string } {
  const texto = valor.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (texto === "1" || texto === "producao" || texto === "prod") {
    return { ambiente: 1, base: "https://sefin.nfse.gov.br/SefinNacional" };
  }
  if (texto === "2" || texto === "homologacao" || texto === "restrita" || texto === "producaorestrita") {
    return { ambiente: 2, base: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional" };
  }
  throw new DomainError("O ambiente da NFS-e não está configurado.");
}

export function idDps(cMun: string, cnpj: string, serie: string, nDps: string): string {
  if (!/^\d{7}$/.test(cMun)) throw new DomainError("O município emissor da NFS-e é inválido.");
  if (!/^\d{14}$/.test(cnpj)) throw new DomainError("O CNPJ do prestador é inválido.");
  if (!/^\d{1,5}$/.test(serie) || !/^\d{1,15}$/.test(nDps)) throw new DomainError("A série ou o número da DPS é inválido.");
  return `DPS${cMun}2${cnpj}${serie.padStart(5, "0")}${nDps.padStart(15, "0")}`;
}

export function numeroDps(agora: Date, aleatorio: number): string {
  const base = String(agora.getTime()).slice(-13).padStart(13, "0");
  const sufixo = String(Math.abs(Math.trunc(aleatorio)) % 100).padStart(2, "0");
  return `${base}${sufixo}`;
}

export function instanteBrasil(agora: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(agora);
  const pegar = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "00";
  return `${pegar("year")}-${pegar("month")}-${pegar("day")}T${pegar("hour")}:${pegar("minute")}:${pegar("second")}-03:00`;
}

/** Dia civil da emissão. A competência da DPS não pode passar dele nem ir para um mês seguinte. */
export function competenciaEnviada(vencimento: string, emitidoEm: string): string {
  const emissao = assertData(emitidoEm.slice(0, 10), "Emissão");
  const dia = assertData(vencimento, "Vencimento");
  if (dia.slice(0, 7) === emissao.slice(0, 7) && dia <= emissao) return dia;
  return emissao;
}

export function codigoIbgeConhecido(cidade: string, uf: string): string | null {
  const nome = cidade.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
  if (nome === "saocaetanodosul" && uf.trim().toUpperCase() === "SP") return CODIGO_MUNICIPIO_PRESTADOR;
  return null;
}

function xml(valor: string): string {
  return valor.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function validarPedidoNfse(input: PedidoNfse): PedidoNfse {
  const clienteId = input.clienteId.trim();
  if (!/^[0-9a-f-]{36}$/i.test(clienteId)) throw new DomainError("Informe o cliente.");
  const centroId = input.centroId.trim();
  if (!/^[0-9a-f-]{36}$/i.test(centroId)) throw new DomainError("Informe o centro de custo.");
  const descricao = input.descricao.trim();
  if (!descricao) throw new DomainError("Informe a descrição do título.");
  if (descricao.length > 2000) throw new DomainError("A descrição passou de 2000 caracteres.");
  const valor = reaisToCents(input.valor);
  if (valor <= 0) throw new DomainError("O valor do título precisa ser maior que zero.");
  const vencimento = assertData(input.vencimento, "Vencimento");
  const documento = somenteDigitos(input.documento);
  if (documento.length !== 11 && documento.length !== 14) throw new DomainError("O documento do cliente não é CPF nem CNPJ.");
  const nome = input.nome.trim();
  if (nome.length < 2) throw new DomainError("Informe o cliente.");
  const cep = somenteDigitos(input.cep);
  if (cep.length !== 8) throw new DomainError("O cliente precisa de CEP para a NFS-e.");
  if (!input.logradouro.trim() || !input.numero.trim() || !input.bairro.trim()) {
    throw new DomainError("O cliente precisa de logradouro, número e bairro para a NFS-e.");
  }
  if (!/^\d{7}$/.test(input.cMunTomador)) throw new DomainError("Não foi possível identificar o município do cliente.");
  const cnpj = somenteDigitos(input.cnpjPrestador);
  if (cnpj.length !== 14) throw new DomainError("O CNPJ do prestador não está configurado.");
  const codigoServico = CODIGO_TRIBUTACAO_NACIONAL;
  if (!/^\d{6}$/.test(codigoServico)) throw new DomainError("O item de serviço da NFS-e não está configurado.");
  const cMunPrestador = somenteDigitos(input.cMunPrestador);
  if (!/^\d{7}$/.test(cMunPrestador)) throw new DomainError("O município emissor da NFS-e não está configurado.");
  const forma = input.forma.trim() || "boleto";
  if (forma !== "boleto" && forma !== "pix" && forma !== "transferencia" && forma !== "outro") {
    throw new DomainError("Informe a forma de recebimento.");
  }
  const banco = input.banco.trim();
  if (banco && (banco.length < 2 || banco.length > 80)) throw new DomainError("Informe o banco de recebimento.");
  if (input.ambiente !== 1 && input.ambiente !== 2) throw new DomainError("O ambiente do Emissor Nacional é inválido.");
  idDps(cMunPrestador, cnpj, input.serie, input.numeroDps);
  const competencia = competenciaEnviada(vencimento, input.emitidoEm);
  return {
    ...input,
    clienteId,
    centroId,
    descricao,
    valor: centsToReais(valor),
    vencimento,
    competencia,
    documento,
    nome,
    cep,
    cMunPrestador,
    cnpjPrestador: cnpj,
    codigoServico,
    forma,
    banco,
    inscricaoMunicipal: "",
  };
}

export function montarDps(pedido: PedidoNfse): string {
  const pronto = validarPedidoNfse(pedido);
  const id = idDps(pronto.cMunPrestador, pronto.cnpjPrestador, pronto.serie, pronto.numeroDps);
  const doc = pronto.documento.length === 14 ? "CNPJ" : "CPF";
  const email = pronto.email.trim();
  const complemento = pronto.complemento.trim();
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">` +
    `<infDPS Id="${id}">` +
    `<tpAmb>${pronto.ambiente}</tpAmb>` +
    `<dhEmi>${xml(pronto.emitidoEm)}</dhEmi>` +
    `<verAplic>ERPAhr_1</verAplic>` +
    `<serie>${pronto.serie.padStart(5, "0")}</serie>` +
    `<nDPS>${pronto.numeroDps.padStart(15, "0")}</nDPS>` +
    `<dCompet>${pronto.competencia}</dCompet>` +
    `<tpEmit>1</tpEmit>` +
    `<cLocEmi>${pronto.cMunPrestador}</cLocEmi>` +
    `<prest><CNPJ>${pronto.cnpjPrestador}</CNPJ>` +
    `<regTrib><opSimpNac>1</opSimpNac><regEspTrib>0</regEspTrib></regTrib></prest>` +
    `<toma><${doc}>${pronto.documento}</${doc}><xNome>${xml(pronto.nome)}</xNome>` +
    (email ? `<email>${xml(email)}</email>` : "") +
    `<end><endNac><cMun>${pronto.cMunTomador}</cMun><CEP>${pronto.cep}</CEP></endNac>` +
    `<xLgr>${xml(pronto.logradouro.trim())}</xLgr><nro>${xml(pronto.numero.trim())}</nro>` +
    (complemento ? `<xCpl>${xml(complemento)}</xCpl>` : "") +
    `<xBairro>${xml(pronto.bairro.trim())}</xBairro></end></toma>` +
    `<serv><locPrest><cLocPrestacao>${pronto.cMunPrestador}</cLocPrestacao></locPrest>` +
    `<cServ><cTribNac>${pronto.codigoServico}</cTribNac><xDescServ>${xml(pronto.descricao)}</xDescServ></cServ></serv>` +
    `<valores><vServPrest><vServ>${pronto.valor}</vServ></vServPrest>` +
    `<trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun>` +
    `<totTrib><indTotTrib>0</indTotTrib></totTrib></trib></valores>` +
    `</infDPS></DPS>`;
}

function tag(xmlNota: string, nome: string): string {
  const achado = new RegExp(`<${nome}>([^<]*)</${nome}>`).exec(xmlNota);
  return achado?.[1]?.trim() ?? "";
}

export function lerNotaAutorizada(status: number, corpo: string, descricaoPedida: string, valorPedido: string): NotaAutorizada {
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(corpo) as Record<string, unknown>;
  } catch {
    json = {};
  }
  if (status < 200 || status >= 300) {
    const erros = Array.isArray(json.erros) ? json.erros : Array.isArray(json.Erros) ? json.Erros : [];
    const textos = erros.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const descricao = "Descricao" in item ? item.Descricao : "descricao" in item ? item.descricao : "";
      const codigo = "Codigo" in item ? item.Codigo : "codigo" in item ? item.codigo : "";
      const texto = `${codigo ?? ""} ${descricao ?? ""}`.trim();
      return texto ? [texto] : [];
    });
    throw new DomainError(textos[0] ? `O Emissor Nacional recusou a nota. ${textos[0]}` : "O Emissor Nacional recusou a nota.");
  }
  const chave = typeof json.chaveAcesso === "string" ? json.chaveAcesso.trim() : "";
  if (!/^\d{50}$/.test(chave)) throw new DomainError("O Emissor Nacional não devolveu a chave da nota.");
  const xmlNota = typeof json.nfseXml === "string" ? json.nfseXml : "";
  const numero = (tag(xmlNota, "nNFSe") || tag(xmlNota, "nNF")).replace(/\D/g, "");
  if (!numero || numero.length > 40) throw new DomainError("O Emissor Nacional não devolveu o número da nota.");
  const dataBruta = tag(xmlNota, "dhProc") || tag(xmlNota, "dhEmi");
  const dataEmissao = /^\d{4}-\d{2}-\d{2}/.test(dataBruta) ? dataBruta.slice(0, 10) : "";
  if (!dataEmissao) throw new DomainError("O Emissor Nacional não devolveu a data da nota.");
  const valorTexto = tag(xmlNota, "vServ") || tag(xmlNota, "vLiq");
  const valorCents = valorTexto ? reaisToCents(valorTexto) : reaisToCents(valorPedido);
  if (valorCents <= 0) throw new DomainError("O Emissor Nacional não devolveu o valor da nota.");
  const descricao = tag(xmlNota, "xDescServ").trim() || descricaoPedida.trim();
  if (!descricao) throw new DomainError("O Emissor Nacional não devolveu a descrição da nota.");
  return {
    numero,
    chave,
    dataEmissao,
    codigo: chave.slice(-8),
    valorCents,
    descricao,
  };
}

/** A nota autorizada é a origem do título. Sem nota, esta função não é chamada. */
export function tituloDaNota(pedido: PedidoNfse, nota: NotaAutorizada): TituloNascido {
  const pronto = validarPedidoNfse(pedido);
  const forma = pronto.forma as TituloNascido["forma"];
  return {
    clienteId: pronto.clienteId,
    centroId: pronto.centroId,
    descricao: nota.descricao,
    valorCents: nota.valorCents,
    vencimento: pronto.vencimento,
    competencia: competenciaDoVencimento(pronto.vencimento),
    numeroNf: nota.numero,
    origem: ORIGEM_TITULO_NFSE,
    forma,
    banco: pronto.banco || null,
    nfse: {
      numero: nota.numero,
      valorCents: nota.valorCents,
      vencimento: pronto.vencimento,
      dataEmissao: nota.dataEmissao,
      chave: nota.chave,
      codigo: nota.codigo,
      emissor: "nacional",
      municipio: MUNICIPIO_NFSE,
    },
  };
}
