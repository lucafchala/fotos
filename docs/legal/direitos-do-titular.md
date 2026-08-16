# Procedimento de atendimento aos direitos do titular

**Art. 18 da LGPD.**

> ⚠️ Redigido com auxílio de IA. Não é parecer jurídico. Ver [`README.md`](./README.md).

## Canais

| Canal | Para quê |
| --- | --- |
| Botão **"Solicitar remoção de foto"** no rodapé de cada evento | Caminho principal para remoção de imagem. Sem cadastro, sem login |
| privacidade@lucafchala.com | Qualquer direito do art. 18 |
| suporte@lucafchala.com · `/suporte` | Dúvidas gerais |
| WhatsApp +55 11 98921-1178 | Contato direto |

Todos gratuitos (art. 18, §5º). Nenhum exige criar conta.

## Prazos

| Tipo | Prazo | Origem |
| --- | --- | --- |
| Confirmação de existência / acesso, **formato simplificado** | **15 dias** | Art. 19, I — prazo legal |
| Declaração completa | **15 dias** | Art. 19, II |
| Prometido publicamente no site | **15 dias úteis** | `/privacidade` |
| **Pedido envolvendo menor de idade** | **Prioridade** — tratar em 48 h | Compromisso próprio |

⚠️ O site promete "15 dias **úteis**"; a lei fala em "15 dias" (corridos, na
leitura predominante). ⚠️ **DECISÃO JURÍDICA:** alinhar. O caminho seguro é
alterar o texto público para "15 dias", que é mais restritivo e portanto sempre
cumpre a lei.

---

## Os direitos, e o que cada um significa aqui

| Art. 18 | Direito | Como atender |
| --- | --- | --- |
| I | Confirmação da existência de tratamento | Responder se há foto ou registro do titular |
| II | Acesso aos dados | Exportar o registro de consentimento e o pedido de remoção correspondentes; indicar em quais eventos aparece |
| III | Correção | Corrigir nome no registro de consentimento; corrigir contato no pedido |
| IV | Anonimização, bloqueio ou eliminação de dado desnecessário/excessivo/ilícito | Remover a foto; apagar registros |
| V | Portabilidade | Exportar em CSV. Na prática, raro neste contexto |
| VI | Eliminação de dado tratado com consentimento | Remover a foto e o registro de aceite ⚠️ ver ressalva abaixo |
| VII | Informação sobre compartilhamento | Responder com a lista de operadores ([`ROPA.md`](./ROPA.md)) |
| VIII | Informação sobre a possibilidade de não consentir | Explicar que a recusa impede o acesso ao Drive, mas **não** impede o pedido de remoção |
| IX | **Revogação do consentimento** | Remover a foto e registrar a revogação |
| — (art. 18, §2º) | **Oposição** a tratamento por legítimo interesse | Mesmo fluxo da remoção. É o direito mais usado aqui: vale para quem **nunca** consentiu |

**Ressalva sobre o inciso VI:** o registro de consentimento é a prova de que a
autorização existiu (art. 16, I permite guardá-lo para exercício regular de
direito). Se a foto for removida, o registro perde utilidade e pode ser apagado
junto. Se a foto **permanece** por decisão fundamentada, o registro deve
permanecer — e a decisão precisa ser justificada ao titular.

---

## Fluxo operacional

### 1. Receber e registrar

Pedidos pelo formulário já entram no painel com data, evento e identificação.
Pedidos por e-mail devem ser registrados manualmente, para que o prazo tenha
início rastreável.

### 2. Confirmar identidade (art. 18, §5º)

**Necessário**, e ao mesmo tempo não pode virar obstáculo. O ponto de equilíbrio:

| Situação | O que basta |
| --- | --- |
| Pedido pelo formulário do evento, indicando a foto por número/URL | E-mail + telefone informados. **Suficiente** — quem indica a foto exata demonstra conhecimento do contexto |
| Pedido genérico ("apague todas as minhas fotos") | Pedir que aponte ao menos um evento e uma foto, ou que descreva como identificá-lo |
| Pedido em nome de menor | Confirmar a **condição de responsável legal**. Aceitar declaração escrita; documento formal só se houver dúvida concreta |
| Dúvida sobre a identidade | Pedir um dado adicional que só o titular teria (contexto do evento) |

⚠️ **Nunca** exija documento de identidade como primeiro passo. Coletar RG/CPF
para atender a um pedido de remoção **aumenta** a coleta de dados sensíveis
justamente de quem está pedindo menos exposição — o oposto do que o art. 6º, III
determina. Documento só quando houver dúvida real e proporcional.

### 3. Localizar

```bash
# Registros de consentimento com um nome informado
npx wrangler d1 execute fotos-consent --remote --command \
  "SELECT created_at, event_slug, terms_version, consenter_name
   FROM image_use_consent WHERE consenter_name LIKE '%<nome>%'
   ORDER BY created_at DESC;"
```

Pedidos de remoção: painel → aba **Solicitações**.
Export completo do log: painel → **Exportar consentimentos (CSV)**.

### 4. Executar

- **Remoção de foto:** apagar o arquivo da pasta do Drive. Se for capa do
  projeto, trocar a capa pelo painel.
- **Correção:** editar o registro.
- **Eliminação:** ver a ressalva do inciso VI acima.

### 5. Responder

Marcar como resolvido no painel — isso dispara automaticamente o e-mail de
conclusão ao titular (`sendResolvedEmail`) e inicia a contagem dos 180 dias de
retenção do pedido.

Para pedidos por e-mail, responder manualmente informando: o que foi feito, o
que **não** foi feito e por quê, e o direito de reclamar à ANPD.

### 6. Recusa

Um pedido pode ser recusado (por exemplo, eliminação de registro que o art. 16,
I autoriza guardar). Nesse caso, a resposta **deve**:

1. Ser fundamentada, citando o dispositivo.
2. Informar o direito de peticionar à ANPD (art. 18, §1º) —
   <https://www.gov.br/anpd/>.
3. Ser registrada.

Recusa sem fundamentação escrita é o pior desfecho possível: não protege o
controlador e ainda gera a reclamação que teria sido evitada.

---

## Modelo de resposta

> **Assunto:** Sua solicitação — fotos.lucafchala.com
>
> Olá, [nome],
>
> Recebi sua solicitação em [data] e ela foi **atendida**.
>
> **O que foi feito:** [descrição]
>
> **O que foi mantido, e por quê:** [se aplicável — por exemplo: o registro do
> aceite dos Termos foi mantido porque a lei permite guardá-lo como comprovação
> (art. 16, I da LGPD). Ele não contém a foto, apenas a data e o texto aceito.]
>
> Se algo não ficou claro ou você discorda do que foi mantido, é só responder
> este e-mail. Você também pode apresentar reclamação à Autoridade Nacional de
> Proteção de Dados (ANPD): https://www.gov.br/anpd/
>
> Luca F. Chala — privacidade@lucafchala.com

---

## Registro

Todo pedido fica registrado — em KV, se veio pelo formulário; no arquivo abaixo,
se veio por e-mail ou WhatsApp:

`docs/legal/pedidos/AAAA-MM-DD-<identificador>.md`

```markdown
- Recebido em:
- Canal:
- Direito exercido (art. 18, inciso):
- Identidade confirmada por:
- Ação tomada:
- Respondido em:
- Prazo cumprido: sim/não
```

O registro é o que demonstra, numa fiscalização, que os prazos vêm sendo
cumpridos. Sem ele, o cumprimento é uma afirmação sem lastro.
