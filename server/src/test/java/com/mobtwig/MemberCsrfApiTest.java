package com.mobtwig;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ContextConfiguration;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

/** 실제 세션 저장소에서 두 영역의 익명 CSRF·cookie 재사용·CORS를 검사합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=false",
        "mobtwig.auth.allowed-origins=http://localhost:8081"
})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class MemberCsrfApiTest {
    private static final String ORIGIN = "http://localhost:8081";
    private static final List<String> REVIEW_MUTATIONS = List.of(
            "POST /api/members/works/cors-missing/reviews", "PUT /api/members/reviews/1", "DELETE /api/members/reviews/1");
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired PasswordEncoder passwords;
    final HttpClient client = HttpClient.newHttpClient();
    final List<String> sessionIds = new ArrayList<>();

    @AfterEach void cleanup() {
        for (String id : sessionIds) jdbc.update("DELETE FROM SPRING_SESSION WHERE SESSION_ID=?", id);
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME='-13991'");
        jdbc.update("DELETE FROM member WHERE id=-13991 AND email='member-cors@example.test'");
        sessionIds.clear();
    }

    @Test void separatesCsrfCookiesAndRejectsBothDirectionsWithoutInvalidatingOriginalSessions() throws Exception {
        var admin = csrf("/api/admin/csrf", "SESSION");
        var member = csrf("/api/auth/csrf", "MEMBER_SESSION");
        assertNotEquals(admin.value(), member.value());
        assertEquals(401, send("/api/auth/csrf", "MEMBER_SESSION=" + admin.value(), null, null).statusCode());
        assertEquals(401, send("/api/admin/csrf", "SESSION=" + member.value(), null, null).statusCode());
        assertEquals(200, send("/api/admin/csrf", admin.cookie() + "; " + member.cookie(), null, null).statusCode());
        assertEquals(200, send("/api/auth/csrf", admin.cookie() + "; " + member.cookie(), null, null).statusCode());
        assertEquals(403, send("/api/auth/signup", member.cookie(), null, "{}").statusCode());
        assertEquals(403, send("/api/auth/signup", member.cookie(), admin.token(), "{}").statusCode());
    }

    @Test void allowsOnlyExactConfiguredCredentialOrigin() throws Exception {
        var allowed = client.send(HttpRequest.newBuilder(url("/api/auth/csrf"))
                .header("Origin", "http://localhost:8081").GET().build(), HttpResponse.BodyHandlers.ofString());
        capture(allowed, "MEMBER_SESSION");
        assertEquals(200, allowed.statusCode());
        assertEquals("http://localhost:8081", allowed.headers().firstValue("Access-Control-Allow-Origin").orElseThrow());
        assertEquals("true", allowed.headers().firstValue("Access-Control-Allow-Credentials").orElseThrow());
        var denied = client.send(HttpRequest.newBuilder(url("/api/auth/csrf"))
                .header("Origin", "https://untrusted.example.test").GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(403, denied.statusCode());
        assertTrue(denied.headers().firstValue("Access-Control-Allow-Origin").isEmpty());
    }

    /** MVC에 도달하지 않는 익명 401도 허용 origin에서 읽을 수 있고 다른 origin은 거부됩니다. */
    @Test void keepsCredentialCorsHeadersOnAnonymousSessionAndReviewErrors() throws Exception {
        for (String path : List.of("/api/auth/session", "/api/members/reviews/1/comments")) {
            assertCors(crossOrigin("GET", path, null, null, null, ORIGIN), 401);
            assertDeniedOrigin(crossOrigin("GET", path, null, null, null, "https://untrusted.example.test"));
        }
        for (String mutation : REVIEW_MUTATIONS) {
            var parts = mutation.split(" ", 2);
            assertCors(crossOrigin(parts[0], parts[1], null, null, "{}", ORIGIN), 401);
            assertDeniedOrigin(crossOrigin(parts[0], parts[1], null, null, "{}", "https://untrusted.example.test"));
        }
    }

    /** 다른 영역의 세션을 재사용해도 허용 origin은 401을 읽고 원래 세션은 유지됩니다. */
    @Test void keepsCredentialCorsOnScopeErrorsWithoutWeakeningOriginOrSessionIsolation() throws Exception {
        var admin = csrf("/api/admin/csrf", "SESSION");
        String swapped = "MEMBER_SESSION=" + admin.value();
        var requests = new ArrayList<>(REVIEW_MUTATIONS);
        requests.addAll(List.of("GET /api/auth/csrf", "GET /api/auth/session",
                "GET /api/members/reviews/1/comments", "POST /api/auth/login",
                "POST /api/auth/signup", "POST /api/auth/logout"));
        for (String request : requests) {
            var parts = request.split(" ", 2);
            String body = parts[0].equals("GET") ? null : "{}";
            var response = crossOrigin(parts[0], parts[1], swapped, null, body, ORIGIN);
            assertCors(response, 401);
            assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
            assertTrue(response.headers().allValues("Set-Cookie").stream()
                    .anyMatch(value -> value.startsWith("MEMBER_SESSION=;") && value.contains("Max-Age=0")));
            assertFalse(response.headers().allValues("Set-Cookie").stream().anyMatch(value -> value.startsWith("SESSION=")));
            assertDeniedOrigin(crossOrigin(parts[0], parts[1], swapped, null, body, "https://untrusted.example.test"));
        }
        var preflight = client.send(HttpRequest.newBuilder(url("/api/members/reviews/1"))
                .header("Origin", ORIGIN).header("Cookie", swapped).header("Access-Control-Request-Method", "PUT")
                .header("Access-Control-Request-Headers", "Content-Type,X-CSRF-TOKEN")
                .method("OPTIONS", HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
        assertCors(preflight, 200);
        String originalId = new String(Base64.getDecoder().decode(admin.value()), StandardCharsets.UTF_8);
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM SPRING_SESSION WHERE SESSION_ID=?", Integer.class, originalId));
        assertEquals(200, send("/api/admin/csrf", admin.cookie(), null, null).statusCode());
    }

    /** 로그인 성공과 CSRF 실패의 응답도 동일한 회원 CORS 정책을 유지합니다. */
    @Test void keepsCredentialCorsHeadersOnAuthenticatedCsrfErrors() throws Exception {
        cleanup();
        jdbc.update("""
                INSERT INTO member(id,email,password_hash,nickname,role,status)
                VALUES (-13991,'member-cors@example.test',?,'cors-test-member','USER','ACTIVE')
                """, passwords.encode("CorsPass19"));
        var csrf = csrf("/api/auth/csrf", "MEMBER_SESSION");
        var login = client.send(HttpRequest.newBuilder(url("/api/auth/login"))
                .header("Origin", ORIGIN).header("Cookie", csrf.cookie()).header("X-CSRF-TOKEN", csrf.token())
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("email=member-cors%40example.test&password=CorsPass19")).build(),
                HttpResponse.BodyHandlers.ofString());
        assertCors(login, 204);
        String cookie = capture(login, "MEMBER_SESSION");
        assertCors(crossOrigin("GET", "/api/auth/session", cookie, null, null, ORIGIN), 200);
        for (String mutation : REVIEW_MUTATIONS) {
            var parts = mutation.split(" ", 2);
            assertCors(crossOrigin(parts[0], parts[1], cookie, null, "{}", ORIGIN), 403);
            assertCors(crossOrigin(parts[0], parts[1], cookie, "invalid", "{}", ORIGIN), 403);
        }
    }

    /** 회원과 인증 경로의 기존 사전 요청 메서드·헤더·캐시 기간을 보존합니다. */
    @Test void keepsMemberPreflightPolicyWithoutExpandingAuthMethods() throws Exception {
        var allowed = client.send(HttpRequest.newBuilder(url("/api/members/reviews/1"))
                .header("Origin", ORIGIN).header("Access-Control-Request-Method", "PUT")
                .header("Access-Control-Request-Headers", "Content-Type,X-CSRF-TOKEN")
                .method("OPTIONS", HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
        assertCors(allowed, 200);
        assertEquals(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"), java.util.Arrays.stream(
                allowed.headers().firstValue("Access-Control-Allow-Methods").orElseThrow().split(",")).map(String::strip).toList());
        assertEquals("600", allowed.headers().firstValue("Access-Control-Max-Age").orElseThrow());
        var denied = client.send(HttpRequest.newBuilder(url("/api/auth/session"))
                .header("Origin", ORIGIN).header("Access-Control-Request-Method", "DELETE")
                .method("OPTIONS", HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(403, denied.statusCode());
    }

    private static void assertCors(HttpResponse<?> response, int status) {
        assertEquals(status, response.statusCode());
        assertEquals(ORIGIN, response.headers().firstValue("Access-Control-Allow-Origin").orElseThrow());
        assertEquals("true", response.headers().firstValue("Access-Control-Allow-Credentials").orElseThrow());
    }

    private static void assertDeniedOrigin(HttpResponse<?> response) {
        assertEquals(403, response.statusCode());
        assertTrue(response.headers().firstValue("Access-Control-Allow-Origin").isEmpty());
        assertTrue(response.headers().firstValue("Access-Control-Allow-Credentials").isEmpty());
    }

    private HttpResponse<String> crossOrigin(String method, String path, String cookie, String token, String body,
            String origin) throws Exception {
        var request = HttpRequest.newBuilder(url(path)).header("Origin", origin);
        if (cookie != null) request.header("Cookie", cookie);
        if (token != null) request.header("X-CSRF-TOKEN", token);
        if (body != null) request.header("Content-Type", "application/json");
        var response = client.send(request.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
        response.headers().allValues("Set-Cookie").stream().filter(value -> value.startsWith("MEMBER_SESSION="))
                .map(value -> value.substring("MEMBER_SESSION=".length(), value.indexOf(';')))
                .map(value -> new String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8)).forEach(sessionIds::add);
        return response;
    }

    private Csrf csrf(String path, String cookieName) throws Exception {
        var response = send(path, null, null, null); assertEquals(200, response.statusCode());
        String cookie = capture(response, cookieName);
        String value = cookie.substring(cookie.indexOf('=') + 1);
        return new Csrf(cookie, value, mapper.readTree(response.body()).get("token").asString());
    }
    private String capture(HttpResponse<?> response, String name) {
        String cookie = response.headers().allValues("Set-Cookie").stream().filter(v -> v.startsWith(name + "=")).findFirst().orElseThrow();
        String pair = cookie.substring(0, cookie.indexOf(';'));
        sessionIds.add(new String(Base64.getDecoder().decode(pair.substring(name.length() + 1)), StandardCharsets.UTF_8));
        return pair;
    }
    private HttpResponse<String> send(String path, String cookie, String token, String json) throws Exception {
        var request = HttpRequest.newBuilder(url(path));
        if (cookie != null) request.header("Cookie", cookie);
        if (token != null) request.header("X-CSRF-TOKEN", token);
        if (json != null) request.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(json));
        else request.GET();
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
    private URI url(String path) { return URI.create("http://127.0.0.1:" + port + path); }
    record Csrf(String cookie, String value, String token) { }
}
