package dev.permitflow.applications;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/applications/activity")
@SecurityRequirement(name = "demoBasic")
public class ApplicationActivityController {
    public enum Kind { STATUS_SAVED, KAFKA_PENDING, KAFKA_PUBLISHED }

    @Schema(requiredProperties = {"id", "applicationId", "kind", "status", "occurredAt"})
    public record Entry(String id, UUID applicationId, Kind kind, ApplicationStatus status, OffsetDateTime occurredAt) {}

    private final JdbcClient db;

    public ApplicationActivityController(JdbcClient db) {
        this.db = db;
    }

    @GetMapping
    @PreAuthorize("hasRole('ADMIN')")
    public List<Entry> list() {
        return db.sql("""
                SELECT id, application_id, kind, status, occurred_at
                FROM (
                    SELECT 'status-' || id AS id, application_id, 'STATUS_SAVED' AS kind, status, created_at AS occurred_at
                    FROM application_history
                    UNION ALL
                    SELECT 'event-' || sequence, application_id,
                           CASE WHEN published_at IS NULL THEN 'KAFKA_PENDING' ELSE 'KAFKA_PUBLISHED' END,
                           status, COALESCE(published_at, occurred_at)
                    FROM outbox
                ) AS activity
                ORDER BY occurred_at DESC, id DESC
                LIMIT 50
                """).query(Entry.class).list();
    }
}
