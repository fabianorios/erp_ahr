import type { ReactNode } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { centsToReais, enderecoCompleto, formatBrl, mascaraCnpj, mascaraCpf, mascaraDinheiro, mascaraDocumento } from "@/services/erp/domain";

const ROTULOS: Record<string, string> = {
  rascunho: "Rascunho",
  enviada: "Enviada",
  aceita: "Aceita",
  recusada: "Recusada",
  expirada: "Expirada",
  vigente: "Vigente",
  encerrado: "Encerrado",
  cancelado: "Cancelado",
  cancelada: "Cancelada",
  previsto: "Previsto",
  faturado: "Faturado",
  recebido: "Recebido",
  informada: "Informada",
  aberto: "Aberto",
  atrasado: "Atrasado",
  pago: "Pago",
  a_pagar: "A pagar",
  paga: "Paga",
  operacional: "Operacional",
  financeira: "Financeira",
  contrato: "Contrato",
  indireto: "Indireto",
  financeiro: "Financeiro",
  juros: "Juros",
  tarifa_bancaria: "Tarifa bancária",
  iof: "IOF",
  boleto: "Boleto",
  pix: "Pix",
  manual: "Manual",
  fechado: "Fechado",
  mista: "Mista",
  realizado: "Realizado",
  receber: "Conta a receber",
  pagar: "Conta a pagar",
  ativo: "Ativo",
  inativo: "Inativo",
  pendente: "Pendente",
  solicitado: "Solicitado",
  assinado: "Assinado",
  concluida: "Concluída",
  devolvida: "Devolvida",
};

export function rotulo(valor: string): string {
  return ROTULOS[valor] ?? valor;
}

export function reais(cents: number): string {
  return formatBrl(cents);
}

export function reaisInput(cents: number): string {
  return centsToReais(cents).replace(".", ",");
}

export function dataBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

export function mesAtual(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

export function hoje(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
}

export function fimDoMes(mes: string): string {
  const [ano, numero] = mes.slice(0, 7).split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, numero, 0)).getUTCDate();
  return `${mes.slice(0, 7)}-${String(ultimo).padStart(2, "0")}`;
}

export async function executar(acao: () => Promise<unknown>, ok: string): Promise<boolean> {
  try {
    const resultado = await acao();
    toast.success(typeof resultado === "string" && resultado ? resultado : ok);
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Não foi possível concluir.");
    return false;
  }
}

export function TituloPagina({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{titulo}</h1>
      <p className="text-sm text-muted-foreground">{descricao}</p>
    </div>
  );
}

export function CampoDinheiro({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (valor: string) => void;
  disabled?: boolean;
}) {
  return (
    <Input
      inputMode="numeric"
      disabled={disabled}
      placeholder="R$ 0,00"
      value={value ? mascaraDinheiro(value) : ""}
      onChange={(event) => onChange(mascaraDinheiro(event.target.value))}
    />
  );
}

export function CampoDocumento({
  tipo,
  value,
  onChange,
  disabled,
}: {
  tipo: "cpf" | "cnpj" | "ambos";
  value: string;
  onChange: (valor: string) => void;
  disabled?: boolean;
}) {
  const mascara = tipo === "cpf" ? mascaraCpf : tipo === "cnpj" ? mascaraCnpj : mascaraDocumento;
  const placeholder = tipo === "cpf" ? "000.000.000-00" : tipo === "cnpj" ? "00.000.000/0000-00" : "000.000.000-00";
  return (
    <Input
      inputMode="numeric"
      disabled={disabled}
      placeholder={placeholder}
      value={value ? mascara(value) : ""}
      onChange={(event) => onChange(mascara(event.target.value))}
    />
  );
}

export function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function Pill({ valor }: { valor: string }) {
  return <span className="inline-flex rounded-md border px-2 py-0.5 text-xs font-medium">{rotulo(valor)}</span>;
}

export function AvisoConsulta({ erro }: { erro: unknown }) {
  if (!erro) return null;
  return <p className="text-sm text-destructive">{erro instanceof Error ? erro.message : "Não foi possível carregar."}</p>;
}

export type EnderecoForm = {
  logradouro: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  complemento: string;
};

export function CamposEndereco({ value, onChange }: { value: EnderecoForm; onChange: (patch: Partial<EnderecoForm>) => void }) {
  const completo = enderecoCompleto(value);
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">Endereço do tomador</p>
        <p className="text-xs text-muted-foreground">
          {completo
            ? "Endereço completo para a emissão futura de NFS-e e boleto."
            : "A emissão de NFS-e e boleto, nas fases seguintes, pede logradouro, número, bairro, cidade, UF e CEP."}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <Campo label="Logradouro">
          <Input value={value.logradouro} onChange={(e) => onChange({ logradouro: e.target.value })} />
        </Campo>
        <Campo label="Número">
          <Input value={value.numero} onChange={(e) => onChange({ numero: e.target.value })} />
        </Campo>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Bairro">
          <Input value={value.bairro} onChange={(e) => onChange({ bairro: e.target.value })} />
        </Campo>
        <Campo label="Complemento">
          <Input value={value.complemento} onChange={(e) => onChange({ complemento: e.target.value })} />
        </Campo>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_5rem_8rem]">
        <Campo label="Cidade">
          <Input value={value.cidade} onChange={(e) => onChange({ cidade: e.target.value })} />
        </Campo>
        <Campo label="UF">
          <Input value={value.uf} maxLength={2} onChange={(e) => onChange({ uf: e.target.value.toUpperCase() })} />
        </Campo>
        <Campo label="CEP">
          <Input value={value.cep} onChange={(e) => onChange({ cep: e.target.value })} />
        </Campo>
      </div>
    </div>
  );
}

export function enderecoTexto(value: EnderecoForm): string {
  return [value.logradouro, value.numero, value.bairro, value.cidade, value.uf, value.cep].filter(Boolean).join(", ");
}
