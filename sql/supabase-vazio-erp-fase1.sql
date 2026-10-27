/* Fase 1 do ERP no Supabase vazio. Cria clients, set_updated_at e has_role. Nao altera o banco do gestao. */

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  document text,
  email text,
  logradouro text,
  numero text,
  bairro text,
  cidade text,
  uf text,
  cep text,
  complemento text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'consultor', 'editor', 'beta_tester')),
  PRIMARY KEY (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.user_roles TO service_role;

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

GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.erp_centros_custo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('contrato', 'indireto', 'financeiro')),
  contrato_id uuid,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_centros_tipo_contrato CHECK (
    (tipo = 'contrato' AND contrato_id IS NOT NULL)
    OR (tipo <> 'contrato' AND contrato_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.erp_colaboradores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.erp_propostas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clients(id),
  numero text NOT NULL,
  versao integer NOT NULL CHECK (versao >= 1),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'enviada', 'aceita', 'recusada', 'expirada')),
  escopo text NOT NULL DEFAULT '',
  responsabilidades text NOT NULL DEFAULT '',
  prazo text NOT NULL DEFAULT '',
  forma_pagamento text NOT NULL DEFAULT '',
  agenda_pagamento jsonb NOT NULL DEFAULT '{}'::jsonb,
  valor_total numeric(14,2) NOT NULL CHECK (valor_total >= 0),
  inicio_sugerido date,
  fim_sugerido date,
  forma_cobranca text NOT NULL DEFAULT 'mista' CHECK (forma_cobranca = 'mista'),
  enviada_em timestamptz,
  aceita_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (numero, versao)
);

CREATE TABLE IF NOT EXISTS public.erp_contratos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposta_id uuid NOT NULL UNIQUE REFERENCES public.erp_propostas(id),
  cliente_id uuid NOT NULL REFERENCES public.clients(id),
  centro_custo_id uuid UNIQUE REFERENCES public.erp_centros_custo(id),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'vigente', 'encerrado', 'cancelado')),
  valor_contratado numeric(14,2) NOT NULL CHECK (valor_contratado >= 0),
  inicio date,
  fim date,
  forma_cobranca text NOT NULL DEFAULT 'mista' CHECK (forma_cobranca = 'mista'),
  texto text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.erp_centros_custo
  DROP CONSTRAINT IF EXISTS erp_centros_custo_contrato_id_fkey;
ALTER TABLE public.erp_centros_custo
  ADD CONSTRAINT erp_centros_custo_contrato_id_fkey
  FOREIGN KEY (contrato_id) REFERENCES public.erp_contratos(id);

CREATE UNIQUE INDEX IF NOT EXISTS erp_centro_financeiro_unico
  ON public.erp_centros_custo (tipo) WHERE tipo = 'financeiro';
CREATE UNIQUE INDEX IF NOT EXISTS erp_centro_contrato_unico
  ON public.erp_centros_custo (contrato_id) WHERE tipo = 'contrato';
CREATE UNIQUE INDEX IF NOT EXISTS erp_propostas_um_rascunho
  ON public.erp_propostas (numero) WHERE status = 'rascunho';

CREATE TABLE IF NOT EXISTS public.erp_despesas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('operacional', 'financeira')),
  categoria text NOT NULL,
  descricao text NOT NULL,
  favorecido_nome text NOT NULL,
  favorecido_documento text,
  valor numeric(14,2) NOT NULL CHECK (valor > 0),
  competencia date NOT NULL,
  centro_custo_id uuid NOT NULL REFERENCES public.erp_centros_custo(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.erp_contas_pagar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  despesa_id uuid NOT NULL UNIQUE REFERENCES public.erp_despesas(id) ON DELETE CASCADE,
  valor numeric(14,2) NOT NULL CHECK (valor > 0),
  vencimento date NOT NULL,
  status text NOT NULL DEFAULT 'a_pagar' CHECK (status IN ('a_pagar', 'paga', 'cancelada')),
  data_pagamento date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.erp_custos_pessoal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id uuid NOT NULL REFERENCES public.erp_colaboradores(id),
  competencia date NOT NULL,
  salario numeric(14,2) NOT NULL CHECK (salario >= 0),
  encargos numeric(14,2) NOT NULL CHECK (encargos >= 0),
  beneficios numeric(14,2) NOT NULL CHECK (beneficios >= 0),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'fechado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (colaborador_id, competencia)
);

CREATE TABLE IF NOT EXISTS public.erp_rateios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  custo_pessoal_id uuid NOT NULL REFERENCES public.erp_custos_pessoal(id) ON DELETE CASCADE,
  centro_custo_id uuid NOT NULL REFERENCES public.erp_centros_custo(id),
  percentual numeric(5,2) NOT NULL CHECK (percentual > 0 AND percentual <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (custo_pessoal_id, centro_custo_id)
);

CREATE TABLE IF NOT EXISTS public.erp_contas_receber (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES public.erp_contratos(id),
  cliente_id uuid NOT NULL REFERENCES public.clients(id),
  centro_custo_id uuid NOT NULL REFERENCES public.erp_centros_custo(id),
  descricao text NOT NULL,
  valor numeric(14,2) NOT NULL CHECK (valor > 0),
  vencimento date NOT NULL,
  competencia date NOT NULL,
  status text NOT NULL DEFAULT 'previsto' CHECK (status IN ('previsto', 'faturado', 'recebido', 'cancelado')),
  valor_recebido numeric(14,2),
  data_recebimento date,
  meio_recebimento text CHECK (meio_recebimento IN ('boleto', 'pix', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.erp_nfse (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_receber_id uuid NOT NULL UNIQUE REFERENCES public.erp_contas_receber(id),
  numero text NOT NULL,
  valor numeric(14,2) NOT NULL CHECK (valor > 0),
  vencimento date NOT NULL,
  data_emissao date NOT NULL,
  status text NOT NULL CHECK (status IN ('informada', 'cancelada')),
  emissor text NOT NULL DEFAULT 'manual' CHECK (emissor IN ('manual', 'giss')),
  id_externo text,
  codigo_verificacao text,
  municipio text NOT NULL DEFAULT 'São Caetano do Sul/SP',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.erp_boletos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_receber_id uuid NOT NULL UNIQUE REFERENCES public.erp_contas_receber(id),
  numero text NOT NULL,
  valor numeric(14,2) NOT NULL CHECK (valor > 0),
  vencimento date NOT NULL,
  status text NOT NULL CHECK (status IN ('aberto', 'atrasado', 'pago', 'cancelado')),
  linha_digitavel text,
  url_pdf text,
  cora_invoice_id text,
  pix_emv text,
  meio text CHECK (meio IN ('boleto', 'pix')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS erp_despesas_competencia_idx ON public.erp_despesas (competencia);
CREATE INDEX IF NOT EXISTS erp_contas_receber_competencia_idx ON public.erp_contas_receber (competencia);
CREATE INDEX IF NOT EXISTS erp_contas_receber_vencimento_idx ON public.erp_contas_receber (vencimento);
CREATE INDEX IF NOT EXISTS erp_contas_pagar_vencimento_idx ON public.erp_contas_pagar (vencimento);

-- Centros
CREATE OR REPLACE FUNCTION public.erp_centro_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF btrim(NEW.nome) = '' THEN
    RAISE EXCEPTION 'Informe o nome do centro.';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.tipo IS DISTINCT FROM OLD.tipo THEN
    RAISE EXCEPTION 'O tipo do centro não muda.';
  END IF;
  IF NEW.tipo = 'financeiro' AND NEW.ativo IS FALSE THEN
    RAISE EXCEPTION 'O centro financeiro permanece ativo.';
  END IF;
  RETURN NEW;
END;
$$;

-- Despesas
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
  IF NEW.tipo = 'operacional' AND tipo_centro NOT IN ('contrato', 'indireto') THEN
    RAISE EXCEPTION 'Despesa operacional cai em centro de contrato ou indireto.';
  END IF;
  IF NEW.tipo = 'financeira' THEN
    IF tipo_centro <> 'financeiro' THEN
      RAISE EXCEPTION 'Despesa financeira cai só no centro financeiro.';
    END IF;
    IF NEW.categoria NOT IN ('juros', 'tarifa_bancaria', 'iof') THEN
      RAISE EXCEPTION 'Categoria financeira é juros, tarifa bancária ou IOF.';
    END IF;
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

CREATE OR REPLACE FUNCTION public.erp_despesa_sync_conta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.erp_contas_pagar
  SET valor = NEW.valor
  WHERE despesa_id = NEW.id AND status = 'a_pagar' AND valor IS DISTINCT FROM NEW.valor;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_conta_pagar_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  valor_despesa numeric(14,2);
BEGIN
  SELECT valor INTO valor_despesa FROM public.erp_despesas WHERE id = NEW.despesa_id;
  IF valor_despesa IS NULL THEN
    RAISE EXCEPTION 'Despesa não encontrada.';
  END IF;
  IF NEW.valor IS DISTINCT FROM valor_despesa THEN
    RAISE EXCEPTION 'A conta a pagar tem o valor da despesa.';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('paga', 'cancelada') THEN
    RAISE EXCEPTION 'Conta paga ou cancelada não muda.';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
     AND (OLD.status <> 'a_pagar' OR NEW.status NOT IN ('paga', 'cancelada')) THEN
    RAISE EXCEPTION 'Transição da conta a pagar não permitida.';
  END IF;
  IF NEW.status = 'paga' AND NEW.data_pagamento IS NULL THEN
    RAISE EXCEPTION 'Informe a data do pagamento.';
  END IF;
  IF NEW.status <> 'paga' THEN
    NEW.data_pagamento := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_criar_despesa(
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
  novo uuid;
BEGIN
  INSERT INTO public.erp_despesas (
    tipo, categoria, descricao, favorecido_nome, favorecido_documento, valor, competencia, centro_custo_id
  ) VALUES (
    p_tipo, p_categoria, p_descricao, p_favorecido_nome, NULLIF(p_favorecido_documento, ''),
    p_valor, p_competencia, p_centro_custo_id
  ) RETURNING id INTO novo;
  INSERT INTO public.erp_contas_pagar (despesa_id, valor, vencimento, status)
  VALUES (novo, p_valor, p_vencimento, 'a_pagar');
  RETURN novo;
END;
$$;

-- Pessoal
CREATE OR REPLACE FUNCTION public.erp_custo_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  soma numeric(5,2);
  ruim integer;
BEGIN
  NEW.competencia := date_trunc('month', NEW.competencia)::date;
  IF NEW.status = 'fechado' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'fechado') THEN
    SELECT COALESCE(SUM(percentual), 0) INTO soma FROM public.erp_rateios WHERE custo_pessoal_id = NEW.id;
    IF soma <> 100 THEN
      RAISE EXCEPTION 'O rateio só fecha quando a soma dos percentuais é 100.';
    END IF;
    SELECT COUNT(*) INTO ruim
    FROM public.erp_rateios r
    JOIN public.erp_centros_custo c ON c.id = r.centro_custo_id
    WHERE r.custo_pessoal_id = NEW.id AND c.tipo NOT IN ('contrato', 'indireto');
    IF ruim > 0 THEN
      RAISE EXCEPTION 'O rateio só aceita centro de contrato ou indireto.';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'fechado' THEN
    IF NEW.salario IS DISTINCT FROM OLD.salario
       OR NEW.encargos IS DISTINCT FROM OLD.encargos
       OR NEW.beneficios IS DISTINCT FROM OLD.beneficios
       OR NEW.status IS DISTINCT FROM 'fechado'
       OR NEW.colaborador_id IS DISTINCT FROM OLD.colaborador_id
       OR NEW.competencia IS DISTINCT FROM OLD.competencia THEN
      RAISE EXCEPTION 'Custo de pessoal fechado não pode ser alterado.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_rateio_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  st text;
  tipo_centro text;
  custo_id uuid;
BEGIN
  custo_id := COALESCE(NEW.custo_pessoal_id, OLD.custo_pessoal_id);
  SELECT status INTO st FROM public.erp_custos_pessoal WHERE id = custo_id;
  IF st = 'fechado' THEN
    RAISE EXCEPTION 'Custo de pessoal fechado não pode ser alterado.';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT tipo INTO tipo_centro FROM public.erp_centros_custo WHERE id = NEW.centro_custo_id;
    IF tipo_centro NOT IN ('contrato', 'indireto') THEN
      RAISE EXCEPTION 'O rateio só aceita centro de contrato ou indireto.';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_substituir_rateio(p_custo_id uuid, p_linhas jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  st text;
  linha jsonb;
BEGIN
  SELECT status INTO st FROM public.erp_custos_pessoal WHERE id = p_custo_id FOR UPDATE;
  IF st IS NULL THEN
    RAISE EXCEPTION 'Custo de pessoal não encontrado.';
  END IF;
  IF st <> 'rascunho' THEN
    RAISE EXCEPTION 'Custo de pessoal fechado não pode ser alterado.';
  END IF;
  DELETE FROM public.erp_rateios WHERE custo_pessoal_id = p_custo_id;
  FOR linha IN SELECT * FROM jsonb_array_elements(COALESCE(p_linhas, '[]'::jsonb))
  LOOP
    INSERT INTO public.erp_rateios (custo_pessoal_id, centro_custo_id, percentual)
    VALUES (
      p_custo_id,
      (linha->>'centro_custo_id')::uuid,
      (linha->>'percentual')::numeric
    );
  END LOOP;
END;
$$;

-- Proposta e contrato
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

CREATE OR REPLACE FUNCTION public.erp_contrato_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.erp_propostas p WHERE p.id = NEW.proposta_id AND p.status = 'aceita') THEN
      RAISE EXCEPTION 'Contrato nasce de uma proposta aceita.';
    END IF;
    SELECT p.cliente_id, p.valor_total, 'mista'
      INTO NEW.cliente_id, NEW.valor_contratado, NEW.forma_cobranca
    FROM public.erp_propostas p WHERE p.id = NEW.proposta_id;
    NEW.status := 'rascunho';
    NEW.centro_custo_id := NULL;
    RETURN NEW;
  END IF;

  IF NEW.cliente_id IS DISTINCT FROM OLD.cliente_id
     OR NEW.valor_contratado IS DISTINCT FROM OLD.valor_contratado
     OR NEW.forma_cobranca IS DISTINCT FROM OLD.forma_cobranca
     OR NEW.proposta_id IS DISTINCT FROM OLD.proposta_id THEN
    RAISE EXCEPTION 'Cliente, valor e forma de cobrança vêm da proposta e não se editam no contrato.';
  END IF;
  IF OLD.status <> 'rascunho' THEN
    IF NEW.inicio IS DISTINCT FROM OLD.inicio
       OR NEW.fim IS DISTINCT FROM OLD.fim
       OR NEW.texto IS DISTINCT FROM OLD.texto
       OR NEW.centro_custo_id IS DISTINCT FROM OLD.centro_custo_id THEN
      RAISE EXCEPTION 'Vigência, texto e centro travam fora do rascunho.';
    END IF;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'rascunho' AND NEW.status IN ('vigente', 'cancelado'))
      OR (OLD.status = 'vigente' AND NEW.status IN ('encerrado', 'cancelado'))
    ) THEN
      RAISE EXCEPTION 'Transição de status do contrato não permitida.';
    END IF;
  END IF;
  IF NEW.fim IS NOT NULL AND NEW.inicio IS NOT NULL AND NEW.fim < NEW.inicio THEN
    RAISE EXCEPTION 'O fim da vigência não pode ser antes do início.';
  END IF;
  IF NEW.status = 'vigente' AND (NEW.inicio IS NULL OR NEW.centro_custo_id IS NULL) THEN
    RAISE EXCEPTION 'Contrato vigente precisa de vigência e centro de custo.';
  END IF;
  IF NEW.status = 'cancelado' AND OLD.status IS DISTINCT FROM 'cancelado' THEN
    IF EXISTS (
      SELECT 1
      FROM public.erp_contas_receber r
      LEFT JOIN public.erp_nfse n ON n.conta_receber_id = r.id
      LEFT JOIN public.erp_boletos b ON b.conta_receber_id = r.id
      WHERE r.contrato_id = NEW.id
        AND r.status = 'faturado'
        AND (COALESCE(n.status, 'ausente') = 'informada' OR (b.id IS NOT NULL AND b.status <> 'cancelado'))
    ) THEN
      RAISE EXCEPTION 'Cancele a NFS-e e o boleto dos títulos faturados antes de cancelar o contrato.';
    END IF;
    UPDATE public.erp_contas_receber
    SET status = 'cancelado'
    WHERE contrato_id = NEW.id AND status IN ('previsto', 'faturado');
  END IF;
  RETURN NEW;
END;
$$;

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

-- Conta a receber, NFS-e e boleto
CREATE OR REPLACE FUNCTION public.erp_titulo_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  contrato public.erp_contratos%ROWTYPE;
BEGIN
  SELECT * INTO contrato FROM public.erp_contratos WHERE id = NEW.contrato_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF contrato.status <> 'vigente' THEN
      RAISE EXCEPTION 'Conta a receber só abre com o contrato vigente.';
    END IF;
    IF contrato.centro_custo_id IS NULL THEN
      RAISE EXCEPTION 'Contrato vigente sem centro de custo.';
    END IF;
    NEW.cliente_id := contrato.cliente_id;
    NEW.centro_custo_id := contrato.centro_custo_id;
    NEW.status := 'previsto';
    NEW.valor_recebido := NULL;
    NEW.data_recebimento := NULL;
    NEW.meio_recebimento := NULL;
  ELSE
    IF NEW.contrato_id IS DISTINCT FROM OLD.contrato_id
       OR NEW.cliente_id IS DISTINCT FROM contrato.cliente_id
       OR NEW.centro_custo_id IS DISTINCT FROM contrato.centro_custo_id THEN
      RAISE EXCEPTION 'Cliente e centro da conta vêm do contrato.';
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

CREATE OR REPLACE FUNCTION public.erp_nfse_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  st text;
BEGIN
  IF NEW.municipio IS DISTINCT FROM 'São Caetano do Sul/SP' THEN
    RAISE EXCEPTION 'A NFS-e é de São Caetano do Sul/SP.';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.conta_receber_id IS DISTINCT FROM OLD.conta_receber_id THEN
    RAISE EXCEPTION 'A NFS-e não troca de título.';
  END IF;
  SELECT status INTO st FROM public.erp_contas_receber WHERE id = NEW.conta_receber_id;
  IF NEW.status = 'informada' AND st NOT IN ('faturado', 'recebido') THEN
    RAISE EXCEPTION 'A NFS-e exige a conta faturada.';
  END IF;
  IF btrim(NEW.numero) = '' THEN
    RAISE EXCEPTION 'Informe o número da NFS-e.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_boleto_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  st text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.conta_receber_id IS DISTINCT FROM OLD.conta_receber_id THEN
    RAISE EXCEPTION 'O boleto não troca de título.';
  END IF;
  SELECT status INTO st FROM public.erp_contas_receber WHERE id = NEW.conta_receber_id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('aberto', 'atrasado') THEN
      RAISE EXCEPTION 'Boleto novo nasce aberto ou atrasado.';
    END IF;
    IF st <> 'faturado' THEN
      RAISE EXCEPTION 'O boleto exige a conta faturada.';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('pago', 'cancelado') THEN
      RAISE EXCEPTION 'Este boleto não muda para esse status.';
    END IF;
    IF NEW.status = 'pago' AND current_setting('erp.baixa_boleto', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'A baixa do boleto passa pela rotina de pagamento.';
    END IF;
  END IF;
  IF NEW.status = 'pago' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.erp_contas_receber r
      WHERE r.id = NEW.conta_receber_id AND r.status = 'recebido' AND r.meio_recebimento = NEW.meio
    ) THEN
      RAISE EXCEPTION 'Boleto pago exige a baixa da conta no mesmo meio.';
    END IF;
  END IF;
  IF btrim(NEW.numero) = '' THEN
    RAISE EXCEPTION 'Informe o número do boleto.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_pagar_boleto(
  p_boleto_id uuid,
  p_data date,
  p_valor_recebido numeric,
  p_meio text
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  bol public.erp_boletos%ROWTYPE;
BEGIN
  IF p_valor_recebido IS NULL OR p_valor_recebido <= 0 THEN
    RAISE EXCEPTION 'O valor recebido precisa ser maior que zero.';
  END IF;
  IF p_data IS NULL THEN
    RAISE EXCEPTION 'Data da baixa inválida.';
  END IF;
  IF p_meio NOT IN ('boleto', 'pix') THEN
    RAISE EXCEPTION 'Informe o meio do boleto pago.';
  END IF;
  SELECT * INTO bol FROM public.erp_boletos WHERE id = p_boleto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Boleto não encontrado.';
  END IF;
  IF bol.status NOT IN ('aberto', 'atrasado') THEN
    RAISE EXCEPTION 'Só boleto aberto ou atrasado pode ser pago.';
  END IF;
  PERFORM set_config('erp.baixa_boleto', 'on', true);
  UPDATE public.erp_contas_receber
  SET status = 'recebido',
      valor_recebido = p_valor_recebido,
      data_recebimento = p_data,
      meio_recebimento = p_meio
  WHERE id = bol.conta_receber_id AND status = 'faturado';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Só um título faturado pode ser baixado pelo boleto.';
  END IF;
  UPDATE public.erp_boletos
  SET status = 'pago', meio = p_meio
  WHERE id = p_boleto_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_baixa_manual(
  p_titulo_id uuid,
  p_data date,
  p_valor_recebido numeric,
  p_meio text
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_valor_recebido IS NULL OR p_valor_recebido <= 0 THEN
    RAISE EXCEPTION 'O valor recebido precisa ser maior que zero.';
  END IF;
  IF p_data IS NULL THEN
    RAISE EXCEPTION 'Data da baixa inválida.';
  END IF;
  IF p_meio NOT IN ('boleto', 'pix', 'manual') THEN
    RAISE EXCEPTION 'Informe o meio da baixa.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.erp_boletos b
    WHERE b.conta_receber_id = p_titulo_id AND b.status IN ('aberto', 'atrasado', 'pago')
  ) THEN
    RAISE EXCEPTION 'Baixe pelo boleto pago ou cancele o boleto antes da baixa manual.';
  END IF;
  UPDATE public.erp_contas_receber
  SET status = 'recebido',
      valor_recebido = p_valor_recebido,
      data_recebimento = p_data,
      meio_recebimento = p_meio
  WHERE id = p_titulo_id AND status = 'faturado';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Só um título faturado pode ser baixado.';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS erp_centros_guard ON public.erp_centros_custo;
CREATE TRIGGER erp_centros_guard BEFORE INSERT OR UPDATE ON public.erp_centros_custo
FOR EACH ROW EXECUTE FUNCTION public.erp_centro_guard();
DROP TRIGGER IF EXISTS erp_centros_updated ON public.erp_centros_custo;
CREATE TRIGGER erp_centros_updated BEFORE UPDATE ON public.erp_centros_custo
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS erp_despesas_guard ON public.erp_despesas;
CREATE TRIGGER erp_despesas_guard BEFORE INSERT OR UPDATE ON public.erp_despesas
FOR EACH ROW EXECUTE FUNCTION public.erp_despesa_guard();
DROP TRIGGER IF EXISTS erp_despesas_sync ON public.erp_despesas;
CREATE TRIGGER erp_despesas_sync AFTER UPDATE ON public.erp_despesas
FOR EACH ROW EXECUTE FUNCTION public.erp_despesa_sync_conta();
DROP TRIGGER IF EXISTS erp_despesas_updated ON public.erp_despesas;
CREATE TRIGGER erp_despesas_updated BEFORE UPDATE ON public.erp_despesas
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS erp_contas_pagar_guard ON public.erp_contas_pagar;
CREATE TRIGGER erp_contas_pagar_guard BEFORE INSERT OR UPDATE ON public.erp_contas_pagar
FOR EACH ROW EXECUTE FUNCTION public.erp_conta_pagar_guard();
DROP TRIGGER IF EXISTS erp_contas_pagar_updated ON public.erp_contas_pagar;
CREATE TRIGGER erp_contas_pagar_updated BEFORE UPDATE ON public.erp_contas_pagar
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS erp_colaboradores_updated ON public.erp_colaboradores;
CREATE TRIGGER erp_colaboradores_updated BEFORE UPDATE ON public.erp_colaboradores
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS erp_custos_guard ON public.erp_custos_pessoal;
CREATE TRIGGER erp_custos_guard BEFORE INSERT OR UPDATE ON public.erp_custos_pessoal
FOR EACH ROW EXECUTE FUNCTION public.erp_custo_guard();
DROP TRIGGER IF EXISTS erp_custos_updated ON public.erp_custos_pessoal;
CREATE TRIGGER erp_custos_updated BEFORE UPDATE ON public.erp_custos_pessoal
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS erp_rateios_guard ON public.erp_rateios;
CREATE TRIGGER erp_rateios_guard BEFORE INSERT OR UPDATE OR DELETE ON public.erp_rateios
FOR EACH ROW EXECUTE FUNCTION public.erp_rateio_guard();
DROP TRIGGER IF EXISTS erp_rateios_updated ON public.erp_rateios;
CREATE TRIGGER erp_rateios_updated BEFORE UPDATE ON public.erp_rateios
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS erp_propostas_guard ON public.erp_propostas;
CREATE TRIGGER erp_propostas_guard BEFORE INSERT OR UPDATE ON public.erp_propostas
FOR EACH ROW EXECUTE FUNCTION public.erp_proposta_guard();
DROP TRIGGER IF EXISTS erp_propostas_updated ON public.erp_propostas;
CREATE TRIGGER erp_propostas_updated BEFORE UPDATE ON public.erp_propostas
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS erp_contratos_guard ON public.erp_contratos;
CREATE TRIGGER erp_contratos_guard BEFORE INSERT OR UPDATE ON public.erp_contratos
FOR EACH ROW EXECUTE FUNCTION public.erp_contrato_guard();
DROP TRIGGER IF EXISTS erp_contratos_updated ON public.erp_contratos;
CREATE TRIGGER erp_contratos_updated BEFORE UPDATE ON public.erp_contratos
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS erp_titulos_guard ON public.erp_contas_receber;
CREATE TRIGGER erp_titulos_guard BEFORE INSERT OR UPDATE ON public.erp_contas_receber
FOR EACH ROW EXECUTE FUNCTION public.erp_titulo_guard();
DROP TRIGGER IF EXISTS erp_titulos_updated ON public.erp_contas_receber;
CREATE TRIGGER erp_titulos_updated BEFORE UPDATE ON public.erp_contas_receber
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS erp_nfse_guard ON public.erp_nfse;
CREATE TRIGGER erp_nfse_guard BEFORE INSERT OR UPDATE ON public.erp_nfse
FOR EACH ROW EXECUTE FUNCTION public.erp_nfse_guard();
DROP TRIGGER IF EXISTS erp_nfse_updated ON public.erp_nfse;
CREATE TRIGGER erp_nfse_updated BEFORE UPDATE ON public.erp_nfse
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS erp_boletos_guard ON public.erp_boletos;
CREATE TRIGGER erp_boletos_guard BEFORE INSERT OR UPDATE ON public.erp_boletos
FOR EACH ROW EXECUTE FUNCTION public.erp_boleto_guard();
DROP TRIGGER IF EXISTS erp_boletos_updated ON public.erp_boletos;
CREATE TRIGGER erp_boletos_updated BEFORE UPDATE ON public.erp_boletos
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Acesso da equipe interna. O portal do cliente não vê o financeiro.
DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY[
    'clients', 'erp_centros_custo', 'erp_despesas', 'erp_contas_pagar', 'erp_colaboradores',
    'erp_custos_pessoal', 'erp_rateios', 'erp_propostas', 'erp_contratos',
    'erp_contas_receber', 'erp_nfse', 'erp_boletos'
  ]
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role', tabela);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('DROP POLICY IF EXISTS erp_staff_all ON public.%I', tabela);
    EXECUTE format(
      'CREATE POLICY erp_staff_all ON public.%I FOR ALL TO authenticated USING (
        public.has_role(auth.uid(), ''admin'')
        OR public.has_role(auth.uid(), ''consultor'')
        OR public.has_role(auth.uid(), ''editor'')
        OR public.has_role(auth.uid(), ''beta_tester'')
      ) WITH CHECK (
        public.has_role(auth.uid(), ''admin'')
        OR public.has_role(auth.uid(), ''consultor'')
        OR public.has_role(auth.uid(), ''editor'')
        OR public.has_role(auth.uid(), ''beta_tester'')
      )',
      tabela
    );
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.erp_criar_despesa(text, text, text, text, text, numeric, date, uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.erp_substituir_rateio(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.erp_nova_versao(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.erp_criar_contrato(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.erp_vigorar_contrato(uuid, date, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.erp_pagar_boleto(uuid, date, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.erp_baixa_manual(uuid, date, numeric, text) TO authenticated, service_role;

INSERT INTO public.erp_centros_custo (nome, tipo, ativo)
SELECT 'Financeiro', 'financeiro', true
WHERE NOT EXISTS (SELECT 1 FROM public.erp_centros_custo WHERE tipo = 'financeiro');

INSERT INTO public.erp_centros_custo (nome, tipo, ativo)
SELECT 'Administrativo', 'indireto', true
WHERE NOT EXISTS (SELECT 1 FROM public.erp_centros_custo WHERE tipo = 'indireto' AND nome = 'Administrativo');

NOTIFY pgrst, 'reload schema';
