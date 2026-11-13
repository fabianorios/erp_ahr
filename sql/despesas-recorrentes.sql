-- Recorrência de títulos a pagar (despesas).
-- Cole no SQL Editor do projeto do ERP e execute uma vez.
-- Não altera contas a receber, NFS-e, salário, pró-labore nem folha.
-- Não apaga parcela já lançada. Encerrar só muda o status da recorrência.
-- Este arquivo não é aplicado pelo sistema.

CREATE TABLE IF NOT EXISTS public.erp_recorrencias_pagar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modo text NOT NULL CHECK (modo IN ('com_prazo', 'sem_prazo')),
  tipo text NOT NULL CHECK (tipo IN ('operacional', 'financeira')),
  categoria text NOT NULL,
  descricao text NOT NULL,
  favorecido_nome text NOT NULL,
  favorecido_documento text,
  valor numeric(14,2) NOT NULL CHECK (valor > 0),
  dia_vencimento integer NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  primeiro_vencimento date NOT NULL,
  quantidade_meses integer,
  centro_custo_id uuid NOT NULL REFERENCES public.erp_centros_custo(id),
  status text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'encerrada')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_recorrencia_quantidade CHECK (
    (modo = 'com_prazo' AND quantidade_meses BETWEEN 1 AND 120)
    OR (modo = 'sem_prazo' AND quantidade_meses IS NULL)
  ),
  CONSTRAINT erp_recorrencia_sem_folha CHECK (
    categoria !~* '(sal[aá]rio|pr[oó][[:space:]-]?labore|folha de pagamento)'
    AND descricao !~* '(sal[aá]rio|pr[oó][[:space:]-]?labore|folha de pagamento)'
  )
);

ALTER TABLE public.erp_despesas
  ADD COLUMN IF NOT EXISTS recorrencia_id uuid REFERENCES public.erp_recorrencias_pagar(id),
  ADD COLUMN IF NOT EXISTS parcela integer CHECK (parcela IS NULL OR parcela >= 1);

CREATE INDEX IF NOT EXISTS erp_despesas_recorrencia_idx ON public.erp_despesas (recorrencia_id);
CREATE UNIQUE INDEX IF NOT EXISTS erp_despesas_recorrencia_mes_idx
  ON public.erp_despesas (recorrencia_id, competencia)
  WHERE recorrencia_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS erp_despesas_recorrencia_parcela_idx
  ON public.erp_despesas (recorrencia_id, parcela)
  WHERE recorrencia_id IS NOT NULL;

DROP TRIGGER IF EXISTS erp_recorrencias_pagar_updated ON public.erp_recorrencias_pagar;
CREATE TRIGGER erp_recorrencias_pagar_updated BEFORE UPDATE ON public.erp_recorrencias_pagar
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.erp_criar_parcela_recorrente(
  p_recorrencia_id uuid,
  p_parcela integer,
  p_tipo text,
  p_categoria text,
  p_descricao text,
  p_favorecido_nome text,
  p_favorecido_documento text,
  p_valor numeric,
  p_competencia date,
  p_centro_custo_id uuid,
  p_vencimento date
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  rec public.erp_recorrencias_pagar%ROWTYPE;
  novo uuid;
  ultimo integer;
  dia_efetivo integer;
BEGIN
  SELECT * INTO rec FROM public.erp_recorrencias_pagar WHERE id = p_recorrencia_id;
  IF rec.id IS NULL THEN
    RAISE EXCEPTION 'Recorrência não encontrada.';
  END IF;
  IF rec.status <> 'ativa' THEN
    RAISE EXCEPTION 'Recorrência encerrada não gera título.';
  END IF;
  IF p_valor IS DISTINCT FROM rec.valor THEN
    RAISE EXCEPTION 'A parcela tem o valor da recorrência.';
  END IF;
  IF p_centro_custo_id IS DISTINCT FROM rec.centro_custo_id
     OR p_tipo IS DISTINCT FROM rec.tipo
     OR p_categoria IS DISTINCT FROM rec.categoria
     OR p_descricao IS DISTINCT FROM rec.descricao
     OR p_favorecido_nome IS DISTINCT FROM rec.favorecido_nome THEN
    RAISE EXCEPTION 'A parcela repete o cadastro da recorrência.';
  END IF;
  ultimo := EXTRACT(day FROM (date_trunc('month', p_vencimento) + interval '1 month - 1 day'))::integer;
  dia_efetivo := LEAST(rec.dia_vencimento, ultimo);
  IF EXTRACT(day FROM p_vencimento)::integer <> dia_efetivo THEN
    RAISE EXCEPTION 'O vencimento da parcela precisa cair no dia da recorrência.';
  END IF;
  IF date_trunc('month', p_competencia)::date <> date_trunc('month', p_vencimento)::date THEN
    RAISE EXCEPTION 'A competência da parcela é o mês do vencimento.';
  END IF;
  IF rec.modo = 'com_prazo' AND (p_parcela < 1 OR p_parcela > rec.quantidade_meses) THEN
    RAISE EXCEPTION 'Parcela fora da quantidade de meses.';
  END IF;
  IF rec.modo = 'sem_prazo' AND p_parcela < 1 THEN
    RAISE EXCEPTION 'Parcela inválida.';
  END IF;
  INSERT INTO public.erp_despesas (
    tipo, categoria, descricao, favorecido_nome, favorecido_documento,
    valor, competencia, centro_custo_id, recorrencia_id, parcela
  ) VALUES (
    p_tipo, p_categoria, p_descricao, p_favorecido_nome, NULLIF(p_favorecido_documento, ''),
    p_valor, p_competencia, p_centro_custo_id, p_recorrencia_id, p_parcela
  ) RETURNING id INTO novo;
  INSERT INTO public.erp_contas_pagar (despesa_id, valor, vencimento, status)
  VALUES (novo, p_valor, p_vencimento, 'a_pagar');
  RETURN novo;
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_encerrar_recorrencia_pagar(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  antes integer;
  depois integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.erp_recorrencias_pagar WHERE id = p_id) THEN
    RAISE EXCEPTION 'Recorrência não encontrada.';
  END IF;
  SELECT COUNT(*) INTO antes FROM public.erp_despesas WHERE recorrencia_id = p_id;
  UPDATE public.erp_recorrencias_pagar
  SET status = 'encerrada'
  WHERE id = p_id AND status = 'ativa';
  SELECT COUNT(*) INTO depois FROM public.erp_despesas WHERE recorrencia_id = p_id;
  IF depois IS DISTINCT FROM antes THEN
    RAISE EXCEPTION 'Encerrar a recorrência não apaga título, mesmo pago.';
  END IF;
  RETURN p_id;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_recorrencias_pagar TO authenticated, service_role;
ALTER TABLE public.erp_recorrencias_pagar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_staff_all ON public.erp_recorrencias_pagar;
CREATE POLICY erp_staff_all ON public.erp_recorrencias_pagar FOR ALL TO authenticated USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'consultor')
  OR public.has_role(auth.uid(), 'editor')
  OR public.has_role(auth.uid(), 'beta_tester')
) WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'consultor')
  OR public.has_role(auth.uid(), 'editor')
  OR public.has_role(auth.uid(), 'beta_tester')
);

GRANT EXECUTE ON FUNCTION public.erp_criar_parcela_recorrente(uuid, integer, text, text, text, text, text, numeric, date, uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.erp_encerrar_recorrencia_pagar(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
