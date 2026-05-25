# Pendências e Recomendações — fotos.lucafchala.com

## Lembrar

- [ ] Adicionar link para fotos.lucafchala.com na bio do Instagram (@lucafchala)
- [ ] Adicionar na homepage pessoal (lucafchala.com)

## Corrigir depois

### ~~Métricas~~ ✅ Resolvido
- Bug corrigido: `ctx.waitUntil()` garante que o view count seja salvo após o Worker retornar
- Dashboard agora também exibe coluna "Abriu Drive" (cliques no botão do Google Drive)

### ~~E-mail (Resend)~~ ✅ Resolvido
- `RESEND_API_KEY` configurada como secret no Cloudflare Worker (Settings → Variables)
- Domínio `lucafchala.com` verificado no Resend
- E-mails de notificação ao admin e confirmação ao solicitante funcionando

### Formulário de avaliações
- Adicionar modal para visitantes deixarem avaliação do evento (estrelas + texto)
- Mostrar avaliações no dashboard
- Opcional: exibir média de estrelas no card da galeria ou na página do evento

---

## Próximas etapas (do plano)

### Etapa 3 — Segurança
- [ ] **Rate limiting** em `/api/removal-request` (máx. N por IP por hora)
- [ ] **Backup do KV**: endpoint `/api/backup` protegido (admin) exporta todos os dados como JSON
- [ ] **Recuperação de senha** via e-mail (link de reset via Resend)

### Etapa 4 — Novos recursos
- [ ] Formulário de avaliações (estrelas + texto)
- [ ] Senha por evento (acesso privado)
- [ ] Modo "em breve" (card desfocado + data de publicação)
- [ ] Ordenação manual dos eventos no dashboard

---

## Recomendações (Claude)

### ~~Alta prioridade~~ → parcialmente concluído

~~**Backup do KV**~~ → na Etapa 3

~~**Rate limiting nas solicitações de remoção**~~ → na Etapa 3

~~**Recuperação de senha**~~ → na Etapa 3

### Melhorias de experiência

~~**Botão de compartilhamento por WhatsApp**~~ ✅ Implementado

~~**Contador de acessos ao Drive**~~ ✅ Implementado (coluna "Abriu Drive" nas métricas)

**Aviso de LGPD** ✅ Implementado (rodapé do modal de remoção)

**Ordenação manual dos eventos**
Hoje a galeria ordena por data. Adicionar drag-and-drop no dashboard para definir ordem manual seria útil quando dois eventos têm a mesma data ou você quer destacar um evento mais antigo.

**Senha de acesso por evento**
Alguns projetos podem ser privados (família, corporativo). Adicionar a opção de proteger um evento com senha — visitante digita antes de ver as fotos e o link do Drive. Simples de implementar com um campo extra no formulário e uma verificação na rota `/:slug`.

**Página "em breve" para eventos não publicados**
Hoje eventos invisíveis simplesmente somem. Seria útil ter um modo "em breve" — o card aparece na galeria mas desfocado/bloqueado, com uma data de publicação. Cria expectativa antes do evento ser entregue.

**Notificação por WhatsApp ao receber solicitação de remoção**
Além do e-mail, enviar uma mensagem no WhatsApp via API (Twilio, Z-API ou Evolution API) garante que você vê o pedido mesmo sem abrir o e-mail. Mais imediato para algo sensível como remoção.

**Tour guiado no primeiro acesso à página de evento**
Um tooltip ou mini-modal na primeira visita explicando "deslize as fotos", "clique para baixar" etc. reduz dúvidas sem poluir a interface permanentemente. Implementável com localStorage para não repetir.

**Galeria com filtro por tag/categoria**
Adicionar tags aos eventos (ex: "formatura", "aniversário", "corporativo") e um filtro na galeria. Útil quando o portfólio crescer e o visitante quiser ver só um tipo de trabalho.

**Lazy loading com skeleton nos cards**
Os cards da galeria já têm `loading="lazy"` nas imagens, mas enquanto carregam aparece fundo escuro sem indicação de progresso. Adicionar um skeleton animado (brilho suave) melhora a percepção de velocidade.

**Âncora de download direto no modal**
No modal "Antes de acessar", o botão "Ir para o Google Drive" abre a pasta. Adicionar um segundo botão menor "Baixar todas as fotos" com o link direto de download ZIP (parâmetro `?authuser=0&sz=w2048` no Drive) agiliza para quem sabe o que quer.

### Conformidade

**Aviso de LGPD**
O formulário de remoção coleta e-mail e telefone. Um parágrafo curto de política de privacidade ("seus dados são usados apenas para responder ao pedido e não são compartilhados") é suficiente para conformidade básica — pode ficar no rodapé do modal.

**Prazo de resposta para solicitações de remoção**
A LGPD exige resposta em até 15 dias. Adicionar no formulário um texto tipo "Respondemos em até 15 dias úteis" define expectativa e demonstra conformidade.

### A longo prazo

**Migrar imagens para Cloudflare R2**
Hoje as miniaturas dependem de `lh3.googleusercontent.com` (Google), que pode bloquear ou mudar sem aviso. Subir as capas para um bucket R2 dá controle total e resolve o problema de preview no WhatsApp.

**Domínio de e-mail dedicado**
`noreply@lucafchala.com` funciona mas parece automático. Um endereço como `fotos@lucafchala.com` para respostas manuais e `noreply@fotos.lucafchala.com` para transacionais passa mais profissionalismo.

**Portfólio público com seleção de fotos favoritas**
Hoje o site é focado em entrega para clientes. Poderia ter uma seção separada (ex: `/portfolio`) com uma curadoria das melhores fotos de cada projeto, voltada para atrair novos clientes — sem o link do Drive, só as fotos.

**Analytics mais detalhado**
Substituir ou complementar o contador de views com Cloudflare Web Analytics (gratuito, sem cookies, compatível com LGPD) para ver de onde vêm os visitantes, quais eventos mais acessados, tempo na página e dispositivos usados.

**App de dashboard no celular (PWA)**
Adicionar um `manifest.json` e um service worker básico torna o dashboard instalável como app no celular (sem precisar da App Store). Útil para ver notificações de remoção e adicionar eventos direto pelo iPhone/Android.
