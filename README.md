# fotos.lucafchala.com

Site de entrega de fotos do fotógrafo **Luca F. Chala** — galeria pública,
painel administrativo, Termos com autorização de uso de imagem (LGPD), pedidos
de remoção, métricas, backup e PWA — rodando em **um único Cloudflare Worker**,
com JavaScript puro e HTML renderizado no servidor, sem framework, sem bundler
e sem etapa de build.

- Produção: <https://fotos.lucafchala.com>
- Versão atual: **3.1.0** — o que mudou está no [CHANGELOG](./CHANGELOG.md).
- Referência completa: [docs/REFERENCIA.md](./docs/REFERENCIA.md).

## O que o site faz

### Para quem visita

- **Página do projeto.** Capa em carrossel, descrição, data, créditos e o botão
  "Ver e baixar as fotos". O Google Drive fica como opção secundária, para quem
  prefere abrir a pasta.
- **Galeria própria.** As fotos da pasta do Drive dentro do site, em grade
  justificada na proporção real, sem recorte. O visualizador abre na resolução
  física da tela, tem zoom até o original, teclado e link direto para uma foto
  (`#foto=<id>`).
- **Capítulos por subpasta.** Com a opção ligada, `/galeria/<projeto>` vira um
  índice de cartões, um por subpasta de primeiro nível, e cada capítulo abre em
  `/galeria/<projeto>/<capítulo>`. Contadores, download, pedido de remoção e
  aviso ao autor são por capítulo; capítulo vazio some do índice.
- **Créditos por autor.** "Fotos: Ana e Bruno", filtro por fotógrafo,
  "Foto: Nome" no visualizador e JSON-LD por autor. O campo `pasta = Nome`
  define o autor de cada subpasta, e `* = Nome` cobre o resto. O e-mail do autor
  nunca sai do servidor.
- **Todas as mídias da pasta.** Vídeos (com a duração), Live Photos (o vídeo
  curto de mesmo nome vira parte da foto) e fotos HEIC/HEIF do iPhone entram na
  galeria. O vídeo abre como fachada com "Tocar": nada do Google carrega antes
  do toque.
- **Download em resolução completa.** "Tamanho máximo" entrega o original do
  Drive, byte a byte; "Para redes" entrega o arquivo correspondente da pasta
  "Para o Instagram". O site não redimensiona nem recodifica. O download tem
  fila automática ("Na fila… tentando de novo"), com espera crescente, uma
  tentativa por aba e "Cancelar".
- **Baixar tudo.** O botão "Baixar tudo" baixa as fotos do evento pelo próprio
  site, com a mesma fila do download comum; com um filtro ligado (um ano, um
  fotógrafo), só o que está na tela. Desde a 3.7.2 a galeria do visitante não
  leva à pasta do Drive: com atalhos e subpastas o Drive não junta tudo, e quem
  não é dono da pasta de destino não entra.
- **Filtro por ano.** Evento com seções que são anos (2026, 2025…) ganha as
  etiquetas "Todos os anos", "2026"… que filtram a página.
- **Salvar por aparelho.** Android e computador baixam o arquivo direto. No
  iPhone e no iPad, "Salvar no Fotos" abre a folha do sistema com o arquivo
  exato, e "Baixar arquivo" salva no app Arquivos.
- **Favoritas.** Dá para marcar fotos, filtrar por "Favoritas" e compartilhar a
  seleção por um link `#sel=…` com até 300 fotos. A seleção compartilhada não é
  gravada no servidor; álbuns de família e privados continuam pedindo o passe.
- **Fotos novas desde a última visita.** Marca "nova", chip "Só as novas" e
  "N novas" no cartão do capítulo. A última visita fica só no `localStorage` do
  visitante; nada vai ao servidor e não há cookie novo.
- **Pedir remoção.** Link discreto sob a legenda da foto, com miniatura,
  e-mail, motivo (sou eu / menor de idade / outro) e mensagem opcional. O pedido
  vai ao painel e por e-mail ao dono; a foto continua na galeria até ele
  decidir.
- **Prévia de link no WhatsApp.** Cartão Open Graph por capítulo e no índice,
  com capa e contagem. Em álbum de família ou privado o cartão sai genérico.
- **PWA.** Manifest, ícones PNG e instalação como app a partir do `/dashboard`;
  as páginas públicas não pedem instalação.
- **Acesso por tipo de álbum.** A galeria de álbuns públicos abre sem login e
  sem o portão do Drive. Família e privados usam o passe de 12 h emitido pelo
  portão do Drive, que combina Turnstile e aceite dos Termos, validados no
  servidor; se o portão travar, há um código por e-mail como último recurso.
  Álbuns "Em breve" continuam fechados, com o mesmo 404 de rota inexistente.
- **Busca e compartilhamento.** Galerias de álbuns públicos saem com
  `index, follow`, entram no sitemap e têm JSON-LD; os downloads ficam fora dos
  buscadores. O botão Compartilhar usa o menu do aparelho no celular e copia o
  link no computador.
- **Suporte e orçamento.** `/suporte` reúne WhatsApp, e-mail e formulário. O
  botão "Pedir orçamento" da página `/sobre` leva ao formulário com um modelo de
  mensagem já preenchido.

### Para o dono

- **Painel `/dashboard`.** Login com senha (PBKDF2) e sessão de 24 h em cookie
  HTTP-only. Uma navegação só: barra lateral no computador e barra de baixo no
  celular, com as seções **Eventos**, **Pedidos**, **Métricas** e **Ajustes**.
- **Projetos.** Criar, editar, duplicar, excluir, ordenar, destacar, ocultar,
  marcar "Em breve", definir status e prazo, guardar notas privadas, até 6 fotos
  de capa, descrição por foto, link do Drive e link extra. A seleção em massa
  aplica categoria ou tipo de acesso a vários projetos.
- **Pedidos.** Pedidos de remoção agrupados por evento, com miniatura,
  identificação, e-mail, motivo, mensagem e o estado dos e-mails. "Remover da
  galeria" esconde a foto e avisa quem pediu e o autor; "Manter na galeria"
  avisa os dois. "Responsável por um menor" tem prioridade.
- **Métricas.** Visitas, aberturas do Drive, aberturas da galeria, fotos
  baixadas, taxa de abertura, comparação com o período anterior, gráfico de
  acessos por dia, tabela, CSV, média por dia da semana, modos do portão e a
  curva de cada projeto. A aba **Galeria** mostra aberturas por dia, fotos
  baixadas por versão (redes e tamanho máximo), baixadas por abertura, ranking
  por capítulo e CSV.
- **QR code por projeto e capítulo.** No menu "⋯" do projeto, com o link do
  índice ou de cada capítulo, **Baixar PNG** e **Baixar SVG** em alta resolução,
  com o título embaixo.
- **Atualização automática com período.** 10 min, 1 h, 6 h ou 24 h. Desligada, a
  galeria mostra a última lista durável até o dono tocar em "Atualizar agora" —
  é a moderação de uma pasta colaborativa.
- **Aviso de fotos apagadas.** Cada releitura compara a lista com o snapshot
  durável, identifica o que sumiu do Drive e manda um e-mail-resumo ao dono,
  com cópia ao autor quando há e-mail nos créditos. O painel lista "Fotos
  apagadas recentemente" por 30 dias.
- **Aviso por e-mail ao autor.** Quando chega um pedido de remoção de foto dele,
  quando o dono decide e quando oculta ou devolve a foto. O aviso nunca leva o
  e-mail nem a mensagem de quem pediu; é um por foto e tipo a cada 24 h, com
  teto de 20 por dia.
- **Backup e restauração.** Backup JSON v3 com eventos, categorias, pedidos e
  registro de consentimento. A restauração só acrescenta, valida cada linha e é
  pulada na prévia. Há lembrete de backup e exportação CSV de consentimentos,
  pedidos e métricas.
- **Prévia de PR.** Cada PR ganha um site com o mesmo código e configuração de
  produção, mas com KV, D1 e Durable Objects próprios. A prévia tem faixa
  "PRÉVIA", `noindex`, Turnstile de teste e o menu **Testes**, que simula falhas
  de Turnstile, e-mail, portão lotado, banco fora, Drive e rede lenta.
- **Ajustes do site.** Selo de agenda (frase curta no topo da galeria e da
  `/sobre`) e categorias que alimentam os filtros e o formulário.
- **Conta e segurança.** Trocar a senha (revoga as outras sessões), sair dos
  outros aparelhos, confirmações digitadas para ações sensíveis e limite de
  tentativas de login por IP.

### Privacidade e LGPD

- **Termos com autorização de uso de imagem.** O aceite é registrado no D1, na
  tabela `image_use_consent`, com retenção de cerca de 5 anos. O registro entra
  no backup v3.
- **Documentos legais em `/legal`.** Termos e privacidade têm páginas próprias;
  o pacote de conformidade fica em `/legal` (ROPA, RIPD, LIA, retenção,
  transferência internacional, direitos do titular, resposta a incidentes,
  política de segurança da informação e declaração de acessibilidade).
- **Remoção por aprovação.** O pedido não apaga nada sozinho: a foto continua no
  ar até o dono decidir. Ocultar tira a foto do site sem mexer no Drive.
- **Sem rastreamento de terceiros por padrão.** Fontes servidas pela própria
  origem, sem Google Fonts, e nenhum CDN de terceiro. O Web Analytics da
  Cloudflare é opcional, controlado por token. O player do Drive só carrega
  depois do toque. O `robots.txt` diz `ai-train=no` e o `llms.txt` diz que treino
  não é permitido.
- **Consentimento em álbum restrito.** Família e privado se apoiam no
  consentimento, não em senha. No caminho sem Turnstile, o visitante informa o
  nome e cada IP abre no máximo 3 álbuns restritos diferentes por dia.
- **Dados sob controle.** A última visita e as favoritas ficam no navegador; o
  servidor guarda o que precisa para entregar, medir e registrar consentimento.
  A política de retenção e o ROPA descrevem cada dado e seu prazo.

### Aguenta pico

- **Cache em degraus.** A lista do Drive é servida da memória do isolate,
  depois da Cache API e depois do snapshot no D1. Lista vencida sai na hora,
  sem esperar o Google.
- **Uma leitura por vez.** Um lease curto no Durable Object garante que só uma
  requisição relê o Drive; as outras recebem "Carregando as fotos…" e atualizam
  sozinhas. O teste de 200 requisições simultâneas prende no máximo uma
  listagem.
- **Limites por IP em degraus.** Ver, abrir capítulo, ver foto e baixar não
  barram 300 pessoas atrás do mesmo IP — a rede da escola ou o Wi-Fi do evento
  conta como um IP só. Os limites antiabuso ficam em pedidos de remoção,
  formulários e login. O download tem um balde de fichas (6 mil de rajada, 20
  mil por hora) e, esgotado, responde 429 com `Retry-After`.
- **Fila no navegador.** Quando o Google recusa um arquivo muito baixado, o
  Worker tenta de novo e responde 503 com espera de 20 a 60 s; o botão vira
  "Na fila… tentando de novo em N s" e tenta sozinho por até cerca de 5 min.
  O botão do evento inteiro no Drive é a saída sem fila.
- **Plano gratuito da Cloudflare.** A cota é de 100 mil requisições/dia ao
  Worker, 100 mil linhas escritas/dia nos Durable Objects e cerca de 1.000
  escritas de KV/dia. Um evento com 1.000 pessoas baixando 5 fotos cada gasta
  cerca de 14 mil requisições, 14% da cota. Acima de ~5.000 pessoas no mesmo
  dia, o caminho é o plano pago.
- **Custo de CPU medido.** A requisição de um capítulo com 6.000 itens leva
  cerca de 6,4 ms, dentro da meta de 10 ms do plano.

## Como funciona

```
Visitante
   │  HTTPS
   ▼
Cloudflare Worker  (src/index.js)
   ├─ Workers KV (FOTOS) ── eventos, sessões, categorias, limites
   ├─ D1 (CONSENT_DB) ───── consentimento, snapshot da galeria, fotos apagadas
   ├─ Durable Objects ───── contadores, métricas, rate limit
   ├─ Cache API ─────────── lista do Drive em cache
   ├─ Drive API / lh3 ───── listagem, originais e miniaturas
   └─ Resend ────────────── e-mails transacionais
```

- O visitante pede uma página ao Worker; o Worker decide a rota e monta o HTML
  no servidor.
- O KV guarda o estado principal: eventos, sessões, categorias e limites.
- O D1 guarda o consentimento, o snapshot da lista e o registro de fotos
  apagadas.
- Os Durable Objects guardam contadores, métricas e rate limit, sem uma escrita
  de KV por visita.
- A Drive API lista a pasta e entrega o original; as miniaturas e as fotos do
  visualizador vêm do `lh3.googleusercontent.com`.
- O Resend envia pedidos de remoção, códigos de acesso, suporte e alertas.
- A Cache API e o snapshot no D1 seguram a lista quando o Drive demora.

## Começar

Requer **Node.js 22 ou mais novo**. O Wrangler 4 se recusa a rodar em versões
anteriores.

```bash
npm install          # dependências de desenvolvimento
npx wrangler login   # uma vez por máquina
npm run dev          # servidor em http://localhost:8787
```

O `npm run dev` usa o KV remoto por padrão; para usar KV local, rode
`npx wrangler dev --local`. Mesmo em dev, o painel pede senha: no primeiro
acesso, se `admin_password` não existir, a tela de login vira a tela de criação
de senha.

Antes de abrir PR:

```bash
npm test             # Vitest: suíte unit + suíte workers
npm run lint         # ESLint em src/, tests/ e scripts/
npm run typecheck    # tsc
```

Os roteiros de navegador usam `playwright-core` e precisam de um Chromium. O
caminho padrão é `/opt/pw-browsers`; se o seu Chromium estiver em outro lugar,
aponte `PLAYWRIGHT_BROWSERS_PATH` para ele. Rode um roteiro de cada vez.

```bash
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run verifica:galeria
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run verifica:celular
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run verifica:evento
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run verifica:painel
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run verifica:previa
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run verifica:navegador
```

`verifica:galeria` cobre a galeria própria, a resolução por aparelho, o zoom,
os downloads exatos e o "Pedir remoção". `verifica:celular` abre a página
principal do álbum e a de um evento em 5 telas de celular e reprova vazamento
lateral, alvo de toque menor que 44 px, campo que faz o iPhone dar zoom e texto
menor que 11 px. `verifica:evento` é a véspera de evento:
portão do Drive, 429, código por e-mail e álbum restrito sem Turnstile.
`verifica:painel` dirige o painel logado no iPhone, no Android e no computador.
`verifica:previa` cobre a faixa e o menu "Testes" da prévia. `verifica:navegador`
roda contra o `wrangler dev`; os outros usam o `src/index.js` de verdade num
servidor local.

Se você editar `docs/legal/`, `fonts/`, `vendor/` ou o SVG dos ícones, regere o
módulo correspondente antes de commitar:

```bash
npm run build:legal
npm run build:fonts
npm run build:vendor
npm run build:icons
```

## Deploy

- **Merge na `main` é deploy.** O push publica sozinho; a verificação acontece
  antes, na prévia do PR.
- **Prévia por PR.** Cada PR ganha um site com dados próprios, faixa "PRÉVIA" e
  `noindex`.
- **Migrações D1.** O `deploy.yml` aplica as migrações antes de o código novo
  servir; se o esquema estiver quebrado, o deploy para.
- **Publicação e reversão.** O workflow sobe uma versão sem tráfego, promove a
  mesma versão, roda o smoke em produção e reverte sozinho se o smoke reprovar.
- **Rollback.** Actions → Deploy → Run workflow com o `version_id` da versão boa
  anterior; depois, `git revert` para `main` e produção não divergirem.
- **Domínios.** `fotos.lucafchala.com` e `entrenos2026.com` são Custom
  Domains do mesmo Worker, ligados no painel da Cloudflare (não no
  `wrangler.toml`). Um domínio de álbum leva a raiz direto à galeria do
  projeto: a lista fica em `DOMINIOS_DE_ALBUM`, em `src/config.js`. Domínio
  novo também entra no widget do Turnstile.
- **Álbum com página especial.** Apresentação, lançamento, destaque no site e nos outros sites, Pix: [docs/ALBUM.md](./docs/ALBUM.md). Busca pelo rosto: [docs/ROSTO.md](./docs/ROSTO.md).
- **Detalhes.** [Deploy](./docs/REFERENCIA.md#deploy) e
  [Prévia de PR](./docs/REFERENCIA.md#prévia-de-pr-testar-antes-do-merge).

## Documentação

| Arquivo | Para que serve |
| --- | --- |
| [RETOMADA.md](./RETOMADA.md) | Por onde voltar depois de um tempo: estado, rotina e as armadilhas que já custaram horas. |
| [docs/REFERENCIA.md](./docs/REFERENCIA.md) | Manual técnico completo: rotas, dados, deploy, segurança e o porquê de cada decisão. |
| [CHANGELOG.md](./CHANGELOG.md) | O que mudou em cada versão, da 2.0.0 à 3.1.0. |
| [SECURITY.md](./SECURITY.md) | Política de segurança, modelo de ameaça, escopo e como reportar uma vulnerabilidade. |
| [TODO.md](./TODO.md) | Orçamento de cota, regras vivas, ideias não priorizadas e decisões de não fazer. Tarefas ficam nas Issues. |
| [docs/PAINEL.md](./docs/PAINEL.md) | O painel por dentro: seções, blocos, cada ação e seu endpoint, como verificar. |
| [docs/VERIFICACAO.md](./docs/VERIFICACAO.md) | Como rodar e dirigir o site de verdade, no navegador, em vez de confiar só nos testes. |
| [docs/RELEASE.md](./docs/RELEASE.md) | Checklist de publicação, rollback e passos manuais na Cloudflare. |
| [docs/BRANCHES.md](./docs/BRANCHES.md) | Branches, PR empilhado, Dependabot, "um merge por vez" e proteção da `main`. |
| [docs/legal/](./docs/legal/) | Pacote de conformidade LGPD: ROPA, RIPD, LIA, retenção, transferência, direitos, incidentes e acessibilidade. |
| [CLAUDE.md](./CLAUDE.md) / [llms.md](./llms.md) | Instruções para sessão de agente: ferramentas, verificação e o que não fazer. |

## Contato

Site: <https://fotos.lucafchala.com> · Instagram: [@lucafchala](https://instagram.com/lucafchala) · Suporte: <suporte@lucafchala.com> · WhatsApp: <https://wa.me/5511989211178>
