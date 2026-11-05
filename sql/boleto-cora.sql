-- Boleto Cora no título (erp_boletos, um por conta a receber).
-- Projeto ERP. Não altera o banco do Gestão.
-- Cole este script no SQL Editor do projeto do ERP e execute uma vez.
-- O PDF não entra no banco nem no git: pdf_path é só o nome do arquivo
-- gravado no servidor, fora da pasta pública, e a API autenticada é quem o lê.

ALTER TABLE public.erp_boletos
  ADD COLUMN IF NOT EXISTS linha_digitavel text,
  ADD COLUMN IF NOT EXISTS url_pdf text,
  ADD COLUMN IF NOT EXISTS cora_invoice_id text,
  ADD COLUMN IF NOT EXISTS pix_emv text,
  ADD COLUMN IF NOT EXISTS codigo_barras text,
  ADD COLUMN IF NOT EXISTS pdf_path text,
  ADD COLUMN IF NOT EXISTS cora_status text;

CREATE UNIQUE INDEX IF NOT EXISTS erp_boletos_cora_invoice_uidx
  ON public.erp_boletos (cora_invoice_id)
  WHERE cora_invoice_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
