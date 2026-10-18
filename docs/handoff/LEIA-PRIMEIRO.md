# Passagem de bastão: v2.0.0 no homelab

A sessão de nuvem que levou o PR #236 até aqui escreveu este arquivo em 18/10/2026, para a
sessão do Claude Code no homelab do dono. Leia inteiro antes de agir; depois leia
`CLAUDE.md` → `RETOMADA.md` → `llms.md` (o projeto está descrito lá).

Esta pasta (`docs/handoff/`) é temporária: apague-a num commit quando terminar tudo, antes
de avisar o dono que o PR está pronto. Ela não pode chegar à `main`.

## 0. Regras do dono (valem acima de tudo)

- **Uso do plano Claude.** O plano do dono bateu o limite semanal. Trabalho de rotina vai
  para modelos grátis (seção 2): rascunho de código repetitivo, CSS, textos, docs, andaime
  de testes. Você (Claude) decide, revisa, cuida de segurança e verifica. **Antes de
  qualquer etapa pesada em Claude** (subagente, varredura grande, refatoração longa,
  revisão de segurança), pergunte ao dono, com uma estimativa de uso (fração do limite
  semanal) e a alternativa grátis. No máximo um subagente por vez: 6–7 em paralelo foi o
  que esgotou o limite.
- **Nunca faça merge do PR #236** (merge = deploy em produção). Não mande nada para
  produção.
- **Não copie nada do Google Drive.**
- **Perguntas ao dono: todas no fim, juntas** (a exceção é a de uso, acima). A lista
  acumulada está na seção 7.
- Nada de nome ou identificador de modelo em commit, PR ou docs.
- `.github/workflows/*` (inclusive `deploy.yml`) só muda com ok do dono.
- Invariantes do código (detalhe em RETOMADA e llms):
  - a chave da API do Drive nunca chega ao cliente;
  - todo `<script>` inline tem `nonce`;
  - `AMBIENTE="previa"` só em `[previews.vars]`;
  - nunca crase nem `${` em comentário dentro de script ou CSS emitido por template literal;
  - nunca imprimir valor de segredo;
  - nada de commit vazio para cutucar a CI.
- Commits em português, no estilo do `git log`. Push só para `ccr-7c9176fd-qf8urr`.

## 1. Preparar a pasta (ela está limpa)

```bash
git clone https://github.com/lucafchala/fotos && cd fotos
git switch ccr-7c9176fd-qf8urr
node -v                                   # Node 22+
npm ci
export PLAYWRIGHT_BROWSERS_PATH="$HOME/pw-browsers"   # chromiumLocal() procura aqui
npx playwright-core install chromium      # --with-deps se faltar biblioteca do sistema
gh auth status                            # sem login, peça ao dono: gh auth login
```

Se um roteiro não achar o Chromium, veja `chromiumLocal()` em `scripts/verifica-evento.mjs`.

Linha de base, antes de mudar qualquer coisa:

- `npm test`, `npm run lint`, `npm run typecheck`;
- os quatro roteiros: `npm run verifica:painel`, `verifica:evento`, `verifica:galeria`,
  `verifica:previa`.

A CI estava verde em `91bc32c`. O commit seguinte só acrescenta esta pasta.

## 2. Modelos grátis: OpenCode + skill token-saver

O dono pediu a skill <https://github.com/crichalchemist/token-saver-skill>. A sessão
anterior a revisou: é só markdown (`SKILL.md` + `references/`), sem código. Ela manda
trabalho de rotina para modelos grátis pela CLI do OpenCode. Na nuvem a instalação foi
barrada, e por isso a sessão vem para cá.

1. Instale o OpenCode: `npm i -g opencode-ai` (a versão atual em 18/10/2026 era 1.19.3).
   Confira com `opencode --version`.
2. Instale a skill:
   - clone o repo acima numa pasta temporária e leia os arquivos;
   - copie `SKILL.md` e `references/` para `~/.claude/skills/token-saver/`.
3. Corrija o que está desatualizado na skill instalada.
   - **Modelos.** Os que ela recomenda (`glm/glm-4`, `github-copilot/gpt-4.1`) pedem conta
     ou assinatura. Os grátis sem conta são os do provedor `opencode` (OpenCode Zen) com
     sufixo `-free`; liste com `opencode models opencode`.
   - No catálogo de 18/10/2026 havia uns 40. Alguns deles:
     - `opencode/glm-5-free`
     - `opencode/kimi-k2.5-free`
     - `opencode/deepseek-v4.1-flash-free`
     - `opencode/qwen3.6-plus-free`
     - `opencode/minimax-m3-free`
   - Teste 3–4 com uma tarefa real e pequena deste repo, fique com os 2 melhores e
     reescreva a tabela de modelos do `SKILL.md` instalado.
   - **MCP.** `references/mcp-config-template.json` usa `opencode-acp`, que não é servidor
     MCP. Ignore o arquivo e use a CLI: `opencode run -m <modelo> "<pedido>"`.
   - **GPU.** Se o homelab tiver GPU de 16 GB ou mais, prefira para código um modelo local
     via Ollama, configurado como provedor no OpenCode: é grátis e privado.
4. Configure o OpenCode em `~/.config/opencode/opencode.json`:
   - desligue o compartilhamento (`share`) e a atualização automática (`autoupdate`);
   - na permissão de bash, negue `git push` (o OpenCode é um agente com ferramentas; veja
     opencode.ai/docs).
   - Quando ele for editar arquivos, rode-o num worktree separado e revise o diff antes
     de aproveitar.
5. Privacidade: modelos grátis na nuvem podem guardar o que recebem.
   - Nunca mande segredos (`.dev.vars`, saída de `wrangler secret`), dados de visitantes
     nem o log de consentimento.
   - O código do repo já é público.
6. Verifique: `opencode run -m <modelo> "Responda só: ok"` e uma delegação real (por
   exemplo, o JSDoc de uma função) que você revisa. No relatório final, diga quais modelos
   funcionaram.

Fluxo de trabalho: o modelo grátis rascunha → você revisa contra as regras do repo →
testes e roteiros → commit.

## 3. Trabalho que só existia na sessão de nuvem (patches nesta pasta)

Os dois ramos partem de `e78ba3a`, que já está no GitHub. Aplique cada um num ramo próprio
e mescle no `ccr-7c9176fd-qf8urr` com merge (sem rebase do ramo do PR).

### 3.1 `sessoes/` — pronto para mesclar (3 commits)

O que entrou:

- **"Sair dos outros aparelhos"** em Ajustes → Conta (`POST /api/sessions/revoke-others`).
  - Grava o marcador de revogação `admin_sessions_corte` (TTL 25 h), que `verifySession`
    checa antes de renovar o `lastSeen`.
  - Isso fecha o buraco em que o cache do KV deixava um aparelho revogado entrar e a
    renovação ressuscitava a sessão.
  - Vale também para a troca de senha: há uma implementação só, `encerraOutrasSessoes`
    em `src/utils.js`.
- **Lembrete de backup** em Ajustes → Dados (chave `backup:ultimo`). Vira aviso se o
  backup nunca foi baixado ou tem mais de 30 dias.
- **Testes:**
  - o roteiro do painel foi de 211 para 234 checagens;
  - escritas no KV por aparelho: de 13 para 16 (17 no computador);
  - testes novos: `tests/sessoes-corte.test.js`, `tests/backup-lembrete.test.js`,
    `tests/workers/sessoes.workers.test.js`;
  - mutação: 70 mutantes, 0 sobreviventes. As checagens do roteiro não foram mutadas.

```bash
git switch -c sessoes e78ba3a && git am -3 docs/handoff/sessoes/*.patch
git switch ccr-7c9176fd-qf8urr && git merge --no-ff sessoes
```

Conflitos prováveis: `src/index.js`, `src/utils.js`, `src/ui/dashboard.js`,
`scripts/verifica-painel.mjs`. Depois do merge, rode a suíte inteira, lint, typecheck,
`verifica:painel` e `verifica:previa` (o autor não rodou tudo no fim).

Ficou por fazer depois do merge:

- **Docs:**
  - `docs/PAINEL.md`: §9, §10, a linha da §14, a tabela e as contagens da §15.2, §18;
  - `SECURITY.md`: as seções de sessão e a linha de Controles (depois,
    `npm run build:legal`);
  - `README.md`: tabela do KV (`backup:ultimo`, `admin_sessions_corte`), tabela de rotas,
    linha do roteiro;
  - `docs/VERIFICACAO.md`: "13 escritas por aparelho" → "16 (17 no computador)", e o
    número de checagens do roteiro do painel (confira depois do merge).
- **Dica do #128** sob `#f-visible` (ainda não começou). Sentido: "Oculto" = não listado;
  some da página inicial, mas quem tem o link ainda abre.

Linhas sugeridas para o CHANGELOG (seção `[2.0.0]`):

- Painel: novo "Sair dos outros aparelhos" (Ajustes → Conta) encerra a sessão do painel em
  todos os aparelhos menos o atual (`POST /api/sessions/revoke-others`); em outro lugar
  pode levar até 30 s.
- Segurança: a revogação de sessões grava um marcador (`admin_sessions_corte`) e fecha a
  janela em que o cache do KV deixava um aparelho revogado entrar e a renovação do
  `lastSeen` ressuscitava a sessão por mais 24 h; vale também para a troca de senha.
- Painel: lembrete de backup em Ajustes → Dados ("Último backup: hoje / ontem / há N
  dias"), em aviso se nunca baixado ou há mais de 30 dias (nova chave KV `backup:ultimo`).
- Roteiro do painel: 211 → 234 checagens; escritas no KV por aparelho 13 → 16 (17 no
  computador).

**Defeito visto e ainda não corrigido** (corrija, com teste):

- Em `worker.fetch` (`src/index.js`), as rotas fazem `return handleX(...)` dentro de
  `try/catch`, sem `await`.
- A rejeição de um handler assíncrono escapa do catch-all: não sai página 500 nem e-mail
  de `sendErrorAlert`.
- Reproduzido com `GET /api/backup` quando a leitura de `events` no KV rejeita.
- Correção provável: `return await handleX(...)` (ou um `await` único no despacho). Mexe em
  todas as rotas: rode tudo.

### 3.2 `csp-126/` — incompleto (2 commits)

- `0001` (pronto): os roteiros de navegador reprovam qualquer mensagem de CSP, e o do
  evento passa a servir os cabeçalhos reais.
- `0002` (**WIP, não testado**, 21 arquivos): a virada em andamento.
  - Toca `src/security.js`, `src/index.js`, `src/utils.js`, testes,
    `scripts/vigia-csp.mjs`, `scripts/smoke.sh`, docs e `src/content/legal-docs.js`.
  - Parou na seção de CSP do `SECURITY.md`.

Objetivo do #126:

- A CSP aplicada vira a estrita: nonce, sem `'unsafe-inline'` em `script-src`; `style-src`
  continua com `'unsafe-inline'`. Hoje ela só roda em Report-Only.
- Prova: os quatro roteiros com zero mensagem de CSP no console e zero `pageerror`.
- Docs: atualize o item 2 de "Limitações conhecidas"
  (`docs/legal/politica-seguranca-informacao.md`) e o `SECURITY.md`.
- Regenere `src/content/legal-docs.js` com `npm run build:legal`, nunca à mão; ele vai
  conflitar.

```bash
git switch -c csp-126 e78ba3a && git am -3 docs/handoff/csp-126/*.patch
```

Termine, rode tudo, faça mutação nos pontos-chave e só então mescle. Fecha o #126.

## 4. O que falta, em ordem

1. Mesclar `sessoes` (3.1), completar as docs dele e fazer a dica do #128.
2. Corrigir o achado de segurança (seção 5).
3. Corrigir o `await` em `worker.fetch` (fim da 3.1).
4. CSP #126 (3.2).
5. Galeria própria melhor que o Google Drive (4.1): boa candidata a rascunho por modelo
   grátis, com a sua revisão.
6. Passada grande de UI/UX nas páginas públicas (4.2).
7. SEO (4.3).
8. Site de status (4.4).
9. Pesquisa de recursos: se a seção 6 tiver relatório, leve as 3–5 melhores ideias ao dono
   no fim, sem implementar.
10. Fechamento (4.5).

### 4.1 Galeria

Arquivos: `src/ui/galeria.js`, `tests/galeria*.js`, `scripts/verifica-galeria.mjs`. Mexa no
servidor (`src/drive.js`, `src/index.js`) só se um item exigir.

Hoje só o dono vê `/galeria/<slug>`: é a prévia do que o convidado vai receber no lugar da
pasta crua do Drive. A meta do dono: **tem que ser melhor que o Google Drive, senão não
vale a pena.**

1. **Cabeçalho de galeria, não de ferramenta.**
   - Título, e uma linha com a data (se houver) e "244 fotos".
   - Os controles do dono (← Painel, Página do projeto, Atualizar lista, horário da lista)
     ficam juntos numa faixa secundária, fácil de remover quando o convidado ganhar a
     página.
   - Ações do convidado: "Selecionar" e "Baixar tudo". "Baixar tudo" abre a folha de
     download, no estilo atual, com "Pelo Google Drive" ("o Drive junta tudo num .zip") e,
     havendo favoritas, "Baixar as favoritas (N)".
2. **Barra fixa de chips por seção**, quando houver 2 ou mais seções.
   - Cada chip mostra a contagem ("Festa 220").
   - O toque rola suave, respeitando `prefers-reduced-motion`.
   - O chip ativo segue a rolagem (IntersectionObserver), com `aria-current`.
   - Chips de 44 px ou mais, foco visível, rolagem horizontal sem barra no celular.
3. **Favoritas, só neste aparelho.**
   - Coração na miniatura (hover e foco no desktop; no toque, dentro do visualizador) e
     na barra do visualizador.
   - Guardadas em `localStorage`, chave `galeria:fav:<slug>`, com try/catch em toda leitura
     e escrita: a página tem que funcionar com o storage bloqueado.
   - Um chip "Favoritas (N)" filtra a grade. Rótulo: "Fica só neste aparelho".
   - Nada vai para o servidor.
4. **Compartilhar, no visualizador.**
   - Com `navigator.canShare({ files })`: baixa o tamanho "para redes" da foto atual (a
     mesma URL do download "Para redes sociais") e compartilha o arquivo.
   - Sem isso: `navigator.share` com o link direto da foto (a página já suporta).
   - Sem Web Share: copia o link e mostra "Link copiado".
   - Erro vira toast claro, nunca rejeição solta.
5. **Carregamento.** A miniatura entra com fade de uns 200 ms (nenhum com reduced motion)
   sobre um esqueleto neutro, nos dois temas. Sem layout shift: o layout justificado já
   reserva o espaço.
6. **"Voltar ao topo".**
   - Botão de 44×44, `aria-label="Voltar ao topo"`.
   - Aparece depois de umas 2 telas de rolagem e fica acima da barra de seleção quando
     ela aparece.
   - Some com o visualizador aberto.
7. **Textos.** Troque toasts vagos ("Pronto") pelo que aconteceu: "Salva na galeria do
   celular", "Download começou", "3 fotos baixando". Mantenha as frases que o roteiro
   verifica, ou atualize o roteiro junto.
8. **Seleção.** "Selecionar todas" e "Desmarcar todas" por seção; no desktop, Shift+clique
   seleciona o intervalo.
9. **Linhas maiores em tela grande:** uns 280 px a partir de 1200 px de largura. No celular
   fica como está.

Regras da galeria:

- Cada item ganha uma checagem no roteiro (ou um teste) que **falha sem ele**. Faça a
  mutação: desfaça, rode, veja falhar, restaure.
- Tema claro e escuro, contraste AA, alvos de 44 px ou mais, foco visível.
- Em toda folha nova: Esc fecha e o foco volta para onde estava.
- Mantenha os ids, classes e `data-*` que o roteiro usa.
- O script emitido é checado por `tests/scripts-embutidos.test.js`: prefira `setAttribute`
  ou casts JSDoc a alargar o `.d.ts`.
- Eventos por delegação (`data-action`), nunca `on*` inline.
- `VERIFICA_PRINTS=<pasta> npm run verifica:galeria` salva capturas: compare antes e
  depois.

Movimento, de um vídeo que o dono mandou ("considere, mas não cegamente"):

- Menus e folhas abrem em 150–200 ms com ease-out forte (por exemplo,
  `cubic-bezier(0.23, 1, 0.32, 1)`); a saída é mais rápida que a entrada.
- Ação de teclado (Esc, atalhos) não anima.
- Com `prefers-reduced-motion`, um fade curto em vez de nada.
- A escala inicial é 0,95, nunca 0. Anime só `transform` e `opacity`.
- Use o que servir, não tudo.

### 4.2 Páginas públicas: UI/UX

Mudanças grandes são bem-vindas: o site "tem que ser top dos top".

Escopo: `src/ui/event.js` (página do projeto e portão do Drive), página inicial, /sobre,
/suporte, /termos, /privacidade. A galeria fica de fora.

- **#141 (CLS)** e os tokens de cor públicos que falham AA. Meça, não chute.
- **#210:** "Pedir orçamento" leva a `/suporte` com um modelo de mensagem já preenchido. Se
  o dono quer uma página `/contato` própria é a pergunta 8.
- **Quatro correções no portão do Drive**, vistas no Chromium:
  1. O texto "Mandamos um código…" afirma que o código foi enviado antes de ele ser
     enviado.
  2. O motivo do teto de álbuns restritos aparece abaixo do botão: traga para perto da
     ação.
  3. No celular, o aviso de cookies cobre a janela do portão.
  4. O campo de nome encosta no aviso de bloqueador.
- Cada mudança vem com teste ou roteiro que falha sem ela. Claro e escuro, AA, 44 px,
  Esc e foco.

### 4.3 SEO

Área: o `<head>` das páginas públicas; sitemap, robots, security.txt, manifest e 404 em
`src/index.js`; JSON-LD e utilitários em `src/utils.js`.

**Auditoria rodando o Worker.** Suba com `scripts/worker-local.mjs` → `sobeWorker`. Semeie
eventos públicos, ocultos, family/private e "em breve", como faz o `verifica-painel`. Em
cada rota pública, confira:

- `lang`;
- título único de até 60 caracteres e descrição única de até 160;
- canonical absoluto e sem query;
- `noindex` em restritos, ocultos e prévia (os testes já prendem parte disso: não
  enfraqueça);
- Open Graph e Twitter: `og:image` absoluto com width e height, `og:locale` pt_BR;
- JSON-LD que parseia e usa os tipos certos: Person/ProfessionalService,
  ImageGallery ou Event, BreadcrumbList, WebSite;
- um só `h1`, e `alt` nas imagens;
- favicon, manifest e theme-color;
- 404 de verdade;
- sitemap só com páginas indexáveis, `lastmod` em formato W3C, e `image:image` das capas
  se ajudar;
- robots.txt com Disallow de `/dashboard` e `/api` e a linha `Sitemap`.

**Ícones PNG de verdade.** Hoje há só SVG, e o iOS ignora SVG em apple-touch-icon; também
não existe PNG 192/512.

- Escreva `scripts/build-icons.mjs` com `sharp` (já está no node_modules). Ele gera 180,
  192, 512 e 512 maskable (com margem) em `src/content/icons.js`, em base64, no padrão de
  `fonts.js` e `vendor.js` (veja como esses são gerados, versionados e testados).
- Rotas ao lado de `/icon.svg`, com cache longo.
- O manifest lista os PNG e mantém o SVG.
- Toda página ganha `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`.
- Teste o tipo e as dimensões de cada rota, e que o arquivo gerado está em sincronia com
  o script.

**llms.txt** já existe. Pode melhorar o conteúdo factual, mas **não mude a postura de
treino de IA** (`Content-Signal: ai-train=yes` no robots.txt): é a pergunta 10.

Sem scripts de terceiros.

### 4.4 Site de status

O repo é `lucafchala/status.lucafchala.com`, público; clone numa pasta ao lado. O dono
"está recebendo muitas falhas ultimamente".

Do lado do fotos, em 17/10 estava tudo saudável:

- `/api/healthz` ok, sem `problems`;
- GitHub Actions verdes, inclusive as agendadas;
- `status.lucafchala.com/api/status` todo "up" na hora.

**Suspeito principal: o heartbeat do Uptime Kuma, que roda neste homelab.**

- O Worker manda o push para o Kuma só quando recebe um pedido, no máximo 1 por minuto
  (`KUMA_MIN_INTERVAL_MS`, `src/index.js` ~2190), e de forma forçada no cron diário.
- Se o intervalo do monitor de push no Kuma for menor que o vão entre visitas (de noite,
  sem ninguém nem sonda batendo), o monitor cai para DOWN sem o site ter caído.
- O status também alerta quando o túnel do homelab oscila.

O que fazer:

- Olhe no próprio Kuma o histórico, o intervalo e as tentativas desse monitor.
- Olhe no repo do status de onde vêm os alertas e quais são falso positivo.
- Reduza o ruído: tentar de novo antes de alertar, histerese, alerta só na mudança de
  estado, ou uma sonda periódica que mantenha o heartbeat vivo.
- O contrato do `/api/healthz` está em `docs/healthz-contrato.json` deste repo. A v2
  acrescentou `versaoSite`: confirme que o status não reprova campo novo.
- Push no repo do status só com ok do dono. Deixe o diff pronto num ramo local e pergunte
  no fim.

### 4.5 Fechamento

- `/simplify` no que mudou desde a `main` (qualidade, não bugs).
- **Verificação completa:**
  - `npm test`, `npm run lint`, `npm run typecheck`;
  - a cobertura (o ratchet do repo);
  - os quatro roteiros;
  - e os fluxos da skill `verify` (`.claude/skills/verify/SKILL.md`), dirigidos no
    Chromium.
- **Docs:**
  - CHANGELOG, seção `[2.0.0]`, com tudo que entrou;
  - as contagens no README e em `docs/VERIFICACAO.md`.
- **Corpo do PR #236**, nas seções de `.github/pull_request_template.md`:
  - Fixes #146 (e #126, se entrar);
  - nota do commit `9018afb` no `security.yml`;
  - `versaoSite` no healthz;
  - as novidades e as contagens;
  - sugestões de teste manual para o dono.
- Apague `docs/handoff/` num commit.
- **Relatório final ao dono:**
  - o que entrou;
  - o que ficou de fora, e por quê;
  - quais modelos grátis funcionaram e quanto de Claude foi usado;
  - as perguntas da seção 7.

## 5. Achado da revisão de segurança (Médio, confiança 0,7)

A prévia pública de PR desliga o Turnstile para qualquer visitante, num KV que o README
manda semear com os álbuns de produção.

**Onde:**

- `src/previa.js`, `envSimulado` (~58 e ~253–259): o modo padrão `passa` troca
  `TURNSTILE_SECRET_KEY` pelo segredo de teste "sempre passa"
  (`1x0000000000000000000000000000000AA`).
- Isso vale para todo pedido em `fetchDaPrevia`, sem cookie nem login.
- A página usa a chave de site de teste (~592–594).

**O que dá para fazer com isso:**

- `POST /api/drive-link` com `turnstileToken:"x"`, `consent` e `declaration` devolve o
  `driveUrl` real (`src/index.js` ~2801–2806).
- Não passa pelo nome obrigatório nem pelo teto de 3 álbuns restritos do caminho noscript
  (#146); só pelo balde por IP (1500/h).
- O README ("Prévia de PR", passo 3) manda restaurar o backup de produção no KV da prévia
  (`[[previews.kv_namespaces]]`, um só para todas as prévias). Isso põe lá os links reais
  dos álbuns `private` e `family`.
- A URL da prévia é postada no PR, e o repo é público.
- O mesmo segredo tira o Turnstile do login, do pedido de remoção e do suporte na prévia,
  que, segundo o README, usa a mesma chave do Resend da produção.

**Correção recomendada** (em código, com teste):

- Ao restaurar backup quando `ehPrevia(env)`, troque o `driveUrl` dos eventos `private` e
  `family` por um link falso, como já se faz com `removalRequests` (`src/index.js` ~3670).
- E/ou aplique o segredo "sempre passa" só com sessão de admin ou com o cookie
  `previa_ts` posto de propósito.
- A alternativa sem código é o Cloudflare Access nas prévias (pergunta 11).

O resto da superfície revisada passou:

- o gating de produção do `ehPrevia`;
- as ações da prévia;
- a galeria própria;
- os pedidos, as métricas e o painel;
- `previa-publica.mjs`;
- o PhotoSwipe em `vendor/`, idêntico ao do npm;
- a CI.

## 6. Pesquisa de recursos (resumo do relatório da sessão de nuvem)

Leve ao dono, no fim, as 3–5 melhores ideias, sem implementar antes do ok. A exceção é o
que já está nas tarefas acima. Linhas de código e números vêm do relatório: confira antes
de agir. Estatísticas de terceiros não foram checadas na fonte.

**Atenção (decisões, não código):**

- `/llms.txt` diz `Usage-Policy: Training allowed` (`handleLlmsTxt`, `src/index.js`
  ~511–545). É a mesma decisão da pergunta 10.
- O log de consentimento (`image_use_consent`, no D1) fica fora do `GET /api/backup`
  (~3463–3468): a prova do aceite não tem cópia.
- Menores: os termos (`src/ui/terms.js` ~104) exigem o aceite dos responsáveis, coletado
  fora do site. O ECA Digital (Lei 15.211/2025, em vigor desde 17/03/2026) pode alcançar o
  serviço: é pergunta para advogado.

**Vale fazer** (valor alto, custo pequeno):

1. **Texto alternativo por foto.**
   - Nas capas e no lightbox: `alt="Foto i de n — título"` (`src/ui/event.js` ~148–155 e
     ~813; o lightbox hoje usa `alt=""`).
   - Na galeria (`src/ui/galeria.js` ~504): o índice em vez do nome do arquivo.
   - Entra junto da 4.1 e da 4.2.
2. **Erros de JS do navegador**, amostrados e sem dado pessoal.
   - No bloco RUM de `src/utils.js` (~2596–2612), `error` e `unhandledrejection` mandam
     `sendBeacon('/api/perf', {kind:'js', tipo, arquivo, linha})`.
   - 10% de amostra e no máximo 3 por página, sem mensagem livre nem query.
   - `handlePerfBeacon` passa a aceitar o `kind`. Não usa KV.
3. **INP e CLS** no mesmo beacon (hoje ele só manda LCP, FCP e TTFB).
4. **axe-core** (devDependency, versão fixa) nos roteiros `verifica-evento`,
   `verifica-galeria` e `verifica-painel`. Falha em impacto serious ou critical, com uma
   lista explícita de exceções.
5. **Declaração de acessibilidade.**
   - Rota no padrão de `src/ui/about.js`, registrada na lista de `src/ui/legal.js`, com
     link no rodapé.
   - Diz o nível-alvo (WCAG 2.2 AA), o que foi testado, o que falta e o contato pelo
     /suporte.
   - Se a LBI alcança o dono é pergunta para advogado.
6. **`AGENTS.md` de três linhas**, só apontando para `llms.md` e `RETOMADA.md` (outras
   ferramentas leem AGENTS.md). Não copie regras.
7. **Inventário de vencimentos e acessos** em `RETOMADA.md`: domínio, DNS, Resend, chave do
   Drive, Turnstile, Cloudflare, GitHub e Kuma, cada um com dono, vencimento e lembrete.
8. **Consentimento no backup.**
   - Primeiro, um runbook de export do D1 `CONSENT_DB`, guardado fora do repo (o log tem
     IP).
   - Depois, se o dono quiser, incluir o log no backup, com o restore testado.
9. **Expiração da página por data** (decisão do dono): o cron diário põe `visible=false`.
   Não revoga o Drive, então não é retenção.

**Depois:**

- regressão visual com Playwright;
- seleção, favoritas e download "para redes" do convidado, quando a galeria abrir;
- QR de evento (o TODO pede uma necessidade nova).

**Não fazer:**

- **Reconhecimento facial ou busca por selfie:** dado biométrico é dado sensível (LGPD
  art. 11).
- **Senha como sigilo:** o link do Drive é público; o modelo é "consentimento, não
  sigilo".
- **Marca d'água nas entregas.**
- **Loja ou cobrança.**
- **Captura de e-mail ou newsletter.**
- **Upload por convidados.**
- **Service worker ou cache offline:** o nonce da CSP vale 2 h.
- **Analytics de terceiros ou session replay.**
- **Framework ou build.**
- **Monitor terceirizado:** o dono recusou.
- **Workers Paid "por precaução".**
- **Cloudflare Images, Stream ou Pro:** já foram decididos contra.

## 7. Perguntas ao dono (todas no fim, cada uma com a sua recomendação)

1. **Termos.** O /termos ainda diz "Acesso restrito a membros da família" e "a
   participantes ou pessoas autorizadas". Reescrever no espírito do #146 (consentimento,
   não senha) exige `TERMS_VERSION` nova. Faço?
2. **Etiqueta de versão.** Criar também a etiqueta `v2.0.0` e um GitHub Release com a seção
   do CHANGELOG? Mexe no deploy.yml, então só com ok.
3. **Segredos da prévia** (adiado pelo dono): o Preview command `npm run previa`, mais
   `PREVIA_RESEND_API_KEY`, `PREVIA_ADMIN_EMAIL` e `PREVIA_GOOGLE_DRIVE_API_KEY` no build.
4. **Workflows da CI:** confirmar ou tirar os dois commits de workflow no `checks.yml`.
5. **Código por SMS** com preenchimento automático (ideia do dono). Dá para fazer: WebOTP
   no Android/Chrome e `one-time-code` no iPhone preenchem sozinhos. Mas:
   - custa por SMS (≈ R$ 0,10–0,40 cada) e exige conta num provedor;
   - coleta telefone, que é dado pessoal;
   - abre a porta para "SMS pumping".

   O código por e-mail já é grátis, e o iPhone (iOS 17+) já o preenche a partir do Mail,
   porque o campo usa `autocomplete="one-time-code"`. Recomendação: não agora; olhar de
   novo se as métricas do portão mostrarem gente travando no e-mail.
6. **Segundo fator no painel** (#130/#129). Três caminhos:
   - (a) TOTP no próprio site, deixado pronto e desligado até o cadastro;
   - (b) Cloudflare Access na frente de /dashboard (sem código, grátis);
   - (c) nada.

   A senha usa PBKDF2 com 100 mil iterações, abaixo das 600 mil da OWASP. Recomendo (b);
   senão (a). E fechar o #129 (magic link) em favor disso?
7. **#128** ("Ocultar" = não listado): confirmar e fechar a issue? A dica no painel está na
   seção 3.1.
8. **#210:** a versão simples (link → /suporte com modelo preenchido) está na 4.2. Quer
   também uma página /contato dedicada?
9. **Workers Paid:** assinou ou não? O `TODO.md` diz as duas coisas (linhas ~25 e ~505).
10. **Treino de IA:** o robots.txt diz `ai-train=yes` e o llms.txt "Training allowed", mas
    as capas podem mostrar menores. Recomendo trocar para `ai-train=no`.
11. **Prévias:** são públicas e, depois do "restaurar backup", têm os links reais dos álbuns
    de família (ver seção 5). Recomendo Cloudflare Access nas prévias, além da correção em
    código.
12. **Workflows:** além dos 2 commits do `checks.yml`, o commit `9018afb` mexeu no
    `security.yml` (varredura de chave AIza…). Confirma os três?
13. **deploy.yml:** trocar o portão de preview, que nunca funciona (#179), pelas Worker
    Previews, e criar a etiqueta `v2.0.0` com Release? Precisa de ok.
14. **#148:** fechar? Os IDs da Cloudflare no `wrangler.toml` não são segredo; escondê-los
    não protege nada.
15. **Logs:** a partir de 1º/12/2026, o plano grátis de logs da Cloudflare muda (0,5 GB/dia,
    7 dias). Num dia de evento grande os logs podem parar. Baixar a amostragem dos traces?
16. **Assinaturas.** O dono perguntou se "assinar o plus" deixa o site melhor. A que faz
    diferença é o **Workers Paid** (US$ 5/mês):
    - tira o teto de 1.000 escritas/dia no KV;
    - sobe o limite de subrequests (a listagem da galeria usa);
    - dá mais CPU e mais logs.

    As outras:
    - Resend pago, só se passar de 100 e-mails/dia;
    - R2, se um dia as fotos saírem do Drive (#137/#233);
    - Google Workspace, se precisar do contrato de tratamento de dados do Drive (#124).

    Confirmar de qual "plus" ele falava.
17. **Status:** o diff pronto no repo do status (4.4) pode ir para lá?

Só o dono pode fazer (lembre no relatório):

- #119: autorização de imagem de menores;
- #124: o Drive é Workspace ou pessoal?;
- #125: parecer jurídico;
- #177: proteger a `main`;
- #178: conferir em produção depois do deploy;
- #230, #231, #233: pós-evento;
- os segredos da prévia (pergunta 3);
- levar ao advogado, junto do #125: o ECA Digital (menores) e a LBI (declaração de
  acessibilidade), da seção 6.
