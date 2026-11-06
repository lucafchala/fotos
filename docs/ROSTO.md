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

7. **Montar o índice:** Actions → rosto → Run workflow. A primeira execução indexa o álbum inteiro: cerca de 4 fotos por segundo, ou uns 15 minutos para 3.000 fotos. Depois, o workflow roda sozinho a cada 30 minutos e pega as fotos novas.

8. **Ligar no projeto:** no painel, edite o projeto e marque **Busca pelo rosto**. O botão **Procurar meu rosto** aparece no índice da galeria.

## Como funciona

- **Busca** (`POST /api/rosto/buscar`):
  - a selfie é reduzida no navegador (640 px, JPEG);
  - antes da AWS, o site confere o aceite, o token do formulário, o teto por IP e o Turnstile;
  - a primeira chamada pergunta à coleção `fotos-<slug>-sair` se a pessoa saiu da busca. Só existe depois que alguém sai (marca `rosto-sair:<slug>` no KV);
  - a segunda procura em `fotos-<slug>`, com semelhança mínima de 90%;
  - até 2 sementes (achados com 98% ou mais, de fotos diferentes) procuram os rostos parecidos com elas (`SearchFaces`, 92%). O que acham entra com a semelhança multiplicada pela da semente, abaixo dos achados diretos;
  - o resultado sai sem as fotos ocultas.
- **Sair** (`POST /api/rosto/sair`):
  - o rosto vai para `fotos-<slug>-sair`, guardado com o consentimento da pessoa e só para isso;
  - todo rosto com 85% de semelhança ou mais é apagado do índice do álbum.
- **Indexador** (`scripts/rosto-indexa.mjs`):
  - lê as páginas públicas do álbum, ou seja, a mesma lista que o visitante vê;
  - indexa a foto de 2400 px das fotos novas (1600 px se passar de 5 MB), até 100 rostos por foto, com o filtro de qualidade LOW para não perder rosto pequeno em foto de grupo;
  - apaga os rostos das fotos que saíram do álbum;
  - guarda o estado no cache do Actions. Se o cache se perder, o pior caso é reprocessar o álbum.
- **Só nos álbuns certos:** o botão só aparece no índice da galeria por capítulos, em álbum público. Antes do lançamento ([`ALBUM.md`](./ALBUM.md)), só o dono, logado, vê e testa.
- **Sem as chaves no Worker:** as rotas respondem 404.

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

## Desligar e apagar

- **Desligar no site:** desmarque a opção no projeto. Ou, para todos os projetos de uma vez, apague os secrets da AWS no Worker.
- **Parar o indexador:** apague a variável `ROSTO_SLUGS`.
- **Apagar o índice e quem saiu** (AWS CloudShell, na região de São Paulo):

  ```bash
  aws rekognition delete-collection --collection-id fotos-entrenos2026 --region sa-east-1
  ```

  ```bash
  aws rekognition delete-collection --collection-id fotos-entrenos2026-sair --region sa-east-1
  ```
