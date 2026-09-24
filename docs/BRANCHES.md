# Branches — como uma mudança chega à produção

`main` é produção: cada merge dispara o `deploy.yml`, que publica uma versão
sem tráfego e a promove — o smoke roda **antes** da promoção quando a
Cloudflare entrega URL de preview, e **depois** dela, com reversão automática,
quando não entrega (é o caso hoje: #179). Não existe outro caminho para o
site. Por isso tudo aqui gira em torno de uma ideia só: **o que entra
na `main` entra por PR, com a CI verde, um assunto por vez.** PR pequeno é
deploy pequeno — fácil de revisar, fácil de reverter sozinho.

Este é o único lugar onde estas regras estão escritas; `llms.md` e
`RETOMADA.md` apontam para cá.

## Os branches

| Branch | Vive | Para quê |
| --- | --- | --- |
| `main` | sempre (protegida) | Produção. Só recebe merge de PR. |
| `feat/<issue>-<assunto>` | até o merge | Funcionalidade nova. |
| `fix/<issue>-<assunto>` | até o merge | Correção de defeito, inclusive de segurança. |
| `docs/<assunto>` | até o merge | Só documentação. Mexeu em `docs/legal/` ou `SECURITY.md`? `npm run build:legal` no mesmo branch. |
| `chore/<assunto>` | até o merge | CI, dependências, ferramentas, organização do repositório. |
| `hotfix/<assunto>` | horas | Produção quebrada agora. Mesmo fluxo, o menor diff que resolve. |
| `claude/<nome-gerado>` | até o merge | Sessão do Claude Code. A plataforma dá o nome; as regras são as mesmas. |
| `dependabot/…` | até o merge | Do Dependabot. Não mexa à mão — a configuração está em `.github/dependabot.yml`. Ver "PRs do Dependabot" abaixo. |

`<issue>` é o número da issue que o branch resolve (`fix/118-queda-do-kv`);
sem issue, só o assunto. Minúsculas, palavras separadas por hífen.

**Não há `develop` nem `staging`, de propósito.** Cada PR já ganha um build
próprio (Workers Builds), e o deploy da `main` passa por versão sem tráfego,
smoke e reversão automática — o papel que um staging teria. Um branch de
integração sem ambiente próprio só acumularia diferença em relação à
produção.

**Preview de PR não é isolado.** A versão enviada usa os bindings do próprio
Worker — o KV, o D1 e os Durable Objects de produção. Navegue à vontade num
preview; não teste escrita nele (criar projeto, restaurar backup, resolver
pedido de remoção).

## O ciclo de um branch

1. **Nasce da `main` atualizada:**
   `git fetch origin main && git switch -c fix/123-assunto origin/main`
2. **Um assunto só.** Achou outra coisa no caminho? Issue nova ou branch
   novo — não pendure no PR que já está aberto.
3. **PR em rascunho** desde o primeiro push, com o template. Sai do rascunho
   quando a CI está verde e a verificação da área tocada foi feita
   (`docs/VERIFICACAO.md`).
4. **PR pronto é PR congelado.** Depois de marcado como pronto (ou aprovado),
   commit novo só para responder à revisão. Trabalho novo vai para branch
   novo — senão o merge leva para produção algo que ninguém revisou.
5. **Merge** com merge commit, o método do repositório — um por vez (ver
   "Merge = deploy" abaixo).
6. **O branch é apagado no merge** (automático, ver abaixo). Branch mergeado
   não é arquivo: o conteúdo está na `main`, e a página do PR tem o botão
   *Restore branch* se um dia for preciso.

## PR empilhado — a armadilha que já fez uma mudança sumir

Às vezes um branch depende de outro que ainda não entrou, e a base do PR é o
branch de baixo, não a `main`. Pode — com duas regras:

- o PR de cima fica **em rascunho** enquanto o de baixo não for mergeado;
- quando o de baixo for para a `main`, **troque a base do de cima para
  `main` antes de mergear.**

Mergear no branch de baixo depois que ele já foi para a `main` faz a mudança
sumir: o PR aparece como *merged*, mas nada chega à produção. Aconteceu com o
#20 (Turnstile no login do painel), em junho de 2026: ele foi mergeado em
`claude/sharp-pascal-qnhwtd` dez minutos depois de esse branch ter ido para a
`main` pelo #19, e o login nunca ganhou o Turnstile. Com a exclusão
automática ligada, o GitHub troca a base sozinho quando o branch de baixo é
apagado no merge — confira mesmo assim.

**Trocar a base não roda a CI de novo — e o CodeQL nem tinha rodado.** O
CodeQL deste repositório é o *default setup* (configurado nas Settings, não
em workflow), e ele só analisa PR cuja base é a `main`: enquanto o PR está
empilhado, a lista de checks parece completa sem ele. Depois de trocar a base,
traga a `main` para o branch (*Update branch*, ou `update_pull_request_branch`
numa sessão) — o push é o que dispara a análise — e confira o CodeQL antes do
merge. Foi assim que apareceu, só no fim, um alerta alto no #163 que ficou
escondido enquanto ele estava empilhado.

## Merge = deploy: um por vez

Cada merge publica. Com vários PRs prontos, a ordem é:

1. traga a `main` atual para o PR (*Update branch*) e espere a CI verde **no
   head novo** — o que foi testado tem de ser o que vai para produção;
2. mergeie **um**;
3. espere o `Deploy` desse merge terminar **verde** antes de mergear o
   próximo.

O passo 3 não é zelo: o smoke roda depois da promoção (#179), e se ele
reprovar a reversão automática devolve a produção à versão anterior — mas a
`main` continua com o commit ruim. O próximo merge dispara um deploy da `main`
inteira e **republica** o que acabou de ser revertido. Depois de uma
reversão, nada entra até o commit ruim ser revertido no Git
(`git revert <sha>` em PR próprio).

O check agregado do **CodeQL** às vezes sai *neutral* ("configuration not
found") por ter rodado segundos antes de a análise subir; ele se corrige
sozinho em seguida. Confira de novo antes de concluir que há problema — e,
se precisar ver um alerta que a sessão não consegue ler, rode o CodeQL
localmente (`llms.md`, seção 2).

## PRs do Dependabot

- **Não faça commit seu no branch dele.** O Dependabot para de manter um PR
  que alguém alterou. Para testar a combinação com a `main`, faça o merge
  **localmente** (`git merge origin/main` num checkout destacado), rode
  `npm ci`, lint, typecheck e as duas suítes — e para o `wrangler`, também
  `npx wrangler deploy --dry-run --env=`.
- **Conflito no `package-lock.json`** depois de outro merge: o Dependabot
  rebaseia sozinho em um ou dois minutos (o #176 foi rebaseado assim logo
  depois do #160).
- **Sem conflito, só atrasado em relação à `main`:** o Dependabot não se
  mexe. O dono comenta `@dependabot rebase`; numa sessão de agente, o
  caminho é o *Update branch* (`update_pull_request_branch` — merge commit,
  sem reescrever história), esperar a CI do head novo e mergear em seguida.
  Comentário de sessão **não serve**: o texto sai publicado com as menções
  neutralizadas (`·@·d·ependabot r·ebase`) e o comando nunca chega — foi o
  que aconteceu no #157.
- **Mudou o `.github/dependabot.yml`?** O Dependabot pode fechar um PR aberto
  e abrir outro com o mesmo bump ("Superseded by #N") — o #159 virou o #176
  assim. Siga o número novo.
- Um bump que não instala (peer dependency recusada) se **fecha com o motivo
  escrito** e vira issue de acompanhamento, não fica aberto em vermelho — ver
  o vitest 5 (#156, #158 → #180).

## Proteção da `main`

Não há tool nem API disponível para configurar isso de dentro de uma sessão
(ver `llms.md`, "O que não existe"), então a regra está versionada em
[`.github/rulesets/main-protegida.json`](../.github/rulesets/main-protegida.json)
e se aplica uma vez, à mão: **Settings → Rules → Rulesets → New ruleset →
Import a ruleset**, escolha o arquivo, confira e salve. O que ela impõe:

- a `main` não pode ser apagada nem receber force-push;
- nada entra sem PR — nem do dono;
- o PR só é mergeável com estes checks verdes e atualizado com a `main`:
  `checks`, `Invariantes de segurança`, `Dependências` e
  `Revisão de dependências (PR)`;
- merge só por merge commit;
- quem administra o repositório pode passar por cima **só dentro de um PR**
  (CI fora do ar numa emergência), nunca com push direto.

Ficam de fora dos obrigatórios, de propósito: **Workers Builds**, que reprova
por desenho em PR com migração de Durable Object (`RETOMADA.md` §5.3-b), e
**CodeQL**, configurado fora do repositório — se for desligado, um check
obrigatório que nunca chega trava todo merge. Aprovação obrigatória também
fica de fora: com um mantenedor só, ela travaria tudo.

Os nomes dos checks exigidos precisam existir num workflow que roda em
`pull_request`; `tests/repositorio.test.js` reprova se um job for
renomeado sem atualizar o JSON. Depois de mudar o JSON, reimporte.

Na mesma visita às configurações: **Settings → General → Pull Requests →
Automatically delete head branches**. É isso que impede os branches velhos
de voltarem a se acumular.

## Faxina

Um branch pode ser apagado quando:

- o PR dele foi mergeado **e** o topo do branch é o commit que o PR mergeou
  (nada foi commitado depois); ou
- o PR foi fechado sem merge — os commits continuam em `refs/pull/<N>/head`,
  e o *Restore branch* os devolve.

Branch com commit que não está na `main` nem em PR nenhum **não** se apaga
antes de alguém ler esses commits.

A faxina de 24/09/2026 (72 branches conferidos um a um) está pendente no
#177: a sessão não tem permissão para apagar branch remoto, e o comando pronto
ficou num comentário do #162.
