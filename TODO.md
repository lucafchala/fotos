# Pendências e Recomendações — fotos.lucafchala.com

## Lembrar

- [ ] Adicionar link para fotos.lucafchala.com na bio do Instagram (@lucafchala)
- [ ] Adicionar na homepage pessoal (lucafchala.com)

## Corrigir depois

### Métricas
- Investigar por que a aba Métricas não exibe contagens esperadas
- Verificar se o `views:{slug}` está sendo incrementado no KV ao acessar páginas de evento
- Possível causa: evento criado antes do rastreamento existir → contagem começa do zero

### E-mail (Resend)
- Verificar domínio `lucafchala.com` no painel do Resend: **Domains → Add Domain → adicionar registros DNS no Cloudflare**
- Sem isso, `noreply@lucafchala.com` rejeita envios com erro 403
- Depois de verificar, testar: enviar uma solicitação de remoção e confirmar que aparece no Resend

### Formulário de avaliações
- Adicionar página/modal para visitantes deixarem avaliação do evento (estrelas + texto)
- Mostrar avaliações no dashboard
- Opcional: exibir média de estrelas no card da galeria ou na página do evento

---

## Recomendações (Claude)

### Alta prioridade

**Backup do KV**
O banco de dados inteiro (eventos, sessões, solicitações) está no Cloudflare KV sem backup automático. Um script de export periódico (`wrangler kv key list` + `get`) ou um endpoint `/api/export` protegido por senha salva muito problema se algo for apagado por acidente.

**Rate limiting nas solicitações de remoção**
O endpoint `/api/removal-request` é público e sem limite. Alguém mal-intencionado pode enviar centenas de pedidos. Solução simples: salvar contagem por IP no KV com TTL de 1 hora e recusar após N tentativas.

**Recuperação de senha**
Se esquecer a senha do dashboard, não tem como recuperar sem acesso ao Cloudflare KV diretamente. Solução: botão "Esqueci a senha" que envia link de reset por e-mail via Resend (usando o próprio RESEND_API_KEY já configurado).

### Melhorias de experiência

**Botão de compartilhamento por WhatsApp**
Nas páginas de evento, um botão "Compartilhar no WhatsApp" com o link direto da página aumenta muito o alcance. Uma linha de HTML resolve.

**Contador de acessos ao Drive**
Atualmente só conta visualizações da página. Contar também cliques em "Ir para o Google Drive" dá uma ideia melhor de quantas pessoas realmente baixaram as fotos. Basta uma chamada `fetch('/api/track-drive?slug=...')` no `onclick` do botão.

**Pré-visualização no WhatsApp/iMessage (OG tags)**
As meta tags `og:image` já existem, mas o Google Drive (`lh3.googleusercontent.com`) bloqueia crawlers de redes sociais. Para o preview funcionar no WhatsApp, a imagem de capa precisaria estar em um domínio próprio ou num storage público (Cloudflare R2, por exemplo).

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
