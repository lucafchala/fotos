import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Duas suítes, de propósito, com contratos diferentes:
//
//   unit    — roda em node, rápido, com dublês. Cobre lógica pura e o
//             roteamento. É a suíte que se roda a cada salvamento.
//   workers — roda dentro do WORKERD de verdade, com Durable Objects,
//             KV e D1 reais (simulados pelo miniflare, mas com o
//             comportamento do runtime, não com um Map nosso).
//
// A segunda existe por causa de um limite honesto da primeira: os Durable
// Objects são testados na `unit` contra uma classe base de mentira e um
// armazenamento em memória. Isso prende a aritmética e o comportamento em
// falha, mas NÃO prende o que a plataforma garante — serialização por objeto,
// isolamento, persistência entre chamadas. Afirmar atomicidade contra um dublê
// que nós mesmos escrevemos seria testar o dublê.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // Só o código do Worker. As páginas em `src/ui/**` são quase inteiramente
      // template string — cobertura ali mede se a função foi CHAMADA, não se a
      // página está certa, e é justamente o engano que o docs/VERIFICACAO.md
      // existe para desfazer. `legal-docs.js` é gerado.
      include: ['src/*.js'],
      exclude: ['src/content/legal-docs.js'],
      reporter: ['text-summary', 'lcov'],
      // Catraca, não meta: os números são o que a suíte JÁ cobre, arredondados
      // para baixo. Servem para impedir queda silenciosa quando alguém
      // acrescentar caminho sem teste — não para perseguir 100%, que em base
      // com muito caminho de degradação só se alcança testando o irrelevante.
      //
      // Suba quando a cobertura real subir. Nunca desça para fazer o gate
      // passar: descer a catraca é a forma educada de desligá-la.
      //
      // Medido só na suíte `unit` — o provedor v8 precisa de
      // `node:inspector`, que não existe no workerd, então `--coverage` com a
      // suíte `workers` junto quebra. Ver o script `test:coverage`.
      thresholds: {
        statements: 73,
        branches: 71,
        functions: 72,
        lines: 77,
      },
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/**/*.test.js'],
          exclude: ['tests/workers/**'],
        },
        resolve: {
          alias: {
            // `src/counters.js` importa a classe base dos Durable Objects de
            // `cloudflare:workers`, um módulo que só o workerd fornece. Sem
            // este alias, qualquer teste que importe `src/index.js` falha no
            // import — e isso é a suíte inteira, não só a dos contadores.
            'cloudflare:workers': fileURLToPath(new URL('./tests/stubs/cloudflare-workers.js', import.meta.url)),
          },
        },
      },
      {
        plugins: [
          // Lê os bindings do wrangler.toml, então a suíte e o deploy não
          // podem divergir: um binding que falte aqui falta lá.
          cloudflareTest({ wrangler: { configPath: './wrangler.toml' } }),
        ],
        test: {
          name: 'workers',
          include: ['tests/workers/**/*.test.js'],
        },
      },
    ],
  },
});
