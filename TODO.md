# Pendências — fotos.lucafchala.com

Só o que está **em aberto**, mais as regras que continuam valendo. Item
entregue sai deste arquivo — o histórico de quem fez o quê fica no git
(`git log`) e nos PRs, não aqui. As seções estão em ordem de prioridade; dentro
de cada uma, o primeiro item é o próximo a atacar.

> Quando fechar um item, **apague-o**. Não o transforme em relato do que foi
> feito: foi assim que este arquivo chegou a 640 linhas, das quais ~290 eram
> trabalho já entregue. O que sobrevive ao fechamento é só a regra que alguém
> precisa seguir amanhã — e essa mora em [Regras vivas](#regras-vivas).

---

## Plano gratuito — a restrição que decide o resto

> 🔜 **A decisão mudou: o dono vai assinar o Workers Paid.** Enquanto o
> pagamento não acontecer, tudo nesta seção continua valendo e o código no
> `main` está correto como está. Depois de assinar, o passo a passo da compra e
> a lista do que mexer (e do que **não** mexer) estão em
> [`docs/PLANO-PAGO.md`](./docs/PLANO-PAGO.md).

**Enquanto isso, o projeto está no plano gratuito.** Isso não é nota de rodapé
sobre custo — é a restrição de projeto mais forte que existe aqui, e qualquer
item deste arquivo que a contrarie está errado, não a decisão.

**Na prática:** toda proposta passa por "quanto isso custa de cota?" antes de
"quanto isso melhora o site?". Um recurso que gasta escrita em KV por visitante
não é caro — é *inviável*, porque o custo cresce junto com o público contra um
teto que não se mexe.

### O orçamento, medido

O limite mais apertado é **escrita em KV: 1000/dia para a conta inteira**,
compartilhada com o `status.lucafchala.com`. Medido no harness do
[`docs/VERIFICACAO.md`](./docs/VERIFICACAO.md), com 40 visitantes simulados:

| item | custo |
| --- | --- |
| visitante engajado, tráfego **espalhado** | **4 escritas** |
| visitante engajado, em **rajada** (chegam juntos) | **~2,1 escritas** |
| POST de lixo em `/api/track-drive` | 0 |
| status page (amostra de latência, regime normal) | ~48/dia |
| **teto prático** | **~250 a ~475 visitantes/dia**, conforme o formato do tráfego |

Esse número é da era em que rate limit e contadores viviam no KV. Hoje os
quatro saíram de lá: os dois rate limits (`drive-link` e `drive`) e os dois
contadores (`views`, `drive_clicks`) são Durable Objects, e **um visitante não
gasta mais nenhuma escrita de KV**. O que ainda grava em KV é o painel — lista
de eventos, sessões, consentimento — e o `cron:last`.

Os outros limites não chegam perto — 28 eventos contra 1 GB de KV, uma linha de
consentimento por liberação contra 100 mil linhas/dia no D1, um punhado de
requisições por visitante contra 100 mil/dia. **As fotos não passam pelo
Worker** (saem do `lh3.googleusercontent.com` direto para o browser), e é isso
que mantém a conta de requisições irrelevante.

### O que acontece se estourar

Nada de catastrófico, e isso é resultado de trabalho, não sorte:

1. **As fotos continuam saindo.** A recusa de escrita é isolada e o portão do
   Drive deixa passar quem já tinha passado na verificação (fail-open
   deliberado, ver [SECURITY.md](./SECURITY.md#rate-limits-fail-open-when-they-cannot-be-recorded)).
2. **Param até a virada UTC:** contador de visitas, contador de cliques, rate
   limit e abertura de sessão nova no painel.
3. **O dono é avisado.** O `/api/healthz` acusa em `problems`, o painel de
   status vira `degraded` e dispara e-mail.

### Se um dia o teto ficar pequeno

Nesta ordem, e **nenhuma delas é pagar**:

- [ ] **Contadores fora do KV.** `views:` e `drive_clicks:` para log estruturado
      / Analytics Engine, como `/api/perf` e `/api/csp-report` já fazem. Elimina
      o que sobrou de contabilidade, mas perde o número no painel — só vale se o
      número deixar de valer a escrita.
- [ ] **Amostrar o contador de visitas** (contar 1 em N e multiplicar). Barato
      de implementar; o honesto seria admitir, antes, que o número vira
      estimativa.

---

## Lançamento

- [ ] **Ligar o painel de cotas do status.** `CF_API_TOKEN` (Account
      Analytics:Read) + `CF_ACCOUNT_ID` nas variáveis do Pages. Sem eles o
      `/api/quota-stats` responde `configured: false` e o painel esconde o
      bloco — ou seja, o consumo real das cotas fica invisível justamente sob a
      política de ficar no gratuito. É o instrumento que torna a seção acima
      verificável em vez de teórica.
- [ ] Link para fotos.lucafchala.com na bio do Instagram (@lucafchala)
- [ ] Link na homepage pessoal (lucafchala.com)

---

## Segurança e anti-abuso

### Ações do dono (fora do código) — prioridade

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
      com coletor em `/api/csp-report`. Falta o trabalho de fato: trocar os **68**
      handlers inline (`onclick="…"`) por listeners delegados — inclusive os que
      o painel gera dinamicamente via `innerHTML`.
      > ⚠️ **Não acrescente o nonce à política enforced antes disso.** Pela CSP
      > Level 3 o nonce descarta o `'unsafe-inline'`, e a interface inteira para
      > de responder. Já aconteceu, e só foi pego com browser de verdade — teste
      > de unidade sobre o texto da política não enxerga isso.
      Quando os relatórios zerarem, tirar os handlers e então deixar a enforced
      usar `strict` (`contentSecurityPolicy()` em `src/security.js`).
- [ ] **Levar o JS embutido para dentro do alcance do lint e do typecheck.**
      Os `<script>` das páginas vivem dentro de template literals
      (`src/ui/dashboard.js`, `event.js`, `gallery.js`), então **eslint e tsc
      não enxergam nada ali** — é código de produção sem rede de proteção, e o
      próprio template de PR admite isso ao pedir verificação manual. O preço já
      foi cobrado mais de uma vez: um `const` usado antes da declaração morreu
      em TDZ engolido por `try/catch`, e a CSP derrubou os handlers inline com a
      suíte inteira verde. Some-se o risco de edição: **uma crase solta em
      qualquer comentário ou string desses blocos encerra o template literal e
      quebra o módulo**. Caminho provável: extrair para `.js` de verdade e
      embutir no build, o que também devolve os handlers ao alcance da CSP
      estrita (item acima).
- [ ] **Decidir a semântica de "Ocultar" um projeto.** Hoje é **não listado**:
      sai da galeria, do sitemap e da auditoria, e vai com
      `X-Robots-Tag: noindex` — mas continua abrindo por link direto (o que faz
      um link de prévia enviado a cliente continuar funcionando). Se a
      expectativa for "privado", o handler precisa devolver 404 para quem não
      está logado. Não mudado por conta própria porque quebraria links já
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
      > Ao fechar este item, apague `fontPreconnectHTML()` (`utils.js`) — e o
      > teste que a trava — junto com os `<link>`. Preconnect para host que a
      > página não usa mais é conexão aberta à toa.
- [ ] **Afinar Bot Fight Mode / regras de WAF** no Cloudflare: barrar abuso sem
      bloquear crawlers de preview (WhatsApp/Instagram) nem visitantes legítimos.
- [ ] **EXIF em HEIC/AVIF/GIF.** JPEG, PNG e WebP já são limpos no servidor
      (`stripImageMetadata()`). Nesses três o metadado vive dentro de caixas
      ISO-BMFF, e reescrevê-las sem um decodificador de verdade arriscaria
      corromper a prova que o titular enviou. Hoje o portão é a **própria
      capacidade de limpar**: se o strip não confirmou, o anexo não vai — então
      ensinar HEIC ao strip abre o portão sozinho, sem segunda lista para
      divergir.

---

## Operação

> O orçamento de cota e o que fazer quando ele apertar estão em
> [Plano gratuito](#plano-gratuito--a-restrição-que-decide-o-resto), no topo.
> Não duplicar a conta aqui: ela muda quando o código muda, e duas cópias
> divergem.

- [ ] **Estender a resiliência a queda de KV para além do caminho das fotos.**
      Galeria, página do projeto e portão do Drive sobrevivem hoje a uma queda
      de leitura (cópia na Cache API, ver
      [SECURITY.md](./SECURITY.md#the-event-list-survives-kv-being-unavailable)).
      Ainda respondem 500 numa queda total: o formulário de suporte (leitura da
      chave de deduplicação), o de remoção (`removal_requests`) e o login do
      painel (`admin_password`, `verifySession`). Ordem de prioridade correta —
      entregar foto vem primeiro —, mas o formulário de remoção é canal de
      direito do titular e merece pelo menos falhar com mensagem em vez de 500.
      No login o certo é falhar **fechado**, nunca servir sessão de cópia.
- [ ] **Marcar releases com tag** a cada deploy relevante, para que rollback seja
      um SHA conhecido em vez de arqueologia no log. Procedimento no
      [README](./README.md#rollback); hoje o repo não tem **nenhuma** tag.
- [ ] **Destino persistente para o beacon de performance** (`POST /api/perf`) —
      hoje só cai em log estruturado, e **provavelmente fica assim**. O handler
      já trata os dois casos: sem o binding `PERF`, nada quebra. Antes de mexer,
      confirmar se o Analytics Engine está disponível no plano gratuito — as
      fontes divergem e historicamente ele exigia o Workers Paid, o que sob a
      política de ficar no gratuito encerra o assunto.
- [ ] **QA visual automatizado** (Playwright, smoke test) tirando screenshot das
      páginas principais (galeria, um evento com Drive, dashboard) a cada
      deploy — hoje a validação visual depende de abrir o site manualmente, e é
      justamente onde os bugs que a suíte não pega aparecem.

---

## Regras vivas

O que sobrou de entregas passadas porque **continua sendo regra**, não relato.
O contexto de cada uma está no `git log` e nos PRs.

### Ao editar qualquer documento em `docs/legal/` ou o `SECURITY.md`

1. Rode **`npm run build:legal`** e commite o `src/content/legal-docs.js`
   gerado. A CI regenera e compara — esquecer derruba o build, de propósito:
   sem isso a página publicada mostraria um texto diferente do documento
   oficial.
2. **Nunca edite `src/content/legal-docs.js` à mão.** Ele é gerado.
3. **Não acrescente link para o GitHub** em página nenhuma. Só o "Código-fonte"
   do rodapé pode. A CI verifica, e o renderizador rebaixa qualquer link de
   GitHub a texto puro de qualquer forma.
4. Documento novo entra em `DOCS`, em `scripts/build-legal-docs.mjs` — é de lá
   que saem o slug, o card da Central, a rota e o sitemap, todos de uma lista só.
5. Slug é **contrato público** (está no sitemap, pode estar salvo por alguém).
   Renomear quebra link de fora.

### `/api/healthz` público diz qual controle está desligado — decisão mantida

O que vaza é que o `SIGNING_SECRET` falta, logo o nonce de página e os tokens de
formulário estão off. Para um atacante isso vale reusar um token Turnstile entre
páginas — e **os slugs já são públicos**, estão no `sitemap.xml`. É controle de
abuso, não de confidencialidade. Esconder custaria a sinalização que se provou
útil: foi essa mensagem que fez um secret vazio ser descoberto. No estado normal
(`problems: []`) não há vazamento nenhum.

**Se o modelo de ameaça mudar**, o caminho é servir o detalhe só com sessão de
admin e deixar público apenas `{ ok, kv, latências, cron }`. O painel de status
já degrada sozinho quando os campos faltam. Não faça isso sem necessidade: o
custo é perder o alarme.

### Comparar URL como texto é a família de bugs desta base

Três achados independentes vieram daí — host aceito por prefixo
(`https://fotos.lucafchala.com.exemplo.com`), desescape duplo abrindo o atributo
`href`, e um teste que checava GitHub por `includes()`. Antes de confiar em
qualquer checagem de origem/host, releia com esse olhar: quem decide host é
`new URL()` comparando `host`, nunca `startsWith`. A exceção é regra de
**negação** (rebaixar GitHub a texto), onde alcance a mais erra para o lado
seguro.

### CodeQL mora nas Settings, não no YAML

Já roda pelo *default setup* do GitHub (Settings → Code security), cobrindo
`javascript-typescript` e `actions`. Um job no `security.yml` seria "advanced
configuration" e o GitHub recusa as duas ao mesmo tempo. Para elevar o rigor,
mude a *query suite* para `security-extended` nas Settings.

### `wrangler.toml` é a fonte da verdade da observabilidade

O `wrangler deploy` **desliga o que não está declarado ali**, mesmo que tenha
sido ligado no painel. Como o deploy roda a cada push na `main`, um bloco
`[observability]` ausente faz o log parar de ser gravado sem ninguém ter mexido
em nada — e a descoberta viria no meio de um incidente. O bloco está fixado; não
o remova.

### Etapa de CI que nunca chegou a rodar não é etapa que passa

`set -e` faz a primeira falha esconder todas as seguintes: um check do smoke
test ficou estruturalmente incapaz de passar por três deploys porque algo antes
dele sempre falhava primeiro. Rodar o passo inteiro localmente contra o Worker
de verdade, antes de subir, custa dois minutos.

### Teste verde não é verificação

`npm test` prova que as funções fazem o que as funções fazem, não que o site
funciona — ver [`docs/VERIFICACAO.md`](./docs/VERIFICACAO.md). Nesta base a
suíte inteira já passou verde sobre a CSP matando ~68 handlers inline e sobre a
galeria ilegível sem JS. Mudança em página pública ou no painel se verifica com
browser.

---

## Recursos planejados

- [ ] **Senha por evento** (acesso privado)
- [ ] **Migrar as capas para Cloudflare R2** — resolve preview no WhatsApp e
      cache das capas de uma vez só, e **cabe no plano gratuito**.
  > **Por que não dá para só adicionar `Cache-Control` nas imagens do Drive:**
  > `sizedDriveThumb()` devolve uma URL do `lh3.googleusercontent.com` que vai
  > direto no `src` da `<img>`. Quem busca essa imagem é o browser, falando com
  > o Google — o Worker não está no caminho e não tem resposta para carimbar.
  >
  > **A conta:** servir as imagens por uma **rota nossa no Worker** custaria uma
  > requisição por thumbnail (1 → 13 numa galeria de 12 cards). Com o R2 não:
  > um bucket com **domínio personalizado** é servido direto pela borda, **sem
  > Worker no caminho**. A galeria continua custando 1 requisição de Worker, e
  > as leituras viram Class B do R2, cuja franquia é de **10 milhões/mês**.
  >
  > **Custo real:** franquia de 10 GB de armazenamento, 1 milhão de Class A
  > (uploads), 10 milhões de Class B (leituras), egresso zero. Só as **capas e
  > thumbnails** vão para o R2 — a foto em resolução cheia continua no Drive —
  > então 28 projetos são um arredondamento contra 10 GB. Ressalva: o R2 em
  > geral pede cartão cadastrado mesmo para usar a franquia gratuita.
  >
  > **Por que vale a pena agora:** o cartão de pré-visualização do link já vai
  > completo — título, data, colaborador e `og:image` recortado em 1200×630 com
  > as dimensões declaradas — mas o `og:image` de um projeto normal ainda aponta
  > para o `lh3.googleusercontent.com`, e o crawler do WhatsApp é irregular com
  > imagem hospedada no Google. Quando ele não consegue buscar, o cartão aparece
  > só com texto. É por WhatsApp que um link de evento se espalha, e essa é a
  > última peça que falta.
- [ ] **Portfólio público `/portfolio`** com curadoria das melhores fotos
- [ ] **Lembrete de entrega** — campo "data prometida" no evento; dashboard
      destaca em vermelho os atrasados.
- [ ] **Modelo/"template" de evento** — ao lado do "Duplicar evento" já
      existente (que copia um evento específico), salvar uma configuração
      padrão reutilizável (ex: "formatura", "casamento") com categoria/tipo de
      acesso/notas já preenchidos.
- [ ] **Guardar a proporção da foto na hora de curar o evento** — o grid
      masonry da galeria segue a proporção real de cada thumbnail, mas como o
      modelo de dados só guarda a URL (não dimensões), o `.thumb` não sabe a
      altura final até a imagem carregar e o JS recalcular. Guardar
      `width`/`height` (ou só a razão) no momento em que a foto é adicionada
      eliminaria o reflow de vez (CLS zero), sem requisição extra por foto.

---

## Ideias não priorizadas

Nada aqui está comprometido — é material para escolher quando sobrar tempo.

### Engajamento do visitante

- **Favoritas pelo visitante** — marcar fotos com ❤ (localStorage) e um botão
  "compartilhar minha seleção" que gera link com as escolhidas. Bom para
  casamentos, onde cada convidado quer mostrar só "as fotos dele".
- **Livro de visitas** — recado dos convidados no fim da página do evento, com
  moderação no dashboard.
- **Slideshow / modo apresentação** — carrossel em tela cheia com transição
  automática. Bom para projetar num evento.
- **Stories estilo Instagram** — 5–10 fotos como highlights no topo da página.

### Profissional / portfólio

- **Página `/contato`** — formulário (nome / e-mail / tipo de evento / data /
  mensagem) enviando via Resend. Captura cliente sem depender de DM.
- **Depoimentos de clientes** em `/depoimentos` ou na home. Prova social.
- **Status "aceitando novos projetos"** — badge na home ("Agendando para
  janeiro/2027" / "Agenda fechada até março"). Define expectativa.
- **Mini-gráfico de visualizações no dashboard** — hoje as métricas são só
  números/CSV; um sparkline de views ao longo do tempo por evento ajudaria a ver
  o que está performando sem exportar nada.

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

- **Pagar por qualquer serviço da Cloudflare ALÉM do Workers Paid** — Cloudflare
  Images, Stream, plano Pro. Registrado aqui para não ser redescutido a cada
  aperto.
  > 🔜 **O Workers Paid saiu desta lista**: o dono decidiu assinar. Ver
  > [`docs/PLANO-PAGO.md`](./docs/PLANO-PAGO.md), que traz o que ele compra —
  > teto de CPU, requisições e escrita em KV sem limite diário — e o que **não**
  > muda com dinheiro (o limite de 1 escrita/s por chave).
  - **Cloudflare Images** vende transformação de imagem, que este site não faz —
    o Drive já devolve thumbnail no tamanho pedido (`sizedDriveThumb()`), e a
    hospedagem das capas cabe na franquia do R2.
  - **Plano Pro** é WAF e otimização de imagem. CSP, Turnstile, portão de CSRF e
    rate limit já cobrem o que o WAF compraria aqui.
  - **Stream** não se aplica: não há vídeo.
  > A exceção que **não** é serviço da Cloudflare: se a conta do Google Drive
  > for pessoal, migrar para Workspace continua em aberto — e por motivo de
  > conformidade (DPA para o art. 33, III), não de armazenamento. Ver a seção
  > de ações do dono.
- **Avaliações por estrelas** — foi implementado e removido a pedido do dono.
  Não reintroduzir sem necessidade nova.
- **QR Code** — removido junto com a lib quebrada (e a entrada de CSP do
  jsDelivr). Sem uso real.
- **Contagem de fotos** (manual + auto-contagem opcional via Google Drive API)
  — implementada e removida por completo a pedido: as fotos já vêm numeradas, o
  dado era redundante. Não reintroduzir sem necessidade nova.
- **Monitoramento de uptime terceirizado** (UptimeRobot/HetrixTools/Better
  Stack) — cogitado e descartado a pedido do dono. O monitoramento continua
  100% interno (`status.lucafchala.com`), que em troca ganhou cobertura
  deliberadamente desproporcional em fotos.lucafchala.com. Isso significa
  aceitar conscientemente o ponto único de falha que motivou cogitar um
  terceiro: `status.lucafchala.com` roda na mesma conta Cloudflare que monitora,
  então uma queda de conta inteira (ou do Resend, ou do cron do GitHub Actions)
  não seria detectada por nada aqui. Não reintroduzir sem necessidade nova.
