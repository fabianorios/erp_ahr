-- A mesma NFS-e pode ficar ligada a vários títulos, um por parcela.
-- Cada título continua com a própria linha (número, chave e PDF iguais).
-- Este script só tira o UNIQUE de conta_receber_id. Não apaga linha e não mexe em boleto.

DO $$
DECLARE
  nome text;
BEGIN
  FOR nome IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'erp_nfse'
      AND con.contype = 'u'
      AND pg_get_constraintdef(con.oid) ILIKE '%conta_receber_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.erp_nfse DROP CONSTRAINT %I', nome);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS erp_nfse_conta_receber_id_idx
  ON public.erp_nfse (conta_receber_id);
