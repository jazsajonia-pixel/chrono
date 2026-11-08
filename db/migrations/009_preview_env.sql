-- Chrono: per-project Live server variables (e.g. a development DATABASE_URL).
-- Values are stored ONLY as AES-256-GCM ciphertext (key derived from ENCRYPTION_KEY, bound to
-- user + repository + variable name as additional authenticated data). They're decrypted only
-- inside the preview-server function and passed to that user's own preview sandbox.
-- The server also creates this table lazily (CREATE TABLE IF NOT EXISTS), so it is safe to rerun.
CREATE TABLE IF NOT EXISTS preview_env (
  user_id           BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo              TEXT        NOT NULL,
  name              TEXT        NOT NULL,
  value_ciphertext  TEXT        NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, repo, name)
);
