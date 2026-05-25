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

### Conformidade

**Aviso de LGPD**
O formulário de remoção coleta e-mail e telefone. Um parágrafo curto de política de privacidade ("seus dados são usados apenas para responder ao pedido e não são compartilhados") é suficiente para conformidade básica — pode ficar no rodapé do modal.

### A longo prazo

**Migrar imagens para Cloudflare R2**
Hoje as miniaturas dependem de `lh3.googleusercontent.com` (Google), que pode bloquear ou mudar sem aviso. Subir as capas para um bucket R2 dá controle total e resolve o problema de preview no WhatsApp.

**Domínio de e-mail dedicado**
`noreply@lucafchala.com` funciona mas parece automático. Um endereço como `fotos@lucafchala.com` para respostas manuais e `noreply@fotos.lucafchala.com` para transacionais passa mais profissionalismo.
