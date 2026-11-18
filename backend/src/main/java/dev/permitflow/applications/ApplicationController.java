package dev.permitflow.applications;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import dev.permitflow.applications.ApplicationService.Application;
import dev.permitflow.applications.ApplicationService.Detail;
import dev.permitflow.applications.ApplicationService.Permit;
import dev.permitflow.applications.ApplicationService.Purpose;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/applications")
@SecurityRequirement(name = "demoBasic")
public class ApplicationController {
    public record Submission(@NotNull Purpose purpose, @Min(1) @Max(90) Integer days,
                             @Size(max = 200) String purposeDetails, OffsetDateTime arrivalAt,
                             OffsetDateTime departureAt) {}
    public record Decision(@NotNull Boolean approved) {}

    private final ApplicationService applications;
    private final DemoRules rules;

    public ApplicationController(ApplicationService applications, DemoRules rules) {
        this.applications = applications;
        this.rules = rules;
    }

    @GetMapping("/rules/{purpose}")
    public Map<String, Integer> limits(@PathVariable Purpose purpose) {
        return rules.limits(purpose);
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    @PreAuthorize("hasRole('APPLICANT')")
    public Application submit(Authentication actor, @RequestHeader("Idempotency-Key") UUID key,
                              @Valid @RequestBody Submission submission) {
        return applications.submit(actor.getName(), key, submission);
    }

    @GetMapping
    public List<Application> list(Authentication actor, @RequestParam(required = false) ApplicationStatus status,
                                  @RequestParam(required = false) UUID id,
                                  @RequestParam(required = false) @Pattern(regexp = "[a-fA-F0-9-]{4,36}") String query,
                                  @RequestParam(defaultValue = "0") @Min(0) int page) {
        return applications.list(actor, status, id, query, page);
    }

    @GetMapping("/{id}")
    public Detail detail(Authentication actor, @PathVariable UUID id) {
        return applications.detail(actor, id);
    }

    @GetMapping("/counts")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<ApplicationStatus, Long> counts() {
        return applications.counts();
    }

    @PostMapping("/{id}/review")
    @PreAuthorize("hasAnyRole('REVIEWER', 'ADMIN')")
    public Application review(Authentication actor, @PathVariable UUID id,
                              @RequestHeader("X-PermitFlow-Demo") String demoHeader) {
        return applications.startReview(id, actor.getName());
    }

    @PostMapping(path = "/{id}/decision", consumes = MediaType.APPLICATION_JSON_VALUE)
    @PreAuthorize("hasAnyRole('REVIEWER', 'ADMIN')")
    public Application decide(Authentication actor, @PathVariable UUID id, @Valid @RequestBody Decision decision) {
        return applications.decide(id, actor.getName(), decision.approved());
    }

    @PostMapping("/{id}/permit")
    @PreAuthorize("hasRole('ADMIN')")
    public Permit issue(Authentication actor, @PathVariable UUID id,
                        @RequestHeader("X-PermitFlow-Demo") String demoHeader) {
        return applications.issue(id, actor.getName());
    }
}
