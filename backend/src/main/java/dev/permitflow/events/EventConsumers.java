package dev.permitflow.events;

import java.util.UUID;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.permitflow.applications.ApplicationService;
import dev.permitflow.applications.ApplicationService.Purpose;
import org.apache.kafka.clients.admin.NewTopic;
import org.bson.Document;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.backoff.FixedBackOff;

@Configuration
public class EventConsumers {
    public record ImportRow(UUID id, String fileHash, Purpose purpose, int days) {}

    private final MongoTemplate audit;
    private final ObjectMapper json;
    private final ApplicationService applications;
    private final JdbcClient db;
    private final KafkaTemplate<String, String> kafka;

    public EventConsumers(MongoTemplate audit, ObjectMapper json, ApplicationService applications,
                          JdbcClient db, KafkaTemplate<String, String> kafka) {
        this.audit = audit;
        this.json = json;
        this.applications = applications;
        this.db = db;
        this.kafka = kafka;
    }

    @Bean
    NewTopic applicationEvents() {
        return topic(Outbox.EVENTS);
    }

    @Bean
    NewTopic csvImport() {
        return topic(Outbox.IMPORTS);
    }

    @Bean
    NewTopic csvImportErrors() {
        return topic(Outbox.IMPORT_ERRORS);
    }

    @Bean
    DefaultErrorHandler kafkaErrorHandler() {
        return new DefaultErrorHandler(new FixedBackOff(2000, FixedBackOff.UNLIMITED_ATTEMPTS));
    }

    private NewTopic topic(String name) {
        return TopicBuilder.name(name).partitions(1).replicas(1).build();
    }

    @KafkaListener(topics = Outbox.EVENTS, groupId = "permitflow-audit")
    public void audit(String value) {
        Document event = Document.parse(value);
        event.put("_id", event.getString("eventId"));
        try {
            audit.insert(event, "application_events");
        } catch (DuplicateKeyException alreadyRecorded) {
            // A redelivery has the same event ID.
        }
    }

    @Transactional
    @KafkaListener(topics = Outbox.IMPORTS, groupId = "permitflow-import")
    public void importRow(String value) throws Exception {
        ImportRow row;
        try {
            row = json.readValue(value, ImportRow.class);
        } catch (com.fasterxml.jackson.core.JsonProcessingException invalid) {
            reject("INVALID_JSON", null);
            return;
        }
        if (row == null || row.id() == null || row.fileHash() == null || !row.fileHash().matches("[a-f0-9]{64}")
                || row.purpose() == null || row.days() < 1 || row.days() > 90) {
            reject("INVALID_ROW", null);
            return;
        }
        var previous = db.sql("""
                SELECT a.purpose, a.days FROM import_receipts r JOIN applications a ON a.id = r.application_id
                WHERE r.row_id = :id
                """).param("id", row.id()).query(ImportedPayload.class).optional();
        if (previous.isPresent()) {
            if (!previous.get().equals(new ImportedPayload(row.purpose(), row.days()))) {
                reject("ROW_ID_REUSED", row.id());
            }
            return;
        }
        var application = applications.importSubmission(row.id(), row.purpose(), row.days());
        db.sql("""
                INSERT INTO import_receipts (row_id, file_hash, application_id)
                VALUES (:id, :hash, :application) ON CONFLICT (row_id) DO NOTHING
                """).param("id", row.id()).param("hash", row.fileHash())
                .param("application", application.id()).update();
    }

    public record ImportedPayload(Purpose purpose, int days) {}

    private void reject(String reason, UUID rowId) throws Exception {
        String error = json.writeValueAsString(new ImportError(reason, rowId));
        kafka.send(Outbox.IMPORT_ERRORS, error).get(20, java.util.concurrent.TimeUnit.SECONDS);
    }

    private record ImportError(String reason, UUID rowId) {}
}
