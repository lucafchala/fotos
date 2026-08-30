#!/usr/bin/env python3
"""Roda `bash -n` em cada bloco `run:` dos workflows do GitHub Actions.

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
"""
import subprocess
import sys

try:
    import yaml
except ModuleNotFoundError:
    sys.exit('FALHA: PyYAML não está disponível (pip install pyyaml).')

ARQUIVOS = sys.argv[1:] or [
    '.github/workflows/deploy.yml',
    '.github/workflows/checks.yml',
]

falhas = 0
blocos = 0

for arquivo in ARQUIVOS:
    with open(arquivo, encoding='utf-8') as fh:
        doc = yaml.safe_load(fh)

    for nome_job, job in (doc.get('jobs') or {}).items():
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
            r = subprocess.run(['bash', '-n'], input=comando,
                               text=True, capture_output=True)
            if r.returncode == 0:
                print(f'OK    {rotulo}')
            else:
                falhas += 1
                print(f'FALHA {rotulo}\n{r.stderr}')

# Zero blocos quer dizer que o extrator parou de achar o que deveria achar —
# um verificador que não verifica nada passa sempre, e é pior que não existir.
if blocos == 0:
    sys.exit('FALHA: nenhum bloco `run:` encontrado. O parser quebrou?')

print(f'\n{blocos} bloco(s) `run:` conferidos, {falhas} com erro de sintaxe.')
sys.exit(1 if falhas else 0)
