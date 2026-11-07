package com.mobtwig.auth;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** 회원 영역의 익명 CSRF 세션도 관리자 영역과 구분합니다. */
@RestController
public class MemberCsrfController {
    @GetMapping("/api/auth/csrf")
    public CsrfToken csrf(CsrfToken token, HttpServletRequest request) {
        request.getSession().setAttribute(AuthCookies.SCOPE, AuthCookies.MEMBER);
        return token;
    }
}
