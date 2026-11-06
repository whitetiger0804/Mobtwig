package com.mobtwig.auth;

import java.io.IOException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/** 유효했던 세션이라도 비활성 회원의 다음 요청은 거부합니다. */
final class ActiveMemberGuard extends OncePerRequestFilter {
    private final MemberSessions sessions;
    private final AuthCookies cookies;
    ActiveMemberGuard(MemberSessions sessions, AuthCookies cookies) { this.sessions = sessions; this.cookies = cookies; }

    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        response.setHeader("Cache-Control", "no-store");
        var principal = SecurityContextHolder.getContext().getAuthentication();
        if (principal != null && principal.isAuthenticated() && !(principal instanceof AnonymousAuthenticationToken)
                && sessions.current(principal.getName()).isEmpty()) {
            var session = request.getSession(false);
            if (session != null) session.invalidate();
            SecurityContextHolder.clearContext(); cookies.expireSession(request, response);
            response.setStatus(401); return;
        }
        chain.doFilter(request, response);
    }
}
