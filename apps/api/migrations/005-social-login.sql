ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
CREATE TABLE social_identities (
 provider text NOT NULL CHECK(provider IN ('google','github')),
 subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 255),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(provider,subject), UNIQUE(provider,user_id)
);
