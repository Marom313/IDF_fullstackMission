CREATE TABLE outbox (
    sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id uuid NOT NULL UNIQUE,
    application_id uuid NOT NULL REFERENCES applications(id),
    event_type text NOT NULL,
    status text NOT NULL,
    actor text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);

CREATE INDEX outbox_pending ON outbox(sequence) WHERE published_at IS NULL;

CREATE TABLE import_receipts (
    row_id uuid PRIMARY KEY,
    file_hash text NOT NULL,
    application_id uuid NOT NULL REFERENCES applications(id),
    imported_at timestamptz NOT NULL DEFAULT now()
);
