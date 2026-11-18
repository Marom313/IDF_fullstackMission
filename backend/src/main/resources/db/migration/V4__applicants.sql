CREATE TABLE applicants (
    username text PRIMARY KEY,
    display_name text NOT NULL
);

INSERT INTO applicants (username, display_name)
VALUES ('demo-applicant', 'Synthetic Applicant 001');

ALTER TABLE applications ADD CONSTRAINT applications_applicant_fk
    FOREIGN KEY (applicant) REFERENCES applicants(username);
