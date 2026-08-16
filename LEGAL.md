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

## Nota sobre a Central de Transparência (2026-08)

Privacidade, Termos, política de segurança, o resumo do que é feito com os dados
e toda a documentação de conformidade (`docs/legal/`) passaram a ter um hub
público em [`/legal`](https://fotos.lucafchala.com/legal) (também servido em
`/compliance`). No rodapé, os links "Privacidade" e "Termos" deram lugar a um
único **"Legal"**, que aponta para esse hub.

**Isso não reduz o acesso às políticas** — ao contrário: os dois documentos
continuam a um clique, e a página de destino acrescenta o que antes exigia saber
onde procurar (prazos de retenção, base legal, canais de contato, direito de
reclamar à ANPD e os documentos de governança na íntegra). A motivação foi
duplo-propósito: o rodapé estava com seis links competindo por atenção, e os dois
jurídicos eram justamente os que ninguém clica quando estão soltos ali.

**Efeito no hash dos Termos.** `getTermsHash()` é calculado sobre o HTML
renderizado de `termsHTML()`, que inclui o rodapé compartilhado
(`footerLegalLinksHTML()`). Trocar dois links por um muda esse hash. Pela mesma
razão registrada na nota de linguagem abaixo, **isso não exige nova
`TERMS_VERSION` nem novo aceite**: nenhum trecho com efeito jurídico foi
alterado — o escopo da autorização de imagem, a identificação do controlador e
as referências a responsável legal de menor estão intocados. O hash continua
sendo a prova forense de qual texto exato foi aceito em cada momento, e cada
registro antigo segue apontando corretamente para o texto vigente no seu aceite.

## Nota sobre esta revisão de linguagem (2026-08)
Passei `terms.js`/`privacy.js` de linguagem impessoal ("contate o dono", "fale com a gente") para primeira pessoa ("fale comigo"), já que o site é assinado por uma única pessoa. **Nenhum trecho com efeito jurídico foi alterado**: a identificação formal do controlador/responsável (nome legal + canal de contato, ponto 8 acima) e as referências a "responsável legal" de menor permanecem intactas, palavra por palavra. Como o hash gravado a cada aceite (`getTermsHash()` em `src/index.js`) é calculado sobre o HTML renderizado de `termsHTML()`, essa edição muda o hash — mas não muda o escopo da autorização nem exige nova versão (`TERMS_VERSION`) ou novo aceite dos usuários já registrados: o hash é a prova forense de qual texto exato foi aceito em cada momento, e continua correto para cada registro antigo (ele referencia o texto vigente naquele aceite, não o texto atual). Nenhum dos pontos "PRECISA de decisão jurídica" acima foi resolvido por esta revisão — continuam pendentes de parecer.
