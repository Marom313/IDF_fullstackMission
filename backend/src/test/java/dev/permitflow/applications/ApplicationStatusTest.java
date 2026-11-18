package dev.permitflow.applications;

import java.util.EnumSet;

import org.junit.jupiter.api.Test;

import static dev.permitflow.applications.ApplicationStatus.*;
import static org.assertj.core.api.Assertions.assertThat;

class ApplicationStatusTest {
    @Test
    void onlyAllowsDocumentedTransitions() {
        assertThat(next(SUBMITTED)).containsExactly(IN_REVIEW);
        assertThat(next(IN_REVIEW)).containsExactlyInAnyOrder(APPROVED, REJECTED);
        assertThat(next(APPROVED)).containsExactly(ISSUED);
        assertThat(next(ISSUED)).containsExactly(EXPIRED);
        assertThat(next(REJECTED)).isEmpty();
        assertThat(next(EXPIRED)).isEmpty();
    }

    private EnumSet<ApplicationStatus> next(ApplicationStatus status) {
        EnumSet<ApplicationStatus> next = EnumSet.noneOf(ApplicationStatus.class);
        for (ApplicationStatus candidate : values()) {
            if (status.allows(candidate)) {
                next.add(candidate);
            }
        }
        return next;
    }
}
