// Os textos legais não podem prometer um Turnstile invisível (#165).
//
// O modo do widget (Managed, Non-interactive, Invisible) mora no painel da
// Cloudflare, fora do repositório, e o /suporte renderiza o widget à vista.
// A política de privacidade chegou a dizer "modo invisível, sem exibir
// desafio" — promessa a um titular que ninguém no código garante. Os textos
// dizem o que vale em qualquer modo ("pode pedir uma confirmação"); este teste
// impede a promessa de voltar por uma edição distraída.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { privacyHTML } from '../src/ui/privacy.js';
import { LEGAL_DOCS } from '../src/content/legal-docs.js';

const PROMESSA = /modo invis[ií]vel|sem exibir desafio|n[ãa]o exibe desafio/i;

describe('Turnstile nos textos legais', () => {
  it('/privacidade não promete invisibilidade e diz que pode haver confirmação', () => {
    const html = privacyHTML();
    expect(html).not.toMatch(PROMESSA);
    expect(html).toMatch(/pode pedir uma confirma[çc][ãa]o/);
  });

  it.each(LEGAL_DOCS.map(d => [d.slug, d]))('documento %s não promete invisibilidade', (_s, d) => {
    expect(JSON.stringify(d)).not.toMatch(PROMESSA);
  });

  it('LEGAL.md não promete invisibilidade', () => {
    expect(readFileSync(new URL('../LEGAL.md', import.meta.url), 'utf8')).not.toMatch(PROMESSA);
  });
});
