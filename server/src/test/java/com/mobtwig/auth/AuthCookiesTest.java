package com.mobtwig.auth;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import static org.junit.jupiter.api.Assertions.*;

class AuthCookiesTest {
    @Test void namesPathsAndFlagsAreIndependentAndEachRequestReadsOnlyItsCookie() {
        var resolver = new AuthCookies(true);
        var admin = request("/api/admin/csrf"); var member = request("/api/auth/csrf");
        var adminResponse = new MockHttpServletResponse(); var memberResponse = new MockHttpServletResponse();
        resolver.setSessionId(admin, adminResponse, "admin-private-id");
        resolver.setSessionId(member, memberResponse, "member-private-id");
        String a = adminResponse.getHeader("Set-Cookie"), m = memberResponse.getHeader("Set-Cookie");
        assertNotNull(a); assertNotNull(m);
        assertTrue(a.startsWith("SESSION=")); assertTrue(m.startsWith("MEMBER_SESSION="));
        assertTrue(a.contains("Path=/;")); assertTrue(m.contains("Path=/api;"));
        for (String value : new String[]{a, m}) { assertTrue(value.contains("HttpOnly")); assertTrue(value.contains("Secure")); assertTrue(value.contains("SameSite=Strict")); }
        Cookie[] cookies = { cookie(a), cookie(m) };
        admin.setCookies(cookies); member.setCookies(cookies);
        assertEquals(java.util.List.of("admin-private-id"), resolver.resolveSessionIds(admin));
        assertEquals(java.util.List.of("member-private-id"), resolver.resolveSessionIds(member));
        var expired = new MockHttpServletResponse(); resolver.expireSession(member, expired);
        assertTrue(expired.getHeader("Set-Cookie").startsWith("MEMBER_SESSION="));
        assertFalse(expired.getHeader("Set-Cookie").startsWith("SESSION="));
        assertFalse(AuthCookies.memberRequest(request("/api/authentication")));
    }

    @Test void cookieNameSwapsCannotReadOrInvalidateTheOtherScopesSession() throws Exception {
        for (String scope : new String[]{AuthCookies.MEMBER, AuthCookies.ADMIN}) {
            var request = request(scope.equals(AuthCookies.MEMBER) ? "/api/admin/session" : "/api/auth/session");
            var session = request.getSession(); session.setAttribute(AuthCookies.SCOPE, scope);
            var response = new MockHttpServletResponse();
            String expected = scope.equals(AuthCookies.MEMBER) ? AuthCookies.ADMIN : AuthCookies.MEMBER;
            new AuthScopeGuard(expected, new AuthCookies(false)).doFilter(request, response,
                    (req, res) -> fail("다른 인증 영역으로 전달하면 안 됩니다."));
            assertEquals(401, response.getStatus()); assertEquals(scope, session.getAttribute(AuthCookies.SCOPE));
            assertTrue(response.getHeader("Set-Cookie").startsWith(expected.equals(AuthCookies.MEMBER) ? "MEMBER_SESSION=" : "SESSION="));
        }
    }

    @Test void legacyAuthenticatedAdminSessionsDoNotBecomeMemberSessions() throws Exception {
        var request = request("/api/auth/session");
        request.getSession().setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, "legacy-authentication");
        var response = new MockHttpServletResponse();
        new AuthScopeGuard(AuthCookies.MEMBER, new AuthCookies(false)).doFilter(request, response, (req, res) -> fail());
        assertEquals(401, response.getStatus());
        new AuthScopeGuard(AuthCookies.ADMIN, new AuthCookies(false)).doFilter(request, new MockHttpServletResponse(), (req, res) -> {});
    }

    @Test void credentialCorsRejectsWildcardAndNonOriginConfiguration() {
        for (String origin : new String[]{"*", "https://*.example.test", "https://host.test/path", "https://user:pass@host.test", "https://host.test?x=1"}) {
            assertThrows(IllegalArgumentException.class, () -> new MemberWebSecurity().memberCors(origin));
        }
        assertNotNull(new MemberWebSecurity().memberCors("http://localhost:8081,https://app.example.test"));
    }

    private MockHttpServletRequest request(String uri) { var request = new MockHttpServletRequest(); request.setRequestURI(uri); return request; }
    private Cookie cookie(String header) { String[] value = header.substring(0, header.indexOf(';')).split("=", 2); return new Cookie(value[0], value[1]); }
}
