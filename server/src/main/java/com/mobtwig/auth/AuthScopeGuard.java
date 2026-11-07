package com.mobtwig.auth;

import java.io.IOException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.web.filter.OncePerRequestFilter;

/** 쿠키 이름을 바꿔 다른 인증 영역의 세션 ID를 재사용해도 원래 세션은 건드리지 않습니다. */
public final class AuthScopeGuard extends OncePerRequestFilter {
    private final String expected;
    private final AuthCookies cookies;
    public AuthScopeGuard(String expected, AuthCookies cookies) { this.expected = expected; this.cookies = cookies; }

    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var session = request.getSession(false);
        if (session != null) {
            Object scope = session.getAttribute(AuthCookies.SCOPE);
            boolean legacyAuthenticated = scope == null
                    && session.getAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY) != null;
            if (scope != null && !expected.equals(scope) || legacyAuthenticated && AuthCookies.MEMBER.equals(expected)) {
                cookies.expireSession(request, response);
                response.setStatus(401); response.setHeader("Cache-Control", "no-store"); return;
            }
        }
        chain.doFilter(request, response);
    }
}
