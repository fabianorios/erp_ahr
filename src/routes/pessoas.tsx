import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AvisoConsulta, Campo, CampoDocumento, CamposEndereco, TituloPagina, executar } from "@/components/erp/apresentacao";
import { useAuth } from "@/lib/auth-context";
import { excluirCliente, excluirContato, listarClientes, listarContatos, pessoaVazia, salvarContato, salvarPessoa, type PessoaForm } from "@/services/erp/api";
import { mascaraDocumento, somenteDigitos } from "@/services/erp/domain";

function rotuloTipos(pessoa: Pick<PessoaForm, "cliente" | "fornecedor" | "colaborador">): string {
  return [
    pessoa.cliente ? "Cliente" : "",
    pessoa.fornecedor ? "Fornecedor" : "",
    pessoa.colaborador ? "Colaborador" : "",
  ].filter(Boolean).join(", ");
}

export function PessoasPage() {
  const { canEdit } = useAuth();
  const pessoas = useQuery({ queryKey: ["erp", "clientes"], queryFn: listarClientes });
  const [id, setId] = useState<string | null>(null);
  const [formulario, setFormulario] = useState(false);
  const [form, setForm] = useState<PessoaForm>(pessoaVazia());

  function abrirNova() {
    setId(null);
    setForm(pessoaVazia());
    setFormulario(true);
  }

  function alterar(pessoa: PessoaForm & { id: string }) {
    setId(pessoa.id);
    setForm(pessoa);
    setFormulario(true);
  }

  function voltar() {
    setId(null);
    setForm(pessoaVazia());
    setFormulario(false);
  }

  if (formulario) {
    return <FormularioPessoa id={id} form={form} setForm={setForm} onVoltar={voltar} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TituloPagina
          titulo="Pessoas"
          descricao="Uma pessoa pode ser cliente, fornecedor e colaborador ao mesmo tempo. O documento é obrigatório para cliente e fornecedor."
        />
        {canEdit && <Button onClick={abrirNova}>Incluir</Button>}
      </div>
      <AvisoConsulta erro={pessoas.error} />
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 font-medium">Documento</th>
              <th className="px-3 py-2 font-medium">Tipos</th>
              {canEdit && <th className="px-3 py-2 font-medium">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {(pessoas.data ?? []).map((pessoa) => (
              <tr key={pessoa.id} className="border-t border-border">
                <td className="px-3 py-2">{pessoa.nome}</td>
                <td className="px-3 py-2">{mascaraDocumento(pessoa.documento)}</td>
                <td className="px-3 py-2">{rotuloTipos(pessoa)}</td>
                {canEdit && (
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => alterar(pessoa)}>Alterar</Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          executar(async () => {
                            await excluirCliente(pessoa.id);
                            await pessoas.refetch();
                          }, "Pessoa excluída")
                        }
                      >
                        Excluir
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {pessoas.data?.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">Nenhuma pessoa.</p>}
      </div>
    </div>
  );
}

function FormularioPessoa({
  id,
  form,
  setForm,
  onVoltar,
}: {
  id: string | null;
  form: PessoaForm;
  setForm: (form: PessoaForm) => void;
  onVoltar: () => void;
}) {
  const qc = useQueryClient();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TituloPagina
          titulo={id ? "Alterar pessoa" : "Incluir pessoa"}
          descricao="Marque um ou mais tipos. Cliente e fornecedor pedem CPF ou CNPJ. Colaborador pode ficar sem documento."
        />
        <Button type="button" variant="outline" onClick={onVoltar}>Cancelar</Button>
      </div>
      <Card>
        <CardContent className="grid gap-3 py-4">
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-2 text-sm font-medium">Tipos</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.cliente} onChange={(event) => setForm({ ...form, cliente: event.target.checked })} />
              Cliente
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.fornecedor} onChange={(event) => setForm({ ...form, fornecedor: event.target.checked })} />
              Fornecedor
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.colaborador} onChange={(event) => setForm({ ...form, colaborador: event.target.checked })} />
              Colaborador
            </label>
          </fieldset>
          <Campo label="Nome">
            <Input value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} />
          </Campo>
          <div className="grid gap-3 md:grid-cols-2">
            <Campo label="CPF ou CNPJ">
              <CampoDocumento tipo="ambos" value={form.documento} onChange={(documento) => setForm({ ...form, documento })} />
            </Campo>
            <Campo label="E-mail">
              <Input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </Campo>
          </div>
          <CamposEndereco value={form} onChange={(patch) => setForm({ ...form, ...patch })} />
          <div className="flex gap-2">
            <Button
              onClick={() =>
                executar(async () => {
                  await salvarPessoa(id, form);
                  await qc.invalidateQueries({ queryKey: ["erp", "clientes"] });
                  await qc.invalidateQueries({ queryKey: ["erp", "colaboradores"] });
                  onVoltar();
                }, id ? "Pessoa atualizada" : "Pessoa cadastrada")
              }
            >
              Gravar
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
            <Button type="button" variant="ghost" onClick={onVoltar}>Cancelar</Button>
          </div>
        </CardContent>
      </Card>
      {id && form.cliente && <ContatosDoCliente clienteId={id} />}
      {id && !form.cliente && <p className="text-sm text-muted-foreground">Contatos de assinatura ficam disponíveis quando a pessoa é cliente.</p>}
      {!id && <p className="text-sm text-muted-foreground">Salve a pessoa cliente para cadastrar os contatos.</p>}
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
