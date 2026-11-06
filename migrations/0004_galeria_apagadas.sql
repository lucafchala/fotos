-- Galeria (v3.1): fotos que sumiram da pasta do Drive e foram dadas como
-- APAGADAS (a Drive API respondeu "não existe" ou "na lixeira"), para o painel
-- listar "Fotos apagadas recentemente" e para o aviso não se repetir (a chave
-- primária impede dois avisos para a mesma foto).
-- Guarda só: id do arquivo, nome do arquivo, autor (nome da pasta de créditos),
-- capítulo, seção e data/hora da captura que a galeria já mostrava, mais o
-- instante em que o sumiço foi percebido. SEM e-mail, sem GPS, sem dado de
-- visitante. Retenção: 30 dias; a poda roda a cada gravação e a cada consulta
-- do painel (DELETE ... WHERE sumiu_em < agora - 30 dias).
-- Apply with:  npx wrangler d1 migrations apply fotos-consent --remote
CREATE TABLE IF NOT EXISTS galeria_apagadas (
  slug     TEXT NOT NULL,   -- projeto
  foto_id  TEXT NOT NULL,   -- id do arquivo no Drive
  nome     TEXT NOT NULL,   -- nome do arquivo
  autor    TEXT NOT NULL,   -- nome do autor (vazio = autor padrão)
  capitulo TEXT NOT NULL,   -- nome do capítulo (vazio sem capítulos)
  secao    TEXT NOT NULL,   -- seção (subpasta) da foto
  captura  TEXT NOT NULL,   -- AAAA-MM-DD HH:MM:SS da câmera (vazio = sem data)
  sumiu_em TEXT NOT NULL,   -- ISO 8601: quando o sumiço foi percebido
  PRIMARY KEY (slug, foto_id)
);
CREATE INDEX IF NOT EXISTS idx_galeria_apagadas_sumiu ON galeria_apagadas(sumiu_em);
