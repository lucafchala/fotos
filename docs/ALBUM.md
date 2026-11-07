# Apresentação de álbum, lançamento e destaque

Este guia cobre o álbum com página especial (o da Turma 2026, em `entrenos2026.com`): como funciona, como lançar e o que ainda falta. A versão é a 3.4.0; o código está em `src/ui/album.js`, `src/ui/destaque.js`, `src/ui/em-breve.js` e `src/pix.js`. A busca pelo rosto tem guia próprio, em [`ROSTO.md`](./ROSTO.md).

## O que o álbum tem

Com **Texto de abertura** preenchido, o índice da galeria por capítulos (`/galeria/<slug>`) vira a página especial do álbum. Sem o texto, fica o índice simples de sempre.

| Peça | De onde vem |
|---|---|
| Primeira tela | **Estilo da abertura**: mosaico (padrão), tela cheia, recordação ou linha do tempo |
| Fotos da abertura | **Fotos de capa** do projeto, completadas pela capa de cada evento |
| Selo acima do título | `DOMINIOS_DE_ALBUM[...].linha` ("Turma 2026 · Colégio Santa Cruz") ou o ano |
| Linha do tempo | Os capítulos, com o período das fotos (`ResumoCap.p`, pelas datas de captura) |
| Quem fotografou | A soma de `ResumoCap.a` (fotos por autor); só aparece quando todos os capítulos têm resumo |
| Recado final | Campo **Recado final** |
| Apoie o projeto | Campos **Pix para apoio** (chave, nome, cidade): QR e "copia e cola", BR Code estático |
| Mandar suas fotos | Com pasta de envio nos créditos (nome começando com `!`): a janela que leva à pasta certa (ver abaixo). Sem ela, o botão abre a pasta do álbum |
| Dica de envio | "Toque em Mandar suas fotos e escolha o evento", com pasta de envio; a dica antiga, com a pasta `outros` |

**Visual**
- **Fundo e cores:** fundo escuro, com o amarelo `#F9DE4B` e o azul `#243580` do site do Colégio Santa Cruz.
- **Fontes:** **Open Sans** nos títulos e textos. É a fonte reserva do site da escola e, medida letra por letra, a livre mais parecida com a Xenois Sans, a oficial, que é comercial e com licença do colégio. A **Caveat** fica nas legendas das polaroids.
- **Como chegam:** as fontes são servidas pelo próprio site (`/fonts/`, SIL OFL 1.1).
- **Para usar a fonte oficial:** comprar a licença web da Xenois Sans (Linotype/MyFonts), pôr os WOFF2 em `fonts/` e rodar `npm run build:fonts`.

## Domínio próprio (`entrenos2026.com`)

- **Onde se configura:** em `DOMINIOS_DE_ALBUM` (`src/config.js`). O domínio é um Custom Domain do Worker `fotos`, ligado no painel da Cloudflare, e fica fora do `wrangler.toml`.
- **A raiz:**
  - leva à galeria do álbum quando ele está **lançado**;
  - antes disso, mostra a página **"em breve"** (`emBreveHTML`).
- **`www.`:** redireciona com 301 para o domínio sem `www.`.
- **`/dashboard`:** volta para `fotos.lucafchala.com`.
- **O endereço principal do álbum é o domínio:**
  - o canonical, o cartão de link e o QR usam entrenos2026.com;
  - o `robots.txt` do domínio anuncia o sitemap do álbum;
  - os sitemaps de `fotos.lucafchala.com` deixam essa galeria de fora.
- **Rotas próprias:**
  - `/icon-entrenos.svg`, o favicon "EN";
  - `/og-entrenos.jpg`, o cartão de link de 1200×630, sem foto de ninguém. Ele é gerado por `node scripts/og/gera-og-entrenos.mjs` a partir de `scripts/og/entrenos.html`.
- **Página temporária:** antes do merge, o domínio aponta para o Worker temporário `entrenos-em-breve`, com a mesma página "em breve" colada à mão pelo Cowork. Depois do merge, o Custom Domain passa para o Worker `fotos` (Fase 4 do prompt do Cowork), e o Worker temporário pode ser apagado.

## Lançamento: nada é público antes do OK do dono

Um álbum está **lançado** (`albumLancado`, em `src/utils.js`) quando está **visível** e **fora do "Em breve"**.

| | Antes do lançamento | Depois |
|---|---|---|
| entrenos2026.com | Página "em breve" | A galeria |
| `/galeria/entrenos2026` | 404 para o público; o dono, logado, vê tudo | Pública |
| Busca pelo rosto | Só o dono, logado, testa (`buscaRostoAtiva(env, ev, dono)`) | Para todos, se a opção estiver marcada |
| Destaque no site (faixa, cartão, popup, outros sites) | Nada | Aparece, se **Destaque máximo no site** estiver marcado |
| Indexador da Amazon | Lê o álbum fechado com `ROSTO_INDEXADOR_TOKEN` | Igual |

> **Cuidado:** "oculto" sozinho (`visible: false`) quer dizer só **não listado**, e quem tem o link da galeria entra. O que fecha o álbum para o público é o **"Em breve"**.

| Página do projeto (`/entrenos2026`) | 404 para o público (`albumSurpresa`, só álbum com domínio próprio); o dono, logado, vê | Pública |
| Data marcada | Nunca aparece em página ou API pública, a não ser com **Mostrar contagem regressiva** ligado | — |

### Como lançar (v3.5)

**O álbum é surpresa até a hora.** Antes do lançamento, nada pode revelá-lo fora do entrenos2026.com, que só mostra o "em breve" com `noindex`.

**Jeito 1: na hora, com um clique.** No painel, no menu ⋯ do projeto, toque em **Lançar agora…**. O item só aparece em projeto oculto ou "Em breve".
- A confirmação pede para digitar **LANÇAR**.
- Num passo só, o projeto sai do "Em breve", fica visível e fixado. Só esses campos mudam (`PUT` parcial).

**Jeito 2: com dia e hora marcados.** No formulário do projeto, em "Acesso e LGPD", preencha **Lançamento marcado**, no horário do aparelho, e salve. O painel mostra o selo "Lança 20/11, 20:00".
- **Na hora, sozinho:** o projeto passa a valer como lançado em todo o site ao mesmo tempo (galeria, domínio, destaque nos outros sites, sitemap). A troca acontece na leitura (`comLancamentos`, dentro de `getEvents`), e não numa tarefa agendada que poderia atrasar ou falhar.
- **Depois da hora:** a próxima gravação pelo painel torna a troca permanente.
- **Data no passado:** o painel e o servidor recusam, para não lançar por engano; para lançar já, use o Jeito 1.
- **Data longe demais:** mais de `LANCAMENTO_MAX_DIAS` (400 dias) é descartada.
- **Backup restaurado nunca lança:** uma data vencida vira "sem lançamento marcado".
- **Painel aberto desde antes da hora:** se alguém salvar esse formulário antigo depois do lançamento, o servidor mantém o álbum lançado, em vez de devolvê-lo ao "Em breve" (`normalizaLancamento`).

**Contagem regressiva (opcional, desligada por padrão).** Com **Mostrar contagem regressiva** ligado e uma data marcada, a página "em breve" do domínio mostra "Chega em 20 de novembro, às 20h" e a contagem.
- **Revela a data a quem abrir o endereço.** Sem o interruptor, a página não diz quando.
- O script tem nonce, a página vai sem cache, e na hora ela recarrega e cai na galeria.

**O lançamento NÃO faz sozinho**, e continua na Fase 7 do Cowork:
- **Busca pelo rosto:** vale o que estiver marcado. Se a turma ainda não foi avisada, desmarque antes da hora.
- **Monitoramento do domínio no status:** mergear o lucafchala/status.lucafchala.com#67, que está em rascunho.
- **Mensagem da turma.**

## Destaque máximo no site

Com **Destaque máximo no site** marcado e o álbum lançado, aparecem (`src/ui/destaque.js`):
- a faixa azul no topo da home e das páginas dos outros projetos;
- o cartão grande no começo da home;
- o popup da primeira visita, uma vez por aparelho, lembrado só no `localStorage`.

Se houver mais de um álbum marcado, vale o fixado.

### Aviso nos outros sites

O aviso aparece em **todos os sites do ecossistema**, de dois jeitos.

**1. O script do fotos** (sites sem dado sensível e com CSP que aceita). Cada página inclui:

```html
<script src="https://fotos.lucafchala.com/destaque.js" async></script>
```

- O script pergunta a `GET /api/destaque` (CORS aberto). Se houver álbum lançado, desenha a faixa num shadow root fechado, sem `innerHTML` e sem cookie.
- O × esconde a faixa por 3 dias (`localStorage`, chave `lfc-destaque-fechado:<slug>`).
- Se o site tiver CSP, `https://fotos.lucafchala.com` entra em `script-src` e em `connect-src`. O `style-src` precisa de `'unsafe-inline'`, porque o estilo vai num `<style>` dentro do shadow root.
- No próprio fotos e nos domínios de álbum, o script não faz nada (a página já tem a faixa dela).

**2. Posto pelo servidor, sem script na página** (sites de CSP rígida ou com dado sensível):
- o servidor do site pergunta ao fotos (`/api/destaque`, com cache de 5 min na borda e 1 min depois de uma falha);
- confere a resposta: só passam título, selo e um link `https:` de álbum conhecido (`HOSTS_DE_ALBUM`), tudo escapado;
- põe a faixa no HTML, com um `/destaque.css` da própria origem; a CSP não muda;
- se o fotos estiver fora, a página sai intacta;
- o × é um checkbox com CSS: esconde naquela visita, e a faixa volta na próxima;
- a lógica é uma **cópia idêntica** em cada site (`functions/_lib/destaque-servidor.js`; no rg, colada no `_worker.js`): mudou num, mude em todos.

| Site | Jeito | PR | Observação |
|---|---|---|---|
| fotos.lucafchala.com | Próprio (faixa, cartão e popup) | #277, no ar | `src/ui/destaque.js` |
| lucafchala.com | Script | lucafchala/lucafchala.com#44 | `connect-src https://*.lucafchala.com` já cobre a API |
| paste.lucafchala.com | Script | lucafchala/paste.lucafchala.com#16 | Páginas **geradas pelo dash** |
| url.lucafchala.com | Script | lucafchala/url.lucafchala.com#16 | Páginas **geradas pelo dash** (índice e `404.html`) |
| dash.lucafchala.com | Geradores do paste e do url | lucafchala/dash.lucafchala.com#37 | O painel em si **não** mostra o aviso: guarda o token do GitHub |
| radio.lucafchala.com | Script, nas 7 páginas | lucafchala/portal_radio#19 | Rolagem lateral no celular, de antes do aviso: lucafchala/portal_radio#20 |
| treino.lucafchala.com | Script | lucafchala/treino.lucafchala.com#1 | Sem CSP |
| spectral-drift.lucafchala.com | Script | lucafchala/spectral-drift#4 | Sem CSP |
| restricted.lucafchala.com | Script | lucafchala/restricted#9 | Fora do desafio do CTF (o README avisa) |
| status.lucafchala.com | Servidor (`functions/api/destaque.js`) e desenho pelo `app.js` | lucafchala/status.lucafchala.com#66 | CSP `'self'` sem exceção |
| keys.lucafchala.com | Servidor (`functions/_middleware.js`) | lucafchala/keys.lucafchala.com#7 | A página mostra impressões digitais de chaves |
| pays.lucafchala.com | Servidor (`functions/_middleware.js`) | lucafchala/pays.lucafchala.com#6 | Assinaturas no `localStorage` |
| proof.lucafchala.com | Servidor (`functions/_middleware.js`) | lucafchala/proof.lucafchala.com#10 | Continua **sem JavaScript nenhum** |
| rg.lucafchala.com | Servidor (`_worker.js`), só na tela do PIN | lucafchala/rg.lucafchala.com#2 | Impressão e guias ficam de fora |

**Fora, de propósito:**
- `bia.lucafchala.com` é a página da Beatriz: fica de fora (decisão do dono, 07/11/2026).
- `Edificio-maison-blanche` não está no ar em nenhum endereço conhecido.
- Os repositórios sem site (hangman, a-calculadora, Alemanha-2026, OMG.LOL_transfer) ficam de fora.

**Ordem de merge:** qualquer uma. Antes do lançamento, o fotos responde `{"ativo":false}` e nenhum site mostra nada; `/destaque.js` e `/api/destaque` já estão no ar desde o #277.

**Para conferir depois do lançamento:**
- **Sites com o script:** abrir a página; a faixa aparece no topo.
- **Sites pelo servidor:** `curl -s https://<site>/ | grep -c lfc-dq` dá `1` (antes do lançamento, `0`). No status, `curl -s https://status.lucafchala.com/api/destaque`.

**Domínio novo de álbum** (`DOMINIOS_DE_ALBUM`) precisa entrar também:
- em `HOSTS_DE_ALBUM` nos 5 sites da versão pelo servidor (status, keys, pays, proof, rg); senão, a faixa some calada neles;
- o `DESTAQUE_EMBED_JS` já lê a lista de domínios sozinho, então o script não precisa de mudança.

**O álbum é surpresa até o lançamento.** Antes do "pode lançar", nada pode revelar o álbum fora do entrenos2026.com (que mostra só o "em breve", com `noindex`). Por isso o monitoramento do domínio no status ficou num PR à parte, em rascunho, para mergear **no dia do lançamento**: lucafchala/status.lucafchala.com#67. Com ele, aparece uma linha "Entre Nós" no status e uma bolinha na home do lucafchala.com (via `/api/resumo`).

**Contrato com o status (depois do #67):** o serviço "Entre Nós" do status.lucafchala.com sonda `https://entrenos2026.com` e procura o texto **"Entre Nós"**, que tem de existir na página "em breve" e no álbum. Mudar o título do álbum ou do "em breve" sem trocar o marcador lá deixa o status amarelo.

## Apoie o projeto (Pix)

- **Formato:** BR Code estático (EMV MPM), sem valor e sem intermediário, gerado por `src/pix.js`. O CRC16 é conferido contra o exemplo do manual do Banco Central (`1D3D`).
- **A chave aparece na página**, por isso **CPF é recusado**. As aceitas são chave aleatória (recomendada), e-mail, telefone `+55…` e CNPJ.
- **Quando aparece:** só em álbum público e com chave, nome e cidade preenchidos.
- **Privacidade:** o site não fica sabendo quem doou.

## Pasta do Drive do álbum

- **Raiz:** "Qualquer pessoa com o link: **Leitor**". O dono e a Mag são editores; editores não podem mudar o compartilhamento.
- **Em cada evento** (e em cada ano ou banda dentro dele) há cinco pastas:

  | Pasta | Fotos de | Crédito | Acesso |
  |---|---|---|---|
  | `chala` | Luca | `chala = Luca F. Chala` | Leitor |
  | `mag` | Mag | `mag = Mag <e-mail, só no painel>` | Leitor |
  | `santa oficial` | Fotos oficiais do colégio | `santa oficial = Colégio Santa Cruz` | Leitor |
  | `comissao` | Comissão de Festas | `comissao = Comissão de Festas` | Leitor |
  | `!turma 2026 (adicione suas fotos aqui)` | A turma | `!turma 2026 (adicione suas fotos aqui) = Turma 2026` | **Editor** para quem tem o link (são 20) |

  A foto fora dessas pastas recebe `* = Turma 2026`. A pasta da turma se chamava `outros` até 06/11/2026; o `!` a põe no topo da lista do Drive e a marca como **pasta de envio**.
- O e-mail da Mag fica **só no painel**. Nunca vai para código, testes, documentação ou commits.

## Fotos que já moram em outra pasta: atalhos (v3.6)

As fotos dos eventos da escola já estão em `!Escola - eventos`, que **outros projetos publicados usam** (Dia do Gala, FNUSC…). Mover quebraria essas galerias, e copiar duplicaria o espaço. Por isso o álbum usa **atalhos do Drive**.

**Como pôr as fotos de um evento:**
1. Na pasta de origem (por exemplo `!Escola - eventos/Amarelinhos/Amarelinhos - Fotos`), clique com o botão direito → **Organizar → Adicionar atalho**.
2. Escolha a pasta do fotógrafo no álbum: `Entre Nós/Amarelinhos/chala`, ou `Entre Nós/Festa Junina/2025/chala` nos eventos com ano.
3. No painel, toque em **Atualizar agora** no projeto, ou espere a atualização automática.

**O que o site faz com o atalho** (`percorre`, em `src/drive.js`):
- **Transparente:** as fotos da pasta de destino entram como se estivessem dentro de `chala`, com o crédito de Luca.
- **Subpastas do destino** viram seções do evento, como sempre (até dois níveis).
- **Pasta de destino sem acesso público:** é pulada, e o dono vê "Um atalho desta pasta aponta para uma pasta que o site não consegue abrir". O conserto é compartilhar o destino como "Qualquer pessoa com o link: Leitor". As pastas dos projetos publicados já estão assim.
- **Atalho de arquivo** não entra (a listagem não traz as medidas da foto); só **atalho de pasta**.
- **A mesma pasta nunca é lida duas vezes** (atalho repetido ou em ciclo).
- **Download e "para redes"** funcionam igual: o arquivo é o da pasta de destino.

**Qual versão usar:** o atalho pode apontar para as fotos em tamanho cheio ou para as "reduzidas". A galeria mostra as miniaturas do Drive nos dois casos; a diferença está no download, onde o tamanho cheio é o arquivo original.

## Pastas grandes: Workers Paid (v3.6)

- **No plano grátis**, cada página tem 50 leituras externas. Um evento com muitas pastas, como Festa Junina (5 anos × 5 fotógrafos = 31 pastas), sai como "Lista parcial".
- **Com o Workers Paid (US$ 5/mês)**, o limite sobe muito. Depois de assinar, um PR de uma linha troca `WORKERS_PLANO = "gratis"` para `"pago"` no `wrangler.toml`. Os tetos `GALERIA_*_PAGO` (`src/config.js`) passam a valer: 120 leituras e 200 pastas por capítulo.
- **Nunca troque antes de assinar:** no plano grátis, a galeria quebraria.

## Mandar suas fotos (v3.4)

- **Pasta de envio** é a pasta de crédito cujo nome começa com `!` (`chavesDeEnvio`, em `src/drive.js`).
- **A janela:** o botão **Mandar suas fotos** abre uma janela com os eventos, na ordem da linha do tempo. Se o evento tem mais de uma pasta de envio (uma por ano ou por banda), ela pergunta qual. A opção abre a pasta no Drive, e a janela explica: entrar com a conta Google e tocar em **+ → Fazer upload**.
- **Sem JavaScript, ou se a lista falhar:** o botão continua um link para a pasta do álbum, e a janela mostra "Abrir a pasta do álbum".
- **Como a lista é montada** (`pastasDeEnvio`):
  - para cada evento, lê as subpastas (só pastas);
  - a pasta de envio direto no evento vale para o evento inteiro;
  - as outras subpastas que **não** são de fotógrafo (ano, banda) são abertas uma vez, à procura da pasta de envio dentro delas; o número de ordem do nome some ("03 - Banda X" vira "Banda X");
  - as pastas de fotógrafo (as outras linhas dos créditos) nunca são abertas;
  - no máximo 40 chamadas ao Drive por leitura (o teto do plano grátis é 50); evento que falha não derruba os outros.
- **Cache:** 6 horas, na memória e na Cache API. A chave muda com a lista de eventos e com os créditos; por isso **evento novo aparece na hora**. Leitura incompleta (teto ou falha) fica só 10 minutos.
- **Rota:** `GET /api/galeria/envio?slug=` devolve `{ pastas: [{ evento, cap, rotulo, url }] }`. Vale só para álbum público por capítulos, com o mesmo portão da galeria: antes do lançamento, só o dono, logado. Os links são das pastas que a pasta pública do álbum já mostra a quem tem o link.

## Adicionar um evento

1. **Criar a pasta do evento** dentro da raiz do álbum. O nome vira o nome do evento no site; um número no começo ("12 - Viagem") ordena e some da tela.
2. **Criar dentro dela as cinco pastas**: `chala`, `mag`, `santa oficial`, `comissao` e `!turma 2026 (adicione suas fotos aqui)`. Se o evento tem anos ou bandas, crie uma pasta para cada um e as cinco dentro de cada. O conector do Drive desta sessão cria pastas; o compartilhamento não.
3. **Abrir a pasta `!turma…` do evento como Editor:** Compartilhar → "Qualquer pessoa com o link: **Editor**", com "Editores podem mudar permissões" desmarcado. As outras herdam "Leitor" da raiz. Esta parte é do dono ou do Cowork.
4. **No painel, tocar "Atualizar agora"** no projeto. O evento entra na linha do tempo, e a janela "Mandar suas fotos" já o mostra, sem esperar o cache.
5. **Busca pelo rosto:** o indexador (workflow `rosto`, a cada 30 minutos) acha as fotos novas sozinho.

Os créditos não mudam: as mesmas seis linhas valem para todos os eventos.

## O que falta (estado em 06/11/2026, noite)

1. **Drive:** pronto. A raiz é "Leitor"; as 20 pastas da turma estão como Editor e renomeadas para `!turma 2026 (adicione suas fotos aqui)`; as pastas `santa oficial` e `comissao` existem nos 20 lugares.
2. **Merges**, nesta ordem, todos com "Create a merge commit": #264 e #274 (feitos, 3.1.0 no ar) → #275 → #277 → #278 → o PR da 3.4.0. Depois, conferir o deploy e rodar `~/entrenos-handoff/criar-releases.sh`, que cria as Releases (criar Release daqui foi bloqueado pelo sistema de permissões).
3. **Fase 4 do prompt do Cowork:** criar o projeto `entrenos2026` em "Em breve" e não visível, com os créditos de 6 linhas, o estilo Mosaico e o recado; testar com mídia real (inclusive a janela "Mandar suas fotos", logado); passar o domínio para o Worker `fotos`.
4. **Fase 5:** conta da AWS (permissão nova `rekognition:SearchFaces`), pedido de cota, `ROSTO_INDEXADOR_TOKEN` no Worker e no GitHub, e rodar o indexador.
5. **Fase 6:** o dono testa a busca pelo rosto, logado.
6. **Fase 7:** lançar, só com o "pode lançar" do dono.
7. **Pendências que dependem do dono:**
   - mergear os PRs do aviso nos outros sites (lucafchala.com#44, dash#37, paste#16, url#16);
   - preencher o Pix no painel;
   - autorizar o Search Console do domínio;
   - decidir sobre o Workers Paid (US$ 5/mês) para o mês do lançamento.

Os prompts do Cowork, as respostas dadas a ele e as imagens de comparação estão em `~/entrenos-handoff/`, fora do repositório, porque têm o e-mail da Mag.
