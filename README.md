# Dessine RH

Painel de gestão de pessoas, salário base, benefícios, faltas e registros administrativos de pagamento.

Consulte [Validação](docs/VALIDACAO.md) para os resultados de testes e o estado da publicação. O pacote de código usa registros fictícios para testes. A migração da base de RH depende de uma exportação autorizada da origem.

## Comece aqui

1. Use o [guia de RH](docs/GUIA-RH.md) para a rotina mensal e os perfis de acesso.
2. Consulte [Operação](docs/OPERACAO.md), [Modelo de dados](docs/MODELO.md), [API](docs/API.md) e [Cálculos](docs/CALCULOS.md) para desenvolver e publicar.
3. Consulte [Validação](docs/VALIDACAO.md) e [Auditoria](docs/REVIEW-INDEPENDENTE.md) para os resultados e limites.

## Stack

- React + TypeScript + Vite; ícones Lucide, gráficos SVG, CSS próprio.
- Express + TypeScript; API no mesmo domínio, adequada a Vercel Functions.
- PostgreSQL em produção; consultas parametrizadas e transações.
- Better Auth + Drizzle; usuários, sessões e limitação de tentativas no banco.
- PGlite somente para desenvolvimento local e testes. Arquivos locais não são o banco de produção.
- `node:test` + Supertest; versões exatas no `package-lock.json`.

## Instalação local

Requer Node.js 24.x e npm. Os comandos abaixo pressupõem uma pasta de projeto nova ou um checkout isolado, sem sobrescrever trabalho existente.

```sh
npm ci
```

Copie `.env.example` para `.env` com `Copy-Item .env.example .env` no PowerShell ou `cp .env.example .env` no Linux. Configure um segredo exclusivo de pelo menos 32 caracteres para `BETTER_AUTH_SECRET` e uma senha exclusiva de pelo menos 12 caracteres para `SEED_ADMIN_PASSWORD`. Mantenha `APP_ENV=local`, `PGLITE_DIR=.data/local` e `BETTER_AUTH_URL=http://localhost:3000`. Deixe `DATABASE_URL` vazio para usar PGlite.

```sh
npm run db:migrate
npm run db:seed
npm run typecheck
npm test
npm run build
npm start
```

Abra `http://localhost:3000`. O usuário inicial de validação é `dp`; a senha é a definida no ambiente local. Os registros do seed são fictícios. O seed recusa execução em produção. Confirme os detalhes da versão final do script antes de executá-lo.

O script `dev` inicia a API e serve os arquivos compilados de `public/` na porta 3000. Para editar o frontend com recarga automática, execute `npx vite` em outro terminal. Configure `BETTER_AUTH_URL=http://localhost:5173` na API e abra a porta 5173. O Vite encaminha `/api` à porta 3000 e o servidor valida a origem do navegador.

## Estrutura

| Caminho | Responsabilidade |
|---|---|
| `src/` | Interface, formulários, navegação e estados |
| `shared/` | Tipos e motor determinístico de cálculo |
| `server/` | Autenticação, validação, API, banco e transações |
| `scripts/` | Inicialização, migração explícita e dados de validação |
| `tests/` | Regressão de regras e integração de API |
| `public/` | Favicon e saída compilada da interface |
| `docs/` | Guias, contratos, auditoria e evidências |

## Escopo

Inclui visão geral, colaboradores, faltas, folha de bases e benefícios, pagamentos, configurações, usuários, histórico e exportação CSV.

Pagamento significa registrar uma operação já realizada fora do sistema. Não há transmissão bancária. Salário base não é salário líquido, e o aplicativo não implementa cálculo fiscal completo ou transmissão ao eSocial.

## Segurança e produção

Configure um PostgreSQL durável para cada ambiente remoto. Execute a migração explícita e o procedimento de conta inicial descritos em [Operação](docs/OPERACAO.md). Confira a conciliação antes de usar a nova base como referência do DP.
