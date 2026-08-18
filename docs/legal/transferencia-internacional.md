# Transferência internacional de dados

**Art. 33 a 36 da LGPD.**

## O ponto central

**Todo o tratamento deste site ocorre em infraestrutura estrangeira.** Não há
servidor no Brasil em nenhuma camada: hospedagem, banco, e-mail e armazenamento
das fotos são todos de fornecedores sediados nos Estados Unidos. Isso não é
irregular, mas **exige fundamento** (art. 33) e **transparência** (art. 9º, §1º).

Este documento é o mapeamento e o fundamento de cada uma dessas transferências.

## Marco regulatório aplicável

- **Art. 33** — hipóteses que autorizam a transferência internacional.
- **Resolução CD/ANPD nº 19/2024** — aprova as **cláusulas-padrão contratuais**
  (CPC) e disciplina cláusulas específicas e contratos de transferência.
- Até a publicação deste documento, **a ANPD não reconheceu nenhum país como
  adequado** (art. 33, I). O fundamento aplicável, portanto, é contratual: as
  cláusulas-padrão contratuais previstas na Resolução CD/ANPD nº 19/2024,
  incorporadas pelos DPAs de cada fornecedor listados abaixo.

---

## Mapa das transferências

### 1. Cloudflare — hospedagem, KV, D1, Turnstile, Web Analytics

| | |
| --- | --- |
| **Sede** | Estados Unidos (Cloudflare, Inc.) |
| **Papel** | Operador |
| **Dados** | Todo o tráfego do site; log de consentimento (D1); pedidos de remoção, contadores e sessões (KV); sinais anti-robô (Turnstile); métrica agregada |
| **Localização** | Rede global de borda; KV e D1 replicados internacionalmente |
| **Fundamento (art. 33)** | **III** — cláusulas contratuais específicas no DPA da Cloudflare, que incorpora as cláusulas-padrão da UE e prevê transferência internacional |
| **Salvaguardas** | ISO 27001, ISO 27701, SOC 2 Type II; DPA público com adendo de LGPD |
| **Referência** | <https://www.cloudflare.com/trust-hub/gdpr/> · Turnstile: <https://www.cloudflare.com/turnstile-privacy-policy/> |

Nota sobre o Turnstile: opera em **modo invisível**, verificando sinais do
navegador. Não exibe desafio, não usa cookie de rastreamento publicitário e não
alimenta perfil de anúncios — a Cloudflare declara isso no adendo acima.

### 2. Google — Google Drive (armazenamento das fotografias)

| | |
| --- | --- |
| **Sede** | Estados Unidos (Google LLC) |
| **Papel** | Operador |
| **Dados** | **As fotografias dos eventos** — imagem de pessoas identificáveis, inclusive menores. É a transferência de maior impacto do sistema. |
| **Localização** | Datacenters globais |
| **Fundamento (art. 33)** | **III** — cláusulas contratuais nos Termos do Google Workspace / Google Drive e no Data Processing Addendum |
| **Salvaguardas** | ISO 27001/27017/27018, SOC 2/3; DPA com cláusulas-padrão |
| **Referência** | <https://cloud.google.com/terms/data-processing-addendum> |

### 3. Resend — e-mails transacionais

| | |
| --- | --- |
| **Sede** | Estados Unidos (Resend, Inc.) |
| **Papel** | Operador |
| **Dados** | E-mail, telefone, mensagem e **a foto anexada** nos pedidos de remoção; nome/e-mail/mensagem no suporte; alertas ao controlador |
| **Fundamento (art. 33)** | **III** — DPA do Resend |
| **Salvaguardas** | SOC 2 Type II; DPA disponível |
| **Referência** | <https://resend.com/legal/dpa> |
| **Minimização aplicada** | A mensagem de suporte **não é armazenada** no site. A foto de remoção **não vai para banco** e tem os **metadados EXIF removidos no servidor** antes de virar anexo. Alertas de erro nunca carregam IP, cabeçalhos ou corpo de requisição. |

### 4. Google Fonts — tipografia

| | |
| --- | --- |
| **Sede** | Estados Unidos (Google LLC) |
| **Papel** | Operador (marginal) |
| **Dados** | **O IP do visitante**, transmitido ao buscar o arquivo da fonte. Nada mais. |
| **Fundamento (art. 33)** | **III** |
| **Observação** | Este é o item de menor valor e maior atrito. Tribunais alemães já entenderam (caso LG München, 2022) que embutir Google Fonts sem consentimento viola o GDPR justamente por transmitir o IP. A LGPD não tem decisão equivalente, mas o risco é **eliminável a custo baixo**. |

> ### 💡 Recomendação: hospedar as fontes localmente
>
> Baixar os arquivos WOFF2 do Inter e servi-los da própria origem elimina esta
> transferência por completo. O `font-src` da CSP **já aceita `'self'`**
> (mudança feita no commit `c78e6e4`), então a migração é: baixar os arquivos,
> declarar `@font-face` apontando para eles e remover o `<link>` do
> `fonts.googleapis.com` das oito páginas.
>
> Ganho colateral: uma origem a menos na CSP e uma requisição externa a menos no
> caminho crítico de renderização.

### 5. GitHub — código-fonte

Hospeda **apenas código-fonte**, sem dados pessoais de titulares. Não é operador
para fins da LGPD neste contexto. Os secrets ficam no Cloudflare e nos GitHub
Actions Secrets, nunca no repositório — verificado por um gate de CI
(`.github/workflows/security.yml`).

---

## Quadro-resumo

| Operador | Dados | Impacto se vazar | Fundamento | Eliminável? |
| --- | --- | --- | --- | --- |
| Cloudflare | Tráfego, KV, D1, Turnstile | Alto | Art. 33, III | Não — é a plataforma |
| Google Drive | **As fotografias** | **Alto** | Art. 33, III ⚠️ (confirmar DPA) | Não a curto prazo (ver TODO: R2) |
| Resend | E-mail, telefone, foto anexa | Alto | Art. 33, III | Não — é o canal de e-mail |
| Google Fonts | IP do visitante | Baixo | Art. 33, III | **Sim — recomendado** |

## Transparência ao titular

O art. 9º exige informar o titular sobre a transferência internacional. Cumprido
em `/privacidade`, que nomeia cada operador, o que ele recebe e a localização.
A [atualização da política](../../src/ui/privacy.js) feita nesta revisão
acrescentou a menção expressa à transferência internacional e ao seu fundamento,
que antes estavam implícitos na lista de terceiros.

## Ações recomendadas

1. 🔴 **Confirmar o tipo de conta Google** usada para o Drive. Conta pessoal
   gratuita não tem DPA. Se for o caso, migrar para Workspace.
2. 🟡 **Hospedar as fontes localmente** — elimina uma transferência inteira a
   custo baixo, e a CSP já está preparada.
3. 🟡 **Arquivar cópia dos DPAs** de Cloudflare, Google e Resend, com a data de
   consulta. Numa fiscalização, "o DPA está no site deles" é resposta mais fraca
   que "eis o documento vigente na data em que contratei".
4. 🟢 Reavaliar anualmente, ou quando a ANPD publicar decisão de adequação ou
   alterar a Resolução 19/2024.
