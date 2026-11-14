-- Conta a pagar pode cair em qualquer centro ativo.
-- A categoria financeira continua sendo juros, tarifa bancária ou IOF.
-- Não apaga despesa nem centro. Não altera o banco do Gestão.
-- Cole este script no SQL Editor do projeto do ERP e execute uma vez.

CREATE OR REPLACE FUNCTION public.erp_despesa_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  tipo_centro text;
  ativo boolean;
BEGIN
  SELECT c.tipo, c.ativo INTO tipo_centro, ativo
  FROM public.erp_centros_custo c WHERE c.id = NEW.centro_custo_id;
  IF tipo_centro IS NULL THEN
    RAISE EXCEPTION 'Centro de custo não encontrado.';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.centro_custo_id IS DISTINCT FROM OLD.centro_custo_id) AND ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'O centro de custo está inativo.';
  END IF;
  IF NEW.tipo = 'financeira' AND NEW.categoria NOT IN ('juros', 'tarifa_bancaria', 'iof') THEN
    RAISE EXCEPTION 'Categoria financeira é juros, tarifa bancária ou IOF.';
  END IF;
  IF btrim(NEW.descricao) = '' OR btrim(NEW.favorecido_nome) = '' OR btrim(NEW.categoria) = '' THEN
    RAISE EXCEPTION 'Informe descrição, favorecido e categoria.';
  END IF;
  NEW.competencia := date_trunc('month', NEW.competencia)::date;
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM public.erp_contas_pagar cp WHERE cp.despesa_id = NEW.id AND cp.status = 'paga'
  ) THEN
    IF NEW.valor IS DISTINCT FROM OLD.valor
       OR NEW.centro_custo_id IS DISTINCT FROM OLD.centro_custo_id
       OR NEW.categoria IS DISTINCT FROM OLD.categoria
       OR NEW.tipo IS DISTINCT FROM OLD.tipo THEN
      RAISE EXCEPTION 'Conta paga trava valor, centro e categoria da despesa.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
