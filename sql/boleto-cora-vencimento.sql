-- Vencimento do boleto Cora já emitido.
-- Projeto ERP. Não altera o banco do Gestão.
-- Rode depois de sql/titulos-grupo.sql. O guard passa a aceitar a nova data
-- só quando a rotina erp_ajustar_vencimento_boleto liga erp.ajuste_vencimento.
-- Não emite, não cancela e não altera boleto nenhum.
-- Cole este script no SQL Editor do projeto do ERP e execute uma vez.

CREATE OR REPLACE FUNCTION public.erp_titulo_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  contrato public.erp_contratos%ROWTYPE;
  proposta_status text;
  proposta_cliente uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.valor_recebido := NULL;
    NEW.data_recebimento := NULL;
    NEW.meio_recebimento := NULL;
    NEW.status := 'previsto';
    IF NEW.proposta_id IS NOT NULL THEN
      SELECT status, cliente_id INTO proposta_status, proposta_cliente
      FROM public.erp_propostas WHERE id = NEW.proposta_id;
      IF proposta_status IS NULL THEN
        RAISE EXCEPTION 'Proposta não encontrada.';
      END IF;
      IF proposta_status <> 'aceita' THEN
        RAISE EXCEPTION 'Conta prevista só nasce de proposta aceita.';
      END IF;
      IF NEW.parcela IS NULL OR NEW.parcela <= 0 THEN
        RAISE EXCEPTION 'A parcela da proposta é obrigatória.';
      END IF;
      NEW.origem := NULL;
      IF NEW.cliente_id IS NULL THEN
        NEW.cliente_id := proposta_cliente;
      END IF;
      IF NEW.contrato_id IS NOT NULL THEN
        SELECT * INTO contrato FROM public.erp_contratos WHERE id = NEW.contrato_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Contrato não encontrado.';
        END IF;
        IF contrato.proposta_id IS DISTINCT FROM NEW.proposta_id THEN
          RAISE EXCEPTION 'O contrato não é desta proposta.';
        END IF;
        IF contrato.status NOT IN ('rascunho', 'vigente') THEN
          RAISE EXCEPTION 'Contrato encerrado ou cancelado não recebe parcela prevista.';
        END IF;
        NEW.cliente_id := contrato.cliente_id;
        IF NEW.centro_custo_id IS NULL AND contrato.status = 'vigente' THEN
          NEW.centro_custo_id := contrato.centro_custo_id;
        END IF;
      END IF;
    ELSIF NEW.contrato_id IS NOT NULL THEN
      SELECT * INTO contrato FROM public.erp_contratos WHERE id = NEW.contrato_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Contrato não encontrado.';
      END IF;
      IF contrato.status <> 'vigente' THEN
        RAISE EXCEPTION 'Conta a receber só abre com o contrato vigente.';
      END IF;
      NEW.cliente_id := contrato.cliente_id;
      IF NEW.centro_custo_id IS NULL THEN
        NEW.centro_custo_id := contrato.centro_custo_id;
      END IF;
      IF NEW.centro_custo_id IS NULL THEN
        RAISE EXCEPTION 'Informe o centro de custo.';
      END IF;
      NEW.proposta_id := NULL;
      NEW.parcela := NULL;
      NEW.origem := NULL;
    ELSE
      NEW.origem := btrim(COALESCE(NEW.origem, ''));
      IF char_length(NEW.origem) < 2 OR char_length(NEW.origem) > 200 THEN
        RAISE EXCEPTION 'Informe de onde veio este título.';
      END IF;
      IF NEW.cliente_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = NEW.cliente_id) THEN
        RAISE EXCEPTION 'Informe o cliente.';
      END IF;
      IF NEW.forma_recebimento IS NULL THEN
        RAISE EXCEPTION 'Informe a forma de recebimento.';
      END IF;
      IF NEW.banco IS NULL OR char_length(btrim(NEW.banco)) < 2 THEN
        RAISE EXCEPTION 'Informe o banco de recebimento.';
      END IF;
      IF NEW.parcela IS NULL OR NEW.parcela <= 0 OR NEW.quantidade_parcelas IS NULL OR NEW.quantidade_parcelas < NEW.parcela THEN
        RAISE EXCEPTION 'Informe a quantidade de parcelas.';
      END IF;
      NEW.contrato_id := NULL;
      NEW.proposta_id := NULL;
      IF NEW.centro_custo_id IS NULL THEN
        RAISE EXCEPTION 'Informe o centro de custo.';
      END IF;
    END IF;
  ELSE
    IF OLD.proposta_id IS NOT NULL AND NEW.proposta_id IS DISTINCT FROM OLD.proposta_id THEN
      RAISE EXCEPTION 'A proposta do título não muda.';
    END IF;
    IF OLD.proposta_id IS NULL AND NEW.proposta_id IS NOT NULL AND (NEW.parcela IS NULL OR NEW.parcela <= 0) THEN
      RAISE EXCEPTION 'A proposta do título não muda.';
    END IF;
    IF OLD.parcela IS NOT NULL AND NEW.parcela IS DISTINCT FROM OLD.parcela THEN
      RAISE EXCEPTION 'A parcela do título não muda.';
    END IF;
    IF OLD.contrato_id IS NOT NULL AND NEW.contrato_id IS DISTINCT FROM OLD.contrato_id THEN
      RAISE EXCEPTION 'O contrato do título não muda.';
    END IF;
    IF NEW.proposta_id IS NOT NULL AND NEW.contrato_id IS NULL THEN
      IF NEW.cliente_id IS DISTINCT FROM OLD.cliente_id OR NEW.origem IS NOT NULL THEN
        RAISE EXCEPTION 'Parcela prevista não muda de cliente nem ganha origem.';
      END IF;
    ELSIF NEW.contrato_id IS NOT NULL THEN
      SELECT * INTO contrato FROM public.erp_contratos WHERE id = NEW.contrato_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Contrato não encontrado.';
      END IF;
      IF OLD.contrato_id IS NULL AND (NEW.proposta_id IS NULL OR contrato.proposta_id IS DISTINCT FROM NEW.proposta_id) THEN
        RAISE EXCEPTION 'O título só liga ao contrato da mesma proposta.';
      END IF;
      IF NEW.cliente_id IS DISTINCT FROM contrato.cliente_id THEN
        RAISE EXCEPTION 'O cliente da conta vem do contrato.';
      END IF;
      IF NEW.centro_custo_id IS NULL AND contrato.status = 'vigente' THEN
        NEW.centro_custo_id := contrato.centro_custo_id;
      END IF;
      IF NEW.origem IS NOT NULL THEN
        RAISE EXCEPTION 'Parcela de contrato não tem origem avulsa.';
      END IF;
    ELSE
      IF NEW.proposta_id IS NOT NULL THEN
        RAISE EXCEPTION 'Título sem contrato não leva proposta.';
      END IF;
      IF OLD.centro_custo_id IS NOT NULL AND NEW.centro_custo_id IS NULL THEN
        RAISE EXCEPTION 'O centro de custo não sai depois de informado.';
      END IF;
      IF OLD.forma_recebimento IS NOT NULL AND NEW.forma_recebimento IS NULL THEN
        RAISE EXCEPTION 'A forma de recebimento não sai depois de informada.';
      END IF;
      IF OLD.banco IS NOT NULL AND NULLIF(btrim(COALESCE(NEW.banco, '')), '') IS NULL THEN
        RAISE EXCEPTION 'O banco de recebimento não sai depois de informado.';
      END IF;
      IF NEW.cliente_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = NEW.cliente_id) THEN
        RAISE EXCEPTION 'Informe o cliente.';
      END IF;
      IF OLD.status <> 'previsto' AND NEW.cliente_id IS DISTINCT FROM OLD.cliente_id THEN
        RAISE EXCEPTION 'O cliente só muda enquanto o título está previsto.';
      END IF;
      IF NEW.origem IS DISTINCT FROM OLD.origem AND OLD.status <> 'previsto' THEN
        RAISE EXCEPTION 'A origem só muda enquanto o título está previsto.';
      END IF;
      NEW.origem := btrim(COALESCE(NEW.origem, ''));
      IF char_length(NEW.origem) < 2 OR char_length(NEW.origem) > 200 THEN
        RAISE EXCEPTION 'Informe de onde veio este título.';
      END IF;
    END IF;
    IF OLD.status <> 'previsto'
       AND (NEW.forma_recebimento IS DISTINCT FROM OLD.forma_recebimento
            OR NEW.tipo_vencimento IS DISTINCT FROM OLD.tipo_vencimento
            OR NEW.prazo_dias IS DISTINCT FROM OLD.prazo_dias
            OR NEW.banco IS DISTINCT FROM OLD.banco
            OR NEW.quantidade_parcelas IS DISTINCT FROM OLD.quantidade_parcelas
            OR NEW.centro_custo_id IS DISTINCT FROM OLD.centro_custo_id) THEN
      RAISE EXCEPTION 'Forma, vencimento, banco e centro só mudam enquanto o título está previsto.';
    END IF;
    IF OLD.status <> 'previsto'
       AND (NEW.valor IS DISTINCT FROM OLD.valor
            OR NEW.competencia IS DISTINCT FROM OLD.competencia
            OR NEW.descricao IS DISTINCT FROM OLD.descricao
            OR (NEW.vencimento IS DISTINCT FROM OLD.vencimento
                AND current_setting('erp.ajuste_vencimento', true) IS DISTINCT FROM 'on')) THEN
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
  NEW.numero_nf := NULLIF(btrim(COALESCE(NEW.numero_nf, '')), '');
  IF NEW.forma_recebimento IS NOT NULL AND NEW.forma_recebimento NOT IN ('boleto', 'pix', 'transferencia', 'outro') THEN
    RAISE EXCEPTION 'Forma de recebimento inválida.';
  END IF;
  IF NEW.tipo_vencimento IS NULL THEN
    NEW.tipo_vencimento := 'data_fixa';
  END IF;
  IF NEW.tipo_vencimento NOT IN ('data_fixa', 'prazo_dias') THEN
    RAISE EXCEPTION 'Tipo de vencimento inválido.';
  END IF;
  IF NEW.tipo_vencimento = 'data_fixa' THEN
    NEW.prazo_dias := NULL;
  ELSIF NEW.prazo_dias IS NULL OR NEW.prazo_dias <= 0 THEN
    RAISE EXCEPTION 'Informe o prazo em dias.';
  END IF;
  IF NEW.banco IS NOT NULL THEN
    NEW.banco := btrim(NEW.banco);
    IF char_length(NEW.banco) < 2 OR char_length(NEW.banco) > 80 THEN
      RAISE EXCEPTION 'Informe o banco de recebimento.';
    END IF;
  END IF;
  IF NEW.numero_nf IS NOT NULL AND char_length(NEW.numero_nf) > 40 THEN
    RAISE EXCEPTION 'O número da NF passou de 40 caracteres.';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.centro_custo_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.erp_centros_custo c
      WHERE c.id = NEW.centro_custo_id AND c.ativo IS TRUE
    ) THEN
      RAISE EXCEPTION 'Informe o centro de custo.';
    END IF;
  ELSIF NEW.centro_custo_id IS DISTINCT FROM OLD.centro_custo_id
        AND NEW.centro_custo_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.erp_centros_custo c
          WHERE c.id = NEW.centro_custo_id AND c.ativo IS TRUE
        ) THEN
    RAISE EXCEPTION 'Informe o centro de custo.';
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


CREATE OR REPLACE FUNCTION public.erp_ajustar_vencimento_boleto(
  p_boleto_id uuid,
  p_data date
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  bol public.erp_boletos%ROWTYPE;
BEGIN
  IF p_data IS NULL THEN
    RAISE EXCEPTION 'Vencimento inválido.';
  END IF;
  SELECT * INTO bol FROM public.erp_boletos WHERE id = p_boleto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Boleto não encontrado.';
  END IF;
  IF bol.status = 'pago' THEN
    RAISE EXCEPTION 'Este boleto já foi pago.';
  END IF;
  IF bol.status = 'cancelado' THEN
    RAISE EXCEPTION 'Este boleto já está cancelado.';
  END IF;
  IF bol.status NOT IN ('aberto', 'atrasado') THEN
    RAISE EXCEPTION 'Este boleto não muda de vencimento.';
  END IF;
  PERFORM set_config('erp.ajuste_vencimento', 'on', true);
  UPDATE public.erp_contas_receber
  SET vencimento = p_data
  WHERE id = bol.conta_receber_id AND status IN ('previsto', 'faturado');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O vencimento deste título não pode mudar.';
  END IF;
  UPDATE public.erp_boletos
  SET vencimento = p_data,
      status = CASE WHEN status = 'atrasado' AND p_data >= CURRENT_DATE THEN 'aberto' ELSE status END,
      cora_status = CASE WHEN status = 'atrasado' AND p_data >= CURRENT_DATE THEN 'OPEN' ELSE cora_status END
  WHERE id = p_boleto_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.erp_ajustar_vencimento_boleto(uuid, date) TO service_role;

NOTIFY pgrst, 'reload schema';
