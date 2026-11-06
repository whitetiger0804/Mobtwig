package com.mobtwig;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.jspecify.annotations.NonNull;

/** Mobtwig HTTP API와 DB 연결을 초기화합니다. */
@SpringBootApplication
public class MobtwigApplication {

    /** Spring Boot의 기본 설정 클래스를 생성합니다. */
    public MobtwigApplication() { }

    /**
     * Spring Boot 애플리케이션을 실행합니다.
     * @param args 실행 인자입니다.
     */
    public static void main(String @NonNull [] args) {
        SpringApplication.run(MobtwigApplication.class, args);
    }
}
