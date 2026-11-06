import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Campo, CampoDinheiro, Pill, dataBr, executar, hoje, reais, reaisInput } from "@/components/erp/apresentacao";
import {
  anularNfse,
  atualizarBoleto,
  atualizarTitulo,
  cancelarTitulo,
  criarTitulo,
  excluirTitulo,
  faturar,
  gravarBoleto,
  gravarNfse,
  quitarBoleto,
  quitarManual,
  type ContratoItem,
  type TituloItem,
} from "@/services/erp/api";
import type { MeioBoleto, MeioRecebimento } from "@/services/erp/domain";
import { MUNICIPIO_NFSE } from "@/services/erp/domain";
import { ROTULO_FORMA, ROTULO_TIPO, textoParcela } from "@/components/erp/rotulos-titulo";

type Dialogo = "criar" | "editar" | "nfse" | "boleto" | "pagar" | "manual" | null;

export function PainelTitulos({
  contrato,
  titulos,
  canEdit,
  onChange,
}: {
  contrato: ContratoItem;
  titulos: TituloItem[];
  canEdit: boolean;
  onChange: () => Promise<void>;
}) {
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [titulo, setTitulo] = useState<TituloItem | null>(null);
  const [form, setForm] = useState({
    descricao: "",
    valor: "",
    vencimento: "",
    competencia: "",
    numero: "",
    data: hoje(),
    meio: "boleto" as MeioRecebimento,
    status: "aberto" as "aberto" | "atrasado",
    linha: "",
    codigo: "",
    forma: "",
    numeroNf: "",
    tipoVencimento: "data_fixa",
    prazoDias: "",
    banco: "",
  });

  const abrir = (qual: Dialogo, atual?: TituloItem) => {
    setTitulo(atual ?? null);
    setForm({
      descricao: atual?.descricao ?? "",
      valor: atual ? reaisInput(atual.valor) : "",
      vencimento: atual?.vencimento ?? "",
      competencia: atual?.competencia.slice(0, 7) ?? "",
      numero: "",
      data: hoje(),
      meio: atual?.boleto?.meio ?? "boleto",
      status: "aberto",
      linha: "",
      codigo: "",
      forma: atual?.formaRecebimento ?? "",
      numeroNf: atual?.numeroNf ?? "",
      tipoVencimento: atual?.tipoVencimento ?? "data_fixa",
      prazoDias: atual?.prazoDias ? String(atual.prazoDias) : "",
      banco: atual?.banco ?? "",
    });
    setDialogo(qual);
  };

  const fechar = async (ok: string, acao: () => Promise<void>) => {
    const sucesso = await executar(acao, ok);
    if (sucesso) {
      setDialogo(null);
      await onChange();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">Contas a receber</h2>
        {canEdit && contrato.status === "vigente" && <Button onClick={() => abrir("criar")}>Novo título</Button>}
      </div>
      {contrato.status !== "vigente" && (
        <p className="text-sm text-muted-foreground">As parcelas da proposta aceita entram aqui como previsto, mesmo com o contrato em rascunho. O título manual abre quando o contrato fica vigente.</p>
      )}
      {titulos.map((item) => (
        <Card key={item.id}>
          <CardContent className="py-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium">{item.descricao}</div>
                <div className="text-sm text-muted-foreground">
                  Cliente {item.clienteNome || contrato.clienteNome} · Número da NF {item.numeroNf || "—"}
                </div>
                <div className="text-sm text-muted-foreground">
                  {reais(item.valor)} · Forma de recebimento {ROTULO_FORMA[item.formaRecebimento ?? ""] ?? "—"} · Tipo de vencimento {ROTULO_TIPO[item.tipoVencimento ?? ""] ?? "—"}
                  {" · "}{textoParcela(item.parcela, item.quantidadeParcelas) || item.descricao} · vence {dataBr(item.vencimento)} · Banco de recebimento {item.banco || "—"}
                </div>
                {item.nfse && (
                  <div className="text-xs text-muted-foreground mt-1">
                    NFS-e {item.nfse.numero} · {reais(item.nfse.valor)} · {dataBr(item.nfse.vencimento)} · {item.nfse.status} · {MUNICIPIO_NFSE}
                  </div>
                )}
                {item.boleto && (
                  <div className="text-xs text-muted-foreground">
                    Boleto {item.boleto.numero} · {reais(item.boleto.valor)} · {dataBr(item.boleto.vencimento)} · {item.boleto.status}
                    {item.boleto.meio ? ` · ${item.boleto.meio}` : ""}
                  </div>
                )}
                {item.status === "recebido" && (
                  <div className="text-xs text-muted-foreground">
                    Recebido {reais(item.valorRecebido ?? 0)} em {dataBr(item.dataRecebimento)} · {item.meio}
                  </div>
                )}
              </div>
              <Pill valor={item.status} />
            </div>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                {item.status === "previsto" && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => abrir("editar", item)}>Editar</Button>
                    {!item.nfse && !item.boleto && (
                      <Button variant="ghost" size="sm" onClick={() => executar(() => excluirTitulo(item).then(onChange), "Título excluído")}>Excluir</Button>
                    )}
                    <Button size="sm" onClick={() => executar(() => faturar(item).then(onChange), "Título faturado")}>Faturar</Button>
                    <Button variant="ghost" size="sm" onClick={() => executar(() => cancelarTitulo(item).then(onChange), "Título cancelado")}>Cancelar</Button>
                  </>
                )}
                {item.status === "faturado" && (
                  <>
                    {item.nfse?.status !== "informada" && <Button variant="outline" size="sm" onClick={() => abrir("nfse", item)}>Registrar NFS-e</Button>}
                    {item.nfse?.status === "informada" && <Button variant="ghost" size="sm" onClick={() => executar(() => anularNfse(item).then(onChange), "NFS-e cancelada")}>Cancelar NFS-e</Button>}
                    {!item.boleto && <Button variant="outline" size="sm" onClick={() => abrir("boleto", item)}>Registrar boleto</Button>}
                    {item.boleto && (item.boleto.status === "aberto" || item.boleto.status === "atrasado") && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => executar(() => atualizarBoleto(item, item.boleto?.status === "aberto" ? "atrasado" : "aberto").then(onChange), "Status do boleto atualizado")}>
                          {item.boleto.status === "aberto" ? "Marcar atrasado" : "Marcar aberto"}
                        </Button>
                        <Button size="sm" onClick={() => abrir("pagar", item)}>Boleto pago</Button>
                        <Button variant="ghost" size="sm" onClick={() => executar(() => atualizarBoleto(item, "cancelado").then(onChange), "Boleto cancelado")}>Cancelar boleto</Button>
                      </>
                    )}
                    {(item.boleto == null || item.boleto.status === "cancelado") && (
                      <Button size="sm" onClick={() => abrir("manual", item)}>Baixa manual</Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => executar(() => cancelarTitulo(item).then(onChange), "Título cancelado")}>Cancelar título</Button>
                  </>
                )}
                {item.status === "recebido" && item.nfse?.status !== "informada" && (
                  <Button variant="outline" size="sm" onClick={() => abrir("nfse", item)}>Registrar NFS-e</Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      {titulos.length === 0 && <p className="text-sm text-muted-foreground">Nenhum título neste contrato.</p>}

      <Dialog open={dialogo != null} onOpenChange={(aberto) => !aberto && setDialogo(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {dialogo === "criar" && "Novo título"}
              {dialogo === "editar" && "Editar título previsto"}
              {dialogo === "nfse" && "NFS-e à mão"}
              {dialogo === "boleto" && "Boleto à mão"}
              {dialogo === "pagar" && "Baixa pelo boleto"}
              {dialogo === "manual" && "Baixa manual"}
            </DialogTitle>
          </DialogHeader>
          {dialogo === "criar" && (
            <div className="grid gap-3">
              <Campo label="Descrição"><Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></Campo>
              <Campo label="Valor"><CampoDinheiro value={form.valor} onChange={(valor) => setForm({ ...form, valor })} /></Campo>
              <Campo label="Vencimento"><Input type="date" value={form.vencimento} onChange={(e) => setForm({ ...form, vencimento: e.target.value })} /></Campo>
              <Campo label="Competência"><Input type="month" value={form.competencia} onChange={(e) => setForm({ ...form, competencia: e.target.value })} /></Campo>
            </div>
          )}
          {dialogo === "editar" && (
            <div className="grid gap-3">
              <Campo label="Cliente"><Input value={titulo?.clienteNome || contrato.clienteNome} disabled /></Campo>
              <Campo label="Descrição"><Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></Campo>
              <Campo label="Número da NF"><Input value={form.numeroNf} onChange={(e) => setForm({ ...form, numeroNf: e.target.value })} placeholder="Opcional. A nota sai no GissOnline." /></Campo>
              <Campo label="Valor"><CampoDinheiro value={form.valor} onChange={(valor) => setForm({ ...form, valor })} /></Campo>
              <Campo label="Forma de recebimento">
                <Select value={form.forma || undefined} onValueChange={(forma) => setForm({ ...form, forma })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="boleto">Boleto</SelectItem>
                    <SelectItem value="pix">PIX</SelectItem>
                    <SelectItem value="transferencia">Transferência</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </Campo>
              <Campo label="Tipo de vencimento">
                <Select value={form.tipoVencimento} onValueChange={(tipoVencimento) => setForm({ ...form, tipoVencimento })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="data_fixa">Data fixa</SelectItem>
                    <SelectItem value="prazo_dias">Prazo em dias</SelectItem>
                  </SelectContent>
                </Select>
              </Campo>
              <Campo label="Quantidade de parcelas"><Input value={textoParcela(titulo?.parcela ?? null, titulo?.quantidadeParcelas ?? null) || "1"} disabled /></Campo>
              <Campo label="Vencimento"><Input type="date" value={form.vencimento} onChange={(e) => setForm({ ...form, vencimento: e.target.value })} /></Campo>
              {form.tipoVencimento === "prazo_dias" && (
                <Campo label="Prazo em dias"><Input inputMode="numeric" value={form.prazoDias} onChange={(e) => setForm({ ...form, prazoDias: e.target.value })} /></Campo>
              )}
              <Campo label="Banco de recebimento"><Input value={form.banco} placeholder="Ex.: Cora" onChange={(e) => setForm({ ...form, banco: e.target.value })} /></Campo>
              <Campo label="Competência"><Input type="month" value={form.competencia} onChange={(e) => setForm({ ...form, competencia: e.target.value })} /></Campo>
            </div>
          )}
          {dialogo === "nfse" && (
            <div className="grid gap-3">
              <p className="text-sm text-muted-foreground">Município emissor: {MUNICIPIO_NFSE}. O registro não emite a nota.</p>
              <Campo label="Número"><Input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} /></Campo>
              <Campo label="Valor"><CampoDinheiro value={form.valor} onChange={(valor) => setForm({ ...form, valor })} /></Campo>
              <Campo label="Vencimento"><Input type="date" value={form.vencimento} onChange={(e) => setForm({ ...form, vencimento: e.target.value })} /></Campo>
              <Campo label="Data de emissão"><Input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></Campo>
              <Campo label="Código de verificação"><Input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} /></Campo>
            </div>
          )}
          {dialogo === "boleto" && (
            <div className="grid gap-3">
              <p className="text-sm text-muted-foreground">Número impresso pelo banco. Este registro não chama a Cora.</p>
              <Campo label="Número"><Input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} /></Campo>
              <Campo label="Valor"><CampoDinheiro value={form.valor} onChange={(valor) => setForm({ ...form, valor })} /></Campo>
              <Campo label="Vencimento"><Input type="date" value={form.vencimento} onChange={(e) => setForm({ ...form, vencimento: e.target.value })} /></Campo>
              <Campo label="Status">
                <Select value={form.status} onValueChange={(status: "aberto" | "atrasado") => setForm({ ...form, status })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aberto">Aberto</SelectItem>
                    <SelectItem value="atrasado">Atrasado</SelectItem>
                  </SelectContent>
                </Select>
              </Campo>
              <Campo label="Meio">
                <Select value={form.meio === "manual" ? "boleto" : form.meio} onValueChange={(meio: MeioBoleto) => setForm({ ...form, meio })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="boleto">Boleto</SelectItem>
                    <SelectItem value="pix">Pix</SelectItem>
                  </SelectContent>
                </Select>
              </Campo>
              <Campo label="Linha digitável"><Input value={form.linha} onChange={(e) => setForm({ ...form, linha: e.target.value })} /></Campo>
            </div>
          )}
          {(dialogo === "pagar" || dialogo === "manual") && (
            <div className="grid gap-3">
              <Campo label="Valor recebido"><CampoDinheiro value={form.valor} onChange={(valor) => setForm({ ...form, valor })} /></Campo>
              <Campo label="Data da baixa"><Input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></Campo>
              <Campo label="Meio">
                <Select value={form.meio} onValueChange={(meio: MeioRecebimento) => setForm({ ...form, meio })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {dialogo === "pagar" ? (
                      <>
                        <SelectItem value="boleto">Boleto</SelectItem>
                        <SelectItem value="pix">Pix</SelectItem>
                      </>
                    ) : (
                      <>
                        <SelectItem value="manual">Manual</SelectItem>
                        <SelectItem value="boleto">Boleto</SelectItem>
                        <SelectItem value="pix">Pix</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </Campo>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => {
                if (dialogo === "criar") return fechar("Título previsto criado", () => criarTitulo(contrato, form));
                if (dialogo === "editar" && titulo) {
                  return fechar("Título atualizado", () => atualizarTitulo(titulo, {
                    descricao: form.descricao,
                    valor: form.valor,
                    vencimento: form.vencimento,
                    competencia: form.competencia,
                    forma: form.forma,
                    numeroNf: form.numeroNf,
                    tipoVencimento: form.tipoVencimento,
                    prazoDias: form.prazoDias,
                    banco: form.banco,
                    centroId: titulo.centroId ?? titulo.centroPadraoId ?? "",
                  }));
                }
                if (dialogo === "nfse" && titulo) {
                  return fechar("NFS-e registrada", () => gravarNfse(titulo, { numero: form.numero, valor: form.valor, vencimento: form.vencimento, dataEmissao: form.data, codigo: form.codigo }));
                }
                if (dialogo === "boleto" && titulo) {
                  const meio = form.meio === "pix" ? "pix" : "boleto";
                  return fechar("Boleto registrado", () => gravarBoleto(titulo, { numero: form.numero, valor: form.valor, vencimento: form.vencimento, status: form.status, meio, linha: form.linha }));
                }
                if (dialogo === "pagar" && titulo) {
                  const meio = form.meio === "pix" ? "pix" : "boleto";
                  return fechar("Conta recebida pelo boleto", () => quitarBoleto(titulo, { valor: form.valor, data: form.data, meio }));
                }
                if (dialogo === "manual" && titulo) return fechar("Baixa manual registrada", () => quitarManual(titulo, { valor: form.valor, data: form.data, meio: form.meio }));
              }}
            >
              Gravar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
