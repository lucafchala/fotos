<!--
INSTRUÇÕES PARA O DONO — esta parte NÃO aparece na Release (comentário HTML).
O arquivo inteiro é o --notes-file; o texto público começa em "# v2.0.0".

O que vale lembrar
- Merge do PR #236 na main = DEPLOY em produção. Nada abaixo acontece antes disso.
- A tag vai no COMMIT DE MERGE que está na main, nunca no branch do PR
  (ccr-7c9176fd-qf8urr): o branch some ou muda; a main é o que foi para produção.
  Se o merge for "squash" ou "rebase", o commit na main não é o do branch —
  por isso a tag usa origin/main depois do merge, e não o HEAD local.
- Espere o workflow Deploy do merge terminar VERDE antes de tagear. Se o smoke
  de produção reprovar, o workflow reverte sozinho e o commit NÃO está em
  produção: sem tag, sem Release.
- O próprio deploy.yml já cria, a cada deploy verde, uma tag "deploy-AAAAMMDD-
  HHMMSS-<sha>" e uma Release com o mesmo nome (commits desde a anterior). A
  v2.0.0 é um REGISTRO À PARTE, no mesmo commit; não substitui nem apaga a
  automática. O "--latest" abaixo faz a v2.0.0 ficar como "Latest".
- Tags não disparam deploy: o deploy.yml roda só em push na main e no disparo
  manual. (O checks.yml roda em qualquer push, inclusive de tag: lint, tipos e
  testes, somente leitura, sem efeito em produção.)
- Antes do merge, se quiser: o topo do CHANGELOG ainda diz "ainda não
  publicada" e cita o PR #236; troque pela data do merge.

Depois do merge, num clone atualizado, na raiz do repositório:

  # 1. esperar o Deploy do merge ficar verde (e conferir que o sha é o do merge)
  gh run list --workflow Deploy --branch main --limit 3

  # 2. conferir /api/healthz: ok:true e versaoSite 2.0.0
  curl -s https://fotos.lucafchala.com/api/healthz

  # 3. tag anotada no commit de merge (o da main, o mesmo que o Deploy publicou)
  git fetch origin main
  MERGE=$(git rev-parse origin/main)
  git log -1 --oneline "$MERGE"        # conferir: é o commit de merge do #236
  git tag -a v2.0.0 "$MERGE" -m "v2.0.0"
  git push origin v2.0.0

  # 4. Release, com este arquivo como texto (ele chega à main com o merge;
  #    rode a partir da main atualizada: git switch main && git pull)
  gh release create v2.0.0 --verify-tag --latest --title "v2.0.0" \
    --notes-file docs/NOTAS-v2.0.0.md

Se errar a tag antes de publicar a Release: git tag -d v2.0.0 e
git push origin :refs/tags/v2.0.0 (só enquanto ninguém usou a tag).
-->

# v2.0.0

A v2.0.0 reorganiza o painel em blocos, traz a galeria própria (em prévia, visível só ao dono), métricas com gráfico, uma prévia de teste para cada PR e uma rodada ampla de correções de acessibilidade, segurança e LGPD.

## Novo

- Beacon de performance passa a medir INP e CLS e relata até 3 erros de JS por visita, sem cookie e sem escrita em KV.
- "Sair dos outros aparelhos" encerra a sessão do painel em todos os aparelhos menos o atual.
- Lembrete de backup em Ajustes → Dados, com aviso quando o backup nunca foi baixado ou passou de 30 dias.
- Galeria própria em `/galeria/<slug>`, em prévia só do dono, com grade justificada, visualizador na resolução da tela e zoom até o original.
- Downloads "para redes" em 2048 px e "tamanho máximo" pela Drive API, com a chave só no servidor, além de seleção de várias fotos e "Salvar na galeria" no celular.
- Painel em blocos com navegação única, card de evento com selos e menu "⋯" e formulário em seis blocos recolhíveis com resumo.
- Ajustes em grupos (Site, Dados, Conta, Sobre), com as ações sensíveis marcadas.
- Métricas com série por dia, gráfico de visitas × aberturas do Drive, comparação com o período anterior, tabela e CSV.
- Métricas mostram os modos do portão e a curva de cada projeto, com filtro de 7, 30 ou 90 dias.
- Prévia de cada PR com o mesmo código de produção, dados próprios, faixa "PRÉVIA" e e-mails marcados no assunto.
- Menu "Testes" na faixa da prévia simula as salvaguardas e gera métricas de exemplo sem tocar em produção.
- Texto alternativo por foto de capa: campo no formulário do projeto (uma linha por foto), usado no carrossel e no visualizador.
- Versão do site à vista no painel, com o resumo do que esta versão trouxe.

## Melhorado e corrigido

- Um handler que rejeita agora vira 500 e dispara o alerta por e-mail.
- Restaurar backup numa prévia troca os links reais do Drive de álbuns restritos por um falso.
- A dica sob "Visível na galeria" explica que oculto quer dizer não listado.
- Contraste AA em todo texto do painel e das páginas públicas, incluindo selos, botões de excluir e o aviso de falha de e-mail.
- Foco visível em campos, seletores, toggles, chips de filtro e no gráfico de acessos.
- O selo de Pedidos agora esconde de verdade quando não há pendentes.
- "Sem categoria" limpa a categoria de um evento.
- "Ocultar/Mostrar" envia só a visibilidade e não desfaz mais a edição de outro aparelho.
- O formulário percebe mais alterações, inclusive a URL digitada num evento novo e mudanças nas fotos de capa.
- A aba ativa fica branca no celular, sem depender só do ícone dourado.
- A folha de "Novo evento" não rouba mais o foco de quem já está noutro campo.
- Celular: campos de 16 px, alvos de toque de 44 px e fim do bloco de Ajustes que afastava a página.
- Leitor de tela: avisos anunciados, página inerte atrás de folhas e confirmações e nome em todo campo.
- A lista de projetos conta certo, com plural correto e filtros aplicados à lista.
- Sessão expirada no meio de uma edição vai direto ao login e devolve a edição ao entrar de novo.
- "Novas fotos" reinicia o contador ao religar e conta como alteração.
- Esvaziar as fotos de capa tira a capa do card e do topo da página do projeto.
- Pedidos de remoção passam a ter uma chave cada, com migração do array antigo e carimbo do "e-mail enviado" no registro.
- O card do painel não quebra mais no primeiro redesenho do bundle de produção, e o teste da galeria deixou de usar regex para `<script>`.
- Salvar um evento avisa que o site mostra a mudança em até 1 min, e baixar o backup com sessão expirada leva ao login.
- A seleção em massa só considera os cards à vista, e a barra do "Selecionar vários" cabe na tela do celular.
- Ajustes pergunta antes de sair quando há senha, categoria, selo ou arquivo de restaurar não salvos.
- Portão do Drive: texto do código por e-mail, motivo do teto perto da ação, ordem no celular e folga do aviso de bloqueador.
- Ícones PNG de verdade, manifest em toda página, canonical no `/suporte` e "Pedir orçamento" com modelo preenchido.

## Segurança e LGPD

- A revogação de sessões grava o marcador `admin_sessions_corte`, que fecha a janela do cache do KV antes de renovar o `lastSeen`.
- CSP estrita em toda página HTML, com `nonce` por resposta e sem `'unsafe-inline'` em `script-src`, e violações em `/api/csp-report`.
- Termos 2026-10-18: nos álbuns restritos o acesso se apoia no consentimento, e os novos aceites ficam atrelados ao texto novo.
- `robots.txt` e `llms.txt` passam a proibir treino de IA, mantendo busca e resposta permitidas.
- Projetos "em breve" saem da busca com `noindex` e do `sitemap.xml`.
- Sem Turnstile, o álbum restrito pede o nome e limita cada IP a 3 álbuns restritos diferentes por dia.
- ROPA, retenção da série por dia em 400 dias e política de privacidade atualizada; pedidos de remoção nunca entram na prévia.

## Para quem mantém

- `npm run verifica:painel` roda o painel logado em Chromium real no iPhone, Android e computador, cobrindo foco, alvos de toque, `hidden` e o que o fluxo grava no KV.
- `npm run verifica:previa` testa a faixa e o menu "Testes" no celular e no computador, e os roteiros de navegador rodam na CI.
- Testes novos cobrem métricas, prévia, pedidos, painel e galeria, e os testes do limite de login usam o relógio parado.
- O CSS do desenho antigo que nada mais usava foi removido.
- Deploy: não há mais smoke antes da promoção (a URL de preview da versão nunca veio, #179). A verificação de uma mudança é a prévia do PR; em produção a versão sobe sem tráfego, é promovida, passa pelo smoke e **reverte sozinha** se reprovar.

## Publicação

Merge na `main` é deploy em produção, e é pelo caminho normal: versão sem tráfego, promoção, smoke e reversão automática se o smoke reprovar. Esta versão **não** tem migração de Durable Object nem de D1. Para voltar atrás: *Actions > Deploy > Run workflow* com o `version_id` da versão anterior (roteiro completo em `docs/RELEASE.md`).
