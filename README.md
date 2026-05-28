# fotos.lucafchala.com

Galeria pública de fotos do fotógrafo Luca F. Chala — site, painel administrativo, sistema de solicitação de remoção de fotos (LGPD), métricas, backup e PWA. Tudo roda em **um único Cloudflare Worker** com **Workers KV** como banco. Não há build step, framework, dependências runtime ou banco SQL — só JavaScript puro renderizando HTML no servidor.

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
| Banco | Cloudflare Workers KV — namespace `FOTOS` |
| Auth | PBKDF2-SHA256 (10k iterações) + sessão HTTP-only em KV |
| E-mail | Resend API (`https://api.resend.com/emails`) |
| Frontend | HTML/CSS/JS renderizado no Worker (sem build) |
| Dev tooling | Wrangler ≥ 3 (`npm run dev` / `npm run deploy`) |
| CI/CD | GitHub Actions (`.github/workflows/deploy.yml`) com smoke tests |
| Fontes externas | Google Fonts (Inter), jsDelivr (lib QR code, carregada só ao abrir modal de QR) |
| Imagens | Hospedadas no Google Drive, servidas via `lh3.googleusercontent.com/d/<fileId>` |
| Analytics | Cloudflare Web Analytics beacon (opcional, controlado por `CF_ANALYTICS_TOKEN`) |

**Não há banco SQL, nem D1, nem R2, nem ORM, nem JSX/React, nem bundler.** Todo o estado é uma única chave KV `events` (array JSON de todos os eventos), mais chaves de session/contador/rate-limit. As páginas HTML são strings literais geradas em runtime — fácil de ler, fácil de mudar, zero overhead de build.

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

Variáveis lidas como `env.<NOME>` dentro de `fetch(request, env, ctx)`.

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
   - `GET /api/healthz` retorna `{"ok":true,"hashMs":<n>}` e `hashMs ≤ 200` (acima disso, login estouraria o orçamento de CPU do Worker)
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
├── package.json           ← só scripts dev/deploy e wrangler como dev dep
├── wrangler.toml          ← config do Worker, binding KV
├── .github/
│   └── workflows/
│       └── deploy.yml     ← CI: deploy + smoke tests
└── src/
    ├── index.js           ← roteador + todos os handlers HTTP (Worker entry)
    ├── utils.js           ← getEvents/saveEvents, hash, sessão, rate-limit, e-mails
    └── ui/
        ├── gallery.js     ← HTML da galeria pública /
        ├── event.js       ← HTML da página de projeto /<slug>
        ├── dashboard.js   ← HTML do login e do painel admin /dashboard
        └── support.js     ← HTML da página de suporte /suporte
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
| `ratelimit:<key>:<ip>:<window>` | String numérica, TTL = janela | `checkRateLimit` (todas as rotas com rate limit) |

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

---

## Rotas HTTP

Roteador único em `src/index.js`, baseado em cadeia de `if`s. Ordem importa — a regex `/^\/([a-z0-9][a-z0-9-]*)$/` que casa páginas de evento é **a última**, para não capturar `/dashboard`, `/suporte`, etc.

### Públicas

| Método | Path | Função | O que faz |
| --- | --- | --- | --- |
| GET | `/` | `handleGallery` | HTML da galeria com cards de todos os eventos `visible !== false`, ordenados por pinned + data desc |
| GET | `/<slug>` | `handleEventPage` | HTML do projeto. Incrementa `views:<slug>` em `ctx.waitUntil` (não bloqueia resposta) |
| GET | `/suporte` | `supportHTML()` | Página de contato com WhatsApp + e-mail + formulário |
| GET | `/manifest.json` | `handleManifest` | Manifest PWA |
| GET | `/icon.svg` | `handleIcon` | Ícone SVG inline (rect 256x256 com "f." centralizado) |
| POST | `/api/removal-request` | `handleRemovalRequest` | Recebe solicitação de remoção (rate-limit: 5/h por IP), envia e-mails, persiste |
| POST | `/api/track-drive` | `handleTrackDrive` | Incrementa `drive_clicks:<slug>` (rate-limit: 60/h por IP) |
| POST | `/api/suporte` | `handleSupportRequest` | Envia e-mail do formulário de suporte (rate-limit: 5/h por IP) |
| GET | `/api/healthz` | `handleHealthz` | `{ok:true, hashMs:N}` — usado pelo CI |

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
| PUT | `/api/settings/password` | Trocar senha do admin |
| GET | `/api/backup` | Download JSON com todos os eventos |
| POST | `/api/backup/restore` | Merge de backup com KV atual (por id, mais recente vence) |
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
- **Modal "Antes de acessar as fotos"**: aparece ao clicar no botão. Tem créditos destacados, passo-a-passo de download (mobile e desktop), aviso "Não tire print" e botão final "Ir para o Google Drive" que chama `trackDrive()` antes de abrir.
- **Créditos**: nome do fotógrafo + (opcional) créditos do evento + link extra. Nota verde "marque sempre @lucafchala".
- **Footer**: compartilhar no WhatsApp (link `wa.me/?text=...`), botão "Solicitar remoção de foto", link "Suporte".
- **Modal de remoção**: formulário com:
  - Radio: identificar foto por número, link direto ou upload (até 2 MB).
  - E-mail (obrigatório, regex), telefone (obrigatório, 10–13 dígitos).
  - Mensagem opcional.
  - Aviso LGPD curto: "Seus dados (e-mail e telefone) são usados exclusivamente para processar esta solicitação."
  - Submete via fetch para `/api/removal-request`. Sucesso troca o conteúdo da modal por uma tela verde com check.
- **Tour guiado** (apenas no primeiro acesso, lembrado via `localStorage['fotos:tour_seen']`): modal de boas-vindas que mostra 3 dicas (Acessar fotos / WhatsApp / Solicitar remoção). Botão "Entendi" fecha e seta a flag.

### `/suporte` — Página de suporte (`src/ui/support.js`)

- Header com link "Voltar".
- Botões grandes: WhatsApp (`wa.me/5511989211178`) e e-mail (`mailto:suport@lucafchala.com`).
- Divisor "ou envie uma mensagem".
- Formulário POST para `/api/suporte` (form-data, sem fetch — degrada para HTML puro). Campos: nome (opcional), e-mail (opcional, vira `reply_to` se preenchido), mensagem (obrigatório, ≤ 2000 chars).
- Após envio, a página é recarregada com `?` e mostra caixa verde "Mensagem enviada!".
- Erros (campos vazios, rate limit) mostram caixa vermelha.

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
- Filtro: `<select>` com `Todos / Ativos (sem arquivados) / Em edição / Em revisão / Entregue / Arquivado`.
- Lista de eventos (cards horizontais) com: thumb, título + badge de status colorida, slug em monospace, botões de ação à direita:
  - **Pin** (estrela) — toggle. Ao pinar, despina todos os outros (server-side garante max 1).
  - **Eye** — toggle `visible`.
  - **QR** — abre modal com QR code da URL do evento. A lib QR é carregada do jsDelivr **só ao primeiro clique** (lazy). Botões: Fechar / Copiar link / Imprimir / Baixar PNG.
  - **Edit** — abre overlay com formulário pré-preenchido.
  - **Delete** (lixeira vermelha) — confirma + DELETE.
- **Overlay/formulário de evento** com todos os campos: slug, título, descrição curta, descrição longa, fotos (até 6 com pré-visualização miniatura inline — campo "blur" converte links de Drive para `lh3.googleusercontent.com`), link do Drive, data, créditos, link extra, status, notas privadas, toggles "Visível" e "Em breve", e bloco "Aviso de novas fotos" (toggle + select de expiração: nunca / 1h / 6h / 24h / 48h / 168h).
- A lista usa renderização híbrida: a primeira página vem **SSR** (renderizada no Worker) e o JS substitui via `renderEventList()` ao mudar filtro. Os botões funcionam via event delegation (`data-action`/`data-id`), então tanto o SSR quanto o re-render funcionam com o mesmo handler.

#### Aba Métricas

Tabela com colunas: projeto, views, cliques no Drive. Ordenada por views desc. Dados carregados sob demanda (na primeira vez que o usuário clica na aba).

#### Aba Config

- **Alterar senha**: campos "Nova senha" + "Confirmar senha", botão "Salvar". PUT para `/api/settings/password`.
- **Backup**:
  - Botão "Baixar backup JSON" — GET `/api/backup` retorna arquivo `fotos-backup-YYYY-MM-DD.json`.
  - Input file + botão "Restaurar backup" — POST `/api/backup/restore`. Merge inteligente: mesmo `id` é atualizado só se o `updatedAt`/`createdAt` do backup for mais recente. Nada é deletado.

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

## Autenticação e segurança

### Hash de senha (`utils.js`)

```js
hashPassword(password, saltHex?, iterations = 10_000)
// → "pbkdf2:10000:<32 hex salt>:<64 hex hash>"
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
  "version": 1,
  "backupAt": "ISO date",
  "eventCount": N,
  "events": [ ... ]
}
```

Headers:
```
Content-Type: application/json
Content-Disposition: attachment; filename="fotos-backup-YYYY-MM-DD.json"
```

### Restore

`POST /api/backup/restore` (auth) com `{events: [...]}` no body. Lógica em `mergeRestore`:

- Para cada evento do backup:
  - Se não existe no KV → adicionar (`added++`).
  - Se existe → comparar `updatedAt || createdAt`. O mais recente vence (`updated++`).
- Eventos atuais que **não** estão no backup são preservados (nunca deleta).

Resposta: `{ok:true, added, updated, total}`.

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
2. `await env.FOTOS.get('__healthz__')` — só pra confirmar que o binding KV responde (não importa o valor).
3. `await hashPassword('healthcheck')` cronometrado — confirma que o PBKDF2 cabe no budget de CPU do Worker.
4. Retorna `{ok:true, hashMs:<delta>}`.

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
- **CPU budget do Worker**: hashing PBKDF2 com 10k iterações chega perto do limite em planos free (~10 ms CPU). Se subir o `iterations`, monitorar `/api/healthz`.
- **Upload de remoção limitado a 2 MB**: maior que isso e o request vira 413. Solicitantes com fotos grandes podem usar a opção "link direto" em vez de upload.
- **Storage de solicitações capado em 500**: solicitações resolvidas mais antigas são apagadas quando passa. Backup manual recomendado antes de atingir esse volume.

---

## Roadmap (TODO.md)

O arquivo [`TODO.md`](./TODO.md) tem o histórico completo de features entregues e o backlog de ideias (operacional, engajamento, profissional, UX, futuro distante). Resumo do que falta:

**Segurança**: rate limiting mais robusto, recuperação de senha por e-mail (magic link).

**Recursos**: avaliações em estrelas, senha por evento.

**Longo prazo**: migrar imagens para R2 (resolve preview WhatsApp), portfólio público `/portfolio`, filtros por tag.

**Ideias ainda não implementadas**: notas internas detalhadas (já tem `internalNotes` simples), favoritar fotos via localStorage, livro de visitas, slideshow tela cheia, stories estilo Instagram, `/contato`, `/sobre`, depoimentos, status "agendando eventos", modo claro automático, i18n EN/PT, links nominados por convidado, download em ZIP via Worker, app nativo.

---

## Contato

Site: <https://fotos.lucafchala.com> · Instagram: [@lucafchala](https://instagram.com/lucafchala) · Suporte: <suport@lucafchala.com> · WhatsApp: <https://wa.me/5511989211178>
