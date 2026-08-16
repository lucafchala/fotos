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

**Central de Transparência (`/legal`, também `/compliance`).** Hub público que
reúne privacidade, termos, política de segurança, o resumo do que é feito com
cada dado, os canais de contato e a documentação de `docs/legal/`. O rodapé
passou a ter um único link "Legal" no lugar de "Privacidade" + "Termos" — sem
perder acesso a nada, já que a página mostra mais do que os dois links soltos
mostravam. Ao mexer em `docs/legal/`, confira se `src/ui/legal.js` continua
coerente (há teste garantindo que Privacidade e Termos seguem a um clique).

Nonce assinado no `/api/drive-link` · honeypot + token de formulário com idade
mínima · alerta de login suspeito · strip de EXIF (JPEG/PNG/WebP) · CSP
report-only com coletor · dedupe de mensagens repetidas no suporte · checagem
de origem contra CSRF · cookie `__Host-` com timeout de inatividade · política
de senha · correção de injeção de fórmula em CSV · `no-store` nas respostas de
dados · higienização do restore de backup · `npm audit` + dependency-review +
invariantes de CI.

**CodeQL:** já roda pelo *default setup* do GitHub (Settings → Code security),
que cobre `javascript-typescript` e `actions`. Um job de CodeQL no
`security.yml` seria uma "advanced configuration" e o GitHub recusa as duas ao
mesmo tempo — foi o que derrubou a primeira versão do workflow. Para elevar o
rigor, mude a *query suite* para `security-extended` nas Settings, não no YAML.

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
