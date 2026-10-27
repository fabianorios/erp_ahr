import { RichTextEditor } from "@/components/ui/rich-text";
import { Input } from "@/components/ui/input";
import { Campo } from "@/components/erp/apresentacao";
import type { TextosProposta } from "@/services/erp/domain";

const CAMPOS = [
  ["visaoGeral", "Visão geral", "Panorama do trabalho, na seção Visão geral do PDF."],
  ["escopo", "Escopo", "O que entra no trabalho."],
  ["responsabilidades", "Responsabilidades", "O que fica com a AHR e com o cliente."],
  ["prazo", "Prazo", "Planejamento de trabalho."],
  ["execucao", "Execução das atividades", "Como o trabalho será executado."],
] as const;

export function TextosPropostaCampos({
  value,
  onChange,
  disabled,
}: {
  value: TextosProposta;
  onChange: (value: TextosProposta) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <Campo label="Título da proposta">
        <Input
          value={value.titulo}
          disabled={disabled}
          placeholder="Nome da demanda"
          onChange={(event) => onChange({ ...value, titulo: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">Aparece como Nome da Demanda no PDF.</p>
      </Campo>
      {CAMPOS.map(([chave, rotulo, ajuda]) => (
        <Campo key={chave} label={rotulo}>
          <RichTextEditor
            value={value[chave]}
            disabled={disabled}
            placeholder={rotulo}
            onChange={(html) => onChange({ ...value, [chave]: html })}
          />
          <p className="text-xs text-muted-foreground">{ajuda}</p>
        </Campo>
      ))}
      <Campo label="Validade da proposta">
        <Input
          value={value.validade}
          disabled={disabled}
          placeholder="31/12/2026 ou 30 dias"
          onChange={(event) => onChange({ ...value, validade: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">Data ou texto curto. A data entra por extenso sob o título do PDF.</p>
      </Campo>
    </>
  );
}
