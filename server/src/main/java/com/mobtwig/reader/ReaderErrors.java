package com.mobtwig.reader;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

/** 본문 오류에 DB·로컬 경로·content_url 원문을 포함하지 않습니다. */
@RestControllerAdvice(assignableTypes = ChapterTextController.class)
public class ReaderErrors {
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, String>> rejected(ResponseStatusException exception) {
        int status = exception.getStatusCode().value();
        String message = switch (status) {
            case 400 -> "식별자가 올바르지 않습니다.";
            case 404 -> "공개된 회차가 없습니다.";
            case 415 -> "지원하지 않는 본문 형식입니다.";
            default -> "본문을 제공할 수 없습니다. 다시 시도해 주십시오.";
        };
        return ResponseEntity.status(status).header("Cache-Control", "no-store").body(Map.of("message", message));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> failed() {
        return ResponseEntity.internalServerError().header("Cache-Control", "no-store")
                .body(Map.of("message", "본문을 불러오지 못했습니다. 다시 시도해 주십시오."));
    }
}
