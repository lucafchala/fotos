-- Access category + self-declaration for the image-use consent audit trail.
-- Records the project category the visitor accepted under, and the verbatim
-- self-declaration they ticked (empty for 'public', which requires only the
-- Terms acceptance). Both columns are nullable so existing rows stay valid.
-- Apply with:  npx wrangler d1 migrations apply fotos-consent --remote
ALTER TABLE image_use_consent ADD COLUMN access_type TEXT;       -- 'public' | 'private' | 'family'
ALTER TABLE image_use_consent ADD COLUMN declaration_text TEXT;  -- verbatim self-declaration accepted
