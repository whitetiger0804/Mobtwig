package com.mobtwig.admin;

import java.nio.charset.StandardCharsets;

import com.mobtwig.work.WorkMetadata;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** 입력의 한글·Unicode 공백과 DB 바이트 한도, 공개 URL을 검증합니다. */
final class AdminRules {
    private AdminRules() { }

    static String text(@Nullable String value, String label, int max) {
        String text = optional(value, label, max);
        if (text == null) {
            throw bad(label + "을(를) 입력하십시오.");
        }
        return text;
    }

    static @Nullable String optional(@Nullable String value, String label, int max) {
        String text = WorkMetadata.optionalText(value);
        if (text == null) {
            return null;
        }
        if (text.length() > max || text.getBytes(StandardCharsets.UTF_8).length > 65535) {
            throw bad(label + "의 길이가 허용 범위를 넘었습니다.");
        }
        return text;
    }

    static String url(@Nullable String value, String label) {
        String url = text(value, label, 500);
        try {
            WorkMetadata.imageUrl(url);
        }
        catch (IllegalArgumentException | IllegalStateException exception) {
            throw bad(label + "은(는) HTTP(S) 주소 또는 서버 기준의 / 경로여야 합니다.");
        }
        return url;
    }

    static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
