# PhotoSwipe 5.4.4 (vendorizado)

Visualizador da galeria própria (`/galeria/<slug>`, #235): zoom por pinça e
duplo toque, swipe, teclado e acessibilidade. Biblioteca madura, mantida e de
licença MIT (ver `LICENSE`) — o "terceirizar para quem já sabe" do #234.

Por que vendorizado e não por CDN: a CSP só aceita script da própria origem, e
o site não tem passo de build. Os três arquivos abaixo são **byte a byte** os
do pacote npm `photoswipe@5.4.4` (`dist/`), conferido pelo integrity do
registro (`sha512-WNFHoKrkZNnvFFhbHL93WDkW3ifwVOXSW3w1UuZZelSmgXpIGiZSNlZJq37rR8YejqME2rHs9EhH9ZvlvFH2NA==`).

| arquivo | origem no pacote |
| --- | --- |
| `photoswipe-lightbox.esm.min.js` | `dist/photoswipe-lightbox.esm.min.js` |
| `photoswipe.esm.min.js` | `dist/photoswipe.esm.min.js` |
| `photoswipe.css` | `dist/photoswipe.css` |

`npm run build:vendor` empacota estes arquivos em `src/content/vendor.js`
(o Worker não tem sistema de arquivos), com o hash no nome publicado — por
isso dá para servir com `immutable`. `tests/vendor.test.js` reprova se o
módulo gerado divergir daqui.

## Para atualizar

1. `npm pack photoswipe@<versão>` numa pasta à parte e confira o `integrity`
   do tarball contra `npm view photoswipe@<versão> dist.integrity`.
2. Copie os três arquivos de `dist/` e o `LICENSE` para cá; atualize a versão
   e o integrity neste README.
3. `npm run build:vendor` e `npm run verifica:galeria`.
