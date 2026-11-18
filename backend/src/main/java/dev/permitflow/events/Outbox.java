package dev.permitflow.events;

import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.permitflow.applications.ApplicationStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;

@Component
public class Outbox {
    public static final String EVENTS = "permitflow.application-events";
    public static final String IMPORTS = "permitflow.csv-import";
    public static final String IMPORT_ERRORS = "permitflow.csv-import-errors";

    public record Event(UUID eventId, UUID applicationId, String eventType, ApplicationStatus status,
                        String actor, OffsetDateTime occurredAt) {}

    private final JdbcClient db;
    private final KafkaTemplate<String, String> kafka;
    private final ObjectMapper json;

    public Outbox(JdbcClient db, KafkaTemplate<String, String> kafka, ObjectMapper json) {
        this.db = db;
        this.kafka = kafka;
        this.json = json;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void append(UUID applicationId, String type, ApplicationStatus status, String actor) {
        db.sql("""
                INSERT INTO outbox (event_id, application_id, event_type, status, actor)
                VALUES (:event, :application, :type, :status, :actor)
                """).param("event", UUID.randomUUID()).param("application", applicationId)
                .param("type", type).param("status", status.name()).param("actor", actor).update();
    }

    @Scheduled(fixedDelay = 1500)
    @Transactional(rollbackFor = Exception.class)
    public void publishNext() throws Exception {
        // The transaction-level lock lets one publisher preserve the order across replicas.
        if (!db.sql("SELECT pg_try_advisory_xact_lock(827401)").query(Boolean.class).single()) {
            return;
        }
        var next = db.sql("""
                SELECT event_id, application_id, event_type, status, actor, occurred_at
                FROM outbox WHERE published_at IS NULL ORDER BY sequence LIMIT 1 FOR UPDATE
                """).query(Event.class).optional();
        if (next.isEmpty()) {
            return;
        }
        Event event = next.get();
        kafka.send(EVENTS, event.applicationId().toString(), json.writeValueAsString(event))
                .get(20, TimeUnit.SECONDS);
        db.sql("UPDATE outbox SET published_at = now() WHERE event_id = :id")
                .param("id", event.eventId()).update();
    }
}
