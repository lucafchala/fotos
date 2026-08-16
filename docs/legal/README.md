# Documentação de conformidade — LGPD

> ## ⚠️ Isto não é parecer jurídico
>
> Todos os documentos desta pasta foram **redigidos com auxílio de IA** e
> refletem o que o sistema faz de fato (foram escritos lendo o código, não
> presumindo o que ele deveria fazer). Isso os torna um **pacote de handoff**
> útil e um retrato honesto da operação — **não** um substituto para a análise
> de um(a) advogado(a) brasileiro(a) com prática em LGPD e direito de imagem.
>
> Vários pontos marcados **⚠️ DECISÃO JURÍDICA** ao longo dos arquivos dependem
> de fatos que só o controlador conhece (o que está no contrato com a escola, se
> há autorização assinada pelos responsáveis) ou de juízo profissional (prazos
> prescricionais, cláusula de foro). Estes documentos **não** resolvem esses
> pontos — eles os isolam e organizam para que a revisão jurídica seja rápida e
> barata.

## O que é cada arquivo

| Arquivo | O que é | Base legal |
| --- | --- | --- |
| [`ROPA.md`](./ROPA.md) | Registro das operações de tratamento — o inventário: cada dado, de onde vem, por quê, por quanto tempo, para onde vai | Art. 37 |
| [`RIPD.md`](./RIPD.md) | Relatório de Impacto à Proteção de Dados Pessoais (DPIA) — riscos e salvaguardas, com ênfase em crianças e adolescentes | Art. 5º XVII, art. 38 |
| [`LIA.md`](./LIA.md) | Teste de Legítimo Interesse — a análise que sustenta a publicação das fotos de quem não deu aceite | Art. 7º IX, art. 10 |
| [`transferencia-internacional.md`](./transferencia-internacional.md) | Todos os operadores ficam fora do Brasil; este é o mapeamento e o fundamento de cada transferência | Art. 33 |
| [`politica-de-retencao.md`](./politica-de-retencao.md) | Prazo de cada categoria, o mecanismo que apaga, e como verificar que apagou mesmo | Art. 15, 16 |
| [`direitos-do-titular.md`](./direitos-do-titular.md) | Procedimento de atendimento: canais, prazos, como confirmar identidade, o que responder | Art. 18 |
| [`plano-resposta-incidentes.md`](./plano-resposta-incidentes.md) | O que fazer nas primeiras horas, critério de comunicação à ANPD e aos titulares, modelos prontos | Art. 48; Res. CD/ANPD nº 15/2024 |
| [`politica-seguranca-informacao.md`](./politica-seguranca-informacao.md) | As medidas técnicas e administrativas que o art. 46 exige que existam — e a evidência de cada uma no código | Art. 46, 47, 49 |
| [`termo-autorizacao-uso-imagem.md`](./termo-autorizacao-uso-imagem.md) | Modelos para assinatura: adulto, responsável por menor, e instituição contratante | Art. 7º I, art. 14; CC art. 20 |
| [`checklist-conformidade.md`](./checklist-conformidade.md) | Estado item a item: o que está pronto, o que falta, o que depende de decisão de terceiro | — |

O resumo executivo para a revisão jurídica continua em
[`../../LEGAL.md`](../../LEGAL.md); os pontos que dependem de parecer estão
listados lá e referenciados aqui.

## Porte do agente de tratamento

O controlador é **pessoa natural** que trata dados em atividade profissional de
pequeno porte. A **Resolução CD/ANPD nº 2/2022** cria um regime simplificado
para "agentes de tratamento de pequeno porte", que — se aplicável — flexibiliza
a forma (não a existência) de várias obrigações: registro simplificado,
indicação de encarregado facultativa desde que haja canal de comunicação
divulgado, e prazos dobrados para atendimento.

Estes documentos foram escritos **no formato completo**, sem invocar a
simplificação. A razão é prática: é mais fácil um advogado dizer "você pode
simplificar isto" do que reconstruir o que não foi feito. Não é uma opinião
sobre o enquadramento.

⚠️ **DECISÃO JURÍDICA:** confirmar o enquadramento como agente de pequeno porte
e quais flexibilizações o controlador quer efetivamente adotar.

## Como manter isto vivo

Documento de conformidade desatualizado é pior que nenhum: ele descreve
controles que não existem mais e cria uma expectativa que a operação não cumpre.

Reveja **quando**:

- entrar ou sair um operador (Google, Cloudflare, Resend…) → `ROPA`, `transferencia-internacional`;
- mudar um prazo de retenção no código (`CONSENT_RETENTION_DAYS`, `REMOVAL_RETENTION_DAYS` em `src/index.js`) → `politica-de-retencao`;
- mudar o texto dos Termos (`src/ui/terms.js` + `TERMS_VERSION`) → `LIA`, `termo-autorizacao-uso-imagem`;
- mudar um campo coletado no gate do Drive (`CONSENT_COLS` em `src/index.js`) → `ROPA`, `RIPD`;
- ocorrer um incidente → `plano-resposta-incidentes` (a lição aprendida volta para o plano).

E de todo modo **uma vez por ano**, mesmo sem mudança — a revisão anual é o que
detecta a divergência que ninguém percebeu no caminho.
