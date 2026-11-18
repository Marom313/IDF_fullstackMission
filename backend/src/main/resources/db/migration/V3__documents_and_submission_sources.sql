ALTER TABLE applications ADD COLUMN submission_source text NOT NULL DEFAULT 'web'
    CHECK (submission_source IN ('web', 'import'));
ALTER TABLE applications DROP CONSTRAINT applications_applicant_submission_key_key;
ALTER TABLE applications ADD UNIQUE (applicant, submission_key, submission_source);

CREATE TABLE application_documents (
    id uuid PRIMARY KEY,
    application_id uuid NOT NULL REFERENCES applications(id),
    sha256 text NOT NULL,
    filename text NOT NULL,
    media_type text NOT NULL,
    bytes integer NOT NULL,
    ready boolean NOT NULL DEFAULT false,
    UNIQUE (application_id, sha256)
);
