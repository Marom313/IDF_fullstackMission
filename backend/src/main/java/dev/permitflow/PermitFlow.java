package dev.permitflow;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@EnableScheduling
@SpringBootApplication
public class PermitFlow {
    public static void main(String[] args) {
        SpringApplication.run(PermitFlow.class, args);
    }
}
