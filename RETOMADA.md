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

### 5.3. Cota de KV é 1000 escritas/dia

Free tier. Qualquer coisa que grave por requisição é um risco existencial: o
contador de visualizações sozinho, contando HEAD, gastava 1440/dia. Antes de
adicionar um `put()` num caminho público, calcule o pior caso.

**Estourar a cota não derruba mais o site.** Quando a cota acaba, o KV recusa
escrita — e a recusa vem como *exceção*, não como valor de retorno. Ela subia do
`checkRateLimit` até o catch do `fetch()` e virava 500 no `/api/drive-link`: as
fotos paravam de sair no dia de maior público, e o login do painel caía junto.
Hoje a escrita do contador é isolada e o limite deixa passar quando só ela
falha (fail-open deliberado, ver SECURITY.md), o `/api/healthz` acusa em
`problems`, e nenhuma rota pública gasta escrita antes de saber que tem algo
real para contar.

**Os contadores não gastam mais uma escrita por visitante.** Eles gastavam, e
isso fazia o custo do site crescer junto com o público contra uma cota fixa —
medido no harness de `docs/VERIFICACAO.md`: 4 escritas por visitante engajado,
teto de ~250/dia. Hoje `views:` e `drive_clicks:` passam por `bumpCounter()`
(utils.js): os incrementos se somam na memória do isolate e viram **uma escrita
por janela**, não uma por pessoa. Medido de novo com 200 visitantes simulados:
**1,01 escrita por visitante**, com as contagens batendo exatamente (200 e 200).

O que sobra é `ratelimit:drive-link`, uma por visitante — e essa fica, porque é
o limite que protege o portão do Drive; não dá para limitar de verdade sem
gravar na hora. Teto atual: **~985 visitantes/dia**, agora imposto por um
controle de segurança e não pela contabilidade.

O que se perde na agregação é o que estiver pendente quando o isolate morrer. É
perda aceita e já declarada no SECURITY.md (contadores são best-effort), e o
cron diário descarrega o que sobrou. Se um dia isso ainda apertar, os caminhos
são o plano pago do Workers ou tirar os contadores do KV de vez (`/api/perf` e
`/api/csp-report` já mostram como: log estruturado).

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

---

## 6. Como fazer uma mudança

1. Branch a partir de `main`.
2. Código + teste. **Reintroduza o bug e confirme que o teste falha** — teste de
   regressão que nunca falhou não é teste de regressão.
3. `npm test && npm run lint`.
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
| [docs/legal/](./docs/legal/) | ROPA, RIPD, LIA, retenção, incidentes… |
| [LEGAL.md](./LEGAL.md) | Índice da conformidade |

Os documentos legais também são páginas do site, em `/legal`.
