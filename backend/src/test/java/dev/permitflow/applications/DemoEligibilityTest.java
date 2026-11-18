package dev.permitflow.applications;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class DemoEligibilityTest {
    @ParameterizedTest
    @CsvSource({"DEMO_VISIT,30,true", "DEMO_VISIT,31,false", "DEMO_EVENT,14,true",
            "DEMO_EVENT,15,false", "DEMO_OTHER,1,false"})
    void checksSyntheticEligibilityAtBoundaries(ApplicationService.Purpose purpose, int days, boolean eligible) {
        var application = new ApplicationService.Application(UUID.randomUUID(), "demo-applicant",
                purpose, days, ApplicationStatus.SUBMITTED, OffsetDateTime.now());
        assertThat(application.isEligible()).isEqualTo(eligible);
    }
}
