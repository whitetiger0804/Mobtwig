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
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    final HttpClient client = HttpClient.newHttpClient();
    final List<String> sessionIds = new ArrayList<>();

    @AfterEach void cleanup() {
        for (String id : sessionIds) jdbc.update("DELETE FROM SPRING_SESSION WHERE SESSION_ID=?", id);
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
