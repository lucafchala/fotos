# Conformidade legal — resumo para revisão jurídica

> **Aviso:** este documento e os textos de `/termos` e `/privacidade` foram redigidos
> com auxílio de IA e **não constituem parecer jurídico**. Antes de confiar neles em
> produção, peça a revisão de um(a) advogado(a) brasileiro(a) com prática em LGPD e
> direito de imagem. Este arquivo serve de **pacote de handoff** para essa revisão.

## Controlador / contato
- **Controlador:** Luca Ferriani Chala (pessoa física).
- **Encarregado/DPO (canal):** privacidade@lucafchala.com · suporte: suporte@lucafchala.com · segurança: security@lucafchala.com.
- Páginas públicas: [`/privacidade`](https://fotos.lucafchala.com/privacidade), [`/termos`](https://fotos.lucafchala.com/termos), [`/suporte`](https://fotos.lucafchala.com/suporte), `/.well-known/security.txt`, `/.well-known/gpc.json`.

## Inventário de dados e bases legais (como está hoje no site)
| Dado | Origem | Base legal declarada | Retenção |
| --- | --- | --- | --- |
| Imagem dos participantes (fotos do evento) | Captação no evento | **Legítimo interesse** (art. 7º IX) p/ entrega + **consentimento/autorização** (art. 7º I LGPD; art. 20 CC) no aceite ao acessar o Drive — abrange entrega, divulgação do trabalho e **publicação editorial/cultural** (ver ponto 3) | Enquanto publicado; removível a pedido |
| Registro de aceite (consent log, D1) | Gerado no acesso ao Drive | Comprovação / exercício regular de direito | **5 anos** (cron) |
| Solicitação de remoção (e-mail, telefone, foto) | Formulário | Consentimento + cumprimento de pedido do titular | **6 meses** após resolução (cron) |
| Mensagem de suporte | Formulário | Consentimento | Não armazenada (vai por e-mail) |
| Contadores de view/clique (KV) | Acesso | Legítimo interesse (métrica) | Indefinido (agregado, sem PII) |

## Operadores / terceiros
Google Drive (hospedagem/entrega das fotos) · Cloudflare (hospedagem, medição anônima, **Turnstile em modo invisível** — ver [Adendo de Privacidade do Turnstile](https://www.cloudflare.com/turnstile-privacy-policy/)) · Resend (e-mails) · Google Fonts.

## Segurança (resumo técnico)
PBKDF2-SHA256 100k + comparação tempo-constante; sessão HttpOnly/Secure/SameSite=Strict (24 h); CSP/HSTS/COOP/CORP; Turnstile; rate-limit por IP (inclui login); escaping de saída; validação de entrada + sniff de upload por magic bytes; cron de retenção; `security.txt` (RFC 9116) e procedimento de incidente (art. 48 LGPD).

## ⚠️ Pontos que PRECISAM de decisão/parecer jurídico
1. **Menores de idade (prioridade).** Eventos escolares envolvem crianças/adolescentes (art. 14 LGPD). Hoje o site declara que o aceite, quando se refere a menor, é dado por responsável e que o consentimento também é coletado junto à instituição contratante. **Confirmar:** isso é feito de fato no contrato com a escola/organização? Há **termo de autorização de uso de imagem** assinado pelos responsáveis? O aceite no site é suficiente como apoio ou é preciso coleta formal no evento?
2. **Legítimo interesse para não-consentintes.** A publicação se apoia em legítimo interesse para quem não faz o aceite. Avaliar necessidade de um **LIA (teste de legítimo interesse)** documentado e se o canal de remoção é salvaguarda suficiente.
3. **Escopo da autorização de imagem.** O aceite autoriza: (a) entrega; (b) divulgação do trabalho do fotógrafo (portfólio/site/redes); e (c) **publicação editorial, jornalística, cultural e educacional** — jornais e publicações estudantis/escolares (ex.: o jornal do colégio "O Búfalo"), zines, livros, catálogos, exposições, concursos e obras coletivas. Redação **mídia- e prazo-agnóstica** (qualquer meio impresso/digital/online hoje existente ou futuro, Brasil e exterior, prazo indeterminado) para não exigir reedição a cada novo canal. Excluídos: venda, licenciamento comercial e publicidade de terceiros (dependeriam de termo específico). **Confirmar:** (i) a redação atende ao pretendido; (ii) cabe **termo separado** para usos comerciais; (iii) o alcance editorial vale **apenas para quem aceitou a versão dos Termos que já o previa** (≥ 2026-06-18) — cada registro fixa versão + hash; para fotos de quem não aceitou (base de legítimo interesse) ou aceitou versão anterior, a publicação editorial **não está coberta** e pede autorização específica.
4. **Prazos de retenção** (consent log 5 anos; remoção 6 meses) — adequados ao prazo prescricional aplicável?
5. **Foro** de São Paulo/SP × foro do consumidor (CDC) — validar a cláusula.
6. **Formalização do DPO** e eventual necessidade de registro/processos perante a ANPD.
7. **Contrato com o cliente** que encomenda o trabalho (fora do site) — modelo de cessão/licença e autorização de imagem.
8. **Publicação em veículo de terceiros (jornal escolar "O Búfalo") — atenção redobrada.** Quando a foto for publicada por um terceiro (o jornal do colégio), e não só pelo fotógrafo, avaliar: (i) o veículo/escola deve ter sua própria base legal/consentimento para a publicação; (ii) imagens de **menores** em jornal escolar pedem **autorização específica e informada do responsável** para aquela publicação, além do aceite genérico do site; (iii) considerar um **termo de autorização dedicado** nomeando a publicação. Recomendação prática: para "O Búfalo", usar fotos de quem aceitou os Termos na versão ≥ 2026-06-18 (ou obter autorização específica), com cuidado redobrado quando houver menores.

## Onde editar
Textos: `src/ui/terms.js` e `src/ui/privacy.js`. A versão dos Termos é `TERMS_VERSION` em `src/utils.js` (cada aceite grava essa versão + hash do texto). Retenções: `CONSENT_RETENTION_DAYS` e `REMOVAL_RETENTION_DAYS` em `src/index.js`.
