# Validação do Dessine RH

Data da execução: 12/11/2026. Runtime local: Windows, Node.js 24.22.0 e npm 11.19.1. PostgreSQL local: 16.15 em contêiner isolado. A revisão de origem indicada pelo ZIP é 7471e6b262a3f6d4cbafd0e0a1bb5a45a83b12d0. Os 48 arquivos listados no manifesto original passaram na conferência SHA-256 antes de qualquer edição. O ZIP de origem não incluía a pasta .git.

| Verificação | Comando ou ambiente | Resultado e limite |
|---|---|---|
| Baseline | npm ci, npm run typecheck, npm test, npm run build | 20 testes aprovados. Build da revisão recebida confirmado em uma cópia isolada. |
| Entrega integrada | npm run check, com DESSINE_TEST_POSTGRES_URL definido e TZ=America/Sao_Paulo | Typecheck e build aprovados. 35 testes aprovados, 0 falhas e 0 pulados. |
| Dependências | npm audit --json | 0 vulnerabilidades conhecidas reportadas no lockfile. |
| Autenticação e autorização | Supertest, PGlite e PostgreSQL | Login, logout, expiração, senha incorreta, rate limit persistente, conta desativada e perfis de consulta exercitados. Rebaixamento, desativação e logout impediram escritas que já esperavam pelo bloqueio. |
| Dados e folha | Supertest, PGlite e PostgreSQL | Centavos, datas civis, duplicatas, versões, prévia desatualizada, fechamento concorrente, falta versus fechamento, pagamento versus reabertura, rollback, histórico e CSV. Migração de esquema v2 para v3 preservou as folhas. |
| Conta inicial e recuperação | npm run db:admin -- bootstrap e npm run db:admin -- recover, em PostgreSQL local dedicado | Criação idempotente, um evento por ação, senha anterior recusada e sessão anterior revogada. |
| Navegador | Edge Chromium 157.0.4341.46, 1440 × 1000 e 375 × 812 px, dados fictícios | Login, cadastro, faltas, pagamentos, fechamento, reabertura, histórico, comparação, teclado, foco, expiração, erro de rede, CSV e PDF A4. O axe não apontou violações nos cinco estados exercitados. Sem teste manual com leitor de tela. |
| PostgreSQL remoto | Neon em São Paulo, aplicação Express executada localmente | Migração e criação do DP, sessão com cookie Secure, cadastro, falta, fechamento, histórico, exportação autenticada e persistência após reconexão. Banco temporário e sintético. |
| CI | .github/workflows/ci.yml | Workflow configurado com PostgreSQL isolado e ações fixadas. Sem execução no GitHub nesta entrega. |
| Publicação e migração de negócio | Vercel e origem Apps Script | Entrega de código para publicar na conta de destino. Sem deploy Vercel ou migração de dados reais nesta entrega. |

## Regressão de cálculo

Novembro de 2026, com 21 dias úteis e três pessoas fictícias. O caso preservou R$ 10.000,00 de salário base, R$ 1.736,00 de alimentação, R$ 976,00 de transporte, R$ 39,00 retirados dos benefícios por falta e R$ 12.712,00 de total administrativo. O indicador separado de VT de 4% totalizou R$ 400,00.

## Carga e restauração locais

O benchmark usou 1.000 pessoas e 250 faltas sintéticas. Cada endpoint teve três aquecimentos e 30 amostras sequenciais. As latências são de API local, sem navegador ou rede de produção.

| Operação | p50 (ms) | p95 (ms) | Máximo (ms) |
|---|---:|---:|---:|
| Busca de colaboradores | 7,71 | 11,14 | 12,30 |
| Visão geral | 149,61 | 186,85 | 206,34 |
| Prévia da folha | 145,77 | 170,73 | 183,74 |
| Seis edições simultâneas com contenção induzida | 47,26 | 61,05 | 61,05 |

O PostgreSQL observou as seis esperas. A ordenação de 1.000 colaboradores levou 3,024 ms e a consulta das faltas 0,452 ms em medições separadas com EXPLAIN ANALYZE. O ensaio mede uma amostra de desenvolvimento. A carga simultânea esperada em produção precisa ser medida no ambiente definitivo.

O pg_dump produziu um arquivo de 40.042 bytes em 549 ms e o pg_restore em banco separado levou 712 ms. Os tempos incluem WSL e Docker. A restauração reautenticou o DP e preservou 1.000 colaboradores, 250 faltas, sete eventos de auditoria, três compromissos e R$ 4.892.250,00 de total administrativo. Os hashes da folha conferiram.

Use DESSINE_TEST_POSTGRES_URL com um PostgreSQL em loopback e um banco descartável chamado dessine_rh_test para executar node --import tsx --test tests/postgres.test.ts. Para medir volume, execute node --import tsx tests/postgres-benchmark.ts e consulte o próprio script para as variáveis de destino. Use uma base sintética separada do ambiente operacional.

## Limites do aceite

As verificações cobrem a nova aplicação e regras observadas na interface da origem. A planilha completa e o código Apps Script não foram disponibilizados. O ensaio local e o teste do PostgreSQL remoto deixam pendentes o aceite do DP sobre dados reais, a execução de CI e a verificação da URL definitiva na Vercel.
