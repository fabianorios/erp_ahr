-- Emissor Nacional. O título continua nascendo previsto e só então é faturado.
-- O emissor nacional entra ao lado do registro manual e do Giss.

ALTER TABLE public.erp_nfse DROP CONSTRAINT IF EXISTS erp_nfse_emissor_check;
ALTER TABLE public.erp_nfse
  ADD CONSTRAINT erp_nfse_emissor_check CHECK (emissor IN ('manual', 'giss', 'nacional'));

ALTER TABLE public.erp_nfse ADD COLUMN IF NOT EXISTS pdf_path text;
