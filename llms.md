# llms.md — para uma sessão de agente trabalhando neste repositório

Este arquivo é sobre **ferramentas**: quais usar, para quê, e o que cada uma
não substitui. Não repete o que já está documentado — cada seção abaixo aponta
para onde a informação mora, e só entra em detalhe no que é específico de
operar este repositório a partir de uma sessão de agente (Claude Code ou
qualquer outro com acesso à API do GitHub).

Se você chegou aqui a partir do `CLAUDE.md`, comece pelo próximo parágrafo. Se
chegou direto, leia primeiro o [`RETOMADA.md`](./RETOMADA.md) — ele descreve o
projeto, onde está cada coisa e as armadilhas já conhecidas do código. Este
arquivo pressupõe que você já leu aquele.

---

## 1. Regra geral: o repositório local e o GitHub divergem, e só o GitHub sabe qual dos dois está certo

Nada neste arquivo, no `README.md`, no `TODO.md` ou no `RETOMADA.md` descreve o
estado **agora** de CI, PRs ou branches — só descreve intenção e histórico.
Antes de agir com base em "a suíte deve estar verde" ou "esse PR deve estar
limpo", confirme pela API do GitHub. Já aconteceu nesta sessão: um commit que
passou limpo em `npm test` local derrubou a invariante de CI "Só o link de
código-fonte pode apontar para o GitHub" (`security.yml`) porque a regra
opera sobre o texto do arquivo-fonte, não sobre o comportamento renderizado —
e só a chamada à API revelou isso, não uma suposição a partir do que o código
"deveria" fazer.

**Prática:** depois de push, confira o run de verdade — não assuma que passou
porque passou local, e não assuma que falhou por um motivo antes de ler o log
do job que falhou.

---

## 2. Ferramentas de GitHub (MCP) — quando usar cada uma

### Estado de PR e CI

- `pull_request_read` com `method: get_status` ou `get_check_runs` — o estado
  real de um PR. `get_check_runs` traz cada job por nome (`Invariantes de
  segurança`, `Dependências`, `checks`, `CodeQL`, `Workers Builds`); use para
  saber **qual** verificação falhou antes de tentar adivinhar pelo título do
  commit.
- `pull_request_read` com `method: get_diff` / `get_files` — o diff de
  verdade, não a memória da sessão sobre o que foi editado.
- `actions_list` (`list_workflow_runs`, `list_workflow_jobs`) e `actions_get`
  — para achar o run/job certo quando o check falhou e o motivo não está
  óbvio no resumo.
- `get_job_logs` com `failed_only: true` — o log do job que falhou, sem
  precisar abrir o run inteiro. É o primeiro passo real de diagnóstico, não
  suposição sobre o que o step provavelmente fez.

**Não são a mesma coisa:** `npm test`/`npm run lint` locais e os checks do
CI. Os dois têm de passar, mas só o CI é o que decide se o PR pode ser
mergeado — rode os dois, confie no CI.

### Merge

- `merge_pull_request` — só depois de `get_check_runs` mostrar tudo
  `success`/`neutral` e o PR não ser rascunho. Para os PRs do Dependabot
  (bumps de patch/minor em devDependencies, sem mudança de comportamento no
  runtime), isso é suficiente para mergear sem revisão adicional; para
  qualquer coisa que toque `src/`, os checks verdes são necessários, não
  suficientes — leia o diff.
- O método de merge deste repositório é **merge commit** (`merge_method:
  "merge"`), não squash nem rebase — é o que o histórico em `main` já usa.

### Abrir e manter PRs

- `create_pull_request` — sempre como rascunho (`draft: true`), seguindo
  `.github/pull_request_template.md`. Preencha as seções que se aplicam à
  mudança; apague o resto, como o próprio template pede.
- `subscribe_pr_activity` / `unsubscribe_pr_activity` — para acompanhar CI e
  comentários de review sem ficar consultando em loop. Prefira isto a
  reconsultar `get_check_runs` em intervalo curto.
- `update_pull_request_branch` — para trazer `main` para dentro de um PR que
  ficou para trás; depois de um merge de Dependabot, por exemplo.

### Issues — onde vive um item de ação novo

Desde 2026-09, item de ação novo vira **Issue do GitHub**
(`issue_write` com `method: create`), não uma linha nova em `TODO.md`. O
`TODO.md` continua sendo a fonte da política, do orçamento de cota e das
"Regras vivas" — o que não é "uma tarefa para fazer". Os itens que ainda
restam como `- [ ]` em `TODO.md` são o que falta migrar; migre ao tocar
naquela seção (crie a Issue com o conteúdo completo do item, depois apague a
linha — não deixe as duas cópias, é a mesma armadilha de "regra escrita duas
vezes").

- `issue_write` (`method: create`) — título curto, corpo com o contexto
  completo (o "porquê", não só o "o quê" — mesmo padrão dos commits deste
  repositório). Sem rótulos customizados; o repositório não tem taxonomia
  própria ainda.
- `list_issues` — para não duplicar um item que já virou Issue.
- `issue_write` (`method: update`, `state: closed`, `state_reason`) — para
  fechar quando o item for entregue; o PR que entrega deve referenciar a
  Issue (`Fixes #N` no corpo, como o template de PR já pede).

### O que **não** existe neste conjunto de ferramentas

Descoberto tentando, não suposto: não há tool para **branch protection /
ruleset**, **topics do repositório**, nem **criar uma GitHub Release**. Essas
três exigem a UI do GitHub (Settings → Branches / General / Releases) ou uma
automação de CI que use o `GITHUB_TOKEN` do próprio workflow. Se a tarefa
pedir uma dessas três, não finja que existe uma chamada de API disponível —
diga que precisa ser feito manualmente ou proponha o caminho de automação
(um step novo em algum `.github/workflows/*.yml`), sem executá-lo sem
confirmação: mexer no pipeline de deploy já quebrou produção mais de uma vez
(ver `RETOMADA.md`, "As armadilhas").

---

## 3. Verificação — três camadas, nenhuma substitui a outra

1. **Local:** `npm run lint && npx tsc --noEmit && npm test` (ou
   `npm run typecheck`, que é o mesmo `tsc --checkJs`). Rápido, roda antes de
   cada commit.
2. **CI (GitHub Actions):** a fonte da verdade sobre se um PR pode ser
   mergeado. Confira com as tools da seção 2 — não infira do que rodou local.
3. **Browser de verdade:** mudança em UI, CSP ou rota pública/painel precisa
   disto. `npm test` verde já conviveu com a interface inteira quebrada (CSP
   matando handlers inline, galeria ilegível sem JS) — ver `RETOMADA.md`
   §5.1 e `docs/VERIFICACAO.md`. Nenhuma das duas primeiras camadas enxerga
   isso.

---

## 4. Fluxo de trabalho de uma sessão de agente neste repositório

1. Branch a partir de `main` (o harness que abriu a sessão normalmente já
   designa qual).
2. Código + teste, rodando as três camadas da seção 3 conforme a mudança.
3. Commit com mensagem que explica o **porquê**, não só o quê — mesmo padrão
   dos commits já em `main`.
4. Push; se não houver PR aberto para o branch ainda, abra um (rascunho,
   com o template).
5. Confirme o estado real do PR pela API (seção 2), não por suposição.
6. Se o TODO.md tinha um item fechado pela mudança, **apague o item** — não o
   transforme em relato do que foi feito (regra do próprio arquivo).

Documentação e código do site nunca devem ficar em commits misturados só por
conveniência — mas duas mudanças pequenas e relacionadas no mesmo branch/PR
são aceitáveis; PRs pequenos e focados são preferíveis, como o próprio
template de PR pede.
