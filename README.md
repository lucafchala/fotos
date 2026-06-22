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

1. **Visitante público** — abre `/` para ver a galeria de projetos, clica num card para abrir a página do projeto (`/<slug>`), vê descrição, fotos de capa em carrossel e um botão "Acessar fotos" que abre uma modal explicando como baixar as fotos do Google Drive. O botão registra um clique (métrica) e abre o Drive em nova aba. Se a foto pertence a alguém que prefere remover, há um formulário de solicitação de remoção no rodapé.
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
| Dev tooling | Wrangler ≥ 3 (`npm run dev` / `npm run deploy`), ESLint (`npm run lint`) |
| CI/CD | GitHub Actions (`deploy.yml` com smoke tests, `checks.yml` com lint + sintaxe) |
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

```bash
# 1. Instalar Wrangler (dev dep)
npm install

# 2. Login no Cloudflare (uma vez por máquina)
npx wrangler login

# 3. Subir o dev server
npm run dev
```

O Wrangler escuta em `http://localhost:8787`. Por padrão ele se conecta ao KV **remoto** (id em `wrangler.toml`); para usar KV local, rode `npx wrangler dev --local`.

**Importante:** mesmo em dev, o dashboard exige uma senha. No primeiro acesso a `/dashboard`, se a chave KV `admin_password` não existir, a tela de login vira tela de setup ("Criar senha de acesso"). Defina uma e o app salva o hash PBKDF2.

Para resetar a senha em dev: `npx wrangler kv:key delete admin_password --binding=FOTOS`.

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
```

O binding `FOTOS` é referenciado em todo o código como `env.FOTOS`. Para fork pessoal: crie um KV namespace novo (`npx wrangler kv:namespace create FOTOS`) e troque o `id`.

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

Use o widget no modo **managed** (painel da Cloudflare) para verificação sem atrito (sem desafio visível na maioria dos acessos). O `TURNSTILE_SECRET_KEY` é verificado server-side em `/api/consent`, no formulário de remoção e no suporte.

---

## Deploy

Há dois caminhos:

### 1. Automático (GitHub Actions, padrão)

Qualquer push em `main` dispara `.github/workflows/deploy.yml`:

1. Checkout do repositório.
2. Deploy com `cloudflare/wrangler-action@v3` usando `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` (secrets do GitHub).
3. `sleep 20` aguardando propagação global.
4. Smoke tests via `curl` contra <https://fotos.lucafchala.com>:
   - `GET /` retorna 200
   - `GET /dashboard` retorna 200
   - `GET /manifest.json` retorna 200
   - `GET /icon.svg` retorna 200
   - `GET /__no_such_route__` retorna 404
   - `GET /api/healthz` retorna `{"ok":true,…,"hashMs":<n>}` e `hashMs ≤ 200` (acima disso, login estouraria o orçamento de CPU do Worker)
   - `POST /dashboard/login` com senha errada retorna 302 (e não 5xx — 5xx indicaria CPU timeout)

Qualquer falha no smoke test marca o deploy como vermelho mas o Worker já foi publicado — então um deploy "vermelho" ainda alterou produção. Roll back via revert + novo push.

### 2. Manual

```bash
npx wrangler deploy
```

---

## Estrutura de arquivos

```
fotos/
├── README.md              ← este arquivo
├── TODO.md                ← roadmap pessoal (pendências, ideias, etapas)
├── package.json           ← scripts dev/deploy/lint, wrangler + eslint como dev deps
├── wrangler.toml          ← config do Worker, binding KV (+ D1 comentado p/ provisionar)
├── migrations/
│   └── 0001_consent.sql   ← tabela D1 image_use_consent (log de consentimento)
├── .github/
│   └── workflows/
│       ├── deploy.yml     ← CI: deploy + smoke tests
│       └── checks.yml     ← CI: lint + validação JSON + sintaxe JS
└── src/
    ├── index.js           ← roteador + todos os handlers HTTP (Worker entry)
    ├── utils.js           ← getEvents/saveEvents, hash, sessão, rate-limit, e-mails, TERMS_VERSION
    └── ui/
        ├── gallery.js     ← HTML da galeria pública /
        ├── event.js       ← HTML da página de projeto /<slug>
        ├── dashboard.js   ← HTML do login e do painel admin /dashboard
        ├── support.js     ← HTML da página de suporte /suporte
        ├── privacy.js     ← HTML da Política de Privacidade /privacidade
        └── terms.js       ← HTML dos Termos de Uso /termos
```

Tamanhos aproximados: `index.js` ~28 KB, `dashboard.js` ~62 KB (é o maior porque tem todo o JS do painel inline), `event.js` ~35 KB, `gallery.js` ~7 KB, `support.js` ~7 KB, `utils.js` ~13 KB. Tudo cabe folgadamente no limite de 10 MB do Workers script.

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
  shortDescription: "string ≤ 300",
  longDescription: "string ≤ 5000",
  photos: ["url1", "url2", ...],  // até 6, https-only depois do toHttps()
  thumbnailUrl: "url1",           // sempre = photos[0] || legado
  driveUrl: "https://drive.google.com/drive/folders/...",
  date: "YYYY-MM-DD",             // ou "" — validado contra regex
  eventCredits: "string ≤ 200",
  projectUrl: "string ≤ 500",
  visible: true,                  // se false, some da galeria pública
  comingSoon: false,              // se true, esconde fotos e troca botão por "As fotos virão em breve"
  status: "em-edicao" | "em-revisao" | "entregue" | "arquivado",
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
id, created_at, event_slug, event_title, drive_target, terms_version,
terms_hash (SHA-256 do texto exato dos Termos), consent_text, consenter_name,
turnstile_ok, ip, country, region, city, timezone, asn, as_org, colo,
user_agent, accept_language, referrer, page_url
```

Coletado server-side em `handleConsent` a partir de `request.headers` + `request.cf`. Exportável em CSV por `GET /api/consent/export` (auth). Retenção de ~5 anos via cron diário (`pruneOldConsent`).

---

## Rotas HTTP

Roteador único em `src/index.js`, baseado em cadeia de `if`s. Ordem importa — a regex `/^\/([a-z0-9][a-z0-9-]*)$/` que casa páginas de evento é **a última**, para não capturar `/dashboard`, `/suporte`, etc.

### Públicas

| Método | Path | Função | O que faz |
| --- | --- | --- | --- |
| GET | `/` | `handleGallery` | HTML da galeria com cards de todos os eventos `visible !== false`, ordenados por pinned + data desc |
| GET | `/<slug>` | `handleEventPage` | HTML do projeto (página de entrega). Incrementa `views:<slug>` em `ctx.waitUntil`. O acesso ao Drive exige aceite dos Termos (registrado via `/api/consent`) |
| GET | `/suporte` | `supportHTML()` | Página de contato com WhatsApp + e-mail + formulário |
| GET | `/privacidade` | `privacyHTML()` | Política de Privacidade (LGPD) |
| GET | `/termos` | `termsHTML()` | Termos de Uso + autorização de uso de imagem |
| GET | `/manifest.json` | `handleManifest` | Manifest PWA |
| GET | `/icon.svg` | `handleIcon` | Ícone SVG inline (rect 256x256 com "f." centralizado) |
| POST | `/api/removal-request` | `handleRemovalRequest` | Recebe solicitação de remoção (rate-limit: 5/h por IP), envia e-mails, persiste |
| POST | `/api/track-drive` | `handleTrackDrive` | Incrementa `drive_clicks:<slug>` (rate-limit: 60/h por IP) |
| POST | `/api/consent` | `handleConsent` | Registra o aceite dos Termos / uso de imagem em D1 (best-effort, rate-limit 60/h, no-op sem D1) |
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

### `/` — Galeria (`src/ui/gallery.js`)

- Header com o logo `fotos · Luca F. Chala`.
- Grid responsivo: 2 colunas (< 560px), 3 (560–900px), 4 (≥ 900px).
- Cada card mostra: thumbnail (com shimmer loader animado enquanto carrega), data formatada em PT-BR ("12 de maio de 2025"), título e descrição curta truncada em 2 linhas.
- Eventos com `pinned: true` ocupam toda a largura (grid-column 1/-1, hero 16:9) e ganham badge "Em destaque".
- Eventos com `comingSoon: true` mostram badge "em breve" no canto, ícone de relógio no lugar do thumb.
- Eventos com `visible: false` são filtrados fora.
- Ordenação: pinned primeiro, depois por `date` desc (fallback `createdAt`).
- Footer com link para Instagram (@lucafchala) e botão "Suporte".

### `/<slug>` — Página de projeto (`src/ui/event.js`)

Arquivo grande (~35 KB) porque inclui HTML + CSS + JS inline. Componentes:

- **Banner de novas fotos** (se `photosAlert.active` e dentro da janela de expiração): "Novas fotos adicionadas — há X minutos/horas/dias", atualizado em JS a cada 60s.
- **Hero**: se `comingSoon`, mostra placeholder com ícone de relógio + "Em breve". Se 0 fotos, ícone de câmera. Se 1 foto, hero único. Se ≥ 2, **carrossel** com botões anterior/próxima, dots, contador (1/N), e swipe touch (`touchstart`/`touchend` com threshold 40px).
- **Conteúdo**: data, título grande, descrição longa (`white-space: pre-wrap`), botão "Acessar fotos".
- **Modal "Antes de acessar as fotos"**: aparece ao clicar no botão. Tem créditos destacados, passo-a-passo de download (mobile e desktop), aviso "Não tire print" e botão final "Ir para o Google Drive" que chama `trackDrive()` antes de abrir. Se um bloqueador de anúncios impede o carregamento do Turnstile, exibe um aviso pedindo para desativá-lo / ativar o JavaScript — **sem bloquear** o acesso às fotos (ver seção LGPD).
- **Créditos**: nome do fotógrafo + (opcional) créditos do evento + link extra. Nota verde "marque sempre @lucafchala".
- **Footer**: compartilhar no WhatsApp (link `wa.me/?text=...`), botão "Solicitar remoção de foto", link "Suporte".
- **Modal de remoção**: formulário com:
  - Radio: identificar foto por número, link direto ou upload (até 2 MB).
  - E-mail (obrigatório, regex), telefone (obrigatório, 10–13 dígitos).
  - Mensagem opcional.
  - Aviso LGPD curto: "Seus dados (e-mail e telefone) são usados exclusivamente para processar esta solicitação."
  - **Turnstile** obrigatório; como o token é de uso único, o widget é **resetado automaticamente** após uma falha de envio (evita o loop de 403 ao tentar de novo com token gasto). A leitura do arquivo de upload é protegida (erro amigável em vez de falha silenciosa).
  - Submete via fetch para `/api/removal-request`. Sucesso troca o conteúdo da modal por uma tela verde com check.
  - **Bloqueador de anúncios / JS desativado**: se o script do Turnstile não carrega, a modal mostra um aviso (desative o bloqueador, ative o JavaScript, botão de recarregar) e mantém o envio desabilitado — a solicitação exige a verificação server-side.
- **Tour guiado** (apenas no primeiro acesso, lembrado via `localStorage['fotos:tour_seen']`): modal de boas-vindas que mostra 3 dicas (Acessar fotos / WhatsApp / Solicitar remoção). Botão "Entendi" fecha e seta a flag.

### `/suporte` — Página de suporte (`src/ui/support.js`)

- Header com link "Voltar".
- Botões grandes: WhatsApp (`wa.me/5511989211178`) e e-mail (`mailto:suport@lucafchala.com`).
- Divisor "ou envie uma mensagem".
- Formulário POST para `/api/suporte` (form-data, sem fetch — degrada para HTML puro). Campos: nome (opcional), e-mail (opcional, vira `reply_to` se preenchido), mensagem (obrigatório, ≤ 2000 chars). **Turnstile** obrigatório; o botão fica desabilitado até a verificação passar, com **fallback** que o reabilita se o script for bloqueado, mais guarda anti-duplo-envio.
- Após envio, a página é recarregada e mostra caixa verde "Mensagem enviada!". Em caso de erro, **nome/e-mail/mensagem são preservados** (re-renderizados escapados) para não perder o texto digitado.
- Erros (campos vazios, rate limit, Turnstile) mostram caixa vermelha. Se um ad-blocker bloqueia o Turnstile, aparece um aviso para desativá-lo / ativar o JS (ou usar WhatsApp/e-mail); um banner `<noscript>` cobre o caso de JavaScript totalmente desativado.

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
- **Busca** (título / URL / categoria) + filtro `<select>` (`Todos / Ativos (sem arquivados) / Em edição / Em revisão / Entregue / Arquivado`).
- No formulário: `Esc` fecha, `Ctrl/⌘+Enter` salva, foco preso (focus trap) no overlay e rodapé de ações fixo (sticky). Excluir evento/categoria usa um diálogo de confirmação no tema do painel (não o `confirm()` nativo); os botões de ação ficam desabilitados enquanto a requisição corre.
- Lista de eventos (cards horizontais) com: thumb, título + badge de status colorida, slug em monospace, botões de ação à direita:
  - **Pin** (estrela) — toggle. Ao pinar, despina todos os outros (server-side garante max 1).
  - **Eye** — toggle `visible`.
  - **Edit** — abre overlay com formulário pré-preenchido.
  - **Delete** (lixeira vermelha) — confirma + DELETE.
- **Overlay/formulário de evento** com todos os campos: slug, título, descrição curta, descrição longa, fotos (até 6 com pré-visualização miniatura inline — campo "blur" converte links de Drive para `lh3.googleusercontent.com`), link do Drive, data, créditos, link extra, status, **categoria** (lista gerenciável — ver aba Config; alimenta os filtros da galeria), notas privadas, toggles "Visível" e "Em breve", e bloco "Aviso de novas fotos" (toggle + select de expiração: nunca / 1h / 6h / 24h / 48h / 168h).
- **Edição em massa:** botão "Selecionar" mostra checkboxes nos eventos; escolha uma categoria e clique "Aplicar" para atribuí-la a todos os selecionados de uma vez (`POST /api/events/bulk-category`).
- A lista usa renderização híbrida: a primeira página vem **SSR** (renderizada no Worker) e o JS substitui via `renderEventList()` ao mudar filtro. Os botões funcionam via event delegation (`data-action`/`data-id`), então tanto o SSR quanto o re-render funcionam com o mesmo handler.

#### Aba Métricas

Tabela com colunas: projeto, views, cliques no Drive. **Colunas ordenáveis** (clique no cabeçalho), com uma barra proporcional atrás do número de views e botão **Exportar CSV**. Dados carregados sob demanda (na primeira vez que o usuário clica na aba).

#### Aba Config

- **Categorias**: lista gerenciável de categorias (alimenta os filtros da galeria e o select do formulário). Criar via `POST /api/categories` (`{name}`), excluir via `POST /api/categories/delete` (`{name}`) — ao excluir, a categoria é removida de todos os eventos que a usavam. Guardadas na chave KV `categories`; até a primeira alteração valem os padrões (Formatura / Casamento / Ensaio / Evento / Outro).
- **Alterar senha**: campos "Nova senha" + "Confirmar senha", botão "Salvar". PUT para `/api/settings/password`.
- **Backup**:
  - Botão "Baixar backup JSON" — GET `/api/backup` retorna `fotos-backup-YYYY-MM-DD.json` (v2: eventos + categorias + solicitações).
  - Input file + botão "Restaurar backup" — POST `/api/backup/restore`. Merge inteligente: mesmo `id` é atualizado só se o `updatedAt`/`createdAt` do backup for mais recente. Nada é deletado.
- **Exportar dados** (CSV): consentimentos (do D1, via `/api/consent/export`), solicitações de remoção e métricas.

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
- **Gate antes do Drive**: ao clicar em "Acessar fotos", o visitante passa por uma verificação Turnstile (managed, sem atrito) e marca **uma caixa** aceitando os Termos / autorizando o uso da imagem; só então os links do Drive são liberados. Opcionalmente informa o nome. Se um bloqueador de anúncios impede o Turnstile (ou o JS está desativado), um aviso pede para desativá-lo — mas o acesso às fotos **não é bloqueado** (o aceite é gravado com `turnstile_ok=0`), priorizando a entrega. ⚠️ O gate é **client-side**: os links do Drive ainda estão no código-fonte da página (ver _Limitações conhecidas_ e `SECURITY.md`).
- **Registro do aceite** (`POST /api/consent` → D1): no clique de download, um `navigator.sendBeacon` envia o aceite e o Worker grava uma linha em `image_use_consent` com data/hora, evento, versão dos Termos + **hash SHA-256 do texto exato**, resultado do Turnstile e contexto técnico (IP, geo/ISP via `request.cf`, navegador, idioma, referrer) — comprovação para eventual disputa. É **best-effort, não bloqueia** a entrega; sem D1 provisionado, é no-op.
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

1. Rate limit: 10/min por IP.
2. **Leitura 1/2 (KV):** `getEvents(env, true)` — uma única leitura de `events` confirma que o binding KV responde **e** que a chave principal ainda é um array válido. Reporta a contagem em `events` e o tempo em `kvLatencyMs`. (Substituiu a antiga sonda descartável `__healthz__`: a mesma leitura agora faz trabalho útil.)
3. Se o binding `CONSENT_DB` existir, um `SELECT 1` checa o D1 (log de consentimento) e cronometra em `d1LatencyMs` — não é KV. É **best-effort**: `d1` vira `"down"` mas isso *não* derruba o `ok` (um D1 ausente/sem escopo nunca pode reprovar o deploy — ver `deploy.yml`).
4. `await hashPassword('healthcheck')` cronometrado — confirma que o PBKDF2 cabe no budget de CPU do Worker (não é KV).
5. **Leitura 2/2 (KV):** `cron` `{ lastRunAt, ageHours, stale }` — heartbeat gravado pelo `scheduled` em `cron:last`, que detecta um cron *silenciosamente morto*.
6. **Autoteste funcional (`selftest`) — ZERO leituras extras de KV** (roda sobre o array de `events` já carregado no passo 2, via `auditSite`): sinaliza coisas que "deram errado" e que um 500 não pegaria — `{ ok, problems[], drive: { ok, bad, live }, forms: { turnstile, resend, adminEmail }, sample }`. Detecta **links do Google Drive ausentes/inválidos** em eventos publicados (acesso ao Drive quebrado), **dados inconsistentes** (slug duplicado → rotas colidem, status fora do enum, evento sem título), e **dependências de formulário ausentes** (Turnstile/Resend/`ADMIN_EMAIL` — sem elas os formulários de suporte/remoção/Drive recusam ou não entregam envios). `sample` aponta um evento publicado saudável para o dashboard fazer deep-probe (gate do Drive + form de remoção). `auditSite` é puro e tem teste unitário.
7. **Resto do diagnóstico — ZERO leituras extras de KV:** `config` `{ resend, turnstile, consentDb, adminEmail }` (booleanos a partir dos bindings — segredos de produção presentes, sem vazar valores), `termsVersion`, `colo`/`country` (de `request.cf`) e `now`.
8. Retorna `{ ok, kv, events, d1, hashMs, … }`. `ok` é `true` (HTTP 200) só quando o KV respondeu e `events` é um array; caso contrário `ok:false` com HTTP 503. (O `selftest.ok` é independente do `ok` de topo — um link de Drive quebrado não derruba o healthz nem reprova o deploy; só acende o alerta no dashboard.)

**Frugal em KV:** o endpoint continua fazendo **2 leituras de KV** por chamada (`events` + `cron:last`), exatamente como antes desta expansão — a sonda `__healthz__` redundante foi trocada pelo heartbeat do cron. Contagens de backlog/categorias foram deliberadamente deixadas de fora daqui (custariam uma leitura cada e não sinalizam *falha*); um admin não configurado já é pego pela sonda `/dashboard` (503) do dashboard de status.

`ok` e `hashMs` continuam presentes e com o mesmo significado — o smoke test do CI segue funcionando. Todos os campos extras são consumidos pelo dashboard de status (`status.lucafchala.com`), que faz fetch server-side deste endpoint e disseca **cada** campo para sinalizar qualquer anomalia (cron parado, KV lento, segredo de hardening ausente) sem depender de CORS. O heartbeat do cron é puro o suficiente para ter teste unitário (`cronStale`, em `tests/index.test.js`).

CI (smoke tests) considera `hashMs > 200` como **falha**: acima disso, o hashing em `handleLogin` corre o risco de estourar o limite de CPU do Worker (~50–200 ms dependendo da conta) e retornar 5xx ao usuário tentando logar.

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
| `/api/healthz` | `healthz` | 10 | 1 min |

Limitações: usa janela fixa (não sliding) e não é atômico (race em alta concorrência). Aceitável porque os endpoints públicos são de baixíssima taxa.

IP vem de `request.headers.get('CF-Connecting-IP')` (header injetado pelo edge da Cloudflare).

---

## Convenções e detalhes do código

- **PT-BR** em todo conteúdo, mensagens de erro e comentários.
- **Sem dependências runtime**. Só `wrangler` como dev dep.
- **Sem TypeScript**, sem build, sem JSX. Template strings + `escape()`.
- **`escape()`** (em `utils.js`) é o **único** mecanismo de escape de HTML. Use sempre que interpolar valor de usuário. JSON inline em `<script>` usa `.replace(/</g, '\\u003c').replace(/>/g, '\\u003e')` em vez de `escape()`.
- **`generateId()`** → 16 bytes random hex (32 chars). Usado para event id e removal request id.
- **`formatDatePT(dateStr)`** → "12 de maio de 2025" (mês em português, dia/ano numéricos). Aceita `YYYY-MM-DD`; retorna string original se inválida.
- **`toHttps(url)`** → reescreve `http://` para `https://`, no-op caso contrário. Aplicado em todo URL de foto/Drive ao salvar.
- **CSS variables** (`--bg`, `--text`, etc.) só no `BASE` do dashboard, herdadas em todos os panels. As páginas públicas usam cores literais.
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
- **D1 precisa ser provisionado**: enquanto `CONSENT_DB` não existir, o aceite dos Termos continua barrando o acesso ao Drive normalmente, mas **não é gravado** (no-op). Provisione o D1 (ver Configuração) para ter a comprovação.
- **Gate do Drive é client-side**: `DRIVE_URL`/`DRIVE_URL_IG` são embutidos no HTML/JS, então os links são visíveis pelo "ver código-fonte" / console **sem passar pela verificação**. Mitigação no roadmap: servir o link por endpoint só após validar o Turnstile no servidor (ver `SECURITY.md` e `TODO.md`).
- **Formulários e gate exigem JavaScript + Turnstile**: ad-blockers que barram o script do Turnstile (ou JS desativado) impedem o envio dos formulários de remoção/suporte e a verificação do gate. O site **detecta e avisa** (desative o bloqueador / ative o JS), mantém o acesso às fotos liberado e oferece WhatsApp/e-mail como alternativa; banners `<noscript>` cobrem o caso sem JS.

---

## Roadmap (TODO.md)

O arquivo [`TODO.md`](./TODO.md) tem o histórico completo de features entregues e o backlog de ideias (operacional, engajamento, profissional, UX, futuro distante). Resumo do que falta:

**Segurança / anti-abuso**: esconder os links do Drive do código-fonte (hoje achatáveis pelo console — o gate é só client-side), aplicar o aceite no servidor, recuperação de senha por e-mail (magic link), 2FA no painel, afinar WAF/Bot Fight Mode, endurecer a CSP. _(Rate limiting e backup/restore já implementados.)_ Política de segurança em [`SECURITY.md`](./SECURITY.md).

**Recursos**: senha por evento.

**Longo prazo**: migrar imagens para R2 (resolve preview WhatsApp), portfólio público `/portfolio`, filtros por tag.

**Ideias ainda não implementadas**: notas internas detalhadas (já tem `internalNotes` simples), favoritar fotos via localStorage, livro de visitas, slideshow tela cheia, stories estilo Instagram, `/contato`, `/sobre`, depoimentos, status "agendando eventos", modo claro automático, i18n EN/PT, links nominados por convidado, download em ZIP via Worker, app nativo.

---

## Contato

Site: <https://fotos.lucafchala.com> · Instagram: [@lucafchala](https://instagram.com/lucafchala) · Suporte: <suport@lucafchala.com> · WhatsApp: <https://wa.me/5511989211178>
