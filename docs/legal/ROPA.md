# Registro das operações de tratamento (ROPA)

**Art. 37 da LGPD** — o controlador deve manter registro das operações de
tratamento que realizar.

> ⚠️ Redigido com auxílio de IA a partir da leitura do código. Não é parecer
> jurídico. Ver [`README.md`](./README.md).

- **Controlador:** Luca Ferriani Chala — pessoa natural, atividade de fotografia.
- **Canal do encarregado / titular:** privacidade@lucafchala.com
- **Sistema:** `fotos.lucafchala.com` — Cloudflare Worker único (`src/`), armazenamento em Cloudflare KV e Cloudflare D1.
- **Última revisão:** 2026-08-16
- **Fonte da verdade técnica:** `src/index.js` (rotas, retenção), `src/utils.js` (persistência), `migrations/` (esquema do D1).

---

## 1. Fotografias dos eventos (imagem de pessoa identificável)

| Campo | Conteúdo |
| --- | --- |
| **Dados** | Imagem de pessoas identificáveis (rosto, corpo, contexto). Eventualmente nome do evento/turma associado. |
| **Titulares** | Participantes dos eventos: formandos, convidados, familiares — **incluindo crianças e adolescentes**. |
| **Origem** | Captação fotográfica no evento, pelo próprio controlador. |
| **Finalidade** | (a) entrega do material aos contratantes/participantes; (b) divulgação do trabalho do fotógrafo (portfólio, site, redes); (c) publicação editorial, jornalística, cultural e educacional. |
| **Base legal** | **Art. 7º, IX** (legítimo interesse) para entrega e portfólio — ver [`LIA.md`](./LIA.md). **Art. 7º, I** (consentimento) / **art. 14, §1º** (consentimento do responsável, para menores) quando há aceite dos Termos no gate do Drive. **Art. 4º, I** (fora do escopo da LGPD) para projetos estritamente familiares e não econômicos. |
| **Categoria especial?** | **Não, por padrão.** Imagem de rosto só é dado sensível (biométrico, art. 5º, II) quando tratada **para fins de identificação biométrica**. Aqui não há reconhecimento facial, indexação por face nem qualquer processamento biométrico — as fotos são armazenadas e entregues como imagem. ⚠️ **DECISÃO JURÍDICA:** confirmar esta leitura. |
| **Armazenamento** | Google Drive (pastas por evento). O site **não hospeda** as fotos: guarda só a URL do Drive e as URLs das capas. |
| **Compartilhamento** | Google (operador de hospedagem). Terceiros a quem o link do Drive for repassado pelo próprio titular. Veículos editoriais, nos casos do item (c). |
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
| **Dados** | `created_at`, `event_slug`, `event_title`, `drive_target`, `access_type`, `terms_version`, `terms_hash`, `consent_text`, `declaration_text`, `consenter_name` (opcional, informado pelo titular), `turnstile_ok`, `ip`, `country`, `region`, `city`, `timezone`, `asn`, `as_org`, `colo`, `user_agent`, `accept_language`, `referrer`, `page_url`. |
| **Titulares** | Quem acessa as fotos de um evento. |
| **Origem** | Formulário do gate (nome) + cabeçalhos e metadados da requisição (o resto). |
| **Finalidade** | Comprovar **quando, por quem e sob qual texto exato** a autorização de uso de imagem foi dada. É a prova de não-repúdio: cada registro guarda a versão dos Termos **e o hash SHA-256 do HTML exibido**, então o texto aceito é reconstituível mesmo depois de os Termos mudarem. |
| **Base legal** | **Art. 7º, II** (cumprimento de obrigação legal — dever de comprovar consentimento, art. 8º, §2º) e **art. 7º, VI** (exercício regular de direito). O IP e o User-Agent especificamente: **art. 7º, IX** + **art. 16, I**. |
| **Retenção** | **1825 dias (~5 anos)** — `CONSENT_RETENTION_DAYS` em `src/index.js`, apagado pelo cron diário (`pruneOldConsent`). ⚠️ **DECISÃO JURÍDICA:** o prazo mira a prescrição da reparação civil (CC art. 206, §3º, V). Confirmar. |
| **Transferência internacional** | Sim — D1 na infraestrutura Cloudflare. |
| **Observação** | O texto gravado é sempre o **canônico do servidor** (`CONSENT_LABEL`, `ACCESS_DECLARATIONS`), nunca o que o cliente enviar. Um cliente adulterado não consegue registrar um consentimento com texto diferente do exibido. |

---

## 3. Solicitações de remoção de foto

Formulário no rodapé de cada evento. Gravado em KV (`removal_requests`);
handler `handleRemovalRequest()`.

| Campo | Conteúdo |
| --- | --- |
| **Dados** | E-mail (obrigatório), telefone (obrigatório), identificação da foto (número, URL ou arquivo enviado), mensagem (opcional), evento, data. |
| **Titulares** | Pessoas retratadas ou seus responsáveis legais. |
| **Origem** | Preenchimento direto pelo titular. |
| **Finalidade** | Localizar a foto, atender ao pedido e comunicar o resultado. E-mail e telefone servem para **confirmar identidade** e responder. |
| **Base legal** | **Art. 7º, II** (cumprimento de obrigação legal: atender ao direito de eliminação/oposição, art. 18) e **art. 7º, I** (consentimento marcado no formulário). |
| **Retenção** | **180 dias após a resolução** — `REMOVAL_RETENTION_DAYS`, apagado pelo cron diário (`pruneResolvedRemovalRequests`) e defensivamente a cada nova solicitação. Pedidos **não resolvidos nunca são apagados** automaticamente. |
| **Compartilhamento** | Resend (entrega do e-mail ao controlador e do aviso ao titular). |
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
| **Dados** | `views:<slug>` e `drive_clicks:<slug>` — inteiros agregados por projeto. |
| **Dado pessoal?** | **Não.** É contagem agregada, sem identificador, sem sessão, sem perfil. |
| **Cookie associado** | `fv_<slug>=1`, expira em 1 h, `SameSite=Lax`, escopo do próprio projeto. Serve só para não contar a mesma visita duas vezes na mesma hora. Não identifica, não persiste, não é lido por terceiro. |
| **Base legal** | **Art. 7º, IX** (legítimo interesse — métrica própria). |
| **Retenção** | Indefinida (agregado, sem titular). Apagado junto com o projeto. |

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
| **Dados** | Contadores de rate limit por IP (`ratelimit:*`), contador de falhas de login por IP (`login-fail:*`). |
| **Finalidade** | Conter força bruta e abuso; alertar o controlador. |
| **Base legal** | **Art. 7º, IX** + **art. 16, I** (guarda para exercício regular de direito). |
| **Retenção** | TTL curto: de 10 min a 24 h, conforme a janela. Nenhum registro de segurança sobrevive além disso. |
| **Nota** | O alerta de login por e-mail inclui o IP de origem. Os alertas de erro (`sendErrorAlert`) **nunca** incluem IP, cabeçalhos ou corpo de requisição — só mensagem, stack truncada e rota. |

---

## Resumo das transferências internacionais

| Operador | O que recebe | Onde | Detalhe |
| --- | --- | --- | --- |
| Google (Drive) | As fotografias | EUA / global | [`transferencia-internacional.md`](./transferencia-internacional.md) |
| Cloudflare | Todo o tráfego, KV, D1, Turnstile, Analytics | EUA / global (edge) | idem |
| Resend | E-mails transacionais (e-mail, telefone, mensagem, foto anexa) | EUA | idem |
| Google Fonts | IP do visitante ao buscar a fonte | EUA / global | idem |

---

## Decisões automatizadas

**Não há.** Nenhum tratamento produz efeito jurídico ou afeta significativamente
o titular de forma automatizada (art. 20). O Turnstile classifica requisições
como humano/robô, mas o efeito é operacional (liberar um formulário) e há
caminho alternativo humano em todos os casos — WhatsApp e e-mail, divulgados na
própria tela de erro.
