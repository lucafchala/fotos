# fotos.lucafchala.com

Galeria pública de fotos do fotógrafo Luca F. Chala — site de **entrega** de fotos, painel administrativo, Termos de Uso com **autorização de uso de imagem** registrada (LGPD), solicitação de remoção de fotos, métricas, backup e PWA. Roda em **um único Cloudflare Worker** com **Workers KV** como banco principal e um banco **Cloudflare D1** para o registro de consentimento. Não há build step, framework nem dependências runtime — só JavaScript puro renderizando HTML no servidor.

URL de produção: <https://fotos.lucafchala.com>

---

## Sumário

- [Visão geral](#visão-geral)
- [Stack e arquitetura](#stack-e-arquitetura)
- [Como rodar localmente](#como-rodar-localmente)
- [Configuração (KV, secrets, env vars)](#configuração-kv-secrets-env-vars)
- [Deploy](#deploy)
- [Estrutura de arquivos](#estrutura-de-arquivos)
- [Modelo de dados (KV)](#modelo-de-dados-kv)
- [Rotas HTTP](#rotas-http)
- [Páginas públicas](#páginas-públicas)
- [Painel administrativo `/dashboard`](#painel-administrativo-dashboard)
- [Sistema de solicitação de remoção (LGPD)](#sistema-de-solicitação-de-remoção-lgpd)
- [Termos de Uso e autorização de uso de imagem (LGPD)](#termos-de-uso-e-autorização-de-uso-de-imagem-lgpd)
- [Autenticação e segurança](#autenticação-e-segurança)
- [E-mails transacionais (Resend)](#e-mails-transacionais-resend)
- [Métricas](#métricas)
- [Backup e restauração](#backup-e-restauração)
- [PWA, ícones e analytics](#pwa-ícones-e-analytics)
- [Health check e CI](#health-check-e-ci)
- [Rate limiting](#rate-limiting)
- [Convenções e detalhes do código](#convenções-e-detalhes-do-código)
- [Como o Drive vira foto na página](#como-o-drive-vira-foto-na-página)
- [Limitações conhecidas](#limitações-conhecidas)
- [Roadmap (TODO.md)](#roadmap-todomd)

---

## Visão geral

O site tem três audiências:

1. **Visitante público** — abre `/` para ver a galeria de projetos, clica num card para abrir a página do projeto (`/<slug>`), vê descrição, fotos de capa em carrossel e um botão "Acessar fotos" que abre uma modal com o gate de acesso: verificação Turnstile (pré-carregada assim que a página abre) + aceite dos Termos. Só depois de passar por esse gate — validado no servidor, não no cliente — o link real do Drive é liberado (`POST /api/drive-link`); o botão registra um clique (métrica) e abre o Drive em nova aba. Se a foto pertence a alguém que prefere remover, há um formulário de solicitação de remoção no rodapé.
2. **Cliente / contato** — abre `/suporte` para entrar em contato por WhatsApp, e-mail direto ou formulário (que envia e-mail via Resend para o admin).
3. **Admin (Luca)** — entra em `/dashboard`, autentica com senha (PBKDF2, sessão de 24h em cookie HTTP-only), gerencia eventos (CRUD), ordena, destaca um como featured, marca como "em breve", oculta da galeria, define status de produção, vê métricas de views e cliques no Drive, baixa/restaura backup JSON, troca senha e responde solicitações de remoção (cada "resolver" dispara um e-mail de confirmação ao solicitante).

Cada evento contém: slug (URL), título, descrição curta/longa, até 6 fotos de capa, link da pasta do Drive, data, créditos, link extra, status (em-edição/em-revisão/entregue/arquivado), notas privadas, flags `visible`/`comingSoon`/`pinned`, e um "banner de novas fotos" opcional com expiração configurável.

O design é totalmente dark (`#0a0a0a` base, `#f0ebe5` texto), fonte Inter (Google Fonts), sem JS framework — apenas vanilla. Todo HTML é gerado server-side via template strings em ES modules e enviado com `Content-Type: text/html; charset=utf-8`.

---

## Stack e arquitetura

| Camada | Tecnologia |
| --- | --- |
| Runtime | Cloudflare Workers (V8 isolates, sem Node.js) |
| Banco | Cloudflare Workers KV — namespace `FOTOS` (estado principal) + Cloudflare **D1** (`CONSENT_DB`) para o log de consentimento |
| Auth | PBKDF2-SHA256 (100k iterações) + sessão HTTP-only em KV |
| E-mail | Resend API (`https://api.resend.com/emails`) |
| Frontend | HTML/CSS/JS renderizado no Worker (sem build) |
| Dev tooling | Wrangler ≥ 4 (`npm run dev` / `npm run deploy`), Vitest (`npm test`), ESLint (`npm run lint`) — **Node ≥ 22** |
| CI/CD | GitHub Actions (`deploy.yml`: testes → migrations D1 → deploy → smoke tests; `checks.yml`: lint + testes + sintaxe) |
| Retenção | Cron diário (`scheduled`) apaga solicitações de remoção resolvidas > 180 dias |
| Fontes externas | Google Fonts (Inter) |
| Imagens | Hospedadas no Google Drive, servidas via `lh3.googleusercontent.com/d/<fileId>` (thumbnails da galeria pedem variante `=w600`/`=w1600`) |
| Analytics | Cloudflare Web Analytics beacon (opcional, controlado por `CF_ANALYTICS_TOKEN`) |
| Anti-bot | Cloudflare Turnstile (modo *managed*) protege os formulários e a liberação do link do Drive |
| Consentimento | Aceite dos Termos antes do acesso ao Drive, registrado em D1 (`image_use_consent`), retenção ~5 anos |

**Sem ORM, sem JSX/React, sem bundler.** O estado principal é uma única chave KV `events` (array JSON de todos os eventos), mais chaves de sessão/contador/rate-limit/categorias. Um banco **D1** (SQLite) guarda apenas o log append-only de consentimento de uso de imagem (`image_use_consent`). As páginas HTML são strings literais geradas em runtime — fácil de ler, fácil de mudar, zero overhead de build.

O fluxo de uma requisição é:

```
Request → fetch(request, env, ctx) em src/index.js
  ↓ roteamento por path + método (cadeia de ifs)
  ↓ handler chama getEvents(env) ou outro helper
  ↓ chamada(s) a env.FOTOS.get/put/delete
  ↓ função em src/ui/*.js gera HTML
  ↓ wrapper html(content) adiciona headers de segurança
  ↓ Response
```

---

## Como rodar localmente

**Requer Node.js ≥ 22** (`engines` no `package.json`). O wrangler 4 declara
`node >= 22` e simplesmente se recusa a rodar em versões anteriores — os
workflows do CI usam a mesma versão, de propósito.

```bash
# 1. Instalar dependências de dev (wrangler, vitest, eslint)
npm install

# 2. Login no Cloudflare (uma vez por máquina)
npx wrangler login

# 3. Subir o dev server
npm run dev
```

Antes de abrir PR:

```bash
npm test     # Vitest — 98 testes, ~1 s
npm run lint # ESLint sobre src/ e tests/
```

O Wrangler escuta em `http://localhost:8787`. Por padrão ele se conecta ao KV **remoto** (id em `wrangler.toml`); para usar KV local, rode `npx wrangler dev --local`.

**Importante:** mesmo em dev, o dashboard exige uma senha. No primeiro acesso a `/dashboard`, se a chave KV `admin_password` não existir, a tela de login vira tela de setup ("Criar senha de acesso"). Defina uma e o app salva o hash PBKDF2.

Para resetar a senha em dev: `npx wrangler kv key delete admin_password --binding=FOTOS`
(a forma antiga `kv:key` com dois-pontos saiu no wrangler 4).

---

## Configuração (KV, secrets, env vars)

### `wrangler.toml`

```toml
name = "fotos"
main = "src/index.js"
compatibility_date = "2024-11-01"
account_id = "e5869d6881e992cf4681ce85583a6ab2"

[[kv_namespaces]]
binding = "FOTOS"
id = "4d2c399e77804f3a82b66e4ec0a7fa5e"

# Log de consentimento de uso de imagem. Remover este bloco torna
# env.CONSENT_DB indefinido e a gravação um no-op seguro.
[[d1_databases]]
binding = "CONSENT_DB"
database_name = "fotos-consent"
database_id = "d6bed362-4ddf-459d-a088-48b42aa11fdc"
migrations_dir = "migrations"

[triggers]
# Diário 03:00 UTC — purga solicitações resolvidas + consentimentos expirados.
crons = ["0 3 * * *"]

[env.preview]
name = "fotos-preview"
```

O binding `FOTOS` é referenciado em todo o código como `env.FOTOS`. Para fork pessoal: crie um KV namespace novo (`npx wrangler kv namespace create FOTOS`) e troque o `id`.

### Variáveis de ambiente / secrets

Definir via `npx wrangler secret put <NAME>` (ficam criptografados no Cloudflare).

| Nome | Obrigatório? | Para que serve |
| --- | --- | --- |
| `RESEND_API_KEY` | Não (sem ela, e-mails são pulados silenciosamente) | API key do Resend para enviar notificações de remoção, confirmações e formulário de suporte |
| `ADMIN_EMAIL` | Necessário se `RESEND_API_KEY` definido | Destinatário das notificações de admin (remoções, suporte) |
| `CF_ANALYTICS_TOKEN` | Não | Token do Cloudflare Web Analytics. Quando presente, o script `beacon.min.js` é injetado nas páginas públicas |
| `ADMIN_PASSWORD` | Apenas em deploy novo / KV zerado | Semeia a senha do dashboard quando `admin_password` não existe no KV. **Não há mais setup público de primeira execução** — sem KV e sem este secret, o login fica bloqueado |
| `TURNSTILE_SECRET_KEY` | Sim (fail-closed) | Verificação Turnstile do formulário de suporte e remoção de fotos. Se ausente, esses formulários são bloqueados |

Variáveis lidas como `env.<NOME>` dentro de `fetch(request, env, ctx)`.

### Banco D1 — log de consentimento (`CONSENT_DB`)

O aceite dos Termos / autorização de uso de imagem é gravado num banco **Cloudflare D1** (free tier). O binding fica **comentado** em `wrangler.toml` por padrão — enquanto não existir, `env.CONSENT_DB` é `undefined` e o registro de consentimento vira **no-op seguro** (o resto do site funciona normalmente). Para ativar:

```bash
# 1. cria o banco (imprime o database_id)
npx wrangler d1 create fotos-consent
# 2. cole o id e descomente o bloco [[d1_databases]] (binding = "CONSENT_DB") em wrangler.toml
# 3. aplica a migração que cria a tabela image_use_consent
npx wrangler d1 migrations apply fotos-consent --remote
```

A migração vive em `migrations/0001_consent.sql`. Retenção: o cron diário apaga linhas com mais de ~5 anos (`CONSENT_RETENTION_DAYS`, em `src/index.js`).

### Turnstile

Use o widget no modo **managed** (painel da Cloudflare) para verificação sem atrito (sem desafio visível na maioria dos acessos). O `TURNSTILE_SECRET_KEY` é verificado server-side em `/api/drive-link` (fail-closed — sem ele, o link do Drive nunca é liberado), no formulário de remoção e no suporte.

---

## Deploy

Há dois caminhos:

### 1. Automático (GitHub Actions, padrão)

Qualquer push em `main` dispara `.github/workflows/deploy.yml`:

1. Checkout do repositório.
2. `npm test` — gate pré-deploy: teste vermelho aborta o job antes de tocar em produção.
3. `wrangler d1 migrations apply fotos-consent --remote` (`continue-on-error`: uma falha de migração não bloqueia o deploy, porque o INSERT de consentimento é best-effort).
4. Deploy com `cloudflare/wrangler-action@v4` usando `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` (secrets do GitHub). A versão do wrangler vem de `env.WRANGLER_VERSION`, no topo do workflow — **mantenha-a em sintonia com o devDependency do `package.json`**: sem o pin explícito a action cai no default v3.90, e a produção rodaria numa major que nenhum teste exercitou.
5. `sleep 20` aguardando propagação global.
6. Smoke tests via `curl` contra a URL **workers.dev** do deploy (`steps.deploy.outputs.deployment-url`), não contra o domínio de produção — a zona `fotos.lucafchala.com` fica atrás do bot mitigation da Cloudflare, que responde 403 a clientes não-browser como o `curl`:
   - `GET /` retorna 200
   - `GET /dashboard` retorna 200
   - `GET /manifest.json` retorna 200
   - `GET /icon.svg` retorna 200
   - `GET /__no_such_route__` retorna 404
   - `GET /api/healthz` retorna `{"ok":true,…,"hashMs":<n>}` e `hashMs ≤ 200` (acima disso, login estouraria o orçamento de CPU do Worker)
   - `POST /dashboard/login` com senha errada retorna 302 (e não 5xx — 5xx indicaria CPU timeout)

Qualquer falha no smoke test marca o deploy como vermelho mas o Worker já foi publicado — então um deploy "vermelho" ainda alterou produção. Veja **Rollback** abaixo.

### 2. Manual

```bash
npx wrangler deploy
```

### Rollback

O smoke test roda *depois* da publicação, então todo deploy é potencialmente um incidente. O caminho de volta:

```bash
# 1. Qual commit está em produção agora?
git log --oneline -5 main

# 2. Reverter o commit ruim e republicar pelo pipeline (preferido — mantém
#    main e produção em sincronia, e o histórico registra o quê e o porquê).
git revert <sha-ruim>
git push origin main
```

Para cortar o caminho quando o site está fora do ar, o dashboard da Cloudflare
(Workers → `fotos` → Deployments) permite promover um deployment anterior sem
passar pelo Git — **mas isso deixa `main` à frente da produção**, então logo em
seguida faça o revert no Git para não perder a rastreabilidade.

Duas coisas que o revert de código **não** desfaz, e que precisam de atenção
antes de reverter:

- **Migrações D1 aplicadas.** São aditivas e idempotentes hoje (`migrations/`),
  então voltar o código não quebra o schema — mas uma migração destrutiva
  futura exigiria um plano próprio.
- **Dados já gravados em KV/D1** pelo código novo (contadores, linhas de
  consentimento). Continuam lá.

Marque um release a cada deploy relevante (`git tag -a v1.4 -m "..." && git push
origin v1.4`) para que "voltar para a última versão boa" seja um SHA conhecido
em vez de arqueologia no log.

---

## Estrutura de arquivos

```
fotos/
├── README.md               ← este arquivo
├── TODO.md                 ← pendências em aberto (entregue sai de lá; histórico no git)
├── SECURITY.md             ← política de segurança, escopo, invariantes p/ contribuir
├── LEGAL.md                ← termos, licença de uso das fotos
├── package.json            ← scripts dev/deploy/lint/test; engines.node >= 22
├── eslint.config.js        ← flat config; lint cobre src/ e tests/
├── wrangler.toml           ← config do Worker, bindings KV + D1, cron diário
├── migrations/
│   ├── 0001_consent.sql    ← tabela D1 image_use_consent (log de consentimento)
│   └── 0002_access_type.sql← coluna access_type + declaração por tipo de acesso
├── .github/
│   └── workflows/
│       ├── deploy.yml      ← CI: testes → migrations D1 → deploy → smoke tests
│       └── checks.yml      ← CI: lint + testes unitários + validação JSON/sintaxe
├── tests/                  ← Vitest (119 testes)
│   ├── index.test.js       ← backup/restore, normalizeEventFields, cronStale, auditSite
│   ├── drive-gate.test.js  ← handleDriveLink (cada recusa do gate), handlePerfBeacon, toCount
│   ├── kv.test.js          ← rate limit, getEvents/saveEvents, resiliência a KV corrompido
│   ├── utils.test.js       ← escape, toHttps/safeUrl, slug, datas, hash de senha, os 5 sendXEmail()
│   └── healthz.test.js     ← handleHealthz, scheduled() (isolamento + alerta de falha), login (rate-limit/cookie), render de /sobre e /equipamentos
└── src/
    ├── index.js            ← roteador + todos os handlers HTTP (Worker entry)
    ├── utils.js            ← getEvents/saveEvents, hash, sessão, rate-limit, e-mails, TERMS_VERSION
    └── ui/
        ├── gallery.js      ← HTML da galeria pública /
        ├── event.js        ← HTML da página de projeto /<slug>
        ├── dashboard.js    ← HTML do login e do painel admin /dashboard
        ├── support.js      ← HTML da página de suporte /suporte
        ├── privacy.js      ← HTML da Política de Privacidade /privacidade
        ├── terms.js        ← HTML dos Termos de Uso /termos
        ├── about.js        ← HTML de /sobre
        └── gear.js         ← HTML de /equipamentos
```

Tamanhos aproximados: `index.js` ~85 KB, `dashboard.js` ~80 KB (tem todo o JS do painel inline), `event.js` ~63 KB, `gallery.js` ~24 KB, `utils.js` ~23 KB, `support.js` ~10 KB. Tudo cabe folgadamente no limite de 10 MB do Workers script.

---

## Modelo de dados (KV)

Tudo vive numa única instância de KV (`binding = "FOTOS"`). Chaves usadas:

| Chave | Conteúdo | Quem escreve |
| --- | --- | --- |
| `events` | JSON: array com **todos** os eventos | `handleCreateEvent`, `handleUpdateEvent`, `handleDeleteEvent`, `handleRestoreBackup` |
| `admin_password` | String no formato `pbkdf2:<iter>:<saltHex>:<hashHex>` (ou SHA-256 legado, migrado no próximo login) | `handleLogin` (primeira vez ou setup), `handleChangePassword` |
| `admin_session:<token>` | String `"valid"` com `expirationTtl=86400` (24 h) | `handleLogin` ao sucesso; deletada no logout |
| `views:<slug>` | String numérica (contador de visualizações da página do projeto) | `handleEventPage` via `ctx.waitUntil` |
| `drive_clicks:<slug>` | String numérica (contador de cliques no botão "Ir para o Drive") | `handleTrackDrive` |
| `removal_requests` | JSON: array com até 500 solicitações de remoção (rotação FIFO de resolvidas) | `handleRemovalRequest`, `handleResolveRequest` |
| `categories` | JSON: array de nomes de categorias gerenciáveis | `handleCreateCategory`, `handleDeleteCategory` |
| `ratelimit:<key>:<ip>:<window>` | String numérica, TTL = janela | `checkRateLimit` (todas as rotas com rate limit) |

> O log de consentimento **não** fica no KV — vive no D1 (`image_use_consent`, ver abaixo).

### Schema de um evento

```js
{
  id: "16 bytes hex",            // generateId()
  slug: "meu-evento-2025",       // [a-z0-9-], 1..60, validado por validateSlug
  title: "string ≤ 200",
  longDescription: "string ≤ 5000",
  photos: ["url1", "url2", ...],  // até 6, https-only depois do toHttps()
  thumbnailUrl: "url1",           // sempre = photos[0] || legado
  driveUrl: "https://drive.google.com/drive/folders/...",
  driveUrlInstagram: "https://drive.google.com/drive/folders/...", // opcional — pasta já redimensionada p/ Instagram
  date: "YYYY-MM-DD",             // ou "" — validado contra regex
  eventCredits: "string ≤ 200",   // exibido como "Em colaboração com: <valor>" (instituição, fotógrafo colaborador ou projeto)
  projectUrl: "string ≤ 500",
  visible: true,                  // se false, some da galeria pública
  comingSoon: false,              // se true, esconde fotos e troca botão por "As fotos virão em breve"
  status: "em-edicao" | "em-revisao" | "entregue" | "arquivado",
  accessType: "public" | "private" | "family", // declaração extra exigida no gate do Drive para private/family
  category: "string",             // alimenta os filtros da galeria e do dashboard; lista gerenciável em Config
  internalNotes: "string ≤ 5000", // só visível no dashboard
  pinned: false,                  // se true, vira card destacado (max 1 por vez — auto-desafixa outros)
  photosAlert: {
    active: false,
    addedAt: ISO date string | null,
    expiresAfterHours: 24
  },
  createdAt: ISO date string,
  updatedAt: ISO date string      // só presente após primeiro update
}
```

### Schema de uma solicitação de remoção

```js
{
  id: "16 bytes hex",
  eventSlug: "string",
  eventTitle: "string",           // snapshot do título na hora da request
  method: "number" | "url" | "upload",
  value: "Foto nº 12" | "https://..." | null,
  email: "string",
  phone: "string",
  message: "string ≤ 1000",
  fileName: "string" | null,      // só para method = "upload"
  fileBase64: null,               // apagado antes de persistir no KV (vai só no e-mail)
  resolved: false,
  createdAt: ISO,
  resolvedAt: ISO | undefined,
  emailStatus: "sent" | "skipped..." | "error: ...",
  confirmEmailStatus: "sent" | null | "error: ...",
  resolvedEmailStatus: "sent" | null | "error: ..."
}
```

Quando `removal_requests` passa de 500 itens, mantém **todos** os não-resolvidos e descarta os resolvidos mais antigos (FIFO).

### Tabela D1 `image_use_consent`

Banco `CONSENT_DB` (D1/SQLite). Uma linha **append-only** por acesso ao Drive (aceite dos Termos / autorização de uso de imagem):

```
id, created_at, event_slug, event_title, drive_target, access_type, terms_version,
terms_hash (SHA-256 do texto exato dos Termos), consent_text, declaration_text, consenter_name,
turnstile_ok, ip, country, region, city, timezone, asn, as_org, colo,
user_agent, accept_language, referrer, page_url
```

Coletado server-side em `handleDriveLink` (`POST /api/drive-link`) a partir de `request.headers` + `request.cf` — sempre com os textos canônicos do servidor (`TERMS_VERSION`/`CONSENT_LABEL`/declaração), nunca o que o client mandar. Exportável em CSV por `GET /api/consent/export` (auth). Retenção de ~5 anos via cron diário (`pruneOldConsent`).

---

## Rotas HTTP

Roteador único em `src/index.js`, baseado em cadeia de `if`s. Ordem importa — a regex `/^\/([a-z0-9][a-z0-9-]*)$/` que casa páginas de evento é **a última**, para não capturar `/dashboard`, `/suporte`, etc.

### Públicas

| Método | Path | Função | O que faz |
| --- | --- | --- | --- |
| GET | `/` | `handleGallery` | HTML da galeria com cards de todos os eventos `visible !== false`, ordenados por pinned + data desc |
| GET | `/<slug>` | `handleEventPage` | HTML do projeto (página de entrega). Incrementa `views:<slug>` em `ctx.waitUntil`. O link do Drive **não** é embutido nesse HTML — só chega ao cliente via `/api/drive-link`, depois do gate |
| GET | `/suporte` | `supportHTML()` | Página de contato com WhatsApp + e-mail + formulário |
| GET | `/privacidade` | `privacyHTML()` | Política de Privacidade (LGPD) |
| GET | `/termos` | `termsHTML()` | Termos de Uso + autorização de uso de imagem |
| GET | `/sobre` | `aboutHTML()` | Bio curta, como funciona o trabalho, contato |
| GET | `/equipamentos` | `gearHTML()` | Lista de equipamento fotográfico |
| GET | `/manifest.json` | `handleManifest` | Manifest PWA |
| GET | `/icon.svg` | `handleIcon` | Ícone SVG inline (rect 256x256 com "f." centralizado) |
| POST | `/api/removal-request` | `handleRemovalRequest` | Recebe solicitação de remoção (rate-limit: 5/h por IP), envia e-mails, persiste |
| POST | `/api/track-drive` | `handleTrackDrive` | Incrementa `drive_clicks:<slug>` (rate-limit: 60/h por IP) |
| POST | `/api/drive-link` | `handleDriveLink` | **O único lugar que devolve o link real do Drive.** Valida o Turnstile no servidor (fail-closed, 403 se falhar), o slug, o aceite dos Termos (+ declaração quando exigida), rate-limit 60/h por IP (10/h no caminho `noscript` p/ ad-blocker) — e grava o aceite em D1 (best-effort, no-op sem D1) |
| POST | `/api/perf` | `handlePerfBeacon` | Beacon de performance (Web Vitals) enviado por `navigator.sendBeacon`, amostrado a 10% no cliente. Responde sempre `204` sem corpo, inclusive para payload inválido — é fire-and-forget e nunca pode 500. **Não escreve em KV** (a cota de escrita é reservada para eventos/sessões/consentimento): o destino é log estruturado e, se o binding `PERF` existir, um dataset do Analytics Engine. Sem rate-limit por KV (custaria mais que o beacon economiza); um beacon com `Origin` de outro site é descartado |
| POST | `/api/suporte` | `handleSupportRequest` | Envia e-mail do formulário de suporte (rate-limit: 5/h por IP) |
| GET | `/api/healthz` | `handleHealthz` | `{ok, kv, events, d1, hashMs, …}` (+ `kvLatencyMs`, `cron`, `config`, …; 2 leituras de KV) — usado pelo CI e pelo dashboard de status |

### Autenticadas (cookie `session` válido)

| Método | Path | Função |
| --- | --- | --- |
| GET | `/dashboard` | Painel ou tela de login/setup |
| POST | `/dashboard/login` | Recebe form, valida ou cria senha, cria sessão |
| POST | `/dashboard/logout` | Deleta sessão no KV + cookie expirado |
| POST | `/api/events` | Criar evento |
| PUT | `/api/events/<id>` | Atualizar evento (parcial; só campos enviados) |
| DELETE | `/api/events/<id>` | Excluir evento e deletar `views:<slug>` |
| POST | `/api/events/bulk-category` | Aplica uma categoria a vários eventos de uma vez (`{ids, category}`) — dashboard exige confirmação digitada antes de chamar |
| POST | `/api/events/bulk-access` | Aplica um `accessType` a vários eventos de uma vez (`{ids, accessType}`) — mesma confirmação digitada |
| GET | `/api/metrics` | Lista [{slug, title, views, driveClicks}] ordenada por views desc |
| GET | `/api/consent/export` | CSV do log de consentimento (D1); 503 se o D1 não estiver provisionado |
| PUT | `/api/settings/password` | Trocar senha do admin |
| GET | `/api/backup` | Download JSON **v2** (eventos + categorias + solicitações) |
| POST | `/api/backup/restore` | Merge de backup (v1 ou v2) com o KV atual (por id, mais recente vence) |
| GET | `/api/removal-requests` | Lista solicitações ordenadas por data desc |
| PUT | `/api/removal-requests/<id>/resolve` | Marca resolvida e envia e-mail "Solicitação atendida" ao requerente |

### Erros

- `notFound()` retorna 404 com um HTML mínimo escuro tipo "404 / Página não encontrada / ← Voltar para a galeria".
- Qualquer exceção não tratada cai no `catch` do `fetch` e retorna 500 `"Erro interno."`.
- Helpers: `jsonOk(data, status=200)`, `jsonErr(message, status=400)`, `redirect(location)`.

### Headers de segurança (em toda resposta HTML)

```
Content-Type: text/html; charset=utf-8
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: upgrade-insecure-requests
```

O CSP `upgrade-insecure-requests` faz o browser converter automaticamente qualquer `http://` para `https://`, eliminando "mixed content" se um link antigo de foto ainda tem protocolo inseguro no KV. Em paralelo, a função `toHttps()` normaliza URLs ao salvar.

---

## Páginas públicas

Todas as oito páginas públicas (`/`, `/<slug>`, `/sobre`, `/equipamentos`, `/termos`, `/privacidade`, `/suporte`, mais o listing raiz) compartilham um rodapé gerado por `footerLegalLinksHTML(extra)` (`src/utils.js`): links Sobre/Equipamento/Suporte/Privacidade/Termos/Código-fonte + linha de copyright com o ano calculado em tempo de request (`© {ano} Luca F. Chala. Todos os direitos reservados.`, sempre correto, sem cron). O parâmetro `extra` (opcional, string HTML) deixa uma página específica encaixar mais um link nessa mesma linha — hoje só o evento usa, pro "Ver tour novamente" — sem toda página ganhar um link que só faz sentido numa. "Sugestões" propositalmente **não** entrou nesse rodapé (ficaria apertado); vive só no aviso de nova interface, abaixo. A galeria e a página de projeto também mostram, no topo, um **aviso dispensável de "nova interface"** (`updateBannerHTML()`, mesmo `src/utils.js`) com links "Reportar" e "Tem uma sugestão?" para `/suporte?tema=bug` e `/suporte?tema=sugestao` (pré-preenchem a mensagem do formulário); a dispensa é lembrada via `localStorage['fotos:update_banner_dismissed']`, por página (cada uma escuta o próprio botão de fechar).

Todas as páginas públicas respeitam **`prefers-color-scheme`** automaticamente — sem toggle manual (o experimental foi removido em fase anterior e não volta). Cada arquivo declara seu próprio conjunto de variáveis CSS (`:root{...}` + `@media(prefers-color-scheme:light){:root{...}}`), sem CSS compartilhado entre páginas — mesmo padrão de "cada página é seu próprio template literal" já usado no resto do projeto. Chrome sobreposto a uma foto (pill de voltar, setas/dots/contador do carrossel, badges do card) fica sempre escuro/translúcido nos dois temas, porque a função dele é contraste contra a foto, não contra a página. Os botões de CTA ("Acessar fotos", "Ir para o Drive", "Enviar mensagem") usam a cor de destaque dourada como fundo nos dois temas (`--cta-bg`/`--cta-text`) — mesma cor de marca em vez de inverter pra uma pílula preto/branco conforme o tema. O dashboard admin **não** foi incluído nesse trabalho — continua só escuro.

### `/` — Galeria (`src/ui/gallery.js`)

- Header com o logo `fotos · Luca F. Chala` (tema claro/escuro automático via `prefers-color-scheme`, sem toggle).
- Busca por título/URL/categoria + filtro de status + **filtro de categoria** (`<select>`), todos client-side sobre os eventos já carregados — sem requisição nova a cada busca/filtro. Busca e categoria ficam refletidas na URL (`?q=...&cat=...`, via `history.replaceState()`, sem reload) e a posição de rolagem + quantidade carregada ("Carregar mais") ficam em `sessionStorage['fotos:gallery_state']` — voltar da página de um evento (botão Voltar do navegador, ou o pill "todos os projetos", que também carrega o filtro) restaura tudo em vez de resetar a busca.
- Grid **estilo masonry** (CSS Grid com `grid-auto-rows` numa unidade fina + `layoutMasonry()` calculando quantas "linhas" cada card ocupa a partir da altura real do conteúdo), não mais um grid de proporção fixa: cada thumbnail segue a proporção real da foto, sem cortar fotos retrato numa caixa pensada para paisagem. Ao contrário de uma abordagem por `column-count` (que preenche coluna por coluna), o Grid preenche linha por linha na ordem do DOM, então a ordem de leitura continua previsível (item 2 sempre ao lado do item 1, não em qualquer coluna que a aritmética decidir). Recalcula no carregamento de cada imagem (inclusive as `loading="lazy"` fora da tela) e no resize, com `align-items:start` garantindo que a altura lida seja sempre a real, nunca uma esticada de um cálculo anterior. Os placeholders "em breve" (ícone/capa borrada) continuam com proporção fixa — não há foto real ali para respeitar.
- Cada card mostra: thumbnail (com shimmer loader animado enquanto carrega), data formatada em PT-BR ("12 de maio de 2025"), título (maior que antes) e tag de categoria — **sem descrição** (o campo `shortDescription` foi removido do modelo de dados).
- Eventos com `pinned: true` ocupam toda a largura (grid-column 1/-1, hero 16:9) e ganham badge "Em destaque".
- Eventos com `comingSoon: true` mostram badge "em breve" no canto, ícone de relógio no lugar do thumb.
- Eventos com `visible: false` são filtrados fora.
- Ordenação: pinned primeiro, depois por `date` desc (fallback `createdAt`).
- Footer com link para Instagram (@lucafchala) + o bloco de rodapé compartilhado descrito acima.

### `/<slug>` — Página de projeto (`src/ui/event.js`)

Arquivo grande (~40 KB) porque inclui HTML + CSS + JS inline. Componentes:

- **Banner de novas fotos** (se `photosAlert.active` e dentro da janela de expiração): "Novas fotos adicionadas — há X minutos/horas/dias", atualizado em JS a cada 60s.
- **Hero**: sem mais a barra "todos os projetos" acima da foto (antigo `<header>` removido) — um pill semitransparente com blur (`.back-pill`), sobreposto no canto superior esquerdo do hero, leva de volta para `/` (carregando o filtro da galeria de onde veio, se aplicável — ver seção da galeria), legível sobre qualquer foto. Se `comingSoon`, mostra placeholder com ícone de relógio + "Em breve". Se 0 fotos, ícone de câmera. Se 1 foto, hero único. Se ≥ 2, **carrossel** com botões anterior/próxima, dots, contador (1/N), e swipe touch (`touchstart`/`touchend` com threshold 40px). Tocar/clicar em qualquer foto de preview abre um **lightbox** em tela cheia (setas/swipe para navegar, double-tap ou duplo clique para zoom 2.2×, Escape/fundo/botão fecha) — é só visualização das fotos de prévia já embutidas na página, não tem download nem substitui o fluxo do Drive.
- **Conteúdo**: data, título grande, descrição longa opcional (`white-space: pre-wrap`, sem espaço morto quando ausente), botão "Acessar fotos" (pulso sutil de atenção se ficar ~11s sem clique).
- **Modal "Acessar fotos"** (gate real, verificado no servidor): termos + botão de acesso aparecem **juntos e imediatamente** ao abrir — o Turnstile já foi pré-carregado de forma invisível assim que a página abriu (`execution:'execute'`), então normalmente já está pronto; não há mais uma tela de "Carregando…" escondendo os termos. O botão fica visível mas com cor "desabilitada" até o link real chegar; o ícone vira um spinner assim que os termos/declaração são aceitos — não só durante a requisição, mas também no intervalo em que só falta o Turnstile liberar um token (`maybeFetchDriveLink()` acende o spinner nos dois casos). O botão continua clicável nesse intervalo (não trava por CSS); clicar antes de aceitar os termos faz a caixa de aceite piscar e mostra "você precisa aceitar os termos e declarações primeiro" por ~3,5s, e clicar depois de aceitar mas antes do link estar pronto mostra "só um instante, o acesso ainda está carregando" pelo mesmo período (mensagens só aparecem reagindo ao clique, nunca ficam fixas). Assim que Turnstile + Termos estão OK, o link real é buscado automaticamente em `POST /api/drive-link` (sem esperar clique extra); uma vez pronto, um pulso sutil chama atenção se ficar alguns segundos sem clique. Erro de verificação mostra mensagem compacta com opção de tentar de novo — a linha de contato de emergência ("fale comigo" / "me chame no WhatsApp") usa o mesmo tom vermelho-erro (`.dv-contact` casa com `.dv-msg`), em vez de destoar com uma cor separada. Se um bloqueador de anúncios impede o carregamento do Turnstile, exibe um aviso pedindo para desativá-lo / ativar o JavaScript — o acesso ainda é possível por um caminho mais fraco (sem captcha, rate-limit próprio mais restritivo, auditado como não-verificado), decisão consciente para não travar a entrega a esse público (ver seção LGPD e `SECURITY.md`). A caixa "Antes de acessar" mostra a dica de não tirar print, um aviso permanente para **não compartilhar o link do Drive diretamente** (usar o botão Compartilhar do rodapé, que manda a página do projeto com o mesmo controle de acesso), o botão de crédito do Instagram e (se definido) `eventCredits`; depois do botão, uma dica explica como baixar tudo de uma vez no Drive (selecionar tudo + "Fazer download"). O clique final chama `trackDrive()` antes de abrir o Drive em nova aba.
- **Tour guiado**: na primeira visita a cada página de evento (exceto `comingSoon`), um passo a passo tipo coach-mark destaca, um de cada vez, com scroll automático até o elemento: o botão de Acessar fotos, o de remoção, o de compartilhar, os links de Sobre/Equipamento no rodapé e o link de suporte (6 passos). Construído sem biblioteca (4 divs de máscara ao redor do alvo, deixando o elemento real clicável por baixo, em vez de uma máscara com recorte via CSS que exigiria hit-testing; fundo com opacidade baixa — `rgba(0,0,0,.4)` — pra quem está no tour continuar enxergando o resto da página e se localizando). Pulável a qualquer momento (botão "Pular" ou Esc); a dispensa fica em `localStorage['fotos:tour_dismissed']`; reabrível pelo link "Ver tour novamente" no rodapé (junto dos links legais, não nas ações principais). O aviso de não compartilhar o link do Drive vive só na página de acesso (ver acima), não duplicado no tour.
- **Créditos**: link com a logo real do Instagram levando para @lucafchala ("Marque-me"), (opcional) `eventCredits` como "Em colaboração com: <valor>" — cobre instituição, fotógrafo colaborador ou projeto parceiro, não só outro fotógrafo — e link extra do projeto. Nesta seção o Instagram entra como mais uma linha da lista de créditos (mesmo alinhamento/espaçamento, sem o cartão/pill isolado); no modal de acesso ("Antes de acessar") ele continua com o visual de botão de destaque, contexto onde faz sentido chamar mais atenção.
- **Footer**: duas camadas visuais — ações em destaque (Compartilhar/WhatsApp, Copiar link, "Solicitar remoção de foto", texto/contraste mais fortes, sem aparência de botão pill) e os links legais de baixo contraste (Sobre/Equipamento/Suporte/Privacidade/Termos/Código-fonte, mais "Ver tour novamente" encaixado nessa mesma linha via `footerLegalLinksHTML(extra)`) + copyright, via o bloco de rodapé compartilhado.
- **Modal de remoção**: formulário com:
  - Radio: identificar foto por número, link direto ou upload (até 2 MB).
  - E-mail (obrigatório, regex), telefone (obrigatório, 10–13 dígitos).
  - Mensagem opcional.
  - Aviso LGPD curto: "Seus dados (e-mail e telefone) são usados exclusivamente para processar esta solicitação."
  - **Turnstile** obrigatório; como o token é de uso único, o widget é **resetado automaticamente** após uma falha de envio (evita o loop de 403 ao tentar de novo com token gasto). A leitura do arquivo de upload é protegida (erro amigável em vez de falha silenciosa).
  - Submete via fetch para `/api/removal-request`. Sucesso troca o conteúdo da modal por uma tela verde com check.
  - **Bloqueador de anúncios / JS desativado**: se o script do Turnstile não carrega, a modal mostra um aviso (desative o bloqueador, ative o JavaScript, botão de recarregar) e mantém o envio desabilitado — a solicitação exige a verificação server-side.

### `/suporte` — Página de suporte (`src/ui/support.js`)

- Header com link "Voltar".
- Botões grandes: WhatsApp (`wa.me/5511989211178`) e e-mail (`mailto:suporte@lucafchala.com`).
- Divisor "ou envie uma mensagem".
- `?tema=` na URL pré-preenche a mensagem do formulário via `TEMA_PREFILLS` em `src/index.js` — `bug` (link "Reportar" do aviso de nova interface) e `sugestao` (link "Sugestões" do mesmo aviso e do rodapé). Cosmético; nunca confiado no servidor além do texto inicial.
- Formulário POST para `/api/suporte` (form-data, sem fetch — degrada para HTML puro). Campos: nome (opcional), e-mail (opcional, vira `reply_to` se preenchido), mensagem (obrigatório, ≤ 2000 chars). **Turnstile** obrigatório; o botão fica desabilitado até a verificação passar, com **fallback** que o reabilita se o script for bloqueado, mais guarda anti-duplo-envio.
- Após envio, a página é recarregada e mostra caixa verde "Mensagem enviada!". Em caso de erro, **nome/e-mail/mensagem são preservados** (re-renderizados escapados) para não perder o texto digitado.
- Erros (campos vazios, rate limit, Turnstile) mostram caixa vermelha. Se um ad-blocker bloqueia o Turnstile, aparece um aviso para desativá-lo / ativar o JS (ou usar WhatsApp/e-mail); um banner `<noscript>` cobre o caso de JavaScript totalmente desativado.

### `/sobre` e `/equipamentos` (`src/ui/about.js`, `src/ui/gear.js`)

Páginas estáticas simples, sem dados dinâmicos — mesmo esqueleto (header com link "Voltar", `<main>`, rodapé compartilhado). `/sobre` (bio curta + como funciona o trabalho + contato) já existia escrita mas ficava fora do ar de propósito enquanto o texto era revisado; está publicada agora. `/equipamentos` é nova: lista o equipamento fotográfico (câmeras, lentes, acessórios etc.) em seções `<h2>`/`<h3>` + listas. Ambas entram no `sitemap.xml` e no rodapé compartilhado.

---

## Painel administrativo `/dashboard`

Renderizado por `src/ui/dashboard.js`. Mesma página tem login e dashboard:

### Login / setup

- Se KV não tem `admin_password`: tela de setup com campos "Nova senha" + "Confirmar senha". Mínimo 6 chars. Submete em POST para `/dashboard/login` com `setup=1`.
- Se já tem: tela com 1 campo de senha. Erro mostra aviso vermelho "Senha incorreta".
- POST `/dashboard/login` define cookie `session=<64 hex>; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`.

### Dashboard

Layout fixo no topo + abas:

- **Topbar**: logo + links "Ver site" (abre `/` em nova aba) e "Sair" (POST logout).
- **Tabs**: `Eventos`, `Métricas`, `Config.`, `Solicitações` (badge vermelho com contador de não-resolvidas).

#### Aba Eventos

- Header: contador ("N eventos ativos") + botão "+ Adicionar".
- **Busca** (título / URL / categoria) + filtro de status `<select>` (`Todos / Ativos (sem arquivados) / Em edição / Em revisão / Entregue / Arquivado`) + **filtro de categoria** `<select>` — os três combinam, tudo client-side sobre os eventos já carregados.
- No formulário: `Esc` fecha, `Ctrl/⌘+Enter` salva, foco preso (focus trap) no overlay e rodapé de ações fixo (sticky). Fechar com alterações não salvas (Esc, clique fora ou "Cancelar") pede confirmação ("Descartar alterações?"); fechar após salvar com sucesso não pede. Fechar a aba/navegador com o formulário aberto e sujo dispara o aviso nativo do navegador (`beforeunload`).
- **Colar vários links**: botão ao lado de "Adicionar foto" abre uma caixa de texto — um link do Drive por linha — que popula a lista de fotos de uma vez (respeita o limite de 6).
- Lista de eventos (cards horizontais) com: thumb, título + badge de status colorida, slug em monospace, botões de ação à direita:
  - **Pin** (estrela) — toggle. Ao pinar, despina todos os outros (server-side garante max 1).
  - **Eye** — toggle `visible`.
  - **Edit** — abre overlay com formulário pré-preenchido.
  - **Duplicar** — abre o formulário de "novo evento" pré-preenchido com os dados do evento (drive links, categoria, tipo de acesso, créditos, fotos), título com sufixo " (cópia)", `slug` em branco (precisa ser único) e nunca marcado como fixado (evita despinar o original ao salvar).
  - **Delete** (lixeira vermelha) — pede confirmação **digitando o título exato do evento**, não só um clique em "Confirmar" (ver "Confirmações" abaixo).
- **Overlay/formulário de evento** com todos os campos: slug, título, descrição longa, fotos (até 6, com colagem em lote — ver acima — e pré-visualização miniatura inline; campo "blur" converte links de Drive para `lh3.googleusercontent.com`), link do Drive, link do Drive para Instagram, data, "Em colaboração com" (institição/fotógrafo colaborador/projeto), link extra, status, tipo de acesso, **categoria** (lista gerenciável — ver aba Config; alimenta os filtros da galeria e do dashboard), notas privadas, toggles "Visível" e "Em breve", e bloco "Aviso de novas fotos" (toggle + select de expiração: nunca / 1h / 6h / 24h / 48h / 168h).
- **Edição em massa:** botão "Selecionar" mostra checkboxes nos eventos; escolha uma categoria (ou tipo de acesso) e clique "Aplicar" para atribuí-la a todos os selecionados de uma vez (`POST /api/events/bulk-category` ou `/api/events/bulk-access`) — pede confirmação **digitando a quantidade de eventos afetados** antes de aplicar.
- A lista usa renderização híbrida: a primeira página vem **SSR** (renderizada no Worker) e o JS substitui via `renderEventList()` ao mudar filtro. Os botões funcionam via event delegation (`data-action`/`data-id`), então tanto o SSR quanto o re-render funcionam com o mesmo handler.

#### Aba Métricas

Tabela com colunas: projeto, views, cliques no Drive. **Colunas ordenáveis** (clique no cabeçalho), com uma barra proporcional atrás do número de views e botão **Exportar CSV**. Dados carregados sob demanda (na primeira vez que o usuário clica na aba).

#### Aba Config

- **Categorias**: lista gerenciável de categorias (alimenta os filtros da galeria e do dashboard, e o select do formulário). Criar via `POST /api/categories` (`{name}`), excluir via `POST /api/categories/delete` (`{name}`, pede confirmação digitando o nome da categoria) — ao excluir, a categoria é removida de todos os eventos que a usavam. Guardadas na chave KV `categories`; até a primeira alteração valem os padrões (Formatura / Casamento / Ensaio / Evento / Outro).
- **Backup**: botão "Baixar backup JSON" — GET `/api/backup` retorna `fotos-backup-YYYY-MM-DD.json` (v2: eventos + categorias + solicitações). Não-destrutivo, fica fora da zona de perigo.
- **Exportar dados** (CSV): consentimentos (do D1, via `/api/consent/export`), solicitações de remoção e métricas.
- **⚠️ Zona de perigo**: card com borda vermelha, separado visualmente do resto da aba, agrupando as duas ações que mutam dados globais/credenciais e agora exigem confirmação digitada:
  - **Alterar senha**: campos "Nova senha" + "Confirmar senha", botão "Salvar" → confirma digitando `TROCAR` antes do PUT para `/api/settings/password`.
  - **Restaurar backup**: input file + botão "Restaurar backup" → confirma digitando `RESTAURAR` antes do POST para `/api/backup/restore`. Merge inteligente: mesmo `id` é atualizado só se o `updatedAt`/`createdAt` do backup for mais recente. Nada é deletado.

**Confirmações**: `confirmDialog()` (o diálogo temático do painel, não o `confirm()` nativo) ganhou um modo "digite para confirmar" (`opts.typeToConfirm`) — o botão de confirmar fica desabilitado até o texto digitado bater exatamente (case-insensitive) com o esperado. Para exclusões (evento/categoria), digita-se o nome exato do item; para ações sem um "nome" natural (restaurar backup, trocar senha, aplicar em massa), digita-se uma palavra fixa ou a quantidade de itens afetados.

#### Aba Solicitações

Lista de solicitações de remoção agrupadas por evento. Cada grupo mostra título + slug + badge com contador de pendentes. Solicitações pendentes ficam no topo; resolvidas ficam num bloco colapsável "Mostrar resolvidas". Cada item mostra: tipo (número/link/upload), valor identificador, e-mail, telefone, mensagem, data, e botão "Marcar como resolvido" se pendente. Resolver envia e-mail de confirmação ao requerente via Resend.

### Toast

`<div class="toast">` no rodapé. Funções globais `toast(msg, 'ok'|'err')` mostram por ~2s.

---

## Sistema de solicitação de remoção (LGPD)

Fluxo completo:

1. Visitante abre página do projeto, clica "Solicitar remoção de foto" no footer.
2. Modal abre. Visitante escolhe identificação (número da foto, link direto ou upload de até 2 MB), preenche e-mail + telefone (com DDD, 10–13 dígitos), motivo opcional. Submete.
3. Frontend valida tudo client-side (`/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` para e-mail, `.replace(/\D/g,'')` para telefone) e faz POST `/api/removal-request` com `fileBase64` se upload.
4. Worker faz rate-limit (5/h por IP), valida tudo de novo server-side, monta o registro, salva no KV **sem** o `fileBase64` (binário só vai no e-mail), e:
   - **E-mail para admin** (`sendRemovalEmail`): tabela com projeto, tipo, identificação, e-mail/telefone, mensagem, data. Se upload, anexa o arquivo.
   - **E-mail para requerente** (`sendConfirmationEmail`): "Solicitação recebida — analisaremos em até 15 dias úteis", com link para WhatsApp e e-mail de suporte.
5. Admin abre aba "Solicitações", revê, clica "Marcar como resolvido".
6. `handleResolveRequest` envia `sendResolvedEmail` ao requerente ("Sua solicitação foi atendida — a foto foi removida do arquivo público").

Limites:
- Upload máximo: 2 MB raw (~2.73 MB em base64). Acima disso → HTTP 413.
- Storage de solicitações: 500 itens. Quando passa, mantém todas as pendentes e descarta resolvidas mais antigas (FIFO).
- Sem `RESEND_API_KEY`: tudo continua funcionando, só não envia e-mails (status `"skipped: RESEND_API_KEY não configurada"`).

A política de privacidade no modal explicita que e-mail/telefone são usados **apenas** para processar a solicitação, sem compartilhar com terceiros. SLA prometido: 15 dias úteis.

---

## Termos de Uso e autorização de uso de imagem (LGPD)

A página de projeto é, ao mesmo tempo, a **entrega** das fotos e a superfície de **conformidade LGPD**:

- **`/termos`** (`src/ui/terms.js`) traz os Termos de Uso com a **autorização de uso de imagem** (entrega às pessoas do evento + divulgação do trabalho em portfólio/redes, creditando @lucafchala; sem venda a terceiros), fundamentada no art. 20 do Código Civil e no consentimento da LGPD. O responsável é identificado por nome + e-mail (sem CPF/RG públicos); foro de São Paulo/SP.
- **Gate antes do Drive, verificado no servidor**: ao clicar em "Acessar fotos", o visitante passa por uma verificação Turnstile (managed, sem atrito) e marca **uma caixa** aceitando os Termos / autorizando o uso da imagem. O link real do Drive só é liberado depois que `POST /api/drive-link` valida o token do Turnstile **no servidor** (fail-closed — token inválido/ausente = 403, sem link) + o aceite — não é mais um gate cosmético: os links não existem em lugar nenhum do HTML/JS público antes disso. Opcionalmente informa o nome. Se um bloqueador de anúncios impede o Turnstile (ou o JS está desativado), um aviso pede para desativá-lo; o acesso ainda é possível por um caminho intencionalmente mais fraco (sem captcha, rate-limit próprio mais restritivo, aceite gravado com `turnstile_ok=0`) — decisão consciente para não travar a entrega a esse público, documentada em `SECURITY.md`. Uma vez que um visitante legítimo recebe o link, ele continua compartilhável (isso é inerente ao compartilhamento do Drive, não uma falha).
- **Registro do aceite** (`POST /api/drive-link` → D1, no mesmo request que libera o link): o Worker grava uma linha em `image_use_consent` com data/hora, evento, versão dos Termos + **hash SHA-256 do texto exato**, resultado do Turnstile e contexto técnico (IP, geo/ISP via `request.cf`, navegador, idioma, referrer) — comprovação para eventual disputa. Non-blocking (`ctx.waitUntil`); sem D1 provisionado, é no-op (o gate continua funcionando normalmente).
- **Transparência e retenção**: a Política de Privacidade (`/privacidade`) lista os campos registrados; o cron diário apaga registros com mais de **5 anos**. O admin exporta tudo em CSV pela aba Config.

> Os textos legais (escopo da autorização, retenção) são um rascunho razoável — recomenda-se revisão jurídica antes de produção.

---

## Autenticação e segurança

### Hash de senha (`utils.js`)

```js
hashPassword(password, saltHex?, iterations = 100_000)
// → "pbkdf2:100000:<32 hex salt>:<64 hex hash>"
```

Web Crypto puro: `importKey('PBKDF2')` + `deriveBits({ name:'PBKDF2', hash:'SHA-256', salt, iterations })` → 256 bits hex.

`verifyPassword(password, stored)`:
- Se `stored` começa com `pbkdf2:`, re-hash com mesmo salt/iter e compara em tempo constante (`timingSafeEqual`).
- Caso contrário, assume SHA-256 legado e migra automaticamente no próximo login bem-sucedido (`handleLogin` salva novo hash PBKDF2).

### Sessão

- `generateToken()` → 32 bytes random hex (64 chars).
- Salva em `admin_session:<token>` = `"valid"` com TTL 86400 (24 h).
- Cookie: `session=<token>; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`.
- `verifySession(env, request)` extrai o token via regex `(?:^|;\s*)session=([a-f0-9]{64})` e checa no KV.
- Logout deleta a chave do KV e seta cookie com `Max-Age=0`.

### Comparação em tempo constante

`timingSafeEqual(a, b)` faz XOR byte a byte sem early-return. Usado para comparar hashes.

### Headers de segurança em toda resposta HTML

Já listados em [Rotas HTTP](#rotas-http) — `nosniff`, `frame DENY`, `Referrer-Policy strict-origin-when-cross-origin`, e `upgrade-insecure-requests`.

### Validação de entrada

- Slugs: `^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$`, ≤ 60 chars.
- E-mails: regex `^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`.
- Telefones: 10–13 dígitos depois de remover não-numéricos.
- Datas: `^\d{4}-\d{2}-\d{2}$` (ou descarta).
- Status: whitelist `['em-edicao','em-revisao','entregue','arquivado']`.
- Method de remoção: whitelist `['number','url','upload']`.
- Strings: todas truncadas com `.slice(0, N)` antes de salvar.
- URLs: `toHttps()` reescreve `http://` para `https://`.
- HTML: `escape()` em `utils.js` faz `& < > " '` → entidades, aplicado em **todo** valor de usuário antes de interpolar em template.

### `ctx.waitUntil`

Usado em `handleEventPage` para incrementar `views:<slug>` sem bloquear a resposta. Se a escrita falhar, o usuário não percebe.

---

## E-mails transacionais (Resend)

Quatro templates inline em `utils.js`, todos com `<div style="...">` (CSS inline porque clientes de e-mail são casos especiais):

| Função | Quando | Destinatário | Assunto |
| --- | --- | --- | --- |
| `sendRemovalEmail` | Nova solicitação de remoção | `env.ADMIN_EMAIL` | `🗑 Remoção solicitada — <título>` |
| `sendConfirmationEmail` | Mesma solicitação, confirmação automática | `req.email` (do requerente) | `Solicitação recebida — <título>` |
| `sendResolvedEmail` | Admin marca como resolvido | `req.email` (do requerente) | `Solicitação atendida — <título>` |
| `sendSupportEmail` | Formulário de `/suporte` enviado | `env.ADMIN_EMAIL` (com `reply_to` do remetente) | `📬 Suporte[ — <nome>]` |

Todos enviam via `POST https://api.resend.com/emails` com `Authorization: Bearer <RESEND_API_KEY>`. Erros são re-lançados como `throw new Error('Resend <status>: <body>')` para o handler capturar e registrar em `emailStatus`. Sem API key, retornam `false` silenciosamente.

`from`: `Fotos <noreply@lucafchala.com>` (domínio precisa estar verificado no Resend).

---

## Métricas

Dois contadores em KV, ambos por evento:

- `views:<slug>`: incrementado em cada `GET /<slug>` via `ctx.waitUntil`. Race conditions são possíveis em alta concorrência (read-modify-write não atômico), mas o erro de contagem é aceitável para o caso de uso.
- `drive_clicks:<slug>`: incrementado em `POST /api/track-drive`, chamado pelo botão "Ir para o Drive" antes de abrir a modal externa. Rate-limit: 60/h por IP (60 cliques por hora por IP é mais que suficiente).

Endpoint `/api/metrics` (auth) retorna array `[{slug, title, views, driveClicks}]` ordenado por views desc. Lê todos os contadores em paralelo via `Promise.all`.

Em paralelo, **Cloudflare Web Analytics** é opcional (controlado por `CF_ANALYTICS_TOKEN`). Quando definido, o beacon é injetado nas páginas públicas e o painel da Cloudflare mostra agregados (pageviews, dispositivos, países, referrers) sem cookies e sem tracking individual.

---

## Backup e restauração

### Download

`GET /api/backup` (auth) retorna:

```json
{
  "version": 2,
  "backupAt": "ISO date",
  "eventCount": N,
  "events": [ ... ],
  "categories": [ ... ],
  "removalRequests": [ ... ]
}
```

Headers:
```
Content-Type: application/json
Content-Disposition: attachment; filename="fotos-backup-YYYY-MM-DD.json"
```

### Restore

`POST /api/backup/restore` (auth) com o JSON do backup no body (aceita **v1** só-eventos e **v2** completo). Eventos via `mergeRestore`:

- Para cada evento do backup:
  - Se não existe no KV → adicionar (`added++`).
  - Se existe → comparar `updatedAt || createdAt`. O mais recente vence (`updated++`).
- Eventos atuais que **não** estão no backup são preservados (nunca deleta).

Seções v2 (opcionais, mescladas sem apagar nada): `categories` (união) e `removalRequests` (por id). Backups v2 antigos podem conter uma seção `reviews` — ela é ignorada (o recurso de avaliações foi removido).

Resposta: `{ok:true, added, updated, total, categories?, removalRequestsAdded?}`.

---

## PWA, ícones e analytics

### PWA

- `/manifest.json` (em `handleManifest`): name "fotos · Luca F. Chala", `start_url: /dashboard`, `display: standalone`, theme/background `#0a0a0a`, ícone `/icon.svg` `purpose: any maskable`.
- Login e dashboard incluem `<link rel="manifest" href="/manifest.json">`, então instalar a partir do `/dashboard` no celular dá um "app" do painel. Páginas públicas não referenciam o manifest (não precisam instalação).

### Ícone

`/icon.svg` é um SVG inline de 256×256: fundo `#0a0a0a` com borda arredondada (rx=48) e texto "f." centralizado em Inter 600 cor `#f0ebe5`. Cache 7 dias.

### Cloudflare Web Analytics

Quando `env.CF_ANALYTICS_TOKEN` está setado, gallery e event injetam:

```html
<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"<token>"}'></script>
```

O JSON do token é escapado com `.replace(/</g, '\\u003c')` para evitar quebrar a tag.

---

## Health check e CI

`GET /api/healthz`:

1. **Sem rate-limit** (de propósito): o `checkRateLimit` faria um *write* no KV por chamada, e o monitor de status bate aqui de forma agendada — o write por chamada não compensava o teto de 10/min (o trabalho do healthz é limitado e fica atrás da borda/DDoS da Cloudflare). Resultado: o healthz **só lê** o KV, nunca grava.
2. **Leitura 1/2 (KV):** `getEvents(env, true)` — uma única leitura de `events` confirma que o binding KV responde **e** que a chave principal ainda é um array válido. Reporta a contagem em `events` e o tempo em `kvLatencyMs`. (Substituiu a antiga sonda descartável `__healthz__`: a mesma leitura agora faz trabalho útil.)
3. Se o binding `CONSENT_DB` existir, um `SELECT 1` checa o D1 (log de consentimento) e cronometra em `d1LatencyMs` — não é KV. É **best-effort**: `d1` vira `"down"` mas isso *não* derruba o `ok` (um D1 ausente/sem escopo nunca pode reprovar o deploy — ver `deploy.yml`).
4. `await hashPassword('healthcheck')` cronometrado — confirma que o PBKDF2 cabe no budget de CPU do Worker (não é KV).
5. **Leitura 2/2 (KV):** `cron` `{ lastRunAt, ageHours, stale }` — heartbeat gravado pelo `scheduled` em `cron:last`, que detecta um cron *silenciosamente morto*.
6. **Autoteste funcional (`selftest`) — ZERO leituras extras de KV** (roda sobre o array de `events` já carregado no passo 2, via `auditSite`): sinaliza coisas que "deram errado" e que um 500 não pegaria — `{ ok, problems[], drive: { ok, bad, live }, forms: { turnstile, resend, adminEmail }, sample }`. Detecta **links do Google Drive ausentes/inválidos** em eventos publicados (acesso ao Drive quebrado), **dados inconsistentes** (slug duplicado → rotas colidem, status fora do enum, evento sem título), e **dependências de formulário ausentes** (Turnstile/Resend/`ADMIN_EMAIL` — sem elas os formulários de suporte/remoção/Drive recusam ou não entregam envios). `sample` aponta um evento publicado saudável para o dashboard fazer deep-probe (gate do Drive + form de remoção). `auditSite` é puro e tem teste unitário.
7. **Resto do diagnóstico — ZERO leituras extras de KV:** `config` `{ resend, turnstile, consentDb, adminEmail }` (booleanos a partir dos bindings — segredos de produção presentes, sem vazar valores), `termsVersion`, `colo`/`country` (de `request.cf`) e `now`.
8. Retorna `{ ok, kv, events, d1, hashMs, … }`. `ok` é `true` (HTTP 200) só quando o KV respondeu e `events` é um array; caso contrário `ok:false` com HTTP 503. (O `selftest.ok` é independente do `ok` de topo — um link de Drive quebrado não derruba o healthz nem reprova o deploy; só acende o alerta no dashboard.)

**Frugal em KV:** o endpoint continua fazendo **2 leituras de KV** por chamada (`events` + `cron:last`), exatamente como antes desta expansão — a sonda `__healthz__` redundante foi trocada pelo heartbeat do cron. Contagens de backlog/categorias foram deliberadamente deixadas de fora daqui (custariam uma leitura cada e não sinalizam *falha*); um admin não configurado já é pego pela sonda `/dashboard` (503) do dashboard de status.

`ok` e `hashMs` continuam presentes e com o mesmo significado — o smoke test do CI segue funcionando. Todos os campos extras são consumidos pelo dashboard de status (`status.lucafchala.com`), que faz fetch server-side deste endpoint e disseca **cada** campo para sinalizar qualquer anomalia (cron parado, KV lento, segredo de hardening ausente) sem depender de CORS. O heartbeat do cron é puro o suficiente para ter teste unitário (`cronStale`, em `tests/index.test.js`) — e `handleHealthz()` em si (KV/D1 caindo, `cron.stale`, `config`, `selftest`) e o `scheduled()` que grava esse heartbeat têm cobertura própria em `tests/healthz.test.js`, incluindo o isolamento entre as duas tarefas de limpeza do cron (uma falhar não impede a outra nem o heartbeat).

O cron diário (`scheduled()`) agora também dispara `sendErrorAlert()` quando `pruneResolvedRemovalRequests` ou `pruneOldConsent` falha — antes só ia pro `console.error`, o que deixava uma falha de retenção visível só nos logs da Cloudflare. Isso ainda não cobre uma queda **total** do Worker (nada capturável é lançado); pra esse caso, ver o monitor externo (UptimeRobot) documentado em [SECURITY.md](./SECURITY.md#the-gap-this-alerting-cant-close-and-how-its-covered).

CI (smoke tests) considera `hashMs > 200` como **falha**: acima disso, o hashing em `handleLogin` corre o risco de estourar o limite de CPU do Worker (~50–200 ms dependendo da conta) e retornar 5xx ao usuário tentando logar. O smoke test pós-deploy (`deploy.yml`) também cobre as páginas públicas mais novas (`/sobre`, `/equipamentos`, `/termos`, `/privacidade`, `/suporte`) e os endpoints de SEO/segurança (`/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/.well-known/security.txt`, `/.well-known/gpc.json`) com `check_status`, e loga (sem falhar o build) se `selftest.problems` do healthz vier não-vazio — isso é sinal de dado de evento mal configurado, não de regressão de código.

---

## Rate limiting

`checkRateLimit(env, ip, key, limit, windowSecs)`:

- Calcula `window = floor(Date.now() / (windowSecs * 1000))` — bucket de tempo fixo.
- Chave KV: `ratelimit:<key>:<ip>:<window>`.
- Lê contador. Se `>= limit`, retorna `false`. Senão, incrementa com `expirationTtl = windowSecs`.

| Endpoint | key | limit | janela |
| --- | --- | --- | --- |
| `/api/removal-request` | `removal` | 5 | 1 h |
| `/api/track-drive` | `drive` | 60 | 1 h |
| `/api/suporte` | `support` | 5 | 1 h |
| `/api/drive-link` (caminho verificado, com Turnstile) | `drive-link` | 60 | 1 h |
| `/api/drive-link` (caminho `noscript`, sem Turnstile — ad-blocker) | `drive-link-noscript` | 10 | 1 h |
| `/dashboard/login` | `login` | 10 | 10 min |

Limitações: usa janela fixa (não sliding) e não é atômico (race em alta concorrência). Aceitável porque os endpoints públicos são de baixíssima taxa.

IP vem de `request.headers.get('CF-Connecting-IP')` (header injetado pelo edge da Cloudflare).

---

## Convenções e detalhes do código

- **PT-BR** em todo conteúdo, mensagens de erro e comentários.
- **Sem dependências runtime**. As dev deps são só `wrangler`, `vitest` e `eslint` (+ `@eslint/js`).
- **Sem TypeScript**, sem build, sem JSX. Template strings + `escape()`.
- **`escape()`** (em `utils.js`) é o único mecanismo de escape de **HTML**. Use sempre que interpolar valor de usuário. JSON inline em `<script>` usa `.replace(/</g, '\\u003c').replace(/>/g, '\\u003e')` em vez de `escape()`.
- **`safeUrl()`** é coisa diferente e **não substitui** o `escape()`: é allowlist de *esquema* (deixa passar só `https:`, promove `http:`, mata `javascript:`/`data:`), e não escapa aspas — `https://x/" onload="…` passa inteiro por ela. Num atributo HTML use as duas, `escape(safeUrl(v))`; numa atribuição de propriedade no cliente (`el.href = v`) o `safeUrl()` basta, porque não há HTML sendo parseado. Nenhuma das duas sozinha cobre os dois ataques — ver `SECURITY.md`, seção *Invariants for contributors*.
- **`toCount()`** (em `index.js`) é obrigatório ao ler contador do KV. Contadores são strings; um valor corrompido lido com `parseInt` cru vira `NaN`, e `String(NaN)` gravado de volta envenena o contador para sempre.
- **`generateId()`** → 16 bytes random hex (32 chars). Usado para event id e removal request id.
- **`formatDatePT(dateStr)`** → "12 de maio de 2025" (mês em português, dia/ano numéricos). Aceita `YYYY-MM-DD`; retorna string original se inválida.
- **`toHttps(url)`** → reescreve `http://` para `https://`, no-op caso contrário. Aplicado em todo URL de foto/Drive ao salvar.
- **CSS variables**: o dashboard usa seu próprio esquema (`--bg`/`--bg2`/`--bg3`/`--text`/`--text2`/`--text3`/`--accent`/`--red`/`--green`, declarado uma vez no `BASE`, herdado em todos os panels, sempre escuro). As páginas públicas têm seu próprio esquema, independente e não intercompatível com o do dashboard (`--bg-page`/`--text`/`--accent`/etc., variando um pouco por arquivo conforme o que cada um precisa), com um bloco `@media(prefers-color-scheme:light)` sobrescrevendo os valores no tema claro — ver "Páginas públicas" acima.
- **Acessibilidade**: `aria-label` nos botões de ícone do carrossel/modal, `autocomplete` apropriado nos forms, foco gerenciado nos modais.
- **Mobile-first**: media queries só para "subir" colunas/larguras. Sheets mobile saem do bottom; em ≥ 580px viram modal centralizado.

---

## Como o Drive vira foto na página

Em `src/ui/dashboard.js`, `convertDriveUrl(url)` aceita três formatos de link do Google Drive:

| Entrada | Saída |
| --- | --- |
| `https://drive.google.com/file/d/<ID>/...` | `https://lh3.googleusercontent.com/d/<ID>` |
| `https://drive.google.com/open?id=<ID>` | `https://lh3.googleusercontent.com/d/<ID>` |
| `https://drive.google.com/uc?...id=<ID>` | `https://lh3.googleusercontent.com/d/<ID>` |
| Qualquer outra URL | sem mudança |

Aplicado on-blur no campo de cada foto no form. A miniatura logo aparece (img com `onload`/`onerror`). O `lh3.googleusercontent.com/d/<ID>` é o endpoint público que serve a foto otimizada (não requer login).

Isso significa que o admin só precisa colar o link compartilhado do arquivo no Drive — a conversão é automática.

---

## Limitações conhecidas

- **Contadores não atômicos**: `views`, `drive_clicks` e `ratelimit` são read-modify-write. Em alta concorrência, alguns incrementos podem ser perdidos. Aceitável aqui.
- **Sem CDN próprio para fotos**: thumbnails vêm direto do Google. Se o Drive ficar offline ou rate-limitado, a galeria mostra placeholders. Migrar para R2 está no roadmap.
- **Sem preview no WhatsApp**: Open Graph image aponta para `lh3.googleusercontent.com`, que o WhatsApp às vezes não consegue scrapear. R2 resolveria.
- **Sessões expiram em 24 h**: sem refresh automático. Após 24 h, qualquer ação no painel cai em 401 e o frontend redireciona pra login.
- **Sem multi-tenant**: o app inteiro assume um único admin (chave `admin_password`).
- **CPU budget do Worker**: o hashing PBKDF2 (100k iterações, ~50 ms) é vigiado pelo `/api/healthz` (o CI falha se `hashMs > 200`). Ao mexer no `iterations`, acompanhe esse número.
- **Upload de remoção limitado a 2 MB**: maior que isso e o request vira 413. Solicitantes com fotos grandes podem usar a opção "link direto" em vez de upload.
- **Storage de solicitações capado em 500**: solicitações resolvidas mais antigas são apagadas quando passa. Backup manual recomendado antes de atingir esse volume.
- **Log de consentimento é best-effort**: o D1 (`CONSENT_DB`) está provisionado e o `/api/healthz` reporta `d1: "ok"`, mas a gravação roda em `ctx.waitUntil` — se o insert falhar, o visitante recebe o link do mesmo jeito e a falha só aparece no log. Se o binding for removido, o aceite continua barrando o acesso normalmente, porém sem registro (no-op silencioso).
- **Sem nonce de curta duração no `/api/drive-link`**: o gate já é verificado no servidor (Turnstile fail-closed + rate limit por IP), mas ainda não há um nonce por carregamento de página amarrando a chamada a uma visita real do evento — um script com um token Turnstile válido em mãos ainda poderia varrer vários slugs. Rate limit por IP mitiga isso parcialmente; nonce fica no roadmap (`TODO.md`, Etapa 3.1).
- **Formulários e gate exigem JavaScript + Turnstile**: ad-blockers que barram o script do Turnstile (ou JS desativado) impedem o envio dos formulários de remoção/suporte e a verificação do gate. O site **detecta e avisa** (desative o bloqueador / ative o JS), mantém o acesso às fotos liberado e oferece WhatsApp/e-mail como alternativa; banners `<noscript>` cobrem o caso sem JS.

---

## Roadmap (TODO.md)

O arquivo [`TODO.md`](./TODO.md) lista **só o que está em aberto** — item entregue sai de lá, e o histórico de quem fez o quê fica no `git log`. Resumo do que falta:

**Segurança / anti-abuso**: nonce de curta duração no `/api/drive-link` (anti-varredura de slugs — requer decisão sobre cota de KV vs. secret novo), auditar vazamento de `internalNotes` no HTML público, magic link no painel, honeypot nos formulários, endurecer a CSP, afinar WAF/Bot Fight Mode, strip de EXIF. Política e invariantes em [`SECURITY.md`](./SECURITY.md).

**Operação**: marcar releases com tag (hoje o repo não tem nenhuma — ver [Rollback](#rollback)); destino persistente para o beacon de `/api/perf` (binding `PERF` do Analytics Engine).

**Recursos**: senha por evento, migração das imagens para R2 (resolve preview no WhatsApp e cache das capas de uma vez), portfólio `/portfolio`, lembrete de data de entrega, modelo/"template" de evento (ao lado do "Duplicar" já existente), guardar a proporção da foto na hora de curar o evento para eliminar o reflow residual do grid masonry.

**Ideias não priorizadas**: favoritar fotos via localStorage, livro de visitas, slideshow, stories, `/contato`, depoimentos, status "agendando eventos", i18n EN/PT, links nominados por convidado, download em ZIP, app nativo, mini-gráfico de visualizações no dashboard.

---

## Contato

Site: <https://fotos.lucafchala.com> · Instagram: [@lucafchala](https://instagram.com/lucafchala) · Suporte: <suporte@lucafchala.com> · WhatsApp: <https://wa.me/5511989211178>
