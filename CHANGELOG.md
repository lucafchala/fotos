# Changelog

O que mudou em cada versão do site, do ponto de vista de quem usa e de quem
mantém. O detalhe técnico de cada item está no PR e nos documentos citados.

A **2.0.0** é a primeira versão com número: antes dela o projeto não numerava
versões, e o histórico está nos PRs e no git. O número mora em dois lugares
que andam juntos — `package.json` e `VERSAO` em `src/config.js` — e aparece no
painel (barra lateral e *Ajustes → Sobre*), na faixa da prévia e em
`versaoSite` no `/api/healthz`.

**Como as versões funcionam** (a regra completa está no comentário de `VERSAO`,
em `src/config.js`): versionamento semântico. **Maior** quando o dono precisa
fazer algo ou algo deixa de valer (formato de dado, secret novo, o que o
visitante aceita); **menor** para função nova; **correção** para o mesmo
comportamento, melhor. PR que não muda o que vai ao ar não sobe número. O
número sobe uma vez por PR, com a seção dele aqui no topo, marcada "ainda não
publicada" até o merge — merge é deploy. `tests/versao.test.js` reprova se
`package.json`, `VERSAO` e a primeira seção deste arquivo divergirem.

## [3.0.0] — ainda não publicada

**Maior** porque muda o que o visitante aceita (Termos e Privacidade
2026-10-29) e o formato do backup (v3).

### Novo

- **Galerias dos álbuns públicos no Google.** `/galeria/<slug>` de álbum
  público sai com `index, follow`; família, privado, "Em breve", não
  listado, prévia de PR e a visão do dono continuam `noindex`. As galerias
  entram no `/sitemap.xml`, e o `/sitemap-galerias.xml` aponta um sitemap
  de imagens por galeria (até 1000 fotos, com `lastmod`). Título "Fotos de
  <evento> — <data>", canonical, JSON-LD `ImageGallery` ligado ao `Person`,
  `og:image` da capa e alt "<evento> — foto i de n". Downloads fora dos
  buscadores (`Disallow` no `robots.txt`, `X-Robots-Tag: noindex`,
  `rel="nofollow"`); `ai-train=no` mantido. Foto oculta sai do HTML e do
  sitemap em até 2 minutos (o prazo de qualquer mudança do painel); para
  tirar do Google com urgência, Search Console →
  Remoções (docs/RELEASE.md).
- **Download do arquivo exato.** "Tamanho máximo" entrega o original do
  Drive, byte a byte, com o nome exato (sem o prefixo do projeto). "Para
  redes" entrega, também sem alterar, o arquivo correspondente da pasta "Para
  o Instagram" do projeto; foto sem versão lá não oferece "para redes". Nada
  é redimensionado no download.
- **Salvar por aparelho.** Android e computador baixam o arquivo direto, sem
  a folha de compartilhar. No iPhone e no iPad, "Salvar no Fotos" abre a
  folha do sistema com o arquivo exato ("Salvar imagem" põe direto no app
  Fotos), e "Baixar arquivo" salva no app Arquivos.
- **Compartilhar as favoritas** (#213). Com o filtro "Favoritas", o botão
  "Compartilhar as favoritas" gera um link `#sel=…` que abre a galeria só
  com essas fotos ("Seleção recebida", com "Guardar nas minhas favoritas").
  Nada gravado no servidor; até 300 fotos; família e privado continuam
  pedindo o passe.
- **Galeria nas métricas do painel.** Aberturas da galeria (uma por hora por
  navegador; o dono não conta) e fotos baixadas por versão, por dia: linha
  da galeria no gráfico de acessos, bloco "Fotos baixadas na galeria",
  cartões, ranking, tabelas e CSVs. A taxa de abertura passa a ser (Drive ou
  galeria) ÷ visitas.
- **Backup v3 com o registro de consentimento.** A tabela
  `image_use_consent` entra no backup em formato compacto (até as 1500
  linhas mais recentes; acima disso o arquivo diz que é parcial, e o
  `wrangler d1 export` é o caminho completo — docs/RELEASE.md). A
  restauração só acrescenta (`INSERT OR IGNORE`), valida cada linha e é
  pulada na prévia. Backups v1 e v2 restauram como antes. O arquivo de
  backup passa a ter IP: ROPA e política de retenção atualizadas.
- **Declaração de acessibilidade** publicada em
  `/legal/declaracao-de-acessibilidade`.

### Mudou

- **Termos e Privacidade 2026-10-29.** A galeria dos projetos públicos abre
  sem aceite; as galerias públicas podem aparecer em buscadores; cookies
  `gv_…` e `galeria` listados; cópia do registro de aceite no backup. Os
  textos legais valem sem revisão jurídica, por decisão do responsável
  (#125 fechada).
- **Capas responsivas** (#141). Carrossel, visualizador e pré-carga pedem
  800, 1200 ou 1600 px conforme os pixels físicos da tela, em vez de sempre
  1600.
- **Turnstile só na hora.** Na página do projeto ele carrega na primeira
  interação ou ao abrir o portão. Lighthouse celular (cópia local do
  `/ecp125`): desempenho 82–86 → 95–99, TBT 470–620 → 116–250 ms.
- **Galeria mais leve na primeira tela**: só as fotos da primeira tela
  carregam de imediato, escada da grade de 100 em 100 px até 800, CSS do
  visualizador fora do `<head>`, coração em CSS. Lighthouse celular local:
  SEO 50 → 92, desempenho 72–80 → 84–90.
- **`scripts/smoke.sh`** reprova HSTS abaixo de 1 ano (a borda da Cloudflare
  respondia 180 dias no domínio próprio — #257).

- **Limite por IP no download da galeria.** Cada IP tem um balde de fichas
  (6 mil de rajada, 20 mil por hora: um Wi-Fi de evento com 750 pessoas e
  ~20 fotos cada cabe com folga); esgotado, responde 429 com `Retry-After` e
  a galeria mostra a espera em vez de repetir. O dono não passa pelo balde.
- **Robôs conhecidos fora da contagem.** Visitas do projeto e aberturas da
  galeria ignoram o que o Cloudflare marca como robô verificado e uma lista
  curta de User-Agents (Googlebot, Bingbot, prévias de link...). Os números
  do painel ainda podem incluir robôs desconhecidos.
- **Taxa de abertura limitada a 100%**, em cartões, ranking e tabela:
  "aberturas (Drive ou galeria) ÷ visitas, limitado a 100%" (quem chega à
  galeria pelo Google não passa pela página do projeto).

### Corrigido

- **CLS da página do projeto** (0,334 no PageSpeed): a capa e o carrossel
  reservam uma caixa 3:2 antes de a foto chegar, com a foto inteira dentro.
- **Corrida do portão**: abri-lo antes de o script do Turnstile terminar
  caía no caminho sem JavaScript.
- **Testes instáveis** do portão do Drive e do login, que dependiam do
  relógio real sob carga.
- **Compartilhar e a segunda leitura do iPhone não contam como download**
  (`?c=0`, só leitura; o arquivo servido é o mesmo). "Salvar no Fotos"
  recusado pelo sistema mantém a folha aberta com a mensagem.
- **Lista "para redes" não confunde tetos**: o cache da listagem leva o teto
  de páginas na chave; pasta do Instagram igual à da galeria vale como "sem
  pasta do Instagram". O casamento de nomes (6 mil fotos) fica em cache.
- **Restaurar backup**: o consentimento é restaurado antes dos pedidos de
  remoção, e uma seção que falha não esconde as outras.

## [2.2.1] — ainda não publicada

### Mudou

- **Dependências de desenvolvimento** atualizadas num PR só (juntando os PRs
  do Dependabot #228, #237, #238, #240 e #243): `eslint` 10.13.0, `wrangler`
  4.152.0, `@cloudflare/workers-types` 5.20261026.1, `playwright-core`
  1.64.1 (Chromium 156 nos roteiros) e `@cloudflare/vitest-pool-workers`
  0.23.0. Nada muda no que vai ao ar além do bundle gerado pelo `wrangler`
  novo. O `vitest-pool-workers` avisa que passou a se chamar
  `@cloudflare/vitest-plugin`; a troca fica para o #180.

## [2.2.0] — ainda não publicada

### Novo

- **Ocultar uma foto da galeria.** O dono abre a foto na galeria e toca no
  olho ("Ocultar dos visitantes"): a foto some para o público em até 2 min —
  o visitante recebe a lista já sem ela, e o download dela vira 404. O dono
  continua vendo, apagada e com o selo "Oculta", e toca de novo para mostrar.
  É o caminho de um pedido de remoção (LGPD) enquanto a foto não sai do
  Drive; o texto dos pedidos no painel diz isso. Até 500 por projeto, uma
  escrita de KV por clique.
- **Downloads da galeria contados por versão.** Cada foto baixada por
  visitante soma em "para redes" ou "tamanho máximo" (Durable Object, nunca
  KV por visitante). O painel mostra a coluna "Galeria ↓" nas métricas, e o
  CSV ganhou `baixarRedes` e `baixarMax`.

### Mudou

- **Documentação** deixa de chamar a galeria de "prévia só do dono": diz quem
  vê (álbum público, todos; família e privado, com o passe; "Em breve",
  ninguém).

## [2.1.1] — 29/10/2026

### Mudou

- **Cabeçalho da galeria no celular.** O botão Compartilhar vira só o ícone
  em telas estreitas (o nome continua para leitor de tela), e os quatro
  botões cabem numa linha: as fotos sobem na tela. Acima do título, um link
  "‹ Página do projeto" para o visitante voltar ao álbum — antes só o dono
  tinha esse caminho, na faixa do painel.
- **Selo "Novidade" do popup** com um ícone desenhado no lugar do emoji ✨,
  que aparecia como um quadrado em aparelhos sem fonte de emoji.

### Corrigido

- **Roteiro de navegador da prévia** (`npm run verifica:previa`) voltou a
  passar: o popup da nova galeria cobria a faixa da prévia e o clique
  esperava 30 s. O roteiro entra como quem já viu o popup, e o popup ganhou
  roteiro próprio em `scripts/verifica-evento.mjs` (abre centralizado, não
  fecha durante a contagem, fecha depois e não volta; "Abrir no Drive" fecha
  na hora e abre o portão).

## [2.1.0] — 29/10/2026

### Novo

- **Galeria própria aberta aos álbuns públicos** (#244). `/galeria/<slug>` de
  um álbum público abre para qualquer visitante, sem login e sem o portão do
  Drive; nos álbuns de **família e privados**, só com o **passe "galeria"** —
  um cookie assinado de 12 h, preso ao caminho `/galeria/<slug>`, que o
  portão do Drive emite depois da declaração de acesso. Álbuns "Em breve"
  continuam fechados (o mesmo 404).
- **Popup "Nova galeria de fotos"** na página do álbum público. Aparece uma
  vez por visitante, centralizado, não fecha nos primeiros 4 segundos, lista
  as funções e mantém o link de texto para o Drive.
- **Ícone de bug no cabeçalho da galeria**, que leva ao formulário de suporte
  (`/suporte`).
- **Botão Compartilhar no topo da galeria.** Compartilha a página do projeto
  (com capa e resumo nas redes); no celular abre o menu do aparelho, no
  computador copia o link.

### Mudou

- **Página do álbum público: a galeria é o caminho principal.** O botão
  principal e o botão fixo viram "Ver e baixar as fotos" e levam direto à
  galeria, com instruções; o Google Drive vira opção secundária ("Prefere o
  Google Drive? Abrir no Drive").
- **A galeria deixa de falar em "prévia".** O título não diz mais; a faixa do
  dono (atalhos do painel e "Atualizar lista") só aparece para o dono logado;
  o `?atualizar` só relê o Drive para ele; e o aviso "A pasta também tem N
  vídeos" saiu.
- **Fotos maiores no celular.** A altura-alvo da linha da grade sobe de 118
  para 300 px (foto deitada ocupa a largura toda; em pé, duas por linha), e as
  miniaturas vão até 1600 px de largura para não borrar em tela densa.
- **Popup com ícones**: um ícone por função, animação de entrada e o botão
  "Ver a nova galeria →".

### A rever

- **Galeria dos álbuns públicos sem registro de consentimento nem Turnstile.**
  Decisão do dono, para reavaliar — já anotada no ROPA.

## [2.0.0] — 29/10/2026

> Publicada em 29/10/2026 (PR #236).

### Novo

- **Beacon de performance com INP, CLS e erros de JavaScript.** O beacon
  amostrado de `/api/perf` passa a medir interação (INP) e estabilidade
  visual (CLS) e a relatar até 3 erros de JS por visita (`error` e
  `unhandledrejection`), com mensagem de no máximo 200 caracteres e sem URL,
  e-mail nem token. Segue anônimo (sem cookie) e **sem escrita em KV**: tudo
  vai para o log (`wrangler tail`) e, se existir, para o Analytics Engine, com
  teto de 120 erros por minuto por isolate.
- **"Sair dos outros aparelhos"** em Ajustes → Conta. Encerra a sessão do painel
  em todos os aparelhos menos o atual (`POST /api/sessions/revoke-others`); em
  outro lugar pode levar até 30 s.
- **Lembrete de backup** em Ajustes → Dados: "Último backup: hoje / ontem / há N
  dias", que vira aviso se o backup nunca foi baixado ou tem mais de 30 dias.
  Nova chave KV `backup:ultimo`, gravada pelo `GET /api/backup` (o `HEAD` não
  conta).
- **Galeria própria, em prévia só do dono** (#235). As fotos da pasta do Drive
  de cada projeto dentro do site, em `/galeria/<slug>`: grade justificada na
  proporção real, visualizador na resolução física da tela, zoom que busca
  degraus maiores até o original, downloads "para redes" (2048 px) e "tamanho
  máximo" (o original, pela Drive API, com a chave só no servidor), seleção de
  várias fotos e "Salvar na galeria" no celular. Para qualquer outra pessoa,
  a rota é o mesmo 404 de uma rota inexistente. Precisa do secret
  `GOOGLE_DRIVE_API_KEY` (passo a passo no README, "Galeria própria").
- **Painel em blocos** (#220). Uma navegação só — barra lateral no computador,
  barra de baixo no celular —, card de evento com o estado escrito em selos e
  um menu "⋯", formulário em seis blocos recolhíveis com resumo, Ajustes em
  grupos (Site, Dados, Conta, Sobre) com as ações sensíveis marcadas.
  Referência completa em [`docs/PAINEL.md`](./docs/PAINEL.md).
- **Métricas com gráfico** (#215). Contagem por dia (no mesmo Durable Object,
  na mesma gravação do total — nenhuma chamada a mais por visita), gráfico de
  visitas × aberturas do Drive com a cruz que mostra o dia (mouse, toque e
  teclado), tabela e CSV da série, comparação com o período anterior, média
  por dia da semana, os **modos do portão** (verificação automática, código
  por e-mail, sem JavaScript) e cada projeto com a sua curva. Filtro de 7, 30
  ou 90 dias e por projeto.
- **Prévia de cada PR** (Cloudflare Worker Previews). Um site de teste por PR,
  com o mesmo código e configuração de produção e **dados próprios**, faixa
  "PRÉVIA" e e-mails com "[PRÉVIA]" no assunto. Ligar exige três passos no
  painel da Cloudflare — README, "Prévia de PR". Os segredos das prévias
  moram no build (`PREVIA_*`) e o `npm run previa` os leva a cada prévia a
  cada push: a configuração base da Cloudflare só vale na criação de cada uma.
- **Menu "Testes" na faixa da prévia**, para ver cada salvaguarda funcionar
  sem esperar ela acontecer. *Simulações*, só no navegador de quem liga: o
  Turnstile (passa, caixa, bloqueia, servidor recusa, script bloqueado), o
  e-mail (**tudo para o dono** — testar com endereço inventado sem escrever
  para ninguém —, envio que falha, sem e-mail), o **portão do Drive lotado**
  (a espera "muita gente acessando agora" e o código por e-mail no fim), o
  banco fora (KV que não lê ou não grava, D1 do consentimento), a chave do
  Drive da galeria e a rede lenta. *Ações*, com o painel aberto: gerar 90 dias
  de **métricas de exemplo**, apagá-las, zerar os limites do aparelho. Do
  roteador para dentro, o código é o de produção.
- **Versão do site** à vista no painel, com o resumo do que esta versão trouxe.

### Melhorado e corrigido

- **Um handler que rejeita agora vira 500 e alerta.** Em `worker.fetch`, as rotas
  devolviam `handleX(...)` dentro do `try/catch` sem `await`: a rejeição de um
  handler assíncrono (por exemplo, o KV recusando a leitura em `GET /api/backup`)
  escapava do catch-all, sem página 500 e sem o e-mail de `sendErrorAlert`.
- **Segurança da prévia de PR.** Restaurar um backup numa prévia (pública, com o
  Turnstile de teste) entregaria o link real do Drive dos álbuns `private` e
  `family` a quem chamasse `POST /api/drive-link`. Agora, na prévia, o restore
  troca esses links por um falso.
- **Dica sob "Visível na galeria" (#128).** "Oculto" quer dizer não listado: some
  da página inicial, mas quem tem o link ainda abre.
- **Contraste AA em todo texto do painel.** O cinza apagado era `#555` (2,5:1
  sobre os blocos) e virou `#8a8a8a` (5,3:1): datas, dicas e rótulos ficam
  legíveis no celular, na rua. Abaixo de 4,5:1 também estavam os selos
  "Atrasado" (3,4:1) e "Arquivado" (3:1), o texto dos botões de excluir
  (3,4:1), as dicas "(opcional)" dos rótulos (2,5:1) e — justo a linha que o
  dono precisa ler — a falha de envio de e-mail num pedido de remoção (3,2:1).
  Há teste que calcula o contraste das próprias cores da página, o de cada
  selo sobre o card, e que proíbe cor de texto escrita à mão em linha.
- **Foco visível em tudo que recebe foco.** Campo de texto, seletor e caixa
  de texto ganham o mesmo contorno dourado de 2 px dos botões; antes só a
  borda escurecia (1,7:1 sobre o fundo — quem navega pelo teclado não via onde
  estava). Os três toggles do formulário não mostravam foco nenhum (o
  checkbox é invisível; agora o contorno vai no trilho); o contorno dos chips
  de filtro e dos atalhos do formulário era cortado pela faixa que rola, e o
  do campo da URL, pela caixa do prefixo. O gráfico de acessos em foco também
  (o anel cinza tinha 2,1:1).
- **O selo de Pedidos sumia de verdade com zero pendentes.** Ele era escondido
  com o atributo `hidden`, mas a classe dele tinha `display: inline-flex`, que
  vence o `hidden`: sem pedido nenhum, aparecia um círculo vermelho vazio ao
  lado de "Pedidos" — o estado normal do painel. Agora `hidden` esconde sempre,
  em toda a página.
- **"Sem categoria" tira a categoria de um evento.** O servidor recusava o
  vazio e mantinha a categoria antiga; só a seleção em massa conseguia limpar.
- **"Ocultar/Mostrar" não desfaz mais o que outro aparelho editou.** Mandava o
  evento inteiro como a página o conhecia ao abrir; agora manda só a
  visibilidade, como o "Destacar".
- **O formulário percebe mais alterações.** Num evento novo, digitar só a URL
  e fechar não perguntava antes de descartar (e o rascunho de sessão expirada
  voltava sem a URL); e o resumo do bloco recolhido ("2 capas") não acompanhava
  adicionar, remover ou colar fotos.
- **A aba ativa fica branca no celular.** A aba recém-tocada fica "em hover" no
  toque, e a cor do hover apagava a da ativa: só o ícone dourado dizia onde se
  estava.
- **A folha de "Novo evento" não rouba mais o foco.** Ela põe o cursor na URL
  100 ms depois de abrir — e, se nesse meio-tempo a pessoa já tinha tocado
  noutro campo, o que ela digitava ia parar na URL. Agora só põe se ninguém
  estiver num campo da folha.
- **Celular**: campos de 16 px (o iPhone não dá zoom ao tocar), alvos de toque
  de 44 px — agora também a busca, os filtros e o seletor de projeto das
  Métricas, que tinham 41–43 px, os botões das confirmações e o "Adicionar
  foto", que tinham 35–40, o × de excluir categoria, que tinha 20, e as caixas
  do "Selecionar vários" e os toggles —, os itens do menu "⋯" com 48 px na folha
  de baixo (uma regra de toque posterior os baixava para 44), e um bloco de
  Ajustes 25 px largo demais que fazia o celular afastar a página inteira.
- **Leitor de tela**: os avisos do painel são anunciados (o toast virou região
  viva) e quebram linha em vez de sair pelas bordas; com uma folha ou uma
  confirmação aberta, a página atrás fica inerte (nem o foco nem o leitor
  escapam para lá); e todo campo tem nome — o "Quando o aviso some", a caixa de
  colar links e as linhas de URL das fotos só tinham o texto de exemplo.
- **A lista de projetos conta certo.** "1 evento ativos" virou "1 evento
  ativo"; com uma categoria escolhida, "Todos" contava os eventos do site
  inteiro, não os da lista; e uma categoria sem eventos dizia "Nenhum evento
  ainda. Toque em Novo evento…" — agora diz a combinação de filtros.
- **Sessão expirada no meio de uma edição.** O painel já guardava um rascunho
  e voltava ao login, mas o navegador perguntava "Sair do site? As alterações
  podem não ser salvas" — falso, e quem respondia "Ficar" seguia numa página
  sem sessão, onde cada ação perguntava de novo. Agora vai direto, e entrar de
  novo devolve a edição.
- **"Novas fotos": religar reinicia o contador**, como a dica do campo
  promete. Desligar e ligar de novo na mesma edição mantinha a hora antiga (era
  preciso salvar desligado no meio); agora reinicia — e conta como alteração,
  então fechar sem salvar pergunta antes de descartar.
- **Esvaziar as fotos de capa tira a capa.** A primeira foto antiga continuava
  no card da galeria e no topo da página do projeto — uma foto retirada por um
  pedido de remoção seguia no ar.
- **"Painel temporariamente indisponível" legível no celular.** As duas
  páginas curtas do painel (KV fora, painel não configurado) eram um parágrafo
  solto, sem `viewport`: o celular as desenhava em 980 px e o texto saía
  minúsculo — justo quando o dono abre o painel pelo celular para entender o
  que caiu. O `verifica:previa` pegou.
- **Pedidos de remoção, um por chave** (#198). Eram um array único, regravado
  inteiro por cinco caminhos: dois pedidos no mesmo instante, ou um pedido
  chegando durante um "resolver", e um deles sumia do painel (o e-mail ao dono
  sempre saiu). Agora cada pedido tem a sua chave e nada regrava o que não é
  seu. O array antigo é migrado pelo cron diário, sem perda — até lá o painel
  lê os dois. A lista lê em lotes de 100 (uma operação do KV por lote).
- **O "e-mail enviado" do pedido de remoção** chega ao registro do painel. O
  envio grava o pedido e, depois dos e-mails, grava de novo a mesma chave com
  o resultado — mas o KV recusa a segunda escrita na mesma chave dentro de um
  segundo, e os e-mails costumam voltar antes disso. O carimbo agora espera a
  janela (a resposta do formulário demora até ~1 s a mais).
- **Um defeito que só existia no bundle de produção**: o deploy empacota com
  esbuild + `keepNames`, que embrulha função nomeada em `__name()` — e o card
  do painel, levado ao navegador por `toString()`, quebraria no primeiro
  redesenho. A suíte passava (ela roda o fonte cru); o teste novo aplica a
  mesma transformação do deploy.
- **CodeQL**: o teste da galeria deixou de tirar `<script>` com regex (as duas
  falhas que o CodeQL apontou); o ajudante novo anda como o tokenizador.

- **Salvar um evento diz quando o site mostra a mudança.** O aviso dizia só
  "Evento adicionado!"; agora diz "O site mostra em até 1 min" — 30 s do cache
  do site, mais até 30 s para a Cloudflare espalhar a mudança. O selo da agenda
  diz o mesmo.
- **Baixar o backup com a sessão expirada leva ao login.** O download era um
  link, e o navegador mostrava o JSON do erro; agora é um pedido comum, e o 401
  vai ao login, como no resto do painel.
- **A seleção em massa só tem o que está à vista.** Um filtro que escondia um
  card o deixava na seleção, e a confirmação contava também os escondidos: a
  conta podia dizer 5 com um só card na tela.
- **Celular: a barra do "Selecionar vários" cabe na tela.** Os pares de
  categoria e de acesso empilham; o "Aplicar acesso" saía pela direita, numa
  barra de 398 px num aparelho de 390.
- **Ajustes com texto não salvo pergunta antes de sair** — a senha nova, a
  categoria nova, o selo e o arquivo do restaurar. Antes, só o formulário de
  evento avisava.
- **O "Todos" do "Selecionar vários" acompanha as caixas**: desmarcar um card
  deixava o "Todos" marcado até a lista ser redesenhada.

- **Portão do Drive, quatro acertos.** O texto do código por e-mail não afirma
  mais que ele já foi enviado ("Ao tocar em Enviar código, mandamos…"); o motivo
  do teto de álbuns restritos aparece antes do campo, perto da ação; a janela do
  portão fica acima do aviso de cookies no celular; e o aviso de bloqueador tem
  folga antes do campo de nome.
- **Ícones PNG de verdade.** O `apple-touch-icon` apontava para o SVG, que o iOS
  ignora, e o manifest não tinha PNG. Agora há `/apple-touch-icon.png` (180),
  `/icon-192.png`, `/icon-512.png` e `/icon-512-maskable.png`, gerados por
  `npm run build:icons` (sharp), e toda página liga o manifest. O `/suporte`
  ganhou o canonical que faltava.
- **"Pedir orçamento" (#210).** O botão da página /sobre leva ao /suporte com um
  modelo de mensagem já preenchido (tipo de evento, data, local, pessoas).
- **Contraste AA nas páginas públicas.** Os textos apagados (`text-dim`,
  `text-dim-2`, placeholders) passam de 4,5:1 nos dois temas;
  `tests/contraste-publico.test.js` mede o CSS de cada página.

### Segurança e LGPD

- **A revogação de sessões fecha a janela do cache do KV.** O "Sair dos outros
  aparelhos" — e a troca de senha, que usa a mesma implementação — grava o
  marcador `admin_sessions_corte` (TTL 25 h), que `verifySession` consulta antes
  de renovar o `lastSeen`. Antes, o cache do KV deixava um aparelho revogado
  entrar e a renovação do `lastSeen` ressuscitava a sessão por mais 24 h.
- **CSP estrita aplicada (#126).** Toda página HTML sai com um único cabeçalho
  `Content-Security-Policy`, com `nonce` por resposta e sem `'unsafe-inline'`
  em `script-src` (o `style-src` mantém `'unsafe-inline'`). Violações chegam a
  `/api/csp-report`. Deixou de existir o cabeçalho Report-Only, e os roteiros de
  navegador reprovam qualquer mensagem de CSP no console.
- **Termos 2026-10-18.** O §3 deixa de dizer "acesso restrito a membros da
  família" e "a participantes ou pessoas autorizadas": nos álbuns de família e
  privados o acesso se apoia no consentimento, não em senha. As finalidades não
  mudam (quem aceitou os Termos de 2026-06-18 segue coberto). `TERMS_VERSION`
  sobe, e os novos aceites ficam atrelados ao texto novo.
- **Texto alternativo por foto.** No formulário do projeto, "Descrição das fotos
  (para leitor de tela)": uma linha por foto de capa, na ordem, até 140
  caracteres. A página usa a descrição no carrossel e no visualizador; a foto
  sem descrição segue com o título do projeto.
- **IA e treino.** `robots.txt` e `llms.txt` passam a dizer `ai-train=no` /
  "Training not allowed" em todos os grupos, e os robôs que só treinam (GPTBot,
  ClaudeBot, Google-Extended, CCBot, entre outros) levam `Disallow: /`. Busca e
  resposta de IA continuam permitidas.
- **"Em breve" fora da busca.** A página de um projeto "em breve" manda
  `noindex` e sai do `sitemap.xml` até ser publicada.
- **Cartão de link padrão.** Toda página pública sem foto própria ganha
  `og:image` 1200×630 (`/og-padrao.png`, gerado por `npm run build:icons`).
- **Cron de 5 em 5 minutos só para o Kuma.** O carimbo `cron:last` e as podas
  seguem uma vez por dia, na execução das 03:00 UTC: nenhuma escrita extra no
  KV (288 por dia comeriam quase 30% da cota grátis).
- **Traces a 10%** (`wrangler.toml`), antes do corte do plano grátis de logs em
  1º/12/2026. Os logs seguem em 100%.
- **Álbum de família ou privado: consentimento, não sigilo (#146).** A
  decisão do dono sobre o caminho sem a verificação de segurança (Turnstile
  bloqueado no navegador): ele continua entregando o álbum, mas pede o
  **nome**, para o registro de consentimento não sair anônimo, e cada IP abre
  no máximo **3 álbuns restritos diferentes por dia** por ele — o mesmo
  álbum, quantas vezes precisar, então o público de um evento no Wi-Fi do
  local não esbarra. Passado o teto, a página abre o código por e-mail. As
  declarações foram reescritas para não soarem como senha ("Este é um álbum
  de família: reconheço que as imagens são de uso estritamente particular e
  doméstico."). Com o Turnstile, ou pelo código por e-mail, nada muda.
- **Registro das operações (ROPA)**: §5 cobre a contagem por dia e por modo
  do portão (continua sem dado pessoal); §10, novo, registra o ambiente de
  prévia — com a limitação honesta de que nada lá é podado sozinho.
- **Política de retenção**: série por dia por **400 dias**, podada
  automaticamente; o ambiente de prévia, com limpeza manual.
- **Política de privacidade** atualizada (10/10/2026): a contagem por dia, sem
  identificar ninguém, apagada depois de 400 dias.
- **Pedidos de remoção nunca entram na prévia** ao restaurar um backup: são
  dados de terceiros, e a prévia manda e-mail de verdade.
- **Foto retirada sai também da capa**: esvaziar a lista de fotos de capa de um
  projeto agora apaga a capa gravada (ver "Melhorado e corrigido").
- A contagem do modo de entrada no portão é só um número — sem projeto, IP ou
  identificador.

### Para quem mantém

- `npm run verifica:painel`: o painel logado num Chromium de verdade, contra o
  `src/index.js` de verdade (`scripts/worker-local.mjs`), no iPhone, no
  Android e no computador — 235 checagens em ~45 s, das Métricas com série
  sintética à troca de senha e à sessão que cai no meio de uma edição, com o
  foco (a lista, a folha, as Métricas, Pedidos e Ajustes percorridos pelo
  Tab), os alvos de toque de cada seção, todo `hidden` de fato escondido e o
  que o fluxo grava no KV. Ver `docs/VERIFICACAO.md`.
- O roteiro do painel passou de 211 para 235 checagens, e as escritas no KV por
  aparelho, de 13 para 16 (17 no computador).
- `npm run verifica:previa`: a faixa e o menu "Testes" num Chromium de
  verdade, no celular e no computador — portão lotado de verdade no servidor,
  a saída "Voltar tudo ao normal" com o KV fora, o e-mail desviado para o
  dono, as métricas de exemplo enchendo o gráfico. Os quatro roteiros de
  navegador rodam na CI.
- **Deploy sem o smoke antes da promoção** (#179). O portão que testava a URL
  de preview da versão saiu do `deploy.yml`: a URL nunca veio (`has_preview`
  falso, provável efeito dos Durable Objects) e o passo custava ~60 s e mexia
  na configuração do Worker. Ficam versão sem tráfego, promoção, smoke de
  produção e reversão automática; a verificação anterior ao merge é a prévia
  do PR.
- Testes novos: `tests/metricas.test.js`, `tests/metricas-painel.test.js`,
  `tests/previa.test.js`, `tests/pedidos.test.js`, `tests/painel.test.js`,
  `tests/galeria.test.js`, e a atomicidade da série por dia na suíte
  `workers`.
- Os testes do limite de login rodam com o relógio parado: a janela da rajada
  é fixa e alinhada ao relógio, e uma execução da CI exatamente às 12:30:00
  viu a contagem zerar no meio do teste e falhar sem defeito no código.
- Limpeza: o CSS do desenho antigo que nada mais usava (`.filter-row`,
  `.search-row`, `.info-box` e a segunda regra `.tab-badge`) saiu.
- **Nenhuma migração** de Durable Object nem de D1 nesta versão: o deploy
  segue o caminho normal (versão sem tráfego → promoção → smoke de produção,
  com reversão automática se reprovar).
