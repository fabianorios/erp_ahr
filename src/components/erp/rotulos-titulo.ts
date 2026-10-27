export const ROTULO_FORMA: Record<string, string> = {
  boleto: "Boleto",
  pix: "PIX",
  transferencia: "Transferência",
  outro: "Outro",
};

export const ROTULO_TIPO: Record<string, string> = {
  data_fixa: "Data fixa",
  prazo_dias: "Prazo em dias",
};

export function textoParcela(parcela: number | null, quantidade: number | null): string {
  if (!parcela || !quantidade) return "";
  return `Parcela ${parcela} de ${quantidade}`;
}
