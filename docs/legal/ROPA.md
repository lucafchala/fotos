# Registro das operações de tratamento (ROPA)

**Art. 37 da LGPD** — o controlador deve manter registro das operações de
tratamento que realizar.

- **Controlador:** Luca Ferriani Chala — pessoa natural, atividade de fotografia.
- **Canal do encarregado / titular:** privacidade@lucafchala.com
- **Sistema:** `fotos.lucafchala.com` — Cloudflare Worker único (`src/`), armazenamento em Cloudflare KV, Cloudflare D1 e Durable Objects (contadores e limites). Desde a v2.0 há também um **ambiente de prévia** com armazenamento próprio (seção 10).
- **Última revisão:** 2026-11-14 (buscadores, IndexNow e treino de IA nos álbuns públicos)
- **Fonte da verdade técnica:** `src/index.js` (rotas, retenção), `src/utils.js` (persistência), `src/drive.js` (leitura das pastas do Drive pela galeria própria), `src/snapshot.js` e `src/sumiram.js` (cópia da lista e fotos apagadas, seção 11), `migrations/` (esquema do D1).

---

## 1. Fotografias dos eventos (imagem de pessoa identificável)

| Campo | Conteúdo |
| --- | --- |
| **Dados** | Imagem de pessoas identificáveis (rosto, corpo, contexto). Eventualmente nome do evento/turma associado. |
| **Titulares** | Participantes dos eventos: formandos, convidados, familiares — **incluindo crianças e adolescentes**. |
| **Origem** | Captação fotográfica no evento, pelo próprio controlador. |
| **Finalidade** | (a) entrega do material aos contratantes/participantes; (b) divulgação do trabalho do fotógrafo (portfólio, site, redes); (c) publicação editorial, jornalística, cultural e educacional. |
| **Base legal** | **Art. 7º, IX** (legítimo interesse) para entrega e portfólio — ver [`LIA.md`](./LIA.md). **Art. 7º, I** (consentimento) / **art. 14, §1º** (consentimento do responsável, para menores) quando há aceite dos Termos no gate do Drive. **Art. 4º, I** (fora do escopo da LGPD) para projetos estritamente familiares e não econômicos. |
| **Categoria especial?** | **Sim, na busca pelo rosto** (seção 12): o vetor do rosto é dado biométrico (art. 5º, II; art. 11). Nas demais operações, a imagem não é tratada para identificação. |
| **Armazenamento** | Google Drive (pastas por evento) é a origem das fotos. Desde a v3.8.3 o site guarda **cópias** no R2 da Cloudflare (`FOTOS_R2`): as miniaturas (`w/<id>/<largura>`) e, quando alguém baixa, o arquivo (`o/<id>`), para a galeria não depender do Google a cada visita. A cópia de uma foto é apagada quando ela é ocultada, removida a pedido ou apagada da pasta (na hora, e de novo por uma faxina diária); a rota das fotos só serve o que está num álbum do site, aberto ao público, com endereço assinado (v3.8.8). Fora isso o site guarda a URL do Drive e as URLs das capas. A **galeria própria** (`/galeria/<slug>`, desde 29/10/2026 aberta a todos nos álbuns públicos, sem o portão de consentimento; família e privado exigem o passe do portão) lê a lista da pasta pela API do Drive e repassa os downloads pelo Worker **sem gravar a foto**; o que fica em cache, por 10 minutos e na Cache API da Cloudflare, é só a lista de arquivos (identificador, nome, dimensões, tamanho, **autor** — o nome da subpasta de créditos —, **data e hora de captura** lida do arquivo e, em vídeos e Live Photos, a duração e o vídeo pareado; **sem GPS e sem dados da câmera**). A pasta pode ser **colaborativa** (várias pessoas enviam fotos) e a galeria mostra fotos de mais de um autor, com terceiros e menores retratados; o canal de remoção da seção 3 e a prioridade para menores são a salvaguarda. A cópia durável da lista está na seção 11. Antes de abrir a galeria própria a participantes, este registro deve ser revisto: a partir daí a foto baixada passa pela Cloudflare a caminho do participante. |
| **Compartilhamento** | Google (operador de hospedagem). Terceiros a quem o link do Drive for repassado pelo próprio titular. Veículos editoriais, nos casos do item (c). **Buscadores e serviços de IA** (desde a v3.11.0, decisão do controlador de 13/11/2026): as páginas e fotos dos álbuns **públicos** podem ser rastreadas por buscadores (Google, Bing e os demais) e lidas por serviços de inteligência artificial, **inclusive para treino de modelos** (`robots.txt` com `ai-train=yes`); Bing, Yandex e os outros participantes do IndexNow são avisados quando uma página pública entra ou sai (só o endereço da página, nenhum dado pessoal além do que a própria página mostra). Não é um compartilhamento ativo de arquivos: é a publicação aberta, lida por quem a visita. Família e privado ficam fora (noindex, fora dos sitemaps e do IndexNow, atrás do portão). Uma foto removida sai do site e, com o tempo, dos buscadores, mas **não sai de um modelo já treinado** — ver RIPD, R12. |
| **Retenção** | Enquanto publicado / útil ao contratante. Removível a pedido, a qualquer tempo. Sem prazo automático. |
| **Transferência internacional** | Sim — EUA. Ver [`transferencia-internacional.md`](./transferencia-internacional.md). |
| **Salvaguardas** | Gate de acesso com Turnstile + aceite de Termos + autodeclaração por categoria; nonce de página assinado; rate limit; canal de remoção em um clique no rodapé de cada evento. |

---

## 2. Registro de autorização de uso de imagem (consent log)

Gravado a cada liberação do link do Drive. Tabela `image_use_consent` (D1),
esquema em `migrations/0001_consent.sql` e `0002_access_type.sql`; escrita em
`handleDriveLink()` (`src/index.js`).

| Campo | Conteúdo |
| --- | --- |
| **Dados** | `created_at`, `event_slug`, `event_title`, `drive_target`, `access_type`, `terms_version`, `terms_hash`, `consent_text`, `declaration_text`, `consenter_name` (informado pelo titular: opcional, exceto em álbum de família ou privado aberto sem a verificação de segurança, em que é obrigatório — #146), `turnstile_ok` (como a pessoa foi verificada: `0` nenhuma — caminho sem Turnstile; `1` Turnstile; `2` código por e-mail, seção 9), `ip`, `country`, `region`, `city`, `timezone`, `asn`, `as_org`, `colo`, `user_agent`, `accept_language`, `referrer`, `page_url`. |
| **Titulares** | Quem acessa as fotos de um evento. |
| **Origem** | Formulário do gate (nome) + cabeçalhos e metadados da requisição (o resto). |
| **Finalidade** | Comprovar **quando, por quem e sob qual texto exato** a autorização de uso de imagem foi dada. É a prova de não-repúdio: cada registro guarda a versão dos Termos **e o hash SHA-256 do HTML exibido**, então o texto aceito é reconstituível mesmo depois de os Termos mudarem. |
| **Base legal** | **Art. 7º, II** (cumprimento de obrigação legal — dever de comprovar consentimento, art. 8º, §2º) e **art. 7º, VI** (exercício regular de direito). O IP e o User-Agent especificamente: **art. 7º, IX** + **art. 16, I**. |
| **Retenção** | **1825 dias (~5 anos)** — `CONSENT_RETENTION_DAYS` em `src/index.js`, apagado pelo cron diário (`pruneOldConsent`). O prazo acompanha a prescrição da reparação civil (CC art. 206, §3º, V). |
| **Transferência internacional** | Sim — D1 na infraestrutura Cloudflare. |
| **Cópias (backup)** | Desde o backup v3, o arquivo baixado em *Ajustes → Baixar backup JSON* (`GET /api/backup`) traz a **linha inteira** de cada aceite — IP, localização aproximada, User-Agent, nome quando informado — além dos pedidos de remoção. A cópia completa do banco é o `wrangler d1 export` (`docs/RELEASE.md`). As duas vivem **só no computador do controlador**, guardadas protegidas (disco ou arquivo criptografado, fora de pasta sincronizada sem criptografia) e seguem a **mesma retenção** do registro: cópia com aceite de mais de 1825 dias é apagada ou substituída por uma mais nova ([`politica-de-retencao.md`](./politica-de-retencao.md)). O restore só acrescenta aceites ausentes (nunca altera um existente), recusa os vencidos e **não roda na prévia** (seção 10). |
| **Observação** | O texto gravado é sempre o **canônico do servidor** (`CONSENT_LABEL`, `ACCESS_DECLARATIONS`), nunca o que o cliente enviar. Um cliente adulterado não consegue registrar um consentimento com texto diferente do exibido. |

---

## 3. Solicitações de remoção de foto

Formulário no rodapé de cada evento. Gravado em KV, um registro por pedido
(`removal_request:<id>`, desde a v2.0; antes, uma lista única
`removal_requests`, migrada pelo cron diário e então apagada); handler
`handleRemovalRequest()`, armazenamento em `src/pedidos.js`.

| Campo | Conteúdo |
| --- | --- |
| **Dados** | E-mail (obrigatório), telefone (obrigatório), identificação da foto (número, URL ou arquivo enviado), mensagem (opcional), evento, data. Pedido feito **pela galeria** (`POST /api/galeria/remocao`, `handleGaleriaRemocao()`): e-mail, motivo (`eu`, `menor` ou `outro`), mensagem (opcional), evento e a **foto aberta** (ID do Drive e nome do arquivo, que não são dado pessoal por si); **sem telefone** e sem aceite marcado (aviso informativo com o link da política). Marcas gravadas no pedido: `prioridade` (motivo `menor`) e `desfecho` (`removida`, `mantida_na_galeria`; pedidos antigos podem trazer `ocultada`, de quando a foto saía da galeria na hora). |
| **Titulares** | Pessoas retratadas ou seus responsáveis legais. |
| **Origem** | Preenchimento direto pelo titular. |
| **Finalidade** | Localizar a foto, atender ao pedido e comunicar o resultado. E-mail e telefone servem para **confirmar identidade** e responder. |
| **Base legal** | **Art. 7º, II** (cumprimento de obrigação legal: atender ao direito de eliminação/oposição, art. 18) e **art. 7º, I** (consentimento marcado no formulário). |
| **Retenção** | **180 dias após a resolução** — `REMOVAL_RETENTION_DAYS`, apagado pelo cron diário (`pruneResolvedRemovalRequests` → `podaResolvidos`). Desde a v2.0 o cron é o único caminho de poda (a verificação que vinha de carona em cada nova solicitação dependia de regravar a lista inteira, e saiu com ela); se o cron parar, o `/api/healthz` acusa em até 26 h (`cron:last`). Pedidos **não resolvidos nunca são apagados** automaticamente. |
| **Compartilhamento** | Resend (entrega do e-mail ao controlador e do aviso ao titular). |
| **Decisão (galeria)** | O pedido pela galeria **não esconde a foto**: ela fica no ar até o controlador decidir no painel (Pedidos): **"Remover da galeria"** (a foto é ocultada e sai do site em até 2 minutos) ou **"Manter na galeria"**. Quem pediu recebe a resposta por e-mail; pedidos do motivo `menor` têm prioridade (assunto do aviso). O **autor** da foto, se tem e-mail nos créditos do projeto, é avisado do pedido e da decisão **sem os dados de contato** de quem pediu. Limites por IP em `src/config.js` (contador em Durable Object, janela de 1 dia; o IP não é gravado no pedido). |
| **Nota de minimização** | A foto enviada **não é gravada** no banco — trafega só no e-mail. E os **metadados EXIF são removidos no servidor antes disso** (`stripImageMetadata()`): quem envia uma foto pedindo remoção não está oferecendo as coordenadas de GPS de onde ela foi tirada, e não precisamos delas. Ver `politica-seguranca-informacao.md`. |

---

## 4. Mensagens de suporte

Formulário em `/suporte`; handler `handleSupportRequest()`.

| Campo | Conteúdo |
| --- | --- |
| **Dados** | Nome (opcional), e-mail (opcional), mensagem. |
| **Finalidade** | Responder ao contato. |
| **Base legal** | **Art. 7º, I** (consentimento, marcado no formulário) e **art. 7º, V** (procedimentos preliminares a contrato, quando o contato é comercial). |
| **Armazenamento** | **Nenhum.** A mensagem é enviada por e-mail e não é gravada em KV nem em D1. A retenção passa a ser a da caixa de entrada do controlador. |
| **Compartilhamento** | Resend. |
| **Exceção técnica** | Um **hash truncado** da mensagem fica em KV por 1 h, apenas para suprimir envios duplicados. Não é reversível para o texto e expira sozinho. |

---

## 5. Contadores de acesso

| Campo | Conteúdo |
| --- | --- |
| **Dados** | `views:<slug>` e `drive_clicks:<slug>` — inteiros agregados por projeto. Desde a v2.0: a mesma contagem **por dia** (`d:<AAAA-MM-DD>:<chave>`), e quantos acessos ao Drive o portão liberou por **modo de verificação**; desde a v3.1, nos projetos com capítulos, as aberturas e os downloads também **por capítulo** (`galeria:<slug>:<capítulo>…`, o mesmo tipo de número) (`gate:turnstile`, `gate:email`, `gate:noscript`, também por dia). |
| **Dado pessoal?** | **Não.** É contagem agregada, sem identificador, sem sessão, sem perfil. A contagem por dia e por modo continua sendo só número: não leva IP, projeto (no caso do modo), cookie nem horário — o dia é o menor recorte. |
| **Cookie associado** | `fv_<slug>=1`, expira em 1 h, `SameSite=Lax`, escopo do próprio projeto. Serve só para não contar a mesma visita duas vezes na mesma hora. Não identifica, não persiste, não é lido por terceiro. |
| **Base legal** | **Art. 7º, IX** (legítimo interesse — métrica própria). |
| **Retenção** | Totais: indefinida (agregado, sem titular), apagados junto com o projeto. Série por dia: **400 dias**, podada automaticamente no primeiro incremento de cada dia (`Counter`, `src/counters.js`) e apagada junto com o projeto. |

---

## 6. Telemetria de desempenho

`POST /api/perf`, amostrado em 10% das visitas no cliente.

| Campo | Conteúdo |
| --- | --- |
| **Dados** | Tempos de carregamento (FCP, LCP, TTFB), contagem de imagens, largura da viewport, `colo` (datacenter Cloudflare) e `country`. |
| **Dado pessoal?** | **Não.** Sem identificador, sem cookie, sem IP, sem sessão. `country` é granularidade de país. |
| **Destino** | Log estruturado do Cloudflare (e, se o binding `PERF` existir, Analytics Engine). **Nunca gravado em KV.** |
| **Base legal** | **Art. 7º, IX**. |

---

## 7. Sessão administrativa

| Campo | Conteúdo |
| --- | --- |
| **Dados** | Token aleatório de 256 bits; registro em KV com data de criação, último uso e uma impressão (hash FNV do User-Agent). |
| **Titular** | O próprio controlador. Não há outros usuários. |
| **Finalidade** | Autenticar o painel. |
| **Base legal** | **Art. 7º, IX** (segurança do próprio sistema). |
| **Retenção** | 24 h absolutas; 2 h de inatividade encerram antes. Apagado no logout e na troca de senha (varredura de todas as outras sessões). |
| **Cookie** | `__Host-session` — `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, sem `Domain`. |

---

## 8. Registros de segurança

| Campo | Conteúdo |
| --- | --- |
| **Dados** | Contadores de rate limit por IP (Durable Object `RateLimiter`, um por rota e IP), contador de falhas de login por IP (o mesmo `RateLimiter`, chave `login-fail`), e a contagem de projetos abertos sem Turnstile por IP, lida do registro de consentimento (seção 2) para o alerta de varredura. |
| **Finalidade** | Conter força bruta e abuso; alertar o controlador. |
| **Base legal** | **Art. 7º, IX** + **art. 16, I** (guarda para exercício regular de direito). |
| **Retenção** | Curta. Janela fixa: de 10 min a 24 h, apagada pelo alarme do objeto. Balde de fichas (portão do Drive, código por e-mail): apagado assim que enche de novo — minutos a poucas horas. Nenhum registro de segurança sobrevive além disso. O limite por endereço do código por e-mail usa o **hash SHA-256** do e-mail como nome do objeto, nunca o e-mail. |
| **Nota** | O alerta de login e o de varredura pelo caminho sem Turnstile incluem, por e-mail ao controlador, o IP de origem — é o que permite agir (bloqueio no firewall, consulta ao registro). Os alertas de erro (`sendErrorAlert`) **nunca** incluem IP, cabeçalhos ou corpo de requisição — só mensagem, stack truncada e rota. |

---

## 9. Código de acesso por e-mail (último recurso do gate do Drive)

Para quem não passa pela verificação anti-robô (VPN, bloqueador de anúncios
que quebra o desafio) ou esgotou as tentativas num pico de acesso. Handler
`handleDriveCode()` (`src/index.js`); confirmação em `handleDriveLink()`.

| Campo | Conteúdo |
| --- | --- |
| **Dados** | E-mail informado pelo titular. Hash SHA-256 do e-mail (nome do objeto de limite por endereço). |
| **Titulares** | Quem acessa as fotos e escolhe esse caminho. |
| **Origem** | Digitado pelo titular no modal do gate. |
| **Finalidade** | Enviar um código de 6 dígitos que libera o mesmo gate (com o mesmo aceite dos Termos). O objetivo é ninguém de verdade ficar sem as fotos. |
| **Base legal** | **Art. 7º, V** (procedimentos a pedido do titular) — a pessoa pede o código. |
| **Armazenamento** | **O e-mail não é gravado** em KV, D1 nem no registro de consentimento. O código também não: o servidor devolve um token HMAC sobre (projeto, código, prazo de 15 min) que não contém o código. O registro de consentimento da liberação marca `turnstile_ok = 2`. |
| **Retenção** | Hash do e-mail: até 2 h (janela de 1 h + alarme). Cópia do e-mail enviado: retenção de logs do Resend. |
| **Compartilhamento** | Resend (entrega do e-mail). |
| **Limites** | Por IP, por endereço (3/h) e teto diário da conta (40) — este protege a franquia de e-mail dividida com remoção e suporte. Apelido `+etiqueta` é recusado e os pontos do Gmail contam como um endereço só, para ninguém multiplicar envios para a mesma caixa. Valores em `src/config.js`. |
| **Quando aparece** | Só quando o acesso está bloqueado: verificação anti-robô falhou/travou, ou o gate recusou por verificação, limite, servidor ou rede depois das tentativas automáticas. |

---

## 10. Ambiente de prévia (teste de mudanças antes da publicação)

Desde a v2.0, cada mudança no código ganha uma **prévia**: o mesmo sistema, num
endereço próprio, com armazenamento **separado** do de produção (KV
`fotos-previa`, D1 `fotos-consent-previa`, Durable Objects próprios). Serve
para o controlador testar a mudança antes de publicá-la. Código: `src/previa.js`.

| Campo | Conteúdo |
| --- | --- |
| **Dados** | Os projetos que o controlador copia para lá (restaurando um backup do painel — título, descrição, links das pastas do Drive, capas); o registro de consentimento, as sessões e os contadores gerados **pelos testes do próprio controlador**. |
| **Minimização** | Restaurar backup na prévia **não traz os pedidos de remoção** (e-mail, telefone e mensagem de terceiros) **nem o registro de consentimento** (IP e aparelho de terceiros) — o código os recusa e diz isso na tela. A prévia não envia heartbeat nem medição de acesso. O menu "Testes" da prévia tem **"E-mail → tudo para o dono"**: todo e-mail da prévia vai ao controlador, com o destinatário original só no assunto — para testar com endereço inventado sem escrever a terceiros. As "métricas de exemplo" são números inventados, sem dado pessoal. |
| **Cookies da prévia** | Só existem na prévia: `previa_ts`, `previa_email`, `previa_portao`, `previa_banco`, `previa_drive`, `previa_rede` (a simulação escolhida — um valor de uma lista fixa, 30 dias, `HttpOnly`) e `previa_aviso` (o aviso de uma ação, 60 s). Preferência técnica de quem testa; nenhum identifica ninguém. |
| **Titulares** | O próprio controlador, em teste. **Não é para participantes:** o endereço não é divulgado, toda página tem a faixa "PRÉVIA" e a resposta `noindex` (não aparece em busca). Se um terceiro, mesmo assim, usar a prévia, o aceite dele fica só no D1 da prévia. |
| **Base legal** | Art. 7º, IX (legítimo interesse — testar a segurança e o funcionamento do serviço antes de publicá-lo). Para dados do próprio controlador, não há titular terceiro. |
| **Retenção** | A limpeza automática diária **não roda** em prévia (cron não alcança prévias — regra da plataforma). Os dados de teste são apagados manualmente: a prévia inteira com `npx wrangler preview delete`; o KV e o D1 de prévia, pelo painel da Cloudflare. Registro honesto do limite: nada aqui é podado sozinho. |
| **Compartilhamento** | Os mesmos operadores de produção (Cloudflare; Resend, nos e-mails de teste, que saem com "[PRÉVIA]" no assunto). |

---

## 11. Cópia da lista de fotos e fotos apagadas (galeria, v3.1)

Tabelas `galeria_snapshot` e `galeria_apagadas` (D1), esquema em
`migrations/0003_galeria_snapshot.sql` e `0004_galeria_apagadas.sql`; código em
`src/snapshot.js` e `src/sumiram.js`.

| Campo | Conteúdo |
| --- | --- |
| **Dados** | `galeria_snapshot`: a última lista lida de cada pasta (um registro por pasta, ou por capítulo) — identificador do arquivo, nome, dimensões, tamanho, **autor** (nome da subpasta de créditos), **data/hora de captura**. `galeria_apagadas`: identificador, nome, autor, capítulo, seção, captura e o instante em que o sumiço foi percebido. **Sem e-mail, sem GPS, sem dados da câmera e sem dado de visitante.** |
| **Titulares** | Pessoas retratadas e autores das fotos, indiretamente (nome do arquivo e do autor; a imagem em si não é copiada). |
| **Finalidade** | (a) manter a galeria de pé e permitir congelar a lista (moderação da pasta colaborativa); (b) perceber fotos que sumiram da pasta e avisar o controlador (e o autor, se tem e-mail nos créditos) e listar "Fotos apagadas recentemente" no painel. |
| **Base legal** | **Art. 7º, IX** (legítimo interesse — operar e proteger o serviço e o trabalho do controlador), com o dado mínimo que a galeria já exibe. |
| **Retenção** | `galeria_snapshot`: uma linha por pasta, **substituída** a cada mudança e apagada junto com o projeto. `galeria_apagadas`: **30 dias** (`SUMIRAM_RETENCAO_DIAS` em `src/config.js`), podada a cada gravação e a cada consulta do painel, e apagada junto com o projeto. |
| **Compartilhamento** | Cloudflare (D1). O aviso de fotos apagadas sai por Resend, com os nomes dos arquivos, para o controlador e para o autor com e-mail nos créditos. |
| **Armazenamento local no aparelho** | A galeria guarda no `localStorage` do visitante o instante da última visita a cada projeto/capítulo (`gal-visita:<projeto>:<capítulo>`), para destacar "fotos novas". Fica **só no aparelho**: não é cookie, não vai ao servidor. |

---

## 12. Busca pelo rosto (dado biométrico, v3.2)

Código em `src/rosto.js`, `src/aws.js` e `scripts/rosto-indexa.mjs`; guia em [`docs/ROSTO.md`](../ROSTO.md); riscos no RIPD, **R9**.

| Campo | Conteúdo |
| --- | --- |
| **Dados** | **Selfie de quem busca:** a imagem, reduzida no aparelho para 640 px, só durante a comparação; **não é guardada**. **Índice do álbum:** um vetor numérico por rosto das fotos públicas do álbum, ligado ao identificador da foto e ao capítulo; sem nome. **Quem saiu da busca:** o vetor do rosto da pessoa, enviado por ela, guardado como uma marca dentro do próprio índice do álbum (v3.8.9; até a 3.8.8, numa coleção à parte), e, no KV, a data da saída e quantos rostos ela apagou — **não** as fotos em que a pessoa aparecia. |
| **Titulares** | Quem usa a busca; pessoas retratadas nas fotos do álbum, inclusive menores. |
| **Finalidade** | Permitir que cada pessoa ache as próprias fotos no álbum, e que quem não quer ser achado saia da busca. |
| **Base legal** | **Quem busca e quem sai:** consentimento específico e destacado (art. 11, I), com caixa de aceite a cada envio. **O índice dos retratados:** é o ponto fraco registrado no RIPD (R9). A busca só é ligada depois de aviso prévio à turma e aos responsáveis, com saída imediata para quem pedir. |
| **Retenção** | Selfie: nenhuma. Índice e quem saiu: **até o fim do álbum** ou até a busca ser desligada. Projeto excluído: as coleções `fotos-<slug>` e `fotos-<slug>-sair` são apagadas **na hora** pelo próprio site (`apagaIndiceDoAlbum`; se a AWS falhar, o cron diário repete). Busca desligada no painel: o indexador para na hora e as coleções são apagadas **72 horas** depois (`ROSTO_APAGA_APOS_DESLIGAR_H`; religar antes cancela). Foto oculta ou removida sai do índice na execução seguinte do indexador (a cada 10 min). Os rostos de quem saiu que entrarem com fotos novas são apagados na mesma execução que os indexou. |
| **Compartilhamento** | **Amazon Web Services (Amazon Rekognition)**, região sa-east-1 (São Paulo), como operadora, com o opt-out de treino de IA ativado. O indexador roda no GitHub Actions e baixa as miniaturas do Google (lh3). |
| **Armazenamento local no aparelho** | A selfie só existe na memória da página. O **resultado** da busca ("minhas fotos": os identificadores das fotos achadas e até 4 identificadores de rostos do índice, para atualizar a lista sem outra selfie) fica no `localStorage` do aparelho por 30 dias; não vai a outro lugar e some com os dados do site no navegador. |

---

## 13. Apoie o projeto (Pix, v3.3)

A seção mostra um "Pix copia e cola" estático, com a chave do controlador. **O site não trata dado de quem doa:** não registra quem clicou, quem copiou o código nem quem pagou. O pagamento acontece no banco de quem doa, fora do site. A chave publicada nunca é CPF (o painel recusa).

---

## 14. Busca nas fotos e moderação automática (v3.7)

Código em `src/busca.js` e `scripts/rosto-indexa.mjs`; guia em [`docs/ROSTO.md`](../ROSTO.md), "Busca nas fotos"; riscos no RIPD, **R10**.

| Campo | Conteúdo |
| --- | --- |
| **Dados** | Por foto pública do álbum: as **palavras** que aparecem nela (número de camisa, faixa, crachá, placa), as **"coisas" e cenas** reconhecidas (palco, bolo, bola) e os **rótulos de moderação** (por exemplo, gesto obsceno), mais o capítulo e o nome do autor da foto, como nos créditos. Nenhum rosto, nenhuma imagem guardada. A busca do visitante (as palavras digitadas) não é guardada. |
| **Titulares** | Pessoas retratadas nas fotos do álbum, inclusive menores (um nome num crachá pode aparecer no texto lido). |
| **Finalidade** | Achar fotos no álbum pelo que aparece nelas; esconder automaticamente, até a decisão do controlador, foto enviada pela turma que pareça imprópria. |
| **Base legal** | Legítimo interesse (art. 7º, IX), o mesmo da publicação do álbum ([`LIA.md`](./LIA.md)): o texto lido é o que qualquer pessoa já vê na foto pública. A moderação é medida de proteção dos retratados, especialmente de menores (art. 14). |
| **Retenção** | Enquanto a foto estiver no álbum. Foto oculta ou removida sai da busca na execução seguinte do indexador; apagar o projeto apaga a busca dele (tabela `busca_foto`, D1). |
| **Compartilhamento** | **Amazon Web Services (Amazon Rekognition)**, região sa-east-1 (São Paulo), como operadora, com o opt-out de treino de IA ativado: DetectText, DetectLabels e DetectModerationLabels, uma vez por foto, a partir da miniatura pública. O resultado fica no D1 da Cloudflare. |

## 15. Prévia do álbum com senha (v3.7)

Antes do lançamento, o controlador pode cadastrar uma senha de prévia. Quem a digita na página "em breve" (o "easter egg") recebe um cookie **essencial** de 30 dias (`previa_<slug>`, HttpOnly, assinado) que abre o álbum só para ver. **Não há cadastro nem dado pessoal**: o cookie não identifica a pessoa, e a senha fica guardada só como resumo (hash com sal). As tentativas são limitadas por IP (contador sem IP em claro, como os demais limites do site).

## 16. Aviso de fotos novas no celular (v3.8.4)

Código em `src/aviso.js`. Só para quem toca em "Avisar quando chegar foto nova" e aceita o pedido de permissão do navegador.

| Campo | Conteúdo |
| --- | --- |
| **Dados** | O endereço de entrega que o navegador cria para o aviso (um link do serviço de notificação) e as duas chaves públicas do navegador que cifram o texto. Sem nome, e-mail ou telefone. Fica no KV da Cloudflare (`aviso:sub:<slug>:<hash>`). |
| **Titulares** | Quem liga o aviso no álbum. |
| **Finalidade** | Avisar que chegaram fotos novas no álbum (no máximo um aviso a cada 3 h por álbum). |
| **Base legal** | Consentimento (art. 7º, I): o aviso só existe depois do toque no botão e da permissão do navegador. |
| **Retenção** | Até a pessoa desligar (botão ou configuração do navegador), até o serviço de notificação recusar o endereço (apagado no envio seguinte) apagado junto com o projeto (`apagaInscricoes`) e, em qualquer caso, vencido sozinho depois de 400 dias sem aviso entregue (`AVISO_INSCRICAO_TTL_S`; cada aviso entregue renova, no máximo uma vez a cada 30 dias). Três avisos seguidos recusados pelo serviço (403) também apagam a inscrição. |
| **Compartilhamento** | O serviço de notificação do navegador da pessoa (Google, Apple, Mozilla ou Microsoft) recebe o aviso **cifrado** (RFC 8291) e o entrega; não lê o texto. |

---

## 17. Envio de fotos pelo site (v4.0.0)

Código em `src/envio.js` (o caminho até o Drive) e `src/ui/enviar.js` (a página); guia em `docs/ENVIO.md`. Só nos álbuns públicos por capítulos com pasta de envio, e só com a credencial OAuth do Google configurada no Worker.

| Campo | Conteúdo |
| --- | --- |
| **Dados** | Os **arquivos** escolhidos (foto ou vídeo), **sem alteração**: com os metadados que o aparelho gravou (data, câmera e, se registrada, **localização**). Nome do arquivo, tamanho, data do arquivo no aparelho e uma impressão digital do conteúdo (`appProperties.fp`, para não duplicar). O nome indicado para o crédito (opcional), na descrição do arquivo no Drive. O aceite da declaração de envio vai para a tabela `image_use_consent` (seção 2) com `drive_target = 'envio'`, `declaration_text` = `ENVIO_DECLARACAO` e `consenter_name` = o nome indicado. |
| **Titulares** | Quem envia; e quem aparece nas fotos e nos vídeos enviados (inclusive menores). |
| **Origem** | O aparelho de quem envia. |
| **Finalidade** | Receber no álbum as fotos e os vídeos da turma, na pasta do evento, sem que a pessoa precise abrir o Google Drive. |
| **Base legal** | Os arquivos: o mesmo das fotos do álbum (seção 1), com a declaração de quem envia de que pode publicá-los. O aceite: o da seção 2. |
| **Retenção** | Os arquivos ficam no Drive como as demais fotos do álbum, até a remoção (pedido do titular, seção 3, ou decisão do controlador). O aceite segue a seção 2 (1825 dias). O servidor não guarda o arquivo nem a sessão de envio: o endereço da sessão do Google vai cifrado (AES-GCM) ao aparelho e vence em 6 dias. No aparelho, a página guarda no IndexedDB a lista dos envios em andamento (até 6 dias) e dos já enviados (até 30 dias), sem conteúdo. |
| **Compartilhamento** | Google (Drive), na conta do controlador, como operador de armazenamento. Os arquivos passam pelo Worker da Cloudflare sem ser guardados. |
| **Transferência internacional** | Sim — Google e Cloudflare (ver o resumo abaixo). |
| **Observação** | Os metadados de localização **não são retirados** (o arquivo sobe byte a byte, em partes, e o servidor só confere os primeiros bytes); a galeria não lê a localização, mas quem baixa a foto no tamanho máximo recebe o arquivo original. A Política de Privacidade diz isso a quem envia. |

---

## Resumo das transferências internacionais

| Operador | O que recebe | Onde | Detalhe |
| --- | --- | --- | --- |
| Google (Drive) | As fotografias | EUA / global | [`transferencia-internacional.md`](./transferencia-internacional.md) |
| Cloudflare | Todo o tráfego, KV, D1, Turnstile, Analytics | EUA / global (edge) | idem |
| Resend | E-mails transacionais (e-mail, telefone, mensagem, foto anexa; e-mail do código de acesso) | EUA | idem |
| Google (YouTube) | IP/navegador ao carregar a miniatura de um projeto com vídeo; o player só depois do play | EUA / global | idem |
| Google (player do Drive) | IP/navegador e dados de reprodução, **só depois do toque** num vídeo da galeria | EUA / global | idem |
| Serviço de notificação do navegador (Google, Apple, Mozilla, Microsoft) | O aviso de fotos novas, cifrado, para quem ligou | EUA / global | seção 16 |
| Amazon Web Services (Rekognition) | A selfie da busca (sem guardar), os vetores de rosto do álbum e as miniaturas para ler texto, "coisas" e moderação | **Brasil (sa-east-1)** — empresa dos EUA | seções 12 e 14; RIPD R9 e R10 |

---

## Decisões automatizadas

**Não há.** Nenhum tratamento produz efeito jurídico ou afeta significativamente
o titular de forma automatizada (art. 20). O Turnstile classifica requisições
como humano/robô, mas o efeito é operacional (liberar um formulário) e há
caminho alternativo em todos os casos — código de acesso por e-mail (seção 9) e
o caminho humano, WhatsApp e e-mail, divulgados na própria tela de erro.

A busca pelo rosto (seção 12) só **sugere** fotos para a própria pessoa conferir: não identifica ninguém por nome e não toma decisão sobre ninguém.

A moderação automática (seção 14) **só marca** uma foto que a Amazon aponte como imprópria e avisa o controlador por e-mail, que decide se a oculta. Nada é escondido sem revisão humana (desde a v3.8.12), e não há decisão sobre o titular.
