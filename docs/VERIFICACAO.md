# Verificação — como rodar e dirigir o site de verdade

`npm test` não prova que o site funciona. Prova que as funções fazem o que as
funções fazem.

Isso não é retórica. Nesta base de código, a interface inteira já ficou morta
com **todos os testes verdes**: um nonce na CSP aplicada desativou os ~63
handlers inline, e os testes conferiam o *texto* da política, não o efeito dela.
Só apareceu abrindo o site num navegador.

Este documento é o caminho para fazer isso em poucos minutos.

---

## 0. As duas suítes — e por que a segunda existe

```bash
npm run test:unit      # node, com dublês, ~1 s
npm run test:workers   # dentro do workerd, com DO/KV/D1 de verdade
npm test               # as duas
```

A `unit` é a de sempre: rápida, com dublês nossos, boa para lógica e
roteamento. A `workers` roda o mesmo código **dentro do runtime da Cloudflare**
(via `@cloudflare/vitest-pool-workers`), com Durable Objects, KV e D1 reais —
simulados pelo miniflare, mas com o comportamento da plataforma.

A segunda não é luxo, e a história de por que ela existe é curta: o teste que
afirma que o contador é **atômico** passava na `unit` e estava errado. O dublê
serializava as chamadas porque nós escrevemos o dublê assim. Rodando no
workerd, 100 incrementos simultâneos deram **3** — o assentamento lia o KV, e
I/O externo abre o portão de entrada do objeto.

A regra que sai disso: **o que a PLATAFORMA garante, teste na plataforma.**
Aritmética, validação e caminho de falha podem morar na `unit`; atomicidade,
persistência e isolamento, não.

---

## 1. Wrangler dev — o mais simples

```bash
npx wrangler dev
```

Sobe o Worker de verdade com KV e D1 locais. Serve para clicar no site. Não
serve para os fluxos que dependem de dados semeados (evento com Drive, pedido de
remoção existente) — para esses, use o harness.

---

## 2. Harness local — Worker real, dependências simuladas

O harness roda **o `src/index.js` de verdade** com:

- **KV e D1 em memória**, semeados com eventos, um pedido de remoção e uma senha
  de admin;
- **Turnstile e Resend interceptados** — nada sai da máquina;
- `SIGNING_SECRET` presente, para exercitar nonce de página e token de formulário.

É a montagem que pegou a catástrofe da CSP, o loop de recarregamento do portão
do Drive e o colapso da galeria sem JavaScript.

Ele **não está versionado** — é um arquivo de ~120 linhas que se reescreve
rápido. O essencial:

```js
// serve.mjs
import worker from './src/index.js';
const store = new Map();
const FOTOS = {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v) { store.set(k, v); },          // logue aqui para contar escritas
  async delete(k) { store.delete(k); },
  async list({ prefix = '' } = {}) {
    return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })),
             list_complete: true, cursor: null };
  },
};
store.set('events', JSON.stringify([/* ao menos um evento com slug e driveUrl */]));
store.set('admin_password', await hashPassword('Senha-De-Teste-2026!'));

const env = { FOTOS, ADMIN_EMAIL: 'admin@example.com',
              TURNSTILE_SECRET_KEY: 'test', SIGNING_SECRET: 'x'.repeat(40) };

// Turnstile e Resend não podem sair da caixa:
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input?.url || input);
  if (url.includes('challenges.cloudflare.com')) return new Response('{"success":true}');
  if (url.includes('api.resend.com')) return new Response('{}');
  return realFetch(input, init);
};
// …e um http.createServer que repassa para worker.fetch(request, env, ctx).
```

**Três pegadinhas ao escrever o harness:**

1. **`admin_password` semeado vence `ADMIN_PASSWORD`.** `getAdminHash()` lê o KV
   primeiro. Se semear o hash, a variável de ambiente é ignorada — e você
   perde tempo achando que o login quebrou.
2. **`ctx.waitUntil` precisa ser coletado e aguardado.** Contador de visitas,
   alerta de login e dedupe rodam fora do caminho da resposta. Um harness que
   descarta as promessas mede o nada.
3. **O login do painel exige token do Turnstile** (#175) sempre que
   `TURNSTILE_SECRET_KEY` existe — e aqui o widget nunca carrega, então
   nenhum navegador produz token. Sem token, a resposta é
   `/dashboard?error=ts`, com senha certa ou errada. Mande
   `cf-turnstile-response` no POST (qualquer valor: o `fetch` interceptado
   aprova), ou, no navegador, acrescente o campo ao formulário antes de
   enviar (`page.evaluate` criando um `<input type="hidden"
   name="cf-turnstile-response">`). Deixar o secret de fora também entra — o
   login cai em "Turnstile indisponível" e segue só com a senha — mas aí o
   caminho testado não é o de produção.

---

## 3. Navegador de verdade

**O roteiro versionado vem primeiro:** com o `wrangler dev` de pé e projetos
semeados (§1–2), `npm run verifica:navegador` abre toda página do sitemap no
Chromium e confere o que só um navegador enxerga — erro de script, violação da
CSP aplicada, fonte que não carregou, galeria sem JavaScript, lightbox, login.
Sai com 1 se algo falhar. O que segue aqui é para a verificação específica da
sua mudança, que nenhum roteiro genérico cobre.

Chromium está pré-instalado em `/opt/pw-browsers`:

```js
import { chromium } from 'playwright-core';
import { readdirSync } from 'fs';
const d = readdirSync('/opt/pw-browsers').find(x => x.startsWith('chromium-'));
const browser = await chromium.launch({
  executablePath: `/opt/pw-browsers/${d}/chrome-linux/chrome`,
  args: ['--no-sandbox'],
});
```

**O que sempre vale a pena verificar:**

```js
page.on('pageerror', e => erros.push(e.message));
page.on('console', m => {
  // Report-Only é ruído esperado: a política estrita existe para gerar relatório.
  if (m.type() === 'error' && /Content Security Policy/i.test(m.text())
      && !/Report Only/i.test(m.text())) erros.push(m.text());
});
```

Um erro de CSP **aplicada** no console é a interface quebrando. Um de
report-only é o sistema funcionando como projetado.

### Erros de método que já custaram tempo

- **`isVisible()` significa "tem caixa", não "é visível".** O honeypot fica em
  `x=-9999` e `isVisible()` devolve `true`. Está correto — ele precisa de caixa
  para bots caírem nele.
- **`textContent` inclui o corpo dos `<script>`.** Procurar `onerror=` na página
  acusa código legítimo dentro de um script.
- **Procurar a string `github.com` acusa a prosa** dos documentos, que citam a
  regra. O invariante é sobre **onde o clique leva** — compare `host` de cada
  `href`, resolvido contra a origem do site.
- **`networkidle` é lento** nestas páginas (~1 min por documento). Para uma
  varredura rápida use `load`.

### Sem JavaScript

```js
const ctx = await browser.newContext({ javaScriptEnabled: false });
```

A galeria já usou masonry calculado por JS, e sem ele os cards colapsavam para
4px e se empilhavam no mesmo ponto. Hoje é uma grade uniforme em CSS puro, sem
depender de script — mantenha assim, e teste com JS desligado qualquer mudança
de layout.

---

## 4. Dirigindo os endpoints direto

Para o que não precisa de navegador. Todos exigem `Sec-Fetch-Site: same-origin`
(o portão de CSRF roda antes do roteamento):

```bash
# CSRF: escrita cross-site tem de morrer antes de qualquer handler
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8787/api/events \
  -H 'Sec-Fetch-Site: cross-site' -H 'Content-Type: application/json' -d '{}'   # 403

# HEAD responde como GET, sem corpo e sem gravar em KV
curl -sI -o /dev/null -w '%{http_code}\n' http://localhost:8787/            # 200

# Login real → o cookie de sessão. O token é obrigatório com o secret do
# Turnstile configurado (§2, pegadinha 3); sem ele: Location /dashboard?error=ts
curl -s -i -X POST http://localhost:8787/dashboard/login \
  -H 'Content-Type: application/x-www-form-urlencoded' -H 'Sec-Fetch-Site: same-origin' \
  -d 'password=Senha-De-Teste-2026!' -d 'cf-turnstile-response=teste' | grep -i set-cookie
```

**Cuidado com o rate limit ao repetir testes**: `/api/removal-request` e o login
têm limites por IP. Reiniciar o harness zera tudo, porque o KV é em memória.

---

## 5. Rodando o smoke test do deploy localmente

Um check do `deploy.yml` já ficou dois deploys sem nunca executar — `set -e`
fazia a primeira falha esconder as seguintes — e era incapaz de passar. Por isso
o smoke saiu do YAML para `scripts/smoke.sh`, o **mesmo** script que o
`deploy.yml` roda contra o preview e contra a produção. Rode contra o
`wrangler dev` antes de subir:

```bash
npm run smoke:local     # = bash scripts/smoke.sh http://127.0.0.1:8787
```

Ele relata cada checagem e só reprova no fim, então uma falha não esconde as
outras.

---

## 6. Checklist antes de abrir PR

- [ ] `npm test` e `npm run lint`
- [ ] **O bug foi reintroduzido e o teste falhou?** Se o teste passa com o bug de
      volta, ele não testa o que você acha
- [ ] Mexeu em UI, CSP ou rota → `npm run verifica:navegador` e a verificação
      específica da mudança num navegador, console limpo
- [ ] Mexeu em login, healthz ou algo que o smoke olha → `npm run smoke:local`
      (é o que decide a reversão automática em produção)
- [ ] Mexeu em `deploy.yml` → passo extraído e rodado local
- [ ] Mexeu em `docs/legal/` → `npm run build:legal` e os dois commitados
- [ ] Adicionou `put()` em caminho público → calculou o pior caso contra as
      1000 escritas/dia
- [ ] O check do CodeQL acusou alerta que você não consegue abrir → rode o
      CodeQL localmente (`llms.md`, "CodeQL local") antes de mexer às cegas
