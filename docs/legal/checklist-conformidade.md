# Checklist de conformidade — estado atual

> ⚠️ Redigido com auxílio de IA. Não é parecer jurídico. Ver [`README.md`](./README.md).
>
> **Última revisão:** 2026-08-16

Legenda: ✅ pronto · 🟡 parcial · ❌ pendente · ⚖️ depende de parecer jurídico ·
👤 depende de ação fora do site

---

## Princípios (art. 6º)

| # | Princípio | Estado | Observação |
| --- | --- | --- | --- |
| I | Finalidade | ✅ | Declarada em `/termos`, `/privacidade` e no [ROPA](./ROPA.md) |
| II | Adequação | ✅ | Cada base legal mapeada por finalidade |
| III | Necessidade | ✅ | Suporte não armazenado; foto de remoção fora do banco; EXIF removido; alertas sem PII |
| IV | Livre acesso | ✅ | Canais gratuitos, sem cadastro |
| V | Qualidade | ✅ | Correção pelos canais do art. 18 |
| VI | Transparência | ✅ | Operadores nomeados; transferência internacional declarada |
| VII | Segurança | ✅ | [Política de segurança](./politica-seguranca-informacao.md) |
| VIII | Prevenção | ✅ | RIPD feito por iniciativa própria, antes de exigência |
| IX | Não discriminação | ✅ | Sem perfilamento, sem decisão automatizada |
| X | Responsabilização | ✅ | Este pacote é a demonstração |

## Bases legais (art. 7º e 11)

| Tratamento | Base | Estado |
| --- | --- | --- |
| Entrega das fotos | Art. 7º, IX (legítimo interesse) | ✅ [LIA](./LIA.md) |
| Portfólio | Art. 7º, IX | ⚖️ LIA sustenta, sujeito a parecer |
| Publicação editorial | Art. 7º, I (consentimento) | 🟡 Só quem aceitou Termos ≥ 2026-06-18 |
| **Imagem de menor** | **Art. 14, §1º** | ❌👤 **Termo assinado ausente — crítico** |
| Log de consentimento | Art. 7º, II + VI | ✅ |
| Pedidos de remoção | Art. 7º, II + I | ✅ |
| Suporte | Art. 7º, I + V | ✅ |
| Métricas | Art. 7º, IX | ✅ |
| Projetos familiares | Art. 4º, I (fora do escopo) | ✅ |
| Dados sensíveis (art. 11) | — | ✅ Não há: sem tratamento biométrico ⚖️ confirmar |

## Direitos do titular (art. 18)

| Item | Estado |
| --- | --- |
| Canal gratuito e sem cadastro | ✅ |
| Prazo declarado publicamente | 🟡 Site diz "15 dias úteis", lei diz "15 dias" — ⚖️ alinhar |
| Procedimento escrito | ✅ [direitos-do-titular.md](./direitos-do-titular.md) |
| Confirmação de identidade proporcional | ✅ Documento só em caso de dúvida real |
| Registro dos pedidos | 🟡 Formulário registra sozinho; e-mail/WhatsApp exigem registro manual |
| Aviso do direito de reclamar à ANPD | 🟡 No procedimento e nos modelos; falta na página `/privacidade` — ver tarefa abaixo |
| Prioridade para pedidos envolvendo menores | ✅ |

## Documentação (art. 37, 38, 50)

| Documento | Estado |
| --- | --- |
| ROPA | ✅ [`ROPA.md`](./ROPA.md) |
| RIPD / DPIA | ✅ [`RIPD.md`](./RIPD.md) |
| LIA | ✅ [`LIA.md`](./LIA.md) |
| Política de retenção | ✅ [`politica-de-retencao.md`](./politica-de-retencao.md) |
| Plano de resposta a incidentes | ✅ [`plano-resposta-incidentes.md`](./plano-resposta-incidentes.md) |
| Política de segurança | ✅ [`politica-seguranca-informacao.md`](./politica-seguranca-informacao.md) |
| Mapeamento de transferência internacional | ✅ [`transferencia-internacional.md`](./transferencia-internacional.md) |
| Modelos de autorização de imagem | ✅ [`termo-autorizacao-uso-imagem.md`](./termo-autorizacao-uso-imagem.md) |
| Política de privacidade pública | ✅ `/privacidade` |
| Termos de uso | ✅ `/termos`, versionados e com hash por aceite |

## Encarregado (art. 41)

| Item | Estado |
| --- | --- |
| Canal divulgado publicamente | ✅ privacidade@lucafchala.com, em `/privacidade` |
| Identidade divulgada | 🟡 Nomeado como o próprio controlador |
| Ato formal de nomeação | ❌⚖️ Ver enquadramento como agente de pequeno porte (Res. CD/ANPD nº 2/2022) |

## Segurança (art. 46–49)

| Item | Estado |
| --- | --- |
| Medidas técnicas documentadas | ✅ |
| Controle de acesso ao painel | ✅ |
| Segundo fator | ❌ TODO (magic link ou TOTP) |
| Cifra em trânsito | ✅ TLS + HSTS 2 anos |
| Cifra em repouso | ✅ Pelo provedor |
| Registro de operações de segurança | ✅ TTL curto |
| Plano de resposta | ✅ |
| Canal de divulgação responsável | ✅ RFC 9116 |
| Testes automatizados de segurança | ✅ 187 testes; suíte dedicada |
| Análise estática | ✅ CodeQL `security-extended` |
| Vigilância de dependências | ✅ Dependabot + `npm audit` + dependency-review |

## Transferência internacional (art. 33–36)

| Item | Estado |
| --- | --- |
| Mapeamento completo | ✅ |
| Fundamento identificado por operador | ✅ Art. 33, III |
| Transparência ao titular | ✅ `/privacidade` |
| **DPA do Google confirmado** | ❌⚖️👤 **Verificar se é Workspace ou conta pessoal** |
| Cópias arquivadas dos DPAs | ❌ Recomendado |
| Google Fonts eliminável | 🟡 CSP já preparada; migração pendente |

---

## O que fazer, em ordem

### 🔴 Crítico

1. **Autorização de imagem de menores assinada pelo responsável.**
   Risco R3 do RIPD, e o único ponto de alto risco residual do sistema.
   Nenhuma medida no código resolve. Modelos prontos em
   [`termo-autorizacao-uso-imagem.md`](./termo-autorizacao-uso-imagem.md);
   caminho de menor atrito é o Modelo 3, anexado ao contrato com a escola.
   👤 Fora do site.

2. **Confirmar o tipo de conta Google usada para o Drive.**
   Conta pessoal gratuita **não tem DPA**, o que enfraquece o fundamento do
   art. 33, III para a transferência de maior impacto do sistema (as próprias
   fotografias). Se for o caso, migrar para Workspace. 👤⚖️

### 🟡 Importante

3. **Parecer jurídico** sobre os pontos ⚖️: suficiência do LIA para o
   portfólio; imagem facial como dado não sensível; alcance da autorização
   editorial; prazos de retenção; cláusula de foro; formalização do encarregado.

4. **Alinhar o prazo publicado** — trocar "15 dias úteis" por "15 dias" em
   `/privacidade`. Mais restritivo, portanto sempre conforme.

5. **Acrescentar o direito de reclamar à ANPD** na página `/privacidade`.
   *(Feito nesta revisão — verificar no deploy.)*

6. **Arquivar cópias dos DPAs** de Cloudflare, Google e Resend, com data de
   consulta.

7. **Configurar `SIGNING_SECRET`** (`npx wrangler secret put SIGNING_SECRET`).
   Sem ele, o nonce de página do Drive e o token dos formulários ficam
   **desligados em silêncio** — o site funciona como se estivesse protegido.
   `/api/healthz` e o painel de status acusam a falta até que seja resolvido.

### 🟢 Desejável

8. Hospedar as fontes localmente e eliminar a transferência ao Google Fonts.
9. Segundo fator no painel.
10. Concluir a migração da CSP (remover handlers inline, impor a política estrita).
11. Registrar formalmente o encarregado, conforme o enquadramento de porte.
12. Ensaiar o plano de incidentes uma vez por ano.
