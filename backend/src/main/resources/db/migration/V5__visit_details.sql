ALTER TABLE applications
    ADD COLUMN purpose_details text,
    ADD COLUMN arrival_at timestamptz,
    ADD COLUMN departure_at timestamptz,
    ADD CHECK (purpose_details IS NULL OR (purpose = 'DEMO_OTHER' AND length(btrim(purpose_details)) BETWEEN 1 AND 200)),
    ADD CHECK ((arrival_at IS NULL AND departure_at IS NULL) OR
               (arrival_at IS NOT NULL AND departure_at IS NOT NULL AND departure_at > arrival_at));
