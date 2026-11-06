/** QR Code byte mode, correção M, versões 1 a 10. Sem borda. */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** [ec por bloco, blocos g1, dados g1, blocos g2, dados g2] na correção M. */
const BLOCOS_M: Record<number, [number, number, number, number, number]> = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
};

const ALINHAMENTO: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const RESTO = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

function rs(dados: number[], ec: number): number[] {
  let gerador = [1];
  for (let i = 0; i < ec; i += 1) {
    const proximo = new Array<number>(gerador.length + 1).fill(0);
    for (let j = 0; j < gerador.length; j += 1) {
      proximo[j] ^= gerador[j];
      proximo[j + 1] ^= mul(gerador[j], EXP[i]);
    }
    gerador = proximo;
  }
  const resto = new Array<number>(ec).fill(0);
  for (const byte of dados) {
    const fator = byte ^ resto[0];
    resto.copyWithin(0, 1);
    resto[ec - 1] = 0;
    for (let i = 0; i < ec; i += 1) resto[i] ^= mul(gerador[i + 1], fator);
  }
  return resto;
}

function bitsDoNumero(valor: number, tamanho: number): number[] {
  const saida: number[] = [];
  for (let i = tamanho - 1; i >= 0; i -= 1) saida.push((valor >> i) & 1);
  return saida;
}

function dadosDaVersao(texto: string, versao: number): { bits: number[]; totalDados: number } | null {
  const spec = BLOCOS_M[versao];
  const totalDados = spec[1] * spec[2] + spec[3] * spec[4];
  const contagem = versao >= 10 ? 16 : 8;
  const bits: number[] = [...bitsDoNumero(0b0100, 4), ...bitsDoNumero(texto.length, contagem)];
  for (const caractere of texto) bits.push(...bitsDoNumero(caractere.charCodeAt(0), 8));
  const capacidade = totalDados * 8;
  if (bits.length > capacidade) return null;
  const terminador = Math.min(4, capacidade - bits.length);
  for (let i = 0; i < terminador; i += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let valor = 0;
    for (let j = 0; j < 8; j += 1) valor = (valor << 1) | bits[i + j];
    bytes.push(valor);
  }
  let pad = 0xec;
  while (bytes.length < totalDados) {
    bytes.push(pad);
    pad ^= 0xec ^ 0x11;
  }
  return { bits: bytes.flatMap((byte) => bitsDoNumero(byte, 8)), totalDados };
}

function intercalar(bytes: number[], versao: number): number[] {
  const [ec, n1, d1, n2, d2] = BLOCOS_M[versao];
  const blocos: number[][] = [];
  let cursor = 0;
  for (let i = 0; i < n1; i += 1) {
    const dados = bytes.slice(cursor, cursor + d1);
    cursor += d1;
    blocos.push(dados.concat(rs(dados, ec)));
  }
  for (let i = 0; i < n2; i += 1) {
    const dados = bytes.slice(cursor, cursor + d2);
    cursor += d2;
    blocos.push(dados.concat(rs(dados, ec)));
  }
  const saida: number[] = [];
  const dadosMax = Math.max(d1, d2);
  for (let i = 0; i < dadosMax; i += 1) {
    for (const bloco of blocos) {
      if (i < bloco.length - ec) saida.push(bloco[i]);
    }
  }
  for (let i = 0; i < ec; i += 1) {
    for (const bloco of blocos) saida.push(bloco[bloco.length - ec + i]);
  }
  return saida;
}

function formato(mascara: number): number {
  const dado = mascara & 7;
  let resto = dado << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((resto >> i) & 1) resto ^= 0x537 << (i - 10);
  }
  return ((dado << 10) | resto) ^ 0x5412;
}

function versaoBits(versao: number): number {
  let resto = versao << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if ((resto >> i) & 1) resto ^= 0x1f25 << (i - 12);
  }
  return (versao << 12) | resto;
}

type Grade = { modulo: (Uint8Array | null)[]; funcao: Uint8Array[]; tamanho: number };

function gradeVazia(tamanho: number): Grade {
  return {
    tamanho,
    modulo: Array.from({ length: tamanho }, () => null),
    funcao: Array.from({ length: tamanho }, () => new Uint8Array(tamanho)),
  };
}

function pintar(grade: Grade, linha: number, coluna: number, escuro: boolean, funcao: boolean): void {
  if (!grade.modulo[linha]) grade.modulo[linha] = new Uint8Array(grade.tamanho);
  const linhaModulo = grade.modulo[linha] ?? new Uint8Array(grade.tamanho);
  grade.modulo[linha] = linhaModulo;
  linhaModulo[coluna] = escuro ? 1 : 0;
  if (funcao) grade.funcao[linha][coluna] = 1;
}

function quadrado(grade: Grade, linha: number, coluna: number, tamanho: number, escuro: boolean): void {
  for (let y = 0; y < tamanho; y += 1) {
    for (let x = 0; x < tamanho; x += 1) pintar(grade, linha + y, coluna + x, escuro, true);
  }
}

function finder(grade: Grade, linha: number, coluna: number): void {
  quadrado(grade, linha, coluna, 7, true);
  quadrado(grade, linha + 1, coluna + 1, 5, false);
  quadrado(grade, linha + 2, coluna + 2, 3, true);
}

function alinhamento(grade: Grade, linha: number, coluna: number): void {
  quadrado(grade, linha - 2, coluna - 2, 5, true);
  quadrado(grade, linha - 1, coluna - 1, 3, false);
  pintar(grade, linha, coluna, true, true);
}

function cobreFinder(tamanho: number, linha: number, coluna: number): boolean {
  const esquerda = coluna < 9;
  const direita = coluna > tamanho - 10;
  const cima = linha < 9;
  const baixo = linha > tamanho - 10;
  return (cima && esquerda) || (cima && direita) || (baixo && esquerda);
}

function funcoes(grade: Grade, versao: number): void {
  const n = grade.tamanho;
  finder(grade, 0, 0);
  finder(grade, 0, n - 7);
  finder(grade, n - 7, 0);
  for (let i = 0; i < 8; i += 1) {
    pintar(grade, 7, i, false, true);
    pintar(grade, i, 7, false, true);
    pintar(grade, 7, n - 8 + i, false, true);
    pintar(grade, i, n - 8, false, true);
    pintar(grade, n - 8, i, false, true);
    pintar(grade, n - 8 + i, 7, false, true);
  }
  for (const linha of ALINHAMENTO[versao]) {
    for (const coluna of ALINHAMENTO[versao]) {
      if (cobreFinder(n, linha, coluna)) continue;
      alinhamento(grade, linha, coluna);
    }
  }
  for (let i = 0; i < n; i += 1) {
    if (!grade.funcao[6][i]) pintar(grade, 6, i, i % 2 === 0, true);
    if (!grade.funcao[i][6]) pintar(grade, i, 6, i % 2 === 0, true);
  }
  pintar(grade, n - 8, 8, true, true);
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) pintar(grade, 8, i, false, true);
    if (i !== 6) pintar(grade, i, 8, false, true);
  }
  for (let i = 0; i < 8; i += 1) {
    pintar(grade, 8, n - 1 - i, false, true);
    if (n - 1 - i !== n - 8) pintar(grade, n - 1 - i, 8, false, true);
  }
  if (versao >= 7) {
    const bits = versaoBits(versao);
    for (let i = 0; i < 18; i += 1) {
      const escuro = ((bits >> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = i % 3;
      pintar(grade, a, n - 11 + b, escuro, true);
      pintar(grade, n - 11 + b, a, escuro, true);
    }
  }
}

function mascaraCombina(mascara: number, linha: number, coluna: number): boolean {
  switch (mascara) {
    case 0: return (linha + coluna) % 2 === 0;
    case 1: return linha % 2 === 0;
    case 2: return coluna % 3 === 0;
    case 3: return (linha + coluna) % 3 === 0;
    case 4: return (Math.floor(linha / 2) + Math.floor(coluna / 3)) % 2 === 0;
    case 5: return ((linha * coluna) % 2) + ((linha * coluna) % 3) === 0;
    case 6: return (((linha * coluna) % 2) + ((linha * coluna) % 3)) % 2 === 0;
    default: return (((linha + coluna) % 2) + ((linha * coluna) % 3)) % 2 === 0;
  }
}

function aplicarFormato(grade: Grade, mascara: number): void {
  const n = grade.tamanho;
  const info = formato(mascara);
  let vertical = 0;
  let horizontal = 0;
  for (let i = 0; i < 8; i += 1) {
    const bitBaixo = (info >> i) & 1;
    const bitAlto = (info >> (14 - i)) & 1;
    if (i === 6) {
      vertical += 1;
      horizontal = 1;
    }
    grade.modulo[i + vertical][8] = bitBaixo;
    grade.modulo[8][i + horizontal] = bitAlto;
    grade.modulo[8][n - 1 - i] = bitBaixo;
    grade.modulo[n - 1 - i][8] = bitAlto;
  }
  grade.modulo[n - 8][8] = 1;
}

function colocarDados(grade: Grade, bits: number[], mascara: number): void {
  const n = grade.tamanho;
  let indice = 0;
  for (let direita = n - 1; direita > 0; direita -= 2) {
    const colunaDireita = direita <= 6 ? direita - 1 : direita;
    const sobeBase = (colunaDireita & 2) === 0;
    for (let vertical = 0; vertical < n; vertical += 1) {
      for (let z = 0; z < 2; z += 1) {
        const coluna = colunaDireita - z;
        const sobe = sobeBase !== (coluna < 6);
        const linha = sobe ? n - 1 - vertical : vertical;
        if (grade.funcao[linha][coluna]) continue;
        let escuro = indice < bits.length ? bits[indice] === 1 : false;
        indice += 1;
        if (mascara >= 0 && mascaraCombina(mascara, linha, coluna)) escuro = !escuro;
        grade.modulo[linha][coluna] = escuro ? 1 : 0;
      }
    }
  }
}

function penalidade(grade: Grade): number {
  const n = grade.tamanho;
  const escuro = (linha: number, coluna: number) => grade.modulo[linha]?.[coluna] === 1;
  let pontos = 0;
  let pretos = 0;
  for (let linha = 0; linha < n; linha += 1) {
    let sequencia = 1;
    for (let coluna = 0; coluna < n; coluna += 1) {
      if (escuro(linha, coluna)) pretos += 1;
      if (coluna > 0 && escuro(linha, coluna) === escuro(linha, coluna - 1)) sequencia += 1;
      else {
        if (sequencia >= 5) pontos += 3 + sequencia - 5;
        sequencia = 1;
      }
    }
    if (sequencia >= 5) pontos += 3 + sequencia - 5;
  }
  for (let coluna = 0; coluna < n; coluna += 1) {
    let sequencia = 1;
    for (let linha = 0; linha < n; linha += 1) {
      if (linha > 0 && escuro(linha, coluna) === escuro(linha - 1, coluna)) sequencia += 1;
      else {
        if (sequencia >= 5) pontos += 3 + sequencia - 5;
        sequencia = 1;
      }
    }
    if (sequencia >= 5) pontos += 3 + sequencia - 5;
  }
  for (let linha = 0; linha < n - 1; linha += 1) {
    for (let coluna = 0; coluna < n - 1; coluna += 1) {
      const cor = escuro(linha, coluna);
      if (cor === escuro(linha, coluna + 1) && cor === escuro(linha + 1, coluna) && cor === escuro(linha + 1, coluna + 1)) pontos += 3;
    }
  }
  const procurado = ["10111010000", "00001011101"];
  for (let linha = 0; linha < n; linha += 1) {
    let faixa = "";
    for (let coluna = 0; coluna < n; coluna += 1) faixa += escuro(linha, coluna) ? "1" : "0";
    for (const padrao of procurado) {
      let de = 0;
      while (de >= 0) {
        de = faixa.indexOf(padrao, de);
        if (de >= 0) {
          pontos += 40;
          de += 1;
        }
      }
    }
  }
  for (let coluna = 0; coluna < n; coluna += 1) {
    let faixa = "";
    for (let linha = 0; linha < n; linha += 1) faixa += escuro(linha, coluna) ? "1" : "0";
    for (const padrao of procurado) {
      let de = 0;
      while (de >= 0) {
        de = faixa.indexOf(padrao, de);
        if (de >= 0) {
          pontos += 40;
          de += 1;
        }
      }
    }
  }
  const proporcao = Math.abs(pretos * 100 / (n * n) - 50) / 5;
  pontos += Math.floor(proporcao) * 10;
  return pontos;
}

function bitsDoTexto(texto: string, versao: number): number[] {
  const spec = BLOCOS_M[versao];
  const totalDados = spec[1] * spec[2] + spec[3] * spec[4];
  const contagem = versao >= 10 ? 16 : 8;
  const bits: number[] = [...bitsDoNumero(0b0100, 4), ...bitsDoNumero(Buffer.byteLength(texto), contagem)];
  for (const byte of Buffer.from(texto, "utf8")) bits.push(...bitsDoNumero(byte, 8));
  const capacidade = totalDados * 8;
  if (bits.length > capacidade) throw new Error("qr");
  const terminador = Math.min(4, capacidade - bits.length);
  for (let i = 0; i < terminador; i += 1) bits.push(0);
  const faltam = (8 - (bits.length % 8)) % 8;
  for (let i = 0; i < faltam; i += 1) bits.push(0);
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let valor = 0;
    for (let j = 0; j < 8; j += 1) valor = (valor << 1) | (bits[i + j] ?? 0);
    bytes.push(valor);
  }
  for (let i = 0, pad = 0xec; bytes.length < totalDados; i += 1, pad ^= 0xfd) bytes.push(pad);
  const intercalado = intercalar(bytes, versao);
  const saida = intercalado.flatMap((byte) => bitsDoNumero(byte, 8));
  for (let i = 0; i < RESTO[versao]; i += 1) saida.push(0);
  return saida;
}

function montar(texto: string, versao: number, mascara: number): Grade {
  const tamanho = 17 + 4 * versao;
  const grade = gradeVazia(tamanho);
  for (let i = 0; i < tamanho; i += 1) grade.modulo[i] = new Uint8Array(tamanho);
  funcoes(grade, versao);
  colocarDados(grade, bitsDoTexto(texto, versao), mascara);
  if (mascara >= 0) aplicarFormato(grade, mascara);
  return grade;
}

export function matrizQr(texto: string, mascaraFixa?: number): boolean[][] {
  for (const caractere of texto) {
    if (caractere.charCodeAt(0) > 255) throw new Error("qr");
  }
  let versao = 0;
  for (let candidata = 1; candidata <= 10; candidata += 1) {
    if (dadosDaVersao(texto, candidata)) {
      versao = candidata;
      break;
    }
  }
  if (!versao) throw new Error("qr");
  let escolhida = montar(texto, versao, mascaraFixa ?? 0);
  if (mascaraFixa == null) {
    let custo = Number.POSITIVE_INFINITY;
    for (let mascara = 0; mascara < 8; mascara += 1) {
      const grade = montar(texto, versao, mascara);
      const pontos = penalidade(grade);
      if (pontos < custo) {
        custo = pontos;
        escolhida = grade;
      }
    }
  }
  return escolhida.modulo.map((linha) => [...(linha ?? [])].map((celula) => celula === 1));
}
