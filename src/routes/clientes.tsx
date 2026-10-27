import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AvisoConsulta, Campo, CampoDocumento, CamposEndereco, TituloPagina, enderecoTexto, executar } from "@/components/erp/apresentacao";
import { useAuth } from "@/lib/auth-context";
import { clienteVazio, excluirCliente, excluirContato, listarClientes, listarContatos, salvarCliente, salvarContato, type ClienteForm } from "@/services/erp/api";
import { mascaraDocumento, somenteDigitos } from "@/services/erp/domain";

export function ClientesPage() {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const clientes = useQuery({ queryKey: ["erp", "clientes"], queryFn: listarClientes });
  const [id, setId] = useState<string | null>(null);
  const [form, setForm] = useState<ClienteForm>(clienteVazio());

  function editar(cliente: ClienteForm & { id: string }) {
    setId(cliente.id);
    setForm(cliente);
  }

  return (
    <div className="space-y-6">
      <TituloPagina
        titulo="Clientes"
        descricao="Documento é obrigatório. O endereço pode nascer incompleto e trava só na emissão futura de NFS-e e boleto."
      />
      <AvisoConsulta erro={clientes.error} />
      {canEdit && (
        <Card>
          <CardContent className="grid gap-3 py-4">
            <Campo label="Nome">
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </Campo>
            <div className="grid gap-3 md:grid-cols-2">
              <Campo label="CPF ou CNPJ">
                <CampoDocumento tipo="ambos" value={form.documento} onChange={(documento) => setForm({ ...form, documento })} />
              </Campo>
              <Campo label="E-mail">
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Campo>
            </div>
            <CamposEndereco value={form} onChange={(patch) => setForm({ ...form, ...patch })} />
            <div className="flex gap-2">
              <Button
                onClick={() =>
                  executar(async () => {
                    await salvarCliente(id, form);
                    setId(null);
                    setForm(clienteVazio());
                    await qc.invalidateQueries({ queryKey: ["erp", "clientes"] });
                  }, id ? "Cliente atualizado" : "Cliente cadastrado")
                }
              >
                {id ? "Salvar" : "Cadastrar"}
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  const cep = somenteDigitos(form.cep);
                  if (cep.length !== 8) return;
                  const resposta = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`);
                  if (!resposta.ok) return;
                  const dados = (await resposta.json()) as { street?: string; neighborhood?: string; city?: string; state?: string };
                  setForm({
                    ...form,
                    cep,
                    logradouro: dados.street ?? form.logradouro,
                    bairro: dados.neighborhood ?? form.bairro,
                    cidade: dados.city ?? form.cidade,
                    uf: dados.state ?? form.uf,
                  });
                }}
              >
                Buscar CEP
              </Button>
              {id && (
                <Button variant="ghost" onClick={() => { setId(null); setForm(clienteVazio()); }}>
                  Novo
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      {canEdit && id && <ContatosDoCliente clienteId={id} />}
      {canEdit && !id && <p className="text-sm text-muted-foreground">Salve o cliente para cadastrar os contatos.</p>}
      <div className="grid gap-3">
        {(clientes.data ?? []).map((cliente) => (
          <Card key={cliente.id}>
            <CardContent className="flex items-center justify-between gap-3 py-4">
              <div>
                <div className="font-medium">{cliente.nome}</div>
                <div className="text-sm text-muted-foreground">{mascaraDocumento(cliente.documento)}</div>
                <div className="text-xs text-muted-foreground">{enderecoTexto(cliente) || "Endereço incompleto"}</div>
              </div>
              {canEdit && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => editar(cliente)}>Editar</Button>
                  <Button variant="ghost" onClick={() => executar(async () => { await excluirCliente(cliente.id); if (id === cliente.id) { setId(null); setForm(clienteVazio()); } await qc.invalidateQueries({ queryKey: ["erp", "clientes"] }); }, "Cliente excluído")}>Excluir</Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {clientes.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum cliente.</p>}
      </div>
    </div>
  );
}

function ContatosDoCliente({ clienteId }: { clienteId: string }) {
  const qc = useQueryClient();
  const contatos = useQuery({ queryKey: ["erp", "contatos", clienteId], queryFn: () => listarContatos(clienteId) });
  const [editId, setEditId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");

  function limpar() {
    setEditId(null);
    setNome("");
    setEmail("");
  }

  return (
    <Card>
      <CardContent className="grid gap-3 py-4">
        <h2 className="text-lg font-semibold">Contatos</h2>
        <p className="text-sm text-muted-foreground">Quem pode receber o pedido de assinatura deste cliente. Um cliente pode ter vários contatos.</p>
        <AvisoConsulta erro={contatos.error} />
        <div className="grid gap-3 md:grid-cols-2">
          <Campo label="Nome do contato">
            <Input value={nome} onChange={(event) => setNome(event.target.value)} />
          </Campo>
          <Campo label="E-mail do contato">
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Campo>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() =>
              executar(async () => {
                await salvarContato({ id: editId, clienteId, nome, email });
                limpar();
                await qc.invalidateQueries({ queryKey: ["erp", "contatos", clienteId] });
              }, editId ? "Contato atualizado" : "Contato cadastrado")
            }
          >
            {editId ? "Salvar contato" : "Cadastrar contato"}
          </Button>
          {editId && (
            <Button variant="ghost" onClick={limpar}>
              Cancelar
            </Button>
          )}
        </div>
        <div className="grid gap-2">
          {(contatos.data ?? []).map((contato) => (
            <div key={contato.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
              <div>
                <div className="font-medium">{contato.nome}</div>
                <div className="text-muted-foreground">{contato.email}</div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditId(contato.id);
                    setNome(contato.nome);
                    setEmail(contato.email);
                  }}
                >
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    executar(async () => {
                      await excluirContato(contato.id);
                      if (editId === contato.id) limpar();
                      await qc.invalidateQueries({ queryKey: ["erp", "contatos", clienteId] });
                    }, "Contato excluído")
                  }
                >
                  Excluir
                </Button>
              </div>
            </div>
          ))}
          {contatos.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum contato.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
