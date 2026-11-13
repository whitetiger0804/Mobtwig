package com.mobtwig;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import com.atlassian.oai.validator.OpenApiInteractionValidator;
import com.atlassian.oai.validator.model.Request;
import com.atlassian.oai.validator.model.SimpleResponse;
import com.mobtwig.reader.ReadingProgressRepository;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.doAnswer;

/** 전용 MySQL에서 실제 회원 세션·CSRF·revision·원자성을 검증합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=false",
        "mobtwig.reader.content-root=./target/reading-progress-content"
})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class ReadingProgressApiTest {
    private static final String TEXT = "progress-text";
    private static final String MAG = "progress-mag-one";
    private static final String MAG_TWO = "progress-mag-two";
    private static final Path CONTENT = Path.of("target/reading-progress-content");
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;
    @Autowired ObjectMapper mapper;
    @MockitoSpyBean ReadingProgressRepository repository;
    final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    final List<String> sessions = new ArrayList<>();

    @BeforeEach void fixtures() throws Exception {
        cleanup();
        Files.createDirectories(CONTENT);
        Files.writeString(CONTENT.resolve("first.txt"), "A😀B");
        Files.writeString(CONTENT.resolve("second.txt"), "끝장");
        Files.writeString(CONTENT.resolve("empty.txt"), "");
        var hash = passwords.encode("TestPass19");
        jdbc.update("""
                INSERT INTO member(id,email,nickname,password_hash,role,status) VALUES
                (-9601,'progress-a@example.test','progress-a',?,'USER','ACTIVE'),
                (-9602,'progress-b@example.test','progress-b',?,'USER','ACTIVE')
                """, hash, hash);
        jdbc.update("""
                INSERT INTO book(id,content_type,slug,title,publish_status,page_count) VALUES
                (-9601,'WEBNOVEL','progress-text','텍스트','PUBLISHED',NULL),
                (-9602,'MAGAZINE','progress-mag-one','한 호','PUBLISHED',10),
                (-9603,'MAGAZINE','progress-mag-two','다른 호','PUBLISHED',NULL),
                (-9604,'BOOK','progress-hidden','숨김','HIDDEN',NULL),
                (-9605,'BOOK','progress-empty','빈 글','PUBLISHED',NULL),
                (-9606,'MAGAZINE','progress-one-page','한 쪽','PUBLISHED',1)
                """);
        insert(-9610, -9601, 2, true, null, "first.txt");
        insert(-9611, -9601, 4, false, null, "empty.txt");
        insert(-9609, -9601, 7, true, null, "second.txt");
        insert(-9620, -9602, 1, true, 1, null);
        insert(-9621, -9602, 3, true, 5, null);
        insert(-9622, -9602, 8, false, 9, null);
        insert(-9630, -9603, 1, true, 1, null);
        insert(-9640, -9604, 1, true, null, "first.txt");
        insert(-9650, -9605, 1, true, null, "empty.txt");
        insert(-9660, -9606, 1, true, 1, null);
    }

    @AfterEach void cleanup() {
        var database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertTrue(database != null && (database.equals("mobtwig_ci") || database.matches("[A-Za-z0-9_]+_test")));
        for (String id : sessions) jdbc.update("DELETE FROM SPRING_SESSION WHERE SESSION_ID=?", id);
        for (String table : List.of("bookmark", "reading_progress", "library_book", "chapter")) {
            jdbc.update("DELETE FROM " + table + " WHERE book_id BETWEEN -9606 AND -9601");
        }
        jdbc.update("DELETE FROM book WHERE id BETWEEN -9606 AND -9601");
        jdbc.update("DELETE FROM member WHERE id IN (-9601,-9602)");
    }

    @Test void privateGetAndSaveRestoreFromCanonicalTextAndKeepMaximumOnReread() throws Exception {
        assertEquals(401, get(path(TEXT), null).statusCode());
        var a = login("a");
        var b = login("b");
        var initial = get(path(TEXT), a);
        var before = ok(initial);
        contract(initial, Request.Method.GET);
        assertEquals("new", before.get("state").asString());
        assertEquals(0, before.get("position").get("offset").asInt());
        assertEquals(0L, count("reading_progress"));
        assertEquals(0L, count("library_book"));
        assertEquals(404, get(path("progress-hidden"), a).statusCode());
        var input = input(-9610, 3, 1, hash(TEXT, -9610), null);
        assertEquals(403, post(TEXT, a, input, false).statusCode());
        assertEquals(400, post(TEXT, a, input(-9610, 2, 1, hash(TEXT, -9610), null), true).statusCode());
        assertEquals(404, post(TEXT, a, input(-9620, 1, 1, null, null), true).statusCode());
        assertEquals(404, post(TEXT, a, input(-9611, 0, 1, null, null), true).statusCode());
        input.put("memberId", "-9602");
        assertEquals(400, post(TEXT, a, input, true).statusCode());
        input.remove("memberId");
        var firstResponse = post(TEXT, a, input, true);
        var first = ok(firstResponse);
        contract(firstResponse, Request.Method.POST);
        assertEquals("1", first.get("revision").asString());
        assertEquals(75.0, first.get("chapterPercent").asDouble());
        assertEquals(50.0, first.get("workPercent").asDouble());
        assertEquals(first, ok(get(path(TEXT), a)));
        assertEquals("new", ok(get(path(TEXT), b)).get("state").asString());
        jdbc.update("UPDATE library_book SET is_favorite=TRUE,is_hidden=TRUE WHERE member_id=-9601 AND book_id=-9601");
        var end = ok(post(TEXT, a, input(-9609, 2, 1, hash(TEXT, -9609), "1"), true));
        assertEquals("COMPLETED", end.get("libraryStatus").asString());
        insert(-9612, -9601, 9, true, null, "second.txt");
        var updated = ok(get(path(TEXT), a));
        assertTrue(updated.get("hasNewChapters").asBoolean());
        assertEquals("COMPLETED", updated.get("libraryStatus").asString());
        assertEquals(75.0, updated.get("workPercent").asDouble());
        var previous = ok(post(TEXT, a, input(-9610, 0, 1, hash(TEXT, -9610), "2"), true));
        assertEquals("READING", previous.get("libraryStatus").asString());
        assertEquals("-9609", previous.get("maxChapterId").asString());
        assertEquals(0.0, previous.get("workPercent").asDouble());
        assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM library_book WHERE member_id=-9601 AND book_id=-9601 AND is_favorite AND is_hidden", Long.class));
        assertEquals(0L, jdbc.queryForObject("SELECT view_count FROM book WHERE id=-9601", Long.class));
        var empty = ok(post("progress-empty", a, input(-9650, 0, 1, hash("progress-empty", -9650), null), true));
        assertTrue(empty.get("workPercent").isNull());
        assertEquals("READING", empty.get("libraryStatus").asString());
    }

    @Test void reportsLegacyAndChangedHashOrVersionWithoutUpdatingStoredCoordinates() throws Exception {
        var a = login("a");
        jdbc.update("INSERT INTO reading_progress(member_id,book_id,chapter_id,chapter_offset,content_version) VALUES(-9601,-9601,-9610,3,1)");
        var legacy = ok(get(path(TEXT), a));
        assertEquals("stale", legacy.get("state").asString());
        assertEquals("1", legacy.get("revision").asString());
        assertEquals(0, legacy.get("position").get("offset").asInt());
        String oldHash = hash(TEXT, -9610);
        ok(post(TEXT, a, input(-9610, 3, 1, oldHash, "1"), true));
        Files.writeString(CONTENT.resolve("first.txt"), "CD");
        assertEquals("stale", ok(get(path(TEXT), a)).get("state").asString());
        assertError(post(TEXT, a, input(-9610, 3, 1, oldHash, "2"), true), 409, "CONTENT_CHANGED");
        jdbc.update("UPDATE chapter SET content_version=2 WHERE id=-9610");
        assertError(post(TEXT, a, input(-9610, 0, 1, hash(TEXT, -9610), "2"), true), 409, "CONTENT_CHANGED");
        jdbc.update("UPDATE chapter SET published_at=NULL WHERE id=-9610");
        var missing = ok(get(path(TEXT), a));
        assertEquals("stale", missing.get("state").asString());
        assertEquals("-9609", missing.get("position").get("chapterId").asString());
        assertTrue(missing.get("maxChapterId").isNull());
        assertEquals(3, jdbc.queryForObject("SELECT chapter_offset FROM reading_progress WHERE member_id=-9601 AND book_id=-9601", Integer.class));
    }

    @Test void exactlyOneInitialAndOneSameRevisionSaveWins() throws Exception {
        var one = login("a");
        var two = login("a");
        String hash = hash(TEXT, -9610);
        for (String revision : new String[]{null, "1"}) {
            var a = http.sendAsync(write(TEXT, one, input(-9610, 0, 1, hash, revision), true), HttpResponse.BodyHandlers.ofString());
            var b = http.sendAsync(write(TEXT, two, input(-9610, 3, 1, hash, revision), true), HttpResponse.BodyHandlers.ofString());
            var results = List.of(a.get(15, TimeUnit.SECONDS), b.get(15, TimeUnit.SECONDS));
            assertEquals(List.of(200, 409), results.stream().map(HttpResponse::statusCode).sorted().toList());
            assertError(results.stream().filter(v -> v.statusCode() == 409).findFirst().orElseThrow(), 409, "PROGRESS_CONFLICT");
        }
        assertEquals(1L, count("reading_progress"));
        assertEquals(1L, count("library_book"));
        assertEquals("2", ok(get(path(TEXT), one)).get("revision").asString());
    }

    @Test void magazineIssuesAndUnpublishedPageBoundariesAreSeparate() throws Exception {
        var a = login("a");
        assertEquals(400, post(MAG, a, input(-9620, 5, 1, null, null), true).statusCode());
        assertEquals(400, post(MAG, a, input(-9621, 9, 1, null, null), true).statusCode());
        assertEquals(404, post(MAG, a, input(-9622, 9, 1, null, null), true).statusCode());
        assertEquals(404, post(MAG_TWO, a, input(-9621, 6, 1, null, null), true).statusCode());
        var saved = ok(post(MAG, a, input(-9621, 6, 1, null, null), true));
        assertEquals("page", saved.get("position").get("unit").asString());
        assertEquals(50.0, saved.get("chapterPercent").asDouble());
        assertEquals(60.0, saved.get("workPercent").asDouble());
        assertEquals("new", ok(get(path(MAG_TWO), a)).get("state").asString());
        var unknown = ok(post(MAG_TWO, a, input(-9630, 60, 1, null, null), true));
        assertTrue(unknown.get("chapterPercent").isNull());
        assertTrue(unknown.get("workPercent").isNull());
        var one = ok(post("progress-one-page", a, input(-9660, 1, 1, null, null), true));
        assertEquals(100.0, one.get("workPercent").asDouble());
        assertEquals("COMPLETED", one.get("libraryStatus").asString());
    }

    @Test void opensVerifiedPngAndRestoresSixthPageInAnotherSession() throws Exception {
        byte[] expected = registerPng(-9621, "issue-one/article-two", 6);
        registerPng(-9622, "issue-one/hidden", 9);
        registerPng(-9660, "issue-single/article-one", 1);
        var manifest = get("/works/" + MAG + "/magazine", null);
        var issue = ok(manifest);
        assertEquals("한 호", issue.get("title").asString());
        assertEquals(10, issue.get("pageCount").asInt());
        assertEquals(2, issue.get("articles").size());
        assertEquals(4, issue.get("articles").get(0).get("endPage").asInt());
        assertEquals(8, issue.get("articles").get(1).get("endPage").asInt());
        assertFalse(manifest.body().contains("-9622"));
        assertFalse(manifest.body().contains("issue-one"));
        assertEquals("no-store", manifest.headers().firstValue("Cache-Control").orElseThrow());
        contract("/works/" + MAG + "/magazine", manifest, Request.Method.GET);

        var loaded = http.send(base("/works/" + MAG + "/magazine/pages/6?contentVersion=1").GET().build(), HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(200, loaded.statusCode());
        assertArrayEquals(expected, loaded.body());
        assertEquals("image/png", loaded.headers().firstValue("Content-Type").orElseThrow());
        assertEquals("no-store", loaded.headers().firstValue("Cache-Control").orElseThrow());
        assertEquals(200, get("/works/progress-one-page/magazine/pages/1?contentVersion=1", null).statusCode());
        assertEquals(404, get("/works/" + MAG + "/magazine/pages/9?contentVersion=1", null).statusCode());
        assertEquals(404, get("/works/" + MAG + "/magazine/pages/11?contentVersion=1", null).statusCode());
        assertEquals(404, get("/works/" + TEXT + "/magazine", null).statusCode());
        assertEquals(404, get("/works/progress-hidden/magazine", null).statusCode());
        assertEquals(503, get("/works/" + MAG_TWO + "/magazine", null).statusCode());
        assertEquals(0L, jdbc.queryForObject("SELECT view_count FROM book WHERE id=-9602", Long.class));
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM reading_progress WHERE book_id=-9602", Long.class));

        var one = login("a");
        assertEquals("new", ok(get(path(MAG), one)).get("state").asString());
        var stored = ok(post(MAG, one, input(-9621, 6, 1, null, null), true));
        var two = login("a");
        assertEquals(stored, ok(get(path(MAG), two)));
        assertEquals("new", ok(get(path(MAG_TWO), two)).get("state").asString());
        assertEquals("new", ok(get(path(MAG), login("b"))).get("state").asString());
    }

    @Test void rejectsInvalidPageQueriesChangedVersionsAndLegacySources() throws Exception {
        registerPng(-9621, "issue-one/article-two", 6);
        String page = "/works/" + MAG + "/magazine/pages/";
        for (String invalid : List.of("0?contentVersion=1", "2147483648?contentVersion=1", "6", "6?contentVersion=0",
                "6?contentVersion=1&contentVersion=1", "6?contentVersion=1,2")) {
            assertEquals(400, get(page + invalid, null).statusCode(), invalid);
        }
        var a = login("a");
        ok(post(MAG, a, input(-9621, 6, 1, null, null), true));
        jdbc.update("UPDATE chapter SET content_version=2 WHERE id=-9621");
        assertEquals(409, get(page + "6?contentVersion=1", null).statusCode());
        assertEquals(200, get(page + "6?contentVersion=2", null).statusCode());
        assertEquals("stale", ok(get(path(MAG), a)).get("state").asString());
        assertEquals(6, jdbc.queryForObject("SELECT chapter_offset FROM reading_progress WHERE book_id=-9602", Integer.class));
        assertEquals(503, get(page + "7?contentVersion=2", null).statusCode());
        String legacy = "https://external.example/private.pdf";
        jdbc.update("UPDATE chapter SET content_url=? WHERE id=-9621", legacy);
        var unavailable = get(page + "6?contentVersion=2", null);
        assertEquals(503, unavailable.statusCode());
        assertFalse(unavailable.body().contains(legacy));
        assertEquals(legacy, jdbc.queryForObject("SELECT content_url FROM chapter WHERE id=-9621", String.class));
    }

    @Test void rollsBackTheRevisionAndLibraryWhenTheSecondWriteFails() throws Exception {
        var a = login("a");
        String hash = hash(TEXT, -9610);
        var prior = ok(post(TEXT, a, input(-9610, 0, 1, hash, null), true));
        doAnswer(call -> {
            call.callRealMethod();
            assertEquals(2L, jdbc.queryForObject("SELECT revision FROM reading_progress WHERE member_id=-9601 AND book_id=-9601", Long.class));
            throw new DataAccessResourceFailureException("test-only-library-failure");
        }).when(repository).storeLibrary(-9601, -9601, "COMPLETED");
        var failed = post(TEXT, a, input(-9609, 2, 1, hash(TEXT, -9609), "1"), true);
        assertEquals(500, failed.statusCode());
        assertFalse(failed.body().contains("test-only-library-failure"));
        assertEquals(prior, ok(get(path(TEXT), a)));
    }

    private void insert(long id, long book, int number, boolean visible, Integer start, String file) {
        jdbc.update("""
                INSERT INTO chapter(id,book_id,chapter_no,title,published_at,char_count,start_page,content_url)
                VALUES(?,?,?,?,?,999,?,?)
                """, id, book, number, "회차 " + number, visible ? "2000-01-01 00:00:00" : null, start, file == null ? null : "/content/" + file);
    }
    private long count(String table) { return jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE book_id=-9601", Long.class); }
    private String path(String slug) { return "/api/members/works/" + slug + "/reading-progress"; }
    private String hash(String slug, long chapter) throws Exception {
        return ok(get("/works/" + slug + "/chapters/" + chapter, null)).get("contentHash").asString();
    }
    private Map<String, Object> input(long chapter, int offset, int version, String hash, String revision) {
        var map = new LinkedHashMap<String, Object>();
        map.put("chapterId", Long.toString(chapter)); map.put("offset", offset); map.put("contentVersion", version);
        map.put("contentHash", hash); map.put("expectedRevision", revision);
        return map;
    }
    private Session login(String account) throws Exception {
        var anonymous = get("/api/auth/csrf", null);
        var cookie = capture(anonymous);
        var token = ok(anonymous).get("token").asString();
        var login = base("/api/auth/login").header("Cookie", cookie).header("X-CSRF-TOKEN", token)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("email=progress-" + account + "%40example.test&password=TestPass19")).build();
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
    @Test void bookmarksArePrivateIdempotentAndHideUnpublishedMetadata() throws Exception {
        String root = "/api/members/bookmarks";
        assertEquals(401, get(root, null).statusCode());
        var a = login("a");
        var b = login("b");
        var input = new LinkedHashMap<String, Object>();
        input.put("workId", TEXT);
        input.put("chapterId", "-9610");
        input.put("offset", 0);
        input.put("contentVersion", 1);
        input.put("contentHash", hash(TEXT, -9610));
        assertEquals(403, bookmarkWrite(root, a, input, false).statusCode());
        input.put("offset", 2);
        assertEquals(400, bookmarkWrite(root, a, input, true).statusCode());
        input.put("offset", 3);
        assertEquals(400, bookmarkWrite(root, a, input, true).statusCode());
        input.put("offset", 0);
        var response = bookmarkWrite(root, a, input, true);
        var saved = ok(response);
        contract(root, response, Request.Method.POST);
        assertEquals("A😀B", saved.get("snippet").asString());
        assertEquals(saved, ok(bookmarkWrite(root, a, input, true)));
        assertEquals(1L, count("bookmark"));
        assertEquals(0L, count("reading_progress"));
        assertEquals(0L, count("library_book"));
        assertEquals(0, ok(get(root, b)).get("items").size());
        assertEquals(0, ok(get(root + "?workId=" + MAG, a)).get("items").size());
        assertEquals(saved, ok(get(root + "?workId=" + TEXT, a)).get("items").get(0));
        String uri = root + "/" + saved.get("id").asString();
        assertEquals(403, bookmarkWrite(uri, a, null, false).statusCode());
        assertEquals(404, bookmarkWrite(uri, b, null, true).statusCode());

        Files.writeString(CONTENT.resolve("first.txt"), "바뀐 글");
        assertEquals(409, bookmarkWrite(root, a, input, true).statusCode());
        input.put("contentHash", hash(TEXT, -9610));
        var stale = ok(bookmarkWrite(root, a, input, true));
        assertEquals(saved.get("id"), stale.get("id"));
        assertEquals("stale", stale.get("state").asString());
        assertTrue(stale.get("snippet").isNull());
        jdbc.update("UPDATE chapter SET published_at=NULL WHERE id=-9610");
        var hidden = ok(get(root, a)).get("items").get(0);
        assertEquals("hidden", hidden.get("state").asString());
        for (String field : List.of("workId", "workTitle", "kind", "chapterTitle", "position", "snippet")) assertTrue(hidden.get(field).isNull());
        assertEquals(204, bookmarkWrite(uri, a, null, true).statusCode());
        assertEquals(404, bookmarkWrite(uri, a, null, true).statusCode());
    }

    @Test void magazineBookmarksRespectIssueBoundariesAndPageSize() throws Exception {
        String root = "/api/members/bookmarks";
        var a = login("a");
        var input = new LinkedHashMap<String, Object>();
        input.put("workId", MAG);
        input.put("chapterId", "-9621");
        input.put("offset", 9);
        input.put("contentVersion", 1);
        input.put("contentHash", null);
        assertEquals(400, bookmarkWrite(root, a, input, true).statusCode());
        input.put("offset", 6);
        var saved = ok(bookmarkWrite(root, a, input, true));
        assertEquals("page", saved.get("position").get("unit").asString());
        assertTrue(saved.get("snippet").isNull());
        input.put("workId", MAG_TWO);
        assertEquals(404, bookmarkWrite(root, a, input, true).statusCode());
        for (int page = 1; page <= 31; page++) {
            jdbc.update("INSERT INTO bookmark(member_id,book_id,chapter_id,chapter_offset,content_version) VALUES(-9601,-9603,-9630,?,1)", page);
        }
        var first = ok(get(root + "?workId=" + MAG_TWO, a));
        assertEquals(30, first.get("items").size());
        assertTrue(first.get("hasNext").asBoolean());
        assertEquals(31, first.get("items").get(0).get("position").get("offset").asInt());
        var second = ok(get(root + "?workId=" + MAG_TWO + "&page=2", a));
        assertEquals(1, second.get("items").size());
        assertEquals(1, second.get("items").get(0).get("position").get("offset").asInt());
        assertFalse(second.get("hasNext").asBoolean());
    }

    private HttpResponse<String> bookmarkWrite(String path, Session session, Map<String, Object> input, boolean csrf) throws Exception {
        var builder = base(path).header("Cookie", session.cookie());
        if (csrf) builder.header("X-CSRF-TOKEN", session.token());
        return send(input == null ? builder.DELETE().build() : builder.header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(input))).build());
    }

    private void contract(HttpResponse<String> response, Request.Method method) throws Exception {
        contract(path(TEXT), response, method);
    }
    private void contract(String path, HttpResponse<String> response, Request.Method method) throws Exception {
        String spec = new ClassPathResource("static/openapi.yaml").getContentAsString(StandardCharsets.UTF_8);
        var report = OpenApiInteractionValidator.createForInlineApiSpecification(spec).build().validateResponse(path, method,
                SimpleResponse.Builder.ok().withContentType("application/json").withBody(response.body()).build());
        assertFalse(report.hasErrors(), () -> report.getMessages().toString());
    }
    private byte[] registerPng(long article, String directory, int page) throws Exception {
        Path folder = Files.createDirectories(CONTENT.resolve("magazine").resolve(directory));
        Path file = folder.resolve(page + ".png");
        var image = new java.awt.image.BufferedImage(8, 12, java.awt.image.BufferedImage.TYPE_INT_RGB);
        image.setRGB(1, 1, (int) article);
        assertTrue(javax.imageio.ImageIO.write(image, "PNG", file.toFile()));
        jdbc.update("UPDATE chapter SET content_url=? WHERE id=?", "/content/magazine/" + directory + "/", article);
        return Files.readAllBytes(file);
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
    private HttpRequest write(String slug, Session session, Map<String, Object> input, boolean csrf) {
        var builder = base(path(slug)).header("Cookie", session.cookie()).header("Content-Type", "application/json");
        if (csrf) builder.header("X-CSRF-TOKEN", session.token());
        return builder.POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(input))).build();
    }
    private HttpResponse<String> post(String slug, Session session, Map<String, Object> input, boolean csrf) throws Exception {
        return send(write(slug, session, input, csrf));
    }
    private HttpResponse<String> send(HttpRequest request) throws Exception { return http.send(request, HttpResponse.BodyHandlers.ofString()); }
    private record Session(String cookie, String token) { }
}
