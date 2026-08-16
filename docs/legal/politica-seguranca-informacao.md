# Política de segurança da informação

**Art. 46, 47, 49 e 50 da LGPD** — medidas técnicas e administrativas aptas a
proteger os dados pessoais.

> ⚠️ Redigido com auxílio de IA. Não é parecer jurídico. Ver [`README.md`](./README.md).

## Para que serve este documento

O art. 46 exige medidas de segurança; o art. 50 incentiva documentá-las como
programa de governança. A diferença entre um documento útil e um teatral está em
uma coisa: **cada medida abaixo aponta para o código que a implementa**. Uma
política que afirma "adotamos criptografia forte" sem dizer onde não é
verificável — e o que não é verificável não é auditável.

Este é o par de `SECURITY.md` (voltado a quem reporta vulnerabilidade); aqui o
foco é a conformidade.

---

## 1. Controle de acesso

| Medida | Implementação | Onde |
| --- | --- | --- |
| Senha derivada com PBKDF2-SHA256, 100.000 iterações, salt de 128 bits por credencial | `hashPassword()` | `src/utils.js` |
| Comparação em tempo constante | `timingSafeEqual()` | `src/utils.js` |
| Iteração gravada junto do hash (permite elevar o custo sem invalidar credenciais) | formato `pbkdf2:<iter>:<salt>:<hash>` | `src/utils.js` |
| Política de senha: mínimo 12, variedade de classes, rejeição de padrões previsíveis | `validatePassword()` | `src/security.js` |
| Sem "confiança na primeira execução": sem credencial e sem secret, o login é impossível | `getAdminHash()` | `src/index.js` |
| Hash executado mesmo sem credencial armazenada, para não vazar por tempo de resposta se o painel tem dono | `handleLogin()` | `src/index.js` |
| Rate limit em duas camadas: 10/10 min e 60/dia por IP | `checkRateLimit()` | `src/index.js` |
| Alerta por e-mail a partir de 5 falhas em 15 min | `noteFailedLogin()` / `sendLoginAlert()` | `src/index.js`, `src/utils.js` |
| Troca de senha revoga todas as outras sessões | `handleChangePassword()` | `src/index.js` |

## 2. Sessão

| Medida | Implementação |
| --- | --- |
| Token de 256 bits de CSPRNG | `generateToken()` |
| Cookie `__Host-session`: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, sem `Domain` — impede que outro host de `lucafchala.com` plante uma sessão | `sessionCookie()` |
| Expiração absoluta de 24 h | TTL do KV |
| Expiração por 2 h de inatividade | `verifySession()` |
| Vínculo ao cliente (hash do User-Agent); divergência encerra a sessão | `clientFingerprint()` |
| Renovação com trava de 10 min, para não consumir a cota de escrita do KV | `verifySession()` |
| `Clear-Site-Data` no logout — apaga cache, cookies e storage do browser | `handleLogout()` |

## 3. Proteção da aplicação

| Vetor | Medida |
| --- | --- |
| **XSS** | Escape canônico de 5 caracteres em toda interpolação; gate de CI proíbe a variante de 3 caracteres |
| **XSS via URL** | `safeUrl()` — allowlist de esquema aplicada **no ponto de uso**, não só na gravação, cobrindo dados legados e restaurados |
| **XSS** | CSP com nonce por requisição em todos os `<script>`; CSP estrita em Report-Only com coletor em `/api/csp-report` |
| **CSRF** | `Sec-Fetch-Site`/`Origin` verificados **antes do roteamento**, para todo método que escreve. Recusa `same-site`, que o cookie `SameSite=Strict` sozinho aceitava |
| **Clickjacking** | `X-Frame-Options: DENY` + `frame-ancestors 'none'` |
| **MIME sniffing** | `X-Content-Type-Options: nosniff` em todas as respostas |
| **Downgrade para HTTP** | HSTS de 2 anos com `includeSubDomains`; `upgrade-insecure-requests` |
| **Injeção SQL** | Prepared statements com bind em 100% dos acessos ao D1 |
| **Injeção de fórmula em CSV** | `csvCell()` neutraliza `= + - @ TAB CR` iniciais — os campos `consenter_name`, `user_agent` e `referrer` são controlados pelo visitante e abrem na planilha do controlador |
| **Upload malicioso** | Verificação de magic bytes (`isLikelyImage`), teto de 2 MB, nome de arquivo higienizado |
| **Enumeração de projetos** | Nonce de página assinado (HMAC), amarrado ao slug, validade de 2 h |
| **Bots** | Turnstile fail-closed + honeypot + token de formulário com idade mínima |
| **Vazamento por cache** | `no-store` em toda resposta de dado; `noindex` e `no-referrer` no painel |
| **Poluição de dados via restore** | Backup restaurado é higienizado por chave, tipo e tamanho |

## 4. Minimização (art. 6º, III)

Não é um controle acessório: é o que reduz o impacto de todos os incidentes de
uma vez.

- Mensagem de suporte **nunca é armazenada** — vai por e-mail e acabou.
- Foto de pedido de remoção **não vai para banco** — trafega só no e-mail.
- **EXIF/GPS removido no servidor** antes de a foto virar anexo
  (`stripImageMetadata()`): quem pede para sumir de uma foto não está oferecendo
  onde ela foi tirada.
- Alertas de erro carregam mensagem, stack truncada e rota — **nunca** IP,
  cabeçalhos ou corpo de requisição.
- Telemetria de desempenho sem identificador, sem cookie, sem IP.
- `/api/healthz` expõe **booleanos** de configuração, nunca valores de secret.
- Nome no gate do Drive é **opcional**.

## 5. Criptografia

| Em trânsito | TLS obrigatório (Cloudflare), HSTS de 2 anos, `upgrade-insecure-requests` |
| --- | --- |
| **Em repouso** | Cifrado pelo provedor: Cloudflare KV e D1, Google Drive. Sem camada adicional de cifra da aplicação |
| **Credenciais** | PBKDF2-SHA256 100k, salt por credencial. Senha em texto claro nunca é gravada nem registrada |
| **Segredos** | Cloudflare Secrets e GitHub Actions Secrets. **Nunca no repositório** — verificado por gate de CI |

⚠️ Não há cifra de campo na aplicação sobre o log de consentimento. Justificativa:
a chave teria de viver no mesmo ambiente que o dado (o Worker), o que protege
contra vazamento do arquivo de banco mas não contra comprometimento da conta —
que é o cenário realista aqui. A proteção efetiva é o controle de acesso da
seção 1 e a retenção curta.

## 6. Detecção e resposta

| Sinal | Como chega |
| --- | --- |
| Exceção não tratada | E-mail (`sendErrorAlert`), com cooldown global de 15 min |
| Força bruta no login | E-mail a partir de 5 falhas em 15 min |
| Tentativa de XSS | Relatório de CSP em `/api/csp-report` → log estruturado |
| Cron morto em silêncio | `cron:last` + `cron.stale` em `/api/healthz` |
| Falha na poda de retenção | E-mail (antes só existia nos logs) |
| Configuração incompleta | `auditSite()` acusa secret ausente — inclusive `SIGNING_SECRET`, cuja falta **desliga controles sem quebrar nada** |
| Disponibilidade | `status.lucafchala.com` + `/api/healthz` |

Procedimento completo: [`plano-resposta-incidentes.md`](./plano-resposta-incidentes.md).

## 7. Ciclo de desenvolvimento

| Controle | Onde |
| --- | --- |
| Lint obrigatório | `checks.yml` |
| Suíte de testes obrigatória antes do deploy | `checks.yml`, `deploy.yml` |
| Testes dedicados de segurança | `tests/security.test.js`, `tests/drive-gate.test.js` |
| CodeQL `security-extended`, semanal e por PR | `security.yml` |
| `npm audit` com falha em `high+` | `security.yml` |
| Revisão de dependência bloqueando PR | `security.yml` |
| Dependabot semanal (npm + Actions) | `dependabot.yml` |
| Invariantes estruturais (portão de CSRF na posição certa, nenhum `eval`, nenhum secret literal, todo `<script>` com nonce) | `security.yml` |
| Verificação dos cabeçalhos na **resposta real de produção** | smoke test do `deploy.yml` |
| Menor privilégio no token dos workflows | `permissions: contents: read` |

## 8. Divulgação responsável

`security@lucafchala.com`, com chave PGP, publicado em
`/.well-known/security.txt` conforme **RFC 9116**. Política, escopo e prazo de
resposta em [`SECURITY.md`](../../SECURITY.md).

## 9. Limitações conhecidas — declaradas, não escondidas

Um documento de segurança que só lista acertos é propaganda. Estas são as
fragilidades conhecidas, com o motivo de cada uma:

1. **Link do Drive é redistribuível.** Inerente à entrega por Drive. Reduzir
   exigiria servir as fotos por rota própria, o que esbarra na cota de
   requisições do Worker.
2. **`'unsafe-inline'` ainda vale para scripts.** A UI usa handlers inline
   (`onclick="…"`), que nonce nenhum cobre. A política estrita já roda em
   Report-Only, medindo o que falta; a virada acontece quando os relatórios
   zerarem.
3. **Caminho sem JavaScript é mais fraco.** Com o Turnstile bloqueado por
   ad-blocker, o cliente usa `turnstileToken: "noscript"`. Continua sendo um
   POST por evento, com rate limit mais apertado e auditado com
   `turnstile_ok=0`. É uma escolha de acessibilidade, documentada.
4. **Sem segundo fator no painel.** Registrado no TODO (magic link ou TOTP).
5. **Sem COEP.** `require-corp` quebraria as imagens do
   `lh3.googleusercontent.com`, que não enviam CORP.
6. **HSTS sem `preload`.** É compromisso de domínio inteiro, praticamente
   irreversível — decisão do dono, não efeito colateral de um commit.
7. **EXIF não removido em HEIC/AVIF/GIF.** Reescrever esses contêineres sem
   decodificador arriscaria corromper a prova enviada pelo titular.

## 10. Governança

- **Responsável:** Luca Ferriani Chala (controlador, encarregado e único
  operador humano).
- **Revisão:** anual, ou a cada mudança de operador, categoria de dado ou prazo
  de retenção.
- **Registro de incidentes:** `docs/legal/incidentes/`.
- **Registro de pedidos de titulares:** `docs/legal/pedidos/`.
