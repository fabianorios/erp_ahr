-- Valores da proposta: capa (título, visão geral, execução, validade) e despesas adicionais.
-- Projeto ERP. Não altera o banco do Gestão.
-- Pode ser executado mesmo que proposta-capa.sql ainda não tenha rodado.

ALTER TABLE public.erp_propostas
  ADD COLUMN IF NOT EXISTS titulo text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS visao_geral text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS execucao text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS validade text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS valores_adicionais jsonb NOT NULL DEFAULT '{}'::jsonb;

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
       OR NEW.titulo IS DISTINCT FROM OLD.titulo
       OR NEW.visao_geral IS DISTINCT FROM OLD.visao_geral
       OR NEW.escopo IS DISTINCT FROM OLD.escopo
       OR NEW.responsabilidades IS DISTINCT FROM OLD.responsabilidades
       OR NEW.prazo IS DISTINCT FROM OLD.prazo
       OR NEW.execucao IS DISTINCT FROM OLD.execucao
       OR NEW.validade IS DISTINCT FROM OLD.validade
       OR NEW.forma_pagamento IS DISTINCT FROM OLD.forma_pagamento
       OR NEW.agenda_pagamento IS DISTINCT FROM OLD.agenda_pagamento
       OR NEW.valores_adicionais IS DISTINCT FROM OLD.valores_adicionais
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
    cliente_id, numero, versao, status, titulo, visao_geral, escopo, responsabilidades, prazo, execucao, validade,
    forma_pagamento, agenda_pagamento, valores_adicionais, valor_total, inicio_sugerido, fim_sugerido, forma_cobranca
  ) VALUES (
    origem.cliente_id, origem.numero, origem.versao + 1, 'rascunho', origem.titulo, origem.visao_geral, origem.escopo,
    origem.responsabilidades, origem.prazo, origem.execucao, origem.validade, origem.forma_pagamento, origem.agenda_pagamento,
    origem.valores_adicionais, origem.valor_total, origem.inicio_sugerido, origem.fim_sugerido, origem.forma_cobranca
  ) RETURNING id INTO novo;
  RETURN novo;
END;
$$;

NOTIFY pgrst, 'reload schema';
