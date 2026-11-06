# Apresentação de álbum, lançamento e destaque

Este guia cobre o álbum com página especial (o da Turma 2026, em `entrenos2026.com`): como funciona, como lançar e o que ainda falta. A versão é a 3.3.0; o código está em `src/ui/album.js`, `src/ui/destaque.js`, `src/ui/em-breve.js` e `src/pix.js`. A busca pelo rosto tem guia próprio, em [`ROSTO.md`](./ROSTO.md).

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
| Dica de envio | Aparece quando os créditos têm a pasta `outros` |

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
- **Em cada evento** (e em cada ano ou banda dentro dele) há quatro pastas:

  | Pasta | Fotos de | Crédito |
  |---|---|---|
  | `chala` | Luca | `chala = Luca F. Chala` |
  | `mag` | Mag | `mag = Mag <e-mail, só no painel>` |
  | `santa oficial` | Fotos oficiais do colégio | `santa oficial = Colégio Santa Cruz` |
  | `outros` | A turma | `outros = Turma 2026`; a pasta fica **aberta como Editor** para quem tem o link (são 20) |

  A foto fora dessas pastas recebe `* = Turma 2026`.
- O e-mail da Mag fica **só no painel**. Nunca vai para código, testes, documentação ou commits.

## O que falta (estado em 06/11/2026)

1. **Drive:** o Cowork travou a raiz e abriu as pastas `outros` 1 e 2. A pasta 3 ficou com "Limitar o acesso" ligado, por engano, e precisa que o dono desmarque. Depois, o Cowork abre as pastas 3 a 20.
2. **Merges**, nesta ordem: #264 (feito, 3.1.0 no ar) → #274 → #275 → #277 → #278, todos com "Create a merge commit". Depois, conferir o deploy e rodar `~/entrenos-handoff/criar-releases.sh`, que cria as Releases v3.1.0, v3.2.0, v3.3.0 e v3.3.1 (criar Release daqui foi bloqueado pelo sistema de permissões).
3. **Fase 4 do prompt do Cowork:** criar o projeto `entrenos2026` em "Em breve" e não visível, com os créditos de 5 linhas, o estilo Mosaico e o recado; testar com mídia real; passar o domínio para o Worker `fotos`.
4. **Fase 5:** conta da AWS (permissão nova `rekognition:SearchFaces`), pedido de cota, `ROSTO_INDEXADOR_TOKEN` no Worker e no GitHub, e rodar o indexador.
5. **Fase 6:** o dono testa a busca pelo rosto, logado.
6. **Fase 7:** lançar, só com o "pode lançar" do dono.
7. **Pendências que dependem do dono:**
   - mergear os PRs do aviso nos outros sites (lucafchala.com#44, dash#37, paste#16, url#16);
   - preencher o Pix no painel;
   - autorizar o Search Console do domínio;
   - decidir sobre o Workers Paid (US$ 5/mês) para o mês do lançamento.

Os prompts do Cowork, as respostas dadas a ele e as imagens de comparação estão em `~/entrenos-handoff/`, fora do repositório, porque têm o e-mail da Mag.
