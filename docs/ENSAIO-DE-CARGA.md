# Ensaio de carga do lançamento (plano)

Item A4 do plano de antes do lançamento. **Só o dono roda**: o ensaio gasta
cota de verdade (requisições do Worker, leituras de KV, chamadas ao Google) e
precisa de um álbum de teste publicado. Nenhuma sessão de agente rodou isto —
a rede das sessões nem alcança o site (`llms.md`, "Rede das sessões na nuvem").

## O que se quer saber

Se o site aguenta a primeira hora do lançamento: muita gente abrindo o álbum
ao mesmo tempo, rolando as miniaturas e baixando algumas fotos.

**Cenário:** 1.000 pessoas em 60 s. Cada uma abre a página do álbum, abre um
evento, carrega 30 miniaturas e baixa 3 fotos no tamanho máximo (com a sonda
`?p=1` antes de cada uma, como a página faz).

**Critério para lançar:**

| Medida | Passa se |
| --- | --- |
| Respostas 5xx | **nenhuma** (429 do limite por IP não conta: é o freio funcionando) |
| p95 da página do álbum e do evento | abaixo de **1,5 s** |
| p95 das miniaturas (`/f/…`) | abaixo de 1 s |
| Downloads que viram "ocupado" (503 com `Retry-After`) | menos de 2 % (é o Google recusando; a página tenta de novo) |
| CPU do Worker por pedido (painel da Cloudflare → Workers → Métricas) | sem "Exceeded CPU" |
| Leituras de KV no dia (painel → KV) | longe dos 100 mil (o healthz e a galeria dividem a cota) |
| `/api/healthz` depois do ensaio | `ok: true` e `selftest.problems` sem nada novo |

## Onde rodar

**Contra uma prévia de PR ou um Worker de teste, nunca contra produção no
dia.** A prévia tem armazenamento próprio (docs/REFERENCIA.md, "Prévia de
PR"); o álbum de teste precisa de uma pasta do Drive com umas 500 fotos e
capítulos, como o de verdade, e da `PREVIA_GOOGLE_DRIVE_API_KEY`.

Antes, deixe o indexador aquecer o R2 do álbum de teste (docs/ALBUM.md,
"Aquecimento para o lançamento"): é assim que o lançamento de verdade vai
estar, e sem isso o ensaio mede o Google, não o site.

**Um IP só fica no limite:** o limite de download por IP
(`GALERIA_BAIXAR_BUCKET`) é de 6.000 fichas, e cada pessoa gasta 6 (3 sondas,
que gastam ficha antes de olhar o R2, e 3 downloads). As 1.020 pessoas do
script pedem ~6.100: as últimas levam 429, que é o freio funcionando — conte-os
à parte, não como falha. Para ver o site sem o freio, rode o k6 de duas
máquinas, cada uma com metade da taxa.

## O script (k6)

[k6](https://k6.io/) instalado na máquina do dono. Salve como
`ensaio.js` fora do repositório (ele não faz parte do site) e rode
`k6 run -e BASE=https://<a-previa> -e SLUG=<slug-do-album> ensaio.js`.

```js
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE;
const SLUG = __ENV.SLUG;

// --- extração (o teste tests/ensaio-de-carga.test.js roda estas funções contra o HTML do código) ---
/** Os eventos do álbum: só os cartões de evento (data-cap), não /numeros nem /ajuda. */
function eventosDoAlbum(html) {
  return [...new Set([...html.matchAll(/ data-cap="([a-z0-9-]+)"/g)].map(m => m[1]))];
}
/**
 * As fotos do evento, como a página monta: o JSON `g-dados` traz os ids e as
 * assinaturas juntas (`as`, 8 caracteres por foto, na ordem). Só o preload tem
 * endereço pronto no HTML; ler endereços /f/ do texto acharia uma foto só.
 */
function fotosDoEvento(html) {
  const m = html.match(/<script type="application\/json" id="g-dados"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  const d = JSON.parse(m[1]);
  const fotos = [];
  for (const s of d.secoes || []) {
    const n = s.fotos.length ? (s.as || '').length / s.fotos.length : 0;
    s.fotos.forEach((f, i) => {
      const a = n >= 1 && n === Math.floor(n) ? s.as.slice(i * n, i * n + n).trim() : '';
      fotos.push({ id: f[0], k: d.slug + (a ? '.' + a : '') });
    });
  }
  return fotos;
}
// --- fim da extração ---

export const options = {
  scenarios: {
    // 17 chegadas por segundo durante 60 s = 1.020 pessoas.
    lancamento: { executor: 'constant-arrival-rate', rate: 17, timeUnit: '1s', duration: '60s', preAllocatedVUs: 300, maxVUs: 1200 },
  },
  thresholds: {
    'http_req_failed{tipo:pagina}': ['rate==0'],
    'http_req_duration{tipo:pagina}': ['p(95)<1500'],
    'http_req_duration{tipo:miniatura}': ['p(95)<1000'],
    checks: ['rate>0.98'],
  },
};

export default function () {
  // 1. O álbum: os eventos saem dos cartões da própria página.
  const album = http.get(`${BASE}/galeria/${SLUG}`, { tags: { tipo: 'pagina' } });
  check(album, { 'álbum 200': r => r.status === 200 });
  const eventos = eventosDoAlbum(album.body || '');
  if (!eventos.length) return;
  const cap = eventos[Math.floor(Math.random() * eventos.length)];
  sleep(1);

  // 2. O evento e 30 miniaturas (largura 400 da grade, WebP), cada uma com a
  // assinatura dela, a partir de um ponto ao acaso da lista.
  const ev = http.get(`${BASE}/galeria/${SLUG}/${cap}`, { tags: { tipo: 'pagina' } });
  check(ev, { 'evento 200': r => r.status === 200 });
  const fotos = fotosDoEvento(ev.body || '');
  if (!fotos.length) return;
  const ini = Math.floor(Math.random() * Math.max(1, fotos.length - 30));
  const vistas = fotos.slice(ini, ini + 30);
  http.batch(vistas.map(f => ['GET', `${BASE}/f/${f.id}/400?k=${f.k}`, null, { tags: { tipo: 'miniatura' } }]));
  sleep(2);

  // 3. Três downloads de fotos diferentes, cada um com a sonda antes, como a página faz.
  for (let i = 0; i < 3; i++) {
    const f = fotos[Math.floor(Math.random() * fotos.length)];
    const base = `${BASE}/galeria/${SLUG}/${cap}/baixar/${f.id}?v=max`;
    const sonda = http.get(`${base}&p=1&c=0`, { tags: { tipo: 'sonda' } });
    check(sonda, { 'sonda 204/429/503': r => [204, 429, 503].includes(r.status) });
    if (sonda.status !== 204) continue;
    const baixa = http.get(base, { tags: { tipo: 'download' }, responseType: 'none' });
    check(baixa, { 'download 200/429/503': r => [200, 429, 503].includes(r.status) });
    sleep(1);
  }
}
```

**O que foi conferido, e o que não.** As duas funções de extração rodam no
`npm test` (`tests/ensaio-de-carga.test.js`) contra o HTML que o código gera
hoje: se a página mudar, o teste reprova antes do ensaio. O teste também
confere o nome do executor e que a taxa vezes a duração dá pelo menos 1.000.
O script inteiro nunca rodou no k6 (a sessão não tem o k6 nem alcança a
prévia).

A primeira versão deste plano (v3.11.0, antes da revisão) tinha três erros,
corrigidos aqui: o executor `ramping-arrivals` não existe no k6; a rampa de
0 a 17/s dava ~600 pessoas, não 1.000; e a leitura dos endereços `/f/` do
texto achava só a foto do preload, então as "30 miniaturas" viravam uma e os
downloads caíam todos no mesmo arquivo.

## Depois

Anote no PR de lançamento (ou numa Issue): os números da tabela acima, o
horário e a versão (`versaoSite` do healthz). Se algum critério falhar, o
lugar de olhar primeiro é o log do Worker (`wrangler tail`) e o
`/api/healthz` (as degradações agora aparecem mesmo vindas de outro isolate,
v3.11.0).
