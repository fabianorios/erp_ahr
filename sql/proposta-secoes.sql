-- Seções do documento da proposta no projeto ERP.
-- Não altera forma_cobranca: o gatilho continua gravando mista.
ALTER TABLE public.erp_propostas
  ADD COLUMN IF NOT EXISTS responsabilidades text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS prazo text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS forma_pagamento text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS agenda_pagamento jsonb NOT NULL DEFAULT '{}'::jsonb;

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

