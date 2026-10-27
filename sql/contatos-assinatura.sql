-- Contatos do cliente e a ordem de assinatura no ERP.
-- Projeto Supabase do ERP. Não altera o banco do Gestão.
-- Não mexe no guarda de status da proposta nem nas colunas antigas de erp_assinaturas.
-- Um pedido antigo, sem linhas em erp_assinatura_partes, continua válido.
-- Cole este script no SQL Editor desse projeto e execute uma vez.

CREATE TABLE IF NOT EXISTS public.erp_cliente_contatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  nome text NOT NULL,
  email text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_cliente_contatos_nome_chk CHECK (char_length(btrim(nome)) BETWEEN 2 AND 200),
  CONSTRAINT erp_cliente_contatos_email_chk CHECK (
    char_length(btrim(email)) BETWEEN 5 AND 320
    AND email LIKE '%_@_%'
    AND email NOT LIKE '% %'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS erp_cliente_contatos_email_uidx
  ON public.erp_cliente_contatos (cliente_id, lower(btrim(email)));

CREATE TABLE IF NOT EXISTS public.erp_assinatura_partes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assinatura_id uuid NOT NULL REFERENCES public.erp_assinaturas(id) ON DELETE CASCADE,
  ordem integer NOT NULL CHECK (ordem > 0),
  papel text NOT NULL CHECK (papel IN ('contato', 'ahr')),
  contato_id uuid REFERENCES public.erp_cliente_contatos(id) ON DELETE SET NULL,
  nome text NOT NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'solicitado', 'assinado')),
  solicitado_em timestamptz,
  assinado_em timestamptz,
  assinou_como text,
  otp_hash text,
  otp_expira_em timestamptz,
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  ip text,
  hash text,
  CONSTRAINT erp_assinatura_partes_ordem_unica UNIQUE (assinatura_id, ordem),
  CONSTRAINT erp_assinatura_partes_papel_chk CHECK (
    (papel = 'ahr' AND contato_id IS NULL) OR papel = 'contato'
  )
);

REVOKE ALL ON TABLE public.erp_cliente_contatos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.erp_cliente_contatos TO service_role;
ALTER TABLE public.erp_cliente_contatos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.erp_assinatura_partes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.erp_assinatura_partes TO service_role;
ALTER TABLE public.erp_assinatura_partes ENABLE ROW LEVEL SECURITY;
