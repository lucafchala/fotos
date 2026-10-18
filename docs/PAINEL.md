# O painel por dentro

Referência do painel administrativo (`/dashboard`) como ele é desde o redesenho
em blocos de out/2026 (#220): o mapa das seções, o que cada bloco faz e **qual
endpoint cada ação chama**, como o card de evento é montado (é código que vira
texto, e isso tem regras), o formulário e o passo a passo para acrescentar um
campo, as decisões de acessibilidade e de celular, e como verificar sem confiar
só no `npm test`.

O README tem o resumo (seção "Painel administrativo `/dashboard`"). A armadilha
mais cara, em umas trinta linhas, está em `RETOMADA.md` §5.14 — leia antes de
mexer no card. O resto está aqui.

Tudo mora em **um arquivo**, `src/ui/dashboard.js` (~3 200 linhas): o CSS, o
HTML e o script da página são uma template string, sem build. `loginHTML()`
desenha a tela de entrada, `dashboardHTML()` desenha o painel, e
`cardProjetoPainel()` e `ICONES` são exportados à parte (§5).

> **Vocabulário.** O código chama de *projeto* o que o painel chama de
> *evento* — é o mesmo registro (a chave `events` do KV). Os dois nomes
> aparecem: "Eventos" na navegação, "Abrir a página do projeto" no menu,
> `cardProjetoPainel` e `#h-projetos` no código. Não procure diferença.

## Sumário

- [1. Para quem e por quê](#1-para-quem-e-por-quê)
- [2. O mapa](#2-o-mapa)
- [3. Navegação: computador e celular](#3-navegação-computador-e-celular)
- [4. Eventos](#4-eventos)
- [5. O card: uma função, dois lados](#5-o-card-uma-função-dois-lados)
- [6. O formulário de evento](#6-o-formulário-de-evento)
- [7. Pedidos de remoção](#7-pedidos-de-remoção)
- [8. Métricas](#8-métricas)
- [9. Ajustes](#9-ajustes)
- [10. Endpoints: o que a página chama](#10-endpoints-o-que-a-página-chama)
- [11. A página por dentro](#11-a-página-por-dentro)
- [12. Acessibilidade](#12-acessibilidade)
- [13. Celular: as decisões](#13-celular-as-decisões)
- [14. Segurança e cota](#14-segurança-e-cota)
- [15. Como verificar](#15-como-verificar)
- [16. Armadilhas](#16-armadilhas)
- [17. Pendências e limitações conhecidas](#17-pendências-e-limitações-conhecidas)
- [18. Histórico do redesenho](#18-histórico-do-redesenho)
- [Documentos relacionados](#documentos-relacionados)

---

## 1. Para quem e por quê

O painel tem **um usuário**: o dono, sozinho, e mais pelo celular do que pelo
computador — no evento, logo depois de entregar as fotos. Foi esse o pedido
que originou o redesenho (#220, aberto em 29/09/2026): o painel tinha crescido
por acréscimo e, no celular, "dava para usar, mas não era confortável".

O que ele guarda é o que o site mostra (eventos, categorias, selo de agenda)
mais dados pessoais (pedidos de remoção, com e-mail e telefone, e o log de
consentimento). Por isso: falha fechado, não é indexável, nada fica em cache
(`Cache-Control: no-store`) e "Sair" manda o navegador limpar o que guardou
(`Clear-Site-Data`). Sessão e senha estão no README, em "Autenticação e
segurança"; o portão de CSRF, em "Rotas HTTP".

O que o painel **não** faz: não hospeda fotos (ficam no Drive; o site só guarda
o link), não edita imagem e não tem mais de um usuário.

### O que o redesenho decidiu

| Decisão | Por quê |
| --- | --- |
| **Navegação de app**: barra de baixo no celular, lateral no computador | O polegar alcança a barra de baixo; abas no topo exigiam rolar de volta |
| **Uma coisa por bloco**: cada bloco tem título, uma frase do que faz e os controles | Antes, "Config." misturava agenda, categorias, backup, planilhas e senha numa rolagem só |
| **O estado é escrito, não colorido**: selos "Destaque", "Oculto", "Atrasado"… | A cor de um ícone exige lembrar o código — e não diz nada a quem não distingue cores |
| **Ação com rótulo; o resto no menu "⋯"**, com a exclusão separada | Eram seis botões de ícone do mesmo tamanho, sem rótulo (só `title`), e o de excluir ficava ao lado do de duplicar |
| **Formulário em blocos recolhíveis**, o essencial primeiro | ~20 campos numa coluna só: chegar em "Acesso" ou "Prazo e status" era rolar por tudo |
| **Ação destrutiva ou global pede digitar** | Um toque errado no celular não pode apagar um evento nem trocar a senha |
| **O servidor não mudou**: mesmos endpoints, mesmos ids, nenhuma escrita a mais no KV | É redesenho de interface, não de dados — e a cota de escrita é de 1000/dia (`TODO.md`, "Plano gratuito") |
| **Nada de handler inline** | A CSP estrita depende disso (`RETOMADA.md` §5.1): tudo por listener delegado (`data-onclick`, `data-action`) |

---

## 2. O mapa

| Navegação | `data-tab` | Seção | O que tem | O que carrega |
| --- | --- | --- | --- | --- |
| **Eventos** | `events` | `#tab-events` | filtros, lista de cards, "Selecionar vários"; o formulário (§6) abre por cima | nada: a lista já vem no HTML e em `events` no script |
| **Pedidos** | `requests` | `#tab-requests` | pedidos de remoção, um bloco por evento | `GET /api/removal-requests`, **já na abertura da página** (o selo da navegação precisa da contagem) |
| **Métricas** | `metrics` | `#tab-metrics` | filtros, números do período, gráficos (acessos por dia, dia da semana, portão), projetos do período, total desde o início | `GET /api/metrics` e `GET /api/metrics/diario?dias=180` **a cada vez** que a seção abre (e no "Atualizar") |
| **Ajustes** | `settings` | `#tab-settings` | Site, Dados, Conta e Sobre | nada: o selo de agenda vem no HTML e as categorias, em JSON no script |

```
Eventos
  cabeçalho ........ título · contagem · [Selecionar vários] · [+ Novo evento]
  bloco de filtros . busca · categoria · chips de status
  barra de seleção . (só no modo "Selecionar vários")
  lista ............ um card por evento
Pedidos
  um bloco por evento ... pendentes em cima · "N resolvidas" recolhido
Métricas
  filtros .......... período (7 · 30 · 90 dias) · projeto
  resumo ........... Visitas · Abriram o Drive · Taxa de abertura · Hoje
  Acessos por dia .. gráfico de linhas · "Ver como tabela" · CSV
  Dia da semana .... média de visitas por dia da semana
  Portão ........... Como passaram pelo portão (Verificação automática · Código por e-mail · Sem JavaScript)
  Projetos ......... Projetos no período (ordem: Visitas · Abriram o Drive · Taxa)
  Total ............ Total desde o início: nota ("visitante único por hora") · tabela Projeto · Visitas · Drive · Taxa
Ajustes
  Site ............. Selo de agenda · Categorias
  Dados ............ Backup dos dados · Exportar planilhas · Restaurar backup (sensível)
  Conta ............ Trocar a senha do painel (sensível)
  Sobre ............ Versão do site e o que ela trouxe (só leitura)
Formulário de evento (folha por cima de tudo)
  Básico · Fotos e Drive · Vídeo · Acesso e LGPD · Prazo e status · Página do projeto
```

**Como a página nasce.** O servidor entrega o HTML com a lista de eventos **já
desenhada** (primeira pintura sem esperar o JS), os eventos e as categorias como
JSON dentro do script (`let events = …`, com as notas privadas — mais um motivo
para o `no-store`) e o resto do script. O JS então liga os tratadores,
redesenha a lista, carrega os pedidos (para o selo), reabre o formulário se
houver rascunho de uma sessão que expirou (§6) e volta para a seção em que o
dono estava (§3).

---

## 3. Navegação: computador e celular

**Uma `<nav>` só.** As quatro seções são botões de uma única `<nav class="nav">`.
No computador ela mora numa barra lateral; no celular, a *mesma* nav vira a
barra de baixo — onde o polegar alcança — e a marca, com "Ver site" e "Sair",
fica numa barra de cima. Quem muda de lugar é o CSS: o HTML tem um elemento só,
então não há dois "Sair" nem duas listas de seções para manter sincronizadas
(`tests/painel.test.js` confere: uma nav, uma saída).

| Largura / condição | O que muda |
| --- | --- |
| celular (sem media query) | barra de cima `sticky` (marca, "Ver site", "Sair") e nav `fixed` embaixo, em quatro colunas; o conteúdo reserva 88 px embaixo para a nav não cobrir o último bloco; o toast sobe para ficar acima dela |
| `min-width: 600px` | o formulário vira diálogo centralizado (`88vh`, cantos arredondados nos quatro lados) em vez de folha colada embaixo (`92vh`) |
| `min-width: 700px` | filtros em duas colunas; card em três colunas (miniatura, texto, ações à direita); menu "⋯" como lista suspensa |
| `max-width: 699px` | menu "⋯" como folha de baixo, com fundo escuro (`#menu-fundo`) e itens de 48 px (§13) |
| `min-width: 900px` | barra lateral: grade de 232 px + conteúdo; marca em cima, nav na vertical, "Ver site"/"Sair" e a versão do site no pé; blocos de Ajustes em duas colunas; toast a 1,5 rem da borda de baixo, centralizado na janela (sem a nav por baixo) |
| `max-width: 899px` | campos com `font-size: 16px` (§13) |
| `pointer: coarse` | alvos de toque de 44 px, campos inclusive (§13) |
| `prefers-reduced-motion` | transições e animações desligadas |

A barra lateral é `position: sticky` com `height: 100vh` numa grade de duas
colunas — fica sempre à vista, e na prática não se distingue de uma `fixed`. A
barra de baixo do celular é `fixed` de verdade.

**A seção aberta é lembrada.** `switchTab()` grava o nome da seção no
`sessionStorage` (`painel:secao`) e, na carga, `voltaParaSecao()` volta para
ela. Recarregar a página — ou o reload automático de 1,8 s depois de restaurar
um backup — não manda mais o dono de volta para Eventos. É `sessionStorage` e
não `localStorage` de propósito: morre com a aba, e "Sair" o apaga junto (a
resposta do logout leva `Clear-Site-Data: "cache", "cookies", "storage"`;
conferido no Chromium: depois do "Sair", o `sessionStorage` está vazio — a
seção, o período das Métricas e o rascunho já não existem).

**O selo de Pedidos.** `#requests-badge` fica dentro do botão de Pedidos. O
script só troca o número — `loadRequests()` roda na abertura da página e depois
de cada pedido resolvido, então a contagem aparece sem o dono abrir a seção — e
esconde o selo (atributo `hidden`) quando não há pendentes. Até a v2.0, com zero
pendentes, o `display` da classe vencia o `hidden` e o selo vazio aparecia; a
regra `[hidden]{display:none!important}` resolveu (§16).

---

## 4. Eventos

### 4.1 Cabeçalho e filtros

O cabeçalho tem o título, a contagem (`#evt-count`), **Selecionar vários**
(`#mass-toggle`) e **+ Novo evento**. Logo abaixo, **um bloco só** com três
filtros que se combinam (E lógico) e rodam inteiros no navegador, sobre o array
`events` já carregado — nenhuma chamada:

- **Busca** (`#evt-search`): título, URL (slug) ou categoria; ignora
  maiúsculas, mas acento conta.
- **Categoria** (`#category-filter`): "Todas as categorias" ou uma da lista.
- **Chips de status** (`#status-filter`): Todos, Ativos (tudo menos arquivados),
  Em edição, Em revisão, Entregues, Arquivados. São botões com `aria-pressed`,
  só um pressionado; no celular rolam de lado. Antes era um `<select>`: abrir a
  lista e escolher, dois passos em vez de um.

A ordem é a do site — destaque primeiro, depois data decrescente (`byDate()`
espelha `eventTime()` do servidor). A primeira pintura do servidor já usa o
recorte padrão ("Todos"), para a lista não mudar de tamanho quando o script
assume.

| Situação | Texto sob o título | Lista vazia diz |
| --- | --- | --- |
| com busca | "N evento(s) encontrado(s)" | `Nenhum evento encontrado para "<busca>".` — a busca aparece aparada e em minúsculas, como foi comparada |
| chip Todos | "N evento(s)" | `Nenhum evento ainda. Toque em "Novo evento" para criar o primeiro.` |
| chip Ativos | "N evento(s) ativo(s)": "1 evento ativo", "3 eventos ativos" | `Nenhum evento ativo — todos foram arquivados.` |
| chip de um status | "N evento(s) (Em edição)" | `Nenhum evento com status "Em edição".` |
| categoria escolhida, sem busca | o mesmo do chip, contando só a categoria | a combinação: `Nenhum evento na categoria "X".`, `Nenhum evento ativo na categoria "X".` ou `Nenhum evento com status "Em edição" na categoria "X".` |

A contagem é sempre a da lista que aparece, com a categoria já aplicada. Na
lista vazia, a busca manda: com busca, a frase é a da busca; sem busca e com
categoria, é a da combinação; só sem os dois valem as frases dos chips.

### 4.2 O card

Cada evento é um card (`.evt-item`, `id="evt-<id>"`), desenhado por
`cardProjetoPainel()` (§5):

| Parte | O que mostra |
| --- | --- |
| Miniatura | `thumbnailUrl` (64 × 64 px); sem capa, um ícone de câmera; imagem que falha ao carregar some (`data-onerror="hide"`) |
| Título | `title`, uma linha, com reticências |
| Linha de meta | `/slug · dd/mm/aaaa · categoria · prazo dd/mm`, uma linha, com reticências (no celular, categoria e prazo podem ficar cortados). A data do evento é um dia de calendário: vira dd/mm/aaaa **por texto**, sem passar por `Date`, que a moveria de fuso. O "prazo" só aparece enquanto o evento não está entregue nem arquivado |
| Selos | o estado, escrito (tabela abaixo) |
| **Editar** | abre o formulário preenchido |
| **Galeria** | link para `/galeria/<slug>`, na mesma aba — a [galeria própria](../README.md#galeria-própria-prévia-só-o-dono), prévia que só o dono vê |
| **⋯** | o menu "Mais ações" (§4.3) |
| Caixa de seleção | só no modo "Selecionar vários", antes da miniatura (`aria-label="Selecionar <título>"`) |

| Selo | Aparece quando | Classe |
| --- | --- | --- |
| Em edição, Em revisão, Entregue, Arquivado | sempre (o status; `entregue` quando falta; um status desconhecido, vindo de um backup, aparece como texto cru, nunca como "undefined") | `st-<status>` |
| Atrasado | `promisedDate` já passou **em São Paulo** e o status não é entregue nem arquivado | `st-atrasado` |
| Destaque | `pinned` | `st-destaque` |
| Oculto | `visible === false` (o card também fica esmaecido) | `st-oculto` |
| Em breve | `comingSoon` | `st-embreve` |
| Privado / Familiar | `accessType` é `private` / `family` (o público não ganha selo) | `st-acesso` |

"Hoje" é o de São Paulo, não o do navegador nem o UTC (#192): o servidor usa
`hojeEmSaoPaulo()` de `utils.js`, e o script tem uma cópia presa à do servidor
por `tests/security.test.js` ("pares cliente/servidor"); `tests/fuso.test.js`
prende o lado do servidor (a função e o selo "Atrasado" da primeira pintura às
22:30). Sem isso, um evento aparecia "Atrasado" às 21:00 do próprio dia
prometido.

### 4.3 O menu "⋯"

| Item | `data-action` | O que faz | Chamada |
| --- | --- | --- | --- |
| Destacar na galeria / Remover destaque | `pin` | alterna `pinned` | `PUT /api/events/<id>` com `{ pinned }` |
| Ocultar da galeria / Mostrar na galeria | `vis` | alterna `visible` | `PUT /api/events/<id>` com o evento inteiro e `visible` invertido |
| Abrir a página do projeto | — (link `/<slug>`, nova aba) | abre a página pública | nenhuma |
| Duplicar | `dup` | abre o formulário de "novo evento" preenchido | nenhuma até salvar (`POST /api/events`) |
| Excluir… | `del` | pede digitar o título; depois exclui | `DELETE /api/events/<id>` |

O que cada ação significa de verdade:

- **Ocultar não tira a página do ar**: "não visível" é *não listado*. O projeto
  some da galeria, do sitemap e da auditoria, mas segue abrindo por link direto
  (com `noindex`) — de propósito, para as prévias já enviadas a clientes
  continuarem funcionando (`handleEventPage`). O card ganha o selo "Oculto".
- **Destacar não limita a um**: o servidor não desmarca os outros destaques
  (há teste: "criar um projeto destacado não desfaz o destaque anterior"). A
  galeria só dá o layout de largura cheia quando existe **exatamente um**; com
  mais de um, todos vão para o começo da grade com a etiqueta "Em destaque".
- **Duplicar** copia tudo menos: título (ganha " (cópia)"), slug (fica em
  branco: precisa ser único), `pinned` (um clone não deve herdar o destaque em
  silêncio) e `promisedDate`. Nada é criado até o dono salvar.
- **Excluir** apaga o evento **e os contadores dele** (`views:<slug>`,
  `drive_clicks:<slug>`), para um projeto novo que reaproveite o slug não herdar
  números. Não há desfazer; o backup é a rede de segurança.

**Comportamento do menu.** Abre com o foco no primeiro item. Setas para cima e
para baixo andam entre os itens (dando a volta); `Esc` fecha e **devolve o foco**
ao "⋯" que abriu; `Tab`, clique fora (inclusive no fundo escuro), trocar de
seção ou redesenhar a lista também fecham. Só um menu fica aberto por vez
(`menuAberto`). Enquanto uma ação do card corre (destacar, ocultar, excluir),
os botões dele ficam desabilitados (`setRowBusy`). Marcação: `aria-haspopup`,
`aria-expanded`, `role="menu"`, `role="menuitem"`, `role="separator"`.

### 4.4 Selecionar vários

"Selecionar vários" liga o modo de seleção (`massMode`): cada card ganha uma
caixa, e aparece a barra com **Todos** (marca os cards visíveis), a contagem,
um select de categoria + **Aplicar categoria** e um select de acesso +
**Aplicar acesso**. Aplicar chama `POST /api/events/bulk-category`
(`{ ids, category }`) ou `POST /api/events/bulk-access` (`{ ids, accessType }`)
e **pede digitar a quantidade** de eventos selecionados. Depois, o modo se
desliga e o toast diz quantos mudaram — o servidor só conta quem de fato mudou
de valor. "Cancelar seleção" desmarca tudo.

A seleção só tem o que está **à vista**. Um filtro ou uma busca que esconde um
card tira ele da seleção (`renderEventList()` poda `selectedIds` a cada
redesenho), e a quantidade a digitar na confirmação é a da lista que aparece.
Antes, a seleção sobrevivia ao filtro: o dono via 1 card e a confirmação falava
em 5. Ao redesenhar, `#mass-selall` fica marcado só se todo card visível está
marcado.

---

## 5. O card: uma função, dois lados

### Por quê

A lista de eventos é desenhada **duas vezes**: pelo servidor (a primeira
pintura, sem esperar o JS) e pelo script da página (depois de cada ação, busca
e filtro). Até out/2026 eram dois templates escritos à mão, e cada mudança no
card tinha de cair nos dois — o comentário do CSS antigo admitia consertar "só
no CSS" justamente para não mexer duas vezes. É a família de bugs que o
`TODO.md` descreve em "Uma regra escrita duas vezes é corrigida uma vez só".

Agora há **uma função**, `cardProjetoPainel(e, h, marcado)`, exportada de
`src/ui/dashboard.js`:

| Parâmetro | O que é |
| --- | --- |
| `e` | o evento |
| `h` | os ajudantes do lado que chama: `esc`, `safeUrl`, `rotulo(status)`, `atrasado(evento)` e `icones` |
| `marcado` | `null` fora do modo de seleção; no modo, `true`/`false` diz se a caixa vem marcada |

- **Servidor.** `dashboardHTML()` chama `cardProjetoPainel(e, ajudaServidor, null)`
  para cada evento. `ajudaServidor` usa `escape`/`safeUrl` de `utils.js` e a
  `isOverdue` do servidor.
- **Navegador.** O script da página recebe o **código** da função, por
  `Function.prototype.toString()`, entre parênteses:
  `const cardProjeto = (<código>);`. Ela é chamada com `ajudaCard`: cópias de
  `esc` e `safeUrl` do próprio script, presas às do servidor pelos pares de
  `tests/security.test.js`, e uma `isOverdue` que usa a cópia de
  `hojeEmSaoPaulo` (essa também presa). A `isOverdue` e os rótulos de status
  do script são comparados com os do servidor em `tests/painel-pares.test.js`.
  Os ícones (`ICONES`, SVG em linha, herdam a cor do texto) vão como dado
  (`jsonParaScript`): o card redesenhado no navegador usa exatamente os mesmos
  desenhos.

Os parênteses importam: fazem do texto uma *expressão*, cujo valor vai para
`cardProjeto`. O nome que o bundler tenha dado à função (ele pode renomeá-la) não
importa — o script nunca a chama por ele.

### As duas regras

**1. Nada de fora dela.** No navegador não existe o escopo do módulo. Tudo o
que a função usa chega pelo parâmetro `h`. Uma referência solta a algo do
módulo (`escape`, `ICONES`, `STATUS_LABELS_SSR`…) funciona no servidor e estoura
no navegador, no primeiro redesenho. O bundler também pode renomear o que é de
fora (hoje o deploy não minifica, mas nada impede que passe a minificar).

**2. Nenhuma função que ganhe nome lá dentro.** O wrangler empacota com esbuild
e `keepNames`: toda função que ganha nome é embrulhada num `__name(fn, "nome")`,
e `__name` é um auxiliar definido **no topo do bundle**:

```js
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
```

O navegador não tem esse auxiliar. Um card com uma função nomeada dentro dava
`ReferenceError: __name is not defined` no primeiro redesenho. O que o esbuild
embrulha (testado com o esbuild do wrangler):

| Dentro do card | Com `keepNames` |
| --- | --- |
| `function f() {}` | embrulha em `__name` |
| `const f = () => …` ou `const f = function () {}` | embrulha |
| propriedade de objeto, `{ f: x => … }` | embrulha |
| `.map(x => …)`, função anônima passada como argumento, IIFE | não embrulha (não ganha nome) |
| nenhuma função | — |

O card de hoje não tem função nenhuma lá dentro: só concatenação de texto,
`push` e `join`. Os itens do menu, por exemplo, partem de um **texto**
(`itemMenu`, o começo comum do `<button>`), não de um auxiliar. Precisa de um
auxiliar? Ele entra em `h`, nos dois lados (`ajudaServidor` em `dashboardHTML` e
`ajudaCard` no script).

O `__name(cardProjetoPainel, "cardProjetoPainel")` que o esbuild põe **depois**
da função é um comando à parte: o `toString()` devolve só o texto da função,
sem ele.

### O quase-acidente

A primeira versão do card montava os itens do menu com um auxiliar,
`const item = (…) => …`, dentro dele. A suíte inteira passou — ela roda o fonte
cru, sem empacotar — e o painel em produção quebraria no primeiro redesenho.
Foi pego **montando o bundle de verdade**, não por teste nenhum:

```bash
npx wrangler deploy --dry-run --outdir /tmp/bundle   # não publica nada
grep -n "function cardProjetoPainel" /tmp/bundle/index.js
```

Entre `function cardProjetoPainel(` e o `__name(cardProjetoPainel, …)` que vem
depois do fecha-chaves, não pode haver outro `__name(`. (O bundle tem centenas
de usos de `__name`; nenhum dentro do card.) É a lição do `TODO.md`, "O que
roda em produção é o bundle, não o fonte".

### Como os testes prendem isso

`tests/painel.test.js`, no bloco "card de evento: uma função só":

1. **o script da página leva o código da função, inteiro** (`const cardProjeto = (…);`);
2. **o texto injetado roda sozinho**, via `new Function`, sem o escopo do módulo,
   e devolve o mesmo card que o servidor, em todos os ramos (16 variações:
   destaque, oculto, em breve, privado, familiar, atrasado, arquivado, sem capa,
   `javascript:` na capa, data lixo, dado hostil…) e nos três estados de
   `marcado`;
3. **sobrevive ao empacotamento do deploy**: o teste passa o card pelo
   `transformSync` do **esbuild que o próprio wrangler usa** (resolvido a partir
   do wrangler, para acompanhar se um dia as versões divergirem), com
   `keepNames`, exige que não haja `__name(` dentro do corpo e roda o resultado
   isolado;
4. **o servidor desenha a lista com a mesma função**.

### Mudando o card

1. Edite só `cardProjetoPainel`. Use `h.*` e concatenação de texto; nenhuma função.
2. Dado que vem do evento entra **sempre** por `h.esc(...)`; URL, por
   `h.esc(h.safeUrl(...))` — `esc()` fecha o atributo, mas só `safeUrl()` mata o
   esquema `javascript:`, e um backup restaurado pode trazer um (§14).
3. O CSS do card está no `<style>` de `dashboardHTML`.
4. Ramo novo? Acrescente uma variação em `VARIACOES` e uma asserção de conteúdo
   em `tests/painel.test.js`.
5. `npx vitest run tests/painel.test.js`; depois
   `VERIFICA_PRINTS=/tmp/prints npm run verifica:painel` e **olhe as capturas**
   (§15).

---

## 6. O formulário de evento

### 6.1 Anatomia

Uma folha (`#overlay` → `#sheet`, `role="dialog"` `aria-modal="true"`) por cima
da página: cabeçalho com o título ("Adicionar evento" / "Editar evento") e o
fechar, corpo rolável e rodapé **fixo** com **Cancelar** e **Salvar**
(`#submit-btn`). O corpo tem os atalhos e os seis blocos.

Os campos estão em seis `<details class="bloco-form">`. Dois abertos (o
essencial) e quatro recolhidos; **todo formulário abre igual**, e o corpo rola
para o topo (a folha guardava a rolagem anterior).

| Bloco (`id`) | Título | Aberto | Campos |
| --- | --- | --- | --- |
| `bf-basico` | Básico | sim | `f-slug`, `f-title`, `f-date`, `f-category`, `f-long` |
| `bf-fotos` | Fotos e Drive | sim | `f-drive`, lista de capas, `f-drive-ig` |
| `bf-video` | Vídeo | não | `f-youtube`, `f-youtube-mais`, `f-drive-videos` |
| `bf-acesso` | Acesso e LGPD | não | `f-access`, `f-visible`, `f-comingsoon` |
| `bf-producao` | Prazo e status | não | `f-status`, `f-promised`, `f-notes` |
| `bf-pagina` | Página do projeto | não | `f-credits`, `f-purl`, `f-alert-active`, `f-alert-kind`, `f-alert-expires` |

- **Atalhos** (chips no topo, `irParaBloco`): abrem o bloco e rolam até ele. No
  celular, rolar até "Acesso" ou "Prazo e status" era o que mais cansava.
- **Resumo ao vivo** (`atualizaResumos`): o bloco recolhido mostra o essencial
  na própria linha — `/slug`; "pasta ligada · 2 capas"; "2 vídeos"; "Público ·
  oculto · em breve"; "Em edição · prazo 20/11"; "aviso de novidade ligado". Some
  quando o bloco abre.
- **Erro de validação** (`mostraCampo`): abre o bloco do campo e põe o foco nele
  — senão o aviso falaria de algo que não está à vista.
- **Rótulos**: todo `<label>` tem `for=` apontando para o campo (os toggles usam
  o `<label class="toggle">` em volta). A lista de capas, que não é um campo só,
  é um `role="group"` nomeado por "Fotos de capa".
- **Teclado**: `Esc` fecha, `Ctrl/⌘+Enter` salva, e o foco fica preso na folha
  (Tab e Shift+Tab dão a volta, inclusive pelos `summary`). Ao fechar, o foco
  volta a quem abriu.
- **Evento novo**: o foco vai para o slug 100 ms depois de abrir — se ninguém
  já estiver num campo da folha (§16).
  **Edição**: o slug é somente leitura — o servidor aceitaria a troca, mas o
  painel não oferece.

### 6.2 Os campos e o que o servidor faz com eles

| Campo | Payload | Servidor (`normalizeEventFields`) |
| --- | --- | --- |
| `f-slug` | `slug` | `validateSlug`: ≤ 60, minúsculas, números e hífen, sem hífen nas pontas, não reservado (`sobre`, `api`, `galeria`…); único (409) |
| `f-title` | `title` | ≤ 200; obrigatório na criação |
| `f-date` | `date` | `AAAA-MM-DD` ou vazio |
| `f-category` | `category` | um nome da lista de categorias, ou o vazio ("Sem categoria", que tira a categoria do evento); um nome fora da lista mantém o valor anterior |
| `f-long` | `longDescription` | ≤ 5000 |
| `f-drive` | `driveUrl` | `https://` (`toHttps`), ≤ 2000; obrigatório na criação |
| lista de capas | `photos` e `thumbnailUrl` (= a primeira) | até 6, `toHttps` em cada. Na edição a capa segue a lista: esvaziá-la tira a capa; um `PUT` sem `photos` (o "Destacar") não mexe nela |
| `f-drive-ig` | `driveUrlInstagram` | `toHttps` |
| `f-youtube` | `youtubeId` | só o ID de 11 caracteres (`youtubeIdFrom`); link que não é do YouTube vira vazio |
| `f-youtube-mais` | `youtubeMais` | uma linha por vídeo; até 5, sem repetir; `vertical` no fim da linha ou link de Shorts marca vertical (`youtubeMaisFrom`) |
| `f-drive-videos` | `driveUrlVideos` | `toHttps`; o selo "Vídeos" da galeria aparece com esta pasta ou com `f-youtube` preenchidos, e nunca em projeto "Em breve" |
| `f-access` | `accessType` | `public`, `private` ou `family` |
| `f-visible` | `visible` | `!== false` |
| `f-comingsoon` | `comingSoon` | `=== true` |
| `f-status` | `status` | um dos quatro; senão o anterior |
| `f-promised` | `promisedDate` | `AAAA-MM-DD` ou vazio; nunca aparece em página pública |
| `f-notes` | `internalNotes` | ≤ 5000; só o painel vê |
| `f-credits` | `eventCredits` | ≤ 200 |
| `f-purl` | `projectUrl` | `toHttps`, ≤ 2000 |
| `f-alert-active`, `f-alert-kind`, `f-alert-expires` | `photosAlert` | `normalizePhotosAlert`: ativo, `addedAt`, horas (0 = não expira; teto de 1 ano) e tipo (`fotos` / `videos`) |

O `pinned` **não** está no formulário: é o item "Destacar" do menu.

**Fotos de capa.** Até 6 (`photoList`); a primeira é a "capa da galeria", com
pré-visualização maior. "Colar vários links" abre uma caixa de texto, um link
por linha, e respeita o limite (o toast diz quantos entraram). Links do Drive
(`/file/d/…`, `/open?id=…`, `/uc?…id=…`) viram `lh3.googleusercontent.com/d/<id>`
ao sair do campo (`convertDriveUrl`) e de novo ao salvar. O contrato de
`convertDriveUrl` é que tudo que ela produz sobreviva ao `toHttps()` do
servidor — senão o painel salvaria um link que a página pública descarta.

O formulário manda a lista inteira e `thumbnailUrl: photos[0] || ''`, e o
servidor faz a capa seguir a lista: tirar a última foto e salvar tira também a
capa do evento (a foto retirada não fica no card da galeria nem no topo da
página do projeto). Duas exceções, de propósito: um `PUT` sem `photos` (o
"Destacar") não mexe na capa, e o registro antigo que só tem `thumbnailUrl`, sem
fotos na lista, a mantém quando o painel devolve o evento inteiro (o
"Ocultar"). O teste é `tests/index.test.js`, "editar as fotos de capa".

**Aviso de novidade.** O toggle `f-alert-active` mostra o tipo ("Novas fotos" /
"Novos vídeos") e a expiração (nunca, 1, 6, 24, 48 ou 168 h). O relógio **não
reinicia** ao salvar de novo um aviso que já estava ativo (o formulário guarda
`wasActive` ao abrir e reaproveita o `addedAt`). **Desligar e religar na mesma
edição reinicia** ao salvar, como a dica do campo promete ("Ao reativar o aviso,
o contador reinicia."): desligar zera o `wasActive`, sem precisar salvar o
"desligado" no meio. Por isso desligar e religar já conta como alteração
(fechar pergunta "Descartar alterações?") e vai no rascunho da sessão que
expirou (§6.3).

**Validação do cliente.** Slug (`/^[a-z0-9][a-z0-9\-]*$/`), título e pasta do
Drive são obrigatórios; slug repetido é recusado antes de ir ao servidor. A
checagem do cliente é **mais frouxa** que a do servidor (aceita hífen no fim e
não conhece os slugs reservados): quem decide é o servidor, e o toast mostra a
mensagem dele ("URL inválida.", "A URL /sobre já é uma página do site. Escolha
outra."). O formulário continua aberto em qualquer erro.

**Depois de salvar.** A lista local é atualizada com o evento que o servidor
devolveu e redesenhada, a folha fecha sem pedir confirmação e o toast diz
"Evento adicionado! O site mostra em até 1 min." / "Evento atualizado! O site
mostra em até 1 min.". Esse prazo é o da página pública: até 30 s do cache de
cada isolate, mais até 30 s para o KV chegar aos outros locais da Cloudflare
(`cacheTtl: 30` nas leituras públicas) — por isso o aviso diz o prazo, e não só
"salvo". Se o link do YouTube não foi
reconhecido, o servidor o guardou vazio — um segundo toast avisa, no lugar do
"salvo", para o dono não achar que o vídeo está na página. O mesmo vale para
"Mais vídeos": se o servidor guardou menos links do que foram enviados (até 5)
— link não reconhecido ou repetido —, o toast diz "Salvo, mas algum link em
"Mais vídeos" não foi reconhecido (ou repetiu). Confira a lista."

### 6.3 Sujo, rascunho e `beforeunload`

`snapshotForm()` serializa os campos; `formSnapshot` guarda o valor de quando a
folha abriu. É a diferença entre os dois que define "sujo" (`isFormDirty()`):

- **Fechar sujo** (Esc, clique fora, "Cancelar" ou o ×) pede "Descartar
  alterações?". Fechar depois de salvar não pede.
- **Fechar a aba** (ou recarregá-la) com o formulário sujo dispara o aviso
  nativo "Sair do site?" (`beforeunload`) — menos na saída para o login de uma
  sessão expirada, em que o rascunho já foi guardado (abaixo).
- **Sessão expirada no meio da edição.** `api()` recebe 401, guarda o rascunho
  com `stashDraft()` — que grava o instantâneo em `sessionStorage`
  (`fotos:draft`), só se o formulário estiver aberto e sujo — e manda para o
  login. Quando guardou, o aviso nativo de saída **não** aparece
  (`saindoComRascunho`; o `beforeunload` só pergunta se o rascunho não foi
  guardado): as alterações voltam sozinhas. Depois de entrar, `restoreDraft()`
  reabre o formulário com o que estava digitado — inclusive o "desligar e religar
  o aviso de novidade" — e avisa ("Sua sessão tinha expirado. Recuperei o que
  você estava editando."). O rascunho vale 1 h, é de uma tentativa só (se falhar,
  não insiste), é descartado se o evento foi apagado nesse meio-tempo e **não
  atualiza** o `formSnapshot` — ele é justamente "alterações não salvas", e
  fechar sem salvar continua pedindo confirmação. É `sessionStorage` e não
  `localStorage` porque o rascunho pode ter notas internas e deve morrer com a
  aba. Volta tudo; o slug, só num evento novo (na edição ele é só leitura, e o
  `openForm` já o preencheu). Só `api()` faz isso: o CSV de
  consentimentos e o backup não passam por ela (§10), mas o backup chama o mesmo
  `vaiParaOLogin()` no 401. Ajustes sujo continua pedindo o "Sair do site?" mesmo
  nessa saída (§9). (Conferido no Chromium
  pelo `verifica:painel`, §15.2: abre um evento, religa o aviso, escreve uma
  nota, apaga a sessão no servidor e salva — vai ao login sem o "Sair do
  site?" —, entra de novo e a edição volta; salvar grava a nota e reinicia o
  contador.)

### 6.4 Acrescentar um campo: o passo a passo

Os quatro lugares do formulário espelham uns aos outros, e o comentário em
`snapshotForm` já pede: "keep the two in sync when adding a field". Um campo que
entra no `submitForm` e esquece o `snapshotForm` salva certo, mas não conta como
alteração (fechar sem salvar não avisa) e some do rascunho.
`tests/painel-pares.test.js` prende as quatro funções entre si e contra o HTML
do formulário (todo `id="f-…"`): esquecer o campo novo em qualquer uma reprova.
Esta é a lista:

**Servidor.** Sem isto, o campo é descartado em silêncio: `normalizeEventFields`
só copia o que conhece.

1. `DEFAULT_EVENT` (`src/config.js`): o valor inicial — e o de projetos antigos
   que não têm o campo.
2. `normalizeEventFields` (`src/index.js`): normalização e teto. Criar e editar
   passam por ela.
3. Se o valor vira URL, id ou enum **e pode vir de um backup**:
   `sanitizeRestoredEvent` e as listas `RESTORE_*`. O restore não passa por
   `normalizeEventFields`.
4. Campo novo **ao lado** do antigo; nunca mude o formato de um existente. O
   deploy reverte sozinho quando o smoke reprova, e a versão anterior leria o
   formato novo errado — foi por isso que `youtubeMais` nasceu ao lado de
   `youtubeId` (#209).

**Cliente.** A tríade e o resto:

5. **HTML**: um `.field` dentro do bloco `bf-*` certo, com `<label for="f-novo">`
   (toggle: `<label class="toggle-label" for>` + `<label class="toggle">`). O
   teste confere que todo `for=` aponta para um `id` que existe, que não sobrou
   rótulo solto e que todo campo tem nome — o que não tem rótulo visível leva
   `aria-label` (§12).
6. **`openForm`** — preenche o campo, e dá o valor padrão do evento novo.
7. **`snapshotForm`** — entra no instantâneo: é o que decide "sujo" e o que vai
   para o rascunho.
8. **`submitForm`** — entra no `body` enviado.
9. **`restoreDraft`** — volta do rascunho.
10. **`atualizaResumos`** — se a mudança deve aparecer na linha do bloco
    recolhido.
11. **`cardProjetoPainel`** — só se o dono precisa ver o dado na lista (§5).
12. Usou uma propriedade de DOM nova no script? Acrescente-a em
    `tests/helpers/scripts-embutidos.d.ts`: o tsc dos scripts embutidos usa
    listas fechadas.

**Verificação.** `npx vitest run tests/painel.test.js tests/painel-pares.test.js tests/scripts-embutidos.test.js`,
`npm run verifica:painel` e, se o campo faz parte do que o dono faz no dia a
dia, um passo no roteiro.

Uma exceção, e uma ressalva: o **`pinned`** não está no formulário (o destaque
é pelo menu "⋯"); e o **slug** entra em `snapshotForm` (senão, num evento novo,
digitar só a URL e fechar não perguntava nada), mas o `restoreDraft` só o devolve num
evento novo — na edição ele é somente leitura.

---

## 7. Pedidos de remoção

Quem pede para tirar uma foto do ar (LGPD) usa o formulário da página pública
(README, "Sistema de solicitação de remoção"). Aqui o dono vê e responde.

**Agrupamento.** Um bloco por evento, com o título, o slug em monoespaçada e o
selo "N pendente(s)". Dentro do bloco, os pendentes ficam em cima e os
resolvidos ficam recolhidos sob um botão "▶ N resolvida(s)" (abre como "▼").
Os grupos seguem a ordem do pedido mais recente de cada evento. Sem nenhum
pedido: "Nenhum pedido de remoção ainda."

**Cada pedido** mostra: estado (pendente/resolvido), data, **Tipo** (Número da
foto, Link da foto ou Arquivo enviado), **Identificação**, nome do arquivo (o
arquivo em si só vai por e-mail; nunca fica no KV), **E-mail**, **Telefone**
(registro antigo, que só tem `contact`, mostra "Contato"), **Mensagem** e o
estado dos três e-mails: "aviso enviado ao seu e-mail" (ao dono), "confirmação
enviada" (ao solicitante) e "aviso de resolução enviado", em verde. Um status
que existe e não é `sent` aparece como o texto do erro, em vermelho (`error: …`
nos três; "skipped: RESEND_API_KEY não configurada" só no aviso ao dono). Nos
e-mails ao solicitante, status vazio (sem a chave do Resend, ou pedido sem
e-mail) não mostra nada.

**"Marcar como resolvido".** `PUT /api/removal-requests/<id>/resolve` marca o
pedido, grava `resolvedAt` e **envia o e-mail de resolução ao solicitante**
(assunto "Solicitação atendida — <título do projeto>"; só sai com
`RESEND_API_KEY` configurada e se o pedido tem e-mail). A ordem certa é: remover
a foto do Drive primeiro, resolver depois — o painel não remove nada, porque o
site nunca hospedou a foto. Depois da resposta, a lista é recarregada e o selo
da navegação atualiza sozinho.

- O botão fica desabilitado enquanto a requisição corre: um duplo clique
  mandava dois `PUT` simultâneos, os dois liam o pedido ainda em aberto e a
  pessoa recebia dois e-mails.
- O servidor também protege a repetição em sequência: resolver um pedido que já
  está resolvido devolve o gravado, sem reenviar nada.
- Se o KV recusar a gravação (cota), a resposta diz se o e-mail já saiu — o dono
  não resolve de novo às cegas.
- A franquia de e-mail (Resend) é a mais apertada depois do KV (`TODO.md`); cada
  resolução gasta um.

Os pedidos são carregados na abertura da página (para o selo) e recarregados a
cada resolução. Falha ao carregar: "Erro ao carregar solicitações." na seção.

---

## 8. Métricas

Desde a v2.0 (#215) a seção é um painel de gráficos. Ela faz **duas leituras em
paralelo**, cada uma com o seu erro — uma falhar não apaga a outra da tela —, ao
abrir e a cada **↻ Atualizar** (que não é automático: uma leitura de minuto em
minuto renovaria a sessão para sempre, e o painel esquecido aberto nunca cairia
por inatividade):

- `GET /api/metrics` — os **totais desde sempre**, uma linha por projeto
  (`{ slug, title, views, driveClicks }`, por visitas decrescentes);
- `GET /api/metrics/diario?dias=180` — a **série por dia**:
  `{ hoje, dias[], primeiroDia, projetos: { <slug>: { views[], driveClicks[] } }, gate: { turnstile[], email[], noscript[] }, gateTotal }`,
  com os dias de São Paulo. Projeto excluído não aparece (só slugs que existem).

**O filtro não pede nada ao servidor**: tudo o que muda com ele é recortado e
desenhado no navegador a partir daquela leitura de 180 dias. "atualizado às
HH:MM" (`#metrics-atualizado`) diz a hora da última leitura.

De cima para baixo, na ordem em que se lê:

1. **Filtros**, numa linha acima de tudo o que eles mudam: o período
   (`#metrics-periodo`: 7, 30 ou 90 dias, `aria-pressed`; 30 de início, e o
   escolhido volta ao recarregar — `sessionStorage`, chave `painel:periodo`) e
   o projeto (`#metrics-projeto`: "Todos os projetos" ou um, em ordem
   alfabética).
2. **Os números do período** (`#metrics-resumo`): **Visitas**, **Abriram o
   Drive**, **Taxa de abertura** (abriram ÷ visitas) e **Hoje** (visitas de
   hoje, com quantos abriram o Drive). Os três primeiros comparam com o período
   anterior de mesmo tamanho — "▲ 60% vs. 30 dias antes"; a taxa, em pontos
   percentuais; o leitor de tela ouve "alta de"/"queda de" no lugar da seta.
   Sem série por dia ainda (logo depois do deploy da v2.0), são três blocos com
   os totais "desde o início", como antes.
3. **Acessos por dia** (`#bloco-acessos`): um gráfico de linhas, **um eixo
   só**, com Visitas (azul) e Abriram o Drive (laranja), legenda com os totais
   e o pico marcado e escrito na descrição ("Pico: 64 visitas em dom, 04/10").
   O SVG é desenhado na largura medida — girar o celular redesenha.
   - **A cruz**: o ponteiro (mouse, dedo, caneta) mostra o dia e os dois
     números numa dica (`#dica-acessos`) que **nunca cobre o ponto que
     descreve** — vai ao lado da cruz; no celular, se não couber, acima do
     ponto mais alto, abaixo do mais baixo, no vão entre os dois ou, em último
     caso, acima do gráfico. No toque, a dica fica até tocar fora.
   - **Teclado**: com o gráfico em foco (`tabindex="0"`), ← e → andam um dia,
     Home e End vão às pontas, Esc esconde; cada passo é anunciado ao leitor de
     tela (`#acessos-anuncio`, `aria-live`).
   - **Antes da v2.0 não há dia**: a linha fica em branco (não é zero) e uma
     nota diz desde quando a contagem existe.
   - **Ver como tabela** (`#acessos-ver-tabela`, `aria-expanded`) abre
     `#acessos-tabela`, do dia mais recente ao mais antigo — o mesmo dado, para
     quem não lê gráfico.
   - **⬇ CSV**: `metricas-por-dia-AAAA-MM-DD.csv`, colunas `dia`, `slug`,
     `titulo`, `visitas`, `abriram_drive` — a série inteira que o painel tem,
     a partir do primeiro dia contado.
4. **Dia da semana** (`#grafico-semana`): a média de visitas de cada dia da
   semana no período, em sete colunas. "Dia mais movimentado: …" fica escrito
   embaixo (`#semana-leitura`, `aria-live`); tocar numa coluna lê o número
   dela.
5. **Como passaram pelo portão** (`#grafico-portao`): quantos acessos ao Drive
   o portão liberou por **modo de verificação** — Verificação automática
   (Turnstile), Código por e-mail e Sem JavaScript —, com a contagem e o %. É o
   número que faltava para calibrar os baldes depois de um evento (#230): muito
   "código por e-mail" ou "sem JavaScript" costuma ser bloqueador de anúncio ou
   rede que atrapalha a verificação. Vale para todos os projetos — a contagem
   (`gate:<modo>`) é só um número, sem projeto nem IP.
6. **Projetos no período** (`#metrics-ranking`): cada projeto com visitas,
   Drive e taxa, uma barra na ordem escolhida (`#metrics-ordem`: Visitas,
   Abriram o Drive, Taxa) e a curva das visitas por dia. **Tocar num projeto
   foca os gráficos nele** (`aria-pressed`, e a tela rola até o gráfico);
   tocar de novo volta a todos. No fim, quantos projetos não tiveram visita.
7. **Total desde o início** (`#metrics-body`): a tabela de antes da v2.0 —
   Projeto (título e `/slug`), Visitas (com uma barra proporcional atrás do
   número), Drive e Taxa; clicar no cabeçalho ordena (a primeira vez,
   decrescente; a segunda inverte; ▲/▼ e `aria-sort` dizem o sentido). Inclui o
   que o KV contava antes do Durable Object, por isso é maior que a soma dos
   dias. **⬇ CSV** (`#metrics-export`, escondido sem dados):
   `metricas-AAAA-MM-DD.csv`, colunas `title`, `slug`, `views`, `driveClicks`.
   A nota lembra: conta **visitante único por hora, não recarregamento** (cookie
   `fv_<slug>` de 1 h; HEAD e prefetch também não contam) — recarregar para
   testar não mexe no número, de propósito.

Estados: "Carregando…"; série que não carregou ("Não deu para carregar a
contagem por dia. Toque em “Atualizar”…", e o resto da seção segue com os
totais); nenhum dia contado ainda ("A contagem por dia começa com a versão
2.0…"); "Erro ao carregar métricas." (os totais); "Nenhuma visualização
ainda." (nenhum projeto).

**Do lado do servidor** (`src/counters.js`, `handleMetricsDiario` em
`src/index.js`): cada incremento soma também no balde do dia,
`d:<AAAA-MM-DD>:<chave do total>`, no **mesmo** Durable Object e na **mesma**
gravação do total — nenhuma chamada a mais por visita. A série é podada depois
de **400 dias** (`METRICAS_RETENCAO_DIAS`, uma vez por dia, no primeiro
incremento), e `?dias=` vai de 1 a 180 (`METRICAS_DIAS_MAX`; 90 se ausente).

**Testes**: as contas são funções puras do script da página — escala do eixo,
recorte por período e projeto, variação, pico, média por dia da semana, marcas
do eixo x, o desenho das linhas, colunas e da curva — e
`tests/metricas-painel.test.js` as tira do template e executa no node. O
servidor está em `tests/metricas.test.js`, e a
gravação atômica do total com o balde do dia, na suíte `workers`. No navegador,
o `npm run verifica:painel` semeia uma série sintética e confere gráfico,
filtros, cruz no mouse, no toque e no teclado, a dica que não cobre o ponto,
tabela, CSV e o foco num projeto (§15.2).

**Na prévia de PR**, o menu "Testes" da faixa tem **Gerar 90 dias de métricas
de exemplo** — a mesma série sintética do `verifica:painel` —, para ver tudo
isto com números sem esperar meses de visitas (README, "Prévia de PR").

---

## 9. Ajustes

Quatro grupos: Site, Dados, Conta e Sobre. Cada bloco tem título, uma frase do
que faz e os controles; o de Sobre não tem controle nenhum — mostra a versão do
site (`VERSAO`, `src/config.js`) e a lista do que ela trouxe.

| Grupo | Bloco | Controles | Chamada | Confirmação |
| --- | --- | --- | --- | --- |
| **Site** | Selo de agenda | campo `#agenda-texto` (≤ 80 caracteres; Enter salva) e **Salvar** | `PUT /api/settings/agenda` `{ texto }` | — |
| | Categorias | chips com × (`data-cat-del`), campo `#cat-new` (≤ 40; Enter cria) e **Adicionar** | `POST /api/categories` · `POST /api/categories/delete` | excluir pede **digitar o nome**; avisa em quantos eventos a categoria está |
| **Dados** | Backup dos dados | **⬇ Baixar backup JSON** | `GET /api/backup` | — |
| | Exportar planilhas | **Consentimentos**, **Pedidos de remoção**, **Métricas: totais** e **Métricas por dia** (CSV) | `GET /api/consent/export` · `GET /api/removal-requests` · `GET /api/metrics` · `GET /api/metrics/diario?dias=180` | — |
| | **Restaurar backup** *(sensível)* | arquivo `#restore-file` (`.json`) e **↩ Restaurar backup** | `POST /api/backup/restore` | digitar `RESTAURAR` |
| **Conta** | **Trocar a senha do painel** *(sensível)* | `#new-pass`, `#new-pass2` e **Salvar nova senha** | `PUT /api/settings/password` `{ password }` | digitar `TROCAR` |
| **Sobre** | Versão (`#bloco-versao`) | só leitura: "Versão X.Y.Z" e "O que esta versão trouxe" | — | — |

Os dois blocos **sensíveis** têm borda vermelha e o selo "Pede confirmação
digitada": mudam dados globais ou a credencial. É o que sobrou da antiga "zona de
perigo", agora no lugar de cada ação em vez de num cartão à parte.

- **Selo de agenda.** Uma frase curta no topo da galeria e da /sobre ("Agendando
  para janeiro/2027"); vazio, o selo some (a chave `agenda` é apagada). O servidor
  limpa o texto (uma linha, sem espaço sobrando, ≤ 80); o site público lê com
  cache de 30 s, e o KV leva até mais 30 s para chegar aos outros locais: o
  toast diz "até 1 min" (§6.2). **Fora do backup**: é uma frase, redigitada em
  segundos.
- **Categorias.** Alimentam os filtros da galeria e do painel e o select do
  formulário. Até a primeira alteração valem Formatura, Casamento, Ensaio, Evento
  e Outro; o máximo é 30, de até 40 caracteres, sem repetir (maiúsculas não
  contam). Excluir uma categoria a tira de todos os eventos que a usavam.
- **Backup.** `fotos-backup-AAAA-MM-DD.json`, versão 2: eventos, categorias e
  pedidos de remoção — estes com e-mail e telefone de quem pediu, então o arquivo
  pede cuidado. Não há backup automático. O download é um `fetch`
  (`downloadBackup()`) e depois um `<a download>` com o blob, como o CSV. Com a
  sessão expirada, o 401 leva ao login pelo mesmo `vaiParaOLogin()` do `api()`:
  antes, o navegador mostrava o JSON do erro.
- **Planilhas.** O CSV de consentimentos vem do servidor (D1; 503 sem o banco
  provisionado); os de pedidos e de métricas (totais e por dia) são montados no
  navegador por `toCSV()`, com BOM, citação e a defesa contra injeção de
  fórmula (`=`, `+`, `-`, `@`, TAB, CR iniciais ganham um apóstrofo) — o export
  do navegador é justamente o que carrega texto cru digitado por visitante.
- **Restaurar.** *Merge*, nada é apagado: eventos com o mesmo `id` são
  atualizados só se o do backup for mais recente; categorias são unidas; pedidos
  entram por `id`. O toast conta o que entrou ("Restaurado: N adicionados, M
  atualizados, K ignorados (sem id ou URL válida)") e a página recarrega em 1,8 s
  — voltando para Ajustes (§3).
- **Trocar a senha.** O mínimo é 12 caracteres (a política completa está em
  `validatePassword`, `src/security.js`): três tipos de caractere, ou uma frase
  de 20 ou mais. O cliente só confere "preenchida", "iguais" e o mínimo; o resto é
  do servidor, e o toast mostra o motivo. A sessão de quem trocou continua; as
  outras são revogadas.
- **Sair com algo não salvo.** A nova senha, a categoria nova, o texto do selo
  e o arquivo escolhido para restaurar pedem "Sair do site?" ao recarregar ou
  sair (`ajustesSujos()`, no `beforeunload`). Na saída para o login por sessão
  expirada o pedido vale mesmo com o rascunho guardado: o texto de Ajustes não
  vai para o rascunho, e ficar na página é o jeito de copiá-lo. O restaurar tira
  o arquivo do campo quando dá certo, para o recarregamento de 1,8 s não
  perguntar.

### Confirmação digitada

`confirmDialog(opts)` é o diálogo temático do painel (não existe mais
`alert()`/`confirm()` nativo). Com `opts.typeToConfirm`, o botão de confirmar
fica **desabilitado** até o texto digitado bater com o esperado — sem diferenciar
maiúsculas e ignorando espaços nas pontas. O que se digita:

| Ação | Digita |
| --- | --- |
| Excluir evento | o título do evento |
| Excluir categoria | o nome da categoria |
| Aplicar categoria/acesso em massa | a quantidade de eventos selecionados |
| Restaurar backup | `RESTAURAR` |
| Trocar a senha | `TROCAR` |
| Descartar alterações do formulário | nada: confirmação simples |

O diálogo prende o foco entre o campo, "Cancelar" e o botão; `Esc` cancela;
`Enter` confirma quando liberado; o foco volta a quem o abriu.

---

## 10. Endpoints: o que a página chama

Nenhum endpoint mudou no redesenho; a v2.0 acrescentou um, o da série por dia
(`/api/metrics/diario`, §8). Todo `/api/*` daqui exige sessão
(`checkAuth`) e, para escrita, passa pelo portão de CSRF do roteador (README,
"Rotas HTTP").

| Ação (função) | Método e caminho | Corpo | Resposta e observações |
| --- | --- | --- | --- |
| Salvar evento novo (`submitForm`) | `POST /api/events` | o payload do formulário (§6.2) | 201 com o evento; 400 (slug, título ou Drive), 409 (slug repetido) |
| Salvar edição (`submitForm`) | `PUT /api/events/<id>` | idem | o evento salvo; 404; 409 se a URL estiver em uso |
| Destacar (`togglePin`) | `PUT /api/events/<id>` | `{ pinned }` | só o que veio muda |
| Ocultar/Mostrar (`toggleVisible`) | `PUT /api/events/<id>` | `{ visible }` — só o que muda, como o Destacar (mandar o evento inteiro desfazia o que outro aparelho tivesse editado) | o evento salvo, inteiro |
| Excluir (`deleteEvent`) | `DELETE /api/events/<id>` | — | `{ deleted: true }`; apaga também os contadores do slug |
| Aplicar categoria em massa | `POST /api/events/bulk-category` | `{ ids, category }` | `{ updated, category }` |
| Aplicar acesso em massa | `POST /api/events/bulk-access` | `{ ids, accessType }` | `{ updated, accessType }` |
| Criar categoria | `POST /api/categories` | `{ name }` | 201 `{ categories }`; 409 (repetida, ou 30 no máximo) |
| Excluir categoria | `POST /api/categories/delete` | `{ name }` | `{ categories, cleared }` |
| Salvar selo de agenda | `PUT /api/settings/agenda` | `{ texto }` | `{ texto }` já limpo |
| Trocar a senha | `PUT /api/settings/password` | `{ password }` | `{ ok: true }`; 400 com o motivo da política |
| Baixar backup | `GET /api/backup` | — | arquivo `.json`, por `fetch` e blob; 401 leva ao login (`vaiParaOLogin()`) |
| Restaurar backup | `POST /api/backup/restore` | o JSON do backup | `{ ok, added, updated, skipped, total }`; no backup v2, também `categories` (a contagem gravada, não a lista), `categoriesDropped` (se passou de 30) e `removalRequestsAdded` — na prévia de PR, `removalRequestsSkipped` no lugar dos pedidos |
| Planilha de consentimentos | `GET /api/consent/export` | — | CSV (`fetch` e blob); 503 sem D1 |
| Planilha de pedidos | `GET /api/removal-requests` | — | CSV montado no navegador |
| Planilha de métricas (`exportMetricsCSV`) | `GET /api/metrics` (se ainda não carregou) | — | CSV montado no navegador: `metricas-AAAA-MM-DD.csv` |
| Planilha da série por dia (`exportSerieCSV`) | `GET /api/metrics/diario?dias=180` (se ainda não carregou) | — | CSV montado no navegador: `metricas-por-dia-AAAA-MM-DD.csv` |
| Carregar pedidos (`loadRequests`) | `GET /api/removal-requests` | — | lista, mais recente primeiro |
| Resolver pedido (`resolveRequest`) | `PUT /api/removal-requests/<id>/resolve` | — | o pedido atualizado e o e-mail ao solicitante |
| Carregar métricas (`loadMetrics`) | `GET /api/metrics` e `GET /api/metrics/diario?dias=180`, em paralelo | — | os totais: `[{ slug, title, views, driveClicks }]`; a série: `{ hoje, dias, primeiroDia, projetos, gate, gateTotal }` (§8). Cada uma com o seu erro |
| Entrar | `POST /dashboard/login` (formulário) | senha e token do Turnstile | 302 para `/dashboard` |
| Sair | `POST /dashboard/logout` (formulário) | — | 302 e `Clear-Site-Data` |

`GET /api/categories` existe no servidor, mas a página não a usa: as categorias
chegam no HTML e nas respostas das mutações. O link "Galeria" do card
(`GET /galeria/<slug>`) e o "Abrir a página do projeto" do menu (`GET /<slug>`)
são navegações, não chamadas de API.

**Entrar e sair.** A tela de login (`loginHTML`) não mudou no redesenho e mora na
mesma URL: `GET /dashboard` devolve o login ou o painel conforme a sessão. Não
existe cadastro de primeiro acesso — sem hash no KV e sem o secret
`ADMIN_PASSWORD`, a resposta é 503 "Painel não configurado". O botão "Entrar" só
habilita quando o Turnstile devolve o token (ou, se o widget não carregar em 5 s,
com um aviso de bloqueador). Três recusas, escolhidas pelo `?error=`: "Senha
incorreta" (`1`; é também o que aparece quando o limite por IP — 10 tentativas a
cada 10 min e 60 por dia — estoura), "a verificação anti-robô não passou" (`ts`,
igual com a senha certa ou errada) e "o banco de dados do site não respondeu"
(`kv`: a senha pode estar certa).

**O que `api()` faz com a resposta.** Todo `fetch` do painel passa por `api()`,
com duas exceções: a planilha de consentimentos (`exportConsentCSV` chama o
`fetch` direto, para receber o CSV como blob) e o backup (`downloadBackup()`,
também um `fetch`). Na planilha um 401 vira só o toast com a mensagem do
servidor; no backup ele leva ao login, pelo mesmo `vaiParaOLogin()` do `api()`.
Em `api()`: JSON
de ida e de volta; **401** → `vaiParaOLogin()`: guarda o rascunho (`stashDraft()`,
§6.3) e navega para `/dashboard` (o login) — o erro lançado ainda chega ao `catch` de quem
chamou, então um toast "Não autorizado." pode piscar antes de a página trocar;
qualquer outro erro vira `Error(data.error)` e quem chamou o mostra num toast.
Um **503** (KV fora do ar) não é 401 de propósito: o aviso diz o que houve e a
sessão segue intacta para quando o banco voltar.

---

## 11. A página por dentro

### Estado

Tudo em variáveis do script (`let`/`const` no topo):

| Variável | Guarda |
| --- | --- |
| `events`, `categories` | cópia local dos dados; cada ação bem-sucedida a atualiza e redesenha — a página **não** rebusca a lista |
| `massMode`, `selectedIds` | modo de seleção e os ids marcados |
| `editingId`, `photoList`, `formSnapshot`, `lastFocused` | o formulário aberto: qual evento (`null` = novo), as capas, o instantâneo do "sujo" e quem tinha o foco |
| `saindoComRascunho` | `true` quando `vaiParaOLogin()` (no 401 do `api()` e do backup) leva ao login com o rascunho guardado: é o que cala o `beforeunload` do formulário (§6.3). Não cala o aviso de Ajustes (§9) |
| `agendaSalvo` | o selo como está salvo: o "sujo" de Ajustes compara com ele (§9) |
| `menuAberto` | o menu "⋯" aberto agora (no máximo um) |
| `metricsData`, `metricsSort`, `metricsLoaded` | os totais desde o início e a ordenação da tabela |
| `serieDiaria`, `metricsPeriodo`, `metricsProjeto`, `metricsOrdem`, `recorteAtual` | a série por dia (uma leitura de 180 dias) e o que o dono escolheu nos filtros; trocar o filtro redesenha daqui, sem pedir nada ao servidor. O período volta ao recarregar (`sessionStorage`, `painel:periodo`) |
| `geoAcessos`, `cruzIdx`, `tabelaAcessosAberta`, `dicasSemana` | o gráfico de acessos: medidas do SVG, o dia sob a cruz, a tabela aberta e as dicas das colunas da semana |
| `requestsLoaded` | se a lista de pedidos já chegou |

A lista local é a do carregamento da página: outro aparelho editando ao mesmo
tempo só aparece depois de recarregar.

### Eventos: delegação, nunca `on*=`

A política aplicada é a estrita (desde o #126) e não aceita handler inline:
`script-src` tem o nonce e nenhum `'unsafe-inline'`, então todo `onclick=` para
de funcionar (`RETOMADA.md` §5.1). Além disso, as listas são
refeitas por `innerHTML` — um listener ligado a um card sumiria no primeiro
redesenho. Então não há `on*=` em lugar nenhum, e tudo é delegado, em contêineres
que sobrevivem:

| Atributo | Tratador | Onde |
| --- | --- | --- |
| `data-onclick="<nome>"` | um `switch` no listener de clique do `document` | botões estáticos: navegação, cabeçalhos, formulário, ajustes |
| `data-onchange`, `data-oninput`, `data-keydown` | listeners do `document` | filtros, "Todos" da seleção, aviso de novidade; Enter nos campos de categoria e agenda |
| `data-action` (+ `data-id`, `data-i`, `data-gi`, `data-sort` ou `data-slug`, conforme a ação) | listener do contêiner | `#evt-list` (`edit`, `dup`, `del`, `pin`, `vis`, `menu`), `#photo-list` (`removePhoto`), `#requests-body` (`resolveRequest`, `toggleResolved`), `#metrics-body` (`sortMetrics`), `#metrics-ranking` (`focaProjeto`) |
| `data-cat-del` | listener de `#cat-list` | o × da categoria |
| `data-onerror="hide"`, `data-onload="show"` | listeners de **captura** no `document` | `error` e `load` não borbulham |

Botão novo e estático: `data-onclick="nome"` e um `case` no `switch`. Botão novo
dentro de uma lista: `data-action="nome"` e uma linha no listener do contêiner.

### Ids que são contrato

Estes ids são usados pelo script, pelos testes e pelo roteiro de navegador;
renomeie com `grep`: `#evt-list`, `#evt-count`, `#evt-search`,
`#category-filter`, `#status-filter`, `#mass-toggle`, `#mass-bar`, `#menu-fundo`,
`#requests-body`, `#requests-badge`, `#metrics-periodo`, `#metrics-projeto`,
`#metrics-ordem`, `#metrics-atualizado`, `#metrics-resumo`, `#bloco-acessos`,
`#grafico-acessos`, `#dica-acessos`, `#acessos-legenda`, `#acessos-ver-tabela`,
`#acessos-tabela`, `#acessos-anuncio`, `#grafico-semana`, `#semana-leitura`,
`#grafico-portao`, `#metrics-ranking`, `#metrics-body`, `#metrics-export`,
`#cat-list`, `#cat-new`, `#agenda-texto`, `#restore-file`, `#new-pass`,
`#new-pass2`, `#app`, `#overlay`, `#sheet`, `#submit-btn`, `#photo-list`,
`#toast`, `#tab-<seção>`, `#evt-<id do evento>`, `#bf-<bloco>`, `#f-<campo>` e
`[data-resumo]`.

### Toast

`toast(msg, 'ok' | 'err')`: uma caixa no rodapé (acima da barra de baixo no
celular), verde ou vermelha, que some em **3 s** (`pointer-events: none`; um novo
aviso substitui o anterior na hora) e é uma região viva (§12). O retorno de
ação, no painel todo:
**toast** para o resultado, **spinner e "Salvando…"** no botão do formulário,
**botões desabilitados** enquanto a requisição corre (`setRowBusy`, "Marcar como
resolvido") e **"Carregando…"** nas seções que buscam dados.

---

## 12. Acessibilidade

**O que existe.**

- **Marcos**: `<aside>` (marca, navegação e saída), `<nav aria-label="Seções do
  painel">`, `<main>`, e cada seção é uma `<section>` com `aria-labelledby` e um
  único `<h1>`. Em Ajustes, `<h2>` para o grupo e `<h3>` para o bloco. Só a seção
  ativa existe para o leitor de tela (as outras são `display: none`).
- **Seção atual**: `aria-current="page"` no botão ativo da nav.
- **Chips de status**: `aria-pressed`, dentro de um `role="group"` com nome.
- **Menu "⋯"**: `aria-haspopup`, `aria-expanded`, `role="menu"` e `menuitem`, nome
  com o título do evento ("Mais ações: Formatura 2026"), teclado e devolução do
  foco (§4.3). Ícones são `aria-hidden`.
- **Formulário**: diálogo modal com foco preso, `Esc`, retorno do foco, o
  `<details>`/`<summary>` nativo para os blocos (estado e teclado de graça) e
  **nome para todo campo**: rótulo ligado por `for=`, `aria-label` ou `<label>`
  em volta. Placeholder não é nome (some ao digitar): o "Quando o aviso some",
  a caixa de colar links e as URLs das fotos (`aria-label="URL da foto N"`,
  escritas no script) levam `aria-label`, e as miniaturas das fotos, que são
  decorativas, `alt=""`. `tests/painel.test.js` confere o HTML do servidor campo
  a campo.
- **Confirmação digitada**: diálogo com `role="dialog"` e `aria-modal`, foco
  preso, `Esc` e `Enter`.
- **Foco visível** em botões, links, chips, abas da nav, `summary`, campos e no
  gráfico de acessos: contorno de 2 px em `#c0a060`. Nos campos a regra é
  própria e leva `!important`, para vencer o `outline: none` que cada campo traz
  e os estilos em linha; a caixa do slug, que corta o que passa da borda
  (`overflow: hidden`), leva o contorno em volta (`:focus-within`); nos toggles,
  cujo checkbox é invisível (`opacity: 0`), o contorno vai no trilho
  (`.toggle input:focus-visible ~ .toggle-track`); as faixas de chips que rolam
  para o lado (`.chips`, `.bf-atalhos`) têm 4 px de recheio, devolvidos por
  margem negativa, para a rolagem não cortar o contorno; o gráfico leva um anel
  de 2 px por `box-shadow`. O roteiro percorre a lista, a folha e as Métricas
  pelo Tab e exige, em cada parada, um contorno à vista e sem corte (§15).
- **Movimento**: `prefers-reduced-motion` desliga transições e animações.
- **O que está atrás de um diálogo fica `inert`** desde a v2.0: com a folha do
  formulário ou uma confirmação aberta, `#app` (e a folha, quando a
  confirmação abre por cima dela) não recebe foco nem é lido pelo leitor de
  tela — o foco preso pelo teclado não segurava quem navega por outros
  caminhos. Ao fechar, cada um volta ao que era.
- **Avisos**: o toast é uma região viva (`role="status"`, `aria-live="polite"`,
  `aria-atomic="true"`) desde a v2.0 — o leitor de tela anuncia "Evento
  atualizado!" e os erros sem tirar o foco de onde a pessoa está.
- **Contraste AA** (4,5:1) desde a v2.0: `--text3` passou de `#555` (~2,5:1) a
  `#8a8a8a` (5,3:1 sobre os blocos). O texto vermelho e o verde de "enviado" e
  "Entregue" têm tokens próprios, `--red-texto` (`#e07070`) e `--verde-texto`
  (`#4a9a4a`); o `--red` (`#c0392b`, 3,4:1 sobre os blocos) ficou para borda e
  fundo — só o `:hover` do × de excluir (categoria e foto) ainda o usa como cor
  de texto. As dicas dos rótulos ("(opcional)", "(só você vê)") são uma classe,
  `.dica-rotulo`, na cor do rótulo. `tests/painel.test.js` mede cada token de
  texto sobre `--bg`, `--bg2` e `--bg3`, mede cada selo de status sobre a
  própria cor translúcida no card e recusa cor de texto `#…` escrita em estilo
  em linha — então toda cor nova é uma classe ou um token que o teste mede, e
  uma abaixo de 4,5:1 reprova a suíte. Ele **não** mede as cores de texto
  escritas em outras regras de CSS (o aviso verde do toast, o selo "pendente"
  dos pedidos, o `:hover` do × de excluir) nem o texto dos gráficos em SVG.
- **Métricas**: o gráfico de acessos anda pelo teclado e é anunciado ao leitor
  de tela, e tem a mesma informação em tabela ("Ver como tabela") — §8.
- **Zoom liberado**: a `<meta viewport>` não tem `maximum-scale` nem
  `user-scalable=no`. É por isso que os campos têm 16 px (§13) em vez de se
  proibir o zoom.
- `lang="pt-BR"`.

---

## 13. Celular: as decisões

O pedido do #220 é "só pelo celular e sem zoom". O que isso virou:

**Campos com 16 px abaixo de 900 px.** O Safari do iPhone dá zoom ao tocar num
campo com letra menor que 16 px, e a tela fica torta até a pessoa desfazer com
dois dedos. `@media (max-width: 899px) { input, select, textarea { font-size:
16px !important } }` — o `!important` vence estilos em linha antigos de alguns
selects. A regra é por **largura**, e a de toque (abaixo) por **dispositivo de
entrada**: o zoom é problema de tela pequena; o dedo é problema de qualquer tela
sensível ao toque.

**Alvos de toque de 44 px** (WCAG 2.5.5) sob `@media (pointer: coarse)`:
`.btn-sm`, `.act`, `.chip`, `.menu-item`, `.btn-resolve`, `.btn-danger`,
`.req-resolved-toggle` e os botões das confirmações (`.confirm-foot button`)
ganham `min-height: 44px`; todo campo também (`input`,
menos caixas de seleção e botões de opção, e `select`: a busca, o filtro de
categoria, o seletor de projeto das Métricas, o select da barra de seleção); e
`.icon-btn` fica 44 × 44. A nav tem 52 px e o `summary` dos blocos do
formulário, 52 px. A caixa de seleção do card e a de "Todos" (17 × 17) ganham
área de toque de 44 × 44 pelo rótulo em volta (`label.evt-check-alvo`;
`label.mass-selall`, com 44 px de altura), e os toggles têm 44 px de altura, com
o trilho de 26 px no meio (o rótulo ao lado também liga e desliga). No toque,
"Adicionar foto" entra na lista de 44 px e o × de excluir categoria vira 44 × 44
(o chip cresce junto). O roteiro mede botões, `a.act`, campos, seletores e
`summary` à vista em Eventos (com a nav e, com o modo de seleção ligado, as
caixas e o "Todos"), na folha do formulário (com os seis blocos abertos, e os
toggles), em Pedidos e em Ajustes, mais o seletor de projeto das Métricas, os
itens da folha do menu "⋯" (48 px) e os botões da confirmação de excluir (§15).

**Sem realce azul do toque.** `-webkit-tap-highlight-color: transparent` em
botões, links e `summary`: cada controle tem o próprio estado.

**Nada pode ser mais largo que a tela.** O defeito real, achado montando o
roteiro: um bloco de Ajustes 25 px largo demais fazia o celular **afastar a
página inteira** (zoom para fora) e a barra de baixo saía do lugar. A receita é
uma grade com coluna `1fr` e um campo de texto numa linha flex — o campo não
encolhe abaixo da largura natural. Daí `grid-template-columns: minmax(0, 1fr)` e
`min-width: 0` nos blocos (`.grade-blocos`, com o comentário no CSS). Tabela larga
rola **dentro** do bloco (`.bloco-tabela`), as linhas de filtro rolam de lado,
e as linhas do card cortam com reticências em vez de empurrar.

**A barra de seleção em massa.** Com "Selecionar vários" ligado, a barra tem
"Todos", a contagem e os dois pares (um select com o seu botão). Em 390 px os
dois pares não cabem numa linha: o "Aplicar acesso" saía pela direita (a barra
tinha 398 px). No celular, cada par ocupa uma linha inteira (`.mass-par`, com o
select que encolhe); no computador, continua tudo numa linha. O roteiro mede a
barra com o modo ligado nos dois celulares (§15.2).

**A barra de baixo e o conteúdo.** O conteúdo reserva `88px` embaixo para a nav
não cobrir o último bloco, e o toast sobe `80px` para ficar acima dela. Ambos
somam `env(safe-area-inset-bottom)` — mas a `<meta viewport>` do painel não tem
`viewport-fit=cover` (só a galeria própria tem), então o navegador já mantém o
conteúdo fora do entalhe e esses `env()` valem 0 hoje. Estão prontos para o dia
em que o painel declarar `viewport-fit=cover`.

**O menu como folha de baixo** (`< 700px`): o polegar alcança e o texto cabe
inteiro; a folha ocupa a largura da tela e os itens têm 48 px. O fundo escuro
(`#menu-fundo`, `z-index` 35) fica entre a nav (30) e o menu (40), e fecha ao
toque. Os 48 px têm de vir **depois** do bloco `pointer: coarse`, que dá 44 px a
`.menu-item` (mesma especificidade: vence o que vem por último no CSS) — por
isso há um `@media (pointer: coarse) and (max-width: 699px)` logo abaixo dele.
Sem esse bloco, os itens ficariam em 44 px num celular de verdade; o roteiro
confere ≥ 48 px (§15.2).

**O formulário.** No celular é uma folha colada embaixo (`92vh`), com o "Salvar"
fixo no rodapé — não rola junto com os campos.

---

## 14. Segurança e cota

### No cliente

- **Todo dado vira texto.** Em `innerHTML`, todo valor guardado passa por `esc()`
  (os cinco caracteres, inclusive `'`), e toda URL por `esc(safeUrl(...))`. As
  duas cópias do navegador são presas às do servidor por testes que as extraem do
  fonte e as executam lado a lado (`tests/security.test.js`, "pares
  cliente/servidor"). O motivo está em `tests/rendered-pages.test.js`, "painel:
  dado guardado não vira marcação": o restore de backup é o único caminho que
  grava eventos sem passar por `normalizeEventFields`, e um backup adulterado
  plantava marcação dentro do painel logado.
- **JSON dentro do `<script>`** passa por `jsonParaScript()`: `<` e `>` viram
  `\u003c` e `\u003e`, para um título com `</script>` não fechar o bloco.
- **Sem handler inline** (§11): é o que faz o painel funcionar sob a política
  estrita (nonce, nenhum `'unsafe-inline'` em `script-src`), que é a aplicada
  desde o #126. O `<script>` do painel leva o nonce da requisição; um handler
  novo não executaria (`RETOMADA.md` §5.1).
- **Confirmação digitada** para o que apaga ou muda o que é global (§9).
- **`sessionStorage`**, nunca `localStorage`, para o rascunho, a seção e o período
  das Métricas: morrem com a aba e com o "Sair".
- **Cabeçalhos** da página (`adminHtmlSecurityHeaders`): `no-store`, `noindex`,
  `Referrer-Policy: no-referrer`.
- **CSV**: a defesa contra injeção de fórmula tem de existir nas duas cópias
  (`csvCell()` no servidor, `toCSV()` no navegador); já faltou numa delas.

### Cota de escrita do KV

A cota é de **1000 escritas por dia para a conta inteira**. O redesenho não
acrescentou nenhuma; `verifica:painel` prova isso por fluxo (§15).

| Ação | Escritas no KV |
| --- | --- |
| criar, editar, excluir, ocultar, destacar, aplicar em massa | 1, em `events` (a cópia de sobrevivência vai para a Cache API, não para o KV) |
| criar categoria / excluir categoria | 1, em `categories` (+1 em `events` se a exclusão limpou eventos) |
| salvar o selo de agenda | 1, em `agenda` (ou 1 exclusão, se vazio) |
| resolver pedido | 1, só na chave do pedido, `removal_request:<id>` (+ 1 e-mail) — desde a v2.0 (#198) |
| trocar a senha | 1, em `admin_password` (+ exclusões das outras sessões) |
| restaurar backup | `events` e `categories`, mais 1 por pedido de remoção novo (`removal_request:<id>`, até 500 por arquivo; na prévia, nenhum) |
| entrar | 1, em `admin_session:<token>` |
| sessão em uso | o `lastSeen` é reescrito **no máximo a cada 10 min** |

Leituras: algumas por ação (a sessão é lida em toda chamada). As páginas públicas
usam um cache de 30 s por isolate, e o KV leva até mais 30 s para chegar aos
outros locais da Cloudflare (`cacheTtl: 30`): uma mudança no painel pode levar
até 1 min para aparecer no site. O painel lê sempre o KV fresco (`getEvents(env,
true)`).

Desde o #198 há também a operação `list` do KV: abrir o painel (`loadRequests()`
roda na carga, para o selo de pedidos), recarregar a lista depois de resolver um
pedido, a planilha de pedidos, o backup, o restore de um backup com pedidos e o
cron diário listam o prefixo `removal_request:` (`src/pedidos.js`). O plano
gratuito permite 1000 `list` por dia na conta (`TODO.md`, "Plano gratuito") —
folga de sobra para um dono só, porque o painel não relê sozinho. Nunca ponha um
`list` em caminho público.

---

## 15. Como verificar

`npm test` prova que as funções fazem o que as funções fazem — não que o painel
funciona (`docs/VERIFICACAO.md`; `TODO.md`, "Teste verde não é verificação"). O
painel tem três camadas, e nenhuma substitui a outra:

| Camada | Prova | Não prova |
| --- | --- | --- |
| **Testes** (`npm test`; rodam na CI) | o card idêntico nos dois lados e depois do bundle; a estrutura; os selos; o contraste e os nomes dos campos; as contas dos gráficos de Métricas; dado hostil vira texto; o script emitido passa no lint e no tsc | que o painel abre, que o menu abre, que nada vaza para o lado |
| **`npm run verifica:painel`** (local e na CI, Chromium) | o fluxo do dono por aparelho, no Worker de verdade; layout; CSP; chaves do KV | o Safari do iPhone em si; o que só a plataforma garante (workerd, cota real) |
| **Olhar as capturas** (`VERIFICA_PRINTS`) | a aparência: o roteiro prova comportamento, não beleza | — |

**`verifica:painel`, `verifica:galeria`, `verifica:evento` e `verifica:previa`
rodam na CI**, em todo push e PR, no job *Roteiros no navegador (Chromium)* do
`checks.yml` (#232). O `verifica:navegador` não: ele precisa de um Worker de pé
com projetos semeados. Rodar o `verifica:painel` e olhar as capturas continua
sendo item do checklist do PR (`.github/pull_request_template.md`).

### 15.1 O que os testes prendem

| Arquivo | O que prende sobre o painel |
| --- | --- |
| `tests/painel.test.js` (23 testes) | as quatro garantias do card (§5); o conteúdo do card (ações com rótulo e menu, rótulos do menu conforme o estado, selos escritos, data em dd/mm/aaaa por texto, modo de seleção, dado hostil); a estrutura (uma nav com as quatro seções e uma só saída, o selo de pedidos com lugar próprio, seis blocos com o essencial aberto e um atalho para cada, todo `for=` apontando para um `id`, chips com um só pressionado, quatro grupos em Ajustes — Site, Dados, Conta, Sobre — com os dois blocos sensíveis, a versão igual à do `package.json`, lista vazia); a acessibilidade (o toast como região viva; o contraste AA dos tokens de texto sobre os três fundos e de cada selo de status sobre a própria cor; nenhuma cor de texto `#…` em estilo em linha; nome para todo campo — rótulo, `aria-label` ou `<label>` em volta — e o `aria-label` das URLs de foto) |
| `tests/metricas-painel.test.js` (19 testes) | as contas dos gráficos de Métricas (v2, #215), tiradas do script do painel como a página as recebe e executadas no node: a escala do eixo nunca corta o maior valor, dia sem contagem não vira zero, comparação só com base inteira, nenhum `NaN` no SVG, rótulos do eixo x terminando em hoje |
| `tests/scripts-embutidos.test.js` | o `<script>` que o painel **emite** passa no lint (`no-undef`, `no-use-before-define`…) e no tsc, com os tipos de `tests/helpers/scripts-embutidos.d.ts` |
| `tests/rendered-pages.test.js` | o JavaScript emitido é sintaticamente válido (`vm.Script`) e `<script>`/`</script>` ficam balanceados; "painel: dado guardado não vira marcação" (id, status e miniatura hostis); "estrutura do HTML emitido" (nenhuma tag órfã nem aberta) |
| `tests/security.test.js` | "pares cliente/servidor": `esc`, `safeUrl`, `hojeEmSaoPaulo`, `byDate` e `convertDriveUrl` extraídos do fonte e executados contra os do servidor; os endpoints que o painel chama (destaque, CRUD, backup, senha…) |
| `tests/fuso.test.js` | "Atrasado" na virada do dia em São Paulo (às 22:30 ainda é o mesmo dia): a função do servidor e o selo da primeira pintura — não a cópia do script |
| `tests/index.test.js` | "editar as fotos de capa" (4 testes): a capa segue a lista (tirar a última foto tira a capa, trocar a primeira troca), o registro antigo só com capa a mantém no "Ocultar", e um `PUT` sem `photos` (o "Destacar") não mexe nela |
| `tests/agenda.test.js` | o selo de agenda chega ao campo do painel, escapado |
| `tests/galeria.test.js` | o card leva a `/galeria/<slug>` |
| `tests/login-turnstile.test.js` | o login com Turnstile: sem token não se entra, a resposta é a mesma com senha certa ou errada, e a tela traz o widget com o botão desabilitado até o token |

### 15.2 `npm run verifica:painel`

```bash
npm run verifica:painel                       # = node --import ./scripts/node-com-workers.mjs scripts/verifica-painel.mjs
VERIFICA_PRINTS=/tmp/prints npm run verifica:painel   # salva as capturas
```

Não precisa do `wrangler dev`. Sai com 1 se alguma checagem falhar, e roda em uns
40 segundos (mais devagar com a máquina ocupada): o aviso da vez sai na hora, por
`someAviso()`, em vez de se esperar os 3 s dele. Roda também na CI (§15, acima).

**Como funciona.**

- `scripts/worker-local.mjs` sobe o **`src/index.js` de verdade** num servidor
  HTTP local, sem mudar uma linha: KV em memória (um `Map`; cada `put` fica em
  `escritas`), Durable Objects de verdade (as classes de `src/counters.js` sobre
  armazenamento em memória, `tests/helpers/do.js`), Turnstile que aprova, Resend
  que aceita (e anota cada envio em `emails`) e **qualquer outro host recebendo
  599** — nada sai da máquina, e um
  `fetch` novo esquecido aparece como erro em vez de ir à internet. É o "harness
  local" de `docs/VERIFICACAO.md` §2, agora versionado.
- `scripts/node-com-workers.mjs` é um gancho de resolução do Node, registrado
  com `--import` **antes** do primeiro import: troca `cloudflare:workers` (que só
  existe no workerd) pelo dublê de `tests/stubs/cloudflare-workers.js` — o mesmo
  que o vitest usa por `resolve.alias`. Um lugar só decide o que esse módulo é
  fora do workerd.
- `entraNoPainel()` faz o login pelo **formulário de verdade**. O widget do
  Turnstile nunca carrega ali, então o token vai num campo escondido criado na
  hora, e o envio é por `form.submit()` (o script do login segura o clique até o
  widget devolver um token). Aceita uma senha (a semeada, se não disser outra) e
  lança "login recusado" quando o servidor a recusa — é assim que o roteiro prova
  que a senha antiga deixou de entrar.
- Cada aparelho ganha um Worker novo (a troca de senha de um não atrapalha o
  outro): **iPhone 390 × 844 @3**, **Android 360 × 780 @2** (os dois com toque e
  `isMobile`) e **computador 1440 × 900 @1**. Cada cenário roda dentro de
  `cenario()`, que registra a exceção e segue: uma falha não esconde as outras
  (a mesma lição do `smoke.sh`).
- A semente é um painel com cara de uso real: cinco eventos (um destaque, um
  familiar, um "Em edição" com prazo vencido, um "Em breve" em revisão, um oculto
  e privado), quatro categorias, o selo de agenda e dois pedidos de remoção
  pendentes — um no array antigo `removal_requests` e outro na chave própria
  `removal_request:<id>`, os dois formatos que produção tem logo depois do
  deploy da v2.0 (#198). As **Métricas** ganham uma série sintética de 100 dias
  (`metricasDeExemplo()`, de `src/previa.js` — a mesma das "métricas de
  exemplo" da prévia), mais um histórico anterior à série num dos projetos, para
  o "Total desde o início" ser maior que a soma dos dias. As datas dos eventos
  não dependem do dia em que roda: o prazo
  vencido é de janeiro/2026 e o outro, de 2099. As capas do `lh3`
  são interceptadas e viram um pixel (vermelho — por isso as miniaturas das
  capturas são quadrados vermelhos).
- Chromium: `CHROMIUM_PATH`, ou o `chromium-<n>/chrome-linux/chrome` mais novo em
  `PLAYWRIGHT_BROWSERS_PATH` (padrão `/opt/pw-browsers`, onde ele vem
  pré-instalado nas sessões). Sem esse diretório — é o caso da CI —,
  `chromiumLocal()` devolve `undefined` e o playwright-core usa o Chromium que o
  `checks.yml` instala (`npx playwright-core install --with-deps chromium`).

**O fluxo**, em cada aparelho: entrar → criar um evento → editar e marcar
entregue → ocultar pelo menu → resolver um pedido → métricas → trocar a senha (a
antiga é recusada, a nova entra) → a sessão cair no meio de uma edição (e o
rascunho voltar) → excluir o evento de teste. No computador, o roteiro também
baixa o backup e confere o aviso de Ajustes sujo (depois de trocar a senha), e,
no fim, vê o backup com a sessão caída levar ao login.

**O que cada checagem quer dizer** (213 em 17/10/2026: duas da página-canário da
CSP, 70 em cada celular e 71 no computador; o número muda quando alguém
acrescenta uma — não é contrato):

| Checagem | O que prova / se falhar, olhe |
| --- | --- |
| a navegação é a barra de baixo, de ponta a ponta (celular) / a barra lateral (computador) | a caixa da `nav.nav`: no celular, a borda de baixo na borda da tela e largura cheia; no computador, colada à esquerda e alta. CSS da estrutura (§3) |
| **nada vaza para o lado, em nenhuma seção** (página na escala 1) | para cada seção, `scrollWidth` do documento ≤ largura do **aparelho** e `visualViewport.scale` ≥ 0,99. É o defeito do §13; em qual seção falhou vem no detalhe |
| todo elemento com hidden está mesmo escondido | na carga, todo `[hidden]` com `display: none` calculado. Uma classe com `display` vencia o `hidden` (§16): o selo de Pedidos vazio e o resumo das Métricas |
| (celular) todo alvo de toque da lista tem pelo menos 44 px | botões, `a.act`, campos (`input` menos caixas de seleção) e seletores à vista de `#tab-events`, e as abas da nav; **só** a seção Eventos (o modo de seleção, na linha seguinte) |
| (celular) no modo "Selecionar vários", cada caixa e o "Todos" têm 44 px, e o toque no canto de cima de uma caixa cai no rótulo | liga `#mass-toggle`; conta as `label.evt-check-alvo` (uma por card, cada uma com 44 × 44) e mede a `label.mass-selall` (44 px de altura); `elementFromPoint` 3 px dentro do canto de cima do primeiro card, fora dos 17 px da caixa, devolve o rótulo. Desliga de novo antes do resto do roteiro. Sem o rótulo, ou com a caixa de 17 px, falha |
| (celular) com "Selecionar vários" ligado, a barra cabe no aparelho | `#mass-bar`: `scrollWidth` ≤ `clientWidth` + 1, e a borda direita de cada elemento dela ≤ a largura do **aparelho**, não de `innerWidth`. Sem os pares empilhados, a barra tinha 398 px e cortava o "Aplicar acesso" (§13) |
| (celular) todo alvo de toque da folha do formulário / de Pedidos / de Ajustes tem pelo menos 44 px | a mesma medida (`alvosPequenos()`), na folha com os seis blocos abertos, em `#tab-requests` e em `#tab-settings`. Pegou o "Adicionar foto" (35–40 px) e o × de excluir categoria (20 px) |
| (celular) os toggles da folha têm 44 × 44, e o toque 3 px abaixo da borda de cima do primeiro cai nele | cada `label.toggle` à vista em `#overlay`, medido com os blocos abertos (antes de fechá-los): 44 × 44, e `elementFromPoint` no primeiro. Com o toggle de 26 px, falha |
| (celular) campo com letra de 16 px | `font-size` calculado de `#evt-search` ≥ 16 |
| a lista mostra os 5 eventos; o card escreve o estado; o card mostra o prazo | o card nos casos da semente: "Em edição" e "Atrasado" no evento atrasado; "prazo 10/01" |
| filtros: a conta é a da lista, no singular quando é um, e a lista vazia diz a combinação | chip Ativos → "5 eventos ativos"; com a categoria Casamento → "1 evento ativo"; chip Todos → "1 evento" e um card; chip Em edição → `Nenhum evento com status "Em edição" na categoria "Casamento".`; sem filtro, de volta → "5 eventos" (§4.1) |
| (computador) a seleção só tem o que está à vista | liga o modo, marca "Todos" (5 selecionados), filtra para "Em edição" (um card): a conta diz "1 selecionado" e um só card está marcado. Depois, o filtro volta e o modo se desliga. Sem a poda (§4.4), a conta ficava em 5 |
| (computador) campo em foco ganha o contorno de 2 px (busca e categoria) | o `outline` calculado de `#evt-search` e de `#category-filter`, com o foco no teclado: `solid 2px rgb(192, 160, 96)` (§12) |
| (computador) no Tab, toda parada da lista / da folha / das Métricas / de Pedidos / de Ajustes mostra o contorno de foco, sem corte | `varreFoco()`: anda pelo Tab, como quem usa teclado, a partir de `#evt-search` (lista), do slug com os seis blocos abertos (folha), do chip "7 dias" (Métricas), do primeiro botão de Pedidos (com um Tab antes, para o foco ser de teclado) e do campo do selo (Ajustes). Em cada parada — campos, toggles, botões, chips, `summary`, o gráfico — exige um contorno à vista (no próprio elemento, no trilho do toggle ou na caixa em volta; `outline` ou o anel de `box-shadow`) que nenhum ancestral com `overflow` corte. O detalhe diz qual parada e qual caixa. Foi o que achou os toggles sem foco e os chips cortados pela faixa que rola (§12) |
| com a folha do formulário aberta, a página atrás fica inert; fechada a folha, a página volta a responder | `#app.inert` (§12) — `openForm` liga, `closeForm` desliga |
| a folha nova não tira o foco de quem já está num campo | com a folha de evento novo recém-aberta, o foco vai para o título; 250 ms depois, continua lá — o foco automático da URL (100 ms) só vem se ninguém estiver num campo (§16) |
| o atalho abre o bloco recolhido | `irParaBloco` em "Prazo e status" |
| criar um evento; o evento novo aparece, "Em edição" | `POST /api/events` pelo formulário, e a lista redesenhada **no navegador** (o card de `toString()`) |
| o aviso de criar diz quando o site mostra a mudança | a regex `/O site mostra em até 1 min/` no toast da criação (§6.2) |
| evento novo com só a URL: fechar pergunta antes de descartar | digita só o slug e fecha: aparece o "Descartar alterações?" (o slug entra no `snapshotForm`), e "Cancelar" mantém a folha |
| bloco recolhido mostra o resumo | `atualizaResumos` ("Em edição") |
| colar e remover fotos atualiza o resumo do bloco | cola dois links pelo "Colar vários links": o resumo de "Fotos e Drive" diz "2 capas"; remove uma: "1 capa" (remove a outra no fim — nada é salvo) |
| editar e marcar entregue; o card passa a dizer "Entregue" | `PUT /api/events/<id>` e o redesenho |
| o aviso de editar diz quando o site mostra a mudança | a mesma regex, no toast da edição (§6.2) |
| "Novas fotos": religar reinicia o contador; salvar sem mexer, não | liga o aviso e salva (grava a hora); edita de novo, liga-desliga-liga sem salvar no meio e salva (a hora muda); salva sem mexer (a hora fica). Lido do KV do `worker-local` (§6.2) |
| "⋯" abre o menu | `aria-expanded="true"` e o menu visível |
| (celular) o menu é uma folha embaixo, ao alcance do polegar, com itens de 48 px | a caixa do menu termina abaixo de 60% da altura da tela e todo item mede pelo menos 48 px (§13: a ordem das regras de toque no CSS) |
| (computador) menu no teclado | o foco entra no 1º item ("Destacar"), a seta desce ("Ocultar"), `Esc` fecha e devolve o foco ao "⋯" |
| "Ocultar da galeria" pelo menu, e o card ganha o selo "Oculto" | `PUT` com `visible` invertido, toast e selo |
| "Ocultar" não desfaz o que outro aparelho editou | antes do clique, o roteiro grava um `eventCredits` novo direto no KV (como outro aparelho faria); depois do Ocultar, o KV tem `visible: false` **e** o `eventCredits` de lá — o `PUT` manda só `{ visible }` (§10) |
| a navegação avisa 2 pedidos pendentes | `#requests-badge` com a contagem da semente |
| resolver um pedido (e o aviso da navegação cai para 1) | `PUT …/resolve` e `loadRequests()` atualizando o selo |
| métricas abrem com os números do período | os quatro `.resumo-lab`: Visitas, Abriram o Drive, Taxa de abertura, Hoje |
| a aba tocada fica com o branco da ativa | a cor de `nav.nav [data-tab="metrics"]` depois do toque (ou do clique), passada a transição: `rgb(240, 235, 229)`. No toque a aba fica "em hover", e a cor do hover apagava a da ativa |
| (celular) o seletor de projeto das métricas tem 44 px | altura de `#metrics-projeto` ≥ 44 |
| o número vem comparado com o período anterior | o primeiro `.resumo-delta` diz "vs. 30 dias antes" (a seta, e "alta de"/"queda de" para o leitor de tela) |
| gráfico de 30 dias, duas linhas e a legenda | o SVG de `#grafico-acessos` com `data-pontos="30"`, dois `path` de linha e dois itens em `#acessos-legenda` |
| "7 dias" redesenha o gráfico com 7 pontos | o chip do período (`aria-pressed`) e `data-pontos="7"` — sem pedir nada ao servidor |
| tocar (celular) / passar o mouse (computador) no gráfico mostra o dia e os dois números | `#dica-acessos` visível, com "Visitas" e "Abriram o Drive" |
| a dica cabe na tela | a caixa da dica entre 0 e a largura do aparelho |
| a dica não cobre o ponto que descreve (5 posições) | em cinco lugares do gráfico, nenhum ponto visível da cruz cai dentro da caixa da dica (§8). No celular a dica não cabe ao lado da cruz no meio — foi assim que o primeiro desenho escondia o próprio ponto |
| (computador) no teclado, a seta anda um dia e o leitor de tela ouve; Esc esconde a dica | foco em `#grafico-acessos`, `ArrowLeft` troca o dia da dica e escreve em `#acessos-anuncio`; `Escape` esconde |
| (computador) o gráfico em foco tem o anel dourado | o `box-shadow` calculado de `#grafico-acessos` com o foco: `rgb(192, 160, 96) 0px 0px 0px 2px` (§12) |
| (celular) tocar fora do gráfico esconde a dica | o toque no canto da tela fecha a dica |
| "Ver como tabela" abre os 7 dias | `#acessos-tabela` com 7 linhas e `aria-expanded="true"` no botão |
| dia da semana com 7 colunas | as `[data-coluna]` de `#grafico-semana` |
| modos do portão com contagem e % | as três `.barra-rot` de `#grafico-portao`, cada uma com um "%" |
| tocar num projeto foca os gráficos nele; tocar de novo volta a todos | o item do ranking com `aria-pressed="true"`, o `#metrics-projeto` escolhido e o primeiro número do resumo mudando; de novo, o filtro vazio |
| CSV da série por dia | o download `metricas-por-dia-AAAA-MM-DD.csv`, que começa com `dia,slug,titulo,visitas,abriram_drive` |
| as métricas desenhadas não vazam para o lado | a mesma medida do vazamento, com os gráficos desenhados |
| ajustes em quatro grupos (o último diz a versão) | `.grupo-titulo`: Site, Dados, Conta, Sobre |
| trocar a senha | a confirmação digitada (`TROCAR`) e o toast |
| recarregar a página volta para a mesma seção | `sessionStorage` e `voltaParaSecao()` |
| a senha antiga não entra mais | depois do "Sair", `entraNoPainel()` com a senha da semente lança "login recusado" |
| entrar de novo com a senha nova | entra com a senha nova pelo formulário e chega à `nav.nav` sem `?error=` |
| (computador) "Baixar backup" baixa `fotos-backup-AAAA-MM-DD.json`, com a lista de eventos | `waitForEvent('download')`: o nome casa `/^fotos-backup-.*\.json$/` e o JSON tem `events`. Só lê, sem escrita no KV (§9) |
| (computador) Ajustes com texto não salvo: recarregar pergunta "Sair do site?" uma vez, e a página fica | `#cat-new` preenchido e `reload()`: um diálogo `beforeunload` (dispensado, a recarga para e o texto continua). Uma marca na janela prova que não recarregou (§9) |
| (computador) Ajustes sem texto não salvo: recarregar não pergunta nada | campo limpo e `reload()`: nenhum diálogo, e a marca some, porque a página recarregou |
| desligar e religar o aviso conta como alteração (fechar pergunta antes de descartar) | numa edição aberta, liga-desliga-liga o aviso de novidade e fecha: aparece o "Descartar alterações?" (o `snapshotForm` inclui `alertWasActive`), e "Cancelar" mantém a folha |
| com a sessão caída, salvar leva ao login sem o "Sair do site?" | apaga as sessões do KV, escreve uma nota e salva: a página navega para o formulário de login e nenhum diálogo nativo (`beforeunload`) aparece (§6.3) |
| entrar de novo devolve a edição aberta | depois do login, a folha reabre com a nota no campo e o toast "Sua sessão tinha expirado. Recuperei…" |
| salvar o rascunho grava a nota e reinicia o contador do aviso religado | no KV, `internalNotes` é a nota, `photosAlert.active` é verdadeiro e `addedAt` mudou |
| excluir (com a confirmação digitada) | digita o título; o toast diz "excluído" e o card some |
| com a confirmação aberta, a página atrás fica inert; fechada, volta a responder | `#app.inert` durante o `confirmDialog` e o estado de antes devolvido ao fechar |
| (computador) "Baixar backup" com a sessão caída leva ao login, sem o JSON do erro | no fim do roteiro, para não precisar de sessão depois: apaga as sessões do KV e clica no backup; o 401 leva ao `form[action="/dashboard/login"]` (§9) |
| (celular) os botões da confirmação têm 44 px | as alturas de `.confirm-foot button` na confirmação de excluir (eram 40) |
| nenhum erro de JS | nenhum `pageerror` na sessão toda |
| nenhuma mensagem de CSP no console | nenhuma mensagem de CSP no console, aplicada ou report-only (o filtro é o de `scripts/vigia-csp.mjs`); o roteiro abre com a página-canário que prova que o vigia enxerga um script e um handler sem nonce e que a política os bloqueia |
| o fluxo só grava o que deve no KV (13 escritas) | as chaves gravadas ⊆ `admin_password`, `admin_session:*`, `events`, `removal_request:*`. É o guarda da cota (§14): uma chave nova aqui tem de ser decisão, não surpresa |

As treze escritas por aparelho são: a sessão do login; seis em `events` (criar,
editar e marcar entregue, os três salvamentos do aviso "Novas fotos", ocultar);
uma em `removal_request:<id>` (resolver — só a chave do pedido resolvido, #198);
a senha; duas sessões novas (depois da troca de senha e depois da queda
simulada da sessão); e duas em `events` (salvar o rascunho recuperado e
excluir). A senha antiga recusada não grava nada.

**O que o roteiro não prova.** Chromium emulando um celular não é o Safari do
iPhone: o roteiro prova os **critérios** que causam o zoom (fonte menor que 16
px, conteúdo mais largo que a tela), não o Safari. O "pronto quando" do #220 —
"entrar, criar e editar um evento, marcar entregue, responder um pedido de
remoção e trocar a senha, só pelo celular e sem zoom" — roda inteiro aqui; falta
o dono usar no celular dele e, gostando, fechar o #220 (`RETOMADA.md` §8).

### 15.3 Escrevendo uma checagem nova

- Use `registra(ok, nome, detalhe)` dentro de `cenario()`; o `detalhe` só
  aparece na falha — ponha nele o valor medido.
- Depois de uma ação que mostra toast, chame `someAviso(page)` antes da próxima
  que também espera um toast: o aviso dura 3 s, e `aviso()` leria o antigo.
  `someAviso()` o tira na hora, como o temporizador dele faria.
- Para esperar a folha fechar: `waitForSelector('#overlay.open', { state:
  'hidden' })` (§16).
- Toque no celular, clique no computador: `aciona(locator, toque)`.
- Vai checar foco? Use `varreFoco(page, escopo, inicio)`: ela anda pelo Tab e
  devolve as paradas sem contorno à vista ou com o contorno cortado.
- Mexeu no que o fluxo grava no KV? Atualize a lista permitida **de propósito**.

### 15.4 Olhando o bundle de verdade

Código que vira texto se testa **depois** da transformação do deploy — o teste do
card faz isso. Para ver o que o deploy realmente publica (§5):
`npx wrangler deploy --dry-run --outdir <pasta>`; não publica nada.

---

## 16. Armadilhas

**O script da página é uma template string.** Tudo entre o `<script>` e o seu
fechamento vive dentro de um template literal do módulo — e isso tem regras que
nem o lint do fonte nem a suíte veem direto:

- **Nada de crase** em comentário, nem em string: uma crase solta encerra a
  string e quebra o módulo. Use aspas simples ou duplas.
- **`${`** é interpolação em qualquer lugar, comentário inclusive.
- **Barra invertida dobrada.** Regex e escapes escritos com uma barra só são
  engolidos pelo template: `\d` vira `d` em silêncio (o regex continua válido e
  errado) e `'\n'` vira uma quebra de linha **de verdade dentro** de um literal de
  string do script (erro de sintaxe). Escreva `\\d`, `'\\n'`, `\\x00`, como o
  arquivo todo faz (`/^\\d{4}-\\d{2}-\\d{2}$/`, `.split('\\n')`).
- **`</script`** em qualquer lugar do script — comentário, string — fecha o
  bloco. Por isso os comentários dizem "fecha-script".
- **O card é a exceção**: `cardProjetoPainel` é código de módulo, não parte do
  template, e usa barras normais (`/^\d{4}-\d{2}-\d{2}$/`). Quem o lê no
  navegador recebe o texto já resolvido. São duas zonas de escape no mesmo
  arquivo.
- **O lint olha o que SAI**, não o fonte: `tests/scripts-embutidos.test.js`
  renderiza o painel e passa o `<script>` pelo ESLint e pelo tsc. Pega erro de
  sintaxe, variável indefinida e `const` usado antes de declarar; **não** pega
  `\d` que virou `d`.

**Comentário HTML que cita tag confunde os varredores.** Os testes contam
marcação com expressões regulares sobre o HTML inteiro, comentários incluídos
(`<nav class="nav"` deve aparecer **uma** vez; `<details class="bloco-form" id=…`,
seis; todo `<label` precisa de `for=`; o teste de fechamento precoce conta
`<script` e `</script`). Um comentário que reproduz a marcação de uma dessas tags
(a nav com a sua classe, por exemplo) vira uma ocorrência a mais, e um teste
reprova por um motivo que não é de ninguém. **No HTML, escreva em palavras** ("a
nav", "o rótulo"), como os comentários do arquivo fazem. Dentro do `<style>` o
varredor de tags órfãs pula o bloco, e os comentários de CSS do arquivo citam tags
à vontade — mas os contadores de `tests/painel.test.js` leem o HTML inteiro: não
escreva ali o texto exato que eles procuram.

**`hidden` perdia para `display`.** O atributo `hidden` é só uma regra do
navegador (`display: none`), e **qualquer** `display:` escrito no CSS do projeto
a vence. Foi assim que o selo de Pedidos (`.tab-badge`, `inline-flex`) aparecia
vazio — um círculo vermelho — com zero pendentes, e o resumo das Métricas
(`grid`) deixava uma folga vazia. Desde a v2.0 a base do CSS tem
`[hidden] { display: none !important }`, e `hidden` esconde sempre; as regras
`[hidden]` por classe saíram. O roteiro confere, na carga, que todo elemento
com `hidden` está mesmo com `display: none`. Para mostrar algo, tire o
`hidden` — não troque o `style.display`.

**`const` do topo e a inicialização.** O script chama coisas na carga
(`renderEventList()`, `restoreDraft()`…) antes de definir o resto. Uma função
declarada é içada; um `const` não — chamado antes da linha dele, dá erro de TDZ,
e os `try/catch` ao redor da inicialização o **engolem** (só um `console.error`).
O comentário em `DRAFT_KEY` descreve o caso: `restoreDraft()` roda na carga,
antes de uma declaração mais embaixo; o erro de TDZ seria engolido e o rascunho
nunca voltaria. Por isso `DRAFT_KEY` e `menuAberto` estão no topo. Tudo que a
inicialização usa vai acima das chamadas dela.

**A lista é refeita por `innerHTML`.** Listener ligado a um card some. Delegue no
contêiner (§11). `load` e `error` não borbulham: por isso os listeners de captura
no `document`.

**Os pares são extraídos por expressão regular do fonte.** `esc`, `safeUrl`,
`hojeEmSaoPaulo` e `convertDriveUrl` são achadas por padrões como
`function esc\(s\) \{[\s\S]*?\n {4}\}`: cada uma precisa **manter o recuo de 4
espaços e fechar numa linha só com `    }`**; `byDate` é uma linha terminada em
`;`. O `tests/metricas-painel.test.js` usa a mesma técnica para as 13 funções
das contas dos gráficos de Métricas (`escalaMetricas`, `recorteMetricas`,
`svgLinhas`…): cada uma começa em `    function nome(`, com 4 espaços, e fecha em
`    }` — ou na própria linha, as de uma linha só. Se o teste não achar, ele diz
que precisa ser reapontado — não conserte afrouxando o padrão.

**Dois conjuntos de ajudantes do card.** `ajudaServidor` (em `dashboardHTML`) e
`ajudaCard` (no script) precisam ter as mesmas chaves, e **nenhum teste unitário
as compara**: a de `tests/painel.test.js` é do próprio teste. Uma chave nova só no
servidor dá `TypeError` no primeiro redesenho do navegador — o `try/catch` da
carga o engole e a lista "funciona" (a do servidor continua lá) até a primeira
ação. Quem pega é o roteiro de navegador.

**O card e o bundle**: §5.

**Verificando no celular emulado, o vazamento some.** No Chromium com `isMobile`,
um conteúdo mais largo que a tela faz o navegador alargar a janela de layout:
`window.innerWidth` **cresce junto**, e `scrollWidth - innerWidth` dá zero com a
página quebrada. Num teste com um bloco de 415 px em tela de 390: `innerWidth` e
`scrollWidth` foram os dois a 431. O roteiro compara `scrollWidth` com a largura do
**aparelho** (390) e olha a escala do `visualViewport`. Foi assim que o bloco de
Ajustes 25 px largo demais passou da primeira vez.

**`waitForSelector('#overlay:not(.open)')` nunca resolve.** Espera o elemento
ficar *visível*, e a folha fechada é `display: none`. Use
`waitForSelector('#overlay.open', { state: 'hidden' })`.

**Foco automático com atraso não pode roubar o foco.** `openForm` põe o foco no
slug com um `setTimeout` de 100 ms (só no evento novo), depois que a folha abre.
Até a v2.0 o timer focava sempre — e quem já tinha tocado noutro campo nesse
intervalo perdia o foco no meio da digitação: o texto caía no slug. O
`verifica:painel` falhava assim de vez em quando (a URL da pasta do Drive dentro
do slug, e "URL inválida" ao salvar). Agora o timer só foca se o foco ainda não
estiver dentro da folha (`#overlay`), e o roteiro prende isso ("a folha nova
não tira o foco de quem já está num campo"). Vale para qualquer foco
automático: confira onde o foco está antes de mudá-lo.

**O toast dura 3 s.** Uma checagem que espera outro toast logo depois de uma ação
lê o antigo. O roteiro chama `someAviso()`, que tira o aviso da vez na hora, em
vez de esperar os 3 s.

**Teste que conta tentativas contra um limite de janela fixa precisa parar o
relógio.** Os limites de login usam janelas alinhadas ao relógio
(`Math.floor(Date.now() / (windowSecs * 1000))`, em `src/counters.js`: 10 min na
rajada, 15 min no alerta de senhas erradas). Um teste que cai na virada (xx:00,
xx:10…) vê a contagem zerar no meio e falha sem defeito no código — foi o que a
CI viu em 11/10/2026, às 12:30:00. `tests/security.test.js` ("rate limit do
login não se auto-sabota") e `tests/login-turnstile.test.js` param o `Date` no
meio de uma janela (`vi.useFakeTimers({ toFake: ['Date'] })`).

**O login mora em `/dashboard`.** Esperar "a URL ser `/dashboard`" já vale antes
do `POST`; `entraNoPainel()` espera a **navegação do envio**.

**Um Worker local por vez.** `sobeWorker()` troca o `fetch` global e `fecha()` o
restaura. Dois abertos ao mesmo tempo restauram o `fetch` na ordem errada.

**O Chromium do roteiro está em en-US.** Nas capturas, `<input type="date">` mostra
`mm/dd/yyyy`; num celular em pt-BR mostra dd/mm/aaaa. `fill()` aceita ISO.

---

## 17. Pendências e limitações conhecidas

Estado em 12/10/2026, contra o código (as primeiras foram achadas em 10/10). Cada
uma foi reproduzida no Chromium ou conferida no fonte. Quando alguma for
corrigida, apague a linha — e as referências a ela nas outras seções (`grep
§17`), se houver. O que já foi corrigido na v2.0 está em §18.

**Comportamentos a conhecer**

- **Mudanças no painel levam até 1 min para aparecer no site**: 30 s do cache do
  isolate, mais até 30 s para o KV chegar aos outros locais da Cloudflare
  (`cacheTtl: 30` nas leituras públicas). O toast de salvar diz o prazo (§6.2).

**Verificação**

- O roteiro mede alvos de toque em todas as seções que visita, e liga o modo
  "Selecionar vários" para medir as caixas e a barra; o Tab percorre a lista, a
  folha, as Métricas, Pedidos e Ajustes (no computador).

---

## 18. Histórico do redesenho

**Antes** (o painel que o #220 descreve: "~1900 linhas de template" quando foi
aberto). Ele tinha crescido por acréscimo:

- **Quatro abas de texto no topo** — Eventos, Métricas, Config., Solicitações —,
  com o contador de pendentes grudado no texto da última. Rolar de volta para o
  topo era o preço de trocar de seção.
- **Seis botões de ícone por linha de evento**, todos do mesmo tamanho e sem
  rótulo (destaque, olho, galeria, editar, duplicar, lixeira; só `title` e
  `aria-label`). O estado — destaque e oculto — era a **cor** de dois ícones, e o
  filtro de status um `<select>`. Em 360 px sobrava pouco para o título, e a
  correção foi "só no CSS", com um comentário admitindo que o card era escrito
  duas vezes.
- **Um formulário de ~20 campos numa coluna só**, sem rótulos ligados aos campos
  (não havia `for=`: tocar no texto não focava o campo, e o leitor de tela lia o
  campo sem nome).
- **"Config." misturando** selo de agenda, categorias, backup, planilhas e senha
  numa rolagem só; a "zona de perigo" era a única separação.
- **Dois pontos de quebra de layout** (599 e 600 px).

**O pedido** (#220, do dono, em 29/09/2026, "para um momento mais calmo"): barra
de baixo no celular; formulário em blocos recolhíveis, o essencial primeiro;
botões de verdade — 44 px, "Salvar" fixo no rodapé, ação destrutiva separada e
com confirmação; lista em cartões com filtro rápido de status; retorno de ação
(carregando, salvo, erro). Restrições que não mudam: sem build de front-end, sem
handler inline, sem escrita a mais no KV, scripts emitidos no lint e no tsc,
pares cliente/servidor presos. **Pronto quando**: o dono consegue, só pelo celular
e sem zoom, entrar, criar e editar um evento, marcar entregue, responder um
pedido de remoção e trocar a senha.

**Depois** (10/10/2026):

- uma nav com ícone e rótulo (Eventos, Pedidos, Métricas, Ajustes), barra
  lateral ou de baixo conforme a tela;
- filtros em um bloco só, com chips de status;
- o card com miniatura maior, linha de meta e estado escrito; "Editar" e "Galeria"
  com rótulo; o resto no "⋯", com a exclusão separada — e **uma função só** para
  o servidor e o navegador (e o achado do `keepNames`, §5);
- o formulário em seis blocos recolhíveis, com atalhos, resumos e validação que
  abre o bloco certo;
- Ajustes em três grupos e ações sensíveis marcadas; Métricas ganharam os blocos
  de resumo (o contêiner existia vazio);
- 16 px nos campos, alvos de 44 px, sem realce de toque, e o vazamento lateral
  corrigido (`minmax(0, 1fr)`);
- `tests/painel.test.js` e `npm run verifica:painel` (e, para ele, o
  `worker-local.mjs`, o gancho `node-com-workers.mjs` e o harness do
  `docs/VERIFICACAO.md` §2, agora versionado).

**O que não mudou**: os endpoints, os ids dos campos, `data-onclick` e
`data-action`, a tela de login e as escritas no KV.

**Depois do redesenho, na v2.0** (o mesmo PR #236):

- a seção **Métricas** virou o painel de gráficos do §8 (#215), com o endpoint
  novo da série por dia;
- **Ajustes** ganhou o quarto grupo, **Sobre**, com a versão do site (2.0.0) e o
  resumo do que ela trouxe; a versão também aparece na barra lateral;
- o texto passou a **contraste AA** (inclusive os selos e as linhas de e-mail dos
  pedidos), o **toast virou região viva**, o que fica atrás de um diálogo passou
  a `inert`, todo campo ganhou nome e contorno de foco, e no celular os campos
  têm 44 px e os itens do menu "⋯", 48 px (§12, §13);
- a **lista de eventos** conta e explica o que mostra: a contagem é a da lista
  filtrada (com uma categoria escolhida, não o site inteiro), "1 evento ativo"
  no singular, e a lista vazia diz a combinação de filtros (§4.1);
- o **aviso de novidade** desligado e religado na mesma edição reinicia o
  contador, como a dica do campo prometia (§6.2);
- esvaziar as **fotos de capa** tira a capa do evento — antes a antiga ficava, e
  uma foto retirada continuava no card da galeria e no topo da página do
  projeto (§6.2);
- a **sessão que cai no meio de uma edição** leva ao login sem o "Sair do site?"
  do navegador, e o rascunho volta ao entrar (§6.3);
- o **selo de Pedidos** não aparece mais vazio com zero pendentes: `hidden`
  esconde sempre, em toda a página (§16);
- "**Sem categoria**" tira a categoria de um evento (o servidor recusava o
  vazio), e "**Ocultar/Mostrar**" manda só a visibilidade — mandava o evento
  inteiro e desfazia o que outro aparelho tivesse editado (§10);
- o formulário percebe a **URL digitada** num evento novo (fechar pergunta, e o
  rascunho a devolve) e o resumo do bloco acompanha **adicionar, remover e colar
  fotos**; a folha nova não rouba mais o foco de quem já está num campo (§16);
- a **aba ativa** fica branca também no celular (o hover do toque a apagava);
  "Adicionar foto", os botões das confirmações e o × de excluir categoria
  passaram a 44 px no toque; e o CSS do desenho antigo que nada usava saiu;
- os **pedidos de remoção** passaram a uma chave por pedido (#198): resolver
  grava só o registro do pedido (§14);
- as páginas curtas do painel ("temporariamente indisponível", "não
  configurado") viraram documento de verdade, legíveis no celular;
- numa **prévia de PR**, a faixa "PRÉVIA" fica por cima do painel, com o menu
  "Testes" (README, "Prévia de PR");
- nas telas de toque, as caixas do "Selecionar vários" e os toggles passaram a
  receber o toque em 44 × 44 (o tamanho visível segue o mesmo; §13);
- a **seleção em massa** só tem o que está à vista (filtrar tira da conta o que
  saiu da lista, §4.4), e a barra do "Selecionar vários" empilha os pares no
  celular (§13);
- o **backup** com a sessão expirada leva ao login, em vez de mostrar o JSON do
  erro, e Ajustes com texto não salvo pergunta antes de sair (§9).

---

## Documentos relacionados

- [`README.md`](../README.md) — o resumo do painel, rotas, autenticação, galeria própria.
- [`RETOMADA.md`](../RETOMADA.md) §5.14 — o card e o bundle; §5.1 — a CSP e o handler inline.
- [`docs/VERIFICACAO.md`](./VERIFICACAO.md) — o harness local (§2), o navegador de verdade (§3) e `verifica:painel`.
- [`TODO.md`](../TODO.md) — "Plano gratuito" (a cota), "Uma regra escrita duas vezes", "O que roda em produção é o bundle".
- [`src/ui/dashboard.js`](../src/ui/dashboard.js), [`tests/painel.test.js`](../tests/painel.test.js), [`scripts/verifica-painel.mjs`](../scripts/verifica-painel.mjs), [`scripts/worker-local.mjs`](../scripts/worker-local.mjs), [`scripts/node-com-workers.mjs`](../scripts/node-com-workers.mjs).
