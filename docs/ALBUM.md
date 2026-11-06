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

**Para lançar** (Fase 7 do prompt do Cowork):
1. Desmarque **Em breve**.
2. Marque **Visível** e **Fixado**.
3. Se a turma ainda não foi avisada da busca pelo rosto, desmarque **Busca pelo rosto**.

O botão de lançamento ou a contagem regressiva fica para uma versão futura, a pedido do dono.

## Destaque máximo no site

Com **Destaque máximo no site** marcado e o álbum lançado, aparecem (`src/ui/destaque.js`):
- a faixa azul no topo da home e das páginas dos outros projetos;
- o cartão grande no começo da home;
- o popup da primeira visita, uma vez por aparelho, lembrado só no `localStorage`.

Se houver mais de um álbum marcado, vale o fixado.

### Nos outros sites

Cada site inclui uma linha:

```html
<script src="https://fotos.lucafchala.com/destaque.js" async></script>
```

- Se o site tiver CSP, libere `https://fotos.lucafchala.com` em `script-src` e `connect-src`.
- O script pergunta a `GET /api/destaque` (CORS aberto) e, se houver álbum lançado, desenha a faixa num shadow root fechado, sem innerHTML e sem cookie.
- Fechar a faixa esconde por 3 dias.
- Antes do lançamento, o script não desenha nada. Por isso a linha pode entrar nos sites antes do lançamento.
- Os sites ficam em repositórios separados. Estado em 06/11/2026:
  - **com PR aberto**: lucafchala/lucafchala.com#44, lucafchala/dash.lucafchala.com#37 (os geradores), lucafchala/paste.lucafchala.com#16 e lucafchala/url.lucafchala.com#16 (as páginas geradas);
  - **fora de propósito**: `status` (o `CLAUDE.md` e os testes dele proíbem origem de fora no CSP), `proof` (script-src 'none'), o próprio `dash` (painel com login) e o `restricted` (CTF);
  - **não avaliados**: `keys`, `pays`, `treino`, `rg` e `Edificio-maison-blanche`.
- Ordem: mergear esses PRs depois que o #277 estiver em produção. Antes disso, `/destaque.js` dá 404 e o navegador só registra um erro no console.

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
