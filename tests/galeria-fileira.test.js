// #253: a primeira fileira da galeria vem pronta no HTML (o LCP do celular não
// espera o script), com a mesma conta da grade do script.
import { describe, it, expect } from 'vitest';
import { galeriaHTML, primeiraFileiraHTML, GALERIA_JS } from '../src/ui/galeria.js';
import { EVENTO } from './helpers/paginas.js';

const foto = (/** @type {string} */ id, w = 6000, h = 4000) => [id, w, h, `${id}.jpg`, 1000];
const lista = (/** @type {any[][]} */ fotos, secoes = 1) => ({
  v: 1, pasta: 'RAIZ', em: '2026-11-14T12:00:00.000Z', truncada: false, total: fotos.length, videos: 0, outros: 0, rk: {},
  secoes: Array.from({ length: secoes }, (_, i) => ({ nome: i ? `Dia ${i}` : 'Abertura', caminho: i ? `Dia ${i}` : 'Abertura', fotos: i ? [foto(`OUTRA_${i}_AAAAAA`)] : fotos })),
});
const assina = (/** @type {string} */ id) => `ev.${id.slice(0, 4)}`;

describe('primeiraFileiraHTML', () => {
  it('deitada sozinha fecha a linha: uma foto, o webp e o jpeg do mesmo endereço do script', () => {
    const html = primeiraFileiraHTML(/** @type {any} */ (lista([foto('FOTO_A_00000001'), foto('FOTO_B_00000001')])), assina);
    expect(html).toContain('id="g-pre"');
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain('/f/FOTO_A_00000001/400j?k=ev.FOTO 400w');
    // Fora do celular, nada baixa: as fontes têm media e a <img> é um GIF vazio.
    expect(html.match(/<source media="\(max-width: 430px\)"/g)).toHaveLength(2);
    expect(html).toContain('<img src="data:image/gif;base64,');
    expect(html).toContain('/f/FOTO_A_00000001/800?k=ev.FOTO 800w');
    expect(html).toContain('fetchpriority="high"');
    expect(html).toContain('style="--r:1.5"');
    // Teto de densidade: no 3× o sizes encolhe pelo mesmo fator do script.
    expect(html).toContain('(min-resolution: 3dppx) calc((100vw - 2 * max(12px, 3vw) - 0px) * 0.6667)');
    expect(html).not.toContain('FOTO_B');
  });

  it('duas em pé dividem a linha; o h2 da seção aparece quando há várias', () => {
    const html = primeiraFileiraHTML(/** @type {any} */ (lista([foto('FOTO_A_00000001', 3000, 4000), foto('FOTO_B_00000001', 3000, 4000), foto('FOTO_C_00000001')], 2)), assina);
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).toContain('<h2>Abertura</h2>');
  });

  it('nada quando a linha muda com a largura do celular, é a última, ou tem vídeo', () => {
    // 1,2 sozinha: 360 px fecha a linha numa tela de 320 (296 úteis), não numa de 430.
    const muda = lista([foto('FOTO_A_00000001', 1200, 1000), foto('FOTO_B_00000001', 1000, 4000), foto('FOTO_C_00000001')]);
    expect(primeiraFileiraHTML(/** @type {any} */ (muda), assina)).toBe('');
    expect(primeiraFileiraHTML(/** @type {any} */ (lista([foto('FOTO_A_00000001')])), assina)).toBe('');
    // Na listagem o vídeo é f[7] (duração) — ver ehVideo.
    const video = [...foto('FOTO_A_00000001'), null, null, 30];
    expect(primeiraFileiraHTML(/** @type {any} */ (lista([video, foto('FOTO_B_00000001')])), assina)).toBe('');
  });

  it('entra no <main> da página, e o script a tira ao montar a grade', () => {
    const html = galeriaHTML({ event: EVENTO, listagem: /** @type {any} */ (lista([foto('FOTO_A_00000001'), foto('FOTO_B_00000001')])), erro: null, nonce: 'N', dono: false });
    expect(html).toMatch(/<main id="g-main" aria-label="Fotos"><section class="g-sec g-pre" id="g-pre"/);
    expect(GALERIA_JS.texto).toContain("document.getElementById('g-pre')");
  });
});
