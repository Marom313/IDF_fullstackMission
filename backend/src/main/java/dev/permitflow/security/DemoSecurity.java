package dev.permitflow.security;

import io.swagger.v3.oas.annotations.enums.SecuritySchemeType;
import io.swagger.v3.oas.annotations.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableMethodSecurity
@SecurityScheme(name = "demoBasic", type = SecuritySchemeType.HTTP, scheme = "basic")
public class DemoSecurity {
    @Bean
    InMemoryUserDetailsManager demoUsers() {
        String password = new BCryptPasswordEncoder().encode("permitflow-demo");
        return new InMemoryUserDetailsManager(
                User.withUsername("demo-applicant").password("{bcrypt}" + password).roles("APPLICANT").build(),
                User.withUsername("demo-reviewer").password("{bcrypt}" + password).roles("REVIEWER").build(),
                User.withUsername("demo-admin").password("{bcrypt}" + password).roles("ADMIN").build());
    }

    @Bean
    SecurityFilterChain security(HttpSecurity http) throws Exception {
        return http.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .httpBasic(Customizer.withDefaults())
                // JSON-only writes and required custom headers protect browser requests from cross-site forms.
                .csrf(csrf -> csrf.disable())
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html").permitAll()
                        .anyRequest().authenticated())
                .build();
    }
}
