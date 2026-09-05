# RIPD — Relatório de Impacto à Proteção de Dados Pessoais

**Art. 5º, XVII e art. 38 da LGPD.**

- **Controlador:** Luca Ferriani Chala
- **Sistema avaliado:** `fotos.lucafchala.com`
- **Data:** 2026-08-16
- **Revisão:** anual, ou a cada mudança nas categorias de dados / operadores.

## Por que este relatório existe

A ANPD pode exigir um RIPD (art. 38), e a doutrina o recomenda quando o
tratamento envolve dados de crianças e adolescentes ou uso de imagem em escala.
**As duas condições ocorrem aqui**: os eventos são majoritariamente escolares e
de formatura, e a atividade-fim é publicar imagem de pessoa identificável.

Este relatório foi feito por iniciativa própria, antes de qualquer exigência.

---

## 1. Descrição do tratamento

Fotógrafo autônomo registra eventos (formaturas, eventos escolares, casamentos,
ensaios familiares) e entrega as fotos por link do Google Drive, publicado numa
galeria própria. O acesso ao link passa por um portão que exige aceite dos
Termos de Uso e, conforme a categoria do projeto, uma autodeclaração adicional.
Cada aceite é registrado com data, versão e hash do texto.

**Categorias de projeto** (`ACCESS_TYPES` em `src/utils.js`), que definem o rigor
do portão:

| Categoria | O que é | Exigência no portão |
| --- | --- | --- |
| `public` | Evento sem expectativa de privacidade | Aceite dos Termos |
| `private` | Evento fechado | Termos + declaração de participação/autorização |
| `family` | Ensaio familiar, uso doméstico | Termos + declaração de vínculo familiar |

## 2. Necessidade e proporcionalidade

| Pergunta | Resposta |
| --- | --- |
| A finalidade é legítima, específica e explícita? | Sim — entrega do trabalho contratado, divulgação do portfólio e publicação editorial. Declaradas em `/termos` e `/privacidade`. |
| Os dados são os mínimos necessários? | Sim, com uma ressalva examinada no risco **R3**. A fotografia é o produto — não há como minimizá-la sem destruir a finalidade. Os demais dados são justificados: e-mail/telefone para confirmar identidade em pedido de remoção; IP/UA para provar o consentimento. Suporte não é armazenado. Foto de remoção tem EXIF removido. |
| Há forma menos invasiva de atingir o mesmo fim? | Não para a entrega (a foto é o objeto). Para o portfólio, sim em parte — ver mitigação de **R2**. |
| Os titulares esperam este tratamento? | Sim para a entrega (contrataram ou participaram de evento fotografado, geralmente com aviso). **Parcialmente** para o portfólio e a publicação editorial — ver **R2** e **R4**. |

## 3. Riscos identificados

Escala: **Probabilidade** × **Impacto** (Baixo / Médio / Alto). Risco residual é
o que sobra **depois** das mitigações listadas.

---

### R1 — Redistribuição do link do Drive · Prob. **Alta** · Impacto **Médio**

Passado o portão, o link do Drive é uma URL comum. Quem o recebeu pode repassá-lo
a qualquer pessoa, e nada no site alcança isso.

**Mitigações**
- Portão server-side que falha fechado (`handleDriveLink`): o link **não está no
  HTML da página** — só sai numa resposta de API após Turnstile + consentimento.
- Nonce de página assinado (HMAC), amarrado ao slug e com validade de 2 h:
  impede varrer os projetos do site com um único token válido em mãos.
- Rate limit por IP, com limite mais apertado no caminho sem JavaScript.
- Cada liberação vira um registro auditável (quem, quando, de onde).

**Risco residual: MÉDIO.** Inerente ao modelo de entrega por Drive. Reduzi-lo de
verdade exigiria servir as fotos por rota própria com token por sessão — o que
esbarra na cota de requisições do Worker (ver TODO, item R2).
**Declarado abertamente** em `SECURITY.md` e no aviso permanente da página.

---

### R2 — Publicação de imagem sem consentimento individual · Prob. **Média** · Impacto **Alto**

A galeria é pública. Quem aparece numa foto e **não** passou pelo portão nunca
manifestou nada — a publicação se apoia em legítimo interesse.

**Mitigações**
- LIA documentado ([`LIA.md`](./LIA.md)) com o teste em três etapas.
- Direito de oposição **facilitado ao extremo**: botão no rodapé de cada evento,
  sem cadastro, sem login, resposta prometida em 15 dias.
- Só a **capa** e poucas fotos de teaser são públicas; o acervo fica atrás do portão.
- Projetos `family` ficam sob art. 4º, I (uso doméstico) e não vão para portfólio.
- Projeto pode ser marcado como não listado (fora da galeria, do sitemap e
  agora também com `X-Robots-Tag: noindex`).

**Risco residual: MÉDIO.** Estruturalmente inerente à fotografia de evento. O
canal de remoção em um clique é tratado como a salvaguarda que sustenta a
publicação em legítimo interesse — ver o teste completo em
[`LIA.md`](./LIA.md).

---

### R3 — Imagem de crianças e adolescentes · Prob. **Alta** · Impacto **Alto**

Eventos escolares e formaturas envolvem menores. O art. 14 exige consentimento
**específico e destacado** de pelo menos um dos pais ou do responsável legal, e
o tratamento deve atender ao **melhor interesse** da criança.

**Mitigações no site**
- Os Termos declaram que o aceite, quando referente a menor, é dado pelo
  responsável legal.
- A política de privacidade tem seção própria sobre menores (item 8).
- Pedidos de remoção envolvendo menores têm **prioridade** declarada.
- Nenhuma coleta de dado de menor pelo próprio site: o site não pede idade,
  cadastro, nem qualquer dado de criança.

**Consentimento parental**
O aceite marcado no site (gate de acesso ao Drive) é dado por quem acessa as
fotos — não necessariamente o responsável — e funciona como **complemento**:
prova de quando o acesso foi liberado e sob que texto exato. Ele **não
substitui** a autorização do responsável legal exigida pelo art. 14, cuja
formalização acontece fora do site, no momento da contratação/evento, via
instituição contratante ou diretamente, com o modelo em
[`termo-autorizacao-uso-imagem.md`](./termo-autorizacao-uso-imagem.md). O art.
14, §5º exige esforço razoável para verificar que o consentimento foi dado
pelo responsável — por isso a autorização assinada, e não apenas a caixa
marcada online, é o padrão adotado para imagem de menor.

**Risco residual: ALTO enquanto a autorização assinada não estiver
formalizada para o evento.** Até lá, imagem de menor identificável em
portfólio e publicação editorial é tratada com cautela redobrada — em
especial quando publicada por veículo de terceiro (ver **R4**).

---

### R4 — Publicação editorial em veículo de terceiro · Prob. **Média** · Impacto **Alto**

Os Termos (versão ≥ 2026-06-18) autorizam publicação editorial, jornalística,
cultural e educacional — inclusive em jornais estudantis, como o jornal do
colégio citado em `LEGAL.md`. Quando um terceiro publica, ele passa a ser
controlador daquele tratamento.

**Mitigações**
- O alcance editorial só vale para quem aceitou a versão dos Termos que já o
  previa. Cada registro fixa `terms_version` **e** `terms_hash`, então dá para
  responder com precisão "esta pessoa autorizou este uso?" — sem isso, a
  pergunta seria irrespondível.
- Fotos de quem não deu aceite, ou aceitou versão anterior, **não estão cobertas**.

**Risco residual: MÉDIO-ALTO quando houver menor na foto.** Nesse caso, o
aceite genérico dos Termos não é considerado suficiente: a publicação em
veículo de terceiro exige autorização **específica**, nomeando a publicação.

---

### R5 — Vazamento do painel administrativo · Prob. **Baixa** · Impacto **Alto**

O painel dá acesso ao log de consentimento (com IPs) e aos pedidos de remoção
(e-mail e telefone de titulares).

**Mitigações**
- PBKDF2-SHA256 100k iterações + comparação em tempo constante.
- Política de senha: mínimo de 12 caracteres, variedade de classes, rejeição de
  padrões previsíveis (era 6 caracteres antes desta revisão).
- Cookie `__Host-session`: nenhum outro host de `lucafchala.com` consegue
  plantar uma sessão.
- Sessão de 24 h absolutas com corte por 2 h de inatividade e vínculo ao cliente.
- Rate limit em duas camadas (10/10 min e 60/dia por IP) e **alerta por e-mail**
  a partir de 5 falhas.
- CSRF barrado no dispatcher, antes do roteamento, para todo método que escreve.
- Troca de senha revoga todas as outras sessões.
- Respostas de API com `no-store`; painel com `noindex` e `no-referrer`.
- `Clear-Site-Data` no logout.

**Risco residual: BAIXO.** Evolução planejada: segundo fator (TOTP ou magic link).

---

### R6 — Vazamento por operador · Prob. **Baixa** · Impacto **Alto**

Google, Cloudflare ou Resend sofrem incidente.

**Mitigações**
- Todos são fornecedores de grande porte com programa de segurança público e
  certificações (ISO 27001, SOC 2).
- Minimização reduz a exposição: suporte não é armazenado; a foto de remoção não
  vai para banco; alertas de erro não carregam PII.
- Retenção curta limita a janela.
- Plano de resposta pronto: [`plano-resposta-incidentes.md`](./plano-resposta-incidentes.md).

**Risco residual: BAIXO-MÉDIO.** Não controlável pelo controlador; endereçado
por escolha de fornecedor e por minimização.

---

### R7 — XSS / injeção na galeria pública · Prob. **Baixa** · Impacto **Médio**

Todo o HTML é gerado por template string a partir de dados de KV. Um escape
esquecido vira execução de script no browser do visitante.

**Mitigações**
- Escape canônico de 5 caracteres, com gate de CI proibindo a variante fraca.
- URLs passam por allowlist de esquema (`safeUrl`) **no ponto de uso**, não só na
  gravação — cobre dados legados e restaurados de backup.
- CSP com nonce por requisição em todos os `<script>`; CSP estrita em
  Report-Only, com coletor em `/api/csp-report`, medindo o que falta para
  eliminar o `'unsafe-inline'`.
- `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, sem `unsafe-eval`.
- Backup restaurado é higienizado (era o único caminho que gravava dados sem
  passar pelo normalizador).
- CodeQL (`security-extended`) e invariantes de CI.

**Risco residual: BAIXO.** Cai para **MUITO BAIXO** quando os handlers inline
saírem e a política estrita puder ser imposta.

---

### R8 — Exposição de metadados EXIF · Prob. **Média** · Impacto **Médio** → resolvido

Foto enviada num pedido de remoção carrega EXIF: coordenadas de GPS, modelo e
número de série do aparelho, data e hora exatas. Ou seja, quem pede para *sumir*
de uma foto entregava de brinde onde ela foi tirada.

**Mitigação implementada:** `stripImageMetadata()` remove segmentos APP1–APP15 e
comentários (JPEG), chunks `eXIf`/`tEXt`/`iTXt`/`zTXt`/`tIME` (PNG), chunks
`EXIF`/`XMP ` (WebP) e as extensões de comentário/aplicação/texto (GIF)
**antes** de a foto virar anexo. Em HEIC e AVIF — o formato padrão do iPhone —
os bytes do EXIF e do XMP são **zerados no lugar**: o arquivo mantém o mesmo
tamanho, porque removê-los invalidaria os deslocamentos que apontam também para
a imagem, e no lugar do EXIF fica um bloco válido e vazio.

O portão é a própria capacidade de limpar: o que não sai comprovadamente limpo
não vira anexo, e o titular recebe orientação de como reenviar. O resultado da
tentativa fica registrado no pedido.

**Risco residual: BAIXO** (arquivo fora do padrão do contêiner é recusado, não
enviado).

---

## 4. Quadro-resumo

| # | Risco | Residual | Salvaguarda principal |
| --- | --- | --- | --- |
| R1 | Redistribuição do link do Drive | Médio | Portão server-side + nonce assinado |
| R2 | Publicação sem consentimento individual | Médio | Teste de legítimo interesse ([`LIA.md`](./LIA.md)) |
| R3 | **Imagem de menores** | **Alto** | Autorização assinada pelo responsável legal |
| R4 | Publicação editorial por terceiro | Médio-Alto | Autorização específica para menores |
| R5 | Vazamento do painel | Baixo | Segundo fator (evolução prevista) |
| R6 | Vazamento por operador | Baixo-Médio | Escolha de fornecedor + minimização |
| R7 | XSS na galeria | Baixo | Migração da CSP em andamento |
| R8 | Metadados EXIF | Baixo | Remoção automática no servidor |

## 5. Conclusão

O tratamento é **proporcional à finalidade** e conta com salvaguardas técnicas
acima do usual para um projeto deste porte — em vários pontos, acima do que
serviços comerciais equivalentes oferecem.

O risco que **não é técnico** é o que domina: **R3, imagem de crianças e
adolescentes**. Nenhuma medida no código resolve a ausência de uma autorização
assinada pelo responsável legal, porque essa coleta acontece fora do site. O
encaminhamento deste RIPD é, em uma frase: **formalizar a autorização de imagem
de menores junto às instituições contratantes**, usando o modelo já pronto em
[`termo-autorizacao-uso-imagem.md`](./termo-autorizacao-uso-imagem.md).
