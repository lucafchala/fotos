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

## Test plan (automatizado)

<!-- `npm test` prova que as funções fazem o que as funções fazem, não que
     o site funciona — ver docs/VERIFICACAO.md. Marque o que rodou de fato. -->

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test:unit`
- [ ] `npm run test:workers` (necessário se a mudança envolve Durable Objects, KV ou D1 — atomicidade e persistência só se provam na plataforma)

## Ações e verificações manuais

<!-- Testes verdes já esconderam regressão real nesta base: um nonce na CSP
     matou ~63 handlers inline com a suíte inteira passando, e a galeria
     quebrou sem JS sem nenhum teste acusar (ver docs/VERIFICACAO.md). Rode
     via `npx wrangler dev` ou o harness local, e marque só o que se aplica
     à área tocada por este PR — apague o resto. -->

**Geral**
- [ ] Console do navegador sem erros/warnings novos
- [ ] Sem violação de CSP no Console/Network (nonce, scripts inline)
- [ ] Testado com JavaScript desabilitado — páginas públicas devem degradar, não quebrar
- [ ] Testado em viewport mobile e desktop

**Galeria e página pública** (`/`, `/<slug>`)
- [ ] Galeria lista os eventos visíveis e respeita `pinned` / `comingSoon` / `visible`
- [ ] Carrossel de fotos de capa funciona
- [ ] Gate de acesso: Turnstile carrega, aceite dos Termos é exigido, link do Drive só libera depois de passar pelo gate
- [ ] "Acessar fotos" registra a métrica de visita; abrir o Drive registra o clique
- [ ] Banner de "novas fotos" aparece e expira conforme configurado
- [ ] Formulário de solicitação de remoção envia

**Painel administrativo** (`/dashboard`)
- [ ] Login e logout
- [ ] CRUD de evento (criar, editar, excluir), reordenar, marcar featured / em breve / oculto
- [ ] Aba de Métricas abre sem erro, inclusive com projeto que tem `views > 0`
- [ ] Backup (download) e restauração (upload) preservam os dados
- [ ] Troca de senha
- [ ] Solicitações de remoção: listar e resolver, e-mail de confirmação disparado

**Suporte / e-mails transacionais**
- [ ] Formulário de contato envia e-mail via Resend e mostra confirmação
- [ ] Links de WhatsApp e e-mail direto funcionam

**Autenticação e sessão** (se a mudança tocou em auth/cookies)
- [ ] Rota protegida sem sessão retorna 401/redirect, nunca 200
- [ ] Sessão expira/renova como esperado; logout revoga de fato
- [ ] Cookie legado não sobrepõe uma sessão `__Host-session` válida (ver TODO.md)

**PWA**
- [ ] Manifest/ícones carregam sem erro 404
- [ ] Instala e abre offline (se a mudança tocou em service worker/cache)

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
