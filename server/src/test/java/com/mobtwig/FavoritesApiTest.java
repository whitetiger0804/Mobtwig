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
import java.util.concurrent.CompletableFuture;
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

/** 전용 MySQL에서 실제 회원 세션·CSRF로 찜 목록·추가·해제·상태와 wishlist_count 캐시를 검증합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=false"
})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class FavoritesApiTest {
    private static final String PATH = "/api/members/favorites";
    private static final Instant BASE = Instant.parse("2026-01-02T03:04:05Z");
    private static final int BOOKS = 22;
    private static final long HIDDEN = -9799;
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
                (-9761,'favorite-a@example.test','favorite-a',?,'USER','ACTIVE'),
                (-9762,'favorite-b@example.test','favorite-b',?,'USER','ACTIVE')
                """, hash, hash);
        // 저자 ID 순서(-9772 < -9771)대로 연결되는지 확인하려고 이름과 ID 순서를 엇갈리게 둡니다.
        jdbc.update("INSERT INTO author(id,name) VALUES(-9772,'첫 저자'),(-9771,'둘째 저자')");
        String[] types = {"BOOK", "WEBNOVEL", "MAGAZINE"};
        for (int i = 1; i <= BOOKS; i++) {
            jdbc.update("INSERT INTO book(id,content_type,slug,title,cover_image_url,publish_status) VALUES(?,?,?,?,?,'PUBLISHED')",
                    book(i), types[(i - 1) % 3], slug(i), "찜 " + i, "/media/covers/favorite-" + i + ".png");
            jdbc.update("INSERT INTO book_author(book_id,author_id) VALUES(?,-9771)", book(i));
        }
        jdbc.update("INSERT INTO book_author(book_id,author_id) VALUES(?,-9772)", book(1));
        jdbc.update("""
                INSERT INTO book(id,content_type,slug,title,cover_image_url,publish_status)
                VALUES(?,'BOOK','favorite-hidden','숨김','/media/covers/hidden.png','HIDDEN')
                """, HIDDEN);
        jdbc.update("INSERT INTO book_author(book_id,author_id) VALUES(?,-9771)", HIDDEN);
    }

    @AfterEach void cleanup() {
        var database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertTrue(database != null && (database.equals("mobtwig_ci") || database.matches("[A-Za-z0-9_]+_test")));
        for (String id : sessions) jdbc.update("DELETE FROM SPRING_SESSION WHERE SESSION_ID=?", id);
        jdbc.update("DELETE FROM wishlist WHERE book_id BETWEEN -9799 AND -9771 OR member_id IN (-9761,-9762)");
        jdbc.update("DELETE FROM book_author WHERE book_id BETWEEN -9799 AND -9771 OR author_id IN (-9771,-9772)");
        jdbc.update("DELETE FROM book WHERE id BETWEEN -9799 AND -9771");
        jdbc.update("DELETE FROM author WHERE id IN (-9771,-9772)");
        jdbc.update("DELETE FROM member WHERE id IN (-9761,-9762)");
    }

    @Test void listsNewestFirstInClientShape() throws Exception {
        favorite(-9761, 1, 0);
        favorite(-9761, 2, 30);
        favorite(-9761, 3, 30);
        favorite(-9761, 4, 60);
        var response = get(PATH, login("a"));
        var works = ok(response);
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        contract(response);
        // 같은 created_at(2, 3)은 나중에 넣은 찜 ID가 앞입니다.
        assertEquals(List.of(slug(4), slug(3), slug(2), slug(1)), ids(works));
        assertEquals(List.of("book", "magazine", "novel", "book"), works.valueStream().map(w -> w.get("kind").asString()).toList());
        var last = works.get(3);
        assertEquals(List.of("id", "kind", "title", "author", "imageUrl"), last.propertyNames().stream().toList());
        assertEquals("찜 1", last.get("title").asString());
        assertEquals("첫 저자, 둘째 저자", last.get("author").asString());
        assertEquals("/media/covers/favorite-1.png", last.get("imageUrl").asString());
        assertEquals("둘째 저자", works.get(0).get("author").asString());
    }

    @Test void returnsEmptyArrayWithoutFavorites() throws Exception {
        var response = get(PATH, login("a"));
        assertEquals("[]", response.body());
        assertEquals(200, response.statusCode());
    }

    @Test void returnsAllWithoutLimit() throws Exception {
        for (int i = 1; i <= BOOKS; i++) favorite(-9761, i, i);
        var works = ok(get(PATH, login("a")));
        assertEquals(BOOKS, works.size());
        assertEquals(slug(BOOKS), works.get(0).get("id").asString());
        assertEquals(slug(1), works.get(BOOKS - 1).get("id").asString());
    }

    @Test void excludesNonPublicWorksButKeepsRecords() throws Exception {
        favorite(-9761, 1, 0);
        jdbc.update("INSERT INTO wishlist(member_id,book_id,created_at) VALUES(-9761,?,?)", HIDDEN, Timestamp.from(BASE.plusSeconds(99)));
        assertEquals(List.of(slug(1)), ids(ok(get(PATH, login("a")))));
        assertEquals(2L, rows(-9761));
    }

    @Test void rejectsInvalidPublicMetadataWithoutDroppingTheRecord() throws Exception {
        var member = login("a");
        favorite(-9761, 1, 0);
        jdbc.update("UPDATE book SET cover_image_url=NULL WHERE id=?", book(1));
        assertEquals(500, get(PATH, member).statusCode());
        jdbc.update("UPDATE book SET cover_image_url='/media/covers/favorite-1.png' WHERE id=?", book(1));
        jdbc.update("UPDATE author SET name=' ' WHERE id=-9772");
        assertEquals(500, get(PATH, member).statusCode());
        jdbc.update("DELETE FROM book_author WHERE book_id=?", book(1));
        assertEquals(500, get(PATH, member).statusCode());
        assertEquals(1L, rows(-9761));
    }

    @Test void addIncrementsCountOnlyOnce() throws Exception {
        var a = login("a");
        var added = write("POST", slug(1), a, true);
        assertEquals(204, added.statusCode(), added.body());
        assertEquals("", added.body());
        assertEquals("no-store", added.headers().firstValue("Cache-Control").orElseThrow());
        assertEquals(1L, rows(-9761));
        assertEquals(1, count(1));
        assertEquals(204, write("POST", slug(1), a, true).statusCode());
        assertEquals(1L, rows(-9761));
        assertEquals(1, count(1));
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM library_book WHERE member_id=-9761", Long.class));
    }

    @Test void concurrentAddsIncrementCountOnce() throws Exception {
        var a = login("a");
        var requests = new ArrayList<CompletableFuture<HttpResponse<String>>>();
        for (int i = 0; i < 2; i++) requests.add(http.sendAsync(writeRequest("POST", slug(1), a, true), HttpResponse.BodyHandlers.ofString()));
        for (var request : requests) assertEquals(204, request.get().statusCode());
        assertEquals(1L, rows(-9761));
        assertEquals(1, count(1));
    }

    @Test void removeDecrementsCountOnlyOnce() throws Exception {
        var a = login("a");
        var b = login("b");
        assertEquals(204, write("POST", slug(1), a, true).statusCode());
        assertEquals(204, write("POST", slug(1), b, true).statusCode());
        assertEquals(2, count(1));
        var removed = write("DELETE", slug(1), a, true);
        assertEquals(204, removed.statusCode(), removed.body());
        assertEquals("", removed.body());
        assertEquals("no-store", removed.headers().firstValue("Cache-Control").orElseThrow());
        assertEquals(0L, rows(-9761));
        assertEquals(1, count(1));
        assertEquals(204, write("DELETE", slug(1), a, true).statusCode());
        assertEquals(1, count(1));
        assertEquals(204, write("DELETE", slug(2), a, true).statusCode());
        assertEquals(0, count(2));
        assertEquals(1L, rows(-9762));
    }

    @Test void reportsStatus() throws Exception {
        var a = login("a");
        var before = get(PATH + "/" + slug(1), a);
        assertEquals("no-store", before.headers().firstValue("Cache-Control").orElseThrow());
        var body = ok(before);
        assertEquals(List.of("favorite"), body.propertyNames().stream().toList());
        assertFalse(body.get("favorite").asBoolean());
        assertEquals(204, write("POST", slug(1), a, true).statusCode());
        assertTrue(ok(get(PATH + "/" + slug(1), a)).get("favorite").asBoolean());
        assertEquals(204, write("DELETE", slug(1), a, true).statusCode());
        assertFalse(ok(get(PATH + "/" + slug(1), a)).get("favorite").asBoolean());
    }

    @Test void requiresActiveMemberSession() throws Exception {
        for (String path : List.of(PATH, PATH + "/" + slug(1))) {
            var anonymous = get(path, null);
            assertEquals(401, anonymous.statusCode());
            assertEquals("", anonymous.body());
        }
        var csrf = get("/api/auth/csrf", null);
        var session = new Session(capture(csrf), ok(csrf).get("token").asString());
        assertEquals(401, write("POST", slug(1), session, true).statusCode());
        assertEquals(401, write("DELETE", slug(1), session, true).statusCode());
        var a = login("a");
        jdbc.update("UPDATE member SET status='SUSPENDED' WHERE id=-9761");
        assertEquals(401, write("POST", slug(1), a, true).statusCode());
        assertEquals(0L, rows(-9761));
        assertEquals(0, count(1));
    }

    @Test void rejectsWritesWithoutCsrf() throws Exception {
        var a = login("a");
        assertEquals(403, write("POST", slug(1), a, false).statusCode());
        favorite(-9761, 2, 0);
        jdbc.update("UPDATE book SET wishlist_count=1 WHERE id=?", book(2));
        assertEquals(403, write("DELETE", slug(2), a, false).statusCode());
        assertEquals(1L, rows(-9761));
        assertEquals(0, count(1));
        assertEquals(1, count(2));
    }

    @Test void rejectsMalformedSlug() throws Exception {
        var a = login("a");
        for (String slug : List.of("Bad_Slug", "a".repeat(121))) {
            assertError(get(PATH + "/" + slug, a), 400, "INVALID_SLUG");
            assertError(write("POST", slug, a, true), 400, "INVALID_SLUG");
            assertError(write("DELETE", slug, a, true), 400, "INVALID_SLUG");
        }
        assertEquals(0L, rows(-9761));
    }

    @Test void rejectsUnknownOrHiddenWork() throws Exception {
        var a = login("a");
        jdbc.update("INSERT INTO wishlist(member_id,book_id) VALUES(-9761,?)", HIDDEN);
        jdbc.update("UPDATE book SET wishlist_count=1 WHERE id=?", HIDDEN);
        for (String slug : List.of("favorite-missing", "favorite-hidden")) {
            assertError(get(PATH + "/" + slug, a), 404, "NOT_FOUND");
            assertError(write("POST", slug, a, true), 404, "NOT_FOUND");
            assertError(write("DELETE", slug, a, true), 404, "NOT_FOUND");
        }
        assertEquals(1L, rows(-9761));
        assertEquals(1, jdbc.queryForObject("SELECT wishlist_count FROM book WHERE id=?", Integer.class, HIDDEN));
    }

    @Test void isolatesMembers() throws Exception {
        var a = login("a");
        var b = login("b");
        assertEquals(204, write("POST", slug(1), a, true).statusCode());
        assertEquals("[]", get(PATH, b).body());
        assertFalse(ok(get(PATH + "/" + slug(1), b)).get("favorite").asBoolean());
        assertEquals(204, write("DELETE", slug(1), b, true).statusCode());
        assertEquals(1L, rows(-9761));
        assertEquals(1, count(1));
        assertEquals(List.of(slug(1)), ids(ok(get(PATH, a))));
    }

    private static long book(int i) { return -9770 - i; }
    private static String slug(int i) { return "favorite-" + i; }
    private void favorite(long member, int book, int seconds) {
        jdbc.update("INSERT INTO wishlist(member_id,book_id,created_at) VALUES(?,?,?)", member, book(book),
                Timestamp.from(BASE.plusSeconds(seconds)));
    }
    private long rows(long member) { return Objects.requireNonNull(jdbc.queryForObject("SELECT COUNT(*) FROM wishlist WHERE member_id=?", Long.class, member)); }
    private int count(int book) { return Objects.requireNonNull(jdbc.queryForObject("SELECT wishlist_count FROM book WHERE id=?", Integer.class, book(book))); }
    private static List<String> ids(JsonNode works) { return works.valueStream().map(w -> w.get("id").asString()).toList(); }
    private Session login(String account) throws Exception {
        var anonymous = get("/api/auth/csrf", null);
        var cookie = capture(anonymous);
        var token = ok(anonymous).get("token").asString();
        var login = base("/api/auth/login").header("Cookie", cookie).header("X-CSRF-TOKEN", token)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("email=favorite-" + account + "%40example.test&password=TestPass19")).build();
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
    private HttpRequest writeRequest(String method, String slug, Session session, boolean csrf) {
        var builder = base(PATH + "/" + slug).header("Cookie", session.cookie());
        if (csrf) builder.header("X-CSRF-TOKEN", session.token());
        return builder.method(method, HttpRequest.BodyPublishers.noBody()).build();
    }
    private HttpResponse<String> write(String method, String slug, Session session, boolean csrf) throws Exception {
        return send(writeRequest(method, slug, session, csrf));
    }
    private HttpResponse<String> send(HttpRequest request) throws Exception { return http.send(request, HttpResponse.BodyHandlers.ofString()); }
    private record Session(String cookie, String token) { }
}
