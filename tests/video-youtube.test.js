// Vídeo do YouTube no lugar das fotos de capa de um projeto. O que importa
// provar: (1) só um ID válido é gravado — nada do link colado chega a um
// src/href; (2) a página não carrega o player antes do clique; (3) a CSP e a
// Permissions-Policy liberam exatamente os dois hosts que o recurso usa.
import { describe, it, expect } from 'vitest';
import { youtubeIdFrom } from '../src/utils.js';
import { normalizeEventFields, mergeRestore } from '../src/index.js';
import { DEFAULT_EVENT } from '../src/config.js';
import { eventHTML } from '../src/ui/event.js';
import { galleryHTML } from '../src/ui/gallery.js';
import { contentSecurityPolicy, htmlSecurityHeaders } from '../src/security.js';

const ID = 'dQw4w9WgXcQ';

describe('youtubeIdFrom', () => {
  it.each([
    [ID],
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://www.youtube.com/watch?feature=share&v=${ID}&t=10s`],
    [`https://m.youtube.com/watch?v=${ID}`],
    [`https://youtu.be/${ID}?si=abc`],
    [`youtu.be/${ID}`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/embed/${ID}`],
    [`https://www.youtube-nocookie.com/embed/${ID}`],
    [`https://www.youtube.com/live/${ID}`],
    [`  https://youtu.be/${ID}  `],
  ])('extrai o ID de %s', entrada => {
    expect(youtubeIdFrom(entrada)).toBe(ID);
  });

  it.each([
    [''],
    ['https://vimeo.com/123456'],
    [`https://evil.example/watch?v=${ID}`],
    [`https://youtube.com.evil.example/watch?v=${ID}`],
    [`javascript:alert(1)//youtu.be/${ID}`],
    ['https://www.youtube.com/watch?v=curto'],
    [`https://www.youtube.com/watch?v=${ID}"onerror="x`],
    ['https://www.youtube.com/'],
    [null],
    [{ v: ID }],
  ])('recusa %s', entrada => {
    expect(youtubeIdFrom(entrada)).toBe('');
  });
});

describe('youtubeId no projeto', () => {
  it('o painel manda o link e fica gravado só o ID', () => {
    expect(normalizeEventFields({ youtubeId: `https://youtu.be/${ID}` }, DEFAULT_EVENT, []).youtubeId).toBe(ID);
    expect(normalizeEventFields({ youtubeId: 'https://vimeo.com/1' }, DEFAULT_EVENT, []).youtubeId).toBe('');
    expect(normalizeEventFields({}, DEFAULT_EVENT, []).youtubeId).toBe('');
    // Update sem o campo mantém o vídeo.
    expect(normalizeEventFields({ title: 'x' }, { youtubeId: ID }, []).youtubeId).toBe(ID);
  });

  it('o restore de backup também só aceita ID válido', () => {
    const { events } = mergeRestore([], [
      { id: 'a', slug: 'a', youtubeId: `x"><script>alert(1)</script>` },
      { id: 'b', slug: 'b', youtubeId: `https://youtu.be/${ID}` },
    ]);
    expect(events.find(e => e.id === 'a').youtubeId).toBe('');
    expect(events.find(e => e.id === 'b').youtubeId).toBe(ID);
  });
});

describe('página do projeto com vídeo', () => {
  const base = {
    id: 'v', slug: 'fnusc', title: 'FNUSC', driveUrl: 'https://drive.google.com/x',
    photos: ['https://lh3.googleusercontent.com/d/AAA', 'https://lh3.googleusercontent.com/d/BBB'],
  };

  it('o vídeo toma o lugar das fotos de capa, sem carregar o player antes do clique', () => {
    const html = eventHTML({ ...base, youtubeId: ID }, '2026', null, 'NONCE');
    expect(html).toContain('id="yt-hero"');
    expect(html).toContain(`src="https://i.ytimg.com/vi/${ID}/hqdefault.jpg"`);
    expect(html).toContain(`href="https://www.youtube.com/watch?v=${ID}"`); // sem JS, abre no YouTube
    expect(html).not.toContain('id="carousel"');
    expect(html).not.toMatch(/<iframe[^>]+youtube/);
    expect(html).toContain('class="video-chip"');
  });

  it('projeto "em breve" continua mostrando o em breve, não o vídeo', () => {
    const html = eventHTML({ ...base, youtubeId: ID, comingSoon: true }, '2026', null, 'NONCE');
    expect(html).not.toContain('id="yt-hero"');
    expect(html).toContain('hero-soon-ov');
  });

  it('um ID adulterado no KV não vira vídeo nem atributo quebrado', () => {
    const html = eventHTML({ ...base, youtubeId: 'x" onerror="alert(1)' }, '2026', null, 'NONCE');
    expect(html).not.toContain('id="yt-hero"');
    expect(html).not.toContain('onerror="alert(1)');
    expect(html).toContain('id="carousel"');
  });

  it('sem vídeo, a capa segue sendo o carrossel de fotos', () => {
    const html = eventHTML(base, '2026', null, 'NONCE');
    expect(html).not.toContain('id="yt-hero"');
    expect(html).toContain('id="carousel"');
  });

  it('a galeria marca o card com o selo "Vídeos"', () => {
    const html = galleryHTML([{ ...base, youtubeId: ID }], null, 'NONCE');
    expect(html).toContain('class="video-badge"');
  });
});

describe('cabeçalhos para o player', () => {
  it('a CSP libera só a miniatura e o player nocookie — nas duas políticas', () => {
    for (const csp of [contentSecurityPolicy('n'), contentSecurityPolicy('n', { strict: true })]) {
      const diretiva = (/** @type {string} */ nome) => csp.split('; ').find(d => d.startsWith(nome + ' ')) || '';
      expect(diretiva('frame-src')).toBe('frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com');
      expect(diretiva('img-src')).toContain('https://i.ytimg.com');
      expect(csp).not.toMatch(/https:\/\/(www\.)?youtube\.com/);
      expect(diretiva('media-src')).toBe("media-src 'none'");
    }
  });

  it('a Permissions-Policy delega autoplay e tela cheia só ao player', () => {
    const pp = htmlSecurityHeaders('n')['Permissions-Policy'];
    expect(pp).toContain('autoplay=(self "https://www.youtube-nocookie.com")');
    expect(pp).toContain('fullscreen=(self "https://www.youtube-nocookie.com")');
    expect(pp).toContain('camera=()');
  });
});
