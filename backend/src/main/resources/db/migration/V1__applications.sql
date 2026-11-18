CREATE TABLE applications (
    id uuid PRIMARY KEY,
    applicant text NOT NULL,
    submission_key uuid NOT NULL,
    purpose text NOT NULL CHECK (purpose IN ('DEMO_VISIT', 'DEMO_EVENT', 'DEMO_OTHER')),
    days integer NOT NULL CHECK (days BETWEEN 1 AND 90),
    status text NOT NULL CHECK (status IN ('SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ISSUED', 'EXPIRED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (applicant, submission_key)
);

CREATE TABLE decisions (
    application_id uuid PRIMARY KEY REFERENCES applications(id),
    reviewer text NOT NULL,
    approved boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permits (
    id uuid PRIMARY KEY,
    application_id uuid NOT NULL UNIQUE REFERENCES applications(id),
    issued_by text NOT NULL,
    expires_at timestamptz NOT NULL
);

CREATE TABLE application_history (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    application_id uuid NOT NULL REFERENCES applications(id),
    status text NOT NULL,
    actor text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX application_history_application ON application_history(application_id, id);
