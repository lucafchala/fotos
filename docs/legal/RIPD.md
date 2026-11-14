# RIPD — Relatório de Impacto à Proteção de Dados Pessoais

**Art. 5º, XVII e art. 38 da LGPD.**

- **Controlador:** Luca Ferriani Chala
- **Sistema avaliado:** `fotos.lucafchala.com`
- **Data:** 2026-08-16 · **atualizado em 2026-11-06** (busca pelo rosto, risco R9) · **2026-11-14** (buscadores, IndexNow e treino de IA, risco R12)
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
| `private` | Evento fechado | Termos + reconhecimento de que o material é para uso pessoal, sem fim comercial |
| `family` | Ensaio familiar, uso doméstico | Termos + reconhecimento de que as imagens são de uso particular e doméstico |

A declaração registra o uso combinado; **não é barreira de acesso** — o link
do Drive, liberado, abre para quem o tiver (#146, modelo "consentimento, não
sigilo"). Sem a verificação de segurança (Turnstile bloqueado no navegador),
álbum restrito pede também o **nome**, para o registro não sair anônimo, e
cada IP abre no máximo 3 álbuns restritos distintos por dia por esse caminho.

## 2. Necessidade e proporcionalidade

| Pergunta | Resposta |
| --- | --- |
| A finalidade é legítima, específica e explícita? | Sim — entrega do trabalho contratado, divulgação do portfólio e publicação editorial. Declaradas em `/termos` e `/privacidade`. |
| Os dados são os mínimos necessários? | Sim, com uma ressalva examinada no risco **R3**. A fotografia é o produto — não há como minimizá-la sem destruir a finalidade. Os demais dados são justificados: e-mail/telefone para confirmar identidade em pedido de remoção; IP/UA para provar o consentimento. Suporte não é armazenado. Foto de remoção tem EXIF removido. O e-mail do código de acesso (último recurso do portão) não é armazenado — só o hash, por até 2 h, para limitar envios. |
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
- Rate limit por IP em balde de fichas, com limite mais apertado no caminho
  sem JavaScript. Dimensionado para caber o público de um evento atrás de um
  único IP (o Wi-Fi do local), sem afrouxar o Turnstile.
- Quem não passa pelo Turnstile pode receber um código por e-mail: o portão
  continua exigindo o aceite dos Termos, e o código vale só para aquele
  projeto, por 15 min.
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
[`termo-autorizacao-uso-imagem.md`](./termo-autorizacao-uso-imagem.md).

A busca pelo rosto (**R9**) soma um segundo ponto do mesmo tipo: o índice guarda o vetor do rosto de quem aparece nas fotos. Ela fica desligada até o controlador avisar a turma e os responsáveis, e qualquer pessoa sai dela na hora. O art.
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
- CSP estrita aplicada (#126): nonce por requisição em todos os `<script>` e
  nenhum `'unsafe-inline'` em `script-src` — script sem nonce, handler inline e
  URL `javascript:` não executam. Violações vão para o coletor em
  `/api/csp-report`, e os roteiros de navegador reprovam com qualquer mensagem
  de CSP no console.
- `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, sem `unsafe-eval`.
- Backup restaurado é higienizado (era o único caminho que gravava dados sem
  passar pelo normalizador).
- CodeQL (`security-extended`) e invariantes de CI.

**Risco residual: BAIXO.** A condição que este documento previa para baixá-lo a
**MUITO BAIXO** — handlers inline fora e política estrita imposta — foi cumprida
(#126); a reclassificação fica para a próxima revisão do RIPD.

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

### R9 — Busca pelo rosto (dado biométrico) · Prob. **Média** · Impacto **Alto**

**O tratamento.** A busca pelo rosto (v3.2, `src/rosto.js`, [`docs/ROSTO.md`](../ROSTO.md)) existe só nos álbuns públicos em que o controlador a liga. Ela envolve duas pessoas diferentes:

- **Quem busca** envia uma selfie. Ela vai à Amazon Rekognition (região de São Paulo) para a comparação e não é guardada nem pelo site nem pela Amazon.
- **Quem aparece nas fotos** tem o rosto transformado num vetor numérico, guardado na Amazon Rekognition enquanto o álbum existir. O vetor não traz nome; só liga um rosto a uma foto.

Rosto é dado sensível (art. 5º, II, e art. 11), e o álbum tem menores (R3).

**Bases legais.**

- **Quem busca:** **consentimento específico e destacado** (art. 11, I): caixa de aceite a cada busca, com o texto do que acontece com a selfie.
- **O índice dos retratados:** este é o **ponto fraco**. Não há consentimento individual de cada pessoa que aparece nas fotos, e o art. 11 não tem legítimo interesse.

**Mitigações**

| Mitigação | Onde |
| --- | --- |
| Desligada por padrão; só o controlador liga, projeto a projeto | opção "Busca pelo rosto" |
| Ligar só depois de avisar a turma e os responsáveis, com o link de saída; quando possível, colher a concordância pela comissão ou pela escola | `docs/ROSTO.md`, "LGPD: o que fazer antes de ligar" |
| **Sair da busca**: o titular envia uma selfie e os rostos parecidos saem do índice na hora; as fotos que chegarem depois também não o mostram. O rosto de quem saiu fica guardado só para isso | `/api/rosto/sair` |
| A busca não identifica ninguém por nome e não decide nada; o texto diz "pode ser você" | página do álbum |
| Dados na região de **São Paulo**; opt-out de treino de IA da AWS ativado | `docs/ROSTO.md` |
| Foto oculta ou removida sai do índice na execução seguinte do indexador | `scripts/rosto-indexa.mjs` |
| Índice apagado ao fim do álbum ou quando a busca é desligada | `docs/ROSTO.md`, "Desligar e apagar" |
| Antes do lançamento do álbum, só o controlador (logado) e quem ele escolheu para testar (a prévia com senha) usam a busca | `buscaRostoAtiva`, `temPrevia` |
| A saída vale para as fotos que chegam depois: o indexador apaga os rostos parecidos com os de quem saiu na mesma execução que os indexou, e a busca não mostra nada a quem saiu, na régua mais baixa dela | `limpaRostosDeQuemSaiu`, `confereSaida` (`src/rosto.js`); `tests/rosto-saida.test.js` |
| A saída aceita qualquer foto de rosto: teto de saídas por dia no site com alerta ao controlador, e lista no painel (data e contagem, sem foto) com desfazer | `ROSTO_SAIR_POR_DIA`, `src/saidas.js` |
| Projeto excluído apaga as coleções na hora; busca desligada, em 72 horas | `apagaIndiceDoAlbum`, `apagaIndicesVencidos` |
| Limite por IP, Turnstile, token do formulário e teto de custo | `src/index.js`, `handleRosto` |

**Risco residual: MÉDIO-ALTO** enquanto não houver concordância formal da turma e dos responsáveis. Cai para **MÉDIO** com o aviso prévio e a saída usada por quem pedir. O encaminhamento é o mesmo de R3: formalizar junto à escola ou à comissão, de preferência antes de ligar a busca para o público.

### R10 — Texto e objetos lidos nas fotos; moderação automática · Prob. **Média** · Impacto **Baixo**

**O tratamento.** Com "Busca nas fotos" ligada (v3.7, `src/busca.js`, [`docs/ROSTO.md`](../ROSTO.md)), a Amazon Rekognition lê de cada foto pública do álbum as palavras visíveis, as "coisas" e cenas e os rótulos de moderação. O resultado fica no D1 e permite buscar "10", "bolo" ou "palco".

**O risco.** Um **nome num crachá**, numa faixa ou numa camiseta vira texto buscável. Isso facilita achar a foto de uma pessoa pelo nome, inclusive de menor (R3). O texto já está visível na foto pública, mas a busca torna isso mais fácil.

**Mitigações**

| Mitigação | Onde |
| --- | --- |
| Desligada por padrão; só o controlador liga, projeto a projeto; antes do lançamento, só o controlador (e quem tem a senha de prévia) usa | opção "Busca nas fotos", `buscaTextoAtiva` |
| Só palavras com confiança alta (85%); resultados limitados a 120 | `BUSCA_TEXTO_CONFIANCA_MIN`, `BUSCA_MAX_RESULTADOS` |
| Foto oculta não aparece; foto removida sai da busca na execução seguinte | `buscaNasFotos`, indexador |
| **Moderação automática** marca foto possivelmente imprópria (gestos obscenos, nudez, álcool, drogas, violência) e avisa o controlador por e-mail, que revisa e oculta o que for preciso. Desde a v3.8.12 nada é escondido sem revisão humana | `handleBuscaIndexar`, `BUSCA_MODERACAO_ESCONDE` |
| Dados em São Paulo; opt-out de treino de IA; nada de rosto nem de imagem guardado | `docs/ROSTO.md` |
| Remoção de foto a pedido continua valendo e tira a foto da busca | fluxo de remoção da galeria |

**Risco residual: BAIXO.** A moderação **reduz** o risco R3 para fotos enviadas pela turma, desde que o controlador leia o aviso e oculte a foto logo: entre o aviso e a decisão, a foto marcada continua visível.

### R12 — Fotos públicas lidas para treino de IA · Prob. **Alta** · Impacto **Médio**

**O tratamento.** Desde a v3.11.0 (decisão do controlador, 13/11/2026: "quero a galeria indexada em tudo"), o `robots.txt` declara `ai-train=yes` e não fecha mais o site aos robôs de treino (GPTBot, ClaudeBot, Google-Extended, CCBot e outros). Os álbuns **públicos** podem ser lidos e usados para treinar modelos de IA, e o IndexNow avisa Bing, Yandex e os demais quando uma página pública entra ou sai. (Este risco é o R12 porque o R11 é o do envio de fotos pelo site, que vem num PR separado.)

**O risco.** Fotos de turma, **com menores** (R3), entram em conjuntos de treino de terceiros. A remoção a pedido tira a foto do site e, com o tempo, dos buscadores, mas **não a retira de um modelo já treinado** nem de cópias que esses serviços tenham guardado. O efeito da remoção, que é a principal salvaguarda dos riscos R2 e R3, fica menor para quem pede depois de a foto ter sido lida.

**Mitigações**

| Mitigação | Onde |
| --- | --- |
| Só álbuns públicos: família e privado ficam fora dos sitemaps e do IndexNow, levam noindex e ficam atrás do portão (um teste prende que álbum restrito nunca entra no IndexNow) | `galeriaIndexavel`, `urlsDoIndexNow`, `tests/galeria-capitulos.test.js` |
| O download (o arquivo original) fica fechado para todo robô, inclusive os de IA | `handleRobots`, `tests/healthz.test.js` |
| A Privacidade diz, no parágrafo de menores, que a remoção não alcança modelo já treinado; pedido de responsável por menor tem prioridade | `src/ui/privacy.js` (§3) |
| Página ou capítulo retirado é avisado ao IndexNow, para o buscador reler e tirar do índice | `src/indexnow.js` |
| Reversível: voltar `ai-train=no` e o Disallow dos robôs de treino é uma linha, e vale para a leitura seguinte | `handleRobots` |

**Risco residual: MÉDIO.** O `robots.txt` é um pedido, não um controle: mesmo com `ai-train=no` um robô podia ler a página pública. A decisão torna explícito o que antes era só desestimulado. Ela pesa mais sobre R3: o controlador deve rever esta escolha antes de publicar um álbum público com muitos menores identificáveis, ou tornar esse álbum privado.

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
| R9 | **Busca pelo rosto** (biometria) | **Médio-Alto** | Desligada por padrão, saída imediata, aviso prévio à turma, dados em São Paulo |
| R10 | Texto e objetos lidos nas fotos; moderação | Baixo | Desligada por padrão, confiança alta, ocultas fora, moderação avisa o controlador de foto imprópria |
| R12 | **Fotos públicas lidas para treino de IA** | **Médio** | Só álbuns públicos; download fechado; a Privacidade avisa que a remoção não alcança modelo já treinado |

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
