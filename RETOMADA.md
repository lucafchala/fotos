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
npm test          # ~950 testes em duas suítes (node + workerd), ~50 s — out/2026
npm run lint
```

Depois suba o site localmente e clique nele:

```bash
npx wrangler dev
npm run verifica:navegador   # noutro terminal: Chromium de verdade contra o wrangler dev
npm run smoke:local          # o mesmo smoke que decide a reversão em produção
npm run verifica:evento      # véspera de evento: portão do Drive e fotos por aparelho (não precisa do wrangler)
npm run verifica:galeria     # galeria própria: grade, zoom, downloads por aparelho (não precisa do wrangler)
npm run verifica:painel      # o painel logado, no iPhone, no Android e no computador (não precisa do wrangler)
npm run verifica:previa      # a faixa e o menu "Testes" da prévia de PR, no celular e no computador (não precisa do wrangler)
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
  utils.js      ← KV, sessão, e-mail, EXIF, CSV, escape, registro de degradação (healthz)
  config.js     ← constantes compartilhadas (chave pública do Turnstile, limites). Não moram no
                  index.js porque o módulo de entrada só pode exportar função ou classe — um
                  `export const` lá derruba o workerd na inicialização.
  counters.js   ← Durable Objects: Counter (todos os contadores num objeto) e RateLimiter
                  (janela fixa `check()` e balde de fichas `take()`)
  drive.js      ← galeria própria: Drive API (lista a pasta, mapeia erros), URLs do
                  lh3 e do original. A chave só existe aqui e no proxy de download.
  pedidos.js    ← pedidos de remoção, um por chave no KV (#198): lista em lote, regravação
                  que espera a janela de 1 s do KV, migração do array antigo, poda (§5.15)
  previa.js     ← a camada da PRÉVIA DE PR, por fora do roteador: faixa, noindex, menu
                  "Testes" (simulações por cookie, ações com sessão). Só com AMBIENTE =
                  "previa"; em produção nenhuma linha dela roda (§5.16)
  ui/           ← cada página é uma função que devolve HTML como template string
    markdown.js ← renderizador dos documentos legais (escapa antes de formatar)
    galeria.js  ← galeria própria /galeria/<slug>: grade + PhotoSwipe + downloads
  content/
    legal-docs.js  ← GERADO. Não edite. Veja abaixo.
    fonts.js       ← GERADO de fonts/*.woff2 (npm run build:fonts). Não edite.
    vendor.js      ← GERADO de vendor/ (npm run build:vendor). Não edite.
    icons.js       ← GERADO de icon-svg.js (npm run build:icons): os PNG do apple-touch-icon e do manifest. Não edite.
docs/legal/     ← os documentos de conformidade, em markdown. A FONTE da verdade.
fonts/          ← o Inter servido em /fonts/ (desde #131, sem Google Fonts) + licença OFL
vendor/         ← bibliotecas de terceiros servidas em /vendor/ (hoje, o PhotoSwipe 5, MIT) + licença
scripts/build-legal-docs.mjs  ← markdown → legal-docs.js
scripts/build-fonts.mjs       ← WOFF2 → fonts.js
scripts/build-vendor.mjs      ← vendor/ → vendor.js, com o hash do conteúdo no nome publicado
scripts/build-icons.mjs       ← icon-svg.js → icons.js (PNG 180/192/512/512 maskable, via sharp)
scripts/smoke.sh              ← smoke do deploy (e `npm run smoke:local`)
scripts/fonte-do-preload.mjs  ← acha a fonte pré-carregada no HTML; o smoke e a suíte usam o mesmo
scripts/deploy-duplicado.mjs  ← um push publica uma vez só: o deploy.yml pula o push repetido (#186)
scripts/previa-publica.mjs    ← `npm run previa`, o "Preview command" do Workers Builds: publica a prévia com os segredos PREVIA_* do build (§5.17)
scripts/verifica-navegador.mjs  ← roteiro no Chromium (`npm run verifica:navegador`)
scripts/verifica-evento.mjs     ← véspera de evento: 429, código por e-mail, fotos por aparelho (`npm run verifica:evento`)
scripts/verifica-galeria.mjs    ← galeria própria no Chromium, por aparelho (`npm run verifica:galeria`)
scripts/verifica-painel.mjs     ← o painel logado, fluxo do #220 por aparelho (`npm run verifica:painel`)
scripts/verifica-previa.mjs     ← a faixa e o menu "Testes" da prévia de PR (`npm run verifica:previa`)
scripts/vigia-csp.mjs           ← o vigia de CSP dos roteiros: qualquer mensagem de CSP reprova; a página-canário prova que ele enxerga (#126, §5.1)
scripts/worker-local.mjs        ← o Worker DE VERDADE num servidor HTTP local (KV/DO em memória, rede externa interceptada)
scripts/node-com-workers.mjs    ← gancho do Node que troca `cloudflare:workers` pelo dublê (para o worker-local)
scripts/verifica-shell-dos-workflows.py  ← bash -n e regras de conteúdo nos `run:` dos workflows
tests/          ← suíte unit (node) + workers (workerd); security.test.js é o maior
  helpers/d1.js ← D1 de verdade (node:sqlite + as migrações reais) para testar SQL sem dublê
  smoke.test.js ← confere contra o Worker cada valor que o smoke.sh exige (#181)
  scripts-embutidos.test.js ← lint e tsc dos <script> que as páginas EMITEM (#127)
  helpers/scripts-embutidos.d.ts ← o que o tsc não sabe desses scripts, em listas fechadas
  helpers/paginas.js ← toda variação de página renderizada (a mesma lista do lint, da estrutura e da CSP) e a varredura da CSP estrita: `on…=`, `<script>` sem nonce, `javascript:` (#126)
  painel.test.js ← o card de evento idêntico no servidor e no navegador (inclusive depois do bundle)
.github/rulesets/main-protegida.json  ← proteção da main, para importar (#177)
docs/BRANCHES.md  ← como uma mudança chega à produção (branches, PR empilhado, um merge por vez)
docs/PAINEL.md    ← o painel por dentro: seções, blocos, cada ação e o endpoint dela, como verificar
```

**Regra do conteúdo legal:** edite o markdown em `docs/legal/`, rode
`npm run build:legal`, commite os dois. A CI reprova se esquecer — o site não
pode mostrar texto diferente do documento oficial.

---

## 5. As armadilhas (leia mesmo se estiver com pressa)

Estas custaram horas. Todas têm teste ou portão de CI hoje, mas o portão só
protege quem entende o porquê.

### 5.1. A CSP aplicada é a estrita: script sem nonce e handler inline não executam

Desde o #126 a política aplicada é a **estrita**: `script-src 'self'`, o nonce
da requisição e as origens do Turnstile e da Web Analytics — **sem
`'unsafe-inline'`** (e sem Report-Only: é um cabeçalho de CSP só). Um `<script>`
sem `nonce="${nonce}"`, um `onclick="…"` e um `javascript:` não executam, e
**nenhum teste de unidade acusa**: a página segue 200 e o botão fica mudo. Já
custou caro: com ~63 handlers inline, um nonce na política aplicada matou todos
de uma vez com a suíte verde, porque os testes conferiam o texto da política, não
o efeito dela. Desde 03/09/2026 (`4552180`) viraram listeners delegados
(`data-onclick` e afins), e a virada só foi feita com o navegador aberto.

- Todo `<script>` inline leva `nonce="${nonce}"` — a CI olha o código-fonte e
  `tests/rendered-pages.test.js`, a página **renderizada** (um `<script${nonce ? …}>`
  passa no primeiro e não no segundo).
- Evento é delegação (`data-onclick`, `data-action`…), nunca `on…=`.
- **Não "conserte" recolocando `'unsafe-inline'`**: com o nonce na política o
  navegador o descarta (CSP Level 3) — não destrava nada, e o texto da política
  passa a mentir. Dê o nonce ao script. **E nunca ponha nonce no `style-src`**:
  aí cai o `'unsafe-inline'` de *estilo*, e todo `style="…"` das páginas morre.
- Os cinco `verifica:*` servem a página com os cabeçalhos de verdade e reprovam
  com QUALQUER mensagem de CSP no console (`scripts/vigia-csp.mjs`). Cada um abre
  com uma página-canário: se o vigia ficar cego (o Chromium muda o texto de uma
  mensagem) ou a política deixar de bloquear, ele mesmo reprova.
- Em produção a política segue relatando para `/api/csp-report`: procure
  `csp-violation` no log do Worker. Extensão de navegador de visitante é ruído
  conhecido; um relatório de `inline` num documento nosso não é.
- O smoke do deploy exige o nonce e proíbe `'unsafe-inline'` no `script-src` do
  cabeçalho que o site de verdade manda.

Só se descobre o resto abrindo o site num navegador de verdade.

### 5.2. `getEvents()` tem cache de módulo

30 s, por isolate. Em produção é o desejado. **Entre testes do mesmo arquivo,
vaza**: um teste vê a lista de eventos de outro e você recebe um 404 confuso.
`/api/healthz` é o único caminho que força releitura — use como primer. Mas
ele guarda a própria medição por 10 s por `env` quando responde `ok` (#195):
com o **mesmo** `env` no mesmo arquivo, o segundo healthz não relê nada
(cabeçalho `X-Healthz-Cache: hit`).

E por baixo do cache do isolate há outro: o KV guarda cópia em cada local da
Cloudflare, por 60 s se ninguém disser nada, e uma escrita feita em outro
local só aparece quando essa cópia vence. As leituras do site público (a
lista e o selo de agenda) pedem `cacheTtl: 30`, o mínimo aceito: somado aos
30 s do isolate, uma mudança do painel chega a qualquer visitante em **até
1 min** — é o que o toast de salvar promete. Tirar o `cacheTtl` volta o pior
caso para 90 s e faz o aviso mentir para quem está longe de quem salvou;
`tests/kv.test.js` prende os dois pedidos.

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

**Os contadores são atômicos, num Durable Object só para todos.** `views:` e
`drive_clicks:` passam por `bumpCounter()` (utils.js), que chama
`increment(chave)` no objeto único `Counter`. O runtime serializa as chamadas de
um mesmo objeto, então a contagem sai exata em qualquer formato de tráfego —
espalhado ou em rajada — sem nada acumulado em memória. (Já foi um objeto por
chave: quebrou o painel de métricas, porque chamada de DO é subrequisição — 50
por invocação no plano gratuito — e o painel lia duas por projeto.)

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

### 5.3-b. Migração de Durable Object não sobe por `versions upload`

`versions upload` **não aplica migração de Durable Object**: a API recusa com o
código **10211**, dizendo que "migrations must be fully applied via a
non-versioned deployment". Isso pega o `deploy.yml`, que sobe a versão do
portão por esse caminho: depois do merge de um PR com migração nova
(`[[migrations]]` com uma tag nova no `wrangler.toml`), o deploy **falha no
upload**, de propósito e com a mensagem explicando, e o caminho é redisparar à
mão com `unversioned: true` (README, deploy manual). Não há atalho: migração e
código sobem juntos, não dá para aplicar só a migração antes.

Até 12/10/2026 isso pegava também **todo build de PR**: o Cloudflare Workers
Builds — configurado no **painel**, não neste repositório — rodava
`npx wrangler versions upload` a cada PR, e o build de um PR com migração nova
falhava por desenho (aconteceu na estreia dos contadores em DO, migração `v1`).
Nesse modelo a versão do PR rodava com a configuração de **produção**, e o
comentário do bot no PR não trazia link nenhum: só "Deployment successful" e,
no check, um Version ID.

Desde então os builds de PR saem por **`npx wrangler preview`** (Worker
Previews; README, "Prévia de PR"): cada prévia tem dados próprios e um
namespace de Durable Object próprio, criado a partir das migrações do topo do
`wrangler.toml`. Como uma migração **nova** chega a uma prévia que já existe
ainda não foi visto — o primeiro PR com `v2` responde, e o resultado entra
aqui.

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

### 5.10. Turnstile tem três respostas, e o login é o único que segue com a Cloudflare fora

`checkTurnstile()` responde `ok`, `recusado` (token ausente/inválido/repetido —
o que o cliente controla) ou `indisponivel` (sem secret, siteverify fora, ou a
Cloudflare recusando a **nossa** chave). Suporte, remoção e portão do Drive
falham fechado nos dois últimos (`verifyTurnstile()`); o **login do painel**
falha fechado em `recusado` e **segue** em `indisponivel`, só com senha, rate
limit e alerta — senão uma queda da Cloudflare trancaria o dono fora do único
lugar de onde o site é operado. A verificação vem **depois** do PBKDF2 de
propósito (o canário de CPU do smoke posta sem token). Detalhes em
`SECURITY.md`, "Turnstile on the login".

Consequência prática: **com bloqueador de anúncios, o dono não entra** naquele
navegador — a tela avisa em 5 s. Não há caminho alternativo, ao contrário do
portão do Drive.

### 5.11. O smoke roda depois da promoção — o portão de preview está indisponível

O `deploy.yml` foi feito para rodar o smoke numa versão sem tráfego e só então
promover. Na prática a Cloudflare nunca entrega a URL de preview deste Worker,
e não vai entregar: a documentação dela diz que "Version URLs are not generated
for Workers that implement a Durable Object" (Versions & Deployments → Version
URLs → Limitations; #179). O resumo de todo deploy diz "Portão de preview: ⚠️
indisponível". O caminho para um portão antes da promoção são as Worker
Previews, que têm Durable Objects próprios (o `[previews]` do `wrangler.toml`
já existe) — isso muda o `deploy.yml` e espera o ok do dono. O deploy então promove, roda o
smoke em produção e **reverte sozinho** se reprovar. Três consequências:

- clientes ficam expostos por segundos a uma versão não verificada;
- depois de uma reversão, a `main` ainda tem o commit ruim, e o **próximo
  merge o republica**. Por isso: um merge por vez, esperando o deploy anterior
  terminar verde (`docs/BRANCHES.md`, "Merge = deploy");
- toda expectativa do smoke é uma segunda cópia de algo que mora no código, e
  uma cópia que diverge reverte a produção. Os valores que ele compara com o
  Worker ficam em variáveis no topo de cada checagem do `scripts/smoke.sh`, e
  o `tests/smoke.test.js` confere cada um contra o Worker de verdade (#181).
  Mudou um destino do login, a marcação do preload ou o cache da fonte? A
  suíte reprova, e o smoke muda no mesmo PR.

### 5.12. Um evento inteiro é UM IP — e o cliente não pode repetir sozinho sem teto

O público de um evento abre o link junto, no Wi-Fi do local, e um Wi-Fi de
local é um IPv4 público (NAT) para todos. Com o portão do Drive em 60/h por
IP (janela fixa), 750 pessoas viravam 60 com fotos e 690 com 429 até virar a
hora. Desde out/2026 o portão é um **balde de fichas** (`RateLimiter.take()`,
números em `src/config.js`): aguenta a rajada e, quando esvazia, o 429 diz
em quantos **segundos** tentar (`Retry-After`). O teste "cabe o público de um
evento grande atrás de um NAT só" prende o piso. **Limite por IP tem de caber
o maior público que divide um IP**; quem barra robô é o Turnstile + nonce,
não o número. Login e formulários continuam em janela fixa — lá o corte seco
é o objetivo.

O 429 era só metade. O portão repetia o pedido **sozinho e sem teto** a cada
erro (erro → Turnstile renova a ficha → o callback pede de novo): no
Chromium, 27 pedidos em 8 s por celular. Centenas de celulares barrados nesse
laço esgotariam as 100 mil requisições/dia do plano gratuito em minutos e
derrubariam o site para todo mundo. Hoje: num erro comum, **uma** tentativa
automática; num 429, espera o `Retry-After` com contagem na tela, no máximo 5
vezes; depois, botão e código por e-mail. **Qualquer repetição automática no
cliente precisa de teto** — no pico, ela multiplica a carga justamente quando
o servidor já está recusando.

O último recurso é o **código por e-mail** (`/api/drive-code`), para quem tem
o Turnstile carregado mas falhando (VPN, bloqueador). Sem estado: o token é
HMAC sobre (slug, código, prazo) e não contém o código. A página só o
oferece num bloqueio de verdade (Turnstile falhou/travou; 403/429/5xx/rede
depois das tentativas) — nunca num 404 ou num nonce que não se renova, que o
código também não resolveria. Apelido `+etiqueta` é recusado e pontos do
Gmail contam como um endereço só (`emailCanonico()`). Duas armadilhas dele:
o **teto do dia** (`EMAIL_CODE_DAILY_CAP`) existe porque a franquia do Resend é
a MESMA do suporte e da remoção — subir o teto pode calar os outros e-mails; e
sem `SIGNING_SECRET` ou `RESEND_API_KEY` o caminho responde 503 (indisponível,
nunca aberto). **Números conferidos pelo dono (29/10/2026, #231):** o Resend
está no plano grátis — 100 e-mails/dia e 3.000/mês para a conta inteira; o
pico medido foi de 36 e-mails em 12/10/2026 (dia de evento), com o teto de 40
códigos/dia. O teto fica em 40: cabe no dia com folga para suporte, remoção e
alertas. Subir só junto de um plano maior do Resend.

Mesma família no servidor: a trava do alerta de erro por e-mail era só no
KV, e a leitura que deu `null` fica em cache no colo — numa onda de 500 cada
requisição gravava no KV e mandava e-mail. Agora há uma trava no isolate antes.

Antes de um evento grande: `npm run verifica:evento` (Chromium, sem wrangler)
roda os formatos de tráfego de um evento — 429, VPN/e-mail, fotos por aparelho.

Duas coisas da página de projeto que falham em silêncio (#141, out/2026):

- **O Turnstile carrega sob demanda** (`comTurnstile()` em `src/ui/event.js`):
  primeiro toque, tecla ou rolagem, ou abrir o portão/remoção. Quem precisa do
  `turnstile` passa por `comTurnstile()`; testar `typeof turnstile` direto, com
  o script ainda chegando, cai no caminho `noscript` sem bloqueador nenhum. O
  endereço do script fica por extenso em `TS_SRC`: a prévia ("sem script") o
  troca por texto.
- **A caixa da capa é 3:2 fixa** (`.hero-foto`, `.carousel`), com a foto em
  `object-fit: contain`. Sem ela a página nasce com o hero de altura 0 e desce
  quando a foto chega (CLS 0,334). Capa retrato aparece inteira, menor, com
  faixa escura dos lados; o site não guarda a proporção de cada capa.

### 5.13. Galeria própria: quem vê é decidido por UMA função

Desde out/2026 existe `/galeria/<slug>` (#234, #235): as fotos da pasta do
Drive dentro do site, com visualizador (PhotoSwipe) e downloads "para redes" e
"tamanho máximo" (os dois **sem alterar o arquivo**, ver abaixo). Desde 29/10/2026 (v2.1.0) **não é mais prévia só do dono**.
Quem vê é decidido por `podeVerGaleria()`, UMA função em `src/index.js` — nada
de espalhar `if` de acesso pelas rotas: álbum **público** abre para qualquer
visitante, sem login e sem o portão do Drive; **família e privado** só com o
passe "galeria" (cookie assinado de 12 h, preso ao caminho `/galeria/<slug>`)
que o portão do Drive emite depois da declaração de acesso; **"Em breve"**
segue fechado — o mesmo 404 de rota inexistente. O dono logado sempre vê. Não
há liberação gradual por porcentagem: isso foi substituído pela abertura
direta. A página do álbum público leva primeiro à galeria ("Ver e baixar as
fotos"); o Drive virou opção secundária. A faixa do dono (atalhos do painel,
"Atualizar lista") só aparece para o dono logado; `?atualizar` só relê o Drive
para o dono. Ligar: secret `GOOGLE_DRIVE_API_KEY` (passo a passo no README,
"Galeria própria") e pasta compartilhada como "Qualquer pessoa com o link".

O que já mordeu, ou morderia:

- **A chave nunca vai à página.** A lista que a página recebe não tem nem a
  chave nem as resource keys; o original sai pelo proxy
  `/galeria/<slug>/baixar/<id>`. O teste "sem a chave na página" prende isso.
- **O proxy só serve o que está na pasta do projeto.** Sem a checagem de
  pertencimento (`achaFoto`), ele seria um proxy aberto para qualquer arquivo
  público do Drive com a nossa cota. Há teste que falha se ela sumir.
- **A lista não grava em KV.** Fica na memória do isolate e na Cache API
  (chave `https://fotos.invalid/__galeria/<id>`, o mesmo truque da cópia de
  sobrevivência da lista de eventos), 10 min. A cota de 1000 escritas/dia (§5.3)
  não é tocada.
- **Plano gratuito = 50 subrequests por invocação.** Uma pasta com muitas
  subpastas e páginas estouraria; a varredura para em `GALERIA_MAX_CHAMADAS`
  (30) e a página avisa que a lista é parcial.
- **O arquivo baixado é SEMPRE o do Drive, com o nome do Drive (v3.0).** O
  site não redimensiona (nada de `lh3` em download; `GALERIA_LADO_REDES` e
  `larguraRedes` não existem mais), não renomeia (sem prefixo de slug nem
  `-redes`) e não recodifica. `max` = o original da pasta do projeto; `redes` =
  o arquivo da pasta do Instagram (`driveUrlInstagram`) que casa com a foto
  (`casaRedes` em `src/drive.js`: nome sem extensão, sem maiúscula/Unicode;
  senão o do Instagram sem sufixo `-insta`/`_ig`/` instagram`/`-redes`; mesma
  subpasta primeiro). Sem par, sem pasta ou pasta ilegível: sem "para redes" na
  UI e 404 em `v=redes`. O id da rota é SEMPRE o da foto da galeria; o id do
  arquivo do Instagram vem da listagem do servidor (nunca do pedido, nem vai à
  página): por isso o proxy não é aberto. `Cache-Control: private,
  no-transform` impede que um intermediário converta a imagem.
- **Orçamento de subrequests com duas pastas.** A página e `v=redes` listam a
  pasta do projeto (até `GALERIA_MAX_CHAMADAS` = 30) e a do Instagram (até
  `GALERIA_MAX_CHAMADAS_IG` = 8): 38 + ~4 Cache API + ~4 KV/sessão/contador ≈
  46 < 50. Subir um dos dois exige refazer essa conta (o teste "orçamento do
  plano gratuito" a prende). O sitemap de imagens não lê a pasta do Instagram.
- **A ÚNICA checagem de plataforma da galeria é "é iOS?"** (`ehIOS()` no
  script de `src/ui/galeria.js`: UA `iPhone|iPad|iPod` ou `MacIntel` com
  `maxTouchPoints > 1` — o iPadOS finge ser Mac). É exceção deliberada à
  regra "nunca decidir por modelo de aparelho/UA", que vale para a RESOLUÇÃO
  das imagens (essa segue por pixels físicos): `canShare({ files })` existe
  também no Android e no desktop, e só o iOS tem o "Salvar imagem" que põe a
  foto no Fotos (o download comum cai no app Arquivos). No iOS (Safari e
  Chrome, ambos WebKit) a folha tem **"Salvar no Fotos"** (Web Share com
  `File` exato; lotes de 20 fotos / 80 MB) e **"Baixar arquivo"**. Android e
  desktop: download comum, sem Web Share. Se `canShare` recusar, o iOS cai
  para o download comum. O `navigator.share()` do iOS exige toque recente:
  tenta na hora, e se vier `NotAllowedError` pede UM toque no botão (o arquivo
  já está pronto). Compartilhar a foto (botão Compartilhar do visualizador) é
  outra coisa: abre o menu de compartilhar de propósito.
- **O zoom só sobe a resolução porque o `srcset` vai até o original.** O
  PhotoSwipe nunca baixa o `sizes` de um slide (guarda o maior já usado); se a
  escada parar antes do original, o zoom estica pixel.
- **O voltar fecha a foto, não a galeria.** Abrir o visualizador (e a folha
  de download) EMPILHA uma entrada no histórico; trocar de foto só a
  reescreve. Com `replaceState` puro, o voltar do Android com uma foto aberta
  levava de volta ao painel. O roteiro confere voltar no desktop, no link
  direto, no iPhone e no Android.
- **O script da página mora numa template string** (`SCRIPT` em
  `src/ui/galeria.js`): crase num comentário dele fecha a string e derruba o
  módulo inteiro na importação.
- **Galeria pública no Google (29/10/2026).** Só a de álbum público e
  listado, vista por visitante, fora da prévia e com fotos, sai sem `noindex`
  — a regra é `galeriaIndexavel()` (sitemap e página usam a mesma); família e
  privado seguem com o perfil do painel (`no-store`, `noindex`). As fotos vão
  para o Google por `/sitemap-galeria-<slug>.xml` (um por galeria: duas
  listagens frias no mesmo pedido estourariam as 50 subrequests). Downloads:
  `Disallow` no `robots.txt`, `X-Robots-Tag: noindex` e `rel="nofollow"`. A
  página do visitante é `private, no-cache` (leva o nonce da CSP; nunca
  `public`). Foto oculta sai do HTML e do sitemap no próximo pedido; **para
  tirar do Google com urgência: Search Console → Remoções** (`docs/RELEASE.md`).
- **Carga da galeria no celular (30/10/2026).** O CSS do PhotoSwipe não vai no
  `<head>` (bloqueava a pintura): `preparaLightbox()` o insere ANTES do
  `<style>` da página — depois dele, as regras `.pswp` da página perderiam a
  cascata. A pré-carga da primeira foto (celular até 430 px, foto deitada)
  repete a escada `GALERIA_LARGURAS_GRADE` e o `-rw` do WebP: se a `<img>`
  mudar de URL ou de `sizes`, a dica baixa um arquivo a mais (o
  `verifica:galeria` conta os pedidos da primeira foto). `eager` só na
  primeira tela e `fetchpriority=high` só na primeira linha.
- **No Playwright, `page.route` não intercepta o `<a download>`** — a
  navegação vira download antes da rota. O `verifica:galeria` confere a URL do
  download; o nome do arquivo (o `Content-Disposition`) está na suíte.

### 5.14. Painel: o card de evento vai ao navegador por `toString()` — e o bundle mexe nele

Desde out/2026 o painel é em blocos (#220; tudo em `docs/PAINEL.md`). O card
de cada evento é UMA função, `cardProjetoPainel()` em `src/ui/dashboard.js`:
o servidor a chama na primeira pintura, e o script da página recebe o código
dela por `Function.prototype.toString()` para redesenhar depois de cada ação.
Acabou a duplicação servidor × cliente que fazia o card ser consertado "só no
CSS". Mas a função tem duas regras, e as duas já foram testadas de verdade:

- **Nada de fora dela.** No navegador não existe o escopo do módulo: tudo o
  que ela usa chega pelo parâmetro `h` (escape, safeUrl, rótulos, ícones).
  `tests/painel.test.js` executa o texto injetado isolado.
- **Nenhuma função NOMEADA dentro dela.** O deploy empacota com esbuild e
  `keepNames`, que embrulha toda função nomeada num `__name(fn, "nome")` —
  e `__name` é definido no topo do BUNDLE, não no navegador. Com um
  `const item = (...) => ...` lá dentro, a suíte inteira passava (ela roda o
  fonte cru) e o painel em produção quebraria no primeiro redesenho com
  `__name is not defined`. Foi pego montando o bundle de verdade
  (`npx wrangler deploy --dry-run --outdir …`) e rodando a função de lá; hoje
  o teste aplica a mesma transformação (`transformSync` com `keepNames`).

Duas do celular, que o `npm run verifica:painel` prende:

- **Algo 25 px largo demais afasta a página inteira.** No celular, conteúdo
  mais largo que a tela faz o navegador alargar a "janela de layout" e dar
  zoom para fora — e a barra de baixo sai do lugar. Grade com coluna `1fr` e
  campo de texto numa linha flex é a receita (o campo não encolhe abaixo da
  largura natural); `minmax(0,1fr)` e `min-width:0` desfazem.
- **Campo com letra menor que 16 px faz o iPhone dar zoom ao tocar.** Por isso
  os campos do painel têm 16 px abaixo de 900 px de largura.

### 5.15. Pedidos de remoção: uma chave por pedido — e o KV aceita UMA escrita por segundo na mesma chave

Até a v2.0 os pedidos de remoção eram UM array no KV (`removal_requests`),
regravado inteiro por cinco caminhos. O KV é *last-write-wins*: dois pedidos no
mesmo instante, ou um pedido chegando durante um "resolver", e a gravação de
depois apagava do painel o registro de antes (#198). Hoje cada pedido mora em
`removal_request:<id>` e tudo passa por `src/pedidos.js`. Três regras que os
testes prendem (`tests/pedidos.test.js`, com um KV de teste que cobra os
limites do de verdade):

- **Nada regrava o que não é seu.** Criar não lê a lista; resolver lê e grava
  só o próprio registro; restore grava um por um, e id que já existe é pulado.
- **Uma escrita por segundo NA MESMA CHAVE** — a segunda, dentro da janela,
  volta `429`. O envio grava o pedido ANTES dos e-mails (se o cliente fechar a
  aba no meio, o registro existe) e carimba o status deles DEPOIS, na mesma
  chave; os e-mails costumam voltar em menos de um segundo, então
  `regravaPedido()` espera o resto da janela. Sem a espera o carimbo falhava
  justamente no caso normal — e falhava desde antes da v2.0, quando a chave
  era o array. Nos testes a espera vira relógio adiantado
  (`relogioAdiantavel()` em `tests/helpers/pedidos.js`).
- **Leitura em lote.** A lista lê os registros com `get(chaves[])`, até 100 por
  operação: o plano gratuito permite 1000 operações de KV por invocação, e um
  `get` por pedido quebraria o painel no milésimo.

A migração do array antigo roda **no cron**, não em rota GET (abrir o painel
não gasta escrita): copia o que falta, nunca sobrescreve registro próprio (que
é mais novo), e só apaga o array depois de todo pedido ter a sua chave. Até lá
a lista lê os dois juntos. A poda dos resolvidos (180 dias) também é só do
cron — a verificação que vinha de carona em cada envio dependia de regravar a
lista inteira e saiu com ela.

### 5.16. Prévia de PR: a faixa vem antes da página — e as simulações trocam o `env`, não o código

A prévia de cada PR (Cloudflare Worker Previews; README, "Prévia de PR") roda
o código de produção com uma camada por fora do roteador, `src/previa.js`,
ligada só por `AMBIENTE = "previa"` (que só o bloco `[previews]` do
`wrangler.toml` declara). Quatro coisas que valem saber antes de mexer nela:

- **As simulações do menu "Testes" trocam o `env` daquela requisição**, não o
  código: a chave do Turnstile, a do Resend, um KV que recusa, um RateLimiter
  cujo portão diz "lotado". Do roteador para dentro roda o caminho de
  produção. Se uma simulação nova precisar de um `if` dentro do roteador, ela
  está no lugar errado — o que se testa deixa de ser o que produção faz. A
  única exceção é o e-mail "tudo para o dono", que mora em `corpoResend()`
  (utils.js), o ponto único por onde passa todo envio.
- **As ferramentas leem o `env` VERDADEIRO.** Com "KV não lê" ligado, "Voltar
  tudo ao normal" e "Zerar os limites" continuam funcionando — senão a
  simulação trancaria quem a ligou.
- **A faixa entra antes do conteúdo da página, com formulários próprios.**
  Script que pega "o primeiro `<form>`" (ou o primeiro `<details>`, botão…)
  pega o da faixa — só na prévia. Os do site usam id, classe e `data-action`;
  a faixa usa `previa-*` e `data-acao` para não esbarrar. E ela entra também
  em página sem `<body>` (as de erro curtas): a de "KV fora" ficava sem a
  saída.
- **Menu aberto por cima de tudo, faixa fechada embaixo do que é tela
  cheia.** Fechada, z-index 40: o visualizador de fotos e a folha do portão
  passam por cima e o botão de fechar deles continua alcançável. Aberta
  (`:has(details[open])`), por cima de tudo — senão o aviso de cookies cobria
  metade do menu no celular. O `verifica:previa` confere com
  `elementFromPoint` em cada opção.

### 5.17. Segredo de prévia: a configuração base só vale na criação

A Cloudflare oferece uma "configuração base" de segredos para as prévias, e
parece o lugar óbvio. Não é: ela só vale quando uma prévia **nasce**. Mudar a
base depois não chega às prévias que já existem, e o valor de um segredo não
se lê de volta, então não há como copiá-lo para elas. Na estreia (12/10/2026)
a prévia do PR #236 nasceu só com o `ADMIN_PASSWORD`, e cadastrar o resto na
base não mudaria nada nela.

Por isso a fonte dos segredos das prévias é o **build**: as variáveis do
Workers Builds com o prefixo `PREVIA_`, e o "Preview command" é
`npm run previa` (`scripts/previa-publica.mjs`), que publica com
`wrangler preview --secrets-file` — os valores entram na mesma implantação
que o código, a cada push. Duas consequências:

- só os cinco nomes de `SEGREDOS_DA_PREVIA` sobem, e só com o prefixo; um
  `PREVIA_*` a mais é ignorado com aviso. Segredo novo de prévia: acrescente
  lá, e o teste exige a linha dele no README;
- o script não apaga: tirar um `PREVIA_*` do build não tira o segredo de uma
  prévia que já o recebeu (`npx wrangler preview secret delete`);
- sem `PREVIA_SIGNING_SECRET`, o build **gera** um a cada publicação (64
  caracteres aleatórios, nunca impressos). O que foi assinado antes de um push
  (nonce do Drive, token de formulário — 2 h) deixa de valer depois dele. Só
  na prévia, e é o preço de não exigir do dono um segredo que ele teria de
  inventar.

**Para saber se pegou, sem acesso à conta da Cloudflare:** `config.signing`
no `/api/healthz` da prévia. O script sempre leva um `SIGNING_SECRET`, então
`false` quer dizer que ele não rodou naquele build: o Preview command não está
salvo como `npm run previa`, ou o build começou antes da troca (mudar a
configuração não dispara build). E o caminho script → wrangler → publicação se
prova sem conta nenhuma: `tests/previa-publica.test.js` roda o wrangler de
verdade contra uma API falsa e confere que os segredos e os bindings da prévia
vão na publicação. Foi assim, em 12/10/2026, que "o script não funciona" virou
"o build não rodou o script".

### 5.17-b. Backup: o JSON do painel tem teto; o registro inteiro sai pelo `wrangler d1 export`

Desde o backup v3, *Ajustes → Baixar backup JSON* leva também o registro de
consentimento do D1 (`consent`: colunas uma vez, cada aceite uma lista) — e
com ele **IP, aparelho e nome de terceiros**: o arquivo fica só no seu
computador, protegido, e é apagado no prazo do registro. Três coisas que
mordem:

- **Teto de 1500 aceites** (`CONSENT_BACKUP_MAX_LINHAS`). O plano gratuito dá
  10 ms de CPU, e o custo é JSON (~5 ms por 1000 linhas). Estourar não corta o
  arquivo, derruba o download. Acima do teto o toast diz "parcial", e o
  completo é o export:
  `npx wrangler d1 export fotos-consent --remote --output=fotos-consent-AAAA-MM-DD.sql`
  (quando e como restaurar: `docs/RELEASE.md`). Faça um antes de qualquer
  migração D1.
- **D1 fora não derruba o backup**: sai com `consent.ausente` e o motivo, o
  toast avisa, o healthz registra. Nunca confie num backup sem olhar o toast.
- **O restore só acrescenta** (`INSERT OR IGNORE` por id, em lotes de
  `batch()`), recusa linha ruim uma a uma e aceite vencido, e **não roda na
  prévia**. Backups v1/v2 restauram como sempre (`tests/fixtures/`).

### 5.18. Álbum de família ou privado: consentimento, não sigilo (#146)

A caixa de declaração **não é barreira de acesso**: registra o uso que a
pessoa reconheceu, e o link do Drive, liberado, abre para quem o tiver. Foi a
escolha do dono em out/2026. O que muda é só o caminho sem desafio — o
`noscript`, de quem tem o Turnstile bloqueado no navegador:

- **nome obrigatório** num álbum restrito (`nomeDeConsentimento()`), para o
  registro não sair anônimo. A regra existe duas vezes, no servidor e na
  página (`nomeOk()` em `src/ui/event.js`), presas por um teste de par em
  `tests/drive-gate.test.js`. A página pede o link no `change` do campo, não
  no `input`: disparar a cada tecla gravaria "Jo" no lugar de "João";
- **teto de 3 álbuns restritos distintos por IP em 24 h**. Conta álbuns, não
  pedidos, pelo mesmo motivo do §5.12: o público de um evento é um IP só, e
  todo mundo pedindo o mesmo álbum não pode esbarrar em nada. A conta é a
  mesma do alerta de varredura (#147), numa função só
  (`concessoesSemTurnstile()`, `src/index.js`) — mexer numa é mexer nas duas.
  Com o D1 fora, libera (o portão existe para a foto chegar) e avisa no
  healthz;
- passado o teto, o 403 traz `usarEmail` e a página abre o código por
  e-mail, que prova uma caixa e não conta no teto. O 400 do nome traz
  `campo: "nome"`. A página decide pelo campo, nunca pela frase.

O `verifica:evento` roda os quatro casos com o pedido do Turnstile abortado,
como um bloqueador faz. Desde então uma exceção no meio de um cenário vira
FALHA no relatório: antes, um campo que não aparecia derrubava o roteiro sem
imprimir nada, e uma mutação "escapava" só porque o processo morria.

---

## 6. Como fazer uma mudança

1. Branch a partir de `main`, um assunto por branch — nomes, ciclo de vida e a
   proteção da `main` em [`docs/BRANCHES.md`](./docs/BRANCHES.md).
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
   - **Os `<script>` das páginas também passam pelo lint e pelo tsc**, como
     SAEM da página renderizada (`tests/scripts-embutidos.test.js`, #127). O
     tsc roda sem `strict` e com as listas fechadas de
     `tests/helpers/scripts-embutidos.d.ts`: o que um bloco pendura em
     `window` para outro ler, e as propriedades de subtipo (`value`,
     `checked`…) que os scripts usam num elemento genérico. Reprovou com uma
     propriedade nova e legítima? Acrescente à lista — ou estreite o tipo no
     script. Nunca troque a lista por `any` geral: é ela que pega
     `classList.contians`.
   - `test:coverage` é catraca: os limiares são o que a suíte já cobre. Se
     falhar, escreva o teste que falta em vez de baixar o número.
4. Mexeu em UI, CSP ou rota? **Abra num navegador.** Ver `docs/VERIFICACAO.md`.
5. Mexeu em `docs/legal/`? `npm run build:legal`.
6. **Versão.** Mudou o que vai ao ar? Suba `VERSAO` (`src/config.js`) e o
   `version` do `package.json` juntos e escreva a seção nova no topo do
   `CHANGELOG.md` — uma vez por PR, "ainda não publicada" até o merge. Maior,
   menor ou correção: a regra está no comentário de `VERSAO`. Só README,
   testes ou CI não sobem número. A versão do site (o que mudou) não é a
   implantação da Cloudflare (`versao.id` no healthz, usada no rollback) nem a
   etiqueta `deploy-…` do git; o mesmo comentário explica as três.
7. PR. A CI roda testes, lint, invariantes de segurança, CodeQL e auditoria de
   dependências. O CodeQL só analisa PR com base na `main` — PR empilhado
   passa sem ele até a base ser trocada (`docs/BRANCHES.md`).
8. Merge → deploy automático → smoke test contra a produção. **Um merge por
   vez**: espere o deploy anterior terminar verde (§5.11).

**Deploy manual** (sem commit): Actions → Deploy → Run workflow. Funciona do
celular. Serve para rotação de secret, rollback e reverificação.

---

## 7. Quando algo está quebrado

| Sintoma | Primeiro lugar para olhar |
| --- | --- |
| Site fora do ar | Actions → último Deploy; depois o painel da Cloudflare |
| Painel não loga | A mensagem da tela diz qual: "senha incorreta", "banco de dados não respondeu" (KV) ou "verificação anti-robô não passou" (Turnstile — bloqueador de anúncios? §5.10). Depois `healthz` → `problems` e o cookie legado `session` no browser |
| Formulários recusam tudo | `TURNSTILE_SECRET_KEY` — ele falha **fechado** |
| E-mail não chega | `RESEND_API_KEY` e `ADMIN_EMAIL` no `healthz` |
| Link do Drive não abre | `healthz` → `drive: { bad: N }` |
| Deploy vermelho, site no ar | O smoke test roda **depois** de publicar (§5.11); se reprovou, a reversão automática já agiu — veja a linha "Reversão" do resumo. Não mergeie nada até reverter o commit no Git |
| Resumo do deploy: "Portão de preview ⚠️ indisponível" | Normal hoje (#179). O smoke rodou depois da promoção |
| Deploy com o job `deploy` **pulado** e "Deploy pulado: este commit já foi publicado" no resumo | O GitHub entregou o mesmo push duas vezes; a primeira execução publicou, e o resumo aponta qual (#186). Nada a fazer. Para republicar de propósito: **Run workflow** |
| Contagem de visitas estranha | Robô batendo GET; HEAD não conta |
| Visitantes vendo "Muita gente acessando agora — liberando em N s" | O balde do portão do Drive esvaziou para aquele IP (público num NAT só). A página espera e tenta sozinha (até 5×). Se for frequente, subir `DRIVE_GATE_BUCKET` em `src/config.js` (§5.12, #230) |
| Código por e-mail não chega / "verificação por e-mail indisponível" | `healthz` → `problems` ("código por e-mail esgotado hoje" = teto de 40/dia; "não saiu" = Resend recusou). Sem `RESEND_API_KEY` ou `SIGNING_SECRET`, o caminho responde 503. Pedir para olhar o spam; o WhatsApp é a saída |
| Painel: a lista some ou não redesenha depois de uma ação; console com `__name is not defined` ou `X is not defined` | O card de evento ganhou uma função nomeada ou uma variável de fora (§5.14). `npx vitest run tests/painel.test.js` aponta qual |
| Painel no celular "afastado" (página pequena, barra de baixo fora do lugar) | Algum bloco mais largo que a tela (§5.14). `npm run verifica:painel` diz em qual seção |
| Galeria própria: "Falta conectar o site ao Google Drive" | Falta o secret `GOOGLE_DRIVE_API_KEY` — a própria página mostra o passo a passo (§5.13) |
| `healthz` → "status de e-mail do pedido de remoção não gravado" | O pedido está salvo; o carimbo dos e-mails não. Se for frequente, alguém regravou a mesma chave sem esperar a janela de 1 s do KV (§5.15) |
| O array `removal_requests` ainda no KV dias depois do deploy da v2.0 (o painel lê os dois juntos, então nada some — mas a migração parou) | O cron não está migrando: `healthz` → `cron:last` (§5.15) |
| Galeria própria: "pasta inacessível" ou lista vazia | A pasta do projeto não está como "Qualquer pessoa com o link", ou o link cadastrado não é de pasta. A chave de API só enxerga o que é público por link |
| Galeria própria: "O Google limitou downloads desta foto" | Cota de download do Drive para aquele arquivo (`downloadQuotaExceeded`). Passa sozinha em horas; até lá, o botão "Abrir no Drive" da folha continua funcionando. Desde a v3.0 **os dois downloads** (original e Instagram) usam a Drive API e a mesma cota |
| Deploy passou mas não apareceu Release na aba **Releases** | Resumo do job (Actions → Deploy → run) → linha "Release". Falha não afeta o deploy — é `::warning::` no log do passo "Criar GitHub Release"; a tag `deploy-…` já existe de qualquer forma |

**Rollback:** o rápido é **Actions → Deploy → Run workflow** com `version_id` =
a versão boa anterior (UUID inteiro — o resumo de cada deploy imprime o ID;
qualquer outra coisa é recusada antes de tocar em produção). Promove em
segundos, sem recompilar. Depois, `git revert <sha>` em PR, para a `main` não
ficar à frente da produção — senão o próximo merge republica o que foi
revertido.

---

## 8. O que fica pendente

**Depois da v3.0.0 (30/10/2026)** — cada item é uma issue:
- uso: ZIP no computador (#248), faixa de fotos na página do projeto (#249),
  selo de fotos novas (#250), QR code no painel (#251), duplicar evento
  (#140), painel no celular (#220);
- desempenho: script da galeria como arquivo com cache (#252), primeira
  fileira no servidor (#253), proporção real das capas (#254), medição de
  desempenho com p75 no painel (#134, trabalho começado no branch local
  `v3-beacon`);
- código e testes: dividir o `src/index.js` (#255), testes pesados sob carga
  (#256), `@cloudflare/vitest-plugin` (#180), teste visual (#135);
- fora do código: HSTS da borda e "JavaScript detections" na Cloudflare
  (#257), WAF (#132), vigia do Homelab e as checagens novas da v3 no status
  (status.lucafchala.com #64 e #63), autorização de menores (#119).

Lista completa nas [Issues do GitHub](https://github.com/lucafchala/fotos/issues)
— desde 2026-09, item de ação vive lá, não em `TODO.md` (que guarda só
política, orçamento de cota e as regras vivas — ver a nota no topo dele e
`llms.md` para as ferramentas). O que importa saber ao voltar:

- **Nada bloqueia o uso do site.** As pendências são melhorias e decisões, não
  defeitos abertos.
- **`/api/healthz` é público e detalhado** — decisão consciente, com o raciocínio
  registrado em [Regras vivas](./TODO.md#regras-vivas). Se o modelo de ameaça
  mudar, o caminho é autenticar o detalhe, e está descrito lá.
- **Autorização de imagem para menores** continua sendo o item de conformidade
  mais relevante em aberto.
- **Depois da rodada de 23–24/09/2026** (14 PRs, #161–#176), três coisas só o
  dono pode fazer: importar a proteção da `main` e apagar os 72 branches
  entregues (#177, fechada em 29/10/2026: ruleset `main-protegida` ativa,
  "apagar branch no merge" ligado e faxina feita); conferir em produção o que a sessão não alcançava — login
  com Turnstile num navegador de verdade, Worker `fotos-preview` no painel,
  rollback manual (#178). O portão de preview (#179) saiu do `deploy.yml` no PR #236 (a URL nunca chegava).
- **Depois do evento de out/2026** (PR #229 — balde de fichas, código por
  e-mail, fotos por aparelho): medir o pico e calibrar os baldes (#230),
  o plano do Resend já foi conferido (#231, ver o código por e-mail acima),
  e a cota de download do Drive num pico (#233). O `verifica:evento` na CI
  (#232) entrou no PR #236, junto com os outros roteiros de navegador.
- **Versão 2.0** (PR #236 — métricas com gráfico, prévia de PR, painel em
  blocos, pedidos de remoção por chave): o dono testa a prévia (atrás do
  Cloudflare Access desde 25/10/2026) e só então mergeia. Merge é deploy.
  Depois do merge: tag `v2.0.0` e Release no commit de merge, pelos comandos
  de `docs/NOTAS-v2.0.0.md`; roteiro e rollback em `docs/RELEASE.md`.
- **Painel em blocos** (#220, no PR #236): o "pronto quando" do #220 roda
  inteiro no `verifica:painel` (iPhone, Android, computador). Falta o dono
  usar no celular dele e, gostando, fechar o #220.
- **Galeria própria** (#235): **aberta ao público** desde 29/10/2026 (quem
  vê é decidido por `podeVerGaleria()`, §5.13); ocultar foto e downloads
  contados já entregues. Segue pendente: registro de consentimento e
  Turnstile na galeria dos álbuns públicos (decisão do dono, para
  reavaliar), #134 (destino do beacon de desempenho) e #119 (autorização de
  menores).
- **Termos e o modelo do #146**: reescritos na v2.0 (`TERMS_VERSION`
  2026-10-18) — Familiares e Privados falam em consentimento, não senha — e na
  versão 2026-10-29, SEM revisão jurídica por decisão do dono (29/10/2026): a
  galeria dos projetos públicos abre sem aceite e as galerias públicas podem
  aparecer em buscadores. A declaração de acessibilidade está publicada em
  `/legal/declaracao-de-acessibilidade` (`docs/legal/declaracao-de-acessibilidade.md`).

---

### Inventário de validades

O que vence sozinho, e onde o prazo está escrito. Mudou o número no código, mude aqui.

| O quê | Prazo | Onde |
| --- | --- | --- |
| Sessão do painel | 24 h | `SESSION_TTL_SECS` (`src/utils.js`) |
| Código por e-mail do portão | 15 min | `EMAIL_CODE_TTL_SECS` (`src/config.js`) |
| Nonce do Drive e token de formulário | 2 h | `DRIVE_NONCE_TTL_SECS`, `FORM_TOKEN_TTL_SECS` |
| Listagem da galeria própria (cache) | 10 min | `GALERIA_LISTA_TTL_S` |
| Pedido de remoção resolvido | 180 dias, poda às 03:00 UTC | `REMOVAL_RETENTION_DAYS` (`src/index.js`) |
| Registro de consentimento (D1) | 1825 dias (~5 anos), poda às 03:00 UTC | `CONSENT_RETENTION_DAYS` |
| Aviso de "novas fotos" | 24 h por padrão | `photosAlert.expiresAfterHours` (`src/config.js`) |
| Lembrete de backup | `backup:ultimo` no KV | painel, Ajustes |
| Cópias de backup com o registro de consentimento (JSON v3 e `wrangler d1 export`) | 1825 dias por aceite, **apagadas à mão** | `docs/legal/politica-de-retencao.md` |
| Revisão anual dos documentos legais | 12 meses | `docs/legal/README.md` |

## 9. Documentos, e para que serve cada um

| Arquivo | Quando ler |
| --- | --- |
| **RETOMADA.md** (este) | Ao voltar depois de um tempo |
| [CLAUDE.md](./CLAUDE.md) / [llms.md](./llms.md) | Sessão de agente: quais ferramentas usar (GitHub API, verificação) |
| [README.md](./README.md) | Referência completa: rotas, dados, deploy, decisões |
| [SECURITY.md](./SECURITY.md) | Modelo de ameaça e cada controle |
| [TODO.md](./TODO.md) | Política, orçamento de cota, regras vivas, o que foi decidido e por quê |
| [docs/BRANCHES.md](./docs/BRANCHES.md) | Branches, PR empilhado, Dependabot, "um merge por vez", proteção da `main` |
| [Issues](https://github.com/lucafchala/fotos/issues) | O que falta fazer — cada item de ação vive aqui, não em TODO.md |
| [docs/VERIFICACAO.md](./docs/VERIFICACAO.md) | Como rodar e dirigir o site de verdade |
| [docs/PAINEL.md](./docs/PAINEL.md) | O painel por dentro: seções, blocos, ações, endpoints, como verificar |
| [docs/PLANO-PAGO.md](./docs/PLANO-PAGO.md) | Como assinar o Workers Paid e o que mexer (e não mexer) depois |
| [docs/legal/](./docs/legal/) | ROPA, RIPD, LIA, retenção, incidentes, declaração de acessibilidade… |
| [LEGAL.md](./LEGAL.md) | Índice da conformidade |

Os documentos legais também são páginas do site, em `/legal`.
