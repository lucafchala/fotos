# Pendências e Recomendações — fotos.lucafchala.com

## Lembrar

- [ ] Adicionar link para fotos.lucafchala.com na bio do Instagram (@lucafchala)
- [ ] Adicionar na homepage pessoal (lucafchala.com)
- [ ] Revisar e mergear as 2 PRs do Dependabot (confirmar CI verde antes):
  - **#48** — bump esbuild + vitest + wrangler (devDeps npm)
  - **#32** — `cloudflare/wrangler-action` 3 → 4 (este é o upgrade "wrangler 3 → 4" no deploy)

---

## ✅ Concluído

- **Robustez dos formulários (pré-lançamento):** formulário de remoção reseta o Turnstile após falha de envio (token é de uso único — evita o loop de 403 ao tentar de novo com token gasto) e protege a leitura do arquivo de upload; formulário de suporte não trava mais se o Turnstile for bloqueado (fallback reabilita o botão), preserva nome/e-mail/mensagem em caso de erro e tem guarda anti-duplo-envio; o painel redireciona ao login quando a sessão expira (401) e usa o diálogo temático no restore de backup
- **Aviso de bloqueador de anúncios / JavaScript:** quando o script do Turnstile é bloqueado (ad-blocker) ou o JS está desativado, o site avisa o visitante para desativar o bloqueador e ativar o JavaScript — no gate do Drive (sem bloquear o acesso às fotos), no formulário de remoção e no de suporte; banners `<noscript>` para quem está totalmente sem JS
- **Métricas:** corrigido bug do view count (`ctx.waitUntil()`); contagem de cliques no botão Drive adicionada
- **Resend:** API key configurada como secret no Worker; domínio verificado; e-mails de notificação e confirmação funcionando
- **Modo "Em breve":** toggle no dashboard, oculta cover photo na galeria e na página, botão Drive vira "As fotos virão em breve"
- **WhatsApp:** botão de compartilhamento no footer das páginas de evento
- **LGPD:** aviso de privacidade no rodapé do modal de remoção + SLA de 15 dias úteis
- **E-mail de remoção atendida:** ao marcar como resolvido no dashboard, solicitante recebe e-mail confirmando
- **Skeleton loaders:** shimmer animado nos cards da galeria enquanto a foto carrega
- **Tour guiado:** modal de boas-vindas no primeiro acesso a uma página de evento (lembrado via localStorage)
- **Notas privadas:** campo `internalNotes` em cada evento, só visível no dashboard
- **Status de produção:** dropdown no formulário + badge colorido na lista + filtro acima da lista (em-edição / em-revisão / entregue / arquivado)
- **Filtro padrão "Ativos":** dashboard esconde arquivados por padrão; opção "Todos" mostra tudo
- **PWA:** manifest.json + icon.svg + meta tags — dashboard instalável no celular
- **Cloudflare Web Analytics:** script injetado automaticamente nas páginas públicas (token hardcoded)
- **Ordenação manual:** botões ▲▼ em cada evento no dashboard reordenam os projetos (galeria pública respeita a ordem manual; fallback para data quando não houver ordem manual)
- **QR Code:** removido (lib quebrada e sem uso); CSP do jsDelivr também removida
- **Galeria organizada:** cards agrupados por ano + busca por texto + filtro por categoria + "Carregar mais" (12 por vez)
- **Categorias gerenciáveis:** criar/excluir categorias na aba Config (KV `categories`), edição em massa na aba Eventos (selecionar vários + aplicar categoria), filtros da galeria derivados delas
- **SEO:** `/sitemap.xml`, `/robots.txt`, canonical + Open Graph na galeria e nas páginas de evento, JSON-LD na home
- **LGPD:** página `/privacidade`, encarregado (`privacidade@lucafchala.com`), consentimento nos formulários, aviso de cookies, e retenção automática (cron apaga solicitações resolvidas > 180 dias)
- **Thumbnails leves:** galeria pede variante redimensionada do Drive (`=w600`/`=w1600`) em vez de resolução cheia
- **Hardening:** HSTS + Permissions-Policy, página 500 estilizada, `noindex` no admin, helper único de ordenação (`sortEvents`), ESLint no CI

---

## Próximas etapas planejadas

### Etapa 3 — Segurança
- [x] **Rate limiting** (feito): `/api/removal-request` 5/h por IP, e também login, suporte, consent, track-drive e healthz
- [x] **Backup do KV** (feito): endpoint `/api/backup` protegido (admin) exporta tudo como JSON + restore com merge inteligente
- [ ] **Recuperação de senha** via e-mail (link de reset via Resend)

### Etapa 3.1 — Endurecimento de segurança e anti-abuso (prioridade pós-lançamento)
- [ ] **Esconder os links do Drive do código-fonte.** Hoje `DRIVE_URL` / `DRIVE_URL_IG` ficam embutidos no HTML/JS da página, então qualquer pessoa acha o link pelo "ver código-fonte" ou console do navegador **sem passar pela verificação** — o gate (Turnstile + aceite dos Termos) é só client-side, cosmético. Servir o link por um endpoint (ex.: `POST /api/drive-link`) que só responde **depois de validar o token do Turnstile no servidor** + o slug, e buscar via fetch só quando o visitante passa no gate. _Ressalva:_ depois que um visitante legítimo recebe o link, ele continua compartilhável (links do Drive são por natureza compartilháveis) — isso barra a coleta trivial por bots/console, não o repasse manual.
- [ ] **Aplicar o aceite no servidor**: amarrar a liberação do link à verificação real do Turnstile + ao registro do consentimento (hoje `/api/consent` é best-effort e não trava nada).
- [ ] **Rate limit + nonce de curta duração** no endpoint de link, para impedir varredura automatizada de todos os slugs.
- [ ] **Auditar vazamento de campos só-admin**: garantir que `internalNotes` (e afins) nunca cheguem ao HTML público — hoje o objeto do evento é passado inteiro para o template.
- [ ] **Honeypot** (campo oculto) nos formulários públicos, como segunda camada além do Turnstile.
- [ ] **2FA/TOTP no painel** (ou magic link) — endurecer o login de admin além de senha + rate limit.
- [ ] **Afinar Bot Fight Mode / regras de WAF** no Cloudflare: barrar abuso sem bloquear crawlers de preview (WhatsApp/Instagram) nem visitantes legítimos.
- [ ] **Endurecer a CSP**: trocar `script-src 'unsafe-inline'` por nonces nos scripts inline.
- [ ] **Alerta de login suspeito**: e-mail ao admin após N tentativas falhas (já há rate limit de 10/10min).
- [ ] **Strip de EXIF / metadados** das imagens enviadas no formulário de remoção (hoje só valida magic bytes + 2 MB).

### Etapa 4 — Recursos
- [ ] Senha por evento (acesso privado)

> Nota: o formulário de avaliações (estrelas) foi implementado e depois **removido** a pedido do dono. Não reintroduzir sem necessidade.

### Etapa 5 — Longo prazo
- [ ] Migrar imagens para Cloudflare R2 (resolve preview no WhatsApp)
- [ ] Portfólio público `/portfolio` com curadoria das melhores fotos
- [x] Filtros por tag/categoria (feito: busca + filtro por categoria na galeria)

---

## Novas ideias (Claude)

### Operacional — para você se organizar

**Notas internas por evento**
Campo de texto privado em cada evento (só você vê no dashboard) para anotar: nome do cliente, valor cobrado, observações pós-evento, links de contratos, etc. Útil pra não depender da memória.

**Status de produção do evento**
Adicionar um campo de status: `em-edicao` / `em-revisao` / `entregue` / `arquivado`. Filtrar por status no dashboard. Você sabe na hora o que está parado e o que precisa de atenção.

**Lembrete de entrega**
Campo "data prometida de entrega" no evento. Dashboard destaca eventos atrasados em vermelho. Evita esquecer prazo combinado.

### Engajamento do visitante

**Sistema de favoritas pelo visitante**
O visitante marca fotos como favoritas (clique em ❤). Salvo no localStorage. Botão "compartilhar minha seleção" gera um link com as fotos escolhidas. Bom para casamentos onde os convidados querem mostrar só "as fotos deles".

**Livro de visitas / comentários**
Campo no final da página do evento onde convidados deixam recado (com moderação no dashboard). Bom para casamentos, aniversários — vira lembrança digital.

**Slideshow / apresentação**
Botão "modo apresentação" que abre o carrossel em tela cheia com transição automática a cada 4 segundos. Bom para projetar num evento ou apresentar fotos para um grupo.

**Stories estilo Instagram**
Destacar 5-10 fotos como "highlights" do evento na página. Aparecem como círculos no topo, abrem em tela cheia ao tocar. Carrossel mais visual e moderno que o atual.

### Profissional / portfólio

**Página /contato com formulário**
Formulário simples ("seu nome / e-mail / tipo de evento / data / mensagem") que envia via Resend pra você. Captura novos clientes sem precisar do DM no Instagram.

**Página /sobre**
Bio profissional, equipamentos, processo de trabalho, faixa de preços ou link para orçamento. Aumenta credibilidade.

**Depoimentos de clientes**
Após marcar uma remoção como "publicável", o texto vira depoimento exibido em `/depoimentos` ou na home. Prova social.

**Status "aceitando novos projetos"**
Badge na home: "📅 Agendando eventos para janeiro/2027" ou "🔴 Agenda fechada até março". Define expectativa de novos clientes.

### UX e tecnologia

**Magic Link (login sem senha)**
Substituir senha do dashboard por "digite seu e-mail" → link mágico chega no Gmail. Menos atrito, mais seguro, já temos Resend configurado. Compatível com a feature de recuperação de senha planejada.

**Modo claro/escuro automático**
Detectar preferência do sistema (`prefers-color-scheme`) e adaptar a galeria. Hoje só tem o escuro — algumas pessoas preferem claro pra ver as fotos com fundo neutro.

**Internacionalização (EN/PT)**
Suporte a inglês na galeria e páginas de evento — bom para clientes estrangeiros ou para quando quiser internacionalizar o trabalho.

**Acesso por link único nominado**
Cada convidado de um evento recebe um link tipo `/casamento-ana-joao?guest=marina`. A página mostra "Olá, Marina!" no topo. Toque pessoal sem precisar de login. Útil para entregas exclusivas.

**Compressão e CDN para as fotos de capa**
Hoje as capas carregam direto do Google. Cachear elas via Cloudflare (com headers `Cache-Control`) acelera o load das páginas subsequentes.

### Para o futuro distante

**Integração com Google Drive API**
Em vez de copiar URL por foto, listar e selecionar direto da pasta do Drive. Reduz fricção pra adicionar evento. Requer OAuth — complexo mas elimina o trabalho manual.

**Download em ZIP via Worker**
Endpoint que baixa todas as fotos do Drive e devolve um ZIP. Visitante não precisa entender o Drive. Pesado em CPU/bandwidth — só vale se Drive ficar problemático para visitantes.

**App nativo via React Native ou Capacitor**
Se a operação crescer, app nativo com câmera direta, upload em massa, notificações push. Hoje PWA resolve, mas se virar negócio sério um app dedicado faz sentido.
