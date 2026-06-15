# Pendências e Recomendações — fotos.lucafchala.com

## Lembrar

- [ ] Adicionar link para fotos.lucafchala.com na bio do Instagram (@lucafchala)
- [ ] Adicionar na homepage pessoal (lucafchala.com)

---

## ✅ Concluído

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
- [ ] **Rate limiting** em `/api/removal-request` (máx. N por IP por hora)
- [ ] **Backup do KV**: endpoint `/api/backup` protegido (admin) exporta todos os dados como JSON
- [ ] **Recuperação de senha** via e-mail (link de reset via Resend)

### Etapa 4 — Recursos
- [ ] Formulário de avaliações (estrelas + texto, mostradas no dashboard)
- [ ] Senha por evento (acesso privado)

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
Após marcar uma remoção/avaliação como "publicável", o texto vira depoimento exibido em `/depoimentos` ou na home. Prova social.

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
