package com.mobtwig.auth;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/** 시연 설정과 화면·동의 기록에 함께 사용하는 문서 원본을 보관합니다. */
@Component
public class SignupPolicies {
    private static final String VERSION = "demo-2026-11-07-v1";
    private final boolean enabled;
    private final List<Document> documents;

    public SignupPolicies(@Value("${mobtwig.auth.signup-demo-enabled:false}") boolean enabled) {
        this.enabled = enabled;
        this.documents = List.of(
                load("TERMS", "이용약관 · 임시 시연용", "terms.txt"),
                load("PRIVACY", "개인정보 수집·이용 동의 · 임시 시연용", "privacy.txt"));
    }

    public List<Document> current() {
        if (!enabled) {
            throw new SignupFailure(503, "이 환경에서는 시연 회원가입을 제공하지 않습니다.", java.util.Map.of());
        }
        return documents;
    }

    private static Document load(String kind, String title, String file) {
        try {
            String body = new ClassPathResource("policies/" + VERSION + "/" + file)
                    .getContentAsString(StandardCharsets.UTF_8).replace("\r\n", "\n").replace('\r', '\n');
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8));
            return new Document(kind, VERSION, title, body, HexFormat.of().formatHex(hash), true);
        } catch (IOException | NoSuchAlgorithmException failure) {
            throw new IllegalStateException("시연 가입 문서를 읽지 못했습니다.", failure);
        }
    }

    /** 본문은 화면 표시, 해시 계산, 버전별 원문 저장에 동일하게 사용합니다. */
    public record Document(String kind, String version, String title, String body, String contentHash, boolean temporary) {
        String errorField() { return kind.equals("TERMS") ? "terms" : "privacy"; }
    }
}
