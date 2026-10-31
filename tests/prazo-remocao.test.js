// O prazo que o site promete para uma foto oculta sair do ar. Ocultar grava no
// KV e a mudança leva até 2 minutos para chegar a todo o site (cache do isolate
// 30 s + cacheTtl do KV 30 s + propagação do KV), o mesmo prazo do aviso do
// painel. Prometer "na hora" nos textos legais seria prometer o que a
// infraestrutura não entrega. TERMS_VERSION não muda por causa disto: o prazo é
// um esclarecimento, não um novo termo.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { termsHTML } from '../src/ui/terms.js';
import { privacyHTML } from '../src/ui/privacy.js';

const texto = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const arquivo = nome => readFileSync(new URL(`../${nome}`, import.meta.url), 'utf8');

describe('prazo de saída de uma foto oculta: "em até 2 minutos", nunca "na hora"', () => {
  it('Termos e Privacidade dizem 2 minutos para sair da galeria e do mapa do site', () => {
    for (const [nome, html] of [['termos', termsHTML()], ['privacidade', privacyHTML()]]) {
      const t = texto(html);
      expect(t, nome).toMatch(/sai da galeria e do mapa do site em até 2 minutos/);
      expect(t, nome).not.toMatch(/mapa do site na hora/);
      expect(t, nome).not.toMatch(/sitemap na hora/);
    }
  });

  it('CHANGELOG e RETOMADA não prometem "na hora" para a foto oculta sair do HTML e do sitemap', () => {
    expect(arquivo('CHANGELOG.md')).not.toMatch(/sitemap\s+na hora/);
    expect(arquivo('CHANGELOG.md')).toMatch(/sitemap\s+em até 2 minutos/);
    expect(arquivo('RETOMADA.md')).toMatch(/em até 2 min[^\n]*não "na hora"/);
  });
});
