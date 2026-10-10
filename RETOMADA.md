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
npm run verifica:galeria     # galeria própria (prévia): grade, zoom, downloads por aparelho (não precisa do wrangler)
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
  drive.js      ← galeria própria (prévia): Drive API (lista a pasta, mapeia erros), URLs do
                  lh3 e do original. A chave só existe aqui e no proxy de download.
  pedidos.js    ← pedidos de remoção, um por chave no KV (#198): lista em lote, regravação
                  que espera a janela de 1 s do KV, migração do array antigo, poda (§5.15)
  previa.js     ← a camada da PRÉVIA DE PR, por fora do roteador: faixa, noindex, menu
                  "Testes" (simulações por cookie, ações com sessão). Só com AMBIENTE =
                  "previa"; em produção nenhuma linha dela roda (§5.16)
  ui/           ← cada página é uma função que devolve HTML como template string
    markdown.js ← renderizador dos documentos legais (escapa antes de formatar)
    galeria.js  ← galeria própria /galeria/<slug> (prévia, só o dono): grade + PhotoSwipe + downloads
  content/
    legal-docs.js  ← GERADO. Não edite. Veja abaixo.
    fonts.js       ← GERADO de fonts/*.woff2 (npm run build:fonts). Não edite.
    vendor.js      ← GERADO de vendor/ (npm run build:vendor). Não edite.
docs/legal/     ← os documentos de conformidade, em markdown. A FONTE da verdade.
fonts/          ← o Inter servido em /fonts/ (desde #131, sem Google Fonts) + licença OFL
vendor/         ← bibliotecas de terceiros servidas em /vendor/ (hoje, o PhotoSwipe 5, MIT) + licença
scripts/build-legal-docs.mjs  ← markdown → legal-docs.js
scripts/build-fonts.mjs       ← WOFF2 → fonts.js
scripts/build-vendor.mjs      ← vendor/ → vendor.js, com o hash do conteúdo no nome publicado
scripts/smoke.sh              ← smoke do deploy (e `npm run smoke:local`)
scripts/fonte-do-preload.mjs  ← acha a fonte pré-carregada no HTML; o smoke e a suíte usam o mesmo
scripts/deploy-duplicado.mjs  ← um push publica uma vez só: o deploy.yml pula o push repetido (#186)
scripts/verifica-navegador.mjs  ← roteiro no Chromium (`npm run verifica:navegador`)
scripts/verifica-evento.mjs     ← véspera de evento: 429, código por e-mail, fotos por aparelho (`npm run verifica:evento`)
scripts/verifica-galeria.mjs    ← galeria própria no Chromium, por aparelho (`npm run verifica:galeria`)
scripts/verifica-painel.mjs     ← o painel logado, fluxo do #220 por aparelho (`npm run verifica:painel`)
scripts/verifica-previa.mjs     ← a faixa e o menu "Testes" da prévia de PR (`npm run verifica:previa`)
scripts/worker-local.mjs        ← o Worker DE VERDADE num servidor HTTP local (KV/DO em memória, rede externa interceptada)
scripts/node-com-workers.mjs    ← gancho do Node que troca `cloudflare:workers` pelo dublê (para o worker-local)
scripts/verifica-shell-dos-workflows.py  ← bash -n e regras de conteúdo nos `run:` dos workflows
tests/          ← suíte unit (node) + workers (workerd); security.test.js é o maior
  helpers/d1.js ← D1 de verdade (node:sqlite + as migrações reais) para testar SQL sem dublê
  smoke.test.js ← confere contra o Worker cada valor que o smoke.sh exige (#181)
  scripts-embutidos.test.js ← lint e tsc dos <script> que as páginas EMITEM (#127)
  helpers/scripts-embutidos.d.ts ← o que o tsc não sabe desses scripts, em listas fechadas
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

### 5.1. Nonce na CSP aplicada quebra a interface inteira

Pela CSP nível 3, **um nonce faz o browser descartar `'unsafe-inline'`**. Este
site tinha ~63 handlers inline (`onclick=`, `onchange=`) quando isto mordeu:
adicionar um nonce à política aplicada matou todos de uma vez — e **os testes
continuaram passando**, porque eles conferem o texto da política, não o efeito
dela. Desde 03/09/2026 (`4552180`) não sobra nenhum: viraram listeners
delegados (`data-onclick` e afins). A regra abaixo continua valendo até o #126
fazer a virada com o navegador aberto e os relatórios da report-only zerados.

- A política **aplicada** tem `'unsafe-inline'` e **nunca** nonce.
- A política **report-only** (estrita) tem nonce e nenhum `'unsafe-inline'`.
- Portão de CI + smoke test do deploy barram a reintrodução.

Só se descobre isso abrindo o site num navegador de verdade.

### 5.2. `getEvents()` tem cache de módulo

30 s, por isolate. Em produção é o desejado. **Entre testes do mesmo arquivo,
vaza**: um teste vê a lista de eventos de outro e você recebe um 404 confuso.
`/api/healthz` é o único caminho que força releitura — use como primer. Mas
ele guarda a própria medição por 10 s por `env` quando responde `ok` (#195):
com o **mesmo** `env` no mesmo arquivo, o segundo healthz não relê nada
(cabeçalho `X-Healthz-Cache: hit`).

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

### 5.3-b. Migração de Durable Object quebra o preview do Workers Builds

O Cloudflare Workers Builds — configurado no **painel**, não neste repositório —
roda `npx wrangler versions upload` a cada PR. Esse caminho **não aplica
migração de Durable Object**: a API recusa com o código **10211**, dizendo que
"migrations must be fully applied via a non-versioned deployment".

Então, sempre que um PR introduzir uma migração nova (`[[migrations]]` com uma
tag nova no `wrangler.toml`), **o build de preview daquele PR vai falhar**. Isso
é esperado. Não é sinal de código quebrado, e não adianta mexer no código para
tentar consertar.

A ordem que funciona:

1. merge → o `deploy.yml` roda `wrangler deploy` (não-versionado) → a migração
   é aplicada e as classes passam a existir;
2. a partir daí os previews de PR voltam a passar sozinhos.

Não há atalho: migração e código sobem juntos, não dá para aplicar só a migração
antes. Aconteceu na estreia dos contadores em DO (migração `v1`).

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
promover. Na prática a Cloudflare nunca entrega a URL de preview deste Worker
(provável causa: ele implementa Durable Objects — #179), e o resumo de todo
deploy diz "Portão de preview: ⚠️ indisponível". O deploy então promove, roda o
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
nunca aberto).

Mesma família no servidor: a trava do alerta de erro por e-mail era só no
KV, e a leitura que deu `null` fica em cache no colo — numa onda de 500 cada
requisição gravava no KV e mandava e-mail. Agora há uma trava no isolate antes.

Antes de um evento grande: `npm run verifica:evento` (Chromium, sem wrangler)
roda os formatos de tráfego de um evento — 429, VPN/e-mail, fotos por aparelho.

### 5.13. Galeria própria: prévia só do dono, e o portão é UMA função

Desde out/2026 existe `/galeria/<slug>` (#234, #235): as fotos da pasta do
Drive dentro do site, com visualizador (PhotoSwipe) e downloads "para redes" e
"tamanho máximo". **Ainda é prévia**: só quem está logado no painel vê; para
qualquer outra pessoa, a página e o download são o 404 de rota inexistente. A
liberação (testadores → porcentagem → todos) espera a aprovação do dono e troca
**só** `podeVerGaleria()` em `src/index.js` — nada de espalhar `if` de acesso
pelas rotas. Ligar: secret `GOOGLE_DRIVE_API_KEY` (passo a passo no README,
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
- **"Salvar na galeria" no iPhone precisa de DOIS toques.** O
  `navigator.share()` exige um toque recente, e baixar 20 MB demora mais que
  isso: o primeiro toque prepara o arquivo, o segundo compartilha.
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
6. PR. A CI roda testes, lint, invariantes de segurança, CodeQL e auditoria de
   dependências. O CodeQL só analisa PR com base na `main` — PR empilhado
   passa sem ele até a base ser trocada (`docs/BRANCHES.md`).
7. Merge → deploy automático → smoke test contra a produção. **Um merge por
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
| Galeria própria: "O Google limitou downloads desta foto" | Cota de download do Drive para aquele arquivo (`downloadQuotaExceeded`). Passa sozinha em horas; até lá, *para redes* (lh3) e o Drive continuam funcionando |
| Deploy passou mas não apareceu Release na aba **Releases** | Resumo do job (Actions → Deploy → run) → linha "Release". Falha não afeta o deploy — é `::warning::` no log do passo "Criar GitHub Release"; a tag `deploy-…` já existe de qualquer forma |

**Rollback:** o rápido é **Actions → Deploy → Run workflow** com `version_id` =
a versão boa anterior (UUID inteiro — o resumo de cada deploy imprime o ID;
qualquer outra coisa é recusada antes de tocar em produção). Promove em
segundos, sem recompilar. Depois, `git revert <sha>` em PR, para a `main` não
ficar à frente da produção — senão o próximo merge republica o que foi
revertido.

---

## 8. O que fica pendente

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
  entregues (#177); conferir em produção o que a sessão não alcançava — login
  com Turnstile num navegador de verdade, Worker `fotos-preview` no painel,
  rollback manual (#178); e decidir o portão de preview (#179).
- **Depois do evento de out/2026** (PR #229 — balde de fichas, código por
  e-mail, fotos por aparelho): medir o pico e calibrar os baldes (#230),
  confirmar o plano do Resend e testar o código com e-mail de verdade (#231)
  e a cota de download do Drive num pico (#233). O `verifica:evento` na CI
  (#232) entrou no PR #236, junto com os outros roteiros de navegador.
- **Versão 2.0** (PR #236 — métricas com gráfico, prévia de PR, painel em
  blocos, pedidos de remoção por chave): o dono liga as prévias (três passos
  no painel da Cloudflare — README, "Prévia de PR"), testa no celular com o
  menu "Testes" e só então mergeia. Merge é deploy.
- **Painel em blocos** (#220, no PR #236): o "pronto quando" do #220 roda
  inteiro no `verifica:painel` (iPhone, Android, computador). Falta o dono
  usar no celular dele e, gostando, fechar o #220.
- **Galeria própria** (#235): **prévia só do dono**. Falta o dono
  configurar `GOOGLE_DRIVE_API_KEY`, olhar com fotos de verdade e aprovar;
  depois vem a distribuição gradual, que troca só `podeVerGaleria()` (§5.13).

---

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
| [docs/legal/](./docs/legal/) | ROPA, RIPD, LIA, retenção, incidentes… |
| [LEGAL.md](./LEGAL.md) | Índice da conformidade |

Os documentos legais também são páginas do site, em `/legal`.
