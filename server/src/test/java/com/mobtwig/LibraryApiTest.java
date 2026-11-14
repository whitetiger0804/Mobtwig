package com.mobtwig;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
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

/** 전용 MySQL과 실제 회원 세션으로 서재의 소유권·공개 범위·정렬·응답 계약을 검증합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=false"
})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class LibraryApiTest {
    private static final String PATH = "/api/members/library";
    private static final Instant BASE = Instant.parse("2026-01-02T03:04:05Z");
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;
    @Autowired ObjectMapper mapper;
    final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    final List<String> sessions = new ArrayList<>();

    @BeforeEach void fixtures() {
        cleanup();
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM book", Long.class));
        var hash = passwords.encode("TestPass19");
        jdbc.update("""
                INSERT INTO member(id,email,nickname,password_hash,role,status) VALUES
                (-11901,'library-a@example.test','library-a',?,'USER','ACTIVE'),
                (-11902,'library-b@example.test','library-b',?,'USER','ACTIVE')
                """, hash, hash);
        String[] types = {"BOOK", "WEBNOVEL", "MAGAZINE"};
        for (int i = 1; i <= 22; i++) {
            jdbc.update("INSERT INTO book(id,content_type,slug,title,cover_image_url,publish_status) VALUES(?,?,?,?,?,'PUBLISHED')",
                    -11900 - i, types[(i - 1) % 3], slug(i), "서재 " + i, "/media/covers/서재 " + i + ".png");
        }
    }

    @AfterEach void cleanup() {
        var database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertTrue(database != null && (database.equals("mobtwig_ci") || database.matches("[A-Za-z0-9_]+_test")));
        for (String session : sessions) jdbc.update("DELETE FROM SPRING_SESSION WHERE SESSION_ID=?", session);
        sessions.clear();
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME IN ('-11901','-11902')");
        jdbc.update("DELETE FROM library_book WHERE book_id BETWEEN -11922 AND -11901");
        jdbc.update("DELETE FROM book WHERE id BETWEEN -11922 AND -11901");
        jdbc.update("DELETE FROM member WHERE id IN (-11901,-11902)");
    }

    @Test void listsOwnLibraryWithStatusesNewestFirstAndFiltersKinds() throws Exception {
        String a = login("a");
        assertEquals(0, ok(get(PATH, a)).size());
        add(-11901, 1, "READING", 0);
        add(-11901, 2, "COMPLETED", 60);
        add(-11901, 3, "WANT_TO_READ", 60);
        var response = get(PATH, a);
        var items = ok(response);
        contract(response);
        Files.writeString(Path.of("target/library-contract.json"), response.body());
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        assertEquals(List.of(slug(3), slug(2), slug(1)), ids(items));
        assertEquals(List.of("id", "title", "imageUrl", "kind", "libraryStatus"), items.get(0).propertyNames().stream().toList());
        assertEquals(List.of("WANT_TO_READ", "COMPLETED", "READING"),
                items.valueStream().map(w -> w.get("libraryStatus").asString()).toList());
        assertEquals("/media/covers/서재 3.png", items.get(0).get("imageUrl").asString());
        assertEquals(items, ok(get(PATH + "?kind=all", a)));
        for (String[] pair : new String[][]{{"book", slug(1)}, {"novel", slug(2)}, {"magazine", slug(3)}}) {
            var filtered = ok(get(PATH + "?kind=" + pair[0], a));
            assertEquals(List.of(pair[1]), ids(filtered));
            assertEquals(pair[0], filtered.get(0).get("kind").asString());
        }
        assertEquals(0, ok(get(PATH, login("b"))).size());
    }

    @Test void returnsAllMatchesWithoutChangingLibraryOrOtherReadingRecords() throws Exception {
        for (int i = 1; i <= 22; i++) add(-11901, i, "READING", i);
        String a = login("a");
        var before = jdbc.queryForList("SELECT * FROM library_book WHERE member_id=-11901 ORDER BY id");
        var items = ok(get(PATH, a));
        assertEquals(22, items.size());
        assertEquals(slug(22), items.get(0).get("id").asString());
        assertEquals(slug(1), items.get(21).get("id").asString());
        ok(get(PATH + "?kind=book", a));
        assertEquals(before, jdbc.queryForList("SELECT * FROM library_book WHERE member_id=-11901 ORDER BY id"));
        assertEquals(0L, jdbc.queryForObject("SELECT COALESCE(SUM(view_count),0) FROM book", Long.class));
        for (String table : List.of("reading_progress", "recent_view")) {
            assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE member_id=-11901", Long.class));
        }
    }

    @Test void excludesHiddenAndNonPublicWorksButPreservesRowsAndFavorites() throws Exception {
        for (int i = 1; i <= 4; i++) add(-11901, i, "READING", i);
        jdbc.update("UPDATE library_book SET is_favorite=TRUE WHERE member_id=-11901 AND book_id=-11901");
        jdbc.update("UPDATE library_book SET is_hidden=TRUE WHERE member_id=-11901 AND book_id=-11902");
        jdbc.update("UPDATE book SET publish_status='HIDDEN' WHERE id=-11903");
        jdbc.update("UPDATE book SET publish_status='DRAFT' WHERE id=-11904");
        String a = login("a");
        assertEquals(List.of(slug(1)), ids(ok(get(PATH, a))));
        assertEquals(4L, jdbc.queryForObject("SELECT COUNT(*) FROM library_book WHERE member_id=-11901", Long.class));
        jdbc.update("UPDATE book SET publish_status='PUBLISHED' WHERE id=-11903");
        assertEquals(List.of(slug(3), slug(1)), ids(ok(get(PATH, a))));
    }

    @Test void usesOnlyAuthenticatedActiveMemberAndRejectsInvalidKinds() throws Exception {
        assertEquals(401, get(PATH, null).statusCode());
        String a = login("a");
        add(-11902, 1, "READING", 0);
        assertEquals(0, ok(get(PATH + "?memberId=-11902", a)).size());
        for (String query : List.of("kind", "kind=", "kind=%20", "kind=other", "kind=Book", "kind=book&kind=novel", "kind=book&kind=book")) {
            assertEquals(400, get(PATH + "?" + query, a).statusCode(), query);
        }
        jdbc.update("UPDATE member SET status='SUSPENDED' WHERE id=-11901");
        assertEquals(401, get(PATH, a).statusCode());
    }

    @Test void rejectsInvalidPublicMetadataWithoutSilentlyOmittingWorks() throws Exception {
        add(-11901, 1, "READING", 0);
        String a = login("a");
        jdbc.update("UPDATE book SET cover_image_url=NULL WHERE id=-11901");
        assertEquals(500, get(PATH, a).statusCode());
        assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM library_book WHERE member_id=-11901", Long.class));
    }

    private static String slug(int i) { return "library-" + i; }
    private void add(long member, int book, String status, int seconds) {
        jdbc.update("INSERT INTO library_book(member_id,book_id,status,created_at) VALUES(?,?,?,?)",
                member, -11900 - book, status, Timestamp.from(BASE.plusSeconds(seconds)));
    }
    private static List<String> ids(JsonNode items) { return items.valueStream().map(w -> w.get("id").asString()).toList(); }
    private String login(String account) throws Exception {
        var anonymous = get("/api/auth/csrf", null);
        String cookie = cookie(anonymous);
        String token = ok(anonymous).get("token").asString();
        var request = base("/api/auth/login").header("Cookie", cookie).header("X-CSRF-TOKEN", token)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("email=library-" + account + "%40example.test&password=TestPass19")).build();
        var result = http.send(request, HttpResponse.BodyHandlers.ofString());
        assertEquals(204, result.statusCode());
        return cookie(result);
    }
    private String cookie(HttpResponse<String> response) {
        String header = response.headers().allValues("Set-Cookie").stream().filter(v -> v.startsWith("MEMBER_SESSION=")).findFirst().orElseThrow();
        String cookie = header.substring(0, header.indexOf(';'));
        String session = new String(Base64.getDecoder().decode(cookie.substring("MEMBER_SESSION=".length())), StandardCharsets.UTF_8);
        sessions.add(session);
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
    private HttpRequest.Builder base(String path) {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(12));
    }
    private HttpResponse<String> get(String path, String cookie) throws Exception {
        var builder = base(path);
        if (cookie != null) builder.header("Cookie", cookie);
        return http.send(builder.GET().build(), HttpResponse.BodyHandlers.ofString());
    }
}
