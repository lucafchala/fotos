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

**Um IP só basta para o cenário acima:** o limite de download por IP
(`GALERIA_BAIXAR_BUCKET`) é de 6.000 fichas, e o cenário usa 6.000 (3 downloads
e 3 sondas por pessoa). Mais que isso, rode o k6 de mais de uma máquina, ou
espere 429 — e conte-os à parte.

## O script (k6)

[k6](https://k6.io/) instalado na máquina do dono. Salve como
`ensaio.js` fora do repositório (ele não faz parte do site) e rode
`k6 run -e BASE=https://<a-previa> -e SLUG=<slug-do-album> ensaio.js`.

```js
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE;
const SLUG = __ENV.SLUG;

export const options = {
  scenarios: {
    lancamento: { executor: 'ramping-arrivals', startRate: 0, timeUnit: '1s', preAllocatedVUs: 300, maxVUs: 1200,
      stages: [{ target: 17, duration: '60s' }, { target: 0, duration: '10s' }] },
  },
  thresholds: {
    'http_req_failed{tipo:pagina}': ['rate==0'],
    'http_req_duration{tipo:pagina}': ['p(95)<1500'],
    'http_req_duration{tipo:miniatura}': ['p(95)<1000'],
    checks: ['rate>0.98'],
  },
};

export default function () {
  // 1. O álbum: os endereços dos eventos saem do próprio HTML.
  const album = http.get(`${BASE}/galeria/${SLUG}`, { tags: { tipo: 'pagina' } });
  check(album, { 'álbum 200': r => r.status === 200 });
  const eventos = [...album.body.matchAll(new RegExp(`href="/galeria/${SLUG}/([a-z0-9-]+)"`, 'g'))].map(m => m[1]);
  if (!eventos.length) return;
  const cap = eventos[Math.floor(Math.random() * eventos.length)];
  sleep(1);

  // 2. O evento e as miniaturas. O HTML traz, já assinados, os endereços das
  // primeiras fotos (em várias larguras); o resto a página monta no navegador.
  // Aqui: uma largura (400) por foto, até 30, cada uma com a assinatura dela.
  const ev = http.get(`${BASE}/galeria/${SLUG}/${cap}`, { tags: { tipo: 'pagina' } });
  check(ev, { 'evento 200': r => r.status === 200 });
  const assinadas = new Map([...ev.body.matchAll(/\/f\/([A-Za-z0-9_-]{10,})\/\d+j?\?k=([\w.-]+)/g)].map(m => [m[1], m[2]]));
  const minis = [...assinadas].slice(0, 30).map(([id, k]) => `/f/${id}/400?k=${k}`);
  http.batch(minis.map(u => ['GET', `${BASE}${u}`, null, { tags: { tipo: 'miniatura' } }]));
  sleep(2);

  // 3. Três downloads, cada um com a sonda antes, como a página faz.
  const ids = [...assinadas.keys()];
  for (let i = 0; i < 3 && ids.length; i++) {
    const id = ids[Math.floor(Math.random() * ids.length)];
    const base = `${BASE}/galeria/${SLUG}/${cap}/baixar/${id}?v=max`;
    const sonda = http.get(`${base}&p=1&c=0`, { tags: { tipo: 'sonda' } });
    check(sonda, { 'sonda 204/429/503': r => [204, 429, 503].includes(r.status) });
    if (sonda.status !== 204) continue;
    const baixa = http.get(base, { tags: { tipo: 'download' }, responseType: 'none' });
    check(baixa, { 'download 200/429/503': r => [200, 429, 503].includes(r.status) });
    sleep(1);
  }
}
```

**Conferido só como texto.** As expressões que tiram os endereços do HTML
seguem o formato de hoje (`urlFoto` em `src/foto-rota.js`, as rotas de
`src/index.js`); se o HTML mudar, ajuste-as antes. O script nunca rodou.

## Depois

Anote no PR de lançamento (ou numa Issue): os números da tabela acima, o
horário e a versão (`versaoSite` do healthz). Se algum critério falhar, o
lugar de olhar primeiro é o log do Worker (`wrangler tail`) e o
`/api/healthz` (as degradações agora aparecem mesmo vindas de outro isolate,
v3.11.0).
