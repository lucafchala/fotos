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

### Links curtos (v3.8.3)
- O evento mora em `entrenos2026.com/<evento>`; `entrenos2026.com/galeria/entrenos2026/<evento>` leva a ele (301), com a query e o `#foto=` junto.
- Uma palavra só no caminho que não seja rota do site (`RESERVED_SLUGS`) vira evento; se não existir, a galeria responde 404 como antes.
- No fotos.lucafchala.com nada muda: `/galeria/entrenos2026/<evento>`.

### Link de uma foto (v3.9.0)

Um formato só para o site inteiro: `entrenos2026.com/<evento>?foto=<código>` (o código são os 10 primeiros caracteres do ID da foto no Drive; o ID inteiro também vale). Quem monta é `enderecoDaFoto()` em `src/utils.js` (servidor) e `enderecoDaFoto` dentro do script da galeria (navegador). O servidor lê o `?foto=` e o cartão do WhatsApp mostra a própria foto (`fotoDaLista()` em `src/ui/galeria.js`); foto oculta nunca vira cartão. O `#foto=` antigo continua abrindo.

### Ajuda e cartão para os stories (v3.9.0)

- **Ajuda:** `/ajuda` e `/ajuda/<tema>` no domínio do álbum (`/galeria/<slug>/ajuda` no site). O texto mora só em `src/ui/ajuda.js` (`TEMAS_DE_AJUDA`); mudou um botão ou um comportamento, muda lá. O tema *Apoiar* só aparece com Pix cadastrado.
- **Cartão "minhas fotos":** montado no celular (canvas), com as miniaturas assinadas do próprio site. Nada vai ao servidor.

### Fotos pelo próprio site e o R2 (v3.8.3)
- As páginas pedem `/f/<id>/<largura>?k=<álbum>.<assinatura>`; o site busca no Google uma vez e guarda no cache da Cloudflare e no navegador por 4 horas (`FOTO_CACHE_S`; era uma semana até a 3.8.7).
- **Só fotos de álbum do site (v3.8.8).** O `k` é a assinatura do site para aquela foto naquele álbum (`assinadorDeFotos`, em `src/foto-rota.js`); só as páginas a emitem. Antes de buscar qualquer coisa, a rota confere a assinatura, se o público pode ver o álbum (a regra única, abaixo) e se a foto não está oculta. Fora disso responde 404. Endereço antigo, sem `k`, não funciona mais.
- **Foto oculta ou removida:** ocultar, "Remover da galeria" e apagar no Drive apagam as cópias da foto no R2. Quem já tinha a foto aberta deixa de vê-la em até 4 horas.
- **R2:** com o bucket ligado no `wrangler.toml` (binding `FOTOS_R2`), a miniatura e o original vão para o R2 na primeira vez que alguém os pede e daí em diante saem de lá. Chaves: `w/<id>/<largura>.webp|jpg` e `o/<id>`. Para ligar: criar o bucket no painel da Cloudflare e acrescentar o binding (PR pequeno).

### Quem abre pelo navegador de dentro de um app (v3.11.0)
- Link aberto no Instagram, no Facebook, no TikTok (e em outros apps com navegador próprio) cai no navegador do app, onde baixar e os avisos falham sem dizer nada.
- Ao tocar em baixar ou em "Avisar quando chegar foto nova", o álbum mostra uma faixa: no iPhone, "toque nos três pontinhos e escolha Abrir no navegador"; no Android, o botão **Abrir no Chrome**; nos dois, **Copiar o link**. Não impede a ação e, fechada, não volta naquela aba.
- "Abrir no Chrome" aparece só nos apps conhecidos (Instagram, Facebook, TikTok, Snapchat, LinkedIn, LINE); num app qualquer, só "Copiar o link". Sem o Chrome instalado, o botão volta para a mesma página.
- No lugar do botão de avisos (que o navegador de um app não suporta), o álbum diz para abrir no navegador do celular.
- O WhatsApp não mostra a faixa: ele abre o link no navegador de verdade. Detalhes em `src/ui/navegador-embutido.js`.

### Aviso de fotos novas no celular (v3.8.4)
- O botão "Avisar quando chegar foto nova" fica na abertura. No Android e no computador funciona direto; no iPhone, só com o álbum adicionado à Tela de Início (o botão explica).
- Quando o indexador manda fotos que ainda não estavam no álbum, o cron avisa quem ligou, no máximo uma vez a cada 3 h por álbum: "12 fotos novas em PiauiFut e Gala. Toque para ver."
- Nada a configurar: a chave do site nasce sozinha. Detalhes em `src/aviso.js`.

## Lançamento: nada é público antes do OK do dono

Um álbum está **lançado** (`albumLancado`, em `src/utils.js`) quando está **visível** e **fora do "Em breve"**.

Desde a 3.8.8 há **uma regra só** para "o público pode ver este álbum?" (`albumAbertoAoPublico`, em `src/utils.js`), usada pela galeria, pela raiz do domínio, pela home, pelo `/api/recentes`, pelos sitemaps, pelo portão do Drive e pelas fotos (`/f/`). Para o álbum com domínio próprio, **qualquer um dos dois** interruptores fecha: "Em breve" marcado, ou "Visível" desmarcado.

| | Antes do lançamento | Depois |
|---|---|---|
| entrenos2026.com | Página "em breve" | A galeria |
| `/galeria/entrenos2026` | 404 para o público; o dono, logado, vê tudo | Pública |
| As fotos (`/f/…`) | 404 para o público, mesmo com o endereço completo; o dono, a editora e quem tem a senha da prévia veem | Públicas |
| Busca pelo rosto | Só o dono, logado, e quem tem a senha da prévia testam (`buscaRostoAtiva(env, ev, dono)`) | Para todos, se a opção estiver marcada |
| Destaque no site (faixa, cartão, popup, outros sites) | Nada | Aparece, se **Destaque máximo no site** estiver marcado |
| Indexador da Amazon | Lê o álbum fechado com `ROSTO_INDEXADOR_TOKEN` | Igual |

> **Projeto comum (sem domínio próprio):** "oculto" sozinho (`visible: false`) quer dizer só **não listado**, e quem tem o link da galeria entra; o que fecha as fotos é o **"Em breve"**. Para o álbum com domínio próprio isso mudou na 3.8.8: oculto também fecha (até a 3.8.7, oculto e com "Em breve" desmarcado, ele abria inteiro em `/galeria/<slug>` enquanto a raiz do domínio dizia "em breve").

| Página do projeto (`/entrenos2026`) | 404 para o público (`albumSurpresa`, só álbum com domínio próprio); o dono, logado, vê | Pública |
| Data marcada | Nunca aparece em página ou API pública, a não ser com **Mostrar contagem regressiva** ligado | — |

### Prévia para quem você escolher: a senha e o easter egg (v3.7)

Para a Mag, ou quem mais você quiser, ver o álbum pronto antes do lançamento, sem acesso ao painel:
1. No projeto, em "Acesso e LGPD", preencha **Senha da prévia** (mínimo de 6 caracteres) e salve.
2. Passe a senha para a pessoa e diga: "abra entrenos2026.com e toque 5 vezes no título".
3. Aparece um campo de senha. Com a senha certa, ela vê o álbum (a galeria, a busca nas fotos e o envio) por **30 dias**, nesse aparelho.

- **A senha não é guardada**, só um resumo dela (sal e SHA-256). Para trocar, digite outra. **Trocar ou tirar fecha as prévias abertas.**
- **Limites:** 8 tentativas por hora por aparelho e 200 por dia no total. Senha errada só diz "Senha errada".
- **Sem senha cadastrada, o easter egg não existe:** a página "em breve" fica sem script nenhum.
- **A busca pelo rosto** também vale na prévia (v3.7.1), desde que "Busca pelo rosto" esteja marcada no projeto. Para o público, continua fechada até o lançamento.
- **Código:** `aplicaSenhaPrevia`, `temPrevia` e `handlePrevia` (`POST /api/previa`) em `src/index.js`; `SCRIPT_PREVIA` em `src/ui/em-breve.js`. LGPD: ROPA, seção 15.

### Endereço e marca do álbum (v3.7.1)

- **entrenos2026.com mostra o álbum na própria raiz** depois do lançamento (e, antes, para quem tem a prévia). `/galeria/entrenos2026` nesse domínio leva à raiz; os eventos continuam em `/galeria/entrenos2026/<evento>`. O endereço oficial é `https://entrenos2026.com/` (`enderecoDoAlbum`, em `src/utils.js`).
- **As páginas do álbum usam a marca dele** (`marcaDoAlbum`):
  - ícone "EN" e ícone de tela inicial `/apple-touch-entrenos.png` (gerado do SVG, em `src/content/icone-entrenos-png.js`);
  - o nome do álbum na aba e no `og:site_name`;
  - sem o manifest do fotos.

  O fotos é a base de operações; o Entre Nós é o principal.

- **Páginas dos eventos (v3.7.6):** com a paleta da apresentação (fundo `#0f0e0c`, amarelo `#f9de4b`), em qualquer tema do aparelho (`TEMA_ALBUM` em `src/ui/galeria.js`). O topo não tem o ícone de "reportar problema"; no rodapé fica "Algo deu errado? Fale com a gente" (`/suporte`). A linha da data mostra o período das fotos do evento. O fim do evento não leva à "Página do projeto".

### A página do projeto leva à galeria (v3.7)

Um projeto com **Texto de abertura** (a apresentação do álbum) não usa mais a página de projeto antiga: `/<slug>` redireciona para a galeria, que é mais arrumada. Depois do lançamento, vai para o endereço principal (`https://entrenos2026.com/galeria/entrenos2026`); antes, fica em `fotos.lucafchala.com`, onde valem a sua sessão e a prévia. Projetos sem texto de abertura seguem como sempre.

### Editora do álbum (v3.8.1)

- **Para quê:** quem ajuda a cuidar do álbum (a Mag) entra sem ter a senha do painel.
- **Como:** painel → projeto → bloco "Álbum Entre Nós" → **Senha da editora do álbum** (8+ caracteres, diferente da senha da prévia). Ela entra em `entrenos2026.com/entrar`; `/sair` encerra.
- **O que ela pode:** ver o álbum como dona antes do lançamento, ocultar foto, escolher a capa de um evento e "Atualizar agora". Nada do painel (`checkAuth` continua só para o dono).
- **Mecânica:** a mesma da prévia, com finalidade própria: hash com sal no evento (`editoraSenha`), cookie assinado `editora_<slug>` por 30 dias, sem sessão guardada; trocar a senha tira quem estava dentro. Tentativas limitadas por IP e por dia. Código: `aplicaSenhaEditora`, `temEditora`, `autorizaNoAlbum`, `handleEditoraEntrar` em `src/index.js`; testes em `tests/editora.test.js`.

### Como lançar (v3.5)

**O álbum é surpresa até a hora.** Antes do lançamento, nada pode revelá-lo fora do entrenos2026.com, que só mostra o "em breve" com `noindex`.

**Ensaio de carga antes do dia:** o plano (1.000 pessoas em 60 s, critérios e o script k6) está em [`ENSAIO-DE-CARGA.md`](./ENSAIO-DE-CARGA.md). Só o dono roda, contra uma prévia, com o R2 do álbum de teste aquecido.

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
- **Transparente:** as fotos da pasta de destino entram como se estivessem dentro de `chala`, com o crédito de Luca. Desde a v3.7.1, as **subpastas do destino também** (não viram seções), e a mesma foto em duas subpastas (redes sociais × resolução total) vira uma só, a de maior resolução.
- **Pasta de destino sem acesso público:** é pulada, e o dono vê "Um atalho desta pasta aponta para uma pasta que o site não consegue abrir". O conserto é compartilhar o destino como "Qualquer pessoa com o link: Leitor". As pastas dos projetos publicados já estão assim.
- **Atalho de arquivo** não entra (a listagem não traz as medidas da foto); só **atalho de pasta**.
- **A mesma pasta nunca é lida duas vezes** (atalho repetido ou em ciclo).
- **Download e "para redes"** funcionam igual: o arquivo é o da pasta de destino.

**Qual versão usar:** o atalho pode apontar para as fotos em tamanho cheio ou para as "reduzidas". A galeria mostra as miniaturas do Drive nos dois casos; a diferença está no download, onde o tamanho cheio é o arquivo original.

## Pastas grandes: Workers Paid (v3.6)

- **No plano grátis**, cada página tem 50 leituras externas. Um evento com muitas pastas, como Festa Junina (5 anos × 5 fotógrafos = 31 pastas), sai como "Lista parcial".
- **Com o Workers Paid (US$ 5/mês)**, o limite sobe muito. Depois de assinar, um PR de uma linha troca `WORKERS_PLANO = "gratis"` para `"pago"` no `wrangler.toml`. Os tetos `GALERIA_*_PAGO` (`src/config.js`) passam a valer: 120 leituras e 200 pastas por capítulo.
- **Nunca troque antes de assinar:** no plano grátis, a galeria quebraria.
- **Estado:** assinado em 07/11/2026; `"pago"` desde a 3.7.0. Com ele também sobem a pasta "para redes" (`GALERIA_MAX_CHAMADAS_IG_PAGO`, 40), as pastas de envio (`ENVIO_MAX_CHAMADAS_PAGO`, 300) e o sitemap de imagens (`SITEMAP_PROJETOS_COM_CAPITULOS_PAGO`, 40). Se um dia o plano voltar ao grátis, troque para `"gratis"` **antes** de cancelar.

## Aquecimento para o lançamento (v3.7.3)

- **O quê:** o cron (a cada 5 min) relê, à força, a lista de eventos e as fotos de cada evento do álbum, e guarda o resumo de cada evento (capas, número de fotos, datas da linha do tempo) no KV. A lista fica no D1. Os dois são globais: o primeiro visitante de qualquer data center vê o álbum pronto.
- **Quando:** álbum por capítulos em "Em breve", a cada 3 h; com lançamento agendado, de novo nos 30 min antes da hora. Projeto lançado ou só oculto não é aquecido.
- **Custo:** no máximo 600 chamadas ao Drive por execução e um álbum por vez; o que faltar fica para a execução seguinte (progresso em `aquece:<slug>` no KV).
- **Código:** `src/aquece.js`; testes em `tests/aquece.test.js`.

## Mandar suas fotos (v3.4)

> **Com o envio pelo site ligado (v4.0.0)**, o botão leva à página
> `entrenos2026.com/enviar`, e a janela abaixo não aparece: a turma escolhe as
> fotos no celular, confere o evento de cada dia e envia, sem abrir o Drive.
> As fotos terminam nas mesmas pastas de envio. Como ligar e como funciona:
> [`docs/ENVIO.md`](./ENVIO.md). O que segue descreve o caminho de sempre, que
> vale enquanto a credencial do Google não está no Worker.

- **Pasta de envio** é a pasta de crédito cujo nome começa com `!` (`chavesDeEnvio`, em `src/drive.js`).
- **A janela:** o botão **Mandar suas fotos** abre uma janela com os eventos, na ordem da linha do tempo. Se o evento tem mais de uma pasta de envio (uma por ano ou por banda), ela pergunta qual. A opção abre a pasta no Drive, e a janela explica: entrar com a conta Google e tocar em **+ → Fazer upload**.
- **Sem JavaScript, ou se a lista falhar:** o botão continua um link para a pasta do álbum, e a janela mostra "Abrir a pasta do álbum".
- **Como a lista é montada** (`pastasDeEnvio`):
  - para cada evento, lê as subpastas (só pastas);
  - a pasta de envio direto no evento vale para o evento inteiro;
  - as outras subpastas que **não** são de fotógrafo (ano, banda) são abertas uma vez, à procura da pasta de envio dentro delas; o número de ordem do nome some ("03 - Banda X" vira "Banda X");
  - as pastas de fotógrafo (as outras linhas dos créditos) nunca são abertas;
  - no máximo 40 chamadas ao Drive por leitura (o teto do plano grátis é 50); evento que falha não derruba os outros.
- **Cache:** 6 horas, na memória, na Cache API e no KV (v3.7.2: o KV vale para todos os data centers; antes, a primeira visita de cada lugar esperava o Drive). A chave muda com a lista de eventos e com os créditos; por isso **evento novo aparece na hora**. Leitura incompleta (teto ou falha) fica só 10 minutos.
- **Carregamento (v3.7.2):** a página pede a lista assim que abre (e ao passar o dedo ou o mouse no botão); quando a pessoa toca, ela já chegou. Falhou: a janela mostra "Tentar de novo".
- **Rota:** `GET /api/galeria/envio?slug=` devolve `{ pastas: [{ evento, cap, rotulo, url }] }`. Vale só para álbum público por capítulos, com o mesmo portão da galeria: antes do lançamento, só o dono, logado. Os links são das pastas que a pasta pública do álbum já mostra a quem tem o link.

## Adicionar um evento

1. **Criar a pasta do evento** dentro da raiz do álbum. O nome vira o nome do evento no site; um número no começo ("12 - Viagem") ordena e some da tela.
2. **Criar dentro dela as cinco pastas**: `chala`, `mag`, `santa oficial`, `comissao` e `!turma 2026 (adicione suas fotos aqui)`. Se o evento tem anos ou bandas, crie uma pasta para cada um e as cinco dentro de cada. O conector do Drive desta sessão cria pastas; o compartilhamento não.
3. **Abrir a pasta `!turma…` do evento como Editor:** Compartilhar → "Qualquer pessoa com o link: **Editor**", com "Editores podem mudar permissões" desmarcado. As outras herdam "Leitor" da raiz. Esta parte é do dono ou do Cowork.
4. **No painel, tocar "Atualizar agora"** no projeto. O evento entra na linha do tempo, e a janela "Mandar suas fotos" já o mostra, sem esperar o cache.
5. **Busca pelo rosto:** o indexador (workflow `rosto`, a cada 10 minutos desde a 3.7.2) acha as fotos novas sozinho.

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
