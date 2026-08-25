<!--
  Preencha o que for relevante e apague o resto. PRs pequenos e focados
  são mais fáceis de revisar — se este PR mistura assuntos sem relação,
  considere separar.
-->

## Resumo

<!-- O que muda e por quê. Prefira explicar o motivo (o bug, a limitação,
     o pedido) em vez de só descrever o diff — o diff já mostra o "o quê". -->

Fixes #

## Tipo de mudança

- [ ] Correção de bug
- [ ] Funcionalidade nova
- [ ] Segurança / LGPD (dados pessoais, consentimento, XSS, auth, sessão)
- [ ] Refatoração (sem mudança de comportamento)
- [ ] Documentação
- [ ] Infra / CI / dependências

## Detalhes

<!-- O que causava o problema (se for bug) ou como a funcionalidade foi
     implementada. Inclua trechos de log/erro reais quando ajudar a
     revisão. Se tocou em template strings de HTML/JS do painel ou das
     páginas públicas, lembre que esse código não é lintado nem
     typechecado (vive dentro de strings) — descreva como validou manualmente. -->

## Test plan

<!-- `npm test` prova que as funções fazem o que as funções fazem, não que
     o site funciona — ver docs/VERIFICACAO.md. Marque o que rodou de fato. -->

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test:unit`
- [ ] `npm run test:workers` (necessário se a mudança envolve Durable Objects, KV ou D1 — atomicidade e persistência só se provam na plataforma)
- [ ] Verificação manual no navegador (`npx wrangler dev` ou o harness local — ver [docs/VERIFICACAO.md](../docs/VERIFICACAO.md)), cobrindo o caminho feliz e pelo menos um caso de borda
- [ ] Testado com JavaScript desabilitado, se a mudança afeta páginas públicas

## Impacto em dados / migração

- [ ] Sem mudança de schema (KV ou D1)
- [ ] Muda o formato de algo já salvo no KV — compatível com dados antigos sem migração?
- [ ] Nova migration em `migrations/` incluída e testada
- [ ] Afeta o formato do backup/restauração

## Segurança e LGPD (se aplicável)

- [ ] Não introduz XSS (toda interpolação em HTML passa por `esc`/escaping apropriado)
- [ ] Não expõe dados de sessão, senha ou segredo em log, resposta de erro ou commit
- [ ] Mudança em autenticação/sessão foi verificada tanto autenticada quanto deslogada
- [ ] Mudança em consentimento/Termos de Uso preserva o registro de auditoria (D1)

## Screenshots / evidência

<!-- Para mudanças visuais no painel ou nas páginas públicas, antes/depois. -->

## Notas para quem revisar

<!-- Algo que o revisor deveria olhar com atenção especial, decisão que
     ficou de fora de propósito, ou trade-off que valeu a pena registrar. -->
