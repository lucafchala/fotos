#!/usr/bin/env python3
"""Roda `bash -n` em cada bloco `run:` dos workflows do GitHub Actions — e
recusa as formas conhecidas de um valor de fora virar código nesse shell.

Existe por causa de um defeito concreto. O passo que sobe a versão fazia:

    set -o pipefail
    PREVIEW=$(grep -oE '...' "$SAIDA" | head -1)
    if [ -z "$PREVIEW" ]; then
      echo "::error::Não achei a URL de preview na saída do upload."
      ...

`grep` sem correspondência sai com 1; com `pipefail` a atribuição herda esse 1;
e o runner executa todo bloco `run:` com `bash -e`. Resultado: na única
situação em que aquelas mensagens importavam, o step morria ANTES delas. O log
do primeiro deploy real trouxe só "Process completed with exit code 1".

`bash -n` não pega esse caso — é semântica, não sintaxe. O que ele pega é a
classe vizinha, e o ponto aqui é outro: o shell dos workflows nunca passou por
verificação NENHUMA, enquanto `scripts/*.sh` passa. Um `fi` faltando no
deploy.yml só aparecia depois do merge, em produção. Este script fecha isso.

O YAML é lido com um parser de verdade porque `run:` pode ser bloco literal
(`|`), dobrado (`>`) ou linha única — três formas com regras de recuo
diferentes, e adivinhar qual é com regex reintroduz o problema num outro lugar.

Duas regras de CONTEÚDO, além da sintaxe (#164):

1. Nenhum `${{ inputs.* }}` dentro de `run:`. A expressão é colada no TEXTO do
   script antes de o shell rodar, então o valor vira código: o `version_id` de
   um rollback manual ia cru para um job que carrega o token da Cloudflare e
   `contents: write`. Input entra por `env:` e é lido como "$VARIAVEL".
2. `UUID_RE`, a regra única do ID de versão no deploy.yml, só é usada como
   `${UUID_RE:?}` (vazia, a regex casaria com tudo), só em passo que a
   enxerga, e separa UUID de lixo — inclusive de um valor de DUAS linhas, que
   `grep` aprovaria olhando só a primeira.
"""
import glob
import re
import subprocess
import sys

try:
    import yaml
except ModuleNotFoundError:
    sys.exit('FALHA: PyYAML não está disponível (pip install pyyaml).')

# Todos os workflows, não uma lista: o security.yml ficou anos fora da lista
# antiga sem ninguém notar — arquivo novo entra sozinho.
ARQUIVOS = sys.argv[1:] or sorted(glob.glob('.github/workflows/*.yml'))

# `inputs.x` e `github.event.inputs.x` — o `\b` pega os dois.
RE_INPUT_NO_SHELL = re.compile(r'\$\{\{[^}]*\binputs\.')

UUID_BOM = '0e65efc8-c701-47b1-9b50-21108d826fce'
UUID_RUINS = [
    '',
    UUID_BOM[:-1],                                   # truncado
    UUID_BOM + '"; curl -s x | sh; "',               # colado com comando
    UUID_BOM + '\nversion_id=$(id)',                 # duas linhas
    '$(id)',
]


def casa(regex, valor):
    """O teste exato que o workflow faz: `[[ "$valor" =~ $regex ]]`."""
    r = subprocess.run(['bash', '-c', '[[ "$1" =~ $2 ]]', '_', valor, regex])
    return r.returncode == 0


falhas = 0
blocos = 0


def falha(rotulo, motivo):
    global falhas
    falhas += 1
    print(f'FALHA {rotulo}\n      {motivo}')


for arquivo in ARQUIVOS:
    with open(arquivo, encoding='utf-8') as fh:
        doc = yaml.safe_load(fh)

    env_workflow = doc.get('env') or {}
    for nome_job, job in (doc.get('jobs') or {}).items():
        env_job = {**env_workflow, **(job.get('env') or {})}

        if 'UUID_RE' in (job.get('env') or {}):
            regex = str(job['env']['UUID_RE'])
            rotulo = f'{arquivo} :: {nome_job} :: env.UUID_RE'
            if not casa(regex, UUID_BOM):
                falha(rotulo, f'recusa um UUID válido ({UUID_BOM})')
            for ruim in UUID_RUINS:
                if casa(regex, ruim):
                    falha(rotulo, f'aceita {ruim!r}')

        for i, passo in enumerate(job.get('steps') or []):
            comando = passo.get('run')
            if not comando:
                continue
            # `shell:` diferente de bash tem outra sintaxe; não é nosso caso
            # hoje, e checar como bash daria falso vermelho.
            if passo.get('shell') not in (None, 'bash', 'bash -e {0}'):
                continue
            blocos += 1
            rotulo = f'{arquivo} :: {nome_job} :: {passo.get("name", f"passo #{i}")}'
            antes = falhas

            r = subprocess.run(['bash', '-n'], input=comando,
                               text=True, capture_output=True)
            if r.returncode != 0:
                falha(rotulo, r.stderr.strip())

            if RE_INPUT_NO_SHELL.search(comando):
                falha(rotulo, '`${{ inputs.* }}` dentro de run: — passe por env: e leia "$VARIAVEL" (#164)')

            if 'UUID_RE' in comando:
                if comando.count('UUID_RE') != comando.count('${UUID_RE:?}'):
                    falha(rotulo, 'UUID_RE usado sem `${UUID_RE:?}` — vazia, a regex casaria com tudo')
                if 'UUID_RE' not in {**env_job, **(passo.get('env') or {})}:
                    falha(rotulo, 'usa UUID_RE, mas nenhum env: do passo, do job ou do workflow a define')

            if falhas == antes:
                print(f'OK    {rotulo}')

# Zero blocos quer dizer que o extrator parou de achar o que deveria achar —
# um verificador que não verifica nada passa sempre, e é pior que não existir.
if blocos == 0:
    sys.exit('FALHA: nenhum bloco `run:` encontrado. O parser quebrou?')

print(f'\n{blocos} bloco(s) `run:` conferidos, {falhas} problema(s).')
sys.exit(1 if falhas else 0)
