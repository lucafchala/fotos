// Fonte dos ícones do site. `/icon.svg` serve ICON_SVG como está, e
// `scripts/build-icons.mjs` rasteriza os dois para os PNG de `icons.js`.
const TEXTO = (/** @type {number} */ tamanho) => `<text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" font-family="-apple-system,BlinkMacSystemFont,'Inter',sans-serif" font-size="${tamanho}" font-weight="600" fill="#f0ebe5">f.</text>`;

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#0a0a0a"/>${TEXTO(140)}</svg>`;

// Maskable: o fundo vai até a borda (o sistema recorta) e a letra fica na zona
// segura de 80% no centro.
export const ICON_MASKABLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="#0a0a0a"/>${TEXTO(104)}</svg>`;
