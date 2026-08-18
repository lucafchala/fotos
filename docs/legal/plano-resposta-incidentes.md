# Plano de resposta a incidentes de segurança

**Art. 48 da LGPD** e **Resolução CD/ANPD nº 15/2024**, que regulamenta a
comunicação de incidente de segurança.

---

## Antes de qualquer coisa: os dois números

| | |
| --- | --- |
| **Prazo para comunicar a ANPD** | **3 dias úteis** contados do conhecimento do incidente que possa acarretar risco ou dano relevante |
| **Prazo para comunicar os titulares** | O mesmo, quando houver risco ou dano relevante |

Comunicação incompleta é aceitável e pode ser complementada. **Comunicação
atrasada não tem conserto.** Na dúvida entre comunicar e não comunicar, comunique.

**Canal da ANPD:** peticionamento eletrônico via gov.br —
<https://www.gov.br/anpd/> → "Comunicar incidente de segurança".

---

## Fase 0 — Detecção

O incidente chega por um destes caminhos:

| Origem | Como aparece |
| --- | --- |
| Alerta automático de erro | E-mail de `sendErrorAlert()` (`ADMIN_EMAIL`), disparado por qualquer exceção não tratada |
| Alerta de login | E-mail após 5 tentativas falhas em 15 min |
| Relatório de CSP | `csp-violation` nos logs do Worker — possível tentativa de XSS |
| Denúncia externa | `security@lucafchala.com` (RFC 9116, `/.well-known/security.txt`) |
| Titular | `/suporte`, `privacidade@lucafchala.com` ou WhatsApp |
| Monitoramento | `status.lucafchala.com`, `/api/healthz` |
| Fornecedor | Aviso de incidente da Cloudflare, do Google ou do Resend |

**Ao detectar, anote imediatamente** (o relógio da ANPD começa aqui):
data e hora do conhecimento, quem detectou, por qual canal, o que foi observado.

---

## Fase 1 — Contenção (primeiras horas)

Prioridade: **parar o sangramento**, sem destruir evidência.

### Se houver suspeita de acesso indevido ao painel

```bash
# 1. Trocar a senha — a troca já revoga todas as outras sessões
#    (varredura em handleChangePassword). Fazer pelo painel.

# 2. Se não for possível entrar, trocar o secret e derrubar as sessões:
npx wrangler secret put ADMIN_PASSWORD
npx wrangler kv key delete --binding=FOTOS "admin_password"      # força reseed pelo secret
npx wrangler kv key list --binding=FOTOS --prefix "admin_session:"
# apagar cada uma:
npx wrangler kv key delete --binding=FOTOS "admin_session:<token>"
```

### Se houver suspeita de vazamento dos links do Drive

1. Trocar as permissões de compartilhamento das pastas afetadas no Google Drive.
2. Gerar novos links e atualizar os projetos pelo painel.
3. Rotacionar o segredo de assinatura (invalida todos os nonces de página em voo):
   ```bash
   npx wrangler secret put SIGNING_SECRET
   ```

### Se houver suspeita de comprometimento do código / da conta

1. Revogar o `CLOUDFLARE_API_TOKEN` no painel da Cloudflare.
2. Revisar os deploys recentes: `git log --oneline -20` e o histórico do Workers.
3. Reverter para o último commit íntegro (procedimento no README).
4. Rotacionar **todos** os secrets: `ADMIN_PASSWORD`, `SIGNING_SECRET`,
   `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`.

### Sempre

- **Não apague logs.** São a evidência de escopo e a base do relatório.
- Registre cada ação com data e hora.
- Baixe um backup antes de qualquer alteração destrutiva:
  `GET /api/backup` (autenticado).

---

## Fase 2 — Avaliação

Preencher **antes** de decidir sobre a comunicação:

| Pergunta | Resposta |
| --- | --- |
| Quando começou? Quando foi descoberto? | |
| Qual foi o vetor? | |
| **Quais categorias de dados** foram afetadas? | |
| Havia dado de **criança ou adolescente**? | |
| Quantos titulares, aproximadamente? | |
| Os dados estavam cifrados/pseudonimizados? | |
| Houve acesso confirmado ou só exposição possível? | |
| Já foi contido? Desde quando? | |

### Qual é o pior caso, por categoria

Referência para dimensionar o risco (detalhe em [`ROPA.md`](./ROPA.md)):

| Categoria | Onde vive | Gravidade se vazar |
| --- | --- | --- |
| **Fotos dos eventos** | Google Drive | **Alta** — imagem de pessoas identificáveis, inclusive menores |
| **Log de consentimento** | D1 | **Alta** — IP, cidade, provedor, UA, nome opcional, por pessoa |
| **Pedidos de remoção** | KV | **Alta** — e-mail e telefone de titulares que pediram remoção |
| Contadores de acesso | KV | Baixa — agregado, sem titular |
| Telemetria de desempenho | Logs | Baixa — sem identificador |
| Sessão administrativa | KV | Alta — mas afeta só o controlador |

### Critério de comunicação

Comunique ANPD **e** titulares quando houver **risco ou dano relevante**. Neste
sistema, presuma que **há** relevância se:

- houve exposição do **log de consentimento** (IP + localização + nome, por pessoa); **ou**
- houve exposição dos **pedidos de remoção** (e-mail + telefone + evento); **ou**
- houve exposição de **fotos de projetos `private`/`family`**; **ou**
- **há dado de menor envolvido** — neste caso, comunique **sempre**.

Um vazamento apenas de contadores ou de telemetria, sem dado pessoal, é
registrado internamente e **não** comunicado.

⚠️ Na dúvida, comunique. O custo de comunicar sem necessidade é baixo; o de não
comunicar quando devido é sanção administrativa.

---

## Fase 3 — Comunicação

### 3.1 À ANPD (3 dias úteis)

Deve conter, no mínimo:

1. Descrição da natureza e da categoria dos dados afetados.
2. Número aproximado de titulares.
3. Dados de contato do encarregado: `privacidade@lucafchala.com`.
4. Riscos e possíveis consequências.
5. Medidas adotadas ou propostas para reverter/mitigar.
6. Data do incidente e data do conhecimento.
7. Motivo do atraso, se a comunicação passou dos 3 dias úteis.

### 3.2 Aos titulares — modelo

> **Assunto:** Comunicado importante sobre seus dados — fotos.lucafchala.com
>
> Olá,
>
> Escrevo para informar, de forma transparente, sobre um incidente de segurança
> que pode ter afetado dados pessoais tratados no site fotos.lucafchala.com.
>
> **O que aconteceu:** [descrição objetiva, sem jargão]
>
> **Quando:** o incidente ocorreu em [data] e foi identificado em [data].
>
> **Quais dados podem ter sido afetados:** [lista específica]
>
> **O que já foi feito:** [medidas de contenção]
>
> **O que isso pode significar para você:** [riscos concretos e o que fazer —
> por exemplo, desconfiar de contato que cite o evento]
>
> **O que você pode fazer:** solicitar a remoção de qualquer foto sua a qualquer
> momento, gratuitamente, pelo botão no rodapé da página do evento ou
> escrevendo para privacidade@lucafchala.com.
>
> Lamento sinceramente o ocorrido e permaneço à disposição.
>
> Luca F. Chala — privacidade@lucafchala.com

### 3.3 Ao operador afetado

Se a origem for Cloudflare, Google ou Resend, abrir chamado formal e **guardar o
número do protocolo** — ele é parte da evidência de diligência.

---

## Fase 4 — Registro

Todo incidente é registrado, **inclusive os que não exigiram comunicação**. O
registro é o que demonstra diligência numa eventual fiscalização.

Crie `docs/legal/incidentes/AAAA-MM-DD-descricao.md` com:

```markdown
# Incidente AAAA-MM-DD — <título curto>

- Detectado em: <data/hora> por <canal>
- Contido em: <data/hora>
- Categorias afetadas: <...>
- Titulares afetados: <número aproximado>
- Havia dado de menor: sim/não
- Comunicado à ANPD: sim (protocolo <n>) / não (justificativa)
- Comunicado aos titulares: sim (<data>) / não (justificativa)

## Linha do tempo
## Causa raiz
## Correções aplicadas
## Lição aprendida  ← e o que mudou no código ou no processo por causa dela
```

Uma lição aprendida que não vira mudança de código ou de processo não é lição —
é anotação.

---

## Contatos

| Papel | Contato |
| --- | --- |
| Controlador / encarregado | privacidade@lucafchala.com |
| Reporte de vulnerabilidade | security@lucafchala.com (PGP em `/.well-known/security.txt`) |
| Suporte a titulares | suporte@lucafchala.com · WhatsApp +55 11 98921-1178 |
| ANPD | <https://www.gov.br/anpd/> |
| Cloudflare | painel da conta → Support |
| Google | <https://support.google.com/drive> |
| Resend | <https://resend.com/support> |

## Ensaio

Um plano nunca testado falha exatamente quando é preciso. **Uma vez por ano**,
simule sem executar as ações destrutivas:

1. "O log de consentimento vazou." Encontre em quanto tempo você responde:
   quantos titulares? quais campos? há menor envolvido?
2. Localize onde estão os secrets e confirme que sabe rotacioná-los.
3. Confirme que os alertas chegam: force um erro em ambiente de preview e veja
   se o e-mail cai na caixa de entrada. Um alerta que não chega é pior que
   nenhum alerta, porque cria uma falsa sensação de cobertura.
