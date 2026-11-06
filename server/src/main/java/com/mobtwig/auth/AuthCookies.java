package com.mobtwig.auth;

import java.util.List;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.session.web.http.CookieHttpSessionIdResolver;
import org.springframework.session.web.http.DefaultCookieSerializer;
import org.springframework.session.web.http.HttpSessionIdResolver;
import org.springframework.stereotype.Component;

/** 관리자 쿠키와 회원 쿠키를 요청 영역별로 분리합니다. 세션 원문을 로깅하지 않습니다. */
@Component
public class AuthCookies implements HttpSessionIdResolver {
    public static final String SCOPE = "MOBTWIG_AUTH_SCOPE";
    public static final String MEMBER = "MEMBER";
    public static final String ADMIN = "ADMIN";
    private final CookieHttpSessionIdResolver admin;
    private final CookieHttpSessionIdResolver member;

    public AuthCookies(@Value("${server.servlet.session.cookie.secure:false}") boolean secure) {
        admin = resolver("SESSION", "/", secure);
        member = resolver("MEMBER_SESSION", "/api", secure);
    }

    private static CookieHttpSessionIdResolver resolver(String name, String path, boolean secure) {
        var serializer = new DefaultCookieSerializer();
        serializer.setCookieName(name); serializer.setCookiePath(path);
        serializer.setUseHttpOnlyCookie(true); serializer.setUseSecureCookie(secure); serializer.setSameSite("Strict");
        var resolver = new CookieHttpSessionIdResolver(); resolver.setCookieSerializer(serializer); return resolver;
    }

    /** 영역 경계를 포함해 판정하므로 비슷한 이름의 공개 경로는 회원 세션을 선택하지 않습니다. */
    public static boolean memberRequest(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return path.equals("/api/auth") || path.startsWith("/api/auth/")
                || path.equals("/api/members") || path.startsWith("/api/members/");
    }

    private CookieHttpSessionIdResolver forRequest(HttpServletRequest request) {
        return memberRequest(request) ? member : admin;
    }
    @Override public List<String> resolveSessionIds(HttpServletRequest request) { return forRequest(request).resolveSessionIds(request); }
    @Override public void setSessionId(HttpServletRequest request, HttpServletResponse response, String id) { forRequest(request).setSessionId(request, response, id); }
    @Override public void expireSession(HttpServletRequest request, HttpServletResponse response) { forRequest(request).expireSession(request, response); }
}
