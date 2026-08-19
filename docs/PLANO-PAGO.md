# Migrar para o Workers Paid

Este arquivo tem dois públicos: **você**, para comprar; e **qualquer sessão
futura**, para terminar o serviço depois de comprado, sem precisar do histórico
da conversa em que isto foi decidido.

Enquanto o pagamento não acontecer, **nada aqui deve ser aplicado**: o código no
`main` está correto para o plano gratuito e continua correto.

---

## 1. Antes de comprar: não existe "comprar o KV"

O KV não tem assinatura própria. Os limites maiores dele vêm junto com o
**Workers Paid**, que é o plano do Workers inteiro — US$ 5/mês, e o KV entra
como parte dele. Não dá para pagar só o KV e ficar no Workers gratuito.

Isso é a favor: os três limites que apertam aqui (escrita em KV, CPU por
requisição, requisições por dia) sobem de uma vez, com um pagamento só.

**Nada mais precisa ser comprado.** Não é preciso plano Pro do domínio,
Cloudflare Images, Stream, nem mexer no registro do domínio. O raciocínio de
cada um está no `TODO.md`, em "Decidido não fazer".

---

## 2. Como comprar

1. Entre no [dash.cloudflare.com](https://dash.cloudflare.com) com a conta que
   já hospeda o Worker (a mesma do `account_id` no `wrangler.toml`).
2. Menu lateral: **Compute (Workers)** → **Plans** (ou **Workers & Pages** →
   **Plans**, dependendo da versão do painel).
3. Escolha **Workers Paid**, US$ 5/mês, e conclua com um cartão.
4. Confirme que valeu: a página de **Plans** passa a mostrar Workers Paid como
   plano ativo da conta, não do Worker — o plano é **da conta inteira**, então o
   `status.lucafchala.com` (Pages) entra junto sem configuração extra.

**Não é preciso alterar `wrangler.toml`, refazer deploy, nem mexer em binding.**
O plano é uma propriedade da conta; o Worker publicado continua o mesmo.

### Um risco novo que aparece junto

No gratuito, estourar a cota faz as coisas **pararem**. No pago, elas
**continuam e cobram**. É a mesma mudança que torna o site robusto e que tira a
rede de proteção do custo.

Portanto, logo depois de assinar:

- Painel → **Manage Account** → **Billing** → **Notifications**: crie um alerta
  de uso/gasto. Um valor baixo (US$ 10, por exemplo) já serve — o objetivo é
  descobrir um laço maluco pelo e-mail, não pela fatura.
- O `/api/healthz` continua sendo o primeiro lugar a olhar, mas ele mede
  **falha**, não **gasto**. Com o pago, a falha some e o gasto aparece; são
  sinais diferentes e o segundo só existe no painel de billing.

---

## 3. O que muda, em números

| | Gratuito (hoje) | Workers Paid |
| --- | --- | --- |
| Escrita em KV, chaves distintas | **1000/dia**, conta inteira | sem limite diário; 1 milhão/mês incluso, depois US$ 5/milhão |
| Leitura em KV | 100 mil/dia | 10 milhões/mês inclusos, depois US$ 0,50/milhão |
| Armazenamento em KV | 1 GB | 1 GB incluso, depois US$ 0,50/GB-mês |
| Requisições do Worker | 100 mil/dia | 10 milhões/mês inclusas |
| CPU por requisição | 10 ms | até 5 min (30 milhões de ms-CPU inclusos) |
| **Escrita na MESMA chave** | **1/segundo** | **1/segundo — NÃO muda** |

A última linha é a que decide a maior parte da seção 4. Leia-a de novo.

---

## 4. O que NÃO desfazer (leia antes de mexer em qualquer coisa)

A tentação natural depois de pagar é remover tudo o que foi feito para caber no
gratuito. **A maior parte disso não é gambiarra de cota — é código correto que
continua correto no pago.** Item por item, com o motivo:

### 4.1. A agregação dos contadores FICA — este é o item importante

`bumpCounter()` / `flushCounters()` em `src/utils.js` gravam direto, **exceto**
quando a mesma chave já foi gravada há menos de um segundo — aí o incremento
espera e sai junto com os outros, num lote só.

Parece existir por causa da cota diária. **Não é.** O KV limita a **uma escrita
por segundo na mesma chave**, e esse limite **não sobe no plano pago** —
escritas concorrentes na mesma chave levam 429. O contador de visitas de um
projeto é exatamente isso: uma chave só (`views:<slug>`), com todo o público
daquele projeto batendo nela.

Tirar esse piso faria o pico de um lançamento — que é justamente quando as
visitas importam — bater no teto por chave e perder contagem com erro 429, no
plano pago igual ao gratuito. O piso é o que transforma N visitantes no mesmo
segundo em uma escrita.

A conta, para poder ser conferida em vez de aceita: sem agregação, o contador
grava uma vez por visitante novo (o cookie `fv_<slug>` segura repetição por 1 h).
Passar de **1 visitante novo por segundo no mesmo projeto** já encosta no teto —
e não é o número médio que importa, é a rajada. Um link jogado num grupo grande
de WhatsApp produz dezenas de aberturas no mesmo segundo, todas na mesma chave.
Com o piso, essas dezenas viram uma escrita.

**Não remova o piso por chave nem a drenagem agendada.** Medido: tráfego
espalhado custa 4 escritas por visitante engajado, rajada de 40 simultâneos custa
2,1 — e nos dois casos a contagem sai exata. Essa exatidão é recente e custou
dois defeitos silenciosos (ver RETOMADA §5.3): mexer aqui sem reproduzir os dois
formatos de tráfego no harness é como o projeto perdeu contagem duas vezes.

### 4.2. A sobrevivência a queda de KV FICA

Commit `bfc9b49`: `getEvents()` cai para o cache do isolate e depois para uma
cópia na Cache API quando o KV não responde. Pagar não impede o KV de cair —
compra cota, não disponibilidade. Remover isso devolveria o 500 na galeria, na
página do projeto e no portão do Drive.

### 4.3. O fail-open do `checkRateLimit` FICA

Commit `0bb904f`. A justificativa nunca foi a cota, e sim: uma falha de
contabilidade não pode derrubar a entrega das fotos. Vale para 429 de cota, para
queda de KV e para qualquer erro futuro. O raciocínio completo está no
[`SECURITY.md`](../SECURITY.md#rate-limits-fail-open-when-kv-cannot-record-them).

### 4.4. Validar antes de gastar escrita FICA

`/api/track-drive` confere corpo, formato do slug e existência do evento antes
de qualquer gravação (commits `730ddc1`, `5643a7c`). No pago isso deixa de ser
economia de cota e passa a ser economia de **dinheiro** — e continua sendo o
certo: gastar escrita por POST de lixo nunca fez sentido.

### 4.5. Projeto "em breve" não conta clique FICA

Commit `730ddc1`. É correção de métrica, não de custo: contar clique num link
que ninguém pôde abrir sempre foi errado.

### 4.6. A remoção do `hashMs` FICA

Commit `3d2a338`. O número era zero por construção (o Workers congela
`Date.now()` durante execução síncrona — ver RETOMADA §5.9). Nada a ver com
plano. Não o traga de volta achando que agora vai medir: não vai.

---

## 5. O que mudar depois de pagar — lista para a sessão que for executar

Cada item traz arquivo, o que fazer e como conferir. Faça um por vez, com
`npm test` entre eles.

### 5.1. `status.lucafchala.com` — a tabela de limites (PRIORIDADE)

**Arquivo:** `functions/api/quota-stats.js`, constante `LIMITS`.

Os valores estão fixados nos números do gratuito:

```js
kvWrites:       { limit: 1000,    period: 'dia',  … },
kvReads:        { limit: 100000,  period: 'dia',  … },
workerRequests: { limit: 100000,  period: 'dia',  … },
```

Depois de pagar isso fica **errado e barulhento**: o painel vai acusar 100% de
uso de uma cota que não existe mais e mandar e-mail de alerta por nada. É o
primeiro item porque é o único que produz alarme falso.

Trocar para os números do pago (mensais, não diários — atenção ao campo
`period`, que decide a janela do cálculo em UTC):

```js
kvWrites:       { limit: 1000000,  period: 'mês', … },
kvReads:        { limit: 10000000, period: 'mês', … },
workerRequests: { limit: 10000000, period: 'mês', … },
```

> ⚠️ **`'mês'` não existe hoje — não basta trocar a string.** Verificado: o
> arquivo só sabe calcular uma janela de dia, em `utcDayWindow()`, e `period` é
> apenas um rótulo repassado para a saída (e usado na frase "hoje (zera à
> meia-noite UTC)"). Trocar o rótulo sem implementar a janela faria o painel
> comparar o consumo **de hoje** contra um limite **mensal** — todos os
> percentuais ficariam ~30× baixos demais, e o painel deixaria de avisar
> justamente quando devesse.
>
> O que fazer: acrescentar um `utcMonthWindow()` ao lado do `utcDayWindow()`
> (primeiro dia do mês UTC até agora) e escolher a janela por `def.period` na
> hora de montar as consultas. As queries GraphQL já filtram por
> `datetime_geq/leq` e `date_geq/leq`, então só muda o `since`. Confira a
> retenção da analytics da conta: se ela não cobrir o mês inteiro, o número
> mensal vem truncado e é melhor mostrar a janela real do que fingir o mês.

**Conferir:** abra `status.lucafchala.com`, o bloco de cotas deve mostrar
percentuais baixos e nenhum item vermelho.

### 5.2. `status.lucafchala.com` — cadência da varredura e da amostra

**Arquivos:** `functions/api/latency-trends.js` (`LATENCY_INTERVAL_MS`,
`shouldSample()`) e `.github/workflows/monitor.yml` (cron de 10 min).

Os dois foram afinados para gastar pouca escrita: a amostra de latência sai a
cada 30 min (48/dia em vez de 288) e a varredura roda a cada 10 min. Com o pago,
dá para ter mais resolução:

- `LATENCY_INTERVAL_MS` de 30 min → 5 min (288 amostras/dia). Ajustar
  `LATENCY_MAX` junto, senão a janela de 48 h encolhe.
- cron do monitor de `*/10` → `*/5`.

Opcional, e puramente ganho de qualidade do gráfico. Não é obrigatório.

### 5.3. `fotos` — a mensagem de cota no healthz

**Arquivo:** `src/index.js`, dentro de `auditSite()`.

A mensagem diz "provável cota diária esgotada … até a virada UTC". No pago o
modo de falha muda: escrita recusada passa a ser, quase sempre, o limite de **1
por segundo na mesma chave** (429) ou um problema de conta/faturamento — nunca
mais a cota diária.

Reescrever para algo como: "escrita em KV recusada há Ns — verifique o limite de
1 escrita/s por chave e o faturamento da conta". **Não remova o aviso**: falhar
aberto sem avisar é o defeito que ele existe para não repetir.

**Conferir:** `npx vitest run tests/index.test.js` — há um teste que casa a
mensagem por `/cota diária esgotada/`; ele precisa ser atualizado junto, e é
essa a intenção do teste (a mensagem é contrato com quem lê o painel).

### 5.4. `fotos` — a documentação que assume o gratuito

Nesta ordem, porque uma referencia a outra:

1. **`TODO.md`** — a seção "Plano gratuito — a restrição que decide o resto" e a
   entrada "Pagar por serviço da Cloudflare" em "Decidido não fazer" passam a
   estar erradas. A decisão mudou. Substituir por uma seção curta que diga qual
   plano está ativo, qual o envelope novo, e que aponte para este arquivo como
   histórico.
2. **`RETOMADA.md` §5.3** — "Cota de KV é 1000 escritas/dia" vira o número do
   pago. **Manter o parágrafo sobre o limite por chave**, que não mudou.
3. **`SECURITY.md`** — a seção do fail-open cita "1000 escritas por dia" como
   motivação. Atualizar o número, manter a decisão.
4. **`docs/VERIFICACAO.md`** — a dica "logue aqui para contar escritas" continua
   útil; nenhuma mudança obrigatória.
5. Rodar **`npm run build:legal`** ao final: o `SECURITY.md` é documento
   publicado e a CI reprova se o `src/content/legal-docs.js` ficar dessincronizado.

### 5.5. `fotos` — reavaliar o que ficou represado pela cota

Com o teto fora do caminho, dois itens do `TODO.md` mudam de custo:

- **Beacon de performance** (`/api/perf`): confirmar se o Analytics Engine está
  disponível e criar o binding `PERF` no `wrangler.toml`. O handler já trata os
  dois casos, então é só configuração.
- **Rate limit em Durable Object**: continua sendo a solução mais limpa, mas
  perde a urgência — era para economizar escrita, e escrita deixou de ser
  escassa. Rebaixar a prioridade em vez de apagar.

---

## 6. Como verificar no fim

Na ordem, e sem pular a última:

```bash
npm ci && npm test && npm run lint
npm run build:legal   # e commite se gerar diferença
```

Depois **dirija o site de verdade** — a regra do
[`docs/VERIFICACAO.md`](./VERIFICACAO.md), que existe porque esta base já ficou
com a interface inteira morta e a suíte verde:

1. Suba o harness e abra a galeria, um projeto entregue e um "em breve".
2. Complete o fluxo do portão do Drive até o link aparecer.
3. Confirme `/api/healthz` com `"problems": []`.
4. Abra o `status.lucafchala.com` e confira o bloco de cotas contra os limites
   novos.

E confirme no painel da Cloudflare, uma vez, que o consumo real está sendo
contado contra os limites do pago — é o que fecha o ciclo entre "assinei" e "o
código sabe disso".

---

## 7. Resumo de uma linha

Comprar: **Workers Paid, US$ 5/mês, nada mais.** No código: mexer na tabela de
limites do painel de status, na mensagem de cota do healthz e na documentação —
e **não encostar na agregação dos contadores**, que existe por um limite que o
pagamento não remove.
