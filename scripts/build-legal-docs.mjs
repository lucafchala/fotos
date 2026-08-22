// Gera `src/content/legal-docs.js` a partir dos markdowns de `docs/legal/` e do
// `SECURITY.md`.
//
// Por que gerar em vez de ler em tempo de execução: um Worker não tem sistema
// de arquivos — tudo o que ele serve precisa estar no bundle. E por que gerar
// em vez de manter o texto duplicado à mão: duplicata diverge. O markdown
// continua sendo a única fonte da verdade; este script só o empacota.
//
// A CI roda `npm run build:legal` e falha se o resultado diferir do que está
// commitado (`.github/workflows/checks.yml`). Assim, editar um documento sem
// regenerar não passa despercebido — que é exatamente o modo de falha de
// qualquer arquivo gerado que fica no repositório.
//
// Uso: npm run build:legal

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

// Mapa de arquivo → rota, para o renderizador reescrever os links relativos
// entre documentos. Qualquer caminho fora deste mapa vira texto puro: melhor
// perder um link do que publicar um que aponta para lugar nenhum (ou para fora
// do site).
const FILE_TO_SLUG = {};
for (const d of DOCS) {
  FILE_TO_SLUG[d.file] = d.slug;
  // Os markdowns se referenciam entre si por caminho relativo — `./ROPA.md`
  // dentro de docs/legal/, `../../SECURITY.md` a partir de lá, e
  // `./docs/legal/X.md` a partir da raiz. Registrar as formas todas evita ter
  // que normalizar caminho em tempo de execução.
  const base = d.file.split('/').pop();
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
//
// Um Worker não tem sistema de arquivos, então o texto dos documentos precisa
// estar no bundle. Manter o markdown como fonte única e empacotá-lo aqui evita
// a duplicata que inevitavelmente divergiria. A CI regenera e compara: editar
// um documento sem rodar o script derruba o build.

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
