# Publicar uma versão (checklist, rollback e passos na Cloudflare)

**Merge na `main` é deploy em produção.** Este roteiro vale para a 2.0.0 e serve de modelo para as próximas.

## Antes do merge

- [ ] CI verde no PR: `checks`, CodeQL, Invariantes de segurança, Dependências e Roteiros no navegador.
- [ ] `npm run lint`, `npm run typecheck` e `npm test` (com `--maxWorkers=2` se a máquina estiver carregada: os testes de limite de taxa estouram os 5 s do vitest sob carga).
- [ ] `npm run verifica:painel`, `verifica:evento`, `verifica:galeria` e `verifica:previa`, com `PLAYWRIGHT_BROWSERS_PATH` apontando para o Chromium (rode um de cada vez: com a máquina carregada, o zoom do visualizador da galeria já oscilou uma vez em dez). Última rodada de 24/10/2026: painel 240 ok, evento 55 ok, galeria 101 ok, 0 falhas.
- [ ] `VERSAO` (`src/config.js`), `version` do `package.json` e a seção do `CHANGELOG.md` batem.
- [ ] Na prévia do PR: entrar no painel, abrir um projeto, `/robots.txt`, `/sitemap.xml` e `/og-padrao.png`.
- [ ] Migração D1 conferida na prévia (ela tem o banco `fotos-consent-previa`): `node scripts/d1-migrate.mjs` sai com 0.
- [x] Galeria própria sem `GOOGLE_DRIVE_API_KEY`: a página mostra o passo a passo, sem erro de JS nem de CSP (automático em `verifica:galeria`, cenário "Página de erro").
- [x] Galeria própria com centenas de fotos: carga preguiçosa, refazer a grade e poucas tarefas longas (automático em `verifica:galeria`: 244 fotos na grade por aparelho e 800 no cenário "Centenas de fotos"; o visualizador abre sob a CSP estrita, sem mensagem de CSP). Falta só olhar a galeria real com uma pasta grande do Drive.
- [x] Texto alternativo por foto de capa (`photoAlts`): o alt troca no carrossel e no visualizador, com uma foto só vale o da capa, e o campo do painel salva e reabre (automático em `verifica:evento` e `verifica:painel`). Falta só um leitor de tela de verdade.

## Depois do merge

O workflow `deploy.yml` roda lint, tipos e testes, aplica as migrações D1, sobe a versão e confere o `healthz` antes e depois de promover. Se o smoke de produção reprovar, ele reverte sozinho.

- [ ] Abrir `https://fotos.lucafchala.com/api/healthz`: `ok: true` e `versaoSite` igual à versão nova.
- [ ] Conferir no painel, em Ajustes, que a versão aparece.
- [ ] Ver o Uptime Kuma verde. O Worker bate nele a cada 5 minutos.

## Rollback

1. GitHub > Actions > **Deploy** > *Run workflow*.
2. Em `version_id`, colar o UUID da versão anterior (Cloudflare > Workers & Pages > fotos > Deployments). Vazio compila o commit atual.
3. O fluxo promove a versão pedida e roda o smoke.

O que o rollback **não** desfaz:
- migrações D1 (só avançam; as colunas novas ficam, e o código antigo as ignora);
- o que foi gravado no KV com o formato novo. Antes de um deploy que muda formato, baixe o backup em *Ajustes > Baixar backup JSON* (e, se mexer no D1, o `wrangler d1 export` da seção abaixo);
- o `TERMS_VERSION`: aceites já gravados guardam a versão que a pessoa viu.

## Backup do registro de consentimento (D1)

O backup do painel (*Ajustes > Baixar backup JSON*, v3) já leva o registro de consentimento, mas com teto: até **1500 aceites** (os mais recentes), porque o JSON tem de caber nos 10 ms de CPU do plano gratuito. O toast avisa quando veio só parte ("parcial") ou nada ("ausente", D1 fora).

A cópia **completa e fiel** do banco, de qualquer tamanho e com o esquema, é o export do D1:

```bash
npx wrangler d1 export fotos-consent --remote --output=fotos-consent-AAAA-MM-DD.sql
```

(`fotos-consent` é o `database_name` do binding `CONSENT_DB` no `wrangler.toml`; a prévia usa `fotos-consent-previa`, que não precisa de cópia.) Use:

- antes de uma migração D1 nova, de um deploy que mexa no registro ou de apagar/recriar o banco;
- quando o toast do backup disser "parcial" — o registro passou de 1500 aceites;
- de tempos em tempos, junto com o backup JSON, como cópia de segurança do registro.

Para devolver um export a um banco vazio: `npx wrangler d1 execute fotos-consent --remote --file=fotos-consent-AAAA-MM-DD.sql`. Num banco que já tem linhas, prefira restaurar o backup JSON pelo painel: ele só acrescenta o que falta (`INSERT OR IGNORE` por `id`), e o `.sql` do export recria a tabela.

**O arquivo tem IP, User-Agent e nome de terceiros**, como o backup JSON v3: guarde só no seu computador, num disco ou arquivo criptografado, e apague as cópias antigas no prazo do registro (1825 dias; `docs/legal/politica-de-retencao.md`).

## Cron

`wrangler.toml` tem `crons = ["*/5 * * * *"]`. A cada execução só o batimento do Kuma roda. O carimbo `cron:last` e as podas (pedidos de remoção resolvidos, consentimento vencido) rodam só às 03:00 UTC, para não gastar escritas do KV (288 por dia comeriam quase 30% da cota grátis).

## Cloudflare Access (segundo fator do painel)

1. Zero Trust > Access > Applications > Add > Self-hosted.
2. Destino `fotos.lucafchala.com`, caminho `dashboard*`. Só o painel: a home e as páginas dos projetos seguem públicas.
3. Política *Allow* para o e-mail do administrador, login por One-time PIN.
4. Teste em janela anônima: `/dashboard` pede o PIN antes da senha do painel.

Para as prévias de PR: uma segunda aplicação em `*.preview.fotos.lucafchala.com` com a mesma política (feita em 25/10/2026, nome `fotos.lucafchala.com previas`). Ela cobre só o domínio próprio da prévia. O endereço `*-fotos.lucafchala.workers.dev` da mesma prévia **continua sem Access**: na aba *Domains* do Worker o "Enable Access" dessa linha leva à aba *Access*, cujo botão cria uma política para o **Worker inteiro**, o que pode alcançar a rota `workers.dev` de produção. Por isso não foi ligado; a proteção desse endereço é manter o KV de prévia sem links reais de álbuns (seção abaixo). O smoke de produção do `deploy.yml` não passa pelas prévias e não é afetado. Atenção: esse smoke usa o endereço `workers.dev` do Worker de produção (o domínio `fotos.lucafchala.com` responde 403 a cliente que não é navegador). Se o Access for ligado também na rota `workers.dev` de produção, o CI não alcança o smoke e a reversão automática entra em ação — se o CI falhar ali, é por isso.

## Limpar o KV da prévia

A prévia restaurada de um backup guarda os links reais dos álbuns. O namespace de prévia é o `e059470a54d34b93a65402bbcd0fa310` (`[[previews.kv_namespaces]]`); o de produção é outro, e **não** deve ser tocado.

```bash
npx wrangler kv key list   --namespace-id e059470a54d34b93a65402bbcd0fa310 --remote
npx wrangler kv key delete <chave> --namespace-id e059470a54d34b93a65402bbcd0fa310 --remote
```

## Decisões que valem aqui

- Sem Workers Paid: só quando um limite *medido* apertar (`docs/PLANO-PAGO.md`).
- Sem segredos `PREVIA_*` por enquanto: a prévia fica sem e-mail real e sem Drive API.
- O repositório do status não recebe diff por enquanto.
