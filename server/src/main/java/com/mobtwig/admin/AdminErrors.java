package com.mobtwig.admin;

import java.util.Map;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

/** 비밀번호·SQL 원문을 노출하지 않고 관리자 입력 오류를 반환합니다. */
@RestControllerAdvice(basePackageClasses = AdminController.class)
public class AdminErrors {
    /** 관리자 오류 응답기를 생성합니다. */
    public AdminErrors() { }

    /**
     * 잘못된 값이나 JSON 형식을 거부합니다.
     * @return 민감한 입력 원문이 없는 안내입니다.
     */
    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class})
    public ResponseEntity<Map<String, String>> invalid() {
        return ResponseEntity.badRequest().body(Map.of("message", "입력값의 필수 항목·길이·숫자·날짜 형식을 확인하십시오."));
    }

    /**
     * 고유 키나 관계 충돌을 보고합니다.
     * @return DB 원문이 없는 충돌 응답입니다.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<Map<String, String>> conflict() {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message", "이미 등록된 식별자·이메일·닉네임 또는 연결 관계를 확인하십시오."));
    }

    /**
     * 검증한 서비스 오류를 반환합니다.
     * @param exception 입력 검증 또는 자료 부재 오류입니다.
     * @return 명시한 HTTP 상태와 안내입니다.
     */
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, String>> rejected(ResponseStatusException exception) {
        String message = exception.getReason();
        if (message == null) { message = "요청을 처리할 수 없습니다."; }
        return ResponseEntity.status(exception.getStatusCode()).body(Map.of("message", message));
    }
}
