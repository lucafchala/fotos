// 4.1.6: a Política de Privacidade conta o que a "busca nas fotos" faz com
// cada foto pública (Amazon Rekognition: texto, coisas, moderação), e chama os
// botões pelo nome que eles têm na tela.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { privacyHTML } from '../src/ui/privacy.js';

const h = privacyHTML();
const fonte = (/** @type {string} */ f) => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), 'utf8');

describe('Política: busca nas fotos', () => {
  it('tem a seção 3.3, com o que é lido, o que fica guardado, a moderação, o prazo e a base legal', () => {
    const sec = (h.match(/<h2 id="busca-fotos">[\s\S]*?<h2>/) || [''])[0];
    expect(sec).toContain('3.3. Busca nas fotos e moderação');
    expect(sec).toContain('Amazon Rekognition');
    expect(sec).toContain('Não envolve rosto');
    expect(sec).toContain('O que você digita na busca não é guardado.');
    expect(sec).toContain('O site não esconde nem apaga nada sozinho.');
    expect(sec).toContain('enquanto a foto estiver no álbum');
    expect(sec).toContain('legítimo interesse (art. 7º, IX, da LGPD)');
  });

  it('a lista de operadores diz para que a Amazon é usada nas duas buscas', () => {
    expect(h).toMatch(/Amazon Rekognition\)<\/strong> — [^<]*busca pelo rosto[^<]*seção 3\.1[^<]*busca nas fotos[^<]*seção 3\.3/);
  });

  it('os nomes dos botões são os da tela', () => {
    expect(h).not.toContain('Procurar meu rosto');
    expect(h).toContain('“Achar minhas fotos pelo rosto”');
    expect(fonte('album.js')).toContain('Achar minhas fotos pelo rosto</button>');
    expect(h).toContain('“Procurar nas fotos”');
    expect(fonte('ajuda.js')).toContain('<b>Procurar nas fotos</b>');
  });
});
