# Changelog

O que mudou em cada versão do site, do ponto de vista de quem usa e de quem
mantém. O detalhe técnico de cada item está no PR e nos documentos citados.

A **2.0.0** é a primeira versão com número: antes dela o projeto não numerava
versões, e o histórico está nos PRs e no git. O número mora em dois lugares
que andam juntos — `package.json` e `VERSAO` em `src/config.js` — e aparece no
painel (barra lateral e *Ajustes → Sobre*), na faixa da prévia e em
`versaoSite` no `/api/healthz`.

**Como as versões funcionam** (a regra completa está no comentário de `VERSAO`,
em `src/config.js`): versionamento semântico. **Maior** quando o dono precisa
fazer algo ou algo deixa de valer (formato de dado, secret novo, o que o
visitante aceita); **menor** para função nova; **correção** para o mesmo
comportamento, melhor. PR que não muda o que vai ao ar não sobe número. O
número sobe uma vez por PR, com a seção dele aqui no topo, marcada "ainda não
publicada" até o merge — merge é deploy. `tests/versao.test.js` reprova se
`package.json`, `VERSAO` e a primeira seção deste arquivo divergirem.

## [3.11.0] — ainda não publicada

O que falta antes do lançamento (itens A1 a A3 do plano). Menor por causa da faixa nova no álbum. O número pula o 3.10.0, reservado pelo PR "Fora dos buscadores" (#307), que ainda não entrou.

- **Aviso para quem abre o álbum pelo navegador de dentro de um app** (Instagram, Facebook, TikTok, Snapchat, LinkedIn, LINE e a WebView genérica do Android). Ali, baixar fotos e ligar os avisos costuma falhar sem dizer nada. Quando a pessoa toca em baixar ou em "Avisar quando chegar foto nova", aparece uma faixa explicando e mostrando o caminho: no iPhone, os três pontinhos → "Abrir no navegador"; no Android, o botão "Abrir no Chrome"; nos dois, "Copiar o link". A faixa não impede a ação (às vezes o download funciona) e, fechada, não volta naquela aba. O WhatsApp não entra: ele abre os links no navegador de verdade. Nas três páginas do álbum (`src/ui/navegador-embutido.js`). A Política de Privacidade passa a citar a marca que a faixa guarda no aparelho (`sessionStorage`).
- **O `/api/healthz` vê o que degradou em qualquer isolate.** O registro de degradações ficava só na memória do isolate que viu o problema, e o healthz (e o painel de status, que o lê a cada 10 min) quase nunca caía nele: um problema de minutos passava invisível. Agora o que degradou vai, no fim do pedido, para um Durable Object (sem gastar escrita de KV; no máximo uma gravação por problema a cada 5 min por isolate), e o healthz junta tudo. Mesmos 30 min de janela.
- **A sonda do download não vai mais ao Google quando o original já está no R2.** Antes de baixar, a página pergunta ao servidor se o arquivo está pronto (`?p=1`). Essa pergunta ia sempre ao Google Drive, mesmo quando o download em seguida sairia do R2 — uma chamada à toa por foto, justamente no pico. Agora a sonda confere o R2 primeiro (sem ler o arquivo).

## [3.9.2] — ainda não publicada

- **O fundo do álbum fica igual ao do fotos.lucafchala.com** (pedido do dono): o preto neutro de lá (`#0a0a0a`, cartões `#141414`, bordas `#262626`), no lugar do azul-marinho da 3.9.0. As cores do Colégio Santa Cruz ficam nos detalhes: o amarelo sólido nos destaques e o azul nas linhas da linha do tempo, nas barras dos números e no brilho do rodapé. Tudo em `PALETA_ALBUM` (`src/config.js`).

## [3.9.1] — ainda não publicada

- **"A turma em números"**: `entrenos2026.com/numeros` (`/galeria/<slug>/numeros` no site), a retrospectiva do álbum para compartilhar. Total de fotos, de eventos, de anos e de quem fotografou; fotos por ano (em barras); os 5 eventos com mais fotos; quem mais fotografou. Sai do resumo que o álbum já guarda (com o ano escolhido pelo dono por cima), sem dado de visitante. Mesmo portão da galeria (antes do lançamento, só com a prévia). A página do álbum ganha o link *Turma em números* (com 2 eventos ou mais). `numeros` vira nome reservado.

## [3.9.0] — ainda não publicada

O que deixa o álbum mais fácil de usar e de compartilhar.

- **O link de uma foto mostra a própria foto no WhatsApp.** Todo link de foto agora tem um formato só, `entrenos2026.com/<evento>?foto=<código>`: a grade, o Compartilhar, a barra de endereço com a foto aberta, os resultados da busca pelo rosto e o e-mail da moderação. Como o servidor enxerga a foto no endereço, o cartão do link (WhatsApp, Instagram, Telegram) mostra aquela foto, com o título "Uma foto de <evento>". Foto oculta, de outro evento ou código inválido caem no cartão normal do evento; o canônico continua a página do evento. O `#foto=` antigo continua abrindo.
- **Cartão "minhas fotos" para os stories.** Depois da busca pelo rosto, *Criar cartão para os stories* monta no próprio celular uma imagem 1080×1920 com o título do álbum, até 6 fotos (a melhor de cada evento primeiro), quantas fotos a pessoa tem e o endereço do álbum. Compartilhar (onde o aparelho deixa) ou Baixar. Nada vai ao servidor.
- **O ano de cada evento, escolhido pelo dono.** Na página do evento, a faixa do painel (só o dono ou a editora veem) ganha *Ano do evento*: "Automático (o ano das fotos)" ou um ano. Vale na linha do tempo, na grade por ano, na faixa de eventos e no cartão do evento (que mostra só o ano escolhido). Serve para foto com a data errada (câmera com o relógio errado, foto escaneada). Guardado em `datasEventos`; a API aceita também ano e mês (`2024-03`).
- **As cores do álbum saem do azul do Colégio Santa Cruz** (`#243580`): o fundo, os cartões e as bordas são esse azul bem escuro, em vez do quase-preto quente que puxava para o marrom; as linhas da linha do tempo são azuis (o degradê amarelo → azul ficava oliva/marrom no meio). O amarelo só entra sólido, nos destaques. As cores moram num lugar só, `PALETA_ALBUM` em `src/config.js` (antes repetidas em cinco).
- **Páginas de ajuda**: `entrenos2026.com/ajuda` e `/ajuda/<tema>` (rosto, baixar, enviar, remover, navegar, apoiar, contato), com o campo *Qual é a sua dúvida?* que filtra as perguntas. Mesmo portão da galeria: antes do lançamento, só quem tem a prévia vê. A página do álbum ganha o link *Dúvidas?*, e a janela da busca pelo rosto, *Como funciona e dicas*. `ajuda` vira nome reservado (não pode ser nome de projeto).

## [3.8.13] — ainda não publicada

- **A Amazon aprovou a cota maior da busca pelo rosto** em São Paulo: 20 buscas por selfie por segundo (o padrão era 5; pedimos 10) e 25 para a busca pelas sementes. O site passa a usar esses números: no pico, quem cai na fila espera menos (de 2 a 4 s, antes de 2 a 8 s).

## [3.8.12] — ainda não publicada

- **A moderação automática não esconde mais nenhuma foto.** A Amazon continua marcando foto possivelmente imprópria, e o dono continua recebendo o e-mail com o link de cada uma (as da turma destacadas). A foto fica no álbum até o dono decidir e tocar em "Ocultar" no visualizador. Antes, foto da turma marcada saía do álbum sozinha. As que já tinham sido escondidas assim continuam ocultas: o dono mostra de novo no visualizador, se quiser.

## [3.8.11] — ainda não publicada

O primeiro minuto do lançamento: mil celulares abrindo a mesma página.

- **As miniaturas já estão no R2 antes do lançamento.** O indexador, que passa por toda foto do álbum (inclusive com ele ainda fechado), pede ao site as miniaturas nas larguras que o iPhone pede na grade (`AQUECE_LARGURAS`, medidas no navegador), devagar, e a cópia fica no R2. Antes, a primeira visita a cada miniatura ia ao Google, e numa rajada cada pedido que chegava antes de a cópia existir ia também: o Google recusa, e a foto ficava em branco. As fotos que a turma mandar ao longo do ano são aquecidas na execução que as indexa. Para isso a rota das fotos aceita o indexador (com o token dele e o endereço assinado) no álbum fechado.
- **Miniatura que falha tenta de novo** (duas vezes, com espera crescente e sorteada) antes de virar o quadro vazio. Antes, só recarregar a página trazia a foto.

## [3.8.10] — ainda não publicada

- **Teto de fotos por dia no indexador** (`ROSTO_FOTOS_POR_DIA`, 2.000 por álbum). A pasta do álbum recebe fotos por link aberto durante um ano; sem teto, alguém despejando arquivos fazia o indexador pagar por todos (mais de mil dólares num dia, no pior caso). Agora o pior dia custa cerca de US$ 8 por álbum; o que passar fica para o dia seguinte, e o log diz. Para a primeira indexação de um álbum grande, a variável `ROSTO_MAX_DIA` do workflow sobe o teto.

## [3.8.9] — ainda não publicada

Privacidade: o que a revisão de novembro de 2026 achou entre o que o site promete e o que o código faz (achados 5, 6, 7, 8, 11 e 12).

- **"Não quero aparecer na busca" vale para as fotos que chegam depois.** O rosto de quem saiu vira uma marca dentro do índice do álbum. O indexador, depois de indexar fotos novas, apaga os rostos parecidos com cada marca; a busca que encontra a marca responde "você saiu", na régua mais baixa da busca (era a mais alta: uma selfie de lado passava). Antes, a foto nova de quem saiu entrava no índice. Quem saiu antes desta versão continua fora com a própria selfie, mas precisa sair de novo para as fotos novas (só houve testes da prévia).
- **O dono vê quem saiu e desfaz.** A saída aceita qualquer foto de rosto, então dá para tirar outra pessoa da busca. No painel, em editar o projeto → *Quem saiu da busca*: a data e quantos rostos cada saída apagou (sem foto, sem nome), com *Desfazer*. Desfazer manda o indexador refazer o índice do álbum (uma indexação paga por foto). Teto de 60 saídas por dia no site (`ROSTO_SAIR_POR_DIA`), com um alerta por e-mail ao dono.
- **Excluir o projeto apaga o índice de rostos e as inscrições de aviso.** As duas coleções na AWS são apagadas na hora (se a AWS falhar, o cron diário repete). Desligar a busca no painel para o indexador na hora e apaga o índice 72 horas depois; religar antes cancela. Antes, nada disso era apagado pelo código.
- **Inscrição de aviso de fotos novas com validade** (400 dias sem aviso entregue; cada entrega renova). Limite de inscrições por IP na medida de uma escola (era 20 por hora), e pedido malformado não o gasta. A chave do aviso nasce uma vez só (dois primeiros acessos juntos criavam duas, e parte das pessoas nunca recebia aviso). Inscrição recusada pelo serviço de entrega (403) três vezes seguidas é apagada, e o `/api/healthz` acusa as recusas.
- **Teto de e-mails em janela diária fixa** (`EMAIL_TETO_DIA`, 90, vira à meia-noite UTC), para todo envio: o código por e-mail e os alertas ficavam de fora, e o balde antigo deixava sair perto de 180 nas primeiras 24 horas. Dez vagas são só dos alertas ao dono.
- **Documentos legais corrigidos:** a LIA dizia que não há tratamento biométrico; o ROPA, que o site não hospeda fotos, que nada fica no aparelho e que o indexador roda a cada 30 min; o RIPD, que só o dono busca antes do lançamento. A política de retenção ganhou o índice de rostos, as cópias no R2 e as inscrições de aviso; a transferência internacional, o R2. A página de Privacidade diz o que mudou (os Termos não mudaram: `TERMS_VERSION` fica).
- Depois do merge, o dono confere: onde fica o bucket do R2 (anotar em `docs/legal/transferencia-internacional.md`) e se a AWS aprovou o usuário do Worker para `rekognition:DeleteCollection` (ver `docs/ROSTO.md`).

## [3.8.8] — ainda não publicada

Os bloqueios do lançamento, da revisão completa de novembro de 2026.

- **As fotos pelo site só saem para álbum do site.** O endereço `/f/<foto>/<largura>` servia qualquer imagem pública do Google Drive, com o domínio do álbum na frente e uma cópia para sempre no R2, e continuava servindo uma foto oculta ou removida. Agora o endereço leva uma assinatura do site (`k=<álbum>.<assinatura>`), e a rota confere, antes de buscar qualquer coisa: a assinatura, se o público pode ver o álbum e se a foto não está oculta. Fora disso, 404, sem chamar o Google e sem gravar no R2. Os endereços antigos, sem assinatura, param de funcionar (as páginas já saem com os novos).
- **Foto oculta ou removida sai de verdade.** Ocultar (no visualizador, no painel ou pela moderação), "Remover da galeria" num pedido de remoção e apagar a foto no Drive apagam as cópias dela do R2 (miniaturas e original). O navegador e o cache da Cloudflare guardam a foto por 4 horas, e não mais por 7 dias. Uma faxina diária apaga as cópias de qualquer foto oculta que tenha ficado para trás (inclusive as ocultadas antes desta versão).
- **Busca pelo rosto no pico.** Quando há muita gente buscando, a página tenta de novo sozinha; a nova tentativa reenviava a mesma verificação anti-robô, que só vale uma vez, e falhava sempre. Agora cada tentativa pede uma nova. A busca que a Amazon recusa por excesso não gasta mais o teto do dia, e o teto cabe 1.500 pessoas com 3 buscas cada (eram 1.200 buscas). A cota da Amazon (a de hoje e o aumento pedido) fica num lugar só, `ROSTO_AWS_TPS`.
- **"O público pode ver este álbum?" tem uma resposta só.** A raiz do domínio do álbum, a galeria, a home, o `/api/recentes`, os sitemaps, o portão do Drive e as fotos usavam regras diferentes. Um álbum com domínio próprio marcado como oculto, mas com "Em breve" desmarcado, abria inteiro pelo endereço da galeria; visível e "Em breve", tinha o título na home. Agora, antes do lançamento, ele fica fechado nos dois casos. Projeto comum segue igual: "oculto" é não listado e abre por link direto.
- **O indexador da busca não expõe mais o álbum.** O repositório é público, e os logs do GitHub Actions também: o indexador imprimia o nome de cada evento e, nas falhas, o identificador da foto. Agora só imprime contagens. O estado dele (a lista de fotos já processadas) saiu do cache do Actions e mora no site, protegido pelo token do indexador.
- **Uma falha passageira do Google não apaga mais o índice de rostos.** Se uma página do álbum viesse sem a lista de fotos, o indexador entendia que as fotos tinham saído: apagava os rostos e, na execução seguinte, pagava para indexar tudo de novo. Agora uma leitura incompleta não apaga nada.

## [3.8.7] — ainda não publicada

- **Passar as fotos no celular:** em "minhas fotos" em tela cheia, o iPhone cancelava o gesto sobre a imagem e parecia que só havia uma foto. Agora o deslizar vem dos eventos de toque, a imagem não pode ser arrastada e as setas ‹ › aparecem também no celular.
- **Zoom nas fotos em tela cheia** ("minhas fotos" e a busca): pinça com dois dedos, toque duplo (amplia no ponto tocado e volta), arrastar a foto ampliada; no computador, clique duplo e rodinha. Ampliada, a foto carrega em resolução maior.
- **Abertura mais limpa** (vale para os três estilos): um botão principal ("Achar minhas fotos pelo rosto", ou "Ver todas as fotos" sem a busca), o botão **Mandar suas fotos** (com contorno, ícone de envio) logo abaixo dele, o "Não quero aparecer" e uma linha de links discretos: Ver os eventos · Avisar quando chegar foto nova. A busca por palavra fica só com o campo ("Procurar nas fotos"); as sugestões e a dica de envio saíram da abertura.

## [3.8.6] — ainda não publicada

- **Minhas fotos e a busca viram galeria:** tocar numa foto do resultado abre em tela cheia; dá para passar por todas as fotos do resultado, de todos os eventos (deslizar, setas, teclado), com "Ver no evento" e "Baixar" em cada uma. Voltar (botão do celular) fecha a foto e fica no resultado. Botão "Tela cheia" onde o navegador deixa (`SCRIPT_VISOR`, sem biblioteca, sem innerHTML).

## [3.8.5] — ainda não publicada

Eventos separados por data do jeito certo e o "Não quero aparecer" à vista.

- **Data dos eventos:** um evento sem data (fotos sem a hora gravada, como as do WhatsApp) desligava a ordem por data de TODOS, e os anos se embaralhavam na grade. Agora os datados vão em ordem e os sem data ficam no fim, em "Sem data" (`ordemDaLinha`, `mesDoEvento`).
- O ano do evento é o do mês do MEIO das fotos (`pm` no resumo); o período ignora 5% de cada ponta e datas impossíveis (antes de 2000 ou no futuro): câmera com o relógio errado não puxa mais o evento para outro ano.
- **Busca pelo rosto (decisão do dono, 08/11):** a busca inclui todos os rostos do álbum; o "Não quero aparecer na busca pelo rosto" fica na abertura, logo abaixo dos botões, e abre a janela já no modo de sair.
- Teste de CPU (`galeria-pico`): o teto absoluto de 10 ms era do plano grátis; vira 25 ms (a razão continua a régua).

## [3.8.4] — ainda não publicada

Aviso de fotos novas no celular, sem serviço pago.

- Botão **Avisar quando chegar foto nova** na abertura do álbum. No iPhone, o Safari só manda aviso para o site adicionado à Tela de Início: o botão vira uma explicação de como fazer.
- Web Push padrão (`src/aviso.js`): a chave do site (VAPID) nasce sozinha no KV; o texto vai cifrado (RFC 8291); só serviços de entrega conhecidos (`AVISO_HOSTS`).
- Disparo: o indexador manda fotos que ainda não estavam na busca → `aviso:pendente:<slug>` junta por evento; o cron manda no máximo um aviso por álbum a cada 3 h (`AVISO_INTERVALO_MS`), em lotes de 400 (`AVISO_LOTE`), e apaga a inscrição que o serviço recusa (404/410).
- Rotas: `/sw.js` (só mostra o aviso e abre o link; não intercepta nada), `/manifest-album.json`, `GET /api/aviso/chave`, `POST /api/aviso/inscrever` e `/api/aviso/sair`.
- Política de privacidade (seção 3.2) e registro de operações (seção 16): consentimento, sem nome nem e-mail, retenção até desligar.
- Painel, gráfico de acessos: no celular, a dica podia cobrir o ponto da galeria (a conta de onde pô-la só via visitas e Drive, e o "vão" entre o ponto mais alto e o mais baixo podia ter o do meio dentro). Aparecia só em alguns dias, conforme os números.

## [3.8.3] — ainda não publicada

Site mais rápido e fluido, links curtos, "minhas fotos" que se atualiza sozinho, e-mail dentro do plano grátis e o R2 pronto para ligar.

### Velocidade
- As fotos passam pelo próprio site: `/f/<id>/<largura>` (`src/foto-rota.js`). A primeira vez de cada tamanho vem do Google; as seguintes saem do cache da Cloudflare (uma semana). Antes, cada miniatura levava de 0,7 a 2 s no Google, e mil pessoas pediam o mesmo arquivo a ele.
- Larguras numa lista fechada (`FOTO_LARGURAS`): o pedido sobe para a próxima; erro do Google não vira cache nem repassa a página de lá.
- Transição suave entre as páginas do álbum (View Transitions) e o HTML do evento baixado quando a pessoa encosta no link (speculation rules, "prefetch"; a contagem de aberturas já ignora `Sec-Purpose: prefetch`).

### Links
- No domínio do álbum, o evento mora em `entrenos2026.com/<evento>`; o endereço longo leva ao curto (301). Canonical e cartão de link também (`baseDaGaleria`, `enderecoDoEvento`).
- Link de foto curto: `#foto=` com os 10 primeiros caracteres do ID (o ID inteiro só se dois começarem igual). O link antigo continua abrindo.

### Lembrar a pessoa
- O ano escolhido no filtro fica lembrado por evento, neste aparelho.
- "Ver minhas fotos": se chegaram fotos ao álbum depois da última busca, procura de novo só com os rostos do índice que a busca anterior achou (nunca a selfie) e marca as novas (`POST /api/rosto/atualizar`, `atualizaPorFaces`). O indexador marca `rosto-novas:<slug>` ao mandar fotos novas.

### E-mail
- Teto de 90 e-mails por dia no site inteiro (`EMAIL_COTA_DIA`, `cotaDeEmail`), para caber no plano grátis do Resend. Os alertas de login e de varredura ficam de fora. No plano pago do Workers, o pedido de remoção sempre vai ao painel, mesmo quando o e-mail do dia acabou.

### R2 (pronto, desligado até o bucket existir)
- Com o binding `FOTOS_R2`: a miniatura e o original vão para o R2 na primeira vez que alguém os pede, e daí em diante saem de lá, sem chamar o Google. Original acima de 512 MB (vídeo longo) fica no Drive. Sem o binding, nada muda.

## [3.8.2] — ainda não publicada

Abertura do álbum mais clara, eventos fáceis de achar, busca pelo rosto mais generosa e o PiauiFut com os anos certos.

### Álbum
- O texto de abertura vem **antes** dos botões, em todo estilo.
- O campo **Procurar nas fotos** fica logo abaixo dos botões (um só); o resultado aparece no corpo da página.
- Mais de 8 eventos: a linha do tempo vira uma **grade compacta por ano**, com atalho para cada ano (`gradeDeEventos`, `EVENTOS_COMPACTOS`).
- Evento lido vazio fica escondido do visitante só por 6 h (`capVazio`, `RESUMO_VAZIO_MS`). Antes, um "0" antigo escondia o evento para sempre e só o dono o via. Lista cortada pelo teto de chamadas não conta como vazia.

### Páginas dos eventos
- A faixa com todos os eventos lado a lado virou **‹ anterior · Evento (5 de 23) ▾ · próximo ›**; o ▾ abre a lista inteira, por ano, com "Todos os eventos" no topo. Fecha com toque fora ou Esc.
- Pasta de ano com subpastas ("2024 / Dia 1", o PiauiFut): a seção leva o ano do caminho (`nomeDaSecao`), o título vira "2024 · Dia 1" e o filtro tem um chip por ano, juntando os dias.

### Busca pelo rosto
- Guia antes da selfie: oval de enquadramento e dicas (de frente, luz de frente, sem óculos escuros).
- Botão **Escolher uma foto** (galeria ou arquivos), além de "Tirar selfie".
- O link da política saiu de dentro do "Concordo": tocar no meio da frase marca a caixa, não abre a política.
- Busca até 70% de semelhança (`ROSTO_LIMIAR_BUSCA`); de 70 a 80% a foto vai para **Talvez seja você**, no fim. Sementes: até 4, a partir de 95%. Quem sai da busca tem apagado todo rosto a partir de 65% (era 75%), sempre abaixo da régua da busca.

## [3.8.1] — ainda não publicada

A Mag com acesso próprio ao álbum, o painel mais fácil e um manual de uso.

- Correções do CI: os atalhos dos blocos quebram linha no computador (o contorno de foco era cortado) e o manual de uso deixou de ser link para o GitHub.

### Novo

- **Editora do álbum (para a Mag):** campo "Senha da editora do álbum" no
  painel. Ela entra em entrenos2026.com/entrar e, por 30 dias, vê o álbum
  como dona (mesmo antes do lançamento), oculta foto, escolhe a capa de um
  evento e usa "Atualizar agora". Não entra no painel. A senha fica só como
  hash, tem de ser diferente da senha da prévia, e trocar ou tirar a senha tira
  quem estava dentro. /sair encerra.
- **Manual de uso** (`docs/MANUAL.md`): as tarefas do dia a dia passo a passo,
  o que é cada bloco do formulário, perguntas comuns e um glossário.

### Mudou

- **Painel:** as opções do álbum (apresentação, Pix, buscas, lançamento, prévia
  e editora) estão juntas num bloco próprio, "Álbum Entre Nós", com resumo do
  que está ligado e link para o manual. "Fotos e Drive" e "Acesso e LGPD"
  ficaram menores.
- **Links do rodapé no entrenos2026.com** (Sobre, Equipamento, Suporte, Legal,
  "Algo deu errado?") abrem no fotos.lucafchala.com. Antes abriam as páginas do
  fotos dentro do endereço do álbum, com a marca errada.
- **Pastas com vídeo:** as miniaturas dos vídeos (que o Google demora para
  gerar) vêm depois das fotos e não seguram a primeira tela.

## [3.8.0] — ainda não publicada

Fotos que sumiam voltam, a busca pelo rosto por evento, a foto aberta com o
"Baixar" em destaque e o site lembrando de cada pessoa.

### Corrigido

- **Fotos diferentes de nome igual sumiam.** Dentro dos atalhos, o site juntava
  fotos de mesmo nome na mesma seção (para não repetir a mesma foto em duas
  resoluções), mas juntava também fotos diferentes: o `IMG_1234` do Dia 1 e o
  do Dia 2, ou um da Mag e um seu. Agora só junta com o mesmo atalho de
  origem, o mesmo autor, o mesmo nome e a mesma hora de captura; sem hora, não
  junta nunca.
- **Documentos legais:** a transferência internacional cita o art. 33, II, "a"
  e "b" da LGPD (era o III, que trata de cooperação entre órgãos públicos); o
  ROPA e o checklist reconhecem o dado biométrico da busca pelo rosto (diziam
  que não havia).

### Novo

- **Busca pelo rosto e busca nas fotos por evento:** um título por evento, na
  ordem da linha do tempo, com as fotos dele; "N fotos em que pode ser você, em
  M eventos".
- **"Ver minhas fotos":** o resultado da busca pelo rosto fica neste aparelho
  por 30 dias (só os IDs das fotos), com "Esquecer neste aparelho".
- **Continuar de onde parou** na página principal (o último evento e a última
  foto abertos) e **"visto"** nos eventos que a pessoa já abriu. Tudo só no
  aparelho dela.
- **Faixa com todos os eventos** no topo de cada evento, deslizável, com o
  atual marcado e no meio.
- **"Usar como capa do evento"** na foto aberta, para o dono: a foto vira a
  capa do cartão do evento na página principal (`capasEventos`).
- **Indexador:** o registro mostra quantas fotos o site exibe em cada evento
  (para conferir com o Drive).

### Mudou

- **Foto aberta:** botão "Baixar" grande, na cor do destaque, no canto de
  baixo; "Foto de [quem fotografou]" em destaque na legenda; "Pedir remoção"
  mais discreto (sem fundo, letra menor, mesma área de toque).
- **Topo do evento:** "Baixar tudo" é o botão de destaque; "Fotos de …" maior.
- **"Mandar suas fotos":** a lista vale 30 min (era 6 h) e é relida no ciclo
  de aquecimento: pasta de envio nova aparece logo.

## [3.7.6] — 08/11/2026

O álbum com uma cara só, do começo ao fim, e mais leve no celular.

### Mudou

- **Os eventos do Entre Nós com a cara do álbum:** fundo escuro e o amarelo do
  Santa, em qualquer tema do aparelho (antes, num celular em modo claro, o
  evento abria claro e parecia outro site). Vale para álbum com domínio
  próprio; os outros projetos do fotos seguem iguais.
- **Sem o ícone de inseto no topo do evento:** o "reportar um problema" virou
  "Algo deu errado? Fale com a gente", no rodapé. E o fim do evento não manda
  mais para a "Página do projeto" (no álbum, ela é o próprio álbum).
- **A data do evento é o período das fotos dele** ("jun – set 2025", "2024 –
  2026"), não a data do projeto.
- **"Quem fotografou" só com os nomes**, sem a contagem de fotos de cada um.
- **Fotos da página principal em WebP e no tamanho de cada tela** (abertura,
  linha do tempo e resultados das buscas): o celular baixa a menor que serve.
  Antes eram JPEG numa largura só.

## [3.7.5] — 07/11/2026

A busca pelo rosto no centro do álbum, pronta ao toque e sem perder o
resultado.

### Mudou

- **"Achar minhas fotos pelo rosto" é o botão principal** da abertura (o
  primeiro, amarelo, com um ícone de rosto); "Ver todas as fotos" passa a
  secundário. Sem a busca (desligada ou sem JavaScript), "Ver todas as fotos"
  continua o principal.
- **O Turnstile carrega assim que a página abre**, escondido: quando a pessoa
  abre a janela e marca o aceite, "Tirar selfie" já está ativo. Se a
  verificação pedir interação (raro), o widget aparece na janela, como antes.
  Enquanto o token não chega, o botão diz "Só um instante…".
- **O resultado da busca não some ao voltar de uma foto:** fica guardado nesta
  aba (só os IDs das fotos, nunca a selfie) e o endereço ganha `#minhas-fotos`
  (ou `#busca=termo`, na busca nas fotos). Voltar traz a lista, rolada até a
  foto que foi aberta, marcada. Novo botão "Tentar com outra selfie".
- **Eventos que voltam a ter fotos reaparecem em minutos:** no Workers Paid, o
  resumo dos eventos vale 1 min na memória e 5 min no cache de cada data
  center, e o KV (global) é a fonte. Antes, um evento que ficou vazio por um
  tempo (atalhos sendo refeitos) continuava escondido para o visitante por até
  6 h, mesmo já com fotos.

### Corrigido

- **A mensagem de erro da busca pelo rosto sumia na hora** ("Não achei um rosto
  nessa foto"): a janela a apagava ao voltar ao estado inicial.

## [3.7.4] — ainda não publicada

O álbum conferido no celular, num navegador de verdade, em 5 telas (iPhone
SE, Android, iPhone, iPhone Max e deitado).

### Mudou

- **Campo "Procurar nas fotos" com letra de 16 px:** o iPhone não dá mais zoom
  ao tocar nele. O texto de exemplo ficou curto ("Ex.: 10, bolo, palco") e não
  corta mais em tela estreita.
- **Alvos de toque de 44 px:** as sugestões da busca ("jogo", "comida"…) e o
  "← Todos os eventos" da página do evento (eram 36 e 32 px).
- **Botões da abertura na largura toda no celular** ("Ver as fotos", "Procurar
  meu rosto", "Mandar suas fotos").
- **Página do evento:** sem o tracinho antes de "Todos os anos"; "Fotos de"
  maior (era 10,9 px).

### Novo

- **`npm run verifica:celular`** (e no CI, no job do navegador): a página
  principal do álbum, nos quatro estilos, e a de um evento com anos, em 5
  telas. Reprova se algo vaza para os lados, se um botão tem menos de 44 px de
  altura, se um campo faz o iPhone dar zoom ou se um texto fica menor que
  11 px; confere que as janelas "Mandar suas fotos" e "Procurar meu rosto"
  cabem na tela. A página "em breve" fica de fora de propósito.

## [3.7.3] — ainda não publicada

Busca pelo rosto mais generosa ("na dúvida, mostrar") e o álbum aquecido
para o lançamento.

### Mudou

- **A Amazon indexa todo rosto que detecta** (filtro de qualidade `NONE`, era
  `LOW`): o pequeno, de lado, tremido ou no escuro também entra. A primeira
  execução do indexador apaga os rostos e indexa de novo, uma vez, só a parte
  do rosto (texto e coisas já lidos não são lidos outra vez; ~US$ 1,50).
- **A busca pelo rosto mostra mais:** semelhança mínima 80% (era 90%), sem
  filtro de qualidade na selfie, e a segunda etapa (as "sementes") em 85% (era
  92%). Os achados vêm do mais certo para o menos certo; no fim da lista pode
  aparecer um parecido. A saída da busca ("não quero aparecer") passou para
  75%, sempre abaixo da busca.

### Novo

- **Álbum aquecido:** enquanto o álbum está "Em breve", o cron relê a lista de
  eventos e cada evento a cada 3 h, e de novo nos 30 min antes de um
  lançamento agendado. A lista fica no D1 e o resumo de cada evento (capas,
  número de fotos, datas) agora também no KV: o primeiro visitante de
  qualquer lugar vê tudo pronto, sem esperar o Google Drive. O "Lançar agora"
  pega o que o ciclo de 3 h deixou pronto.

## [3.7.2] — 07/11/2026

Pedidos do dono depois de testar a prévia: menos número na abertura, filtro por
ano, baixar tudo sem passar pelo Drive, a lista de "Mandar suas fotos" mais
rápida e o indexador da busca que não perde o que fez.

### Mudou

- **Abertura do álbum só com os eventos:** "5 eventos", sem a contagem de
  fotos e de fotógrafos. O crédito de quem fotografou continua na seção
  "Quem fotografou" e na linha "Fotos de …" de cada evento.
- **"Baixar tudo" baixa pelo site,** com a mesma fila do "Baixar" da seleção
  (uma por vez, espera quando o Google segura, lotes no iPhone). Com um filtro
  ligado (um ano, um fotógrafo), baixa só o que está na tela.
- **Sem link para a pasta do Drive na galeria do visitante:** saíram o
  "Baixar o evento inteiro (Google Drive)", o "Pelo Google Drive" e o "Abrir no
  Drive" de cada foto. Com atalhos e subpastas o Drive não junta tudo, e quem
  não é dono da pasta de destino não entra. A faixa do dono mantém o link.

### Novo

- **Filtro por ano:** quando todas as seções de um evento são anos (PiauiFut:
  2026, 2025…), as etiquetas do topo filtram ("Todos os anos", "2026"…) em vez
  de rolar até a seção.
- **"Mandar suas fotos" mais rápido:** a lista de pastas começa a vir assim que
  a página abre, e o servidor a guarda também no KV (vale para todos os data
  centers, não só para o da primeira visita). Erro mostra "Tentar de novo".

### Corrigido

- **"Para redes" voltou em todos os projetos:** as versões da pasta do
  Instagram são exportadas como `Zenite_lowres-07.jpg` (a marca antes do
  número), `PiauiFut+2026_social-274.jpg` ou `Banda_Clovis-downsided-23.jpg`,
  e o site só reconhecia `-insta`/`_ig`/`-redes` no fim do nome, então quase
  nenhuma foto achava o par. Agora vale também o arquivo com UMA palavra a mais
  que o original, em qualquer posição (número nunca conta como a palavra), com
  `-`, `_`, `+`, ponto e espaço valendo o mesmo. O casamento guardado no cache ganhou versão nova
  (`/r2`), para não servir o resultado vazio antigo.
- **Indexador da busca (GitHub Actions):** para de pegar foto nova aos 35 min
  (`ROSTO_MAX_MINUTOS`), processa até 4 fotos ao mesmo tempo (sem passar de
  4 chamadas por segundo de cada operação), grava o progresso a cada lote e o
  workflow salva o estado mesmo quando o passo falha. Roda a cada 10 min (era
  30): a foto nova entra na busca mais cedo. Antes, o álbum de 2.364
  fotos estourava os 45 min e o progresso se perdia.

## [3.7.1] — 07/11/2026

Ajustes do álbum Entre Nós a pedido do dono e da Mag: endereço limpo, marca
própria, crédito do fotógrafo em destaque, atalhos sem seções a mais, prévia
com busca pelo rosto e atalhos prontos da busca.

### Mudou

- **entrenos2026.com mostra o álbum na raiz,** sem redirecionar: o endereço
  fica só "entrenos2026.com". Vale depois do lançamento e, antes dele, para
  quem entrou pela senha da prévia.
  - O endereço antigo `/galeria/entrenos2026` nesse domínio leva à raiz (301).
  - Endereço oficial, cartão de link, sitemap, QR e o redirecionamento da
    página do projeto passam a usar `https://entrenos2026.com/`
    (`enderecoDoAlbum`).
- **A marca do álbum nas páginas dele,** e não a do fotos ("o principal é o
  entrenos; o fotos é a base de operações", `marcaDoAlbum`):
  - o ícone "EN" e um ícone de tela inicial próprio (`/apple-touch-entrenos.png`);
  - o nome do álbum na aba e no cartão de link;
  - sem o manifest do app do fotos.
- **Crédito do fotógrafo em destaque** no topo de cada evento: "FOTOS DE Luca
  F. Chala e Mag", maior. Aparece também quando o evento tem um fotógrafo só.
- **Atalhos sem seções a mais:** dentro de um atalho, as subpastas do destino
  não viram seções. As etiquetas do topo seguem as pastas do álbum (no
  PiauiFut, só os anos).
- **Sem fotos repetidas:** dentro de um atalho, a mesma foto em duas pastas
  ("Resolução Redes Sociais" e "Resolução Total", "!Dia 1" e "Dia 1") vira
  uma só, a de maior resolução.
- **A prévia com senha também testa a busca pelo rosto,** com "Busca pelo
  rosto" marcada. Para o público, nada muda antes do lançamento.
- **Atalhos prontos na busca:** "jogo", "comida", "palco", "bola", "fantasia"
  e "bolo". "Jogo" e "comida" passam a achar esporte e comida.
- **Respiro no topo** da primeira tela do álbum quando ainda não há fotos de
  capa.

## [3.7.0] — ainda não publicada

Busca nas fotos por texto e por coisas, moderação automática, prévia do álbum
com senha (o easter egg) e a página do projeto levando à galeria.

### Novo

- **Procurar nas fotos:** campo no álbum para buscar pelo número da camisa, por
  uma palavra de faixa ou por uma coisa (palco, bolo, bola).
  - O indexador pede à Amazon Rekognition, uma vez por foto, `DetectText` e
    `DetectLabels` (as coisas também em português).
  - O site guarda o resultado no D1 (`busca_foto`, migração `0005`).
  - A busca é só uma consulta ao D1: nenhuma chamada à Amazon por visita.
  - Opção **Busca nas fotos (texto e coisas)** no projeto, desligada por
    padrão.
- **Moderação automática** (`DetectModerationLabels`):
  - foto **da turma** marcada como imprópria fica escondida até o dono
    decidir, e o dono recebe e-mail;
  - foto de fotógrafo credenciado só é marcada;
  - uma foto só é escondida uma vez.
- **Prévia com senha (easter egg):** com **Senha da prévia** cadastrada, 5
  toques no título da página "em breve" mostram um campo de senha. Quem acerta
  vê o álbum por 30 dias antes do lançamento, só para ver.
  - A senha fica só como hash.
  - Trocar ou tirar a senha fecha as prévias abertas.
  - As tentativas são limitadas.

### Workers Paid ligado

- **`WORKERS_PLANO = "pago"`** no `wrangler.toml`: o dono assinou o Workers
  Paid em 07/11/2026.
  - Valem os tetos da 3.6.0 (galeria: 120 leituras por capítulo, 200 pastas).
    Festa Junina e PiauiFut deixam de sair como "Lista parcial".
  - Sobem também a pasta "para redes" (6 → 40 leituras), a busca das pastas
    de envio (40 → 300) e os álbuns por capítulos no sitemap de imagens (8 →
    40 por pedido).

### Mudou

- **Página do projeto de álbum com apresentação** (texto de abertura): leva à
  galeria. Depois do lançamento, vai para o domínio próprio.
- **Indexador:** lê o autor de cada foto da página e faz as leituras novas
  junto com os rostos; o estado guarda as fotos já descritas.
- **IAM:** `rekognition:DetectText`, `DetectLabels` e `DetectModerationLabels`
  (`docs/ROSTO.md`).
- **LGPD:** ROPA, seções 14 e 15; RIPD, R10.

## [3.6.0] — ainda não publicada

Fotos de outra pasta por atalho do Drive, e pastas grandes inteiras com o
Workers Paid.

### Novo

- **Atalho de pasta do Drive entra na galeria**, como se as fotos estivessem
  onde o atalho está: mesma seção e mesmo autor da pasta do fotógrafo.
  - É o jeito de o álbum usar fotos que já moram em outra pasta, de outros
    projetos publicados, sem copiar nem mover nada.
  - Atalho para pasta sem acesso público é pulado, e só o dono vê o aviso com
    o conserto.
  - Ciclo de atalhos e atalho repetido não leem a mesma pasta duas vezes.
  - Atalho de arquivo (não de pasta) não entra.
- **`WORKERS_PLANO` no `wrangler.toml`:** com `"pago"`, os tetos da galeria
  sobem.
  - Leituras: 18 → 120 por capítulo, 26 → 150 na galeria simples.
  - Pastas: 25 → 200.
  - Assim, Festa Junina (5 anos × 5 fotógrafos) e PiauiFut deixam de sair
    como "Lista parcial".
  - Fica `"gratis"` até a assinatura: no plano grátis, os tetos maiores
    estourariam o limite de 50 subrequisições.

## [3.5.0] — ainda não publicada

Lançar o álbum com um clique, ou com dia e hora marcados. Até lá, nada dele é
público.

### Novo

- **Lançar agora…:** item no menu ⋯ de cada projeto oculto ou "Em breve".
  Pede para digitar LANÇAR e, num passo só, tira do "Em breve", deixa visível
  e fixa. É o que a Fase 7 fazia em três caixinhas.
- **Lançamento marcado:** campo de dia e hora no formulário do projeto, com o
  selo "Lança 20/11, 20:00" na lista.
  - Na hora, o projeto passa a valer como lançado em todo o site ao mesmo
    tempo, sozinho.
  - A troca acontece na leitura dos projetos, sem tarefa agendada que possa
    atrasar.
  - A próxima gravação pelo painel torna a troca permanente.
- **Contagem regressiva** na página "em breve" do domínio do álbum: "Chega em
  20 de novembro, às 20h", com dias, horas, minutos e segundos. **Desligada
  por padrão**, porque revela a data. Na hora, a página recarrega e cai na
  galeria.

### Mudou

- **Álbum com domínio próprio ainda não lançado:** a página do projeto
  (`/entrenos2026`) dá 404 para o público. Antes, quem chutasse o endereço via
  o título "Em breve". Os outros projetos "Em breve" seguem como estavam.

### Segurança

- **Lançar é irreversível para o público**, então nada lança por engano:
  - data no passado é recusada no painel e no servidor;
  - data a mais de 400 dias é descartada;
  - backup restaurado com data vencida não lança;
  - salvar um formulário aberto desde antes da hora não devolve o álbum ao
    "Em breve".
- A data marcada não aparece em nenhuma página nem API pública, a não ser com
  a contagem ligada.

## [3.4.0] — ainda não publicada

"Mandar suas fotos" leva cada pessoa direto à pasta certa do Drive.

### Novo

- **Seletor de envio no álbum:** o botão **Mandar suas fotos** abre uma janela
  com os eventos, na ordem da linha do tempo. Quando o evento tem mais de uma
  pasta (por ano ou por banda), a janela pergunta qual. Cada opção abre a pasta
  de envio daquele lugar no Google Drive, com a instrução de entrar com a
  conta Google e tocar em **+ → Fazer upload**.
- **Pasta de envio:** é a pasta de crédito cujo nome começa com `!`. No álbum
  da turma, é a `!turma 2026 (adicione suas fotos aqui)`, que o `!` põe no
  topo da lista do Drive.
- **Rota `GET /api/galeria/envio?slug=`:** devolve evento, ano ou banda e o
  link de cada pasta de envio. Vale só para álbum público por capítulos;
  antes do lançamento, só para o dono.
- **Evento novo entra sozinho:** a lista fica guardada 6 horas, mas é refeita
  na hora quando muda a lista de eventos. O passo a passo está em
  `docs/ALBUM.md`, "Adicionar um evento".

### Mudou

- **A dica embaixo dos botões:** passa a ser "Toque em Mandar suas fotos e
  escolha o evento". A dica antiga, da pasta `outros`, continua para os álbuns
  que ainda usam esse nome.
- **Custo:** a busca das pastas não abre as pastas de fotógrafo (as outras
  linhas dos créditos) e para em 40 chamadas ao Drive, abaixo do teto de 50 do
  plano grátis da Cloudflare.
- **CI:** o limite do job "Roteiros no navegador" subiu de 20 para 30 minutos.
  Ele passava com quase 18 e foi cancelado por tempo uma vez.
- **CI:** o roteiro da seleção na galeria não exige mais que os downloads
  cheguem em ordem. O Chromium pode avisá-los fora de ordem, e o teste falhou
  assim no #278 sem nenhum erro no site.

### Corrigido

- **Painel:** faltava o interruptor **Destaque máximo no site**. O servidor já
  gravava o campo desde a 3.3.0, mas não havia como ligá-lo pelo painel.

Sem JavaScript, ou se a lista não carregar, o botão continua abrindo a pasta
do álbum.

## [3.3.1] — ainda não publicada

Documentos de LGPD atualizados para a busca pelo rosto e o Pix. Nada muda no
funcionamento do site.

### Mudou

- **RIPD:** risco **R9**, a busca pelo rosto como dado biométrico. Ele registra
  as bases legais, as mitigações e o ponto fraco do índice dos retratados.
  Resíduo médio-alto até haver concordância formal da turma e dos responsáveis.
- **ROPA:** a seção 12 (busca pelo rosto, com a Amazon Rekognition em São Paulo
  como operadora) e a seção 13 (Pix: o site não trata dado de quem doa). A
  Amazon entra no resumo das transferências.

## [3.3.0] — ainda não publicada

Função nova, sem nada para o dono fazer: a **apresentação do álbum**. Um projeto
com "Texto de abertura" ganha uma página especial no índice da galeria por
capítulos; os outros seguem iguais.

### Novo

- **Apresentação do álbum** (`src/ui/album.js`). Quatro estilos de primeira
  tela, escolhidos no painel em **Estilo da abertura**:
  - **Mosaico**, o padrão (o escolhido para o álbum da turma);
  - **Foto em tela cheia**, com as fotos trocando sozinhas;
  - **Álbum de recordação**, com polaroids e título manuscrito;
  - **Linha do tempo**.

  As fotos da abertura são as **Fotos de capa** do projeto, completadas pela
  capa de cada evento. Em todos os estilos:
  - a **linha do tempo** dos eventos, com o período de cada um ("mai – jun
    2026", "2024 – 2026") pelas datas de captura e em ordem de data;
  - **Quem fotografou**, com quantas fotos cada pessoa tem no álbum;
  - o **Recado final**, um campo novo no projeto.

  O visual é escuro, com o amarelo e o azul do Colégio Santa Cruz (#F9DE4B e
  #243580). Títulos e textos usam **Open Sans** e as legendas das polaroids
  usam **Caveat**, servidas pelo próprio site e só nesta página. As fontes
  oficiais do colégio (Xenois Sans Pro e Visby Round CF) são comerciais e com
  licença da escola. A Open Sans é a fonte reserva do próprio site do colégio
  e, medida letra por letra, a livre mais parecida com a Xenois.
- **entrenos2026.com como endereço principal do álbum.** O canonical, o
  cartão de link e o QR code do álbum usam o domínio. O robots.txt do
  entrenos2026.com anuncia o sitemap do álbum, e os sitemaps do
  fotos.lucafchala.com deixam essa galeria de fora (a página do projeto
  continua lá).
- **Dica de envio:** quando os créditos têm a pasta `outros`, a abertura diz
  "Para mandar fotos: abra o evento e a pasta outros". É o caso do álbum da
  turma, com a pasta do Drive em somente leitura e só as `outros` abertas.
- **Pré-lançamento.** Um álbum só aparece para o público quando é
  **lançado**: fica fora do "Em breve" e marcado como visível. Antes disso:
  - o domínio mostra "em breve";
  - o destaque do site não aparece;
  - só o dono, logado, vê a galeria e testa a busca pelo rosto.

  O indexador lê o álbum ainda fechado com um token só dele (secret
  `ROSTO_INDEXADOR_TOKEN`, no Worker e no GitHub).
- **Destaque máximo no site** (opção do projeto): a faixa azul no topo da home
  e das páginas de projeto, o cartão grande no começo da home e o popup da
  primeira visita. Tudo só depois do lançamento.
- **Aviso do lançamento nos outros sites.** `fotos.lucafchala.com/destaque.js`
  (uma linha de script em cada site) desenha a mesma faixa, isolada do CSS do
  site, com os dados de `/api/destaque` (CORS aberto). Antes do lançamento,
  não desenha nada.
- **Apoie o projeto (Pix).** Com chave, nome e cidade no projeto, a página do
  álbum ganha uma seção discreta no fim, com QR code e "Pix copia e cola"
  (BR Code estático, sem valor fixo e sem taxa). O código é conferido contra o
  exemplo do manual do Banco Central. O dinheiro vai direto do banco de quem
  doa para o dono, e o site não fica sabendo quem doou. A chave aparece na
  página, então CPF não é aceito; o painel recomenda a chave aleatória.
- **Favicon e cartão de link do entrenos2026.com**: "EN" no azul da escola e um
  cartão 1200×630, sem foto de ninguém.
- **"Em breve" com o azul e o amarelo da escola**, "Turma 2026 · Colégio
  Santa Cruz" e "Fotos de Luca F. Chala e Mag".
- **Busca pelo rosto mais certeira.**
  - **Busca em duas etapas:** as fotos em que a pessoa aparece com
    semelhança de 98% ou mais procuram os rostos parecidos com elas. Isso
    acha a mesma pessoa de lado, de longe ou com pouca luz.
  - **Fotos de grupo:** o indexador usa a foto com 2400 px e até 100 rostos
    por foto.
  - **Muita gente buscando ao mesmo tempo:** a página espera e tenta de novo
    sozinha, até 3 vezes.
  - **Uma chamada paga a menos por busca:** enquanto ninguém saiu da busca
    no álbum, a coleção de quem saiu não é consultada.

### Corrigido

- Com menos de 3 fotos de capa escolhidas, a abertura ficava sem mosaico.
  Agora as capas dos eventos completam.

## [3.2.0] — ainda não publicada

Função nova, **desligada até o dono ligar**: a busca pelo rosto. Nada muda no
site sem as chaves da AWS no Worker; com elas, só nos projetos marcados. Passo a
passo, custos e LGPD em `docs/ROSTO.md`.

### Novo

- **Busca pelo rosto** (fecha #273). Opção do projeto "Busca pelo rosto": o
  índice da galeria por capítulos ganha o botão **Procurar meu rosto**. O
  visitante marca que concorda, tira uma selfie (reduzida no aparelho para
  640 px) e vê as fotos em que provavelmente aparece, da mais parecida para a
  menos parecida, cada uma abrindo no capítulo dela. A comparação é feita pela
  **Amazon Rekognition em São Paulo**; a selfie não é guardada. Só em álbum
  público, com Turnstile, token do formulário, teto por IP e teto de custo do
  site inteiro.
- **"Não quero aparecer na busca".** Pelo mesmo botão, a pessoa envia uma
  selfie e sai da busca: os rostos parecidos saem do índice, e as fotos novas
  também não a mostram.
- **Indexador** (`scripts/rosto-indexa.mjs`, workflow `rosto` a cada 30 min):
  lê as páginas públicas do álbum e mantém o índice igual ao que o visitante
  vê, sem foto oculta e sem vídeo. Só roda com a variável `ROSTO_SLUGS`.
- **Política de privacidade** (6 de novembro de 2026): seção 3.1 "Busca pelo
  rosto", a Amazon Web Services entre os operadores e os prazos do índice.

## [3.1.0] — 2026-11-06

Função nova para o dono e para o visitante, mais **duas tabelas novas no D1**
(`galeria_snapshot` e `galeria_apagadas`, migrações `0003` e `0004`, aplicadas
pelo deploy) e **Termos e Privacidade 2026-11-06**: a pasta do Drive de um
projeto pode ser colaborativa, e o "Pedir remoção" passou a depender da
decisão do dono.

### Novo

- **Pasta do Drive colaborativa.** Qualquer pessoa com o link envia fotos
  (e também pode apagar): continue com "Qualquer pessoa com o link: Editor".
  As defesas são as abaixo; o porquê está em `RETOMADA.md` §5.20.
- **Créditos por pasta de autor.** Campo "Créditos por pasta" (`pasta = Nome`,
  até 20 linhas, e-mail opcional que nunca sai do servidor): "Fotos: Ana e
  Bruno", filtro por fotógrafo, "Foto: Nome" no visualizador e JSON-LD por
  autor. A linha `* = Nome` define o autor das fotos que não estão em pasta de
  autor.
- **Aviso por e-mail ao autor** quando chega um pedido de remoção de foto
  dele, quando o dono decide e quando oculta ou devolve a foto (nunca o e-mail
  nem a mensagem de quem pediu; um aviso por foto e tipo a cada 24 h, teto de
  20/dia).
- **Galeria por capítulos.** Opção do projeto: `/galeria/<projeto>` vira um
  índice de cartões (um por subpasta de primeiro nível) e cada capítulo abre
  em `/galeria/<projeto>/<capítulo>`. Contadores, sitemap, download, pedido de
  remoção e aviso ao autor são por capítulo; capítulo vazio some do índice.
  Cartão de link (Open Graph) por capítulo e no índice, com capa e contagem; em
  álbum de família ou privado o cartão sai genérico.
- **Todas as mídias da pasta.** Vídeos (com a duração), Live Photos (o vídeo
  curto de mesmo nome vira parte da foto) e fotos HEIC/HEIF do iPhone entram
  na galeria. O vídeo abre como fachada ("Tocar"): nada do Google carrega
  antes do toque, e a CSP libera o player do Drive só em página com vídeo.
  Download do vídeo em fluxo, nos bytes originais.
- **Nomes amigáveis nos downloads** (opcional, desligado): só o nome do
  arquivo baixado muda (`<Título> - <Seção> - <Autor> - <data>`), nunca o
  conteúdo.
- **Atualização automática com período** (10 min, 1 h, 6 h ou 24 h) e a
  **foto durável da lista** no D1. Desligada, a galeria mostra a última lista
  até o dono tocar em "Atualizar agora": é a moderação de uma pasta
  colaborativa.
- **Aviso de fotos apagadas do Drive** (e-mail-resumo ao dono, cópia ao autor)
  e "Fotos apagadas recentemente" no painel (30 dias).
- **Fotos novas desde a última visita** (fecha #250): marca "nova", chip "Só
  as novas" e "N novas" no cartão do capítulo. A última visita fica só no
  `localStorage` do visitante; nada vai ao servidor e não há cookie novo.
- **QR code da galeria no painel** (fecha #251): no menu "⋯" do projeto, com o
  link do índice ou de cada capítulo, **Baixar PNG** e **Baixar SVG** em alta
  resolução, com o título embaixo.
- **Aba Galeria nas métricas**: aberturas por dia, fotos baixadas (redes e
  tamanho máximo), baixadas por abertura, comparação com o período anterior,
  ranking por capítulo e CSV.
- **Domínio próprio do álbum.** `entrenos2026.com` abre direto na galeria do
  álbum da Turma 2026 (projeto `entrenos2026`); `www.` vai para o domínio sem
  `www.`, o painel volta para `fotos.lucafchala.com` e o resto do site responde
  igual. Enquanto o projeto não existe (ou está oculto), a raiz mostra uma
  página "em breve" em vez de um 404. O domínio é ligado ao Worker no painel da
  Cloudflare (Custom Domain) e precisa estar também no widget do Turnstile.
- **Abertura do álbum.** Campo "Texto de abertura do álbum" no projeto: o
  índice da galeria por capítulos ganha mosaico com as capas dos eventos,
  título grande, o texto, os números do álbum (eventos, fotos e autores) e os
  botões **Ver os eventos** e **Mandar suas fotos** (só em álbum público).
  Vazio, o índice continua como antes.

### Mudou

- **"Pedir remoção" é só por aprovação.** O pedido vai ao painel e por e-mail
  ao dono; a foto **continua na galeria até ele decidir**. "Remover da
  galeria" esconde a foto e avisa quem pediu e o autor; "Manter na galeria"
  avisa os dois. "Responsável por um menor" tem prioridade. Saem os tetos de
  ocultação por IP e por álbum; ficam os limites por IP (30 por dia no painel,
  até 200 só por e-mail, depois uma página amigável).
- **Pico de acessos.** Lista vencida servida na hora e relida por um só;
  download com fila no navegador ("Na fila... tentando de novo"), botão
  "Baixar o evento inteiro (Google Drive)" por capítulo e limites por IP em
  degraus.
- **Termos e Privacidade (2026-11-06)**: vários autores, álbum colaborativo,
  nomes amigáveis, pedido de remoção por aprovação, dados lidos do Drive,
  contagem por capítulo, `localStorage`, as novas tabelas, o player do Drive
  como terceiro depois do toque. ROPA, retenção, checklist e transferência
  internacional acompanham.
- **Orçamento de subrequisições**: tetos de páginas da listagem menores
  (26, 6 e 18) para dar folga à detecção de fotos apagadas e ao D1.
- Sai o popup "Nova galeria de fotos" da página do evento.

### Corrigido

- A capa do cartão de capítulo no índice da galeria esticava para 320 px de
  altura em tela estreita; agora segue a proporção 3:2.

- O teste de CPU da página de 6000 itens compara com uma carga de referência
  medida junto (razão), em vez de um teto absoluto que oscilava sob carga.
- README e TODO sem o fluxo antigo de "ocultar na hora" e sem "nome e bytes
  exatos" para o arquivo baixado.
- **README novo**, curto, com o que o site faz para o visitante e para o dono;
  a referência técnica completa passa a `docs/REFERENCIA.md`.
- Dependências de desenvolvimento: eslint 10.14.0, `@cloudflare/workers-types`
  5.20261102.1 e wrangler 4.156.2 (Dependabot #261, #262, #263).

## [3.0.0] — 2026-11-06

**Maior** porque muda o que o visitante aceita (Termos e Privacidade
2026-10-29) e o formato do backup (v3).

### Novo

- **Galerias dos álbuns públicos no Google.** `/galeria/<slug>` de álbum
  público sai com `index, follow`; família, privado, "Em breve", não
  listado, prévia de PR e a visão do dono continuam `noindex`. As galerias
  entram no `/sitemap.xml`, e o `/sitemap-galerias.xml` aponta um sitemap
  de imagens por galeria (até 1000 fotos, com `lastmod`). Título "Fotos de
  <evento> — <data>", canonical, JSON-LD `ImageGallery` ligado ao `Person`,
  `og:image` da capa e alt "<evento> — foto i de n". Downloads fora dos
  buscadores (`Disallow` no `robots.txt`, `X-Robots-Tag: noindex`,
  `rel="nofollow"`); `ai-train=no` mantido. Foto oculta sai do HTML e do
  sitemap em até 2 minutos (o prazo de qualquer mudança do painel); para
  tirar do Google com urgência, Search Console →
  Remoções (docs/RELEASE.md).
- **Download do arquivo exato.** "Tamanho máximo" entrega o original do
  Drive, byte a byte, com o nome exato (sem o prefixo do projeto). "Para
  redes" entrega, também sem alterar, o arquivo correspondente da pasta "Para
  o Instagram" do projeto; foto sem versão lá não oferece "para redes". Nada
  é redimensionado no download.
- **Salvar por aparelho.** Android e computador baixam o arquivo direto, sem
  a folha de compartilhar. No iPhone e no iPad, "Salvar no Fotos" abre a
  folha do sistema com o arquivo exato ("Salvar imagem" põe direto no app
  Fotos), e "Baixar arquivo" salva no app Arquivos.
- **Compartilhar as favoritas** (#213). Com o filtro "Favoritas", o botão
  "Compartilhar as favoritas" gera um link `#sel=…` que abre a galeria só
  com essas fotos ("Seleção recebida", com "Guardar nas minhas favoritas").
  Nada gravado no servidor; até 300 fotos; família e privado continuam
  pedindo o passe.
- **Galeria nas métricas do painel.** Aberturas da galeria (uma por hora por
  navegador; o dono não conta) e fotos baixadas por versão, por dia: linha
  da galeria no gráfico de acessos, bloco "Fotos baixadas na galeria",
  cartões, ranking, tabelas e CSVs. A taxa de abertura passa a ser (Drive ou
  galeria) ÷ visitas.
- **Backup v3 com o registro de consentimento.** A tabela
  `image_use_consent` entra no backup em formato compacto (até as 1500
  linhas mais recentes; acima disso o arquivo diz que é parcial, e o
  `wrangler d1 export` é o caminho completo — docs/RELEASE.md). A
  restauração só acrescenta (`INSERT OR IGNORE`), valida cada linha e é
  pulada na prévia. Backups v1 e v2 restauram como antes. O arquivo de
  backup passa a ter IP: ROPA e política de retenção atualizadas.
- **Declaração de acessibilidade** publicada em
  `/legal/declaracao-de-acessibilidade`.
- **"Pedir remoção desta foto" na galeria.** Cada foto do visualizador
  tem, sob a legenda, o link discreto "Pedir remoção" (só para visitantes).
  Abre um diálogo com a miniatura, e-mail, motivo (sou eu / menor de idade /
  outro) e mensagem opcional, com Turnstile carregado só nesse momento. O
  `POST /api/galeria/remocao` registra o pedido no painel (com e-mails, e
  prioridade para menor) e **oculta a foto na hora** em `fotosOcultas` e em
  `ocultasPendentes`. Tetos: 5 ocultações por IP/dia e 20 por álbum/dia
  (acima disso o pedido é registrado e avisado, mas a foto não é ocultada), e
  10 pedidos por IP/dia. No painel, o pedido mostra a miniatura e o álbum,
  com "Manter oculta" e "Devolver à galeria"; o dono vê o selo "Oculta a
  pedido". Custo: 1 escrita de KV no evento mais 2 do pedido.

### Mudou

- **Termos e Privacidade 2026-10-29.** A galeria dos projetos públicos abre
  sem aceite; as galerias públicas podem aparecer em buscadores; cookies
  `gv_…` e `galeria` listados; cópia do registro de aceite no backup. Os
  textos legais valem sem revisão jurídica, por decisão do responsável
  (#125 fechada).
- **Capas responsivas** (#141). Carrossel, visualizador e pré-carga pedem
  800, 1200 ou 1600 px conforme os pixels físicos da tela, em vez de sempre
  1600.
- **Turnstile só na hora.** Na página do projeto ele carrega na primeira
  interação ou ao abrir o portão. Lighthouse celular (cópia local do
  `/ecp125`): desempenho 82–86 → 95–99, TBT 470–620 → 116–250 ms.
- **Galeria mais leve na primeira tela**: só as fotos da primeira tela
  carregam de imediato, escada da grade de 100 em 100 px até 800, CSS do
  visualizador fora do `<head>`, coração em CSS. Lighthouse celular local:
  SEO 50 → 92, desempenho 72–80 → 84–90.
- **`scripts/smoke.sh`** reprova HSTS abaixo de 1 ano (a borda da Cloudflare
  respondia 180 dias no domínio próprio — #257).

- **Limite por IP no download da galeria.** Cada IP tem um balde de fichas
  (6 mil de rajada, 20 mil por hora: um Wi-Fi de evento com 750 pessoas e
  ~20 fotos cada cabe com folga); esgotado, responde 429 com `Retry-After` e
  a galeria mostra a espera em vez de repetir. O dono não passa pelo balde.
- **Robôs conhecidos fora da contagem.** Visitas do projeto e aberturas da
  galeria ignoram o que o Cloudflare marca como robô verificado e uma lista
  curta de User-Agents (Googlebot, Bingbot, prévias de link...). Os números
  do painel ainda podem incluir robôs desconhecidos.
- **Taxa de abertura limitada a 100%**, em cartões, ranking e tabela:
  "aberturas (Drive ou galeria) ÷ visitas, limitado a 100%" (quem chega à
  galeria pelo Google não passa pela página do projeto).

### Corrigido

- **CLS da página do projeto** (0,334 no PageSpeed): a capa e o carrossel
  reservam uma caixa 3:2 antes de a foto chegar, com a foto inteira dentro.
- **Corrida do portão**: abri-lo antes de o script do Turnstile terminar
  caía no caminho sem JavaScript.
- **Testes instáveis** do portão do Drive e do login, que dependiam do
  relógio real sob carga.
- **Compartilhar e a segunda leitura do iPhone não contam como download**
  (`?c=0`, só leitura; o arquivo servido é o mesmo). "Salvar no Fotos"
  recusado pelo sistema mantém a folha aberta com a mensagem.
- **Lista "para redes" não confunde tetos**: o cache da listagem leva o teto
  de páginas na chave; pasta do Instagram igual à da galeria vale como "sem
  pasta do Instagram". O casamento de nomes (6 mil fotos) fica em cache.
- **Restaurar backup**: o consentimento é restaurado antes dos pedidos de
  remoção, e uma seção que falha não esconde as outras.

## [2.2.1] — 2026-11-06

### Mudou

- **Dependências de desenvolvimento** atualizadas num PR só (juntando os PRs
  do Dependabot #228, #237, #238, #240 e #243): `eslint` 10.13.0, `wrangler`
  4.152.0, `@cloudflare/workers-types` 5.20261026.1, `playwright-core`
  1.64.1 (Chromium 156 nos roteiros) e `@cloudflare/vitest-pool-workers`
  0.23.0. Nada muda no que vai ao ar além do bundle gerado pelo `wrangler`
  novo. O `vitest-pool-workers` avisa que passou a se chamar
  `@cloudflare/vitest-plugin`; a troca fica para o #180.

## [2.2.0] — 2026-11-06

### Novo

- **Ocultar uma foto da galeria.** O dono abre a foto na galeria e toca no
  olho ("Ocultar dos visitantes"): a foto some para o público em até 2 min —
  o visitante recebe a lista já sem ela, e o download dela vira 404. O dono
  continua vendo, apagada e com o selo "Oculta", e toca de novo para mostrar.
  É o caminho de um pedido de remoção (LGPD) enquanto a foto não sai do
  Drive; o texto dos pedidos no painel diz isso. Até 500 por projeto, uma
  escrita de KV por clique.
- **Downloads da galeria contados por versão.** Cada foto baixada por
  visitante soma em "para redes" ou "tamanho máximo" (Durable Object, nunca
  KV por visitante). O painel mostra a coluna "Galeria ↓" nas métricas, e o
  CSV ganhou `baixarRedes` e `baixarMax`.

### Mudou

- **Documentação** deixa de chamar a galeria de "prévia só do dono": diz quem
  vê (álbum público, todos; família e privado, com o passe; "Em breve",
  ninguém).

## [2.1.1] — 29/10/2026

### Mudou

- **Cabeçalho da galeria no celular.** O botão Compartilhar vira só o ícone
  em telas estreitas (o nome continua para leitor de tela), e os quatro
  botões cabem numa linha: as fotos sobem na tela. Acima do título, um link
  "‹ Página do projeto" para o visitante voltar ao álbum — antes só o dono
  tinha esse caminho, na faixa do painel.
- **Selo "Novidade" do popup** com um ícone desenhado no lugar do emoji ✨,
  que aparecia como um quadrado em aparelhos sem fonte de emoji.

### Corrigido

- **Roteiro de navegador da prévia** (`npm run verifica:previa`) voltou a
  passar: o popup da nova galeria cobria a faixa da prévia e o clique
  esperava 30 s. O roteiro entra como quem já viu o popup, e o popup ganhou
  roteiro próprio em `scripts/verifica-evento.mjs` (abre centralizado, não
  fecha durante a contagem, fecha depois e não volta; "Abrir no Drive" fecha
  na hora e abre o portão).

## [2.1.0] — 29/10/2026

### Novo

- **Galeria própria aberta aos álbuns públicos** (#244). `/galeria/<slug>` de
  um álbum público abre para qualquer visitante, sem login e sem o portão do
  Drive; nos álbuns de **família e privados**, só com o **passe "galeria"** —
  um cookie assinado de 12 h, preso ao caminho `/galeria/<slug>`, que o
  portão do Drive emite depois da declaração de acesso. Álbuns "Em breve"
  continuam fechados (o mesmo 404).
- **Popup "Nova galeria de fotos"** na página do álbum público. Aparece uma
  vez por visitante, centralizado, não fecha nos primeiros 4 segundos, lista
  as funções e mantém o link de texto para o Drive.
- **Ícone de bug no cabeçalho da galeria**, que leva ao formulário de suporte
  (`/suporte`).
- **Botão Compartilhar no topo da galeria.** Compartilha a página do projeto
  (com capa e resumo nas redes); no celular abre o menu do aparelho, no
  computador copia o link.

### Mudou

- **Página do álbum público: a galeria é o caminho principal.** O botão
  principal e o botão fixo viram "Ver e baixar as fotos" e levam direto à
  galeria, com instruções; o Google Drive vira opção secundária ("Prefere o
  Google Drive? Abrir no Drive").
- **A galeria deixa de falar em "prévia".** O título não diz mais; a faixa do
  dono (atalhos do painel e "Atualizar lista") só aparece para o dono logado;
  o `?atualizar` só relê o Drive para ele; e o aviso "A pasta também tem N
  vídeos" saiu.
- **Fotos maiores no celular.** A altura-alvo da linha da grade sobe de 118
  para 300 px (foto deitada ocupa a largura toda; em pé, duas por linha), e as
  miniaturas vão até 1600 px de largura para não borrar em tela densa.
- **Popup com ícones**: um ícone por função, animação de entrada e o botão
  "Ver a nova galeria →".

### A rever

- **Galeria dos álbuns públicos sem registro de consentimento nem Turnstile.**
  Decisão do dono, para reavaliar — já anotada no ROPA.

## [2.0.0] — 29/10/2026

> Publicada em 29/10/2026 (PR #236).

### Novo

- **Beacon de performance com INP, CLS e erros de JavaScript.** O beacon
  amostrado de `/api/perf` passa a medir interação (INP) e estabilidade
  visual (CLS) e a relatar até 3 erros de JS por visita (`error` e
  `unhandledrejection`), com mensagem de no máximo 200 caracteres e sem URL,
  e-mail nem token. Segue anônimo (sem cookie) e **sem escrita em KV**: tudo
  vai para o log (`wrangler tail`) e, se existir, para o Analytics Engine, com
  teto de 120 erros por minuto por isolate.
- **"Sair dos outros aparelhos"** em Ajustes → Conta. Encerra a sessão do painel
  em todos os aparelhos menos o atual (`POST /api/sessions/revoke-others`); em
  outro lugar pode levar até 30 s.
- **Lembrete de backup** em Ajustes → Dados: "Último backup: hoje / ontem / há N
  dias", que vira aviso se o backup nunca foi baixado ou tem mais de 30 dias.
  Nova chave KV `backup:ultimo`, gravada pelo `GET /api/backup` (o `HEAD` não
  conta).
- **Galeria própria, em prévia só do dono** (#235). As fotos da pasta do Drive
  de cada projeto dentro do site, em `/galeria/<slug>`: grade justificada na
  proporção real, visualizador na resolução física da tela, zoom que busca
  degraus maiores até o original, downloads "para redes" (2048 px) e "tamanho
  máximo" (o original, pela Drive API, com a chave só no servidor), seleção de
  várias fotos e "Salvar na galeria" no celular. Para qualquer outra pessoa,
  a rota é o mesmo 404 de uma rota inexistente. Precisa do secret
  `GOOGLE_DRIVE_API_KEY` (passo a passo no README, "Galeria própria").
- **Painel em blocos** (#220). Uma navegação só — barra lateral no computador,
  barra de baixo no celular —, card de evento com o estado escrito em selos e
  um menu "⋯", formulário em seis blocos recolhíveis com resumo, Ajustes em
  grupos (Site, Dados, Conta, Sobre) com as ações sensíveis marcadas.
  Referência completa em [`docs/PAINEL.md`](./docs/PAINEL.md).
- **Métricas com gráfico** (#215). Contagem por dia (no mesmo Durable Object,
  na mesma gravação do total — nenhuma chamada a mais por visita), gráfico de
  visitas × aberturas do Drive com a cruz que mostra o dia (mouse, toque e
  teclado), tabela e CSV da série, comparação com o período anterior, média
  por dia da semana, os **modos do portão** (verificação automática, código
  por e-mail, sem JavaScript) e cada projeto com a sua curva. Filtro de 7, 30
  ou 90 dias e por projeto.
- **Prévia de cada PR** (Cloudflare Worker Previews). Um site de teste por PR,
  com o mesmo código e configuração de produção e **dados próprios**, faixa
  "PRÉVIA" e e-mails com "[PRÉVIA]" no assunto. Ligar exige três passos no
  painel da Cloudflare — README, "Prévia de PR". Os segredos das prévias
  moram no build (`PREVIA_*`) e o `npm run previa` os leva a cada prévia a
  cada push: a configuração base da Cloudflare só vale na criação de cada uma.
- **Menu "Testes" na faixa da prévia**, para ver cada salvaguarda funcionar
  sem esperar ela acontecer. *Simulações*, só no navegador de quem liga: o
  Turnstile (passa, caixa, bloqueia, servidor recusa, script bloqueado), o
  e-mail (**tudo para o dono** — testar com endereço inventado sem escrever
  para ninguém —, envio que falha, sem e-mail), o **portão do Drive lotado**
  (a espera "muita gente acessando agora" e o código por e-mail no fim), o
  banco fora (KV que não lê ou não grava, D1 do consentimento), a chave do
  Drive da galeria e a rede lenta. *Ações*, com o painel aberto: gerar 90 dias
  de **métricas de exemplo**, apagá-las, zerar os limites do aparelho. Do
  roteador para dentro, o código é o de produção.
- **Versão do site** à vista no painel, com o resumo do que esta versão trouxe.

### Melhorado e corrigido

- **Um handler que rejeita agora vira 500 e alerta.** Em `worker.fetch`, as rotas
  devolviam `handleX(...)` dentro do `try/catch` sem `await`: a rejeição de um
  handler assíncrono (por exemplo, o KV recusando a leitura em `GET /api/backup`)
  escapava do catch-all, sem página 500 e sem o e-mail de `sendErrorAlert`.
- **Segurança da prévia de PR.** Restaurar um backup numa prévia (pública, com o
  Turnstile de teste) entregaria o link real do Drive dos álbuns `private` e
  `family` a quem chamasse `POST /api/drive-link`. Agora, na prévia, o restore
  troca esses links por um falso.
- **Dica sob "Visível na galeria" (#128).** "Oculto" quer dizer não listado: some
  da página inicial, mas quem tem o link ainda abre.
- **Contraste AA em todo texto do painel.** O cinza apagado era `#555` (2,5:1
  sobre os blocos) e virou `#8a8a8a` (5,3:1): datas, dicas e rótulos ficam
  legíveis no celular, na rua. Abaixo de 4,5:1 também estavam os selos
  "Atrasado" (3,4:1) e "Arquivado" (3:1), o texto dos botões de excluir
  (3,4:1), as dicas "(opcional)" dos rótulos (2,5:1) e — justo a linha que o
  dono precisa ler — a falha de envio de e-mail num pedido de remoção (3,2:1).
  Há teste que calcula o contraste das próprias cores da página, o de cada
  selo sobre o card, e que proíbe cor de texto escrita à mão em linha.
- **Foco visível em tudo que recebe foco.** Campo de texto, seletor e caixa
  de texto ganham o mesmo contorno dourado de 2 px dos botões; antes só a
  borda escurecia (1,7:1 sobre o fundo — quem navega pelo teclado não via onde
  estava). Os três toggles do formulário não mostravam foco nenhum (o
  checkbox é invisível; agora o contorno vai no trilho); o contorno dos chips
  de filtro e dos atalhos do formulário era cortado pela faixa que rola, e o
  do campo da URL, pela caixa do prefixo. O gráfico de acessos em foco também
  (o anel cinza tinha 2,1:1).
- **O selo de Pedidos sumia de verdade com zero pendentes.** Ele era escondido
  com o atributo `hidden`, mas a classe dele tinha `display: inline-flex`, que
  vence o `hidden`: sem pedido nenhum, aparecia um círculo vermelho vazio ao
  lado de "Pedidos" — o estado normal do painel. Agora `hidden` esconde sempre,
  em toda a página.
- **"Sem categoria" tira a categoria de um evento.** O servidor recusava o
  vazio e mantinha a categoria antiga; só a seleção em massa conseguia limpar.
- **"Ocultar/Mostrar" não desfaz mais o que outro aparelho editou.** Mandava o
  evento inteiro como a página o conhecia ao abrir; agora manda só a
  visibilidade, como o "Destacar".
- **O formulário percebe mais alterações.** Num evento novo, digitar só a URL
  e fechar não perguntava antes de descartar (e o rascunho de sessão expirada
  voltava sem a URL); e o resumo do bloco recolhido ("2 capas") não acompanhava
  adicionar, remover ou colar fotos.
- **A aba ativa fica branca no celular.** A aba recém-tocada fica "em hover" no
  toque, e a cor do hover apagava a da ativa: só o ícone dourado dizia onde se
  estava.
- **A folha de "Novo evento" não rouba mais o foco.** Ela põe o cursor na URL
  100 ms depois de abrir — e, se nesse meio-tempo a pessoa já tinha tocado
  noutro campo, o que ela digitava ia parar na URL. Agora só põe se ninguém
  estiver num campo da folha.
- **Celular**: campos de 16 px (o iPhone não dá zoom ao tocar), alvos de toque
  de 44 px — agora também a busca, os filtros e o seletor de projeto das
  Métricas, que tinham 41–43 px, os botões das confirmações e o "Adicionar
  foto", que tinham 35–40, o × de excluir categoria, que tinha 20, e as caixas
  do "Selecionar vários" e os toggles —, os itens do menu "⋯" com 48 px na folha
  de baixo (uma regra de toque posterior os baixava para 44), e um bloco de
  Ajustes 25 px largo demais que fazia o celular afastar a página inteira.
- **Leitor de tela**: os avisos do painel são anunciados (o toast virou região
  viva) e quebram linha em vez de sair pelas bordas; com uma folha ou uma
  confirmação aberta, a página atrás fica inerte (nem o foco nem o leitor
  escapam para lá); e todo campo tem nome — o "Quando o aviso some", a caixa de
  colar links e as linhas de URL das fotos só tinham o texto de exemplo.
- **A lista de projetos conta certo.** "1 evento ativos" virou "1 evento
  ativo"; com uma categoria escolhida, "Todos" contava os eventos do site
  inteiro, não os da lista; e uma categoria sem eventos dizia "Nenhum evento
  ainda. Toque em Novo evento…" — agora diz a combinação de filtros.
- **Sessão expirada no meio de uma edição.** O painel já guardava um rascunho
  e voltava ao login, mas o navegador perguntava "Sair do site? As alterações
  podem não ser salvas" — falso, e quem respondia "Ficar" seguia numa página
  sem sessão, onde cada ação perguntava de novo. Agora vai direto, e entrar de
  novo devolve a edição.
- **"Novas fotos": religar reinicia o contador**, como a dica do campo
  promete. Desligar e ligar de novo na mesma edição mantinha a hora antiga (era
  preciso salvar desligado no meio); agora reinicia — e conta como alteração,
  então fechar sem salvar pergunta antes de descartar.
- **Esvaziar as fotos de capa tira a capa.** A primeira foto antiga continuava
  no card da galeria e no topo da página do projeto — uma foto retirada por um
  pedido de remoção seguia no ar.
- **"Painel temporariamente indisponível" legível no celular.** As duas
  páginas curtas do painel (KV fora, painel não configurado) eram um parágrafo
  solto, sem `viewport`: o celular as desenhava em 980 px e o texto saía
  minúsculo — justo quando o dono abre o painel pelo celular para entender o
  que caiu. O `verifica:previa` pegou.
- **Pedidos de remoção, um por chave** (#198). Eram um array único, regravado
  inteiro por cinco caminhos: dois pedidos no mesmo instante, ou um pedido
  chegando durante um "resolver", e um deles sumia do painel (o e-mail ao dono
  sempre saiu). Agora cada pedido tem a sua chave e nada regrava o que não é
  seu. O array antigo é migrado pelo cron diário, sem perda — até lá o painel
  lê os dois. A lista lê em lotes de 100 (uma operação do KV por lote).
- **O "e-mail enviado" do pedido de remoção** chega ao registro do painel. O
  envio grava o pedido e, depois dos e-mails, grava de novo a mesma chave com
  o resultado — mas o KV recusa a segunda escrita na mesma chave dentro de um
  segundo, e os e-mails costumam voltar antes disso. O carimbo agora espera a
  janela (a resposta do formulário demora até ~1 s a mais).
- **Um defeito que só existia no bundle de produção**: o deploy empacota com
  esbuild + `keepNames`, que embrulha função nomeada em `__name()` — e o card
  do painel, levado ao navegador por `toString()`, quebraria no primeiro
  redesenho. A suíte passava (ela roda o fonte cru); o teste novo aplica a
  mesma transformação do deploy.
- **CodeQL**: o teste da galeria deixou de tirar `<script>` com regex (as duas
  falhas que o CodeQL apontou); o ajudante novo anda como o tokenizador.

- **Salvar um evento diz quando o site mostra a mudança.** O aviso dizia só
  "Evento adicionado!"; agora diz "O site mostra em até 1 min" — 30 s do cache
  do site, mais até 30 s para a Cloudflare espalhar a mudança. O selo da agenda
  diz o mesmo.
- **Baixar o backup com a sessão expirada leva ao login.** O download era um
  link, e o navegador mostrava o JSON do erro; agora é um pedido comum, e o 401
  vai ao login, como no resto do painel.
- **A seleção em massa só tem o que está à vista.** Um filtro que escondia um
  card o deixava na seleção, e a confirmação contava também os escondidos: a
  conta podia dizer 5 com um só card na tela.
- **Celular: a barra do "Selecionar vários" cabe na tela.** Os pares de
  categoria e de acesso empilham; o "Aplicar acesso" saía pela direita, numa
  barra de 398 px num aparelho de 390.
- **Ajustes com texto não salvo pergunta antes de sair** — a senha nova, a
  categoria nova, o selo e o arquivo do restaurar. Antes, só o formulário de
  evento avisava.
- **O "Todos" do "Selecionar vários" acompanha as caixas**: desmarcar um card
  deixava o "Todos" marcado até a lista ser redesenhada.

- **Portão do Drive, quatro acertos.** O texto do código por e-mail não afirma
  mais que ele já foi enviado ("Ao tocar em Enviar código, mandamos…"); o motivo
  do teto de álbuns restritos aparece antes do campo, perto da ação; a janela do
  portão fica acima do aviso de cookies no celular; e o aviso de bloqueador tem
  folga antes do campo de nome.
- **Ícones PNG de verdade.** O `apple-touch-icon` apontava para o SVG, que o iOS
  ignora, e o manifest não tinha PNG. Agora há `/apple-touch-icon.png` (180),
  `/icon-192.png`, `/icon-512.png` e `/icon-512-maskable.png`, gerados por
  `npm run build:icons` (sharp), e toda página liga o manifest. O `/suporte`
  ganhou o canonical que faltava.
- **"Pedir orçamento" (#210).** O botão da página /sobre leva ao /suporte com um
  modelo de mensagem já preenchido (tipo de evento, data, local, pessoas).
- **Contraste AA nas páginas públicas.** Os textos apagados (`text-dim`,
  `text-dim-2`, placeholders) passam de 4,5:1 nos dois temas;
  `tests/contraste-publico.test.js` mede o CSS de cada página.

### Segurança e LGPD

- **A revogação de sessões fecha a janela do cache do KV.** O "Sair dos outros
  aparelhos" — e a troca de senha, que usa a mesma implementação — grava o
  marcador `admin_sessions_corte` (TTL 25 h), que `verifySession` consulta antes
  de renovar o `lastSeen`. Antes, o cache do KV deixava um aparelho revogado
  entrar e a renovação do `lastSeen` ressuscitava a sessão por mais 24 h.
- **CSP estrita aplicada (#126).** Toda página HTML sai com um único cabeçalho
  `Content-Security-Policy`, com `nonce` por resposta e sem `'unsafe-inline'`
  em `script-src` (o `style-src` mantém `'unsafe-inline'`). Violações chegam a
  `/api/csp-report`. Deixou de existir o cabeçalho Report-Only, e os roteiros de
  navegador reprovam qualquer mensagem de CSP no console.
- **Termos 2026-10-18.** O §3 deixa de dizer "acesso restrito a membros da
  família" e "a participantes ou pessoas autorizadas": nos álbuns de família e
  privados o acesso se apoia no consentimento, não em senha. As finalidades não
  mudam (quem aceitou os Termos de 2026-06-18 segue coberto). `TERMS_VERSION`
  sobe, e os novos aceites ficam atrelados ao texto novo.
- **Texto alternativo por foto.** No formulário do projeto, "Descrição das fotos
  (para leitor de tela)": uma linha por foto de capa, na ordem, até 140
  caracteres. A página usa a descrição no carrossel e no visualizador; a foto
  sem descrição segue com o título do projeto.
- **IA e treino.** `robots.txt` e `llms.txt` passam a dizer `ai-train=no` /
  "Training not allowed" em todos os grupos, e os robôs que só treinam (GPTBot,
  ClaudeBot, Google-Extended, CCBot, entre outros) levam `Disallow: /`. Busca e
  resposta de IA continuam permitidas.
- **"Em breve" fora da busca.** A página de um projeto "em breve" manda
  `noindex` e sai do `sitemap.xml` até ser publicada.
- **Cartão de link padrão.** Toda página pública sem foto própria ganha
  `og:image` 1200×630 (`/og-padrao.png`, gerado por `npm run build:icons`).
- **Cron de 5 em 5 minutos só para o Kuma.** O carimbo `cron:last` e as podas
  seguem uma vez por dia, na execução das 03:00 UTC: nenhuma escrita extra no
  KV (288 por dia comeriam quase 30% da cota grátis).
- **Traces a 10%** (`wrangler.toml`), antes do corte do plano grátis de logs em
  1º/12/2026. Os logs seguem em 100%.
- **Álbum de família ou privado: consentimento, não sigilo (#146).** A
  decisão do dono sobre o caminho sem a verificação de segurança (Turnstile
  bloqueado no navegador): ele continua entregando o álbum, mas pede o
  **nome**, para o registro de consentimento não sair anônimo, e cada IP abre
  no máximo **3 álbuns restritos diferentes por dia** por ele — o mesmo
  álbum, quantas vezes precisar, então o público de um evento no Wi-Fi do
  local não esbarra. Passado o teto, a página abre o código por e-mail. As
  declarações foram reescritas para não soarem como senha ("Este é um álbum
  de família: reconheço que as imagens são de uso estritamente particular e
  doméstico."). Com o Turnstile, ou pelo código por e-mail, nada muda.
- **Registro das operações (ROPA)**: §5 cobre a contagem por dia e por modo
  do portão (continua sem dado pessoal); §10, novo, registra o ambiente de
  prévia — com a limitação honesta de que nada lá é podado sozinho.
- **Política de retenção**: série por dia por **400 dias**, podada
  automaticamente; o ambiente de prévia, com limpeza manual.
- **Política de privacidade** atualizada (10/10/2026): a contagem por dia, sem
  identificar ninguém, apagada depois de 400 dias.
- **Pedidos de remoção nunca entram na prévia** ao restaurar um backup: são
  dados de terceiros, e a prévia manda e-mail de verdade.
- **Foto retirada sai também da capa**: esvaziar a lista de fotos de capa de um
  projeto agora apaga a capa gravada (ver "Melhorado e corrigido").
- A contagem do modo de entrada no portão é só um número — sem projeto, IP ou
  identificador.

### Para quem mantém

- `npm run verifica:painel`: o painel logado num Chromium de verdade, contra o
  `src/index.js` de verdade (`scripts/worker-local.mjs`), no iPhone, no
  Android e no computador — 235 checagens em ~45 s, das Métricas com série
  sintética à troca de senha e à sessão que cai no meio de uma edição, com o
  foco (a lista, a folha, as Métricas, Pedidos e Ajustes percorridos pelo
  Tab), os alvos de toque de cada seção, todo `hidden` de fato escondido e o
  que o fluxo grava no KV. Ver `docs/VERIFICACAO.md`.
- O roteiro do painel passou de 211 para 235 checagens, e as escritas no KV por
  aparelho, de 13 para 16 (17 no computador).
- `npm run verifica:previa`: a faixa e o menu "Testes" num Chromium de
  verdade, no celular e no computador — portão lotado de verdade no servidor,
  a saída "Voltar tudo ao normal" com o KV fora, o e-mail desviado para o
  dono, as métricas de exemplo enchendo o gráfico. Os quatro roteiros de
  navegador rodam na CI.
- **Deploy sem o smoke antes da promoção** (#179). O portão que testava a URL
  de preview da versão saiu do `deploy.yml`: a URL nunca veio (`has_preview`
  falso, provável efeito dos Durable Objects) e o passo custava ~60 s e mexia
  na configuração do Worker. Ficam versão sem tráfego, promoção, smoke de
  produção e reversão automática; a verificação anterior ao merge é a prévia
  do PR.
- Testes novos: `tests/metricas.test.js`, `tests/metricas-painel.test.js`,
  `tests/previa.test.js`, `tests/pedidos.test.js`, `tests/painel.test.js`,
  `tests/galeria.test.js`, e a atomicidade da série por dia na suíte
  `workers`.
- Os testes do limite de login rodam com o relógio parado: a janela da rajada
  é fixa e alinhada ao relógio, e uma execução da CI exatamente às 12:30:00
  viu a contagem zerar no meio do teste e falhar sem defeito no código.
- Limpeza: o CSS do desenho antigo que nada mais usava (`.filter-row`,
  `.search-row`, `.info-box` e a segunda regra `.tab-badge`) saiu.
- **Nenhuma migração** de Durable Object nem de D1 nesta versão: o deploy
  segue o caminho normal (versão sem tráfego → promoção → smoke de produção,
  com reversão automática se reprovar).
