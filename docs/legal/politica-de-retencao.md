# Política de retenção e eliminação

**Art. 15, 16 e 6º, III (necessidade) da LGPD.**

## Princípio

Dado pessoal é guardado **enquanto e somente enquanto** for necessário à
finalidade que justificou a coleta. Terminada a finalidade, a eliminação é
obrigatória (art. 15), salvo hipótese do art. 16 — e cada exceção invocada aqui
está nomeada.

Prazo que depende de alguém lembrar de apagar **não é política, é intenção**.
Todos os prazos abaixo são executados por código, sem intervenção humana.

---

## Tabela de retenção

| Categoria | Prazo | Contado a partir de | Mecanismo | Fundamento |
| --- | --- | --- | --- | --- |
| **Log de consentimento** (D1) | **1825 dias (~5 anos)** | `created_at` | `pruneOldConsent()`, cron diário 03:00 UTC | Art. 16, I — exercício regular de direito. Prazo alinhado à prescrição da reparação civil (CC art. 206, §3º, V) |
| **Pedidos de remoção resolvidos** (KV, um registro por pedido) | **180 dias** | `resolvedAt` | `pruneResolvedRemovalRequests()` → `podaResolvidos()` (`src/pedidos.js`), cron diário; parada do cron é acusada pelo `/api/healthz` em até 26 h | Art. 16, I — comprovar o atendimento ao direito exercido |
| **Pedidos de remoção não resolvidos** | Indefinido | — | Nenhum. **Nunca apagados automaticamente** | A finalidade não terminou: o pedido está pendente |
| **Mensagens de suporte** | **Não armazenadas** | — | Nunca gravadas em KV nem D1 | Minimização (art. 6º, III) |
| **Hash de deduplicação de suporte** | 1 hora | Envio | TTL do KV | Não é dado pessoal (hash truncado irreversível) |
| **Sessão administrativa** | **24 h absolutas / 2 h de inatividade** | Login / último uso | TTL do KV + verificação em `verifySession()` | Segurança |
| **Contadores de rate limit** (janela fixa) | Duas janelas: 20 min a 48 h (janelas de 10 min a 24 h) | Início da janela | Alarme do Durable Object `RateLimiter`, que apaga o registro | Segurança |
| **Baldes de fichas** (portão do Drive, código por e-mail) | Até o balde encher de novo — minutos a poucas horas | Último uso | Alarme do `RateLimiter`, que se reagenda até o balde encher e então apaga | Segurança |
| **E-mail do código de acesso** | **Não armazenado** — só o hash SHA-256, até 2 h, como nome do objeto de limite por endereço | Pedido do código | Alarme do `RateLimiter` | Minimização (art. 6º, III) |
| **Contador de falhas de login** | 30 min (duas janelas de 15 min) | Início da janela | Alarme do Durable Object `RateLimiter`, que apaga o registro | Segurança |
| **Contadores de acesso** (`views`, `drive_clicks`) | Indefinido | — | Apagados junto com o projeto | Não é dado pessoal (agregado) |
| **Série por dia dos contadores** (`d:<dia>:…`, v2.0) — inclui a contagem por modo do portão (`gate:*`) | **400 dias** | O dia do balde | Poda no primeiro incremento de cada dia (`Counter`, `src/counters.js`); apagada também junto com o projeto | Não é dado pessoal (agregado por dia). O prazo existe para o armazenamento não crescer para sempre |
| **Ambiente de prévia** (KV e D1 de teste, v2.0) | **Sem prazo automático** — limpeza manual | — | `npx wrangler preview delete` (a prévia); KV e D1 de prévia pelo painel da Cloudflare | Dados de teste do próprio controlador; pedidos de remoção nunca entram (ROPA §10). Exceção registrada: o cron não alcança prévias |
| **Cookie de contagem de visualização** (`fv_*`) | 1 hora | Visita | `Max-Age` no browser | Não identifica |
| **Telemetria de desempenho** | Retenção do Cloudflare Logs | Envio | Fora do nosso controle | Não é dado pessoal |
| **Fotografias dos eventos** (Drive) | **Sem prazo automático** | — | Remoção manual, a pedido ou por decisão do controlador | Ver observação abaixo |

---

## As fotografias — a exceção honesta

As fotos **não têm prazo automático de eliminação**, e isso é uma decisão, não
um esquecimento.

- A finalidade (entrega, portfólio) é **continuada**, não pontual: um portfólio
  existe justamente para permanecer disponível.
- Elas são o produto do trabalho contratado, e o contratante espera acesso
  duradouro.
- Um prazo automático apagaria o acervo de um cliente sem que ele pedisse.

**Em contrapartida**, a remoção individual é imediata, gratuita e sem burocracia:
botão no rodapé de cada evento, sem cadastro e sem login.

A retenção por finalidade continuada, somada ao direito de oposição
facilitado, é o modelo adotado — em vez de um prazo máximo fixo, que apagaria
o acervo de um cliente sem que ele pedisse.

---

## Como verificar que a eliminação realmente acontece

O modo de falha de um cron é o pior possível: ele para de rodar e **não emite
erro nenhum**. Sem batimento, a descoberta viria meses depois, quando alguém
notasse que nada mais está sendo apagado. Por isso:

1. **Batimento cardíaco.** Cada execução grava `cron:last` em KV.
2. **Detecção de morte silenciosa.** `/api/healthz` expõe `cron.stale`, que fica
   `true` se o último batimento passou de 26 h (uma execução diária + 2 h de
   folga de propagação).
3. **Alerta ativo.** Se qualquer uma das duas rotinas de poda lançar exceção, o
   controlador recebe e-mail (`sendErrorAlert`) — antes, a falha só existia nos
   logs do Cloudflare.

### Verificação manual

```bash
# O cron rodou nas últimas 24 h?
curl -s https://fotos.lucafchala.com/api/healthz | grep -o '"cron":{[^}]*}'

# Ainda há registro de consentimento fora do prazo?
npx wrangler d1 execute fotos-consent --remote --command \
  "SELECT COUNT(*) AS fora_do_prazo FROM image_use_consent
   WHERE created_at < datetime('now', '-1825 days');"
# Esperado: 0
```

Vale rodar essa verificação junto com a revisão anual deste documento.

---

## Eliminação a pedido do titular

Independe dos prazos acima. Procedimento em
[`direitos-do-titular.md`](./direitos-do-titular.md).

| Pedido | O que é apagado |
| --- | --- |
| Remoção de foto | O arquivo sai da pasta do Drive. O pedido em si é mantido 180 dias após a resolução, como prova do atendimento (art. 16, I) |
| Eliminação do registro de consentimento | ⚠️ Avaliar caso a caso: é a prova de que a autorização foi dada. Art. 16, I permite a guarda. Se a foto for removida, o registro perde a utilidade e pode ser apagado |
| Eliminação de dados de contato | Apagados do pedido de remoção após a resolução, no prazo normal |

---

## Onde mexer no código

| Prazo | Constante | Arquivo |
| --- | --- | --- |
| Log de consentimento | `CONSENT_RETENTION_DAYS` | `src/index.js` |
| Pedidos de remoção | `REMOVAL_RETENTION_DAYS` | `src/index.js` |
| Sessão (absoluta) | `SESSION_TTL_SECS` | `src/utils.js` |
| Sessão (inatividade) | `SESSION_IDLE_SECS` | `src/utils.js` |
| Nonce de página do Drive | `DRIVE_NONCE_TTL_SECS` | `src/index.js` |
| Token de formulário | `FORM_TOKEN_TTL_SECS` | `src/index.js` |

Ao alterar qualquer um deles, **atualize a tabela acima e a política pública**
(`src/ui/privacy.js`, item 5). Um prazo publicado que não corresponde ao código
é uma declaração falsa ao titular — e é o tipo de divergência que passa
despercebida por anos.
