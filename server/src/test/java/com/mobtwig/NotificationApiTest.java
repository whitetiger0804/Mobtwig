package com.mobtwig;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import com.atlassian.oai.validator.OpenApiInteractionValidator;
import com.atlassian.oai.validator.model.Request;
import com.atlassian.oai.validator.model.SimpleResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ContextConfiguration;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

/** 실제 HTTP와 전용 MySQL로 가입 환영 알림, 목록 제한·정렬과 읽음 처리 권한을 확인합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=false",
        "mobtwig.auth.signup-demo-enabled=true"
})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class NotificationApiTest {
    private static final String LIST = "/api/members/notifications";
    private static final String PASSWORD = "TestPass22";
    private static final String MEMBERS = "-12201,-12202";
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired PasswordEncoder passwords;
    final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    final List<String> emails = new ArrayList<>();
    record Session(String cookie, String csrf) { }

    @BeforeEach void seed() {
        cleanup();
        var hash = passwords.encode(PASSWORD);
        jdbc.update("""
                INSERT INTO member(id,email,nickname,password_hash,role,status) VALUES
                (-12201,'notification-a@example.test','알림 하나',?,'USER','ACTIVE'),
                (-12202,'notification-b@example.test','알림 둘',?,'USER','ACTIVE')
                """, hash, hash);
    }

    @AfterEach void cleanup() {
        var database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertTrue(database != null && (database.equals("mobtwig_ci") || database.matches("[A-Za-z0-9_]+_test")));
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME IN ('-12201','-12202')");
        jdbc.update("DELETE FROM notification WHERE member_id IN (" + MEMBERS + ")");
        jdbc.update("DELETE FROM member WHERE id IN (" + MEMBERS + ")");
        for (String email : emails) {
            jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME IN (SELECT CAST(id AS CHAR) FROM member WHERE email=?)", email);
            jdbc.update("DELETE FROM notification WHERE member_id IN (SELECT id FROM member WHERE email=?)", email);
            jdbc.update("DELETE FROM member_policy_consent WHERE member_id IN (SELECT id FROM member WHERE email=?)", email);
            jdbc.update("DELETE FROM member_reading_setting WHERE member_id IN (SELECT id FROM member WHERE email=?)", email);
            jdbc.update("DELETE FROM member WHERE email=?", email);
        }
        emails.clear();
    }

    @Test void signupCreatesOneUnreadWelcomeNotice() throws Exception {
        String email = "notification-signup-" + UUID.randomUUID().toString().substring(0, 12) + "@example.test";
        emails.add(email);
        var anonymous = csrf(null);
        var created = send(base("/api/auth/signup").header("Cookie", anonymous.cookie())
                .header("X-CSRF-TOKEN", anonymous.csrf()).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(signupInput(email)))).build());
        assertEquals(201, created.statusCode(), created.body());
        var body = json(get(LIST, login(email)), 200);
        assertEquals(1, body.get("unreadCount").asLong());
        assertEquals(1, body.get("items").size());
        var item = body.get("items").get(0);
        assertEquals("notice", item.get("type").asString());
        assertEquals("모북이에 오신 것을 환영합니다", item.get("title").asString());
        assertFalse(item.get("message").asString().isBlank());
        assertTrue(item.get("readAt").isNull());
    }

    @Test void memberWithoutNotificationsGetsEmptyList() throws Exception {
        var response = get(LIST, login("notification-a@example.test"));
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        var body = json(response, 200);
        assertEquals(0, body.get("unreadCount").asLong());
        assertTrue(body.get("items").isArray());
        assertEquals(0, body.get("items").size());
        contract(LIST, response);
    }

    @Test void returnsLatestFiftyInCreatedAtThenIdOrder() throws Exception {
        var base = Instant.parse("2026-01-01T00:00:00Z");
        // 같은 시각을 두 건씩 두어 ID 내림차순 보조 정렬을 확인합니다.
        for (int i = 0; i < 55; i++) insert(-12201, "알림 " + i, base.plusSeconds(i / 2), null);
        insert(-12201, "읽은 알림", base.plusSeconds(100), base.plusSeconds(101));
        var body = json(get(LIST, login("notification-a@example.test")), 200);
        assertEquals(55, body.get("unreadCount").asLong());
        var items = body.get("items");
        assertEquals(50, items.size());
        assertEquals("읽은 알림", items.get(0).get("title").asString());
        var expected = jdbc.queryForList("""
                SELECT id FROM notification WHERE member_id=-12201 ORDER BY created_at DESC, id DESC LIMIT 50
                """, Long.class);
        for (int i = 0; i < 50; i++) {
            assertEquals(expected.get(i).toString(), items.get(i).get("id").asString());
            if (i > 0) {
                var previous = Instant.parse(items.get(i - 1).get("createdAt").asString());
                var current = Instant.parse(items.get(i).get("createdAt").asString());
                assertFalse(current.isAfter(previous));
                if (current.equals(previous)) {
                    assertTrue(Long.parseLong(items.get(i).get("id").asString()) < Long.parseLong(items.get(i - 1).get("id").asString()));
                }
            }
        }
    }

    @Test void markReadSetsReadAtAndDecrementsUnread() throws Exception {
        long first = insert(-12201, "첫 알림", Instant.parse("2026-01-01T00:00:00Z"), null);
        insert(-12201, "둘째 알림", Instant.parse("2026-01-02T00:00:00Z"), null);
        var session = login("notification-a@example.test");
        assertEquals(2, json(get(LIST, session), 200).get("unreadCount").asLong());
        var before = Instant.now().minusSeconds(2);
        var read = patch(first, session);
        assertEquals(204, read.statusCode());
        assertEquals("", read.body());
        assertEquals("no-store", read.headers().firstValue("Cache-Control").orElseThrow());
        var body = json(get(LIST, session), 200);
        assertEquals(1, body.get("unreadCount").asLong());
        var item = find(body, first);
        var readAt = Instant.parse(item.get("readAt").asString());
        assertTrue(item.get("readAt").asString().endsWith("Z"));
        assertTrue(!readAt.isBefore(before) && !readAt.isAfter(Instant.now().plusSeconds(2)));
    }

    @Test void repeatedReadIsIdempotent204() throws Exception {
        long id = insert(-12201, "읽을 알림", Instant.parse("2026-01-01T00:00:00Z"), null);
        var session = login("notification-a@example.test");
        assertEquals(204, patch(id, session).statusCode());
        var stored = readAt(id);
        assertNotNull(stored);
        Thread.sleep(1100);
        assertEquals(204, patch(id, session).statusCode());
        assertEquals(stored, readAt(id));
        assertEquals(0, json(get(LIST, session), 200).get("unreadCount").asLong());
    }

    @Test void otherMembersNotificationIs404() throws Exception {
        long other = insert(-12202, "다른 회원 알림", Instant.parse("2026-01-01T00:00:00Z"), null);
        var response = patch(other, login("notification-a@example.test"));
        assertEquals(404, response.statusCode());
        assertEquals("알림을 찾을 수 없습니다.", json(response, 404).get("message").asString());
        assertNull(readAt(other));
    }

    @Test void unknownIdIs404() throws Exception {
        var response = patch(Long.MAX_VALUE, login("notification-a@example.test"));
        assertEquals(404, response.statusCode());
        assertTrue(json(response, 404).has("message"));
    }

    @Test void malformedIdIs400() throws Exception {
        var session = login("notification-a@example.test");
        for (String id : List.of("abc", "0", "01", "9223372036854775808", "1.0")) {
            var response = send(mutation("/api/members/notifications/" + id + "/read", session.cookie(), session.csrf()));
            assertEquals(400, response.statusCode(), id);
            assertEquals("알림 요청 값이 올바르지 않습니다.", json(response, 400).get("message").asString());
        }
    }

    @Test void unauthenticatedIs401WithoutBody() throws Exception {
        long id = insert(-12201, "알림", Instant.parse("2026-01-01T00:00:00Z"), null);
        var list = get(LIST);
        assertEquals(401, list.statusCode());
        assertEquals("", list.body());
        var withoutCsrf = send(mutation("/api/members/notifications/" + id + "/read", null, null));
        assertEquals(401, withoutCsrf.statusCode());
        assertEquals("", withoutCsrf.body());
        var anonymous = csrf(null);
        var withCsrf = send(mutation("/api/members/notifications/" + id + "/read", anonymous.cookie(), anonymous.csrf()));
        assertEquals(401, withCsrf.statusCode());
        assertEquals("", withCsrf.body());
        assertNull(readAt(id));
    }

    @Test void missingCsrfIs403() throws Exception {
        long id = insert(-12201, "알림", Instant.parse("2026-01-01T00:00:00Z"), null);
        var session = login("notification-a@example.test");
        var response = send(mutation("/api/members/notifications/" + id + "/read", session.cookie(), null));
        assertEquals(403, response.statusCode());
        assertEquals("", response.body());
        assertNull(readAt(id));
    }

    @Test void responseMatchesClientParserRules() throws Exception {
        long read = insert(-12201, "읽은 알림", Instant.parse("2026-01-01T00:00:00Z"), Instant.parse("2026-01-01T01:00:00Z"));
        jdbc.update("INSERT INTO notification(member_id,type,title,message,created_at) VALUES (-12201,'COMMENT','댓글','',?)",
                Timestamp.from(Instant.parse("2026-01-02T00:00:00Z")));
        var response = get(LIST, login("notification-a@example.test"));
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        contract(LIST, response);
        var body = json(response, 200);
        assertEquals(Set.of("unreadCount", "items"), names(body));
        assertTrue(body.get("unreadCount").isIntegralNumber() && body.get("unreadCount").asLong() >= 0);
        for (var item : body.get("items")) {
            assertEquals(Set.of("id", "type", "title", "message", "createdAt", "readAt"), names(item));
            assertTrue(item.get("id").isString() && item.get("id").asString().matches("-?[1-9][0-9]*"));
            assertTrue(Set.of("notice", "comment", "work", "event").contains(item.get("type").asString()));
            assertTrue(item.get("title").isString() && !item.get("title").asString().isBlank());
            assertTrue(item.get("message").isString());
            Instant.parse(item.get("createdAt").asString());
            assertTrue(item.get("readAt").isNull() || item.get("readAt").isString());
            if (item.get("readAt").isString()) Instant.parse(item.get("readAt").asString());
        }
        assertEquals("comment", body.get("items").get(0).get("type").asString());
        assertEquals("", body.get("items").get(0).get("message").asString());
        assertEquals("2026-01-01T01:00:00Z", find(body, read).get("readAt").asString());
        assertEquals("2026-01-01T00:00:00Z", find(body, read).get("createdAt").asString());
    }

    private long insert(long member, String title, Instant createdAt, Instant readAt) {
        jdbc.update("INSERT INTO notification(member_id,type,title,message,created_at,read_at) VALUES (?,'NOTICE',?,'본문',?,?)",
                member, title, Timestamp.from(createdAt), readAt == null ? null : Timestamp.from(readAt));
        return jdbc.queryForObject("SELECT MAX(id) FROM notification WHERE member_id=?", Long.class, member);
    }

    private Timestamp readAt(long id) {
        return jdbc.queryForObject("SELECT read_at FROM notification WHERE id=?", Timestamp.class, id);
    }

    private JsonNode find(JsonNode body, long id) {
        for (var item : body.get("items")) if (item.get("id").asString().equals(Long.toString(id))) return item;
        throw new AssertionError("알림 " + id + "이 목록에 없습니다.");
    }

    private static Set<String> names(JsonNode node) {
        var names = new java.util.HashSet<String>();
        node.propertyNames().forEach(names::add);
        return names;
    }

    private Map<String, Object> signupInput(String email) throws Exception {
        var terms = json(get("/api/auth/terms"), 200).get("documents");
        var consents = new ArrayList<Map<String, Object>>();
        for (var doc : terms) {
            consents.add(new LinkedHashMap<>(Map.of("kind", doc.get("kind").asString(), "version", doc.get("version").asString(),
                    "contentHash", doc.get("contentHash").asString(), "agreed", true)));
        }
        return new LinkedHashMap<>(Map.of("email", email, "nickname", "알림-" + UUID.randomUUID().toString().substring(0, 8),
                "password", PASSWORD, "passwordConfirmation", PASSWORD, "consents", consents));
    }

    private Session csrf(String cookie) throws Exception {
        var request = base("/api/auth/csrf");
        if (cookie != null) request.header("Cookie", cookie);
        var response = send(request.GET().build());
        String next = cookie == null ? cookie(response) : cookie;
        return new Session(next, json(response, 200).get("token").asString());
    }

    private Session login(String email) throws Exception {
        var anonymous = csrf(null);
        var login = send(base("/api/auth/login").header("Cookie", anonymous.cookie()).header("X-CSRF-TOKEN", anonymous.csrf())
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("email=" + java.net.URLEncoder.encode(email, StandardCharsets.UTF_8)
                        + "&password=" + PASSWORD)).build());
        assertEquals(204, login.statusCode());
        return csrf(cookie(login));
    }

    private static String cookie(HttpResponse<String> response) {
        return response.headers().allValues("Set-Cookie").stream().filter(value -> value.startsWith("MEMBER_SESSION="))
                .map(value -> value.substring(0, value.indexOf(';'))).findFirst().orElseThrow();
    }

    private HttpResponse<String> patch(long id, Session session) throws Exception {
        return send(mutation("/api/members/notifications/" + id + "/read", session.cookie(), session.csrf()));
    }

    private HttpRequest mutation(String path, String cookie, String token) {
        var request = base(path);
        if (cookie != null) request.header("Cookie", cookie);
        if (token != null) request.header("X-CSRF-TOKEN", token);
        return request.method("PATCH", HttpRequest.BodyPublishers.noBody()).build();
    }

    private HttpRequest.Builder base(String path) {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(15));
    }

    private HttpResponse<String> get(String path) throws Exception { return send(base(path).GET().build()); }
    private HttpResponse<String> get(String path, Session session) throws Exception {
        return send(base(path).header("Cookie", session.cookie()).GET().build());
    }
    private HttpResponse<String> send(HttpRequest request) throws Exception { return http.send(request, HttpResponse.BodyHandlers.ofString()); }

    private JsonNode json(HttpResponse<String> response, int status) {
        assertEquals(status, response.statusCode(), response.body());
        return mapper.readTree(response.body());
    }

    private static void contract(String path, HttpResponse<String> response) throws Exception {
        var spec = new ClassPathResource("static/openapi.yaml").getContentAsString(StandardCharsets.UTF_8);
        var report = OpenApiInteractionValidator.createForInlineApiSpecification(spec).build().validateResponse(path, Request.Method.GET,
                SimpleResponse.Builder.status(response.statusCode()).withContentType("application/json")
                        .withHeader("Cache-Control", "no-store").withBody(response.body()).build());
        assertFalse(report.hasErrors(), () -> report.getMessages().toString());
    }
}
