import { Fragment } from "react";
import { RichText, RichTextEditor } from "@/components/ui/rich-text";
import { Input } from "@/components/ui/input";
import { Campo } from "@/components/erp/apresentacao";
import { mostrarResponsabilidadesAntigas, type TextosProposta } from "@/services/erp/domain";

const CAMPOS = [
  ["visaoGeral", "Visão geral", "Panorama do trabalho, na seção Visão geral do PDF."],
  ["escopo", "Escopo", "O que entra no trabalho."],
  ["responsabilidadeCliente", "Responsabilidade do cliente", "O que fica a cargo do cliente. Pode ficar em branco."],
  ["responsabilidadeAhr", "Responsabilidade da AHR Brasil", "O que fica a cargo da AHR Brasil. Pode ficar em branco."],
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
  const antiga = mostrarResponsabilidadesAntigas(value.responsabilidades, value.responsabilidadeCliente, value.responsabilidadeAhr);
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
        <Fragment key={chave}>
          <Campo label={rotulo}>
            <RichTextEditor
              value={value[chave]}
              disabled={disabled}
              placeholder={rotulo}
              onChange={(html) => onChange({ ...value, [chave]: html })}
            />
            <p className="text-xs text-muted-foreground">{ajuda}</p>
          </Campo>
          {chave === "responsabilidadeAhr" && antiga && (
            <Campo label="Responsabilidades já salvas">
              <RichText value={value.responsabilidades} />
              <p className="text-xs text-muted-foreground">
                Texto que já estava neste campo. Continua salvo e sai da tela quando um dos campos acima for preenchido.
              </p>
            </Campo>
          )}
        </Fragment>
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
