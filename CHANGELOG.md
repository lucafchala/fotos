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

## [2.0.0] — ainda não publicada

> Merge é deploy. Esta versão está no PR #236 e só vai para produção quando o
> dono aprovar — depois de testar na [prévia do PR](./README.md#prévia-de-pr-testar-antes-do-merge).

### Novo

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

### Segurança e LGPD

- **A revogação de sessões fecha a janela do cache do KV.** O "Sair dos outros
  aparelhos" — e a troca de senha, que usa a mesma implementação — grava o
  marcador `admin_sessions_corte` (TTL 25 h), que `verifySession` consulta antes
  de renovar o `lastSeen`. Antes, o cache do KV deixava um aparelho revogado
  entrar e a renovação do `lastSeen` ressuscitava a sessão por mais 24 h.
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
  segue o caminho normal (versão sem tráfego → smoke → promoção).
