# Retomada

Você está voltando ao projeto. Pode ter sido ontem, pode ter sido em oito meses.
Este arquivo existe para o segundo caso.

Leia daqui até "Rotina de 10 minutos" antes de mexer em qualquer coisa. O resto
é consulta.

---

## 1. Está tudo no ar agora?

Abra, nesta ordem:

| Onde | O que tem de estar lá |
| --- | --- |
| `fotos.lucafchala.com/api/healthz` | `"ok": true` e **`"problems": []`** |
| `status.lucafchala.com` | tudo verde |
| Actions → Deploy (último run) | verde |

**`problems` vazio é o sinal mais importante do projeto.** Ele não fica vazio
por sorte: cada entrada ali é uma configuração que quebrou em silêncio, das que
não derrubam o site e por isso ninguém nota. Se tiver qualquer linha, resolva
antes de começar a programar — o texto diz o que fazer.

Se o site estiver fora do ar, pule para "Quando algo está quebrado".

---

## 2. O que este projeto é, em cinco linhas

Galeria pública de fotos, num **único Cloudflare Worker**. Sem framework, sem
build de front-end, sem servidor. Os dados moram em **Workers KV** (chave-valor)
e o log de consentimento em **D1** (SQLite). As fotos ficam no **Google Drive** —
o site nunca as hospeda, só libera o link depois de anti-robô e aceite dos Termos.

O código é ES modules puro, servido de `src/index.js`. **Não existe processo de
build**: o que está no arquivo é o que roda.

---

## 3. Rotina de 10 minutos para voltar ao ritmo

```bash
git pull
npm ci
npm test          # 244 testes, ~3 s
npm run lint
```

Depois suba o site localmente e clique nele:

```bash
npx wrangler dev
```

Se quiser o ambiente que os testes de navegador usam (KV e D1 em memória,
Turnstile e e-mail simulados), veja `docs/VERIFICACAO.md`.

**Não confie só no `npm test`.** A lição mais cara desta base de código é que os
testes passavam com a interface inteira quebrada. Ver "As armadilhas" abaixo.

---

## 4. Onde está cada coisa

```
src/
  index.js      ← roteador + todos os handlers. É o arquivo grande. Comece por ele.
  security.js   ← CSP, CSRF, tokens assinados, headers, senha. Política de segurança fica AQUI.
  utils.js      ← KV, sessão, e-mail, EXIF, CSV, escape
  ui/           ← cada página é uma função que devolve HTML como template string
    markdown.js ← renderizador dos documentos legais (escapa antes de formatar)
  content/
    legal-docs.js  ← GERADO. Não edite. Veja abaixo.
docs/legal/     ← os documentos de conformidade, em markdown. A FONTE da verdade.
scripts/build-legal-docs.mjs  ← markdown → legal-docs.js
tests/          ← 244 testes; security.test.js é o maior
```

**Regra do conteúdo legal:** edite o markdown em `docs/legal/`, rode
`npm run build:legal`, commite os dois. A CI reprova se esquecer — o site não
pode mostrar texto diferente do documento oficial.

---

## 5. As armadilhas (leia mesmo se estiver com pressa)

Estas custaram horas. Todas têm teste ou portão de CI hoje, mas o portão só
protege quem entende o porquê.

### 5.1. Nonce na CSP aplicada quebra a interface inteira

Pela CSP nível 3, **um nonce faz o browser descartar `'unsafe-inline'`**. Este
site tem ~63 handlers inline (`onclick=`, `onchange=`). Adicionar um nonce à
política aplicada mata todos eles de uma vez — e **os testes continuam passando**,
porque eles conferem o texto da política, não o efeito dela.

- A política **aplicada** tem `'unsafe-inline'` e **nunca** nonce.
- A política **report-only** (estrita) tem nonce e nenhum `'unsafe-inline'`.
- Portão de CI + smoke test do deploy barram a reintrodução.

Só se descobre isso abrindo o site num navegador de verdade.

### 5.2. `getEvents()` tem cache de módulo

30 s, por isolate. Em produção é o desejado. **Entre testes do mesmo arquivo,
vaza**: um teste vê a lista de eventos de outro e você recebe um 404 confuso.
`/api/healthz` é o único caminho que força releitura — use como primer.

### 5.3. Cota de KV é 1000 escritas/dia — mas os contadores saíram do KV

> ✅ **Atualizado.** Os contadores e o rate limit migraram para **Durable
> Objects** (`src/counters.js`), no plano **gratuito** — 100 mil linhas
> escritas/dia, incremento atômico, e sem o teto de 1 escrita/s por chave.
> Nada foi comprado: o Workers Paid continua **não** assinado, e o
> [`docs/PLANO-PAGO.md`](./docs/PLANO-PAGO.md) segue como histórico da decisão.

O número de 1000/dia continua valendo para tudo o que **ainda** usa KV: lista de
eventos, sessões do painel, consentimento, `cron:last`. Antes de adicionar um
`put()` num caminho público, calcule o pior caso — o contador de visualizações
sozinho, contando HEAD, gastava 1440/dia quando morava lá.

**Estourar a cota não derruba mais o site.** Quando a cota acaba, o KV recusa
escrita — e a recusa vem como *exceção*, não como valor de retorno. Ela subia do
`checkRateLimit` até o catch do `fetch()` e virava 500 no `/api/drive-link`: as
fotos paravam de sair no dia de maior público, e o login do painel caía junto.
Hoje a escrita do contador é isolada e o limite deixa passar quando só ela
falha (fail-open deliberado, ver SECURITY.md), o `/api/healthz` acusa em
`problems`, e nenhuma rota pública gasta escrita antes de saber que tem algo
real para contar.

**Os contadores são atômicos, um Durable Object por chave.** `views:` e
`drive_clicks:` passam por `bumpCounter()` (utils.js), que chama `increment()`
no objeto endereçado por aquela chave. O runtime serializa as chamadas de um
mesmo objeto, então a contagem sai exata em qualquer formato de tráfego —
espalhado ou em rajada — sem nada acumulado em memória.

**Cuidado ao mexer nisto — já quebrou de dois jeitos, os dois silenciosos.** Os
dois defeitos são da era do KV e não podem mais acontecer do mesmo jeito, mas o
que eles ensinam continua: adiar o primeiro incremento perdia a contagem inteira
em tráfego esparso (o isolate morria antes do segundo), e um carimbo de janela
ÚNICO para todas as chaves fazia a primeira chave a gravar bloquear as outras —
50 visitantes viraram `views: 1`. **A lição é sobre o harness, não sobre o
código:** os dois passaram por revisão e pela suíte. Reproduza os dois formatos
de tráfego antes de acreditar que uma mudança aqui está certa.

Três armadilhas novas, das que a migração introduziu e os testes já prendem:

- **I/O externo ABRE o portão de entrada do Durable Object.** Esta é a mais
  cara, e só apareceu no workerd de verdade. O objeto serializa eventos
  enquanto uma operação de ARMAZENAMENTO está em voo — mas uma leitura de **KV**
  não é armazenamento do objeto, é I/O externo, e durante ela outros eventos
  entram. Com o assentamento (que lê o KV) no caminho do incremento, **100
  incrementos simultâneos viraram 3**. A correção é o assentamento rodar uma vez
  só, no construtor, dentro de `ctx.blockConcurrencyWhile()`, e nenhum caminho
  quente tocar o KV. Se você acrescentar qualquer `await` de rede dentro de um
  método do objeto, releia este parágrafo antes.
- `NaN` é `typeof 'number'`. Uma checagem ingênua o adotaria como contagem e
  envenenaria o contador para sempre (`NaN + 1 = NaN`) — o mesmo veneno que o
  `toCount` continha na era do KV.
- `reset()` grava `0` em vez de só apagar tudo. Um objeto vazio é
  indistinguível de um objeto novo, e o assentamento voltaria a ler o KV: apagar
  um projeto e recriar outro com o mesmo slug ressuscitaria a contagem antiga.

**E a lição sobre a suíte, que é maior que as três.** O primeiro teste de
atomicidade rodava contra um dublê em node — e passava, porque a serialização do
dublê tinha sido escrita por nós. Ele afirmava o que queríamos ouvir. Só quando
o mesmo teste rodou dentro do workerd (`npm run test:workers`) o `3` apareceu.
**Não teste contra dublê aquilo que a plataforma é que garante.**

### 5.4. `SIGNING_SECRET` falha ABERTO

Sem ele, o nonce de página e os tokens de formulário **desligam em silêncio** e o
site parece protegido. Isso é deliberado (falhar fechado derrubaria a entrega de
fotos por causa de uma camada *adicional*), com o contrapeso de o `healthz`
gritar. Piso de 32 caracteres; vazio e só-espaço são recusados.

### 5.5. Configuração de painel da Cloudflare é apagada pelo deploy

`wrangler deploy` trata o `wrangler.toml` como fonte da verdade. Observabilidade
ligada só pelo painel **some no próximo merge**. Se ligar algo por lá, replique
no `wrangler.toml` ou perde.

### 5.6. Comparar URL como texto

Três bugs distintos nesta base vieram disso: host por `startsWith`, GitHub por
substring, `//host/x` passando como caminho interno. **Host se compara com
`new URL()` e `.host`.** A exceção é a regra que barra GitHub, que é uma
*negação* — ali excesso de alcance erra para o lado seguro.

### 5.7. Etapa de CI que nunca rodou não é etapa que passa

Com `set -e`, a primeira falha esconde todas as seguintes. Um check do smoke
test ficou dois deploys sem nunca executar, e era estruturalmente incapaz de
passar. Ao mexer no `deploy.yml`, extraia o passo e rode local — veja
`docs/VERIFICACAO.md`.

### 5.8. Queda de LEITURA do KV não derruba mais a entrega das fotos

O KV é a única dependência no caminho crítico: sem a lista de eventos não há
slug, não há evento e não há link do Drive. Uma queda de leitura derrubava
galeria, página do projeto e portão de uma vez, com 500.

`getEvents()` cai em três degraus, do dado mais novo para o mais velho: o cache
do próprio isolate **mesmo vencido** (antes era descartado passados os 30 s de
TTL — velho por 30 s continua sendo a lista certa), depois uma **cópia na Cache
API** (gratuita, sem cota de escrita, e vive no colo em vez do isolate, que é o
que salva um isolate frio), e só então propaga o erro. Devolver `[]` seria pior
do que falhar: viraria "o site não tem projeto nenhum", com 404 em tudo e painel
verde.

Duas coisas **não** afrouxam enquanto degradado, e há teste para as duas: o
portão do Drive recusa exatamente o que recusaria normalmente, e o `/api/healthz`
responde `kv:false` com o motivo em `problems`. O site de pé não pode deixar o
painel verde.

O preço, dito na cara: servindo da cópia, o visitante pode ver uma lista
desatualizada — um projeto escondido ou apagado durante a queda ainda aparece. A
janela é a própria queda, e quem não consegue ler o KV normalmente também não
consegue gravar, então quase nunca há estado novo a perder.

### 5.9. O relógio do Workers não anda durante execução síncrona

`Date.now()` fica **congelado** entre operações de I/O — é mitigação de ataque de
temporização. Medir CPU de dentro do isolate, portanto, é impossível: o
`t0`/`t1` em volta de um PBKDF2 de 100k iterações devolve o mesmo valor, e a
subtração dá **zero**.

O `healthz` publicou `"hashMs": 0` em toda resposta de produção desde que a
linha foi escrita, e três coisas consumiam esse zero como se fosse medida: o
portão `HASH_MS -gt 200` do `deploy.yml`, o `hashMs > HASH_BUDGET_MS` do painel
de status, e a linha "hash 0ms" que o painel mostrava como desempenho ótimo. Um
§5.7 dentro do outro — o portão que deveria vigiar o limite de CPU era o que não
podia reprovar.

O contraste está na mesma resposta: `kvLatencyMs` e `d1LatencyMs` são reais,
porque passam por I/O e aí o relógio anda.

**Regra prática:** só dá para cronometrar aqui o que atravessa I/O. Para custo de
CPU, o sinal é de fora — estourar o orçamento mata a requisição e vira 5xx, que
o smoke test e o painel já detectam. Se precisar do número, ele está nas métricas
do Worker no painel da Cloudflare, não no seu código.

---

## 6. Como fazer uma mudança

1. Branch a partir de `main`.
2. Código + teste. **Reintroduza o bug e confirme que o teste falha** — teste de
   regressão que nunca falhou não é teste de regressão.
3. `npm run lint && npm run typecheck && npm test && npm run test:coverage`.
   - **`npm test` são DUAS suítes.** `unit` roda em node com dublês; `workers`
     roda dentro do workerd, com Durable Objects, KV e D1 de verdade. A segunda
     existe porque a primeira aprovou um contador que NÃO era atômico — o dublê
     tinha a serialização que nós mesmos escrevemos. Ver `docs/VERIFICACAO.md §0`.
   - **`npm run typecheck` está em `strict: true`** e a base passa limpa. É
     `tsc --checkJs` sobre JSDoc, sem passo de build. Se um arquivo novo não
     passar, anote o arquivo — não baixe o gate. O raciocínio e a lista de bugs
     reais que ele já encontrou estão no `tsconfig.json`.
   - `test:coverage` é catraca: os limiares são o que a suíte já cobre. Se
     falhar, escreva o teste que falta em vez de baixar o número.
4. Mexeu em UI, CSP ou rota? **Abra num navegador.** Ver `docs/VERIFICACAO.md`.
5. Mexeu em `docs/legal/`? `npm run build:legal`.
6. PR. A CI roda testes, lint, invariantes de segurança, CodeQL e auditoria de
   dependências.
7. Merge → deploy automático → smoke test contra a produção.

**Deploy manual** (sem commit): Actions → Deploy → Run workflow. Funciona do
celular. Serve para rotação de secret, rollback e reverificação.

---

## 7. Quando algo está quebrado

| Sintoma | Primeiro lugar para olhar |
| --- | --- |
| Site fora do ar | Actions → último Deploy; depois o painel da Cloudflare |
| Painel não loga | `healthz` → `problems`; depois cookie legado `session` no browser |
| Formulários recusam tudo | `TURNSTILE_SECRET_KEY` — ele falha **fechado** |
| E-mail não chega | `RESEND_API_KEY` e `ADMIN_EMAIL` no `healthz` |
| Link do Drive não abre | `healthz` → `drive: { bad: N }` |
| Deploy vermelho, site no ar | O smoke test roda **depois** de publicar. Ver Rollback no README |
| Contagem de visitas estranha | Robô batendo GET; HEAD não conta |

**Rollback:** `git revert <sha> && git push` (preferido), ou promover um
deployment anterior no painel da Cloudflare — mas aí a `main` fica à frente da
produção, e isso precisa ser resolvido logo em seguida.

---

## 8. O que fica pendente

Lista completa e priorizada no [TODO.md](./TODO.md). O que importa saber ao
voltar:

- **Nada bloqueia o uso do site.** As pendências são melhorias e decisões, não
  defeitos abertos.
- **`/api/healthz` é público e detalhado** — decisão consciente, com o raciocínio
  registrado no TODO. Se o modelo de ameaça mudar, o caminho é autenticar o
  detalhe, e está descrito lá.
- **Autorização de imagem para menores** continua sendo o item de conformidade
  mais relevante em aberto.

---

## 9. Documentos, e para que serve cada um

| Arquivo | Quando ler |
| --- | --- |
| **RETOMADA.md** (este) | Ao voltar depois de um tempo |
| [README.md](./README.md) | Referência completa: rotas, dados, deploy, decisões |
| [SECURITY.md](./SECURITY.md) | Modelo de ameaça e cada controle |
| [TODO.md](./TODO.md) | O que falta, o que foi decidido e por quê |
| [docs/VERIFICACAO.md](./docs/VERIFICACAO.md) | Como rodar e dirigir o site de verdade |
| [docs/PLANO-PAGO.md](./docs/PLANO-PAGO.md) | Como assinar o Workers Paid e o que mexer (e não mexer) depois |
| [docs/legal/](./docs/legal/) | ROPA, RIPD, LIA, retenção, incidentes… |
| [LEGAL.md](./LEGAL.md) | Índice da conformidade |

Os documentos legais também são páginas do site, em `/legal`.
