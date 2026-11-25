package com.mobtwig;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import com.mobtwig.admin.AdminAccounts;
import com.mobtwig.auth.AuthCookies;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.core.context.SecurityContextImpl;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.core.io.ClassPathResource;
import org.springframework.session.jdbc.JdbcIndexedSessionRepository;
import org.springframework.session.Session;
import org.springframework.session.SessionRepository;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import tools.jackson.databind.ObjectMapper;
import com.atlassian.oai.validator.OpenApiInteractionValidator;
import com.atlassian.oai.validator.model.Request;
import com.atlassian.oai.validator.model.SimpleResponse;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** 전용 MySQL의 실제 쿠키·CSRF·JDBC 세션과 로그인/변경 경합을 검증합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=false"
})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class MemberPasswordApiTest {
    static final String OLD = "original-password123", NEW = " next-password456 ";
    static final String EMAIL = "member-password-a@example.test";
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcIndexedSessionRepository sessions;
    @MockitoSpyBean AdminAccounts accounts;
    final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    static OpenApiInteractionValidator contract;

    @BeforeAll static void contract() throws Exception {
        contract = OpenApiInteractionValidator.createForInlineApiSpecification(
                new ClassPathResource("static/openapi.yaml").getContentAsString(StandardCharsets.UTF_8)).build();
    }

    @BeforeEach void prepare() {
        cleanup();
        jdbc.update("INSERT INTO member(id,email,password_hash,nickname,role,status) VALUES (-9721,?,?,'member-password-a','ADMIN','ACTIVE'),"
                + "(-9722,'member-password-b@example.test',?,'member-password-b','USER','ACTIVE')", EMAIL, passwords.encode(OLD), passwords.encode(OLD));
    }
    @AfterEach void cleanup() {
        assertTrue(jdbc.queryForObject("SELECT DATABASE()", String.class).endsWith("_test")
                || "mobtwig_ci".equals(jdbc.queryForObject("SELECT DATABASE()", String.class)));
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME IN ('-9721','-9722')");
        jdbc.update("DELETE FROM member WHERE id IN (-9721,-9722) AND email LIKE 'member-password-%@example.test'");
    }

    @Test void changesOnlyOwnerAndRevokesAllMemberDevicesWhileKeepingAdminAndOtherMembers() throws Exception {
        var first = login("/api/auth", EMAIL, OLD); var second = login("/api/auth", EMAIL, OLD);
        var other = login("/api/auth", "member-password-b@example.test", OLD); var admin = login("/api/admin", EMAIL, OLD);
        var result = change(first, OLD, NEW, NEW);
        assertEquals(204, result.statusCode()); assertEquals("", result.body());
        assertTrue(result.headers().firstValue("Cache-Control").orElseThrow().contains("no-store"));
        assertTrue(result.headers().allValues("Set-Cookie").stream().anyMatch(v -> v.startsWith("MEMBER_SESSION=") && v.contains("Max-Age=0")));
        assertEquals(401, get("/api/auth/session", first).statusCode());
        assertEquals(401, get("/api/auth/session", second).statusCode());
        assertEquals(200, get("/api/auth/session", other).statusCode());
        assertEquals(200, get("/api/admin/session", admin).statusCode());
        assertTrue(passwords.matches(NEW, hash())); assertFalse(passwords.matches(OLD, hash()));
        assertEquals(401, loginResponse("/api/auth", EMAIL, OLD).statusCode());
        assertEquals(200, get("/api/auth/session", login("/api/auth", EMAIL, NEW)).statusCode());
        assertEquals(401, loginResponse("/api/auth", EMAIL, NEW.strip()).statusCode());
    }

    @Test void rejectsInvalidInputWithoutChangingHashOrOtherSessions() throws Exception {
        var cookie = login("/api/auth", EMAIL, OLD); var before = hash();
        for (var input : List.of(
                Map.of("currentPassword", "wrong-password123", "newPassword", NEW, "newPasswordConfirmation", NEW),
                Map.of("currentPassword", OLD, "newPassword", OLD, "newPasswordConfirmation", OLD),
                Map.of("currentPassword", OLD, "newPassword", "short1", "newPasswordConfirmation", "short1"),
                Map.of("currentPassword", OLD, "newPassword", NEW, "newPasswordConfirmation", "different"),
                Map.of("currentPassword", OLD, "newPassword", "a1" + "한".repeat(24), "newPasswordConfirmation", "a1" + "한".repeat(24)),
                Map.of("currentPassword", OLD, "newPassword", NEW, "newPasswordConfirmation", NEW, "memberId", "-9722"),
                Map.of("currentPassword", 123, "newPassword", NEW, "newPasswordConfirmation", NEW),
                Map.of("newPassword", NEW, "newPasswordConfirmation", NEW))) {
            var result = post("/api/auth/password", cookie, token(cookie), mapper.writeValueAsString(input), "application/json");
            assertEquals(400, result.statusCode(), result.body());
            assertTrue(mapper.readTree(result.body()).get("fieldErrors").isObject());
            assertFalse(result.body().contains(OLD)); assertFalse(result.body().contains(NEW)); assertEquals(before, hash());
        }
        for (String malformed : List.of("[]", "null", "{", "123")) {
            assertEquals(400, post("/api/auth/password", cookie, token(cookie), malformed, "application/json").statusCode());
        }
        assertEquals(200, get("/api/auth/session", cookie).statusCode());
    }

    @Test void requiresActiveMemberScopeAndCsrf() throws Exception {
        var member = login("/api/auth", EMAIL, OLD); var admin = login("/api/admin", EMAIL, OLD);
        assertEquals(401, post("/api/auth/password", null, null, "{}", "application/json").statusCode());
        assertEquals(403, post("/api/auth/password", member, null, "{}", "application/json").statusCode());
        assertEquals(403, post("/api/auth/password", "MEMBER_SESSION=" + admin.substring(admin.indexOf('=') + 1), null, "{}", "application/json").statusCode());
        jdbc.update("UPDATE member SET status='SUSPENDED' WHERE id=-9721");
        assertEquals(401, post("/api/auth/password", member, null, "{}", "application/json").statusCode());
        jdbc.update("UPDATE member SET status='ACTIVE' WHERE id=-9721");
    }

    @Test void lateSessionSaveCannotRestoreRevokedAuthentication() throws Exception {
        var cookie = login("/api/auth", EMAIL, OLD);
        Session stale = sessions.findById(decode(cookie)); assertNotNull(stale);
        assertEquals(204, change(cookie, OLD, NEW, NEW).statusCode());
        // 요청 종료 시 옛 인증으로 새 세션이 생기는 가장 불리한 저장 순서를 재현합니다.
        Session late = sessions.createSession();
        for (String name : stale.getAttributeNames()) late.setAttribute(name, stale.getAttribute(name));
        persist(late);
        var lateCookie = "MEMBER_SESSION=" + Base64.getEncoder().encodeToString(late.getId().getBytes(StandardCharsets.UTF_8));
        assertEquals(401, get("/api/auth/session", lateCookie).statusCode());
        assertNull(sessions.findById(late.getId()));
    }

    @Test void legacyMemberAuthenticationWithoutCredentialVersionRequiresLogin() throws Exception {
        var cookie = login("/api/auth", EMAIL, OLD);
        Session legacy = sessions.findById(decode(cookie));
        var principal = User.withUsername("-9721").password("unused").roles("ADMIN").build();
        ((org.springframework.security.core.CredentialsContainer) principal).eraseCredentials();
        legacy.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY,
                new SecurityContextImpl(UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities())));
        persist(legacy);
        assertEquals(401, get("/api/auth/session", cookie).statusCode());
        assertNull(sessions.findById(legacy.getId()));
    }

    @Test void overlappingChangesUseLockedCredentialVersion() throws Exception {
        var cookie = login("/api/auth", EMAIL, OLD); var token = token(cookie);
        var first = http.sendAsync(request("/api/auth/password", cookie, token, payload(OLD, NEW, NEW), "application/json"), HttpResponse.BodyHandlers.ofString());
        var second = http.sendAsync(request("/api/auth/password", cookie, token, payload(OLD, "other-password789", "other-password789"), "application/json"), HttpResponse.BodyHandlers.ofString());
        var statuses = List.of(first.get(15, TimeUnit.SECONDS).statusCode(), second.get(15, TimeUnit.SECONDS).statusCode()).stream().sorted().toList();
        assertEquals(List.of(204, 401), statuses);
    }

    @Test void loginVerifiedWithOldHashCannotAcquireNewVersionAfterChange() throws Exception {
        var cookie = login("/api/auth", EMAIL, OLD);
        var read = new CountDownLatch(1); var release = new CountDownLatch(1); var once = new AtomicBoolean();
        doAnswer(call -> {
            var result = call.callRealMethod();
            if (once.compareAndSet(false, true)) {
                read.countDown(); assertTrue(release.await(10, TimeUnit.SECONDS));
            }
            return result;
        }).when(accounts).loadUserByUsername(EMAIL);
        var csrf = get("/api/auth/csrf", null);
        var pending = http.sendAsync(request("/api/auth/login", capture(csrf, "MEMBER_SESSION"), mapper.readTree(csrf.body()).get("token").asString(),
                form("email", EMAIL, OLD), "application/x-www-form-urlencoded"), HttpResponse.BodyHandlers.ofString());
        try {
            assertTrue(read.await(5, TimeUnit.SECONDS));
            assertEquals(204, change(cookie, OLD, NEW, NEW).statusCode());
        } finally { release.countDown(); }
        assertEquals(401, pending.get(15, TimeUnit.SECONDS).statusCode());
    }

    String hash() { return jdbc.queryForObject("SELECT password_hash FROM member WHERE id=-9721", String.class); }
    @SuppressWarnings({"rawtypes", "unchecked"})
    void persist(Session session) { ((SessionRepository) sessions).save(session); }
    String payload(String current, String next, String confirmation) { return mapper.writeValueAsString(Map.of("currentPassword", current, "newPassword", next, "newPasswordConfirmation", confirmation)); }
    HttpResponse<String> change(String cookie, String current, String next, String confirmation) throws Exception {
        return post("/api/auth/password", cookie, token(cookie), payload(current, next, confirmation), "application/json");
    }
    String token(String cookie) throws Exception { return mapper.readTree(get("/api/auth/csrf", cookie).body()).get("token").asString(); }
    String login(String base, String email, String password) throws Exception {
        var result = loginResponse(base, email, password); assertEquals(204, result.statusCode(), result.body());
        return capture(result, base.equals("/api/auth") ? "MEMBER_SESSION" : "SESSION");
    }
    HttpResponse<String> loginResponse(String base, String email, String password) throws Exception {
        var csrf = get(base + "/csrf", null); var name = base.equals("/api/auth") ? "MEMBER_SESSION" : "SESSION";
        return post(base + "/login", capture(csrf, name), mapper.readTree(csrf.body()).get("token").asString(),
                form(base.equals("/api/auth") ? "email" : "username", email, password), "application/x-www-form-urlencoded");
    }
    String capture(HttpResponse<?> response, String name) { return response.headers().allValues("Set-Cookie").stream().filter(v -> v.startsWith(name + "=")).findFirst().orElseThrow().split(";", 2)[0]; }
    String decode(String cookie) { return new String(Base64.getDecoder().decode(cookie.substring(cookie.indexOf('=') + 1)), StandardCharsets.UTF_8); }
    String form(String field, String email, String password) { return field + "=" + URLEncoder.encode(email, StandardCharsets.UTF_8) + "&password=" + URLEncoder.encode(password, StandardCharsets.UTF_8); }
    HttpRequest request(String path, String cookie, String token, String body, String contentType) {
        var builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(15));
        if (cookie != null) builder.header("Cookie", cookie);
        if (token != null) builder.header("X-CSRF-TOKEN", token);
        return body == null ? builder.GET().build() : builder.header("Content-Type", contentType).POST(HttpRequest.BodyPublishers.ofString(body)).build();
    }
    HttpResponse<String> get(String path, String cookie) throws Exception { return http.send(request(path, cookie, null, null, null), HttpResponse.BodyHandlers.ofString()); }
    HttpResponse<String> post(String path, String cookie, String token, String body, String contentType) throws Exception {
        var result = http.send(request(path, cookie, token, body, contentType), HttpResponse.BodyHandlers.ofString());
        if (path.equals("/api/auth/password")) {
            assertEquals("no-store", result.headers().firstValue("Cache-Control").orElseThrow());
            var response = SimpleResponse.Builder.status(result.statusCode());
            if (!result.body().isEmpty()) response.withBody(result.body()).withHeader("Content-Type", result.headers().firstValue("Content-Type").orElse(""));
            var validation = contract.validateResponse(path, Request.Method.POST, response.build());
            assertFalse(validation.hasErrors(), validation.getMessages().toString());
        }
        return result;
    }
}
