package dev.permitflow.applications;

import java.util.Map;
import java.util.Set;

public enum ApplicationStatus {
    SUBMITTED, IN_REVIEW, APPROVED, REJECTED, ISSUED, EXPIRED;

    private static final Map<ApplicationStatus, Set<ApplicationStatus>> TRANSITIONS = Map.of(
            SUBMITTED, Set.of(IN_REVIEW),
            IN_REVIEW, Set.of(APPROVED, REJECTED),
            APPROVED, Set.of(ISSUED),
            ISSUED, Set.of(EXPIRED));

    public boolean allows(ApplicationStatus next) {
        return TRANSITIONS.getOrDefault(this, Set.of()).contains(next);
    }
}
