# LIA — Teste de Legítimo Interesse

**Art. 7º, IX e art. 10 da LGPD.**

- **Controlador:** Luca Ferriani Chala
- **Data:** 2026-08-16
- **Objeto:** publicação e entrega de fotografias de eventos em
  `fotos.lucafchala.com`, quanto às pessoas retratadas que **não** manifestaram
  consentimento.

## Por que este documento existe

O art. 10, §3º permite à ANPD solicitar ao controlador o relatório de impacto
referente a operações fundadas em legítimo interesse. Mais importante que a
exigência formal: legítimo interesse é a base legal mais frequentemente invocada
sem análise — usada como "consentimento que eu não quis pedir". O teste abaixo
existe para que a invocação aqui seja verificável, e para registrar honestamente
onde ela **não** se sustenta.

---

## Etapa 1 — Finalidade legítima

O interesse é **concreto e específico**, não hipotético (art. 10, caput):

1. **Entregar o trabalho contratado.** Um fotógrafo contratado para registrar
   uma formatura precisa entregar as fotos aos participantes. Sem publicar a
   galeria e o link, não há entrega.
2. **Divulgar o próprio trabalho.** Portfólio é condição de exercício da
   profissão de fotógrafo. Um fotógrafo sem portfólio não tem como demonstrar
   competência e obter novos contratos. É interesse legítimo do controlador e,
   indiretamente, de terceiros (potenciais contratantes).
3. **Publicação editorial, cultural e educacional.** Registro de evento
   escolar/comunitário em jornal estudantil, zine ou exposição — atividade com
   valor jornalístico e cultural próprio.

Os três são **lícitos, reais e determinados**. Nenhum envolve venda,
licenciamento comercial da imagem ou publicidade de terceiros — usos
explicitamente excluídos nos Termos.

> ⚠️ Para (3), o legítimo interesse é **mais frágil** que para (1) e (2). Ver
> Etapa 3 e o risco R4 do [`RIPD.md`](./RIPD.md).

---

## Etapa 2 — Necessidade

> A finalidade poderia ser atingida de forma menos invasiva?

| Finalidade | Alternativa menos invasiva? | Conclusão |
| --- | --- | --- |
| Entrega | Enviar as fotos individualmente a cada participante | **Inviável.** Exigiria coletar dados de contato de **todos** os presentes — muito mais invasivo que publicar uma galeria com link protegido. A alternativa aumenta a coleta em vez de reduzi-la. |
| Entrega | Publicar sem portão de acesso | **Rejeitada** — é o que existia antes. O portão (Turnstile + Termos + declaração) é mais restritivo, e foi adotado deliberadamente. |
| Portfólio | Publicar só fotos sem pessoas identificáveis | **Parcialmente viável.** Fotografia de evento é sobre pessoas; um portfólio só de detalhes não demonstra a competência relevante. Mitigado limitando o que é público a **capa + poucos teasers**. |
| Portfólio | Borrar rostos | **Rejeitada.** Descaracteriza o produto e é, ela própria, uma alteração da imagem da pessoa. |
| Editorial | Pedir autorização específica | **Viável.** Por isso **é** o que se recomenda (ver Etapa 3). |

**Conclusão:** o tratamento é necessário para (1) e (2), com o escopo público
minimizado. Para (3) **não** é estritamente necessário, e por isso o documento
não sustenta legítimo interesse ali.

---

## Etapa 3 — Balanceamento (art. 10, §2º)

### Expectativa legítima do titular

| Situação | Expectativa | Avaliação |
| --- | --- | --- |
| Participante de formatura/evento escolar | Sabe que há fotógrafo contratado; espera que as fotos sejam entregues e circulem no grupo | **Alinhada** com (1) |
| O mesmo participante, quanto ao portfólio | Espera razoavelmente que um profissional mostre trabalho seu | **Provavelmente alinhada**, mas menos evidente |
| O mesmo participante, quanto a jornal/exposição | **Não espera** que sua imagem apareça em veículo de terceiro | **NÃO alinhada** |
| Convidado de casamento | Sabe que há fotógrafo; espera circulação restrita | Alinhada com (1); frágil para (2) |
| Ensaio familiar | Espera uso doméstico | Fora do escopo (art. 4º, I); **não vai a portfólio** |

### Impacto sobre direitos e liberdades

- **Natureza do dado:** imagem de pessoa identificável. Não é dado sensível por
  padrão — não há tratamento biométrico, reconhecimento facial ou indexação por
  face. É, ainda assim, dado que afeta diretamente a personalidade (CF art. 5º,
  X; CC art. 20).
- **Contexto:** evento social, com expectativa de privacidade reduzida (mas não
  nula) por já ser um ambiente coletivo e fotografado.
- **Escala:** pequena. Fotógrafo autônomo, dezenas de eventos, sem
  compartilhamento com rede de anunciantes, sem perfilamento, sem venda.
- **Vulnerabilidade:** **aqui está a exceção que muda tudo.** Menores de idade
  são titulares vulneráveis, e a LGPD lhes dá regime próprio (art. 14). Ver abaixo.

### Salvaguardas (art. 10, §2º — as medidas que fazem o balanço pender)

| Salvaguarda | Onde |
| --- | --- |
| Transparência: finalidade e base legal declaradas | `/privacidade`, `/termos` |
| Direito de oposição em um clique, sem cadastro, gratuito | Botão no rodapé de cada evento |
| Prazo de resposta declarado (15 dias) | `/privacidade` |
| Prioridade para pedidos envolvendo menores | `/privacidade`, item 8 |
| Acervo atrás de portão, não aberto | `handleDriveLink()` |
| Exposição pública mínima (capa + teasers) | `src/ui/gallery.js` |
| Projeto pode sair da galeria, do sitemap e da indexação | flag `visible` + `X-Robots-Tag` |
| Projetos familiares fora do portfólio | categoria `family` |
| Registro auditável de cada acesso liberado | tabela `image_use_consent` |

### Resultado do balanceamento

| Finalidade | Legítimo interesse se sustenta? |
| --- | --- |
| (1) **Entrega** | **SIM.** Expectativa alinhada, alternativa mais invasiva, salvaguardas robustas. |
| (2) **Portfólio** | **SIM, com ressalva.** Exposição pública mínima e oposição facilitada; o canal de remoção em um clique é a salvaguarda que sustenta o balanço. |
| (3) **Editorial em veículo de terceiro** | **NÃO.** Fora da expectativa razoável. Deve apoiar-se em **consentimento específico** (aceite dos Termos ≥ 2026-06-18 ou autorização dedicada). |
| **Qualquer finalidade, imagem de MENOR** | **NÃO.** O art. 14 exige consentimento específico e destacado do responsável. Legítimo interesse **não substitui** esse consentimento. |

---

## Conclusões operacionais

1. **Entrega e portfólio** seguem em legítimo interesse, com as salvaguardas
   acima mantidas e verificáveis.
2. **Publicação editorial** exige consentimento. Publicar apenas fotos de quem
   aceitou os Termos na versão ≥ 2026-06-18 — verificável em CSV, porque cada
   registro guarda `terms_version` **e** `terms_hash` — ou obter autorização
   específica.
3. **Imagem de menor** exige autorização do responsável legal, preferencialmente
   assinada, coletada no evento ou pela instituição contratante. Modelo em
   [`termo-autorizacao-uso-imagem.md`](./termo-autorizacao-uso-imagem.md) — ver
   R3 no [`RIPD.md`](./RIPD.md).
4. **Revisar este LIA** sempre que mudar a finalidade, o alcance da publicação ou
   o texto dos Termos.
