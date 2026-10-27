-- Assinaturas de proposta e contrato no ERP (cliente e AHR).
-- Projeto Supabase do ERP. Não altera o banco do Gestão.
-- Cole este script no SQL Editor desse projeto e execute uma vez.

CREATE TABLE IF NOT EXISTS public.erp_assinaturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_tipo text NOT NULL CHECK (documento_tipo IN ('proposta', 'contrato')),
  documento_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'enviada' CHECK (status IN ('enviada', 'concluida', 'devolvida')),
  token text NOT NULL UNIQUE,
  titulo text NOT NULL,
  empresa text NOT NULL,
  cliente_nome text NOT NULL,
  cliente_email text NOT NULL,
  cliente_documento text NOT NULL DEFAULT '',
  cliente_status text NOT NULL DEFAULT 'solicitado' CHECK (cliente_status IN ('pendente', 'solicitado', 'assinado')),
  cliente_solicitado_em timestamptz,
  cliente_assinado_em timestamptz,
  cliente_assinou_como text,
  cliente_otp_hash text,
  cliente_otp_expira_em timestamptz,
  cliente_tentativas integer NOT NULL DEFAULT 0 CHECK (cliente_tentativas >= 0),
  cliente_ip text,
  cliente_hash text,
  ahr_nome text NOT NULL,
  ahr_email text NOT NULL,
  ahr_status text NOT NULL DEFAULT 'pendente' CHECK (ahr_status IN ('pendente', 'solicitado', 'assinado')),
  ahr_solicitado_em timestamptz,
  ahr_assinado_em timestamptz,
  ahr_assinou_como text,
  ahr_otp_hash text,
  ahr_otp_expira_em timestamptz,
  ahr_tentativas integer NOT NULL DEFAULT 0 CHECK (ahr_tentativas >= 0),
  ahr_ip text,
  ahr_hash text,
  devolutiva text,
  criada_em timestamptz NOT NULL DEFAULT now(),
  concluida_em timestamptz,
  CONSTRAINT erp_assinaturas_devolutiva_tamanho CHECK (devolutiva IS NULL OR char_length(devolutiva) <= 4000)
);

CREATE UNIQUE INDEX IF NOT EXISTS erp_assinaturas_aberta_uidx
  ON public.erp_assinaturas (documento_tipo, documento_id)
  WHERE status = 'enviada';

REVOKE ALL ON TABLE public.erp_assinaturas FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.erp_assinaturas TO service_role;
ALTER TABLE public.erp_assinaturas ENABLE ROW LEVEL SECURITY;
