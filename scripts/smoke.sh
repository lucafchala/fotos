#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Smoke test de um Worker JÁ PUBLICADO (ou do `wrangler dev` local).
# ---------------------------------------------------------------------------
# Uso:
#   scripts/smoke.sh <BASE_URL> [--expect-configured] [--summary ARQUIVO.md]
#
#   scripts/smoke.sh http://127.0.0.1:8787                  # antes de commitar
#   scripts/smoke.sh https://<preview>.workers.dev --expect-configured
#
# Por que é um ARQUIVO e não YAML embutido, que é o que era:
#
#   1. Dentro do workflow, o único jeito de rodar era publicar. A verificação
#      que existe para dizer "isto está bom" só podia ser executada DEPOIS de
#      já estar valendo — agora roda contra o `wrangler dev` antes do push.
#   2. Um passo de CI que ninguém consegue rodar localmente é um passo que
#      ninguém depura; conserta-se por tentativa e erro, um push por vez.
#   3. A mesma suíte passa a valer para os três alvos (local, preview e
#      produção), então "passou no preview" e "passou em produção" querem
#      dizer exatamente a mesma coisa.
#
# NÃO usa `set -e`: cada checagem roda e o relatório sai inteiro no fim.
# `set -e` fazia a PRIMEIRA falha esconder todas as seguintes — e o TODO.md
# registra que foi assim que um check ficou estruturalmente incapaz de passar
# por três deploys sem ninguém ver, porque outro sempre falhava antes dele.
# Aqui a saída diz TUDO que está quebrado, de uma vez.
set -uo pipefail

BASE="${1:-}"
if [ -z "$BASE" ]; then
  echo "uso: $0 <BASE_URL> [--expect-configured] [--summary ARQUIVO]" >&2
  exit 2
fi
shift

# --expect-configured: liga as checagens que dependem de SEGREDO configurado
# (Turnstile, Resend, ADMIN_EMAIL, SIGNING_SECRET). Ficam de fora por padrão
# porque o `wrangler dev` local não tem secret nenhum: ali `/dashboard` responde
# 503 ("painel não configurado") e o autoteste lista as ausências. Isso é
# comportamento CORRETO, não falha — e um smoke que reprovasse por causa disso
# seria um smoke que ninguém roda local.
EXPECT_CONFIGURED=0
SUMMARY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --expect-configured) EXPECT_CONFIGURED=1; shift ;;
    --summary) SUMMARY="${2:-}"; shift 2 ;;
    *) echo "opção desconhecida: $1" >&2; exit 2 ;;
  esac
done

BASE="${BASE%/}"
PASS=0
FAIL=0
FAILURES=()
ROWS=()

registra() { # nome, estado, detalhe
  ROWS+=("$1|$2|$3")
  if [ "$2" = "OK" ]; then
    PASS=$((PASS + 1)); printf '  \033[32mOK  \033[0m %-34s %s\n' "$1" "$3"
  else
    FAIL=$((FAIL + 1)); FAILURES+=("$1: $3")
    printf '  \033[31mFALHA\033[0m %-33s %s\n' "$1" "$3"
  fi
}

# `|| true` em todo curl: uma URL fora do ar tem de virar FALHA relatada, não
# uma saída abrupta do script no meio da lista.
http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@" || true; }

checa_status() { # rótulo, caminho, esperado, [curl extra...]
  local rotulo="$1" caminho="$2" esperado="$3"; shift 3
  local obtido; obtido=$(http_code "$@" "$BASE$caminho")
  if [ "$obtido" = "$esperado" ]; then registra "$rotulo" OK "$obtido"
  else registra "$rotulo" FALHA "esperado $esperado, veio $obtido"; fi
}

echo "Smoke: $BASE"
[ "$EXPECT_CONFIGURED" = 1 ] && echo "(modo ambiente configurado: exige secrets presentes)"
echo

# --- páginas públicas -------------------------------------------------------
# Cada página é um template literal próprio, sem caminho de render comum: uma
# quebrada não derruba as outras, então cada uma precisa da própria checagem.
echo "Páginas"
checa_status gallery     /                    200
checa_status manifest    /manifest.json       200
checa_status icon        /icon.svg            200
checa_status sobre       /sobre               200
checa_status equipamentos /equipamentos       200
checa_status termos      /termos              200
checa_status privacidade /privacidade         200
checa_status suporte     /suporte             200
checa_status legal       /legal               200
checa_status compliance  /compliance          200
checa_status 404         /__nao_existe__      404

echo
echo "Descoberta (SEO / máquina)"
checa_status sitemap      /sitemap.xml                200
checa_status robots       /robots.txt                 200
checa_status llms         /llms.txt                   200
checa_status security.txt /.well-known/security.txt   200
checa_status gpc.json     /.well-known/gpc.json       200

# Um sitemap malformado é DESCARTADO INTEIRO pelo Google, e responde 200 do
# mesmo jeito — o status sozinho não diz nada sobre ele estar válido.
XML=$(curl -s --max-time 20 "$BASE/sitemap.xml" || true)
if printf '%s' "$XML" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    if(!/^<\?xml/.test(s.trim())) process.exit(1);
    if(!/<\/urlset>\s*$/.test(s.trim())) process.exit(1);
    const semEntidade=s.replace(/&(amp|lt|gt|quot|#x27);/g,"");
    process.exit(semEntidade.includes("&") ? 1 : 0);
  });' 2>/dev/null; then
  registra "sitemap é XML válido" OK "$(printf '%s' "$XML" | grep -c '<url>') urls"
else
  registra "sitemap é XML válido" FALHA "malformado ou com & solto"
fi

# --- healthz ----------------------------------------------------------------
echo
echo "Saúde"
HEALTH=$(curl -s --max-time 25 "$BASE/api/healthz" || true)
leia_health() { printf '%s' "$HEALTH" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    try{const j=JSON.parse(s);const v=process.argv[1].split(".").reduce((o,k)=>o==null?o:o[k],j);
      console.log(v===undefined||v===null?"":typeof v==="object"?JSON.stringify(v):String(v));}
    catch{process.exit(1)}});' "$1" 2>/dev/null || echo ""; }

if [ -z "$HEALTH" ]; then
  registra "healthz responde" FALHA "resposta vazia"
else
  registra "healthz responde" OK "$(printf '%s' "$HEALTH" | wc -c) bytes"
  [ "$(leia_health ok)" = "true" ] \
    && registra "healthz ok:true" OK "kv=$(leia_health kv) d1=$(leia_health d1)" \
    || registra "healthz ok:true" FALHA "ok=$(leia_health ok) kv=$(leia_health kv)"
  # A latência é publicada para o painel de status; aqui só confirma que o
  # campo existe — um número ausente indica leitura que nem chegou a acontecer.
  KVL=$(leia_health kvLatencyMs)
  [ -n "$KVL" ] && registra "healthz mede o KV" OK "${KVL}ms" \
                || registra "healthz mede o KV" FALHA "kvLatencyMs ausente"
fi

# O PBKDF2 do login é o canário de CPU: estourar o orçamento MATA a requisição,
# e aí isto volta 5xx em vez de 302. É o portão de CPU de verdade — o `hashMs`
# que existia aqui era zero por construção (o Workers congela Date.now()).
checa_status "login não estoura CPU" /dashboard/login 302 \
  -X POST -H 'Content-Type: application/x-www-form-urlencoded' -d 'password=smoke-check-errada'

if [ "$EXPECT_CONFIGURED" = 1 ]; then
  checa_status "dashboard configurado" /dashboard 200
  PROBLEMS=$(leia_health selftest.problems)
  if [ "$PROBLEMS" = "[]" ]; then
    registra "autoteste sem problemas" OK "drive $(leia_health selftest.drive.ok)/$(leia_health selftest.drive.live)"
  else
    # Dado/config, não regressão de código: relata sem reprovar o deploy.
    registra "autoteste sem problemas" AVISO "$PROBLEMS"
    FAIL=$((FAIL - 1)); PASS=$((PASS + 1))   # AVISO não conta como falha
  fi
  for c in turnstile resend adminEmail signing consentDb; do
    [ "$(leia_health config.$c)" = "true" ] \
      && registra "secret $c" OK "presente" \
      || registra "secret $c" FALHA "ausente"
  done
fi

# --- cabeçalhos de segurança ------------------------------------------------
# Um cabeçalho que some não quebra tela nenhuma: o site segue 200 e ninguém
# percebe até um incidente. Por isso são verificados na resposta REAL.
echo
echo "Cabeçalhos de segurança"
# HEAD antes de tudo: HEAD nem sempre percorre o mesmo caminho que GET, e quando
# não percorre esta seção inteira passa a inspecionar cabeçalho de página de
# ERRO — foi o que já aconteceu aqui, e o relatório culpou a CSP.
HS=$(http_code -I "$BASE/")
[ "$HS" = "200" ] && registra "HEAD / == GET /" OK "200" \
                  || registra "HEAD / == GET /" FALHA "HEAD deu $HS (RFC 9110 §9.3.2)"

HDRS=$(curl -sI --max-time 20 "$BASE/" || true)
# Sem cabeçalho nenhum (alvo fora do ar) toda checagem de AUSÊNCIA passaria de
# graça — foi o que aconteceu na primeira execução deste script contra um
# servidor morto: "enforced SEM nonce" deu OK porque não havia cabeçalho algum
# para conter um nonce. Silêncio não é aprovação; sem resposta é falha.
if [ -z "$HDRS" ]; then
  registra "resposta com cabeçalhos" FALHA "nenhum cabeçalho — alvo fora do ar?"
else
  registra "resposta com cabeçalhos" OK "$(printf '%s' "$HDRS" | wc -l) linhas"
fi
exige_header() { # rótulo, regex
  if [ -z "$HDRS" ]; then registra "$1" FALHA "sem resposta"; return; fi
  printf '%s' "$HDRS" | grep -iqE "$2" \
    && registra "$1" OK "presente" \
    || registra "$1" FALHA "ausente ou inesperado"
}
exige_header "X-Content-Type-Options"    '^x-content-type-options: *nosniff'
exige_header "X-Frame-Options"           '^x-frame-options: *DENY'
exige_header "Strict-Transport-Security" '^strict-transport-security: *max-age=[0-9]+'
exige_header "CSP frame-ancestors"       "^content-security-policy:.*frame-ancestors 'none'"
exige_header "CSP report-only (estrita)" '^content-security-policy-report-only:'
exige_header "CSP-RO carrega nonce"      "^content-security-policy-report-only:.*'nonce-"
exige_header "Permissions-Policy"        '^permissions-policy:.*camera=\(\)'
exige_header "COOP"                      '^cross-origin-opener-policy: *same-origin'
exige_header "Origin-Agent-Cluster"      '^origin-agent-cluster:'

# A ENFORCED não pode ter nonce enquanto houver handler inline: pela CSP Level 3
# o nonce descarta o 'unsafe-inline' e a interface inteira para de responder.
# Já aconteceu; este check existe por isso.
ENFORCED=$(printf '%s' "$HDRS" | grep -i '^content-security-policy:' || true)
if [ -z "$ENFORCED" ]; then
  # Não é "passou": é que não houve política nenhuma para inspecionar.
  registra "enforced SEM nonce" FALHA "sem CSP enforced na resposta"
elif printf '%s' "$ENFORCED" | grep -q 'nonce-'; then
  registra "enforced SEM nonce" FALHA "nonce na enforced desativa o unsafe-inline e mata os handlers"
else
  registra "enforced SEM nonce" OK "handlers inline preservados"
fi

# --- nonce ------------------------------------------------------------------
echo
echo "Nonce"
# Cabeçalho e corpo têm de vir da MESMA resposta: o nonce muda a cada
# requisição, então comparar duas nunca poderia passar. `-D -` com `-o` resolve.
BODY=$(mktemp)
H1=$(curl -s -D - -o "$BODY" --max-time 20 "$BASE/" || true)
extrai_nonce() { grep -i '^content-security-policy-report-only:' | grep -io "'nonce-[A-Za-z0-9_+/=-]*'" | head -1 | tr -d "'" | sed 's/nonce-//'; }
N1=$(printf '%s' "$H1" | extrai_nonce)
if [ -z "$N1" ]; then
  registra "nonce no cabeçalho" FALHA "não encontrado"
else
  registra "nonce no cabeçalho" OK "${N1:0:8}…"
  grep -q "nonce=\"$N1\"" "$BODY" \
    && registra "nonce bate com a marcação" OK "mesma resposta" \
    || registra "nonce bate com a marcação" FALHA "o nonce do cabeçalho não está no HTML"
fi
N2=$(curl -s -D - -o /dev/null --max-time 20 "$BASE/" | extrai_nonce || true)
if [ -n "$N2" ] && [ "$N1" != "$N2" ]; then
  registra "nonce muda por requisição" OK "diferente"
else
  # Um nonce constante casa com a checagem acima e não protege nada: basta ler
  # o valor uma vez e reusar para sempre.
  registra "nonce muda por requisição" FALHA "repetiu entre duas requisições"
fi
rm -f "$BODY"

# --- privacidade e CSRF -----------------------------------------------------
echo
echo "Privacidade e CSRF"
curl -sI --max-time 20 "$BASE/api/healthz" | grep -iqE '^cache-control:.*no-store' \
  && registra "API com no-store" OK "não cacheável" \
  || registra "API com no-store" FALHA "resposta de dados sem no-store"

# A checagem mais importante da lista: falha ABERTO se o portão for removido
# num refactor, e o portão é o que protege toda rota de escrita de uma vez.
checa_status "CSRF cross-site barrado" /api/events 403 \
  -X POST -H 'Content-Type: application/json' -H 'Sec-Fetch-Site: cross-site' -d '{}'
checa_status "CSRF same-origin passa"  /api/events 401 \
  -X POST -H 'Content-Type: application/json' -H 'Sec-Fetch-Site: same-origin' -d '{}'

# --- relatório --------------------------------------------------------------
echo
echo "──────────────────────────────────────────────"
printf 'Resultado: %d ok, %d falha(s)\n' "$PASS" "$FAIL"

if [ -n "$SUMMARY" ]; then
  {
    echo "| Checagem | Estado | Detalhe |"
    echo "| --- | --- | --- |"
    for r in "${ROWS[@]}"; do
      IFS='|' read -r n e d <<< "$r"
      icone="✅"; [ "$e" = "FALHA" ] && icone="❌"; [ "$e" = "AVISO" ] && icone="⚠️"
      echo "| $n | $icone $e | ${d//|/\\|} |"
    done
  } >> "$SUMMARY"
fi

if [ "$FAIL" -gt 0 ]; then
  echo
  echo "Falhas:"
  for f in "${FAILURES[@]}"; do echo "  · $f"; done
  exit 1
fi
echo "Tudo passou."
