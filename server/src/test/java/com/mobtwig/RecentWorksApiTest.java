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
import java.util.Base64;
import java.util.List;
import java.util.Objects;
import com.atlassian.oai.validator.OpenApiInteractionValidator;
import com.atlassian.oai.validator.model.Request;
import com.atlassian.oai.validator.model.SimpleResponse;
import org.junit.jupiter.api.*;
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

/** 전용 MySQL에서 실제 회원 세션·CSRF로 최근 본 작품의 순서·제한·공개 범위를 검증합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=false"
})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class RecentWorksApiTest {
    private static final String PATH = "/api/members/recent-works";
    private static final Instant BASE = Instant.parse("2026-01-02T03:04:05Z");
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;
    @Autowired ObjectMapper mapper;
    final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    final List<String> sessions = new ArrayList<>();

    @BeforeEach void fixtures() {
        cleanup();
        var hash = passwords.encode("TestPass19");
        jdbc.update("""
                INSERT INTO member(id,email,nickname,password_hash,role,status) VALUES
                (-9401,'recent-a@example.test','recent-a',?,'USER','ACTIVE'),
                (-9402,'recent-b@example.test','recent-b',?,'USER','ACTIVE')
                """, hash, hash);
        String[] types = {"BOOK", "WEBNOVEL", "MAGAZINE"};
        for (int i = 1; i <= 22; i++) {
            jdbc.update("INSERT INTO book(id,content_type,slug,title,cover_image_url,publish_status) VALUES(?,?,?,?,?,'PUBLISHED')",
                    -9400 - i, types[(i - 1) % 3], slug(i), "최근 " + i, "/media/covers/recent-" + i + ".png");
        }
        jdbc.update("""
                INSERT INTO book(id,content_type,slug,title,cover_image_url,publish_status)
                VALUES(-9430,'BOOK','recent-hidden','숨김','/media/covers/hidden.png','HIDDEN')
                """);
    }

    @AfterEach void cleanup() {
        var database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertTrue(database != null && (database.equals("mobtwig_ci") || database.matches("[A-Za-z0-9_]+_test")));
        for (String id : sessions) jdbc.update("DELETE FROM SPRING_SESSION WHERE SESSION_ID=?", id);
        jdbc.update("DELETE FROM recent_view WHERE book_id BETWEEN -9430 AND -9401 OR member_id IN (-9401,-9402)");
        jdbc.update("DELETE FROM book WHERE id BETWEEN -9430 AND -9401");
        jdbc.update("DELETE FROM member WHERE id IN (-9401,-9402)");
    }

    @Test void listsRecentWorksNewestFirstInClientShape() throws Exception {
        var a = login("a");
        assertEquals(0, ok(get(PATH, a)).size());
        view(-9401, 1, 0);
        view(-9401, 2, 30);
        view(-9401, 3, 60);
        var response = get(PATH, a);
        var works = ok(response);
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        contract(response);
        assertEquals(List.of(slug(3), slug(2), slug(1)), ids(works));
        assertEquals(List.of("magazine", "novel", "book"), works.valueStream().map(w -> w.get("kind").asString()).toList());
        var first = works.get(0);
        assertEquals(List.of("id", "title", "imageUrl", "kind", "lastReadAt"), first.propertyNames().stream().toList());
        assertEquals("최근 3", first.get("title").asString());
        assertEquals("/media/covers/recent-3.png", first.get("imageUrl").asString());
        // jdbc로 넣은 UTC 시각이 변환 없이 그대로 반환되어야 합니다.
        assertEquals(BASE.plusSeconds(60).toString(), first.get("lastReadAt").asString());
        assertEquals("2026-01-02T03:04:05Z", works.get(2).get("lastReadAt").asString());
        assertEquals(0, ok(get(PATH, login("b"))).size());
    }

    @Test void returnsOnlyTwentyMostRecent() throws Exception {
        for (int i = 1; i <= 22; i++) view(-9401, i, i);
        var works = ok(get(PATH, login("a")));
        assertEquals(20, works.size());
        assertEquals(slug(22), works.get(0).get("id").asString());
        assertEquals(slug(3), works.get(19).get("id").asString());
        assertFalse(ids(works).contains(slug(1)));
        assertFalse(ids(works).contains(slug(2)));
    }

    @Test void excludesNonPublicWorks() throws Exception {
        view(-9401, 1, 0);
        jdbc.update("INSERT INTO recent_view(member_id,book_id,last_viewed_at) VALUES(-9401,-9430,?)", Timestamp.from(BASE.plusSeconds(99)));
        var works = ok(get(PATH, login("a")));
        assertEquals(List.of(slug(1)), ids(works));
        assertEquals(2L, rows(-9401));
    }

    @Test void reopeningMovesWorkToFrontWithoutDuplicates() throws Exception {
        view(-9401, 1, 0);
        view(-9401, 2, 30);
        view(-9401, 3, 60);
        var a = login("a");
        var reopened = post(slug(1), a, true);
        assertEquals(204, reopened.statusCode(), reopened.body());
        assertEquals("", reopened.body());
        assertEquals("no-store", reopened.headers().firstValue("Cache-Control").orElseThrow());
        var works = ok(get(PATH, a));
        assertEquals(List.of(slug(1), slug(3), slug(2)), ids(works));
        assertTrue(Instant.parse(works.get(0).get("lastReadAt").asString()).isAfter(BASE.plusSeconds(60)));
        assertEquals(3L, rows(-9401));
        assertEquals(204, post(slug(4), a, true).statusCode());
        assertEquals(4L, rows(-9401));
        assertEquals(slug(4), ok(get(PATH, a)).get(0).get("id").asString());
        assertEquals(0L, jdbc.queryForObject("SELECT COALESCE(SUM(view_count),0) FROM book WHERE id BETWEEN -9430 AND -9401", Long.class));
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM reading_progress WHERE member_id=-9401", Long.class));
    }

    @Test void rejectsInvalidPublicMetadataWithoutDroppingTheHistory() throws Exception {
        var member = login("a");
        view(-9401, 1, 0);
        for (String image : new String[]{null, "https://example.test:65536/cover.png"}) {
            jdbc.update("UPDATE book SET cover_image_url=? WHERE id=-9401", image);
            assertEquals(500, get(PATH, member).statusCode());
            assertEquals(1L, rows(-9401));
        }
    }

    @Test void requiresActiveMemberSession() throws Exception {
        var anonymous = get(PATH, null);
        assertEquals(401, anonymous.statusCode());
        assertEquals("", anonymous.body());
        var csrf = get("/api/auth/csrf", null);
        var session = new Session(capture(csrf), ok(csrf).get("token").asString());
        assertEquals(401, post(slug(1), session, true).statusCode());
        assertEquals(0L, rows(-9401));
    }

    @Test void rejectsPostWithoutCsrf() throws Exception {
        var a = login("a");
        assertEquals(403, post(slug(1), a, false).statusCode());
        assertEquals(0L, rows(-9401));
    }

    @Test void rejectsUnknownHiddenOrMalformedSlug() throws Exception {
        var a = login("a");
        assertError(post("recent-missing", a, true), 404, "NOT_FOUND");
        assertError(post("recent-hidden", a, true), 404, "NOT_FOUND");
        assertError(post("Bad_Slug", a, true), 400, "INVALID_SLUG");
        assertEquals(0L, rows(-9401));
    }

    private static String slug(int i) { return "recent-" + i; }
    private void view(long member, int book, int seconds) {
        jdbc.update("INSERT INTO recent_view(member_id,book_id,last_viewed_at) VALUES(?,?,?)", member, -9400 - book,
                Timestamp.from(BASE.plusSeconds(seconds)));
    }
    private long rows(long member) { return Objects.requireNonNull(jdbc.queryForObject("SELECT COUNT(*) FROM recent_view WHERE member_id=?", Long.class, member)); }
    private static List<String> ids(JsonNode works) { return works.valueStream().map(w -> w.get("id").asString()).toList(); }
    private Session login(String account) throws Exception {
        var anonymous = get("/api/auth/csrf", null);
        var cookie = capture(anonymous);
        var token = ok(anonymous).get("token").asString();
        var login = base("/api/auth/login").header("Cookie", cookie).header("X-CSRF-TOKEN", token)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("email=recent-" + account + "%40example.test&password=TestPass19")).build();
        var result = send(login);
        assertEquals(204, result.statusCode());
        var auth = capture(result);
        var refreshed = ok(get("/api/auth/csrf", new Session(auth, null)));
        return new Session(auth, refreshed.get("token").asString());
    }
    private String capture(HttpResponse<String> response) {
        var header = response.headers().allValues("Set-Cookie").stream().filter(v -> v.startsWith("MEMBER_SESSION=")).findFirst().orElseThrow();
        String cookie = header.substring(0, header.indexOf(';'));
        sessions.add(new String(Base64.getDecoder().decode(cookie.substring("MEMBER_SESSION=".length())), StandardCharsets.UTF_8));
        return cookie;
    }
    private JsonNode ok(HttpResponse<String> response) {
        assertEquals(200, response.statusCode(), response.body());
        return mapper.readTree(response.body());
    }
    private void contract(HttpResponse<String> response) throws Exception {
        String spec = new ClassPathResource("static/openapi.yaml").getContentAsString(Objects.requireNonNull(StandardCharsets.UTF_8));
        var report = OpenApiInteractionValidator.createForInlineApiSpecification(spec).build().validateResponse(PATH, Request.Method.GET,
                SimpleResponse.Builder.ok().withContentType("application/json").withBody(response.body()).build());
        assertFalse(report.hasErrors(), () -> report.getMessages().toString());
    }
    private void assertError(HttpResponse<String> response, int status, String code) {
        assertEquals(status, response.statusCode(), response.body());
        assertEquals(code, mapper.readTree(response.body()).get("code").asString());
    }
    private HttpRequest.Builder base(String path) {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(12));
    }
    private HttpResponse<String> get(String path, Session session) throws Exception {
        var builder = base(path);
        if (session != null) builder.header("Cookie", session.cookie());
        return send(builder.GET().build());
    }
    private HttpResponse<String> post(String slug, Session session, boolean csrf) throws Exception {
        var builder = base(PATH + "/" + slug).header("Cookie", session.cookie());
        if (csrf) builder.header("X-CSRF-TOKEN", session.token());
        return send(builder.POST(HttpRequest.BodyPublishers.noBody()).build());
    }
    private HttpResponse<String> send(HttpRequest request) throws Exception { return http.send(request, HttpResponse.BodyHandlers.ofString()); }
    private record Session(String cookie, String token) { }
}
