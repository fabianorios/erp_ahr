-- Agenda de pagamento da proposta. forma_cobranca permanece mista.
-- Nao altera o banco do Gestao.

ALTER TABLE public.erp_propostas
  ADD COLUMN IF NOT EXISTS responsabilidades text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS prazo text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS forma_pagamento text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS agenda_pagamento jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;


CREATE OR REPLACE FUNCTION public.erp_proposta_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  documento text;
BEGIN
  SELECT regexp_replace(COALESCE(c.document, ''), '\D', '', 'g') INTO documento
  FROM public.clients c WHERE c.id = NEW.cliente_id;
  IF documento IS NULL OR documento !~ '^(\d{11}|\d{14})$' THEN
    RAISE EXCEPTION 'O cliente precisa de CPF ou CNPJ.';
  END IF;
  NEW.forma_cobranca := 'mista';
  IF NEW.fim_sugerido IS NOT NULL AND NEW.inicio_sugerido IS NOT NULL AND NEW.fim_sugerido < NEW.inicio_sugerido THEN
    RAISE EXCEPTION 'O fim da vigência não pode ser antes do início.';
  END IF;
  IF NEW.status = 'aceita' AND NEW.valor_total <= 0 THEN
    RAISE EXCEPTION 'A proposta aceita precisa de valor maior que zero.';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'rascunho' THEN
    IF NEW.cliente_id IS DISTINCT FROM OLD.cliente_id
       OR NEW.escopo IS DISTINCT FROM OLD.escopo
       OR NEW.responsabilidades IS DISTINCT FROM OLD.responsabilidades
       OR NEW.prazo IS DISTINCT FROM OLD.prazo
       OR NEW.forma_pagamento IS DISTINCT FROM OLD.forma_pagamento
       OR NEW.agenda_pagamento IS DISTINCT FROM OLD.agenda_pagamento
       OR NEW.valor_total IS DISTINCT FROM OLD.valor_total
       OR NEW.inicio_sugerido IS DISTINCT FROM OLD.inicio_sugerido
       OR NEW.fim_sugerido IS DISTINCT FROM OLD.fim_sugerido
       OR NEW.numero IS DISTINCT FROM OLD.numero
       OR NEW.versao IS DISTINCT FROM OLD.versao THEN
      RAISE EXCEPTION 'Proposta enviada fica como foi mandada. Correção vira versão nova.';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'rascunho' AND NEW.status IN ('enviada', 'recusada', 'expirada'))
      OR (OLD.status = 'enviada' AND NEW.status IN ('aceita', 'recusada', 'expirada'))
    ) THEN
      RAISE EXCEPTION 'Transição de status da proposta não permitida.';
    END IF;
  END IF;
  IF NEW.status = 'enviada' AND NEW.enviada_em IS NULL THEN
    NEW.enviada_em := now();
  END IF;
  IF NEW.status = 'aceita' AND NEW.aceita_em IS NULL THEN
    NEW.aceita_em := now();
  END IF;
  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.erp_nova_versao(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  origem public.erp_propostas%ROWTYPE;
  novo uuid;
BEGIN
  SELECT * INTO origem FROM public.erp_propostas WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposta não encontrada.';
  END IF;
  IF origem.status = 'rascunho' THEN
    RAISE EXCEPTION 'A versão em rascunho ainda pode ser editada.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.erp_propostas WHERE numero = origem.numero AND status = 'rascunho') THEN
    RAISE EXCEPTION 'Já existe uma versão em rascunho desta proposta.';
  END IF;
  INSERT INTO public.erp_propostas (
    cliente_id, numero, versao, status, escopo, responsabilidades, prazo, forma_pagamento, agenda_pagamento,
    valor_total, inicio_sugerido, fim_sugerido, forma_cobranca
  ) VALUES (
    origem.cliente_id, origem.numero, origem.versao + 1, 'rascunho', origem.escopo,
    origem.responsabilidades, origem.prazo, origem.forma_pagamento, origem.agenda_pagamento,
    origem.valor_total, origem.inicio_sugerido, origem.fim_sugerido, origem.forma_cobranca
  ) RETURNING id INTO novo;
  RETURN novo;
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
  agenda jsonb;
  total numeric(14,2);
  parcela record;
  soma numeric(14,2) := 0;
  n integer := 0;
  qtd integer;
  venc date;
  val numeric(14,2);
BEGIN
  SELECT status INTO atual FROM public.erp_contratos WHERE id = p_id FOR UPDATE;
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

  SELECT p.agenda_pagamento, p.valor_total INTO agenda, total
  FROM public.erp_propostas p
  JOIN public.erp_contratos ct ON ct.proposta_id = p.id
  WHERE ct.id = p_id;
  IF agenda IS NULL OR jsonb_typeof(agenda->'parcelas') <> 'array' OR jsonb_array_length(agenda->'parcelas') = 0 THEN
    RAISE EXCEPTION 'A proposta precisa da forma de pagamento com as parcelas.';
  END IF;
  qtd := jsonb_array_length(agenda->'parcelas');
  FOR parcela IN SELECT jsonb_array_elements(agenda->'parcelas') AS item
  LOOP
    n := n + 1;
    venc := (parcela.item->>'vencimento')::date;
    val := round((parcela.item->>'valor')::numeric, 2);
    IF val <= 0 OR venc IS NULL THEN
      RAISE EXCEPTION 'Cada parcela precisa de vencimento e valor maior que zero.';
    END IF;
    soma := soma + val;
    INSERT INTO public.erp_contas_receber (
      contrato_id, cliente_id, centro_custo_id, descricao, valor, vencimento, competencia, status
    ) VALUES (
      p_id,
      (SELECT cliente_id FROM public.erp_contratos WHERE id = p_id),
      centro,
      'Parcela ' || n || '/' || qtd,
      val,
      venc,
      date_trunc('month', venc)::date,
      'previsto'
    );
  END LOOP;
  IF round(soma, 2) <> round(total, 2) THEN
    RAISE EXCEPTION 'A soma das parcelas precisa ser o valor total.';
  END IF;

  RETURN centro;
END;
$$;


NOTIFY pgrst, 'reload schema';
