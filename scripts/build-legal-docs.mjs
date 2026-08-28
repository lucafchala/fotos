// Empacota os markdowns de `docs/legal/` e o `SECURITY.md` em
// `src/content/legal-docs.js` — um Worker não tem sistema de arquivos, então o
// texto precisa estar no bundle.
//
// A CI regenera e compara: editar um documento sem rodar `npm run build:legal`
// derruba o build.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Ordem = ordem de exibição na Central de Transparência.
// `slug` é a URL pública; `file` é a origem; `title`/`summary` alimentam tanto o
// card quanto o <title> e a meta description da página.
const DOCS = [
  {
    slug: 'politica-de-seguranca', file: 'SECURITY.md',
    title: 'Política de Segurança',
    summary: 'Escopo, canal de reporte, prazo de resposta e as limitações conhecidas — declaradas, não escondidas.',
    tag: 'RFC 9116',
  },
  {
    slug: 'registro-de-operacoes', file: 'docs/legal/ROPA.md',
    title: 'Registro das operações',
    summary: 'Cada dado tratado: origem, finalidade, base legal, prazo e destino.',
    tag: 'LGPD · Art. 37',
  },
  {
    slug: 'relatorio-de-impacto', file: 'docs/legal/RIPD.md',
    title: 'Relatório de impacto',
    summary: 'Os riscos do tratamento, com mitigação e risco residual de cada um.',
    tag: 'LGPD · Art. 38',
  },
  {
    slug: 'legitimo-interesse', file: 'docs/legal/LIA.md',
    title: 'Teste de legítimo interesse',
    summary: 'A análise que sustenta a publicação das fotos, em três etapas.',
    tag: 'LGPD · Art. 10',
  },
  {
    slug: 'politica-de-retencao', file: 'docs/legal/politica-de-retencao.md',
    title: 'Política de retenção',
    summary: 'Por quanto tempo cada dado fica, e o que executa o apagamento.',
    tag: 'LGPD · Art. 15, 16',
  },
  {
    slug: 'transferencia-internacional', file: 'docs/legal/transferencia-internacional.md',
    title: 'Transferência internacional',
    summary: 'Onde os dados são processados e com que fundamento.',
    tag: 'LGPD · Art. 33',
  },
  {
    slug: 'direitos-do-titular', file: 'docs/legal/direitos-do-titular.md',
    title: 'Direitos do titular',
    summary: 'Como um pedido é recebido, verificado, atendido e respondido.',
    tag: 'LGPD · Art. 18',
  },
  {
    slug: 'resposta-a-incidentes', file: 'docs/legal/plano-resposta-incidentes.md',
    title: 'Resposta a incidentes',
    summary: 'O procedimento das primeiras horas e o critério de comunicação.',
    tag: 'LGPD · Art. 48',
  },
  {
    slug: 'seguranca-da-informacao', file: 'docs/legal/politica-seguranca-informacao.md',
    title: 'Segurança da informação',
    summary: 'As medidas técnicas, cada uma apontando para o código que a implementa.',
    tag: 'LGPD · Art. 46',
  },
  {
    slug: 'autorizacao-de-imagem', file: 'docs/legal/termo-autorizacao-uso-imagem.md',
    title: 'Autorização de uso de imagem',
    summary: 'Modelos para assinatura: adulto, responsável por menor e instituição contratante.',
    tag: 'LGPD · Art. 14',
  },
];

// Mapa de arquivo → rota, para o renderizador reescrever os links entre
// documentos. Caminho fora do mapa vira texto puro — melhor perder um link do
// que publicar um quebrado.
//
// Os markdowns se referenciam por caminho relativo a partir de lugares
// diferentes, então registramos todas as formas em vez de normalizar em runtime.
const FILE_TO_SLUG = {};
for (const d of DOCS) {
  const base = d.file.split('/').pop();
  FILE_TO_SLUG[d.file] = d.slug;
  FILE_TO_SLUG['./' + base] = d.slug;
  FILE_TO_SLUG['../../' + base] = d.slug;
  FILE_TO_SLUG['./docs/legal/' + base] = d.slug;
  FILE_TO_SLUG[base] = d.slug;
}

const docs = DOCS.map(d => ({
  slug: d.slug,
  title: d.title,
  summary: d.summary,
  tag: d.tag,
  source: d.file,
  markdown: readFileSync(join(ROOT, d.file), 'utf8'),
}));

const out = `// ARQUIVO GERADO — não edite à mão.
//
// Fonte: docs/legal/*.md e SECURITY.md
// Gerar:  npm run build:legal

export const LEGAL_DOCS = ${JSON.stringify(docs, null, 2)};

// Caminho relativo (como aparece dentro dos markdowns) → slug da rota pública.
export const DOC_PATH_TO_SLUG = ${JSON.stringify(FILE_TO_SLUG, null, 2)};

/** @param {string} slug */
export function findDoc(slug) {
  return LEGAL_DOCS.find(d => d.slug === slug) || null;
}
`;

mkdirSync(join(ROOT, 'src/content'), { recursive: true });
writeFileSync(join(ROOT, 'src/content/legal-docs.js'), out);
console.log(`legal-docs.js gerado: ${docs.length} documentos, ${out.length} bytes`);
