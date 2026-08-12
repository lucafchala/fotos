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

- [ ] **Nonce de curta duração no `/api/drive-link`** — impedir varredura
      automatizada de todos os slugs. O gate já é verificado no servidor
      (Turnstile fail-closed + rate limit por IP), mas nada amarra a chamada a
      uma visita real da página: um script com um token Turnstile válido em mãos
      consegue varrer vários slugs dentro do limite.
      _Requer decisão antes de implementar:_ nonce em KV gastaria justamente a
      cota de escrita que o `/api/perf` foi desenhado para preservar (1000/dia,
      compartilhada com eventos/sessões/consentimento); a alternativa é um nonce
      assinado (HMAC) sem estado, que precisa de um secret novo no
      `wrangler.toml`.
- [ ] **Auditar vazamento de campos só-admin** — garantir que `internalNotes` (e
      afins) nunca cheguem ao HTML público. Hoje o objeto do evento é passado
      inteiro para o template.
- [ ] **Login sem senha / recuperação de acesso** — magic link por e-mail via
      Resend (já configurado), substituindo ou complementando a senha do painel.
      Resolve de uma vez a recuperação de senha e boa parte do que 2FA
      cobriria; menos atrito que TOTP.
- [ ] **2FA/TOTP no painel** — só se o magic link não for suficiente.
- [ ] **Honeypot** (campo oculto) nos formulários públicos, como segunda camada
      além do Turnstile.
- [ ] **Endurecer a CSP** — trocar `script-src 'unsafe-inline'` por nonces nos
      scripts inline.
- [ ] **Alerta de login suspeito** — e-mail ao admin após N tentativas falhas
      (já há rate limit de 10/10 min).
- [ ] **Afinar Bot Fight Mode / regras de WAF** no Cloudflare: barrar abuso sem
      bloquear crawlers de preview (WhatsApp/Instagram) nem visitantes legítimos.
- [ ] **Strip de EXIF / metadados** das imagens enviadas no formulário de
      remoção (hoje só valida magic bytes + 2 MB).
- [ ] **CSP em modo report-only** — endpoint `report-to` que loga tentativas de
      payload bloqueadas pela CSP, para saber se alguém está testando XSS antes
      de endurecer de vez o `script-src 'unsafe-inline'` (item acima).
- [ ] **Rate-limit dedicado no formulário de suporte** para mensagens
      repetidas/idênticas — o Turnstile barra bot, mas um humano ainda consegue
      mandar a mesma mensagem várias vezes dentro do rate limit geral.

---

## Operação

- [ ] **Marcar releases com tag** a cada deploy relevante, para que rollback seja
      um SHA conhecido em vez de arqueologia no log. Procedimento no
      [README](./README.md#rollback); hoje o repo não tem nenhuma tag.
- [ ] **Destino persistente para o beacon de performance** (`POST /api/perf`) —
      hoje só cai em log estruturado. Basta criar o binding `PERF` do Analytics
      Engine no `wrangler.toml`; o handler já trata os dois casos e passa a
      gravar sozinho.
- [ ] **Monitoramento de uptime externo** batendo em `/api/healthz`
      (UptimeRobot, Cloudflare Health Checks, etc.) — o alerta por e-mail
      (`sendErrorAlert`) só dispara quando uma exceção chega ao catch-all do
      Worker; uma queda total (KV fora do ar, erro de deploy) não
      necessariamente lança uma exceção capturável e passaria em silêncio sem
      um ping externo.
- [ ] **QA visual automatizado** (Playwright, smoke test) tirando screenshot das
      páginas principais (galeria, um evento com Drive, dashboard) a cada
      deploy — hoje a validação visual depende de abrir o site manualmente,
      não tem cobertura automática de regressão de layout.

---

## Dívidas conhecidas

- [ ] **Página `/sobre` existe mas está fora do ar** — `src/ui/about.js` está
      escrito e não roteado (fora do sitemap e do rodapé), esperando a revisão
      do texto. Ou finalizar e publicar, ou remover o arquivo.

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

- **Modo claro automático** — respeitar `prefers-color-scheme`. Hoje só existe o
  escuro; algumas pessoas preferem fundo neutro para ver foto.
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
- **Tour guiado** (modal de boas-vindas em `/<slug>`) — já não existe no
  código; o item de "revamp" que estava aqui ficou obsoleto porque não há
  mais o que revisar. Se um tour guiado fizer sentido de novo no futuro, é
  melhor desenhar do zero do que recuperar o antigo.
