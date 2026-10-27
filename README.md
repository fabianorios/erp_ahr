# ERP AHR

Fase 1 do ciclo da consultoria: centros de custo, clientes, despesas e contas a pagar, custo de pessoal com rateio, propostas, contratos, contas a receber, NFS-e e boleto lançados à mão, fluxo de caixa e margem.

O navegador fala com o projeto Supabase deste ERP pela URL e pela chave anon ou publishable. A service role fica só no servidor, em `POST /api/acesso`, para ler `public.user_roles` e conceder `admin` ao primeiro usuário autenticado. Os papéis seguintes são `consultor`, `editor` e `beta_tester`, os mesmos de `public.has_role`.

Não usa o banco do Gestão Consultoria.

## Variáveis

Ficam no `.env`, que não entra no git:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## Banco

O schema deste projeto já está aplicado. O arquivo `sql/supabase-vazio-erp-fase1.sql` é a cópia do que foi executado. Não rode esse arquivo de novo.

Clientes ficam em `public.clients` (`name`, `document`, `email` e o endereço). O acesso ao financeiro passa por `public.user_roles`.

## Uso

```bash
npm install
npm test
npm run dev
```
