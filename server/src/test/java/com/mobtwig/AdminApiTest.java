package com.mobtwig;

import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ContextConfiguration;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.*;

/** 시험용 MySQL과 실제 HTTP 요청으로 관리자 인증·등록·공개를 검증합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=false"
})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class AdminApiTest {
    private static final String PASSWORD = "admin-test-only-password-2026";
    private final List<Browser> browsers = new ArrayList<>();
    private final List<Long> authorIds = new ArrayList<>();
    @Value("${local.server.port}") private int port;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private ObjectMapper mapper;
    @Autowired private PasswordEncoder passwords;

    @BeforeEach
    void prepare() {
        cleanup();
        assertEquals(0L, count("SELECT COUNT(*) FROM book"), "다른 작품이 있는 DB에서는 시험을 중단합니다.");
        String encoded = passwords.encode(PASSWORD);
        jdbc.update("""
                INSERT INTO member(id,email,password_hash,nickname,role,status) VALUES
                (-9801,'admin-test-root@example.test',?,'admin-test-root','ADMIN','ACTIVE'),
                (-9802,'admin-test-user@example.test',?,'admin-test-user','USER','ACTIVE'),
                (-9803,'admin-test-suspended@example.test',?,'admin-test-suspended','ADMIN','SUSPENDED')
                """, encoded, encoded, encoded);
    }

    @AfterEach
    void cleanup() {
        String database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertTrue(database != null && (database.equals("mobtwig_ci") || database.matches("[A-Za-z0-9_]+_test")));
        for (Browser browser : browsers) {
            browser.cookies.getCookieStore().getCookies().stream()
                    .filter(cookie -> cookie.getName().equals("SESSION"))
                    .forEach(cookie -> jdbc.update("DELETE FROM SPRING_SESSION WHERE SESSION_ID=?",
                            new String(Base64.getDecoder().decode(cookie.getValue()), StandardCharsets.UTF_8)));
        }
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME IN (SELECT CAST(id AS CHAR) FROM member WHERE email LIKE 'admin-test-%')");
        for (String table : List.of("book_stat_daily", "board", "book_author", "book_genre", "book_category", "chapter")) {
            jdbc.update("DELETE FROM " + table + " WHERE book_id IN (SELECT id FROM book WHERE slug LIKE 'admin-test-%')");
        }
        jdbc.update("DELETE FROM book WHERE slug LIKE 'admin-test-%'");
        for (long id : authorIds) { jdbc.update("DELETE FROM author WHERE id=?", id); }
        jdbc.update("DELETE FROM author WHERE name LIKE 'admin-test-%'");
        jdbc.update("DELETE FROM genre WHERE name LIKE 'admin-test-%'");
        jdbc.update("DELETE FROM category WHERE name LIKE 'admin-test-%'");
        jdbc.update("DELETE FROM member_reading_setting WHERE member_id IN (SELECT id FROM member WHERE email LIKE 'admin-test-%')");
        jdbc.update("DELETE FROM member WHERE email LIKE 'admin-test-%'");
        browsers.clear();
        authorIds.clear();
    }

    @Test
    void servesThePageAndStaticAssetsWithoutCredentials() throws Exception {
        Browser browser = browser();
        var page = browser.get("/admin");
        assertEquals(200, page.statusCode());
        assertTrue(page.body().contains("/admin/admin.js"));
        assertFalse(page.body().contains(PASSWORD));
        assertTrue(page.headers().firstValue("Content-Security-Policy").orElse("").contains("frame-ancestors 'none'"));
        assertEquals(200, browser.get("/admin/admin.css").statusCode());
        assertEquals(200, browser.get("/admin/admin.js").statusCode());
        assertEquals(401, browser.get("/api/admin/catalog").statusCode());
        assertEquals(401, browser.post("/api/admin/authors", Map.of("name", "admin-test-author")).statusCode());
        assertEquals(403, browser.send("/api/admin/login", "POST", "username=none&password=none",
                "application/x-www-form-urlencoded", false).statusCode());
    }

    @Test
    void requiresCsrfAndInvalidatesTheSessionOnLogout() throws Exception {
        Browser browser = admin();
        assertEquals(200, browser.get("/api/admin/session").statusCode());
        assertEquals(403, browser.send("/api/admin/authors", "POST", "{\"name\":\"admin-test-author\"}",
                "application/json", false).statusCode());
        assertEquals(204, browser.post("/api/admin/logout", Map.of()).statusCode());
        assertEquals(401, browser.get("/api/admin/session").statusCode());
        assertEquals(401, browser.post("/api/admin/authors", Map.of("name", "admin-test-author")).statusCode());
    }

    @Test
    void rejectsWrongPasswordsSuspendedAccountsAndNonAdminAccounts() throws Exception {
        Browser browser = browser();
        assertEquals(401, browser.login("admin-test-root@example.test", "wrong-password").statusCode());
        assertEquals(401, browser.login("admin-test-root@example.test", "가".repeat(40)).statusCode());
        assertEquals(401, browser.login("admin-test-suspended@example.test", PASSWORD).statusCode());
        assertEquals(204, browser.login("admin-test-user@example.test", PASSWORD).statusCode());
        assertEquals(403, browser.get("/api/admin/catalog").statusCode());
        assertEquals(403, browser.post("/api/admin/accounts", Map.of(
                "email", "admin-test-fake@example.test", "nickname", "admin-test-fake", "password", PASSWORD)).statusCode());
    }

    @ParameterizedTest
    @ValueSource(strings = {"USER", "SUSPENDED"})
    void rechecksDatabasePermissionForExistingSessions(String revoked) throws Exception {
        Browser browser = admin();
        jdbc.update("UPDATE member SET " + (revoked.equals("USER") ? "role" : "status") + "=? WHERE id=-9801", revoked);
        assertEquals(403, browser.get("/api/admin/catalog").statusCode());
        assertEquals(403, browser.post("/api/admin/authors", Map.of("name", "admin-test-denied")).statusCode());
    }

    @ParameterizedTest
    @ValueSource(strings = {"book", "magazine", "novel"})
    void registersDatabaseRelationsAndReflectsPublishingInPublicApis(String kind) throws Exception {
        Browser browser = admin();
        Map<String, Object> work = work(browser, kind);
        var created = browser.post("/api/admin/works", work);
        assertEquals(201, created.statusCode(), created.body());
        long id = ((Number) object(created).get("id")).longValue();
        assertEquals(1L, count("SELECT COUNT(*) FROM board WHERE type='WORK' AND book_id=" + id));
        assertEquals(1L, count("SELECT COUNT(*) FROM book WHERE id=" + id + " AND submitted_by_member_id IS NULL AND view_count=0"));
        assertEquals(1L, count("SELECT COUNT(*) FROM book_author WHERE book_id=" + id));
        assertEquals(1L, count("SELECT COUNT(*) FROM book_genre WHERE book_id=" + id));
        assertEquals(1L, count("SELECT COUNT(*) FROM book_category WHERE book_id=" + id));
        String slug = (String) work.get("slug");
        var detail = browser.get("/works/" + slug);
        assertEquals(200, detail.statusCode(), detail.body());
        assertEquals(kind, object(detail).get("kind"));
        assertEquals("관리자 등록 작품", object(detail).get("title"));
        assertEquals(1, ((List<?>) object(detail).get("contents")).size());
        var home = browser.get("/sdui/home?kind=" + kind);
        assertEquals(200, home.statusCode());
        assertTrue(home.body().contains(slug));
        assertEquals(204, browser.post("/api/admin/works/" + id + "/status", Map.of("publishStatus", "PUBLISHED")).statusCode());
        assertEquals(1L, count("SELECT COUNT(*) FROM board WHERE book_id=" + id));
        assertEquals(204, browser.post("/api/admin/works/" + id + "/status", Map.of("publishStatus", "HIDDEN")).statusCode());
        assertEquals(404, browser.get("/works/" + slug).statusCode());
        assertFalse(browser.get("/sdui/home?kind=all").body().contains(slug));
        assertEquals(204, browser.post("/api/admin/works/" + id + "/status", Map.of("publishStatus", "PUBLISHED")).statusCode());
        assertEquals(1L, count("SELECT COUNT(*) FROM board WHERE book_id=" + id));
    }

    @Test
    void keepsDraftsPrivateAndAddsChaptersWithoutLosingExistingData() throws Exception {
        Browser browser = admin();
        var work = work(browser, "book");
        work.put("publishStatus", "DRAFT");
        var created = browser.post("/api/admin/works", work);
        assertEquals(201, created.statusCode(), created.body());
        long id = ((Number) object(created).get("id")).longValue();
        assertEquals(404, browser.get("/works/" + work.get("slug")).statusCode());
        assertEquals(0L, count("SELECT COUNT(*) FROM board WHERE book_id=" + id));
        var next = new HashMap<>(chapter(2));
        next.put("publishedAt", "2035-01-01T00:00:00Z");
        assertEquals(201, browser.post("/api/admin/works/" + id + "/chapters", next).statusCode());
        assertEquals(204, browser.post("/api/admin/works/" + id + "/status", Map.of("publishStatus", "PUBLISHED")).statusCode());
        assertEquals(2L, count("SELECT COUNT(*) FROM chapter WHERE book_id=" + id));
        var detail = object(browser.get("/works/" + work.get("slug")));
        assertEquals(1, ((List<?>) detail.get("contents")).size());
        assertEquals(400, browser.post("/api/admin/works/" + id + "/chapters", chapter(2)).statusCode());
        assertEquals(2L, count("SELECT COUNT(*) FROM chapter WHERE book_id=" + id));
    }

    @ParameterizedTest
    @ValueSource(strings = {"author", "classification", "chapter", "body", "image", "blank", "duplicate-relation", "text-bytes", "magazine-pages", "relation-name", "timestamp"})
    void rejectsInvalidInputWithoutCreatingPartialWorks(String failure) throws Exception {
        Browser browser = admin();
        var work = work(browser, failure.equals("magazine-pages") ? "magazine" : "book");
        switch (failure) {
            case "author" -> work.put("authorIds", List.of(Long.MAX_VALUE));
            case "classification" -> { work.put("genreIds", List.of()); work.put("categoryIds", List.of()); }
            case "chapter" -> work.put("chapters", List.of());
            case "body" -> work.put("chapters", List.of(Map.of("chapterNo", 1, "title", "회차", "publishedAt", "2000-01-01T00:00:00Z", "characterCount", 10)));
            case "image" -> work.put("imageUrl", "javascript:alert(1)");
            case "blank" -> work.put("title", "\u00A0\uFEFF");
            case "duplicate-relation" -> work.put("authorIds", List.of(((List<?>) work.get("authorIds")).getFirst(), ((List<?>) work.get("authorIds")).getFirst()));
            case "text-bytes" -> work.put("description", "가".repeat(22000));
            case "magazine-pages" -> work.put("chapters", List.of(chapter(1), chapter(2)));
            case "relation-name" -> jdbc.update("UPDATE author SET name=' ' WHERE id=?", ((List<?>) work.get("authorIds")).getFirst());
            case "timestamp" -> {
                var invalid = new HashMap<>(chapter(1));
                invalid.put("publishedAt", "2999-01-01T00:00:00Z");
                work.put("chapters", List.of(invalid));
            }
            default -> throw new IllegalArgumentException(failure);
        }
        var result = browser.post("/api/admin/works", work);
        assertEquals(400, result.statusCode(), result.body());
        assertEquals(0L, count("SELECT COUNT(*) FROM book"));
        assertEquals(0L, count("SELECT COUNT(*) FROM chapter"));
        assertEquals(0L, count("SELECT COUNT(*) FROM book_author"));
    }

    @Test
    void rejectsDuplicatesAndDoesNotAcceptClientStatistics() throws Exception {
        Browser browser = admin();
        var work = work(browser, "book");
        work.put("viewCount", 100000);
        work.put("averageRating", 5);
        assertEquals(201, browser.post("/api/admin/works", work).statusCode());
        assertEquals(409, browser.post("/api/admin/works", work).statusCode());
        assertEquals(1L, count("SELECT COUNT(*) FROM book"));
        assertEquals(1L, count("SELECT COUNT(*) FROM chapter"));
        assertEquals(0L, count("SELECT SUM(view_count) FROM book"));
        assertEquals(409, browser.post("/api/admin/genres", Map.of("name", "admin-test-genre", "displayOrder", 0)).statusCode());
    }

    @Test
    void createsAllowedAccountsWithHashesAndDatabaseBackedSessions() throws Exception {
        Browser browser = admin();
        String email = "admin-test-teammate@" + "a".repeat(50) + "." + "b".repeat(50) + ".example.test";
        assertTrue(email.length() > 100);
        var input = Map.of("email", email, "nickname", "admin-test-teammate", "password", PASSWORD);
        var created = browser.post("/api/admin/accounts", input);
        assertEquals(201, created.statusCode(), created.body());
        long id = ((Number) object(created).get("id")).longValue();
        String encoded = jdbc.queryForObject("SELECT password_hash FROM member WHERE id=?", String.class, id);
        assertNotEquals(PASSWORD, encoded);
        assertTrue(passwords.matches(PASSWORD, encoded));
        assertEquals(1L, count("SELECT COUNT(*) FROM member_reading_setting WHERE member_id=" + id));
        Browser teammate = browser();
        var login = teammate.login(input.get("email"), PASSWORD);
        assertEquals(204, login.statusCode());
        String cookies = String.join(";", login.headers().allValues("Set-Cookie"));
        assertTrue(cookies.contains("HttpOnly"));
        assertTrue(cookies.contains("SameSite=Strict"));
        assertEquals(200, teammate.get("/api/admin/catalog").statusCode());
        assertFalse(teammate.get("/api/admin/session").body().contains("password"));
        assertTrue(count("SELECT COUNT(*) FROM SPRING_SESSION WHERE PRINCIPAL_NAME='" + id + "'") > 0);
        assertEquals(409, browser.post("/api/admin/accounts", input).statusCode());
        assertEquals(400, browser.post("/api/admin/accounts", Map.of("email", "admin-test-bad@localhost", "nickname", "admin-test-bad", "password", PASSWORD)).statusCode());
        assertEquals(400, browser.post("/api/admin/accounts", Map.of("email", "admin-test-bad@example.test", "nickname", "admin-test-bad", "password", "가".repeat(30))).statusCode());
    }

    private Map<String, Object> work(Browser browser, String kind) throws Exception {
        long author = createdId(browser.post("/api/admin/authors", Map.of("name", "admin-test-author")));
        authorIds.add(author);
        long genre = createdId(browser.post("/api/admin/genres", Map.of("name", "admin-test-genre", "displayOrder", 0)));
        long category = createdId(browser.post("/api/admin/categories", Map.of("name", "admin-test-category", "displayOrder", 0)));
        var work = new HashMap<String, Object>();
        work.putAll(Map.of("kind", kind, "slug", "admin-test-work", "title", "관리자 등록 작품",
                "description", "DB에 저장하는 한글 소개입니다.", "imageUrl", "https://example.test/cover.png",
                "publishedAt", "2026-01-01", "publisher", "검증 출판사", "fileFormat", "CUSTOM", "serialStatus", "ONGOING"));
        work.putAll(Map.of("publishStatus", "PUBLISHED", "authorIds", List.of(author), "genreIds", List.of(genre),
                "categoryIds", List.of(category), "chapters", List.of(chapter(1)), "pageCount", 100));
        return work;
    }

    private Map<String, Object> chapter(int number) {
        return Map.of("chapterNo", number, "title", "등록 회차 " + number,
                "publishedAt", "2000-01-01T00:00:00Z", "characterCount", 120,
                "contentUrl", "https://example.test/chapter.html", "pageNumber", 1);
    }

    private long createdId(HttpResponse<String> response) throws Exception {
        assertEquals(201, response.statusCode(), response.body());
        return ((Number) object(response).get("id")).longValue();
    }

    private Browser admin() throws Exception {
        Browser browser = browser();
        assertEquals(204, browser.login("admin-test-root@example.test", PASSWORD).statusCode());
        return browser;
    }

    private Browser browser() {
        Browser browser = new Browser();
        browsers.add(browser);
        return browser;
    }

    private long count(String sql) { return jdbc.queryForObject(sql, Long.class); }

    @SuppressWarnings("unchecked")
    private Map<String, Object> object(HttpResponse<String> response) throws Exception {
        return mapper.readValue(response.body(), Map.class);
    }

    private final class Browser {
        private final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        private final HttpClient client = HttpClient.newBuilder().cookieHandler(cookies)
                .connectTimeout(Duration.ofSeconds(5)).build();

        HttpResponse<String> get(String path) throws Exception { return send(path, "GET", "", "application/json", false); }

        HttpResponse<String> post(String path, Object body) throws Exception {
            return send(path, "POST", mapper.writeValueAsString(body), "application/json", true);
        }

        HttpResponse<String> login(String email, String password) throws Exception {
            return send("/api/admin/login", "POST", "username=" + URLEncoder.encode(email, StandardCharsets.UTF_8)
                    + "&password=" + URLEncoder.encode(password, StandardCharsets.UTF_8),
                    "application/x-www-form-urlencoded", true);
        }

        HttpResponse<String> send(String path, String method, String body, String contentType, boolean csrf) throws Exception {
            var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                    .timeout(Duration.ofSeconds(15)).header("Content-Type", contentType);
            if (csrf) {
                var token = object(get("/api/admin/csrf"));
                request.header((String) token.get("headerName"), (String) token.get("token"));
            }
            request.method(method, method.equals("GET") ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
            return client.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        }
    }
}
