-- Cadastro único de pessoas no ERP.
-- Uma linha em clients pode ser cliente, fornecedor e colaborador ao mesmo tempo.
-- Não apaga cliente, colaborador, despesa nem custo. Não altera o banco do Gestão.
-- Cole este script no SQL Editor do projeto do ERP e execute uma vez.

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS cliente boolean NOT NULL DEFAULT true;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS fornecedor boolean NOT NULL DEFAULT false;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS colaborador boolean NOT NULL DEFAULT false;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_tipo_chk;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_tipo_chk CHECK (cliente OR fornecedor OR colaborador);

ALTER TABLE public.erp_colaboradores ADD COLUMN IF NOT EXISTS pessoa_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'erp_colaboradores_pessoa_id_fkey'
  ) THEN
    ALTER TABLE public.erp_colaboradores
      ADD CONSTRAINT erp_colaboradores_pessoa_id_fkey
      FOREIGN KEY (pessoa_id) REFERENCES public.clients(id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS erp_colaboradores_pessoa_uidx
  ON public.erp_colaboradores (pessoa_id) WHERE pessoa_id IS NOT NULL;

-- Cada colaborador já gravado vira uma pessoa do tipo colaborador, sem mexer no custo.
DO $$
DECLARE
  col record;
  nova uuid;
BEGIN
  FOR col IN
    SELECT id, nome FROM public.erp_colaboradores WHERE pessoa_id IS NULL ORDER BY created_at
  LOOP
    INSERT INTO public.clients (name, document, cliente, fornecedor, colaborador)
    VALUES (col.nome, NULL, false, false, true)
    RETURNING id INTO nova;
    UPDATE public.erp_colaboradores SET pessoa_id = nova WHERE id = col.id;
  END LOOP;
END $$;
