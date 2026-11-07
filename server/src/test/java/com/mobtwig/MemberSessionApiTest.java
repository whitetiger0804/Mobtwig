package com.mobtwig;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ContextConfiguration;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

/** 전용 MySQL DB에서 실제 HTTP·JDBC 세션을 검사합니다. 운영·개발 DB에서는 실행하지 않습니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=false"
})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class MemberSessionApiTest {
    static final String PASSWORD = "member-test-password123";
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired PasswordEncoder passwords;
    final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    final List<String> ids = new ArrayList<>();

    @BeforeEach void prepare() {
        cleanup();
        var encoded = passwords.encode(PASSWORD);
        jdbc.update("""
                INSERT INTO member(id,email,password_hash,nickname,role,status) VALUES
                (-9701,'member-session-a@example.test',?,'member-session-a','USER','ACTIVE'),
                (-9702,'member-session-b@example.test',?,'member-session-b','USER','ACTIVE'),
                (-9703,'member-session-admin@example.test',?,'member-session-admin','ADMIN','ACTIVE'),
                (-9704,'member-session-suspended@example.test',?,'member-session-suspended','USER','SUSPENDED')
                """, encoded, encoded, encoded, encoded);
    }

    @AfterEach void cleanup() {
        String database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertTrue(database != null && (database.equals("mobtwig_ci") || database.matches("[A-Za-z0-9_]+_test")));
        for (String id : ids) jdbc.update("DELETE FROM SPRING_SESSION WHERE SESSION_ID=?", id);
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME IN ('-9701','-9702','-9703','-9704')");
        jdbc.update("DELETE FROM member WHERE id IN (-9701,-9702,-9703,-9704) AND email LIKE 'member-session-%@example.test'");
        ids.clear();
    }

    @Test void isolatesRealSimultaneousLoginsAndInvalidatesOnlyTheMemberLogout() throws Exception {
        var admin = login("/api/admin", "SESSION", "username", "member-session-admin@example.test", PASSWORD);
        var member = login("/api/auth", "MEMBER_SESSION", "email", "member-session-a@example.test", PASSWORD);
        var identity = send("/api/auth/session?id=-9702", admin + "; " + member, null, null);
        assertEquals(200, identity.statusCode());
        assertEquals("-9701", mapper.readTree(identity.body()).get("id").asString());
        assertFalse(identity.body().contains("password"));
        assertTrue(identity.headers().firstValue("Cache-Control").orElseThrow().contains("no-store"));
        assertEquals(401, send("/api/auth/session", "MEMBER_SESSION=" + value(admin), null, null).statusCode());
        assertEquals(401, send("/api/admin/session", "SESSION=" + value(member), null, null).statusCode());
        assertEquals(200, send("/api/admin/session", admin, null, null).statusCode());
        assertEquals(200, send("/api/auth/session", member, null, null).statusCode());
        var csrf = send("/api/auth/csrf", member, null, null);
        assertEquals(403, send("/api/auth/logout", member, null, "").statusCode());
        assertEquals(204, send("/api/auth/logout", admin + "; " + member, token(csrf), "").statusCode());
        assertEquals(401, send("/api/auth/session", member, null, null).statusCode());
        assertEquals(200, send("/api/admin/session", admin, null, null).statusCode());
        var second = login("/api/auth", "MEMBER_SESSION", "email", "member-session-b@example.test", PASSWORD);
        assertEquals("-9702", mapper.readTree(send("/api/auth/session", second, null, null).body()).get("id").asString());
    }

    @Test void rejectsWrongInactiveAndExpiredSessions() throws Exception {
        for (String email : List.of("missing@example.test", "member-session-suspended@example.test", "member-session-a@example.test")) {
            var csrf = send("/api/auth/csrf", null, null, null); var cookie = capture(csrf, "MEMBER_SESSION");
            assertEquals(401, send("/api/auth/login", cookie, token(csrf), form("email", email, "incorrect")).statusCode());
            assertEquals(401, send("/api/auth/session", cookie, null, null).statusCode());
        }
        // 비밀번호가 맞아도 SUSPENDED는 거절합니다.
        var csrf = send("/api/auth/csrf", null, null, null); var cookie = capture(csrf, "MEMBER_SESSION");
        assertEquals(401, send("/api/auth/login", cookie, token(csrf), form("email", "member-session-suspended@example.test", PASSWORD)).statusCode());
        var active = login("/api/auth", "MEMBER_SESSION", "email", "member-session-a@example.test", PASSWORD);
        jdbc.update("UPDATE member SET status='SUSPENDED' WHERE id=-9701");
        assertEquals(401, send("/api/auth/session", active, null, null).statusCode());
        jdbc.update("UPDATE member SET status='ACTIVE' WHERE id=-9701");
        assertEquals(401, send("/api/auth/session", active, null, null).statusCode());
        var expired = login("/api/auth", "MEMBER_SESSION", "email", "member-session-b@example.test", PASSWORD);
        jdbc.update("UPDATE SPRING_SESSION SET LAST_ACCESS_TIME=0,EXPIRY_TIME=1 WHERE SESSION_ID=?", decode(value(expired)));
        assertEquals(401, send("/api/auth/session", expired, null, null).statusCode());
    }

    private String login(String base, String name, String field, String email, String password) throws Exception {
        var csrf = send(base + "/csrf", null, null, null); assertEquals(200, csrf.statusCode());
        var anonymous = capture(csrf, name);
        var result = send(base + "/login", anonymous, token(csrf), form(field, email, password));
        assertEquals(204, result.statusCode()); assertTrue(result.body().isEmpty());
        var authenticated = capture(result, name); assertNotEquals(anonymous, authenticated);
        assertEquals(401, send(base + "/session", anonymous, null, null).statusCode());
        var header = result.headers().allValues("Set-Cookie").stream().filter(v -> v.startsWith(name + "=")).findFirst().orElseThrow();
        assertTrue(header.contains("HttpOnly")); assertTrue(header.contains("SameSite=Strict"));
        return authenticated;
    }
    private String capture(HttpResponse<?> response, String name) {
        var header = response.headers().allValues("Set-Cookie").stream().filter(v -> v.startsWith(name + "=")).findFirst().orElseThrow();
        var cookie = header.substring(0, header.indexOf(';')); ids.add(decode(value(cookie))); return cookie;
    }
    private String value(String cookie) { return cookie.substring(cookie.indexOf('=') + 1); }
    private String decode(String value) { return new String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8); }
    private String token(HttpResponse<String> response) throws Exception { return mapper.readTree(response.body()).get("token").asString(); }
    private String form(String field, String email, String password) {
        return field + "=" + URLEncoder.encode(email, StandardCharsets.UTF_8) + "&password=" + URLEncoder.encode(password, StandardCharsets.UTF_8);
    }
    private HttpResponse<String> send(String path, String cookie, String token, String body) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(15));
        if (cookie != null) request.header("Cookie", cookie);
        if (token != null) request.header("X-CSRF-TOKEN", token);
        if (body == null) request.GET();
        else request.header("Content-Type", "application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(body));
        return http.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
}
