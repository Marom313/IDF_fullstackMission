package dev.permitflow.applications;

import java.time.Duration;
import java.util.List;
import java.util.Map;

import dev.permitflow.applications.ApplicationService.Purpose;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
public class DemoRules {
    private static final DefaultRedisScript<Long> INCREMENT = new DefaultRedisScript<>("""
            local count = redis.call('INCR', KEYS[1])
            if count == 1 then redis.call('EXPIRE', KEYS[1], 60) end
            return count
            """, Long.class);

    private final StringRedisTemplate redis;

    public DemoRules(StringRedisTemplate redis) {
        this.redis = redis;
    }

    static int maximumDays(Purpose purpose) {
        return switch (purpose) {
            case DEMO_VISIT -> 30;
            case DEMO_EVENT -> 14;
            case DEMO_OTHER -> 0;
        };
    }

    public Map<String, Integer> limits(Purpose purpose) {
        String key = "permitflow:rules:v1:" + purpose.name();
        int days = maximumDays(purpose);
        try {
            String cached = redis.opsForValue().get(key);
            if (cached != null) {
                return Map.of("maximumDays", Integer.parseInt(cached));
            }
            redis.opsForValue().set(key, String.valueOf(days), Duration.ofMinutes(5));
        } catch (DataAccessException unavailable) {
            // Reference data is available from the in-process rules.
        }
        return Map.of("maximumDays", days);
    }

    public void limitSubmission(String applicant) {
        Long count;
        try {
            count = redis.execute(INCREMENT, List.of("permitflow:submission-rate:" + applicant));
        } catch (DataAccessException unavailable) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "RATE_LIMIT_UNAVAILABLE");
        }
        if (count == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "RATE_LIMIT_UNAVAILABLE");
        }
        if (count > 10) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "SUBMISSION_RATE_LIMIT");
        }
    }
}
