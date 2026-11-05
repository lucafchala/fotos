-- Galeria (v3.1): foto da última listagem do Drive, uma linha por pasta (o
-- projeto inteiro, ou cada capítulo quando a galeria é por capítulos). Serve a
-- dois usos: (1) com "Atualização automática" desligada, a página mostra esta
-- lista até o dono tocar em "Atualizar agora" — a pasta do Drive é colaborativa
-- (qualquer pessoa com o link edita), então congelar a lista é uma forma de
-- moderar; (2) base de comparação para detectar fotos que sumiram.
-- Só é regravada quando o conteúdo muda (hash), nunca a cada visita.
-- Guarda o que a galeria já mostra: id, nome do arquivo, medidas, autor
-- (nome da pasta de créditos) e data/hora da captura. Sem GPS, sem dados da
-- câmera, sem dado de visitante.
-- Apply with:  npx wrangler d1 migrations apply fotos-consent --remote
CREATE TABLE IF NOT EXISTS galeria_snapshot (
  chave TEXT PRIMARY KEY,   -- id da pasta no Drive ('c:<id>' para a lista de capítulos)
  slug  TEXT NOT NULL,      -- projeto dono da foto: apagar o projeto apaga as linhas dele
  ctx   TEXT NOT NULL,      -- teto de páginas + hash dos créditos: muda, a foto antiga não vale
  hash  TEXT NOT NULL,      -- SHA-256 (16 hex) do conteúdo, sem o instante da leitura
  em    TEXT NOT NULL,      -- ISO 8601: quando esta lista foi lida do Drive
  dados TEXT NOT NULL       -- a listagem em JSON
);
CREATE INDEX IF NOT EXISTS idx_galeria_snapshot_slug ON galeria_snapshot(slug);
