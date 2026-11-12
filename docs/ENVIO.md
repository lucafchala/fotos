# Envio de fotos pelo site (v4.0.0)

A turma manda fotos e vídeos pela própria página do álbum
(`entrenos2026.com/enviar`, ou `/galeria/<slug>/enviar` no site), e tudo
termina na **pasta de envio do evento no Google Drive** — a mesma que a janela
"Mandar suas fotos" abria. O Drive continua sendo a fonte da verdade: a
galeria, o indexador de rostos e os créditos leem a pasta como sempre leram.
Estas rotas são só a IDA.

Código: `src/envio.js` (o caminho até o Drive), as rotas `/api/envio/*` em
`src/index.js`, a página em `src/ui/enviar.js`. Testes:
`tests/envio.test.js` (o protocolo contra um Google simulado) e
`npm run verifica:envio` (a página num Chromium de celular contra o Worker de
verdade).

## Como o arquivo viaja

```
celular --(partes, PUT /api/envio/parte)--> Worker --(envio retomável da Drive API)--> Drive
```

1. **Passe** — `POST /api/envio/passe { slug, form_token, turnstileToken, aceite, nome }`.
   Turnstile e a declaração (`ENVIO_DECLARACAO`), uma vez por aparelho. O
   aceite vai para `image_use_consent` (D1) com `drive_target = 'envio'`. O
   passe é uma assinatura HMAC de 12 h presa ao álbum (sem estado).
2. **Início** — `POST /api/envio/inicia { slug, passe, pasta, nome, tamanho, modificado, fp, assinatura }`.
   O servidor confere o arquivo (nome, extensão, tamanho), a pasta (tem de
   estar na lista que o **servidor** montou, `pastasDeEnvio`), pergunta ao
   Drive se já existe arquivo com aquele `fp` na pasta (se sim:
   `{ duplicada: true }`), confere o espaço livre e os tetos do dia, e abre a
   **sessão de envio retomável** no Google. Devolve a sessão **selada**
   (AES-GCM com chave derivada do `SIGNING_SECRET`): o endereço da sessão é
   uma credencial e nunca vai em claro à página.
3. **Partes** — `PUT /api/envio/parte?pos=<n>` (cabeçalho `X-Envio-Sessao`:
   o selo; corpo: os bytes). Toda parte, menos a última, em múltiplos de
   256 KiB; até 32 MiB por pedido. Os primeiros bytes da primeira parte têm de
   ser do tipo que a extensão diz (senão 415 e a sessão é cancelada). O Google
   responde até onde recebeu (308 + `Range`) — **é essa posição que vale**.
   Se a página e o Google discordam, 409 com a posição do Google.
4. **Estado** — `POST /api/envio/estado { sessao }`: onde o Google parou. É a
   pergunta de quem volta (rede caiu, página reaberta).

**Sem estado no servidor**: nenhuma escrita de KV, nenhum Durable Object novo.
O selo é o estado, e mora no IndexedDB do aparelho de quem envia. A sessão do
Google vale uma semana; o selo, 6 dias (`ENVIO_SESSAO_TTL_SECS`).

**Não duplicar** mora no Drive: cada arquivo leva em `appProperties` a
impressão digital do conteúdo (`fp`: SHA-256 do tamanho e de três amostras de
64 KiB), e o Drive responde se ela já está na pasta. Vale entre aparelhos e
entre pessoas.

**Crédito assinado**: a assinatura vai na **descrição** do arquivo
("Crédito: Nome"). A listagem (`src/drive.js`, `percorre`) só a aceita dentro
de pasta de envio, nunca com o nome de um crédito do álbum, e com teto de
`ENVIO_ASSINATURAS_POR_LISTA` nomes por lista. Dá para corrigir no próprio
Drive (painel de detalhes do arquivo → descrição).

**Sugestão de evento**: o resumo de cada capítulo guarda os dias com mais
fotos (`dd`, até `RESUMO_DIAS_MAX`). A página agrupa a seleção pelo dia da
foto (a data do EXIF; sem ela, a data do arquivo) e pré-seleciona o evento
daquele dia (o dia seguinte também conta: festa que passa da meia-noite).

## Quando o envio está ligado

`envioLigado(env)`: as três peças da credencial **e** um `SIGNING_SECRET`
válido. Sem o segredo o envio fica **desligado**, não aberto (ao contrário do
resto do site, RETOMADA §5.4): aqui o que ficaria sem proteção é a escrita no
Drive do dono.

Num álbum, a página existe quando: envio ligado, álbum público por capítulos
(`galeriaCapitulos`), que o visitante pode ver (antes do lançamento, só o dono,
a editora e quem tem a prévia), com ao menos uma pasta de envio nos créditos
(chave que começa com `!`). Com isso, o botão "Mandar suas fotos" do álbum
leva à página; a pasta do Drive vira o plano B, no fim dela. Sem isso, nada
muda: o botão abre o diálogo das pastas, como antes.

**A prévia de PR não recebe envio**: `scripts/previa-publica.mjs` não passa a
credencial do Google para a prévia, de propósito — uma prévia gravando no Drive
de produção não é prévia. E, se alguém puser os `GOOGLE_OAUTH_*` numa prévia
mesmo assim, o código recusa: `envioLigado` devolve falso quando
`AMBIENTE = "previa"` (segunda trava, com teste). O envio é testado pelo
`verifica:envio` e pela suíte.

## Configurar (o dono, uma vez)

O envio grava no Drive **em nome de uma conta Google** (a do dono do álbum).
Chave de API só lê pasta pública, e conta de serviço não tem espaço próprio
num Drive pessoal (o Google recusa com `storageQuotaExceeded`). Por isso é um
**token de atualização (refresh token)** de OAuth. Os arquivos ficam em nome
dessa conta e **ocupam o espaço dela**.

1. **Projeto e API.** No [Google Cloud Console](https://console.cloud.google.com/),
   use o projeto da chave da galeria (ou crie um) e confirme que a
   **Google Drive API** está ativada (*APIs e serviços → Biblioteca*).
2. **Tela de consentimento OAuth.** *APIs e serviços → Tela de consentimento
   OAuth* (ou *Google Auth Platform → Branding/Público*): tipo **Externo**,
   nome do app, e-mail de suporte. Em **Público**, **publique o app ("Em
   produção")**. Enquanto o app estiver em **"Teste"**, o Google faz o token
   de atualização **vencer em 7 dias** — o envio pararia sozinho uma semana
   depois (o `/api/healthz` mostraria `envio.estado = "falha"`). Um app em
   produção sem verificação mostra um aviso de "app não verificado" no passo
   4; para a conta do próprio dono, é só seguir ("Avançado → Acessar").
3. **Credencial.** *APIs e serviços → Credenciais → Criar credenciais → ID do
   cliente OAuth*, tipo **Aplicativo da Web**. Em *URIs de redirecionamento
   autorizados*, acrescente `https://developers.google.com/oauthplayground`.
   Guarde o **ID do cliente** e a **chave secreta do cliente**.
4. **Token de atualização.** Abra o
   [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/):
   engrenagem (canto superior direito) → marque **Use your own OAuth
   credentials** → cole o ID e a chave do passo 3. No passo 1 do Playground,
   digite o escopo `https://www.googleapis.com/auth/drive` → *Authorize APIs*
   → entre com a **conta dona da pasta do álbum** → permita. No passo 2,
   *Exchange authorization code for tokens* → copie o **Refresh token**.
   - Por que `drive` (acesso amplo) e não `drive.file`: com `drive.file` o app
     só enxerga o que ele mesmo criou, e a pasta de envio do evento foi criada
     pelo dono, no Drive. Gravar dentro dela exige enxergá-la.
     *(Não testado contra o Google de verdade nesta sessão: se `drive.file`
     funcionar para gravar na pasta, prefira-o.)*
5. **Os segredos no Worker:**
   ```
   npx wrangler secret put GOOGLE_OAUTH_CLIENT_ID
   npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
   npx wrangler secret put GOOGLE_OAUTH_REFRESH_TOKEN
   ```
   (`SIGNING_SECRET` já existe em produção.)
6. **Conferir:** `GET /api/healthz` → `config.envio: true` e
   `envio.estado: "ok"`, com `envio.livreGb` = o espaço livre da conta. A
   página `entrenos2026.com/enviar` passa a existir, e o botão do álbum leva a
   ela. Mande uma foto de teste e confira no Drive: o arquivo na pasta do
   evento, com a descrição "Enviado pelo site do álbum." e as `appProperties`.

**Revogar:** em <https://myaccount.google.com/permissions>, remova o app — o
envio para na hora (`envio.estado: "falha"`), e "Mandar suas fotos" volta a
abrir o Drive quando os três segredos forem apagados
(`npx wrangler secret delete …`).

## Limites e proteções

| O quê | Valor | Onde |
| --- | --- | --- |
| Arquivo | até 5 GB; só foto e vídeo (`ENVIO_TIPOS`), extensão **e** primeiros bytes | `ENVIO_MAX_BYTES`, `bytesConferem` |
| Parte | múltiplo de 256 KiB (menos a última), até 32 MiB por pedido; a página usa de 1 a 16 MiB, adaptativa | `ENVIO_PARTE_*` |
| Por IP | 600 passes/h, 30 mil arquivos/h, 200 mil partes/h — largo de propósito: a turma divide o Wi-Fi da festa | `ENVIO_*_IP_BUCKET` |
| Por álbum, por dia | 40 mil arquivos e 200 GB | `ENVIO_TETO_*_DIA` (contador atômico; sem ele, falha aberta e fica no healthz) |
| Espaço | recusa abaixo de 2 GB livres; o healthz avisa abaixo de 10 GB | `ENVIO_MARGEM_DRIVE_BYTES`, `ENVIO_AVISO_DRIVE_BYTES` |
| Assinatura | 2 a 40 caracteres, letras/números/espaço/ponto/apóstrofo/hífen, começa por letra | `limpaAssinatura` |

Respostas de erro carregam um `codigo` estável (`passe`, `tipo`, `tamanho`,
`teto`, `cheio`, `sessao`, `pos`, `ocupado`, `desligado`, `credencial`,
`pasta`); o texto do Google nunca vai à página, só ao log (sem nome de arquivo
nem de pasta).

## O que a página faz (e o que não consegue)

- Muitos arquivos de uma vez (`<input type="file" multiple>`), três em
  paralelo, sem ler nenhum inteiro para a memória (`file.slice()`).
- Qualidade original: os bytes que o navegador entrega são os que sobem.
- Rede ruim: a parte encolhe quando falha e cresce quando vai bem; toda
  repetição tem teto; a fila acorda sozinha quando a rede ou a aba voltam.
- Recusa do **passe** (página aberta tempo demais, verificação que não passou)
  para tudo e mostra a frase do servidor; "Tentar de novo" pede outro passe.
- Tela acesa durante o envio (Wake Lock). **Enviar com a página fechada não
  existe na web do iPhone**; ao voltar, é só escolher as mesmas fotos de novo
  e cada uma segue de onde parou.
- **O que está fora do alcance de uma página** (e não foi verificado): o que o
  sistema entrega do seletor de fotos — o iPhone pode converter HEIC em JPEG e
  manda só a foto parada de um Live Photo.
- **Localização**: o arquivo sobe como está, com os metadados que o aparelho
  gravou (inclusive a localização, se houver). A galeria não lê a localização,
  mas quem baixa no "tamanho máximo" recebe o arquivo original. É o mesmo de
  quem envia pela pasta do Drive; a Política de Privacidade diz isso a quem
  envia.

## Healthz

`/api/healthz` ganha `config.envio` (booleano: envio ligado) e
`envio.{estado,livreGb}`:

- `desligado`: sem credencial (o álbum segue mandando pela pasta do Drive);
- `ok`: o Google emitiu um token agora (ou há um válido guardado);
- `falha`: o Google **recusou** a credencial (token vencido ou revogado),
  falta o `SIGNING_SECRET`, ou o Drive está abaixo da margem — vai para
  `problemas`;
- `incerto`: o Google não respondeu a tempo. Não é "ok" e não é defeito nosso.

O contrato segue em 1 (só acréscimo; `docs/healthz-contrato.json`). O
**status.lucafchala.com** pode ler `envio.estado` numa linha própria — a
mudança correspondente é lá, e o teste de contrato de lá lê o
`docs/healthz-contrato.json` da `main` daqui: este PR entra **antes** do de lá.
