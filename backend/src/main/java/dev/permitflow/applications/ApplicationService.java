package dev.permitflow.applications;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.EnumMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonInclude;
import dev.permitflow.events.Outbox;
import io.swagger.v3.oas.annotations.media.Schema;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ApplicationService {
    private static final Logger log = LoggerFactory.getLogger(ApplicationService.class);
    public enum Purpose { DEMO_VISIT, DEMO_EVENT, DEMO_OTHER }

    @Schema(requiredProperties = {"id", "applicant", "purpose", "days", "status", "createdAt", "eligible"})
    public record Application(UUID id, String applicant, Purpose purpose, int days,
                              ApplicationStatus status, OffsetDateTime createdAt,
                              @JsonInclude(JsonInclude.Include.NON_NULL) String purposeDetails,
                              @JsonInclude(JsonInclude.Include.NON_NULL) OffsetDateTime arrivalAt,
                              @JsonInclude(JsonInclude.Include.NON_NULL) OffsetDateTime departureAt) {
        public boolean isEligible() { return days <= DemoRules.maximumDays(purpose); }
    }

    @Schema(requiredProperties = {"id", "expiresAt"})
    public record Permit(UUID id, OffsetDateTime expiresAt) {}
    @Schema(requiredProperties = {"status", "actor", "createdAt"})
    public record History(ApplicationStatus status, String actor, OffsetDateTime createdAt) {}
    @Schema(requiredProperties = {"application", "history"})
    public record Detail(Application application, @JsonInclude(JsonInclude.Include.NON_NULL) Permit permit,
                         List<History> history) {}

    private static final String SELECT = """
            SELECT id, applicant, purpose, days, status, created_at, purpose_details, arrival_at, departure_at FROM applications
            """;

    private final JdbcClient db;
    private final Outbox outbox;
    private final DemoRules rules;

    public ApplicationService(JdbcClient db, Outbox outbox, DemoRules rules) {
        this.db = db;
        this.outbox = outbox;
        this.rules = rules;
    }

    @Transactional
    public Application submit(String applicant, UUID key, ApplicationController.Submission submission) {
        String details = submission.purposeDetails() == null ? "" : submission.purposeDetails().strip();
        if ((submission.purpose() == Purpose.DEMO_OTHER) == details.isBlank()) {
            throw invalid("INVALID_PURPOSE_DETAILS");
        }
        OffsetDateTime arrival = normalize(submission.arrivalAt());
        OffsetDateTime departure = normalize(submission.departureAt());
        int days = stayDays(submission.days(), arrival, departure);
        return submit(applicant, key, submission.purpose(), days, "web", details.isEmpty() ? null : details,
                arrival, departure);
    }

    @Transactional
    public Application importSubmission(UUID key, Purpose purpose, int days) {
        return submit("demo-applicant", key, purpose, days, "import", null, null, null);
    }

    private Application submit(String applicant, UUID key, Purpose purpose, int days, String source,
                               String details, OffsetDateTime arrival, OffsetDateTime departure) {
        UUID id = UUID.randomUUID();
        int inserted = db.sql("""
                INSERT INTO applications (id, applicant, submission_key, purpose, days, status, submission_source,
                                          purpose_details, arrival_at, departure_at)
                VALUES (:id, :applicant, :key, :purpose, :days, 'SUBMITTED', :source, :details, :arrival, :departure)
                ON CONFLICT (applicant, submission_key, submission_source) DO NOTHING
                """).params(Map.of("id", id, "applicant", applicant, "key", key,
                "purpose", purpose.name(), "days", days, "source", source))
                .param("details", details).param("arrival", arrival).param("departure", departure).update();
        if (inserted == 1) {
            if (source.equals("web")) {
                rules.limitSubmission(applicant);
            }
            history(id, ApplicationStatus.SUBMITTED, applicant);
            outbox.append(id, "ApplicationSubmitted", ApplicationStatus.SUBMITTED, applicant);
            return find(id, false);
        }
        Application existing = db.sql(SELECT + """
                 WHERE applicant = :applicant AND submission_key = :key AND submission_source = :source
                """).param("applicant", applicant).param("key", key).param("source", source)
                .query(Application.class).single();
        if (existing.purpose() != purpose || existing.days() != days
                || !Objects.equals(existing.purposeDetails(), details)
                || !Objects.equals(normalize(existing.arrivalAt()), arrival)
                || !Objects.equals(normalize(existing.departureAt()), departure)) {
            throw conflict("SUBMISSION_KEY_REUSED");
        }
        return existing;
    }

    private static OffsetDateTime normalize(OffsetDateTime value) {
        return value == null ? null : value.withOffsetSameInstant(ZoneOffset.UTC).truncatedTo(ChronoUnit.MICROS);
    }

    private static int stayDays(Integer legacyDays, OffsetDateTime arrival, OffsetDateTime departure) {
        if (arrival == null && departure == null && legacyDays != null) {
            return legacyDays;
        }
        if (arrival == null || departure == null || !departure.isAfter(arrival)) {
            throw invalid("INVALID_VISIT_DATES");
        }
        Duration duration = Duration.between(arrival, departure);
        if (duration.compareTo(Duration.ofDays(90)) > 0) {
            throw invalid("INVALID_VISIT_DATES");
        }
        long wholeDays = duration.toDays();
        int days = (int) (wholeDays + (duration.equals(Duration.ofDays(wholeDays)) ? 0 : 1));
        if (legacyDays != null && legacyDays != days) {
            throw invalid("INVALID_VISIT_DATES");
        }
        return days;
    }

    private static ResponseStatusException invalid(String code) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, code);
    }

    public List<Application> list(Authentication actor, ApplicationStatus status, UUID id, String query, int page) {
        return db.sql(SELECT + """
                 WHERE (:own = false OR applicant = :actor)
                   AND (CAST(:status AS text) IS NULL OR status = :status)
                   AND (CAST(:id AS uuid) IS NULL OR id = :id)
                   AND (CAST(:query AS text) IS NULL OR CAST(id AS text) LIKE :query)
                 ORDER BY created_at DESC, id LIMIT 50 OFFSET :offset
                """).param("own", applicant(actor)).param("actor", actor.getName())
                .param("status", status == null ? null : status.name()).param("id", id)
                .param("query", query == null ? null : "%" + query.toLowerCase(Locale.ROOT) + "%")
                .param("offset", (long) page * 50).query(Application.class).list();
    }

    public Map<ApplicationStatus, Long> counts() {
        Map<ApplicationStatus, Long> counts = new EnumMap<>(ApplicationStatus.class);
        for (ApplicationStatus status : ApplicationStatus.values()) {
            counts.put(status, 0L);
        }
        db.sql("SELECT status, count(*) FROM applications GROUP BY status").query((rs, row) ->
                Map.entry(ApplicationStatus.valueOf(rs.getString(1)), rs.getLong(2)))
                .list().forEach(entry -> counts.put(entry.getKey(), entry.getValue()));
        return counts;
    }

    @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public Detail detail(Authentication actor, UUID id) {
        Application application = find(id, false);
        if (applicant(actor) && !application.applicant().equals(actor.getName())) {
            throw missing();
        }
        Permit permit = db.sql("SELECT id, expires_at FROM permits WHERE application_id = :id")
                .param("id", id).query(Permit.class).optional().orElse(null);
        List<History> history = db.sql("""
                SELECT status, actor, created_at FROM application_history WHERE application_id = :id ORDER BY id
                """).param("id", id).query(History.class).list();
        return new Detail(application, permit, history);
    }

    @Transactional
    public Application startReview(UUID id, String actor) {
        transition(find(id, true), ApplicationStatus.IN_REVIEW, actor);
        return find(id, false);
    }

    @Transactional
    public Application decide(UUID id, String actor, boolean approved) {
        Application application = find(id, true);
        if (approved && !application.isEligible()) {
            throw conflict("INELIGIBLE");
        }
        transition(application, approved ? ApplicationStatus.APPROVED : ApplicationStatus.REJECTED, actor);
        db.sql("INSERT INTO decisions (application_id, reviewer, approved) VALUES (:id, :actor, :approved)")
                .param("id", id).param("actor", actor).param("approved", approved).update();
        outbox.append(id, "DecisionMade", approved ? ApplicationStatus.APPROVED : ApplicationStatus.REJECTED, actor);
        return find(id, false);
    }

    @Transactional
    public Permit issue(UUID id, String actor) {
        Application application = find(id, true);
        if (application.status() == ApplicationStatus.ISSUED) {
            return db.sql("SELECT id, expires_at FROM permits WHERE application_id = :id")
                    .param("id", id).query(Permit.class).single();
        }
        transition(application, ApplicationStatus.ISSUED, actor);
        outbox.append(id, "PermitIssued", ApplicationStatus.ISSUED, actor);
        return db.sql("""
                INSERT INTO permits (id, application_id, issued_by, expires_at)
                SELECT :permitId, id, :actor,
                       now() + COALESCE(departure_at - arrival_at, make_interval(days => days))
                FROM applications WHERE id = :id
                RETURNING id, expires_at
                """).param("permitId", UUID.randomUUID()).param("id", id).param("actor", actor)
                .query(Permit.class).single();
    }

    @Scheduled(fixedDelay = 60_000)
    @Transactional
    public void expirePermits() {
        List<UUID> due = db.sql("""
                SELECT a.id FROM applications a JOIN permits p ON p.application_id = a.id
                WHERE a.status = 'ISSUED' AND p.expires_at <= now()
                ORDER BY p.expires_at LIMIT 100 FOR UPDATE OF a SKIP LOCKED
                """).query(UUID.class).list();
        for (UUID id : due) {
            transition(find(id, false), ApplicationStatus.EXPIRED, "demo-system");
        }
    }

    private Application find(UUID id, boolean lock) {
        return db.sql(SELECT + " WHERE id = :id" + (lock ? " FOR UPDATE" : ""))
                .param("id", id).query(Application.class).optional().orElseThrow(ApplicationService::missing);
    }

    private void transition(Application application, ApplicationStatus next, String actor) {
        if (!application.status().allows(next)) {
            throw conflict("INVALID_TRANSITION");
        }
        db.sql("UPDATE applications SET status = :status WHERE id = :id")
                .param("status", next.name()).param("id", application.id()).update();
        history(application.id(), next, actor);
    }

    private void history(UUID id, ApplicationStatus status, String actor) {
        db.sql("INSERT INTO application_history (application_id, status, actor) VALUES (:id, :status, :actor)")
                .param("id", id).param("status", status.name()).param("actor", actor).update();
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                log.info("Application status saved applicationId={} status={} actor={}", id, status, actor);
            }
        });
    }

    private static boolean applicant(Authentication actor) {
        return actor.getAuthorities().stream().anyMatch(role -> role.getAuthority().equals("ROLE_APPLICANT"));
    }

    private static ResponseStatusException missing() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "APPLICATION_NOT_FOUND");
    }

    private static ResponseStatusException conflict(String code) {
        return new ResponseStatusException(HttpStatus.CONFLICT, code);
    }
}
