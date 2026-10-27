-- Contas a receber previstas.
-- Projeto ERP. Não altera o banco do Gestão.
-- 1. Proposta aceita gera uma parcela prevista por vencimento com valor.
--    Liga na proposta e, se já existir, no contrato, mesmo em rascunho.
-- 2. Título avulso não tem proposta nem contrato e exige origem.
-- Não emite NFS-e nem boleto. Não duplica parcela já gravada.
-- Cole este script no SQL Editor do projeto do ERP e execute uma vez.

ALTER TABLE public.erp_contas_receber
  ALTER COLUMN contrato_id DROP NOT NULL,
  ALTER COLUMN cliente_id DROP NOT NULL,
  ALTER COLUMN centro_custo_id DROP NOT NULL;

ALTER TABLE public.erp_contas_receber
  ADD COLUMN IF NOT EXISTS proposta_id uuid REFERENCES public.erp_propostas(id),
  ADD COLUMN IF NOT EXISTS parcela integer,
  ADD COLUMN IF NOT EXISTS origem text;

ALTER TABLE public.erp_contas_receber
  DROP CONSTRAINT IF EXISTS erp_contas_receber_vinculo_chk;

ALTER TABLE public.erp_contas_receber
  ADD CONSTRAINT erp_contas_receber_vinculo_chk CHECK (
    (
      proposta_id IS NOT NULL
      AND parcela IS NOT NULL
      AND parcela > 0
      AND origem IS NULL
    )
    OR (
      contrato_id IS NOT NULL
      AND proposta_id IS NULL
      AND origem IS NULL
      AND parcela IS NULL
    )
    OR (
      contrato_id IS NULL
      AND proposta_id IS NULL
      AND parcela IS NULL
      AND origem IS NOT NULL
      AND char_length(btrim(origem)) BETWEEN 2 AND 200
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS erp_contas_receber_parcela_uidx
  ON public.erp_contas_receber (proposta_id, parcela)
  WHERE proposta_id IS NOT NULL AND parcela IS NOT NULL;

CREATE OR REPLACE FUNCTION public.erp_titulo_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  contrato public.erp_contratos%ROWTYPE;
  proposta_status text;
  proposta_cliente uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.valor_recebido := NULL;
    NEW.data_recebimento := NULL;
    NEW.meio_recebimento := NULL;
    NEW.status := 'previsto';
    IF NEW.proposta_id IS NOT NULL THEN
      SELECT status, cliente_id INTO proposta_status, proposta_cliente
      FROM public.erp_propostas WHERE id = NEW.proposta_id;
      IF proposta_status IS NULL THEN
        RAISE EXCEPTION 'Proposta não encontrada.';
      END IF;
      IF proposta_status <> 'aceita' THEN
        RAISE EXCEPTION 'Conta prevista só nasce de proposta aceita.';
      END IF;
      IF NEW.parcela IS NULL OR NEW.parcela <= 0 THEN
        RAISE EXCEPTION 'A parcela da proposta é obrigatória.';
      END IF;
      NEW.origem := NULL;
      NEW.cliente_id := proposta_cliente;
      NEW.centro_custo_id := NULL;
      IF NEW.contrato_id IS NOT NULL THEN
        SELECT * INTO contrato FROM public.erp_contratos WHERE id = NEW.contrato_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Contrato não encontrado.';
        END IF;
        IF contrato.proposta_id IS DISTINCT FROM NEW.proposta_id THEN
          RAISE EXCEPTION 'O contrato não é desta proposta.';
        END IF;
        IF contrato.status NOT IN ('rascunho', 'vigente') THEN
          RAISE EXCEPTION 'Contrato encerrado ou cancelado não recebe parcela prevista.';
        END IF;
        NEW.cliente_id := contrato.cliente_id;
        IF contrato.status = 'vigente' THEN
          IF contrato.centro_custo_id IS NULL THEN
            RAISE EXCEPTION 'Contrato vigente sem centro de custo.';
          END IF;
          NEW.centro_custo_id := contrato.centro_custo_id;
        END IF;
      END IF;
    ELSIF NEW.contrato_id IS NOT NULL THEN
      SELECT * INTO contrato FROM public.erp_contratos WHERE id = NEW.contrato_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Contrato não encontrado.';
      END IF;
      IF contrato.status <> 'vigente' THEN
        RAISE EXCEPTION 'Conta a receber só abre com o contrato vigente.';
      END IF;
      IF contrato.centro_custo_id IS NULL THEN
        RAISE EXCEPTION 'Contrato vigente sem centro de custo.';
      END IF;
      NEW.cliente_id := contrato.cliente_id;
      NEW.centro_custo_id := contrato.centro_custo_id;
      NEW.proposta_id := NULL;
      NEW.parcela := NULL;
      NEW.origem := NULL;
    ELSE
      NEW.origem := btrim(COALESCE(NEW.origem, ''));
      IF char_length(NEW.origem) < 2 OR char_length(NEW.origem) > 200 THEN
        RAISE EXCEPTION 'Informe de onde veio este título.';
      END IF;
      NEW.contrato_id := NULL;
      NEW.proposta_id := NULL;
      NEW.parcela := NULL;
      NEW.cliente_id := NULL;
      NEW.centro_custo_id := NULL;
    END IF;
  ELSE
    IF OLD.proposta_id IS NOT NULL AND NEW.proposta_id IS DISTINCT FROM OLD.proposta_id THEN
      RAISE EXCEPTION 'A proposta do título não muda.';
    END IF;
    IF OLD.proposta_id IS NULL AND NEW.proposta_id IS NOT NULL AND (NEW.parcela IS NULL OR NEW.parcela <= 0) THEN
      RAISE EXCEPTION 'A proposta do título não muda.';
    END IF;
    IF OLD.parcela IS NOT NULL AND NEW.parcela IS DISTINCT FROM OLD.parcela THEN
      RAISE EXCEPTION 'A parcela do título não muda.';
    END IF;
    IF OLD.contrato_id IS NOT NULL AND NEW.contrato_id IS DISTINCT FROM OLD.contrato_id THEN
      RAISE EXCEPTION 'O contrato do título não muda.';
    END IF;
    IF NEW.proposta_id IS NOT NULL AND NEW.contrato_id IS NULL THEN
      IF NEW.cliente_id IS DISTINCT FROM OLD.cliente_id OR NEW.centro_custo_id IS NOT NULL OR NEW.origem IS NOT NULL THEN
        RAISE EXCEPTION 'Parcela prevista não muda de cliente nem ganha origem.';
      END IF;
    ELSIF NEW.contrato_id IS NOT NULL THEN
      SELECT * INTO contrato FROM public.erp_contratos WHERE id = NEW.contrato_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Contrato não encontrado.';
      END IF;
      IF OLD.contrato_id IS NULL AND (NEW.proposta_id IS NULL OR contrato.proposta_id IS DISTINCT FROM NEW.proposta_id) THEN
        RAISE EXCEPTION 'O título só liga ao contrato da mesma proposta.';
      END IF;
      IF NEW.cliente_id IS DISTINCT FROM contrato.cliente_id THEN
        RAISE EXCEPTION 'Cliente e centro da conta vêm do contrato.';
      END IF;
      IF contrato.status = 'vigente' THEN
        IF NEW.centro_custo_id IS DISTINCT FROM contrato.centro_custo_id THEN
          RAISE EXCEPTION 'Cliente e centro da conta vêm do contrato.';
        END IF;
      ELSIF NEW.centro_custo_id IS NOT NULL THEN
        RAISE EXCEPTION 'O centro do título entra quando o contrato fica vigente.';
      END IF;
      IF NEW.origem IS NOT NULL THEN
        RAISE EXCEPTION 'Parcela de contrato não tem origem avulsa.';
      END IF;
    ELSE
      IF NEW.cliente_id IS NOT NULL OR NEW.centro_custo_id IS NOT NULL OR NEW.proposta_id IS NOT NULL OR NEW.parcela IS NOT NULL THEN
        RAISE EXCEPTION 'Título sem contrato não leva cliente, centro nem proposta.';
      END IF;
      IF NEW.origem IS DISTINCT FROM OLD.origem AND OLD.status <> 'previsto' THEN
        RAISE EXCEPTION 'A origem só muda enquanto o título está previsto.';
      END IF;
      NEW.origem := btrim(COALESCE(NEW.origem, ''));
      IF char_length(NEW.origem) < 2 OR char_length(NEW.origem) > 200 THEN
        RAISE EXCEPTION 'Informe de onde veio este título.';
      END IF;
    END IF;
    IF OLD.status <> 'previsto'
       AND (NEW.valor IS DISTINCT FROM OLD.valor
            OR NEW.competencia IS DISTINCT FROM OLD.competencia
            OR NEW.vencimento IS DISTINCT FROM OLD.vencimento
            OR NEW.descricao IS DISTINCT FROM OLD.descricao) THEN
      RAISE EXCEPTION 'Valor, vencimento e competência só mudam enquanto o título está previsto.';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
      (OLD.status = 'previsto' AND NEW.status IN ('faturado', 'cancelado'))
      OR (OLD.status = 'faturado' AND NEW.status IN ('recebido', 'cancelado'))
    ) THEN
      RAISE EXCEPTION 'Transição de status da conta a receber não permitida.';
    END IF;
    IF OLD.status = 'faturado' AND NEW.status = 'cancelado' THEN
      IF EXISTS (SELECT 1 FROM public.erp_nfse n WHERE n.conta_receber_id = NEW.id AND n.status = 'informada') THEN
        RAISE EXCEPTION 'Cancele a NFS-e antes de cancelar a conta.';
      END IF;
      IF EXISTS (SELECT 1 FROM public.erp_boletos b WHERE b.conta_receber_id = NEW.id AND b.status <> 'cancelado') THEN
        RAISE EXCEPTION 'Cancele o boleto antes de cancelar a conta.';
      END IF;
    END IF;
    IF NEW.status = 'recebido' AND OLD.status IS DISTINCT FROM 'recebido' THEN
      IF NEW.valor_recebido IS NULL OR NEW.valor_recebido <= 0 OR NEW.data_recebimento IS NULL
         OR NEW.meio_recebimento NOT IN ('boleto', 'pix', 'manual') THEN
        RAISE EXCEPTION 'A baixa precisa de valor recebido, data e meio.';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.erp_boletos b
        WHERE b.conta_receber_id = NEW.id AND b.status IN ('aberto', 'atrasado')
      ) AND current_setting('erp.baixa_boleto', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'Baixe pelo boleto pago ou cancele o boleto antes da baixa manual.';
      END IF;
    END IF;
    IF NEW.status = 'recebido' AND OLD.status = 'recebido'
       AND (NEW.valor_recebido IS DISTINCT FROM OLD.valor_recebido
            OR NEW.data_recebimento IS DISTINCT FROM OLD.data_recebimento
            OR NEW.meio_recebimento IS DISTINCT FROM OLD.meio_recebimento) THEN
      RAISE EXCEPTION 'A baixa trava valor recebido, data e meio.';
    END IF;
    IF NEW.status <> 'recebido'
       AND (NEW.valor_recebido IS NOT NULL OR NEW.data_recebimento IS NOT NULL OR NEW.meio_recebimento IS NOT NULL) THEN
      RAISE EXCEPTION 'Valor recebido, data e meio só existem na baixa.';
    END IF;
  END IF;
  IF NEW.valor <= 0 THEN
    RAISE EXCEPTION 'O valor do título precisa ser maior que zero.';
  END IF;
  IF btrim(NEW.descricao) = '' THEN
    RAISE EXCEPTION 'Informe a descrição do título.';
  END IF;
  NEW.competencia := date_trunc('month', NEW.competencia)::date;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_gerar_titulos_proposta(p_proposta_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  proposta public.erp_propostas%ROWTYPE;
  contrato public.erp_contratos%ROWTYPE;
  tem_contrato boolean := false;
  item jsonb;
  ordem integer;
  total integer;
  venc date;
  val numeric(14,2);
  criados integer := 0;
  ligado uuid;
BEGIN
  SELECT * INTO proposta FROM public.erp_propostas WHERE id = p_proposta_id;
  IF NOT FOUND OR proposta.status <> 'aceita' THEN
    RETURN 0;
  END IF;
  SELECT * INTO contrato FROM public.erp_contratos WHERE proposta_id = p_proposta_id;
  tem_contrato := FOUND AND contrato.status IN ('rascunho', 'vigente');
  IF proposta.agenda_pagamento IS NULL OR jsonb_typeof(proposta.agenda_pagamento->'parcelas') <> 'array' THEN
    RETURN 0;
  END IF;
  total := jsonb_array_length(proposta.agenda_pagamento->'parcelas');
  FOR item, ordem IN
    SELECT parcela, ordinalidade::integer
    FROM jsonb_array_elements(proposta.agenda_pagamento->'parcelas') WITH ORDINALITY AS lista(parcela, ordinalidade)
  LOOP
    IF COALESCE(item->>'vencimento', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      CONTINUE;
    END IF;
    IF COALESCE(item->>'valor', '') !~ '^[0-9]+(\.[0-9]+)?$' THEN
      CONTINUE;
    END IF;
    BEGIN
      venc := (item->>'vencimento')::date;
      val := round((item->>'valor')::numeric, 2);
    EXCEPTION WHEN others THEN
      venc := NULL;
      val := NULL;
    END;
    IF venc IS NULL OR val IS NULL OR val <= 0 THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.erp_contas_receber r
      WHERE r.proposta_id = p_proposta_id AND r.parcela = ordem
    ) THEN
      CONTINUE;
    END IF;
    ligado := NULL;
    IF tem_contrato THEN
      SELECT r.id INTO ligado
      FROM public.erp_contas_receber r
      WHERE r.contrato_id = contrato.id
        AND r.proposta_id IS NULL
        AND r.parcela IS NULL
        AND r.origem IS NULL
        AND r.vencimento = venc
        AND r.valor = val
        AND r.status <> 'cancelado'
      LIMIT 1;
    END IF;
    IF ligado IS NOT NULL THEN
      UPDATE public.erp_contas_receber
      SET proposta_id = p_proposta_id, parcela = ordem
      WHERE id = ligado;
      CONTINUE;
    END IF;
    INSERT INTO public.erp_contas_receber (
      contrato_id, proposta_id, cliente_id, centro_custo_id, parcela, descricao, valor, vencimento, competencia, status
    ) VALUES (
      CASE WHEN tem_contrato THEN contrato.id ELSE NULL END,
      p_proposta_id,
      CASE WHEN tem_contrato THEN contrato.cliente_id ELSE proposta.cliente_id END,
      CASE WHEN tem_contrato AND contrato.status = 'vigente' THEN contrato.centro_custo_id ELSE NULL END,
      ordem,
      'Parcela ' || ordem || '/' || total,
      val,
      venc,
      date_trunc('month', venc)::date,
      'previsto'
    );
    criados := criados + 1;
  END LOOP;
  RETURN criados;
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_proposta_aceita_titulos()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'aceita' AND OLD.status IS DISTINCT FROM 'aceita' THEN
    PERFORM public.erp_gerar_titulos_proposta(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS erp_propostas_aceita_titulos ON public.erp_propostas;
CREATE TRIGGER erp_propostas_aceita_titulos
AFTER UPDATE OF status ON public.erp_propostas
FOR EACH ROW EXECUTE FUNCTION public.erp_proposta_aceita_titulos();

CREATE OR REPLACE FUNCTION public.erp_criar_contrato(p_proposta_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  novo uuid;
BEGIN
  INSERT INTO public.erp_contratos (proposta_id, cliente_id, valor_contratado, forma_cobranca, status, texto)
  SELECT p.id, p.cliente_id, p.valor_total, p.forma_cobranca, 'rascunho', ''
  FROM public.erp_propostas p
  WHERE p.id = p_proposta_id AND p.status = 'aceita'
  RETURNING id INTO novo;
  IF novo IS NULL THEN
    RAISE EXCEPTION 'Contrato nasce de uma proposta aceita.';
  END IF;
  UPDATE public.erp_contas_receber
  SET contrato_id = novo,
      cliente_id = (SELECT cliente_id FROM public.erp_contratos WHERE id = novo)
  WHERE proposta_id = p_proposta_id
    AND contrato_id IS NULL
    AND status <> 'cancelado';
  RETURN novo;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Uma versão aceita gera no máximo um contrato.';
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_vigorar_contrato(p_id uuid, p_inicio date, p_fim date, p_texto text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  centro uuid;
  nome text;
  atual text;
  proposta uuid;
BEGIN
  SELECT status, proposta_id INTO atual, proposta FROM public.erp_contratos WHERE id = p_id FOR UPDATE;
  IF atual IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;
  IF atual <> 'rascunho' THEN
    RAISE EXCEPTION 'Só contrato em rascunho fica vigente.';
  END IF;
  IF p_inicio IS NULL THEN
    RAISE EXCEPTION 'Informe o início da vigência.';
  END IF;
  IF p_fim IS NOT NULL AND p_fim < p_inicio THEN
    RAISE EXCEPTION 'O fim da vigência não pode ser antes do início.';
  END IF;
  UPDATE public.erp_contratos
  SET inicio = p_inicio, fim = p_fim, texto = COALESCE(p_texto, '')
  WHERE id = p_id;
  SELECT id INTO centro FROM public.erp_centros_custo WHERE contrato_id = p_id AND tipo = 'contrato';
  IF centro IS NULL THEN
    SELECT 'Contrato ' || pr.numero || ' v' || pr.versao || ' — ' || c.name INTO nome
    FROM public.erp_contratos ct
    JOIN public.erp_propostas pr ON pr.id = ct.proposta_id
    JOIN public.clients c ON c.id = ct.cliente_id
    WHERE ct.id = p_id;
    INSERT INTO public.erp_centros_custo (nome, tipo, contrato_id, ativo)
    VALUES (COALESCE(nome, 'Contrato'), 'contrato', p_id, true)
    RETURNING id INTO centro;
  END IF;
  UPDATE public.erp_contratos
  SET status = 'vigente', centro_custo_id = centro
  WHERE id = p_id;
  UPDATE public.erp_contas_receber
  SET contrato_id = p_id,
      cliente_id = (SELECT cliente_id FROM public.erp_contratos WHERE id = p_id),
      centro_custo_id = centro
  WHERE proposta_id = proposta
    AND status <> 'cancelado';
  PERFORM public.erp_gerar_titulos_proposta(proposta);
  IF NOT EXISTS (
    SELECT 1 FROM public.erp_contas_receber r
    WHERE r.proposta_id = proposta AND r.status <> 'cancelado'
  ) THEN
    RAISE EXCEPTION 'A proposta precisa da forma de pagamento com as parcelas.';
  END IF;
  RETURN centro;
END;
$$;

GRANT EXECUTE ON FUNCTION public.erp_gerar_titulos_proposta(uuid) TO service_role;

DO $$
DECLARE
  proposta uuid;
BEGIN
  FOR proposta IN SELECT id FROM public.erp_propostas WHERE status = 'aceita'
  LOOP
    PERFORM public.erp_gerar_titulos_proposta(proposta);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
