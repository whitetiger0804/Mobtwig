package com.mobtwig.auth;

import java.util.Map;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** 회원 인증과 CSRF 보호를 받는 본인 비밀번호 변경 API입니다. */
@RestController
public class MemberPasswordController {
    private final MemberPasswordService service;
    private final AuthCookies cookies;
    public MemberPasswordController(MemberPasswordService service, AuthCookies cookies) { this.service = service; this.cookies = cookies; }

    @PostMapping(value = "/api/auth/password", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Void> change(@RequestBody Map<String, Object> input, Authentication authentication,
            HttpServletRequest request, HttpServletResponse response) {
        service.change(authentication, input);
        var session = request.getSession(false);
        if (session != null) session.invalidate();
        SecurityContextHolder.clearContext();
        cookies.expireSession(request, response);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @ExceptionHandler(MemberPasswordService.Invalid.class)
    ResponseEntity<ErrorBody> invalid(MemberPasswordService.Invalid failure) {
        return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).body(new ErrorBody(failure.getMessage(), failure.fields));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ErrorBody> malformed() {
        return invalid(new MemberPasswordService.Invalid(Map.of("request", "비밀번호 변경 정보의 JSON 형식을 확인해 주세요.")));
    }

    public record ErrorBody(String message, Map<String, String> fieldErrors) { }
}
