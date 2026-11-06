package com.mobtwig.admin;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.jspecify.annotations.NonNull;

/** 비밀 환경변수로 명시한 최초 관리자만 생성하며 기존 계정을 변경하지 않습니다. */
@Component
@ConditionalOnProperty(name = "mobtwig.admin.bootstrap-enabled", havingValue = "true")
public class AdminBootstrap implements ApplicationRunner {
    private final AdminAccounts accounts;
    private final AdminRequests.Account input;

    /**
     * 서버의 비공개 초기 계정 설정을 읽습니다.
     * @param accounts 관리자 저장 서비스입니다.
     * @param email 최초 관리자 이메일입니다.
     * @param nickname 최초 관리자 닉네임입니다.
     * @param password 최초 관리자 비밀번호입니다.
     */
    public AdminBootstrap(AdminAccounts accounts,
            @Value("${ADMIN_BOOTSTRAP_EMAIL:}") String email,
            @Value("${ADMIN_BOOTSTRAP_NICKNAME:}") String nickname,
            @Value("${ADMIN_BOOTSTRAP_PASSWORD:}") String password) {
        this.accounts = accounts;
        this.input = new AdminRequests.Account(email, nickname, password);
    }

    /**
     * 활성 관리자가 없을 때 한 번 생성합니다.
     * @param args 애플리케이션 실행 인자입니다.
     */
    @Override
    public void run(@NonNull ApplicationArguments args) {
        if (!accounts.hasAdmin()) {
            accounts.create(input);
        }
    }
}
