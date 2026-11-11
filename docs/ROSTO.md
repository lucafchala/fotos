# Busca pelo rosto

O visitante tira uma selfie e vê as fotos do álbum em que provavelmente aparece.
A função chegou na 3.2.0. Fica **desligada** até existirem as chaves da AWS no
Worker e a opção estar marcada no projeto.

## Por que a Amazon Rekognition

| Opção | Por que sim ou não |
|---|---|
| **Amazon Rekognition** (escolhida) | Tem região em **São Paulo** (`sa-east-1`) com as APIs de coleção. Cobra por uso (US$ 0,001 por foto indexada ou busca). API simples, chamada do Worker com uma assinatura SigV4 de 100 linhas, sem SDK. |
| Azure Face | A identificação de rostos exige pedido de acesso limitado à Microsoft, sem garantia de aprovação para este uso. |
| Google Cloud | Não oferece reconhecimento facial (só detecção). |
| Face++ e similares | Dados fora do Brasil, em país sem garantia equivalente à LGPD. |
| SaaS de fotos de evento (9Pic e similares) | De US$ 0,02 a US$ 0,03 por foto, cerca de 20 a 30 vezes mais, e as fotos ficam hospedadas lá. |
| Tudo no navegador (plano da #273) | Grátis e sem índice no servidor, mas a primeira busca leva 1 a 2 minutos por capítulo, e o celular fraco sofre. Fica como alternativa. |

## Custos (álbum de cerca de 3.000 fotos)

| Item | Preço | Estimativa |
|---|---|---|
| Indexar (uma vez por foto) | US$ 0,001/foto | ~US$ 3 |
| Guardar o índice | US$ 0,00001/rosto/mês | ~10 mil rostos: US$ 0,10/mês |
| Uma busca (1 a 4 chamadas) | US$ 0,001 a 0,004 | 1.000 buscas: US$ 1 a 4 |

- **Conta nova:** o nível grátis cobre 1.000 imagens por mês em cada grupo de APIs durante 12 meses, e a AWS dá até US$ 200 em créditos.
- **De onde vêm as chamadas de uma busca:**
  - quem saiu da busca (só depois que alguém sai);
  - o álbum;
  - até 2 "sementes": as fotos com 98% ou mais procuram os rostos parecidos com elas, para achar a pessoa de lado ou de longe.
- **Teto de custo:** `ROSTO_BUSCA_GLOBAL_BUCKET` limita o site a ~3.600 buscas por dia, cerca de US$ 14 no pior dia.
- **Alerta de cobrança:** configure um alerta no painel da AWS (Billing → Budgets) de US$ 10/mês.

## Como ligar

1. **Conta da AWS:** crie em aws.amazon.com e ative a região **São Paulo**.

2. **Usuário só para isso:** em IAM → Users → Create user, crie `fotos-rosto`, sem acesso ao console. Anexe esta política, trocando `<CONTA>` pelo número da conta:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": [
         "rekognition:SearchFacesByImage", "rekognition:SearchFaces", "rekognition:IndexFaces", "rekognition:DeleteFaces",
         "rekognition:ListFaces", "rekognition:CreateCollection"
       ],
       "Resource": "arn:aws:rekognition:sa-east-1:<CONTA>:collection/fotos-*"
     }]
   }
   ```

   Depois, em Security credentials → Create access key ("Application running outside AWS"), guarde a chave e o segredo.

3. **Não deixar a Amazon treinar com os rostos.** Sem isso, a AWS pode usar o conteúdo processado pela Rekognition para melhorar o serviço.
   1. AWS Organizations → Create organization (é grátis).
   2. Policies → AI services opt-out policies → Enable.
   3. Crie uma política com `{"services":{"default":{"opt_out_policy":{"@@assign":"optOut"}}}}` e anexe à raiz da organização.

4. **Chaves no Worker:**

   ```bash
   npx wrangler secret put AWS_ACCESS_KEY_ID
   ```

   ```bash
   npx wrangler secret put AWS_SECRET_ACCESS_KEY
   ```

   A região padrão é `sa-east-1`. Para outra, use o secret `AWS_REGION`.

5. **Token do indexador:** gere um valor aleatório de 64 caracteres hexadecimais e grave o mesmo como secret `ROSTO_INDEXADOR_TOKEN` no Worker e no GitHub. Com ele, o indexador lê o álbum ainda em "Em breve" (antes do lançamento), pelo header `X-Rosto-Indexador`. Sem ele, só lê álbum já lançado.

5b. **Chaves no GitHub, para o indexador:** em Settings → Secrets and variables → Actions:
   - Secrets `ROSTO_AWS_ACCESS_KEY_ID` e `ROSTO_AWS_SECRET_ACCESS_KEY` (as mesmas do passo 2);
   - Variable `ROSTO_SLUGS` = `entrenos2026` (vários álbuns separados por vírgula).

6. **Pedir mais vazão:** em Service Quotas → Amazon Rekognition (São Paulo), peça 20 por segundo para "SearchFacesByImage" e "SearchFaces". É grátis e leva alguns dias. A cota padrão é 5 por segundo; enquanto isso, a página espera e tenta de novo sozinha quando lota.

7. **Montar o índice:** Actions → rosto → Run workflow. Com a busca nas fotos ligada, cada foto leva quatro chamadas (rosto, texto, coisas, moderação) e o álbum de 2.364 fotos pede mais de uma execução: cada uma para de pegar foto nova aos 35 minutos (`ROSTO_MAX_MINUTOS`), grava o que fez e a próxima (a cada 10 minutos, ou Run workflow de novo) continua de onde parou. Depois, o workflow roda sozinho a cada 10 minutos (desde a 3.7.2) e pega as fotos novas.

8. **Ligar no projeto:** no painel, edite o projeto e marque **Busca pelo rosto**. O botão **Procurar meu rosto** aparece no índice da galeria.

## Como funciona

- **Busca** (`POST /api/rosto/buscar`):
  - a selfie é reduzida no navegador (640 px, JPEG);
  - antes da AWS, o site confere o aceite, o token do formulário, o teto por IP e o Turnstile;
  - **no pico (v3.8.8):** quando a Amazon recusa por excesso (a cota de buscas por segundo, `ROSTO_AWS_TPS` em `src/config.js`: o que a conta tem hoje e o aumento pedido, num lugar só), a resposta é 429 com uma espera sorteada, e as fichas do teto por IP e do teto global **voltam** (nada foi cobrado). A página tenta de novo sozinha, até `ROSTO_TENTATIVAS_NO_PICO` vezes, **cada vez com uma verificação nova do Turnstile** (o token vale uma vez). O teto global (`ROSTO_BUSCA_GLOBAL_BUCKET`) cabe o dia do lançamento: 1.500 pessoas com 3 buscas cada;
  - a primeira chamada pergunta à coleção `fotos-<slug>-sair` se a pessoa saiu da busca. Só existe depois que alguém sai (marca `rosto-sair:<slug>` no KV);
  - a segunda procura em `fotos-<slug>`, com semelhança mínima de 70% (`ROSTO_LIMIAR_BUSCA`, v3.8.2; era 80% e, até a 3.7.3, 90%: o dono prefere, na dúvida, mostrar a foto) e sem filtro de qualidade na selfie. De 70% a 80% a foto aparece à parte, em "Talvez seja você";
  - até 4 sementes (achados com 95% ou mais, de fotos diferentes) procuram os rostos parecidos com elas (`SearchFaces`, 85%). O que acham entra com a semelhança multiplicada pela da semente, abaixo dos achados diretos;
  - o resultado sai sem as fotos ocultas.
- **Atualizar "minhas fotos"** (`POST /api/rosto/atualizar`, v3.8.3):
  - o aparelho guarda, junto com a lista, até 4 rostos **do índice do álbum** que a busca achou (as sementes, nunca a selfie);
  - quando o índice recebeu fotos depois da busca (`rosto-novas:<slug>` no KV, gravado pelo `/api/busca/indexar`), "Ver minhas fotos" manda esses rostos; cada um faz uma `SearchFaces` (80%) e as fotos novas voltam marcadas;
  - mesmo portão da busca (token do formulário, aceite, limite por IP, Turnstile); quem saiu teve esses rostos apagados do índice, então nada volta.
- **Sair** (`POST /api/rosto/sair`):
  - o rosto vai para `fotos-<slug>-sair`, guardado com o consentimento da pessoa e só para isso;
  - todo rosto com 65% de semelhança ou mais é apagado do índice do álbum (sempre abaixo da régua mais baixa da busca, 70%: o que a busca acharia, a saída apaga).
- **Indexador** (`scripts/rosto-indexa.mjs`):
  - lê as páginas públicas do álbum, ou seja, a mesma lista que o visitante vê;
  - indexa a foto de 2400 px das fotos novas (1600 px se passar de 5 MB), até 100 rostos por foto, SEM filtro de qualidade (`NONE`, desde a 3.7.3; era `LOW`): entra todo rosto que a Amazon detecta, até o pequeno, de lado ou no escuro. Trocar o filtro (`QUALIDADE` no script) apaga os rostos e indexa de novo uma vez, só a parte do rosto (~US$ 1,50 para 1.200 fotos). Se o estado do Actions se perder, essa reindexação acontece de novo;
  - apaga os rostos das fotos que saíram do álbum;
  - guarda o estado **no site** (v3.8.8): `GET` e `POST /api/busca/estado`, com o `ROSTO_INDEXADOR_TOKEN`, no KV (`rosto-estado:<slug>`), gravado a cada lote de 90 fotos e só quando muda. Até a 3.8.7 era um arquivo no cache do Actions, que o workflow de um PR vindo de um fork consegue restaurar (o repositório é público). Sem estado guardado, o site monta a resposta do que o D1 já tem (`busca_foto`), e nada é reprocessado. **No Actions, o token passou a ser obrigatório.**
  - **o log é público:** só imprime contagens ("álbum 1 de 1: N fotos em M eventos", "N falhas", e as falhas por tipo). Nunca o slug, o nome de um evento, o ID de uma foto, o nome da coleção ou a mensagem crua de um erro. Para conferir evento por evento, use o painel e a página do álbum, logado.
  - **leitura incompleta não apaga nada (v3.8.8):** se uma página do álbum vier sem a lista de fotos (o Drive falhou naquele instante) ou o álbum vier vazio, nenhum rosto é apagado e nada sai da busca nessa execução. Perder o estado também não apaga o índice: o filtro de qualidade só reindexa com a marca guardada e diferente.
  - processa até 4 fotos ao mesmo tempo, começando uma a cada 250 ms: cada operação fica em no máximo 4 chamadas por segundo (a cota padrão é 5).
- **Só nos álbuns certos:** o botão só aparece no índice da galeria por capítulos, em álbum público. Antes do lançamento ([`ALBUM.md`](./ALBUM.md)), só o dono, logado, vê e testa.
- **Sem as chaves no Worker:** as rotas respondem 404.

## Na página (v3.7.5)

- **Botão principal:** "Achar minhas fotos pelo rosto" é o primeiro e o de destaque na abertura do álbum.
- **Turnstile cedo:** o script carrega o Turnstile assim que a página abre (`requestIdleCallback`) e renderiza um widget invisível (`appearance: 'interaction-only'`) fora da janela. O token chega antes do toque. Se o Turnstile pedir interação ou der erro, a janela mostra o widget visível, como antes. O token vale uma busca; depois de cada uma, o widget é reiniciado.
- **Resultado que volta:** os IDs das fotos achadas ficam no `sessionStorage` da aba (`rs-res:<slug>`, por 3 h; a busca nas fotos usa `bf-res:<slug>`) e o endereço ganha `#minhas-fotos` (ou `#busca=termo`). Ao voltar de uma foto, a lista é redesenhada e rolada até a foto aberta. A selfie nunca é guardada; os IDs são de fotos públicas do álbum e não saem do aparelho.

## LGPD: o que fazer antes de ligar

O rosto é dado **sensível** (art. 11). A busca de quem tira a selfie se apoia no
consentimento dessa pessoa: a caixa de aceite, a cada busca.

**O ponto fraco é o índice.** Ele guarda o vetor do rosto de todo mundo que
aparece nas fotos, inclusive de quem nunca usou a busca. Também inclui menores:
a ANPD já suspendeu reconhecimento facial de estudantes no Paraná. O que foi
feito para reduzir o risco:

- o índice só existe nos álbuns marcados e fica na região de São Paulo;
- qualquer pessoa sai da busca sozinha, na hora, e as fotos novas também deixam de mostrá-la;
- a busca nunca dá nome a ninguém, e os textos dizem "pode ser você";
- foto oculta ou removida sai do índice na próxima execução do indexador;
- o índice é apagado no fim do álbum.

**Antes de ligar:**

1. Avise a turma (e os responsáveis, no caso dos menores) **antes**, com o link do "Não quero aparecer na busca".
2. Se possível, colete a concordância da turma pela escola ou pela comissão.
3. Em caso de dúvida, peça uma revisão jurídica.
4. Atualize o RIPD (`docs/legal/RIPD.md`) com este tratamento.

## Aquecimento das miniaturas (v3.8.11)

Depois de indexar, o indexador pede ao site as miniaturas de cada foto ainda não aquecida (`AQUECE_LARGURAS`, até `AQUECE_FOTOS_POR_EXECUCAO` fotos por execução) e anota no estado (`quentes`). A cópia fica no R2; no lançamento a página não depende do Google. Não custa AWS. Um álbum de 6.000 fotos aquece em cerca de dez execuções (menos de duas horas). O log diz "miniaturas aquecidas: N fotos". **Antes de lançar, confira no log que não sobrou foto por aquecer** (a linha deixa de aparecer). Desligar: variável `ROSTO_AQUECE=0` no workflow.

## Teto de custo do indexador (v3.8.10)

O indexador processa no máximo `ROSTO_FOTOS_POR_DIA` fotos por dia (UTC) em cada álbum: 2.000, cerca de US$ 8 no pior dia (até 4 chamadas de US$ 0,001 por foto). O que passar fica para o dia seguinte, e o log diz "teto do dia". Para indexar um álbum grande de uma vez, crie a variável do repositório `ROSTO_MAX_DIA` (Settings → Secrets and variables → Actions → Variables; por exemplo `8000`) e apague depois.

## Quem saiu da busca (v3.8.9)

- O rosto de quem saiu fica como uma **marca** dentro do índice do álbum (`ExternalImageId` = `saiu`). Não é foto nenhuma e nunca aparece num resultado.
- **Na busca:** se a marca está entre os parecidos com a selfie (na régua mais baixa, `ROSTO_LIMIAR_BUSCA`), a resposta é "você saiu" e nada aparece.
- **No indexador:** depois de indexar fotos novas, ele procura os parecidos com cada marca (`ROSTO_LIMIAR_SAIR`, abaixo da régua da busca) e os apaga. Custa uma chamada (US$ 0,001) por pessoa que saiu, em cada execução que indexou rosto. Se a execução cair antes, a dívida fica anotada no estado (`limpar`) e a seguinte limpa.
- Por que a marca fica no mesmo índice: a Rekognition só compara um rosto já indexado com outros da mesma coleção, e a busca por imagem numa foto de grupo só olha o maior rosto. Com a marca numa coleção à parte (até a 3.8.8), a foto nova de quem saiu entrava no índice.
- **No painel** (editar o projeto → *Quem saiu da busca*): a data e quantos rostos cada saída apagou. Sem foto e sem nome; o site não guarda em quais fotos a pessoa aparecia. **Desfazer** tira a marca e manda o indexador refazer o índice do álbum inteiro (uma indexação paga por foto: cerca de US$ 1 a cada 1.000 fotos). É para quando alguém tirou outra pessoa da busca.
- **Teto:** `ROSTO_SAIR_POR_DIA` saídas por dia no site. Passou, o pedido é recusado com o e-mail de privacidade e o dono recebe um alerta por dia.
- Quem saiu antes da 3.8.9 está na coleção antiga (`fotos-<slug>-sair`), que a busca ainda consulta enquanto existir a chave `rosto-sair:<slug>` no KV. Para valer nas fotos novas, a pessoa sai de novo.

## Desligar e apagar

- **Desligar no site:** desmarque a opção no projeto. Ou, para todos os projetos de uma vez, apague os secrets da AWS no Worker.
- **O que o site faz sozinho (v3.8.9):** com a opção desmarcada, o indexador para de indexar rostos na execução seguinte (o site diz a ele), e o índice é apagado 72 horas depois, pelo cron diário (`ROSTO_APAGA_APOS_DESLIGAR_H`). Religar e salvar antes disso cancela. **Excluir o projeto** apaga as duas coleções na hora. Para isso o usuário da AWS do Worker precisa da permissão `rekognition:DeleteCollection` (além de `DeleteFaces`, `IndexFaces`, `SearchFaces`, `SearchFacesByImage` e `CreateCollection`); sem ela, o `/api/healthz` acusa "índice de rostos por apagar" todo dia.
- **Parar o indexador:** apague a variável `ROSTO_SLUGS`.
- **Apagar o índice e quem saiu à mão** (AWS CloudShell, na região de São Paulo):

  ```bash
  aws rekognition delete-collection --collection-id fotos-entrenos2026 --region sa-east-1
  ```

  ```bash
  aws rekognition delete-collection --collection-id fotos-entrenos2026-sair --region sa-east-1
  ```

## Busca nas fotos e moderação (v3.7)

Além dos rostos, o indexador pede à Rekognition, **uma vez por foto**, três leituras da mesma miniatura:

| Operação | O que vira | Uso |
|---|---|---|
| `DetectText` | As palavras visíveis (só as com confiança ≥ 85%), normalizadas | Buscar "10" (camisa), "terceirão" (faixa), "PiauíFut" |
| `DetectLabels` | As "coisas" e cenas (≥ 75%), em inglês e em português (`ROTULOS_PT`); as genéricas ("person", "face") ficam de fora | Buscar "palco", "bolo", "bola", "fantasia" |
| `DetectModerationLabels` | Os rótulos de moderação (≥ 80%) das categorias de `BUSCA_MODERACAO_ESCONDE` (nudez, gestos obscenos, álcool, drogas, violência...). "Roupa de banho" e "jogos de azar" ficam de fora | Avisar o dono de foto imprópria (ele decide se oculta) |

**Como chega ao site.** O indexador manda o resultado em lotes de 90 para `POST /api/busca/indexar`, com o mesmo `ROSTO_INDEXADOR_TOKEN`, e o site grava na tabela `busca_foto` do D1 (migração `0005`). A foto que sai do álbum sai da busca na mesma execução. Sem o token, o indexador só faz os rostos. `ROSTO_DESCREVER=0` desliga as três leituras.

**A busca.** Com **Busca nas fotos (texto e coisas)** marcada no projeto, o álbum ganha o campo "Procurar nas fotos" (`GET /api/busca`).
- Acha fotos com **todos** os termos, por **palavra inteira**: "10" não acha "100".
- Deixa as ocultas de fora.
- Mostra até 120 fotos.
- É **só uma consulta ao D1**: nenhuma chamada à Amazon por visita.
- Tem o mesmo portão da busca pelo rosto: álbum público, e antes do lançamento só o dono (ou quem tem a senha de prévia).

**A moderação.** Roda sempre que o indexador passa, mesmo com a busca desligada.
- **Nada é escondido sozinho** (desde a 3.8.12). Foto com marca **nova** continua no álbum, e o dono recebe um e-mail com o link de cada uma; ele decide e toca em "Ocultar" no visualizador.
- O e-mail destaca as fotos **da turma** (autor da linha `*` dos créditos ou de uma pasta com `!`), que são as que pedem atenção primeiro. As de fotógrafo credenciado vêm marcadas como "fotógrafo".
- **Uma foto só é avisada uma vez.** O indexador não manda de novo uma foto que já foi marcada.

**Permissão nova no IAM** (já está no `~/entrenos-handoff/aws-fase5.sh`). As três operações não aceitam restrição por coleção, por isso vão num `Statement` à parte, com `"Resource": "*"`:

```json
{"Sid":"TextoCoisasModeracao","Effect":"Allow","Action":["rekognition:DetectText","rekognition:DetectLabels","rekognition:DetectModerationLabels"],"Resource":"*"}
```

**Custo.** US$ 0,001 por operação por foto, ou cerca de **US$ 9 a mais para 3.000 fotos**, uma vez só, coberto pelos créditos. As buscas dos visitantes não custam nada na Amazon.

**Melhores fotos (sorriso, olhos abertos, nitidez):** ficou para depois, a pedido do dono. Vocês já fazem a seleção; talvez valha só para as fotos da turma.

**LGPD:** ROPA, seção 14; RIPD, R10.
