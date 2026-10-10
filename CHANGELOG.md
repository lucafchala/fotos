# Changelog

O que mudou em cada versão do site, do ponto de vista de quem usa e de quem
mantém. O detalhe técnico de cada item está no PR e nos documentos citados.

A **2.0.0** é a primeira versão com número: antes dela o projeto não numerava
versões, e o histórico está nos PRs e no git. O número mora em dois lugares
que andam juntos — `package.json` e `VERSAO` em `src/config.js` (há teste que
confere) — e aparece no painel (barra lateral e *Ajustes → Sobre*).

## [2.0.0] — ainda não publicada

> Merge é deploy. Esta versão está no PR #236 e só vai para produção quando o
> dono aprovar — depois de testar na [prévia do PR](./README.md#prévia-de-pr-testar-antes-do-merge).

### Novo

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
  "PRÉVIA", e-mails com "[PRÉVIA]" no assunto e um controle do Turnstile para
  testar cada salvaguarda (passa, caixa, bloqueia, servidor recusa, script
  bloqueado). Ligar exige três passos no painel da Cloudflare — README,
  "Prévia de PR".
- **Versão do site** à vista no painel, com o resumo do que esta versão trouxe.

### Melhorado e corrigido

- **Contraste do texto apagado do painel**: `#555` → `#8a8a8a` (de 2,5:1 para
  5,3:1 sobre os blocos — AA). Datas, dicas e rótulos ficam legíveis no
  celular. Há teste que calcula o contraste das próprias cores da página.
- **Celular**: campos de 16 px (o iPhone não dá zoom ao tocar), alvos de toque
  de 44 px, e um bloco de Ajustes 25 px largo demais que fazia o celular
  afastar a página inteira.
- **Avisos do painel** quebram linha em vez de sair pelas bordas da tela.
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

### Segurança e LGPD

- **Registro das operações (ROPA)**: §5 cobre a contagem por dia e por modo
  do portão (continua sem dado pessoal); §10, novo, registra o ambiente de
  prévia — com a limitação honesta de que nada lá é podado sozinho.
- **Política de retenção**: série por dia por **400 dias**, podada
  automaticamente; o ambiente de prévia, com limpeza manual.
- **Política de privacidade** atualizada (10/10/2026): a contagem por dia, sem
  identificar ninguém, apagada depois de 400 dias.
- **Pedidos de remoção nunca entram na prévia** ao restaurar um backup: são
  dados de terceiros, e a prévia manda e-mail de verdade.
- A contagem do modo de entrada no portão é só um número — sem projeto, IP ou
  identificador.

### Para quem mantém

- `npm run verifica:painel`: o painel logado num Chromium de verdade, contra o
  `src/index.js` de verdade (`scripts/worker-local.mjs`), no iPhone, no
  Android e no computador — 125 checagens, das Métricas com série sintética à
  troca de senha. Ver `docs/VERIFICACAO.md`.
- Testes novos: `tests/metricas.test.js`, `tests/metricas-painel.test.js`,
  `tests/previa.test.js`, `tests/painel.test.js`, `tests/galeria.test.js`, e a
  atomicidade da série por dia na suíte `workers`.
- **Nenhuma migração** de Durable Object nem de D1 nesta versão: o deploy
  segue o caminho normal (versão sem tráfego → smoke → promoção).
