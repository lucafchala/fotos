---
name: verify
description: Verificar uma mudança do fotos rodando o site de verdade (Worker local + Chromium), não os testes. Use para conferir no navegador uma mudança em página, portão do Drive, painel ou rota.
---

# Verificar no site rodando

A suíte e os roteiros (`npm run verifica:*`) são da CI. Verificar é dirigir o
`src/index.js` de verdade e olhar o que ele faz, com captura.

## Subir o site

`scripts/worker-local.mjs` → `sobeWorker({ kv, env, contadores, externo })` sobe o
Worker real num servidor HTTP em `127.0.0.1:<porta livre>` (KV e Durable
Objects em memória; Turnstile e Resend interceptados; qualquer outro host
recebe 599). Devolve `{ url, kv, escritas, emails, fecha }`.

- `kv`: valores já serializados, ex. `{ events: JSON.stringify([...]) }`. A
  senha do painel é sempre `SENHA_DE_TESTE`; `entraNoPainel(page, url)` entra
  pelo formulário de verdade.
- D1 de verdade (SQLite, migrações reais): `import { d1Sqlite } from
  'tests/helpers/d1.js'` e `env: { CONSENT_DB: db }`; `db.sqlite.prepare(...)`
  lê o registro de consentimento.
- Todo pedido chega com `CF-Connecting-IP: 203.0.113.10` — um IP só, bom para
  limites por IP (o teto de álbuns restritos do #146, os baldes).
- `SIGNING_SECRET` vem ligado: o nonce do Drive vale; para chamar a API sem
  navegador, raspe `const DRIVE_NONCE = "…"` do HTML da página.

Rode com o carregador que troca `cloudflare:workers` pelo dublê:

```bash
node --import ./scripts/node-com-workers.mjs <roteiro>.mjs   # da raiz do repo
```

Roteiro fora do repo (scratchpad)? Importe por caminho absoluto
(`/home/user/fotos/scripts/worker-local.mjs`) e crie um `node_modules` ao lado
dele apontando para o do repo, senão `playwright-core` não resolve.

## Dirigir no Chromium

`playwright-core` com o Chromium de `/opt/pw-browsers/chromium-*/chrome-linux/chrome`
(veja `chromiumLocal()` em `scripts/verifica-evento.mjs`). Padrões úteis:

- **Bloqueador de anúncio** (caminho noscript do portão): `page.route` com
  `route.abort()` para `challenges.cloudflare.com`.
- **Fotos**: responda `lh3.googleusercontent.com` com um PNG.
- **Ver a resposta do servidor sem trocá-la**: `route.fetch()` e
  `route.fulfill({ response, body })`.
- Celular: `viewport { width: 390, height: 844 }`, `deviceScaleFactor: 3`.
- Conte `pageerror` e mensagens de CSP no `console` em toda página.

## Fluxos que valem dirigir

- Página de projeto → abrir o portão (`[data-action="openModal"]`) → aceites →
  link pronto (`#drive-link` com `href` do Drive); com e sem Turnstile; álbum
  público e restrito.
- Painel: salvar evento (o toast), Ajustes (backup baixa arquivo, texto não
  salvo pergunta no `beforeunload`), "Selecionar vários" no celular.
- `/api/healthz`: `versaoSite` e `versao`.

## Pegadinhas

- `page.reload()` com `beforeunload` dispensado lança; use `.catch(() => {})`
  e confira o que ficou na página.
- O aviso de cookies fica por cima da janela do portão no celular: role ou
  aceite antes de capturar a parte de baixo.
- `w.fecha()` no fim espera os `waitUntil` (o INSERT do consentimento) — leia o
  D1 depois de uma espera, ou depois de fechar.
