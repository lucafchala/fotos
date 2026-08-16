# Pendências — fotos.lucafchala.com

Só o que está **em aberto**. Item entregue sai deste arquivo — o histórico de
quem fez o quê fica no git (`git log`), não aqui. As seções estão em ordem de
prioridade; dentro de cada uma, o primeiro item é o próximo a atacar.

---

## Lançamento

- [ ] Link para fotos.lucafchala.com na bio do Instagram (@lucafchala)
- [ ] Link na homepage pessoal (lucafchala.com)

---

## Segurança e anti-abuso

> Boa parte desta seção foi entregue na revisão de segurança de 2026-08.
> O que sobrou está abaixo, com o motivo de ainda estar aberto.

### Ações do dono (fora do código) — prioridade

- [ ] 🔴 **`npx wrangler secret put SIGNING_SECRET`.** Sem esse secret, o nonce
      de página do `/api/drive-link` e o token dos formulários públicos ficam
      **desligados** — o site funciona igual, só sem essas duas camadas.
      `/api/healthz` e o painel de status acusam a falta até ser resolvido.
- [ ] 🔴 **Autorização de imagem de menores assinada pelo responsável legal.**
      É o único risco residual **alto** do sistema (R3 do
      [RIPD](./docs/legal/RIPD.md)) e nenhuma medida no código o resolve — a
      coleta acontece no evento ou no contrato com a escola. Modelos prontos em
      [`docs/legal/termo-autorizacao-uso-imagem.md`](./docs/legal/termo-autorizacao-uso-imagem.md);
      o caminho de menor atrito é o Modelo 3, anexado ao contrato.
- [ ] 🔴 **Confirmar se a conta do Google Drive é Workspace ou pessoal.** Conta
      pessoal gratuita não tem DPA, o que enfraquece o fundamento do art. 33, III
      justamente para a transferência de maior impacto (as fotografias). Ver
      [`transferencia-internacional.md`](./docs/legal/transferencia-internacional.md).
- [ ] **Parecer jurídico** sobre os pontos marcados ⚖️ em
      [`checklist-conformidade.md`](./docs/legal/checklist-conformidade.md).

### Código

- [ ] **Concluir a migração da CSP.** Os nonces já estão em todos os `<script>`
      e a política estrita (sem `'unsafe-inline'`) já roda em **Report-Only**,
      com coletor em `/api/csp-report`. Falta o trabalho de fato: trocar os ~63
      handlers inline (`onclick="…"`) por listeners delegados — inclusive os que
      o painel gera dinamicamente via `innerHTML`.
      > ⚠️ **Não acrescente o nonce à política enforced antes disso.** Pela CSP
      > Level 3 o nonce descarta o `'unsafe-inline'`, e a interface inteira para
      > de responder. Já aconteceu nesta branch e só foi pego com browser de
      > verdade — teste de unidade sobre o texto da política não enxerga isso.
      > Há teste e smoke test do deploy travando esse caminho agora.
      Quando os relatórios zerarem, tirar os handlers e então deixar a enforced
      usar `strict` (`contentSecurityPolicy()` em `src/security.js`).
- [ ] **Decidir a semântica de "Ocultar" um projeto.** Hoje é **não listado**:
      sai da galeria, do sitemap e da auditoria, e agora vai com
      `X-Robots-Tag: noindex` — mas continua abrindo por link direto (o que faz
      um link de prévia enviado a cliente continuar funcionando). Se a
      expectativa for "privado", o handler precisa devolver 404 para quem não
      está logado. Não mudei por conta própria porque quebraria links já
      compartilhados.
- [ ] **Login sem senha / recuperação de acesso** — magic link por e-mail via
      Resend (já configurado), substituindo ou complementando a senha do painel.
      Resolve de uma vez a recuperação de senha e boa parte do que 2FA
      cobriria; menos atrito que TOTP.
- [ ] **2FA/TOTP no painel** — só se o magic link não for suficiente.
- [ ] **Hospedar as fontes localmente** — elimina a transferência internacional
      do Google Fonts (que transmite o IP de cada visitante) e tira uma origem
      da CSP. O `font-src` já aceita `'self'` desde `c78e6e4`: falta baixar os
      WOFF2 do Inter, declarar `@font-face` e remover o `<link>` das oito
      páginas.
- [ ] **Afinar Bot Fight Mode / regras de WAF** no Cloudflare: barrar abuso sem
      bloquear crawlers de preview (WhatsApp/Instagram) nem visitantes legítimos.
- [ ] **EXIF em HEIC/AVIF/GIF.** JPEG, PNG e WebP já são limpos no servidor
      (`stripImageMetadata()`). Nesses três o metadado vive dentro de caixas
      ISO-BMFF, e reescrevê-las sem um decodificador de verdade arriscaria
      corromper a prova que o titular enviou — hoje passam intactos, com o
      resultado registrado no pedido.

### Entregue em 2026-08 (não reabrir sem necessidade nova)

**Central de Transparência (`/legal`, também `/compliance`) + página por
documento (`/legal/<slug>`).** Hub público que reúne privacidade, termos,
política de segurança, o resumo do que é feito com cada dado, os canais de
contato e os doze documentos de conformidade — **cada um com página própria no
site**, renderizada do markdown de `docs/legal/`. O rodapé passou a ter um
único link "Legal" no lugar de "Privacidade" + "Termos", sem perder acesso a
nada.

> ### ⚠️ Ao editar qualquer documento em `docs/legal/` ou o `SECURITY.md`
>
> 1. Rode **`npm run build:legal`** e commite o `src/content/legal-docs.js`
>    gerado. A CI regenera e compara — esquecer derruba o build, de propósito:
>    sem isso a página publicada mostraria um texto diferente do documento
>    oficial.
> 2. **Nunca edite `src/content/legal-docs.js` à mão.** Ele é gerado.
> 3. **Não acrescente link para o GitHub** em página nenhuma. Só o
>    "Código-fonte" do rodapé pode. A CI verifica, e o renderizador rebaixa
>    qualquer link de GitHub a texto puro de qualquer forma.
> 4. Documento novo entra em `DOCS`, em `scripts/build-legal-docs.mjs` — é de
>    lá que saem o slug, o card da Central, a rota e o sitemap, todos de uma
>    lista só.
> 5. Slug é **contrato público** (está no sitemap, pode estar salvo por
>    alguém). Renomear quebra link de fora.

Nonce assinado no `/api/drive-link` · honeypot + token de formulário com idade
mínima · alerta de login suspeito · strip de EXIF (JPEG/PNG/WebP) · CSP
report-only com coletor · dedupe de mensagens repetidas no suporte · checagem
de origem contra CSRF · cookie `__Host-` com timeout de inatividade · política
de senha · correção de injeção de fórmula em CSV · `no-store` nas respostas de
dados · higienização do restore de backup · `npm audit` + dependency-review +
invariantes de CI.

**Correções encontradas na verificação com browser (não apareciam em teste
unitário):**

- **CSP quebrava a interface inteira.** Nonce e `'unsafe-inline'` juntos na
  política aplicada: pela CSP Level 3 o nonce descarta o `'unsafe-inline'`, e os
  ~63 handlers `onclick` paravam de executar. Os testes passavam porque
  afirmavam que a *string* continha `'unsafe-inline'`.
- **Laço infinito de recarga no gate do Drive** — o Chrome restaura checkbox ao
  recarregar, o aceite voltava marcado, o gate disparava sozinho e tomava 410 de
  novo.
- **Mensagem de suporte podia sumir sem sinal** — a chave de dedupe era gravada
  antes de o envio dar certo.
- **Sessão com `createdAt` corrompido virava sessão sem teto** — TTL NaN, escrita
  recusada em silêncio.

**Atrito removido:** rascunho do painel sobrevive à expiração de sessão ·
política de senha em sincronia entre cliente e servidor · corrigir e reenviar o
formulário de suporte não trava mais no piso de idade · nonce vencido reabre o
modal com aviso em vez de recarregar seco.

**Achados da revisão formal de código (`/code-review`), todos corrigidos:**

- 🔴 **O formulário de remoção estava quebrado.** O cliente enviava
  `form_token`, o servidor lia `body.formToken`. Com o `SIGNING_SECRET`
  configurado, todo pedido de remoção levava 403 — o canal que a LGPD exige,
  morto em silêncio. Abrir o modal no browser não pegava; só um envio completo
  pega, e agora há teste de ponta a ponta mais uma guarda estrutural sobre o
  nome do campo nos dois lados.
- **Login barrado ainda gastava cota de KV.** `noteFailedLogin` gravava mesmo
  para tentativa já recusada pelo rate limit: mil POSTs não autenticados
  esgotariam as 1000 escritas/dia da conta e derrubariam eventos, sessões e
  consentimento.
- **Tentativa barrada consumia o orçamento diário do login.** Os dois limites
  eram chamados juntos, então as 60/dia acabavam dez vezes mais rápido — um IP
  de NAT compartilhado trancava o dono por 24 h em um minuto.
- **Alerta de força bruta podia nunca disparar.** `attempts === 5` num contador
  de KV não atômico: duas requisições concorrentes pulam de 4 para 6. Agora `>=`.
- **Galeria sem JavaScript ficava ilegível.** O masonry depende de JS para
  definir a altura de cada card; sem ele (e nos primeiros ~60 ms de todo
  carregamento) os cards colapsavam para 4 px e se sobrepunham. Agora o grid
  cai num layout comum até o cálculo acontecer. Verificado com JS desligado.
- **`?tema=toString`** pré-preenchia o campo de mensagem do suporte com
  `function toString() { [native code] }` (lookup em protótipo).

**CodeQL:** já roda pelo *default setup* do GitHub (Settings → Code security),
que cobre `javascript-typescript` e `actions`. Um job de CodeQL no
`security.yml` seria uma "advanced configuration" e o GitHub recusa as duas ao
mesmo tempo — foi o que derrubou a primeira versão do workflow. Para elevar o
rigor, mude a *query suite* para `security-extended` nas Settings, não no YAML.

Ele encontrou três achados neste PR que nem a revisão manual nem a suíte
pegaram — todos corrigidos, cada um com teste de regressão que foi verificado
falhando contra o código antigo:

- **Host reconhecido por prefixo de string** (`src/ui/markdown.js`). O link
  absoluto do próprio site virava caminho relativo via
  `href.startsWith('https://fotos.lucafchala.com')`. Isso aceita
  `https://fotos.lucafchala.com.exemplo.com/x` e
  `https://fotos.lucafchala.com@exemplo.com/x` — hosts de terceiros que só
  *começam* com o nosso nome — e devolvia o resto fatiado, que o navegador lê
  como caminho relativo. Agora quem decide é `new URL()` comparando `host`. A
  regra que rebaixa GitHub a texto continua por substring de propósito: é
  negação, e alcance a mais ali erra para o lado seguro.
- **Desescape duplo do destino do link** (`src/ui/markdown.js`). O destino chega
  escapado e era desescapado em `replace` encadeados; `&amp;quot;` perdia duas
  camadas em vez de uma e virava aspas de verdade — o caractere que fecha o
  atributo `href`. O `escape()` da emissão ainda segurava a fuga, mas depender
  do último passo é frágil. Agora é uma passada só, que nunca reexamina o que
  acabou de produzir.
- **O próprio teste checava GitHub por substring** (`tests/security.test.js`).
  `href.includes('github.com')` erra nos dois sentidos: aprova
  `https://github.com.exemplo.com/` e reprova `https://exemplo.com/?ref=github.com`.
  O invariante é para onde o clique leva, então agora cada `href` é resolvido
  contra a origem do site e comparado por `host`.

A lição operacional: a análise estática achou o que três passagens de revisão
manual não acharam, e os três achados eram da mesma família (comparar URL como
texto). Vale reler qualquer checagem de origem/host com esse olhar antes de
confiar nela.

**Lint cobria só `src` e `tests`.** `scripts/build-legal-docs.mjs` — que gera o
conteúdo publicado em doze páginas — ficava de fora. Agora `npm run lint`
inclui `scripts/`, com os globais de Node declarados no `eslint.config.js`.

**Observabilidade ligada no painel seria apagada pelo próximo deploy.** Os
logs e traces foram ligados no painel da Cloudflare, mas o `wrangler.toml` não
tinha bloco `[observability]` — e o `wrangler deploy` trata a configuração como
fonte da verdade, desligando o que não está declarado ali. Do próprio código do
wrangler: *"will remove observability if it has been removed from their Wrangler
configuration file"*, enviando `{ enabled: false }`. Como o deploy roda a cada
push na `main`, o log pararia de ser gravado sem ninguém ter mexido em nada — e
a descoberta viria no meio de um incidente, quando o histórico já se perdeu.
Bloco fixado no `wrangler.toml` com exatamente os valores do painel.

**Um check do smoke test era estruturalmente incapaz de passar.** A checagem
"o nonce do cabeçalho aparece no HTML" lia o nonce dos cabeçalhos capturados
numa requisição e procurava esse valor no corpo de **outra** requisição. Como o
nonce é gerado por requisição — que é exatamente a propriedade que ele deveria
proteger — os dois nunca poderiam bater.

O defeito ficou escondido porque uma etapa anterior sempre falhava antes de
chegar nele: primeiro o `HEAD` caindo no 404, e antes disso a CSP. Ou seja, um
check que eu escrevi só foi de fato exercido no terceiro deploy. A lição é
específica: **etapa de CI que nunca chegou a rodar não é etapa que passa** — e
`set -e` faz a primeira falha esconder todas as seguintes. Rodar o passo inteiro
localmente contra o Worker de verdade, antes de subir, custa dois minutos e
teria evitado os três ciclos.

Corrigido para uma requisição só (`curl -s -D - -o corpo`), e aproveitei para
somar a checagem que faltava: **o nonce tem de MUDAR entre requisições**. Um
nonce constante passaria no teste de "bate com o HTML" e não protegeria nada —
bastaria ler o valor uma vez e reusar para sempre.

**`SIGNING_SECRET` criado vazio não era distinguido de bem configurado.**
`wrangler secret put` aceita valor vazio sem reclamar, então "criei o secret" e
"o secret existe" não são a mesma coisa — e foi exatamente o que aconteceu aqui.
O caso vazio já falhava seguro por acidente (string vazia é falsy em JS), mas
dois vizinhos dele não:

- **Só espaço/quebra de linha** (o resultado de colar valor no terminal) é
  *truthy*: viraria uma chave HMAC de verdade, com o painel jurando que a
  proteção está ativa. É o falso verde, o pior dos estados possíveis.
- **Segredo curto** era aceito sem piso. Uma chave de 8 caracteres cai numa
  varredura offline a partir de um único token assinado; daí em diante dá para
  forjar nonce de Drive e token de formulário — pior do que ter o controle
  desligado, porque o painel diria que está ligado.

Agora há uma fonte única (`signingSecretProblem`): recusa vazio, espaço em
branco e menos de 32 caracteres, e normaliza com `trim()` para que um newline
colado não produza uma chave diferente da que a pessoa configurou. O relatório
do `/api/healthz` e do painel lê **da mesma função** que decide se a chave é
usada — antes eram duas opiniões (`!!env.SIGNING_SECRET`) sobre o mesmo fato, e
a divergência apareceria como painel verde sobre segredo recusado. A mensagem
diz qual é o defeito ("ausente ou vazio" vs. "curto demais (N de 32)"), porque
as duas situações levam a ações diferentes.

Efeito colateral que valeu registro: os fixtures dos testes usavam segredos de
16 caracteres e passaram a cair abaixo do piso — os testes de token de
formulário voltaram a passar validando o caminho **sem** assinatura. Corrigidos
para comprimento realista, senão a suíte estaria verde testando outra coisa.

**`HEAD` devolvia 404 no site inteiro.** Todas as rotas casavam com
`method === 'GET'`, então um `HEAD` atravessava o roteamento sem casar com nada
e caía no 404: `GET /` respondia 200 e `HEAD /` respondia 404 na mesma URL.
Não é preciosismo de RFC — monitor de uptime, verificador de link e parte dos
crawlers pedem `HEAD` justamente para não baixar o corpo, e para todos eles o
site parecia fora do ar. Agora o `HEAD` delega ao roteamento normal com um GET
equivalente e descarta só o corpo (mesmo status, mesmos cabeçalhos).

Duas coisas valem registro sobre COMO isso apareceu:

- **O sintoma apontava para o lugar errado.** O smoke test do deploy lê os
  cabeçalhos com `curl -sI` (que é um HEAD), caiu na página de erro — que não
  tem script inline e portanto legitimamente não leva nonce — e reprovou com
  "CSP nonce ausente". Passei a checar o status do próprio HEAD *antes* de
  olhar qualquer cabeçalho, para o relatório apontar a causa e não o efeito.
- **Nenhum teste pegava isso**, porque todos os testes de rota mandam GET. O
  bug era anterior a esta entrega e só ficou visível quando o deploy passou a
  inspecionar cabeçalhos com HEAD. Agora há teste de paridade GET/HEAD para as
  rotas públicas, verificado falhando contra o código antigo.

**Auditoria de vazamento de campos só-admin:** verificada — `internalNotes`,
`driveUrl` e `status` **não** chegam ao HTML público. Os templates leem campo a
campo, não despejam o objeto do evento. Nada a corrigir.

---

## Operação

- [ ] **Marcar releases com tag** a cada deploy relevante, para que rollback seja
      um SHA conhecido em vez de arqueologia no log. Procedimento no
      [README](./README.md#rollback); hoje o repo não tem nenhuma tag.
- [ ] **Destino persistente para o beacon de performance** (`POST /api/perf`) —
      hoje só cai em log estruturado. Basta criar o binding `PERF` do Analytics
      Engine no `wrangler.toml`; o handler já trata os dois casos e passa a
      gravar sozinho.
- [ ] **QA visual automatizado** (Playwright, smoke test) tirando screenshot das
      páginas principais (galeria, um evento com Drive, dashboard) a cada
      deploy — hoje a validação visual depende de abrir o site manualmente,
      não tem cobertura automática de regressão de layout.

---

## Recursos planejados

- [ ] **Senha por evento** (acesso privado)
- [ ] **Migrar imagens para Cloudflare R2** — resolve preview no WhatsApp e
      cache das capas de uma vez só.
  > **Por que não dá para só adicionar `Cache-Control` nas imagens do Drive:**
  > `sizedDriveThumb()` devolve uma URL do `lh3.googleusercontent.com` que vai
  > direto no `src` da `<img>`. Quem busca essa imagem é o browser, falando com
  > o Google — o Worker não está no caminho e não tem resposta para carimbar. Só
  > passaria a ter se as imagens fossem servidas por uma rota nossa, e aí cada
  > thumbnail vira uma requisição de Worker: uma galeria de 12 cards sai de 1
  > para 13 requisições, contra a cota de 100 mil/dia. Por isso o cache das
  > capas não foi feito à parte — está embutido neste item.
- [ ] **Portfólio público `/portfolio`** com curadoria das melhores fotos
- [ ] **Lembrete de entrega** — campo "data prometida" no evento; dashboard
      destaca em vermelho os atrasados.
- [ ] **Modelo/"template" de evento** — ao lado do "Duplicar evento" já
      existente (que copia um evento específico), salvar uma configuração
      padrão reutilizável (ex: "formatura", "casamento") com categoria/tipo de
      acesso/notas já preenchidos, pra criar vários eventos parecidos mais
      rápido sem precisar duplicar um evento real toda vez.
- [ ] **Guardar a proporção da foto na hora de curar o evento** — o grid
      masonry da galeria (CSS Grid + `layoutMasonry()` calculando
      `grid-row-end` a partir da altura real renderizada) segue a proporção
      real de cada thumbnail, mas como o modelo de dados só guarda a URL da
      foto (não dimensões), o `.thumb` não sabe a altura final até a imagem
      carregar e o JS recalcular — algum reflow residual é inerente a isso.
      Guardar `width`/`height` (ou só a razão) no momento em que a foto é
      adicionada ao evento eliminaria isso de vez (CLS zero), sem custo de
      requisição extra por foto.

---

## Ideias não priorizadas

Nada aqui está comprometido — é material para escolher quando sobrar tempo.

### Engajamento do visitante

- **Favoritas pelo visitante** — marcar fotos com ❤ (localStorage) e um botão
  "compartilhar minha seleção" que gera link com as escolhidas. Bom para
  casamentos, onde cada convidado quer mostrar só "as fotos dele".
- **Livro de visitas** — recado dos convidados no fim da página do evento, com
  moderação no dashboard. Vira lembrança digital.
- **Slideshow / modo apresentação** — carrossel em tela cheia com transição
  automática. Bom para projetar num evento.
- **Stories estilo Instagram** — 5–10 fotos como highlights no topo da página,
  em círculos que abrem em tela cheia.

### Profissional / portfólio

- **Página `/contato`** — formulário (nome / e-mail / tipo de evento / data /
  mensagem) enviando via Resend. Captura cliente sem depender de DM.
- **Depoimentos de clientes** em `/depoimentos` ou na home. Prova social.
- **Status "aceitando novos projetos"** — badge na home ("Agendando para
  janeiro/2027" / "Agenda fechada até março"). Define expectativa.
- **Mini-gráfico de visualizações no dashboard** — hoje as métricas são só
  números/CSV; um sparkline simples de views ao longo do tempo por evento
  ajudaria a ver o que está performando sem precisar exportar nada.

### UX

- **Internacionalização (EN/PT)** na galeria e nas páginas de evento.
- **Link nominado por convidado** — `/casamento-ana-joao?guest=marina` mostra
  "Olá, Marina!" no topo. Toque pessoal sem login.

### Futuro distante

- **Integração com a Google Drive API** — listar e selecionar fotos direto da
  pasta em vez de copiar URL uma a uma. Requer OAuth; elimina o trabalho manual.
- **Download em ZIP via Worker** — visitante não precisa entender o Drive.
  Pesado em CPU/banda; só vale se o Drive virar problema.
- **App nativo** (React Native ou Capacitor) — câmera direta, upload em massa,
  push. Hoje o PWA resolve.

---

## Decidido não fazer

- **Avaliações por estrelas** — foi implementado e removido a pedido do dono.
  Não reintroduzir sem necessidade nova.
- **QR Code** — removido junto com a lib quebrada (e a entrada de CSP do
  jsDelivr). Sem uso real.
- **Contagem de fotos** (manual + auto-contagem opcional via Google Drive API)
  — foi implementada e removida por completo a pedido: as fotos já vêm
  numeradas, o dado era redundante. Não reintroduzir sem necessidade nova.
- **Monitoramento de uptime terceirizado** (UptimeRobot/HetrixTools/Better
  Stack) — cogitado e descartado a pedido do dono. O monitoramento continua
  100% interno (`status.lucafchala.com`), que em troca ganhou cobertura
  deliberadamente desproporcional em fotos.lucafchala.com (ver seu README,
  tabela de serviços). Isso significa aceitar conscientemente o ponto único
  de falha que motivou cogitar um terceiro: `status.lucafchala.com` roda na
  mesma conta Cloudflare que monitora, então uma queda de conta inteira (ou
  do Resend, ou do cron do GitHub Actions) não seria detectada por nada
  aqui. Não reintroduzir sem necessidade nova — se reconsiderado, a análise
  de provedores (HetrixTools grátis, 15 monitores, canais Discord/Pushover/
  ntfy.sh; UptimeRobot como redundância) ainda vale, só ficou de fora deste
  arquivo.
