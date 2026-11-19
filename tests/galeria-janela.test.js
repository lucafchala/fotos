// Janela da galeria (4.7.0): o botão "Ver e baixar as fotos" abre uma janela
// no modo galeria, com o passo a passo, tanto nos álbuns públicos quanto nos
// de família. O Drive fica como "Prefere o Google Drive?" nos dois. Antes, o
// projeto de família mostrava só o botão do Drive, e a galeria aparecia
// escondida dentro dele.
import { describe, it, expect } from 'vitest';
import { eventHTML } from '../src/ui/event.js';

const PASTA = 'https://drive.google.com/drive/folders/RAIZ_PASTA_0001';
const base = { id: 'a', slug: 'turma', title: 'Turma', accessType: 'public', date: '2026-01-01', driveUrl: PASTA };
const pagina = ev => eventHTML(ev, '2026', null, 'NONCE');
const janela = html => html.slice(html.indexOf('<!-- DRIVE MODAL -->'), html.indexOf('<!-- REMOVAL MODAL -->'));

describe('janela da galeria', () => {
  it('público: o botão principal abre a janela da galeria, com link de verdade sem JS', () => {
    const html = pagina(base);
    expect(html).toContain('<a class="btn-drive" href="/galeria/turma" data-action="openGaleria">');
    expect(html).toContain('data-action="openModal">Prefere o Google Drive? Abrir no Drive');
    expect(html).toContain('<button class="sticky-cta" id="sticky-cta" data-action="openGaleria">');
    // Os passos moraram na página na 4.6.0; agora só dentro da janela.
    const fora = html.replace(janela(html), '');
    expect(fora).not.toContain('class="passos-baixar"');
  });

  it('público: a janela tem o passo a passo e abre a galeria sem portão', () => {
    const j = janela(pagina(base));
    expect(j).toContain('class="modal-ov galeria-livre" id="modal"');
    expect(j).toContain('class="passos-baixar"');
    expect(j).toContain('Para redes sociais');
    expect(j).toContain('Salvar no Fotos');
    expect(j).toMatch(/<a id="galeria-link" href="\/galeria\/turma" class="btn-drive-go so-galeria">/);
    expect(j).toContain('data-action="modoDrive"');
    expect(j).toContain('data-action="modoGaleria"');
    expect(j).not.toContain('id="galeria-tip"');
  });

  it('família: o mesmo botão e a mesma janela, com a galeria atrás do aceite', () => {
    const html = pagina({ ...base, accessType: 'family' });
    expect(html).toContain('<button type="button" class="btn-drive" data-action="openGaleria">');
    expect(html).toContain('Ver e baixar as fotos');
    expect(html).toContain('data-action="openModal">Prefere o Google Drive? Abrir no Drive');
    const j = janela(html);
    expect(j).not.toContain('galeria-livre');
    expect(j).toContain('class="passos-baixar"');
    // Dentro do bloco trancado: herda o cinza e o carregando até o passe chegar.
    expect(j).toMatch(/id="drive-links-wrap" class="drive-locked"[^]*?<a id="galeria-link" href="#" class="btn-drive-go so-galeria"[^>]*data-action="galeriaLink"/);
    expect(j).toContain('id="drive-consent"');
    expect(html).toContain('const TEM_GALERIA    = true;');
    expect(html).toContain('const GALERIA_LIVRE  = false;');
  });

  it('sem pasta do Drive: continua só o botão do Drive, sem modo galeria', () => {
    const html = pagina({ ...base, driveUrl: 'https://drive.google.com/file/d/ARQUIVO/view' });
    expect(html).not.toContain('data-action="openGaleria"');
    expect(html).not.toContain('class="so-galeria"');
    expect(html).toContain('<button class="btn-drive" data-action="openModal">');
    expect(html).toContain('const TEM_GALERIA    = false;');
  });

  it('em breve: nada de galeria', () => {
    const html = pagina({ ...base, comingSoon: true });
    expect(html).not.toContain('data-action="openGaleria"');
    expect(html).toContain('data-action="openSoonModal"');
  });

  it('o título da janela segue o modo (aria-labelledby, não um rótulo fixo)', () => {
    const j = janela(pagina(base));
    expect(j).toContain('aria-labelledby="modal-titulo"');
    expect(j).toContain('<h2 id="modal-titulo"><span class="so-galeria">Ver e baixar as fotos</span><span class="so-drive">Acessar fotos</span></h2>');
  });
});
