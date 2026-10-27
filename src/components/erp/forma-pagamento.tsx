import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/ui/rich-text";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Campo, CampoDinheiro, dataBr, reais } from "@/components/erp/apresentacao";
import {
  entradaAdicionalVazia,
  preverAgenda,
  type EntradaAdicional,
  type MeioAdicional,
  type ModoParcelas,
  type RegraAdicional,
  type ValoresAdicionaisForm,
} from "@/services/erp/domain";

export type CamposAgenda = {
  quantidade: string;
  modoParcelas: ModoParcelas;
  intervaloDias: string;
  primeiroVencimento: string;
  vencimentos: string[];
  formaPagamento: string;
  adicionais: ValoresAdicionaisForm;
};

function ajustarDatas(quantidade: string, atuais: string[]): string[] {
  const n = Number(quantidade);
  if (!Number.isInteger(n) || n < 1 || n > 120) return [];
  const proximas = atuais.slice(0, n);
  while (proximas.length < n) proximas.push("");
  return proximas;
}

export function FormaPagamentoCampos({
  valor,
  onValorChange,
  value,
  onChange,
  disabled,
}: {
  valor: string;
  onValorChange: (valor: string) => void;
  value: CamposAgenda;
  onChange: (value: CamposAgenda) => void;
  disabled?: boolean;
}) {
  const previa = preverAgenda({ valor, ...value });
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div>
        <p className="text-sm font-medium">Valores</p>
        <p className="text-xs text-muted-foreground">
          O valor total, as parcelas e as despesas que podem ocorrer no trabalho. A soma das parcelas fecha no valor total. A cobrança interna continua mista.
        </p>
      </div>
      <Campo label="Valor total">
        <CampoDinheiro disabled={disabled} value={valor} onChange={onValorChange} />
      </Campo>
      <p className="text-sm font-medium">Forma de pagamento</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Campo label="Número de parcelas">
          <Input
            disabled={disabled}
            inputMode="numeric"
            value={value.quantidade}
            onChange={(evento) => {
              const quantidade = evento.target.value.replace(/\D/g, "");
              onChange({ ...value, quantidade, vencimentos: value.modoParcelas === "datas" ? ajustarDatas(quantidade, value.vencimentos) : value.vencimentos });
            }}
          />
        </Campo>
        <Campo label="Como informar os vencimentos">
          <Select
            disabled={disabled}
            value={value.modoParcelas}
            onValueChange={(modo) => {
              const modoParcelas = modo === "intervalo" ? "intervalo" : "datas";
              onChange({
                ...value,
                modoParcelas,
                vencimentos: modoParcelas === "datas" ? ajustarDatas(value.quantidade, value.vencimentos) : [],
              });
            }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="datas">Vencimento de cada parcela</SelectItem>
              <SelectItem value="intervalo">Dias entre as parcelas</SelectItem>
            </SelectContent>
          </Select>
        </Campo>
      </div>
      {value.modoParcelas === "intervalo" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Campo label="Primeiro vencimento">
            <Input disabled={disabled} type="date" value={value.primeiroVencimento} onChange={(evento) => onChange({ ...value, primeiroVencimento: evento.target.value })} />
          </Campo>
          <Campo label="Dias entre as parcelas">
            <Input disabled={disabled} inputMode="numeric" value={value.intervaloDias} onChange={(evento) => onChange({ ...value, intervaloDias: evento.target.value.replace(/\D/g, "") })} />
          </Campo>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {value.vencimentos.map((data, indice) => (
            <Campo key={indice} label={`Vencimento da parcela ${indice + 1}`}>
              <Input
                disabled={disabled}
                type="date"
                value={data}
                onChange={(evento) => {
                  const vencimentos = value.vencimentos.slice();
                  vencimentos[indice] = evento.target.value;
                  onChange({ ...value, vencimentos });
                }}
              />
            </Campo>
          ))}
        </div>
      )}
      {"agenda" in previa ? (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-[#003366]">
              <th className="border-b px-2 py-1">Parcela</th>
              <th className="border-b px-2 py-1">Vencimento</th>
              <th className="border-b px-2 py-1">Valor</th>
            </tr>
          </thead>
          <tbody>
            {previa.agenda.parcelas.map((parcela, indice) => (
              <tr key={parcela.vencimento + indice}>
                <td className="border-b px-2 py-1">{indice + 1}</td>
                <td className="border-b px-2 py-1">{dataBr(parcela.vencimento)}</td>
                <td className="border-b px-2 py-1">{reais(parcela.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-muted-foreground">{previa.erro}</p>
      )}
      <DespesasAdicionais
        disabled={disabled}
        value={value.adicionais ?? { transporte: entradaAdicionalVazia(), refeicao: entradaAdicionalVazia(), outras: [entradaAdicionalVazia()] }}
        onChange={(adicionais) => onChange({ ...value, adicionais })}
      />
      <Campo label="Observação da forma de pagamento">
        <RichTextEditor
          value={value.formaPagamento}
          disabled={disabled}
          placeholder="Condição comercial, se houver"
          onChange={(formaPagamento) => onChange({ ...value, formaPagamento })}
        />
      </Campo>
    </div>
  );
}

const REGRAS: { value: RegraAdicional; label: string }[] = [
  { value: "incluso", label: "Incluso" },
  { value: "reembolso", label: "Reembolso mediante comprovante" },
  { value: "valor_fixo", label: "Valor fixo" },
];

const MEIOS: { value: MeioAdicional; label: string }[] = [
  { value: "pix", label: "PIX" },
  { value: "boleto", label: "Boleto" },
  { value: "transferencia", label: "Transferência" },
  { value: "reembolso", label: "Reembolso mediante comprovante" },
  { value: "incluso", label: "Incluso no valor" },
];

function meiosDaRegra(regra: RegraAdicional | ""): { value: MeioAdicional; label: string }[] {
  if (regra === "incluso") return MEIOS.filter((meio) => meio.value === "incluso");
  if (regra === "valor_fixo") return MEIOS.filter((meio) => meio.value !== "incluso");
  if (regra === "reembolso") return MEIOS.filter((meio) => meio.value === "reembolso" || meio.value === "pix" || meio.value === "transferencia");
  return MEIOS;
}

function aoMudarRegra(item: EntradaAdicional, regra: RegraAdicional): EntradaAdicional {
  if (regra === "incluso") return { ...item, regra, valor: "", meio: "incluso" };
  if (regra === "reembolso") return { ...item, regra, valor: "", meio: item.meio === "incluso" || !item.meio ? "reembolso" : item.meio };
  return { ...item, regra, meio: item.meio === "incluso" ? "" : item.meio };
}

function LinhaAdicional({
  rotulo,
  item,
  disabled,
  livre,
  onChange,
  onRemove,
}: {
  rotulo: string;
  item: EntradaAdicional;
  disabled?: boolean;
  livre?: boolean;
  onChange: (item: EntradaAdicional) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{rotulo}</p>
        {onRemove && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onRemove}>
            Remover
          </Button>
        )}
      </div>
      {livre && (
        <Campo label="Descrição">
          <Input disabled={disabled} value={item.descricao} placeholder="Descreva a despesa" onChange={(evento) => onChange({ ...item, descricao: evento.target.value })} />
        </Campo>
      )}
      <Campo label="Cobrança">
        <Select
          disabled={disabled}
          value={item.cobrado ? "sim" : "nao"}
          onValueChange={(cobranca) => onChange(cobranca === "sim" ? { ...item, cobrado: true } : entradaAdicionalVazia())}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="nao">Não incluir</SelectItem>
            <SelectItem value="sim">Cobrar</SelectItem>
          </SelectContent>
        </Select>
      </Campo>
      {item.cobrado && (
        <div className="grid gap-3 md:grid-cols-3">
          <Campo label="Regra">
            <Select disabled={disabled} value={item.regra || undefined} onValueChange={(regra) => onChange(aoMudarRegra(item, regra as RegraAdicional))}>
              <SelectTrigger><SelectValue placeholder="Escolha a regra" /></SelectTrigger>
              <SelectContent>
                {REGRAS.map((regra) => (
                  <SelectItem key={regra.value} value={regra.value}>{regra.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          {item.regra === "valor_fixo" && (
            <Campo label="Valor">
              <CampoDinheiro disabled={disabled} value={item.valor} onChange={(valor) => onChange({ ...item, valor })} />
            </Campo>
          )}
          <Campo label="Pagamento">
            <Select disabled={disabled} value={item.meio || undefined} onValueChange={(meio) => onChange({ ...item, meio: meio as MeioAdicional })}>
              <SelectTrigger><SelectValue placeholder="Como será pago" /></SelectTrigger>
              <SelectContent>
                {meiosDaRegra(item.regra).map((meio) => (
                  <SelectItem key={meio.value} value={meio.value}>{meio.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
        </div>
      )}
    </div>
  );
}

function DespesasAdicionais({
  value,
  onChange,
  disabled,
}: {
  value: ValoresAdicionaisForm;
  onChange: (value: ValoresAdicionaisForm) => void;
  disabled?: boolean;
}) {
  const outras = value.outras.length ? value.outras : [entradaAdicionalVazia()];
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Despesas adicionais</p>
        <p className="text-xs text-muted-foreground">Transporte, refeição e outras despesas do trabalho. O que ficar em “Não incluir” não entra no PDF.</p>
      </div>
      <LinhaAdicional rotulo="Transporte" item={value.transporte} disabled={disabled} onChange={(transporte) => onChange({ ...value, transporte })} />
      <LinhaAdicional rotulo="Refeição" item={value.refeicao} disabled={disabled} onChange={(refeicao) => onChange({ ...value, refeicao })} />
      {outras.map((item, indice) => (
        <LinhaAdicional
          key={indice}
          rotulo={outras.length > 1 ? `Outras ${indice + 1}` : "Outras"}
          item={item}
          livre
          disabled={disabled}
          onRemove={outras.length > 1 ? () => onChange({ ...value, outras: outras.filter((_, atual) => atual !== indice) }) : undefined}
          onChange={(proxima) => {
            const lista = outras.slice();
            lista[indice] = proxima;
            onChange({ ...value, outras: lista });
          }}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        disabled={disabled || outras.length >= 12}
        onClick={() => onChange({ ...value, outras: [...outras, entradaAdicionalVazia()] })}
      >
        Incluir outra despesa
      </Button>
    </div>
  );
}
