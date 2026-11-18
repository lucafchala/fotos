// O repositório é público. Foto, vídeo e CPF não entram nele.
//
// Em nov/2026, capturas de tela com fotos reais de alunos (rostos, menores)
// foram parar em branches públicos (`unslop-4.1-capturas`). Captura de tela vai
// no comentário do PR ou fica fora do repositório. O GitHub só bloqueia tipo de
// arquivo no push em repositório de organização; aqui, este teste segura a main
// (ele é obrigatório pelo check `checks`).
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const arquivos = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);

const MIDIA = /\.(jpe?g|png|webp|gif|heic|heif|avif|tiff?|bmp|raw|dng|cr2|nef|arw|mp4|mov|m4v|webm|avi|3gp)$/i;

/** CPF com dígitos verificadores válidos. @param {string} d 11 dígitos */
function cpfValido(d) {
  if (/^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(d[n])) return false;
  }
  return true;
}

// Exemplos de documentação conhecidos (não são de ninguém), usados nos testes do Pix.
const CPF_DE_EXEMPLO = new Set(['12345678909']);

describe('sem dados pessoais no repositório', () => {
  it('nenhuma foto ou vídeo versionado', () => {
    expect(arquivos.filter((f) => MIDIA.test(f))).toEqual([]);
  });

  it('nenhum CPF válido em texto (formatado 000.000.000-00)', () => {
    const achados = [];
    for (const f of arquivos) {
      if (/\.(woff2|ico)$/i.test(f) || f.startsWith('vendor/')) continue;
      let t;
      try { t = readFileSync(f, 'utf8'); } catch { continue; }
      for (const m of t.matchAll(/\b(\d{3})\.(\d{3})\.(\d{3})-(\d{2})\b/g)) {
        const d = m.slice(1).join('');
        if (cpfValido(d) && !CPF_DE_EXEMPLO.has(d)) achados.push(`${f}: ${m[0].slice(0, 3)}…`);
      }
    }
    expect(achados).toEqual([]);
  });

  it('o verificador de CPF reconhece um válido e recusa um inválido', () => {
    expect(cpfValido('12345678909')).toBe(true);
    expect(cpfValido('12345678900')).toBe(false);
    expect(cpfValido('11111111111')).toBe(false);
  });
});
