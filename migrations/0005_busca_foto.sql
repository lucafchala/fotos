-- Busca nas fotos (v3.7): o que a Amazon Rekognition leu em cada foto de um
-- álbum com "Busca nas fotos" ligada — palavras (DetectText), "coisas" e
-- cenas (DetectLabels, em português e inglês) e a marca de moderação
-- (DetectModerationLabels). Preenchida só pelo indexador (POST
-- /api/busca/indexar, com o token dele); lida pela busca do álbum.
-- Guarda só texto normalizado da foto. Nenhum rosto, nenhuma imagem, nenhum
-- dado de visitante. Uma foto que sai do álbum é apagada daqui pelo próprio
-- indexador (lista `remover`); apagar o projeto apaga o álbum inteiro.
-- Apply with:  npx wrangler d1 migrations apply fotos-consent --remote
CREATE TABLE IF NOT EXISTS busca_foto (
  slug      TEXT NOT NULL,              -- projeto
  foto      TEXT NOT NULL,              -- id do arquivo no Drive
  cap       TEXT NOT NULL DEFAULT '',   -- capítulo (slug), vazio sem capítulos
  autor     TEXT NOT NULL DEFAULT '',   -- autor (nome dos créditos)
  texto     TEXT NOT NULL DEFAULT '',   -- palavras lidas, normalizadas
  coisas    TEXT NOT NULL DEFAULT '',   -- rótulos, normalizados (pt e en)
  moderacao TEXT NOT NULL DEFAULT '',   -- rótulos de moderação (vazio = nada)
  escondida INTEGER NOT NULL DEFAULT 0, -- 1 = a moderação escondeu (só uma vez)
  em        TEXT NOT NULL,              -- ISO 8601 da última gravação
  PRIMARY KEY (slug, foto)
);
