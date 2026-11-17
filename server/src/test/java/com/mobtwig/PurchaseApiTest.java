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
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import com.atlassian.oai.validator.OpenApiInteractionValidator;
import com.atlassian.oai.validator.model.Request;
import com.atlassian.oai.validator.model.SimpleResponse;
import com.mobtwig.purchase.PurchaseRepository;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;

/** 전용 MySQL·실제 세션·본문 파일로 구매와 열람 권한의 전체 흐름을 검증합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=false",
        "mobtwig.reader.content-root=./target/purchase-content"
})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class PurchaseApiTest {
    private static final String ROOT = "/api/members/purchases";
    private static final String HISTORY = "/api/members/purchase-history";
    private static final Path CONTENT = Path.of("target/purchase-content");
    private static final String BODY = "첫 문단입니다.\n\n두 번째 문단입니다.";
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;
    @Autowired ObjectMapper mapper;
    @MockitoSpyBean PurchaseRepository repository;
    final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    final List<String> sessions = new ArrayList<>();
    Session admin;

    @BeforeEach void fixtures() throws Exception {
        cleanup();
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM book", Long.class));
        Files.createDirectories(CONTENT.resolve("magazine/issue"));
        Files.writeString(CONTENT.resolve("first.txt"), BODY);
        Files.writeString(CONTENT.resolve("second.txt"), "다음 회차입니다.");
        for (int page = 1; page <= 2; page++) {
            var png = new java.awt.image.BufferedImage(8, 8, java.awt.image.BufferedImage.TYPE_INT_RGB);
            png.setRGB(1, 1, page);
            assertTrue(javax.imageio.ImageIO.write(png, "PNG", CONTENT.resolve("magazine/issue/" + page + ".png").toFile()));
        }
        String hash = passwords.encode("TestPass19");
        jdbc.update("""
                INSERT INTO member(id,email,nickname,password_hash,role,status) VALUES
                (-10201,'purchase-a@example.test','purchase-a',?,'USER','ACTIVE'),
                (-10202,'purchase-b@example.test','purchase-b',?,'USER','ACTIVE'),
                (-10203,'purchase-admin@example.test','purchase-admin',?,'ADMIN','ACTIVE')
                """, hash, hash, hash);
        jdbc.update("""
                INSERT INTO book(id,content_type,slug,title,cover_image_url,publish_status,page_count) VALUES
                (-10201,'BOOK','purchase-book','구매 도서','/media/covers/구매 도서.png','PUBLISHED',NULL),
                (-10202,'MAGAZINE','purchase-magazine','구매 매거진','/media/covers/구매 매거진.png','PUBLISHED',2),
                (-10203,'WEBNOVEL','purchase-novel','구매 웹소설','/media/covers/구매 웹소설.png','PUBLISHED',NULL),
                (-10204,'BOOK','purchase-hidden','숨김 도서','/media/covers/숨김.png','HIDDEN',NULL)
                """);
        chapter(-10211, -10201, 1, "/content/first.txt", null, false);
        chapter(-10212, -10201, 2, "/content/second.txt", null, false);
        chapter(-10221, -10202, 1, "/content/magazine/issue/", 1, false);
        chapter(-10231, -10203, 1, "/content/first.txt", null, false);
        chapter(-10232, -10203, 2, "/content/second.txt", null, false);
        chapter(-10233, -10203, 3, "/content/second.txt", null, true);
        admin = login("admin", true);
    }

    @AfterEach void cleanup() {
        var database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertTrue(database != null && (database.equals("mobtwig_ci") || database.matches("[A-Za-z0-9_]+_test")));
        for (String session : sessions) jdbc.update("DELETE FROM SPRING_SESSION WHERE SESSION_ID=?", session);
        sessions.clear();
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME IN ('-10201','-10202','-10203')");
        jdbc.update("DELETE FROM purchase WHERE member_id IN (-10201,-10202,-10203)");
        jdbc.update("DELETE FROM purchase_product WHERE book_id BETWEEN -10204 AND -10201");
        for (String table : List.of("highlight", "bookmark", "reading_progress", "library_book", "recent_view", "chapter")) {
            jdbc.update("DELETE FROM " + table + " WHERE book_id BETWEEN -10204 AND -10201");
        }
        jdbc.update("DELETE FROM book WHERE id BETWEEN -10204 AND -10201");
        jdbc.update("DELETE FROM member WHERE id IN (-10201,-10202,-10203)");
    }

    @Test void purchasesWholeBookAndListsOnlyOwnSnapshotWithoutChangingReaderCounts() throws Exception {
        assertEquals(200, get(publicText("book", -10211), null).statusCode());
        assertEquals(0, ok(get(products("book", false), null)).size());
        String product = configure("book", null, 3000);
        var a = login("a", false);
        var b = login("b", false);
        assertEquals(401, get(publicText("book", -10211), a).statusCode());
        assertError(get(memberText("book", -10211), a), 402, "PURCHASE_REQUIRED");
        var response = post(ROOT, a, input(product, 3000, UUID.randomUUID().toString()), true);
        assertEquals(201, response.statusCode(), response.body());
        contract(ROOT, Request.Method.POST, response);
        var purchase = json(response);
        assertEquals("DEMO", purchase.get("paymentMode").asString());
        assertEquals("purchase-book", purchase.get("workId").asString());
        assertEquals("book", purchase.get("kind").asString());
        assertTrue(purchase.get("chapterId").isNull());
        assertEquals(BODY, ok(get(memberText("book", -10211), a)).get("body").asString());
        assertEquals(200, get(memberText("book", -10212), a).statusCode());
        assertError(get(memberText("book", -10211), b), 402, "PURCHASE_REQUIRED");
        var history = get(HISTORY + "?memberId=-10202", a);
        contract(HISTORY, Request.Method.GET, history);
        assertEquals(purchase, ok(history).get(0));
        assertEquals(0, ok(get(HISTORY, b)).size());
        var other = get(ROOT + "/" + purchase.get("purchaseId").asString(), b);
        assertError(other, 404, "NOT_FOUND");
        assertEquals("WANT_TO_READ", jdbc.queryForObject("SELECT status FROM library_book WHERE member_id=-10201 AND book_id=-10201", String.class));
        assertEquals(0L, jdbc.queryForObject("SELECT view_count FROM book WHERE id=-10201", Long.class));
        assertEquals(0L, rows("reading_progress"));
        assertEquals(0L, rows("recent_view"));
        var memberProducts = ok(get(products("book", true), a));
        assertTrue(memberProducts.get(0).get("owned").asBoolean());
        assertTrue(memberProducts.get(0).get("readable").asBoolean());
        assertFalse(ok(get(products("book", false), null)).get(0).get("owned").asBoolean());
        assertEquals("no-store", history.headers().firstValue("Cache-Control").orElseThrow());
        String hash = ok(get(memberText("book", -10211), a)).get("contentHash").asString();
        var position = new java.util.LinkedHashMap<String, Object>();
        position.put("chapterId", "-10211"); position.put("offset", 0); position.put("contentVersion", 1);
        position.put("contentHash", hash); position.put("expectedRevision", null);
        assertEquals(200, post("/api/members/works/purchase-book/reading-progress", a, position, true).statusCode());
        assertEquals("READING", jdbc.queryForObject("SELECT status FROM library_book WHERE member_id=-10201 AND book_id=-10201", String.class));
        assertEquals(200, post("/api/members/bookmarks", a,
                Map.of("workId", "purchase-book", "chapterId", "-10211", "offset", 0, "contentVersion", 1, "contentHash", hash), true).statusCode());
        String novel = configure("novel", "-10231", 100);
        var latest = buy(novel, 100, a);
        assertEquals(201, latest.statusCode(), latest.body());
        var both = ok(get(HISTORY, a));
        assertEquals(2, both.size());
        assertEquals(json(latest), both.get(0));
        assertEquals(purchase, both.get(1));
    }

    @Test void buysOnlySelectedNovelChapterAndRejectsWrongTargetsOrUnpublishedChapters() throws Exception {
        assertError(configureResponse("novel", null, 100), 400, "INVALID_TARGET");
        assertError(configureResponse("book", "-10211", 100), 400, "INVALID_TARGET");
        assertError(configureResponse("novel", "-10211", 100), 404, "NOT_FOUND");
        String first = configure("novel", "-10231", 100);
        configure("novel", "-10232", 200);
        String future = configure("novel", "-10233", 300);
        var response = get(products("novel", false), null);
        contract(products("novel", false), Request.Method.GET, response);
        assertEquals(List.of("-10231", "-10232"), ok(response).valueStream().map(w -> w.get("chapterId").asString()).toList());
        var a = login("a", false);
        assertEquals(201, buy(first, 100, a).statusCode());
        assertEquals(200, get(memberText("novel", -10231), a).statusCode());
        assertError(get(memberText("novel", -10232), a), 402, "PURCHASE_REQUIRED");
        assertEquals(401, get(publicText("novel", -10231), a).statusCode());
        assertError(buy(future, 300, a), 404, "NOT_FOUND");
        assertEquals(1L, rows("purchase"));
        assertEquals("-10231", ok(get(HISTORY, a)).get(0).get("chapterId").asString());
        assertEquals(1L, rows("library_book"));
    }

    @Test void protectsMagazinePngAndPreservesItsVersionValidation() throws Exception {
        String product = configure("magazine", null, 5000);
        var a = login("a", false);
        String page = "/works/purchase-magazine/magazine/pages/1?contentVersion=1";
        assertEquals(401, get(page, null).statusCode());
        assertEquals(200, get("/works/purchase-magazine/magazine", null).statusCode());
        String memberPage = "/api/members" + page;
        assertError(get(memberPage, a), 402, "PURCHASE_REQUIRED");
        var range = new java.util.LinkedHashMap<String, Object>();
        range.put("workId", "purchase-magazine"); range.put("chapterId", "-10221");
        range.put("startOffset", 1); range.put("endOffset", 2); range.put("contentVersion", 1);
        range.put("contentHash", null); range.put("color", "YELLOW");
        assertEquals(402, post("/api/members/highlights", a, range, true).statusCode());
        assertEquals(201, buy(product, 5000, a).statusCode());
        var png = http.send(base(memberPage).header("Cookie", a.cookie()).GET().build(), HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(200, png.statusCode());
        assertEquals("image/png", png.headers().firstValue("Content-Type").orElseThrow());
        assertArrayEquals(Files.readAllBytes(CONTENT.resolve("magazine/issue/1.png")), png.body());
        var highlight = ok(post("/api/members/highlights", a, range, true));
        assertEquals("page", highlight.get("range").get("unit").asString());
        assertTrue(highlight.get("range").get("contentHash").isNull());
        jdbc.update("UPDATE chapter SET content_version=2 WHERE id=-10221");
        assertEquals(409, get(memberPage, a).statusCode());
        assertEquals(400, get(memberPage + "&contentVersion=2", a).statusCode());
    }

    @Test void verifiesPriceAndKeepsPurchaseTimeMetadata() throws Exception {
        String product = configure("book", null, 3000);
        var a = login("a", false);
        configure("book", null, 4000);
        assertError(buy(product, 3000, a), 409, "PRICE_CHANGED");
        assertEquals(0L, rows("purchase"));
        JsonNode original = json(buy(product, 4000, a));
        configure("book", null, 5000);
        assertEquals(200, get(memberText("book", -10211), a).statusCode());
        assertEquals(original, ok(get(HISTORY, a)).get(0));
        jdbc.update("UPDATE book SET title='수정된 제목',cover_image_url='/media/changed.png',publish_status='HIDDEN' WHERE id=-10201");
        assertEquals(original, ok(get(HISTORY, a)).get(0));
        assertEquals(404, get(memberText("book", -10211), a).statusCode());
        assertEquals(404, get(products("book", false), null).statusCode());
    }

    @Test void requiresSessionCsrfAndStrictServerOwnedPurchaseInputs() throws Exception {
        assertEquals(401, get(HISTORY, null).statusCode());
        var a = login("a", false);
        String product = configure("book", null, 100);
        var body = input(product, 100, UUID.randomUUID().toString());
        assertEquals(403, post(ROOT, a, body, false).statusCode());
        assertEquals(403, post("/api/admin/works/purchase-book/purchase-products", a,
                Map.of("chapterId", "-10211", "price", 100), true).statusCode());
        for (Object invalid : List.of(Map.of("productId", product, "expectedPrice", -1, "requestId", UUID.randomUUID().toString()),
                Map.of("productId", 1, "expectedPrice", 100, "requestId", UUID.randomUUID().toString()),
                Map.of("productId", product, "expectedPrice", 100, "requestId", "invalid"),
                Map.of("productId", product, "expectedPrice", 100, "requestId", UUID.randomUUID().toString(), "memberId", "-10202"))) {
            assertError(post(ROOT, a, invalid, true), 400, "INVALID_REQUEST");
        }
        assertEquals(0L, rows("purchase"));
        jdbc.update("UPDATE member SET status='SUSPENDED' WHERE id=-10201");
        assertEquals(401, post(ROOT, a, body, true).statusCode());
    }

    @Test void concurrentRetriesCreateOnePurchaseAndDifferentRequestsCannotBuyItTwice() throws Exception {
        String product = configure("book", null, 100);
        var a = login("a", false);
        var body = input(product, 100, UUID.randomUUID().toString());
        var start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> { assertTrue(start.await(5, TimeUnit.SECONDS)); return post(ROOT, a, body, true); });
            var second = executor.submit(() -> { assertTrue(start.await(5, TimeUnit.SECONDS)); return post(ROOT, a, body, true); });
            start.countDown();
            var one = first.get(20, TimeUnit.SECONDS);
            var two = second.get(20, TimeUnit.SECONDS);
            assertEquals(List.of(200, 201), java.util.stream.Stream.of(one.statusCode(), two.statusCode()).sorted().toList());
            assertEquals(json(one), json(two));
        }
        assertEquals(1L, rows("purchase"));
        assertError(buy(product, 100, a), 409, "ALREADY_OWNED");
        String other = configure("magazine", null, 100);
        assertError(post(ROOT, a, input(other, 100, (String) body.get("requestId")), true), 409, "REQUEST_CONFLICT");
        assertEquals(1L, rows("purchase"));
    }

    @Test void purchaseRollsBackWhenLibraryRegistrationFails() throws Exception {
        String product = configure("book", null, 100);
        var a = login("a", false);
        doThrow(new DataAccessResourceFailureException("시험용 저장 실패")).when(repository).addToLibrary(anyLong(), anyLong());
        assertError(buy(product, 100, a), 500, "UNAVAILABLE");
        assertEquals(0L, rows("purchase"));
        assertEquals(0L, rows("library_book"));
        assertError(get(memberText("book", -10211), a), 402, "PURCHASE_REQUIRED");
    }

    @Test void freeProductsStayPublicAndPurchasesPreserveExistingLibraryPreferences() throws Exception {
        String product = configure("book", null, 0);
        assertEquals(200, get(publicText("book", -10211), null).statusCode());
        var a = login("a", false);
        configure("book", null, 100);
        jdbc.update("INSERT INTO library_book(member_id,book_id,status,is_favorite,is_hidden) VALUES(-10201,-10201,'READING',TRUE,TRUE)");
        assertEquals(201, buy(product, 100, a).statusCode());
        var saved = jdbc.queryForMap("SELECT status,is_favorite,is_hidden FROM library_book WHERE member_id=-10201 AND book_id=-10201");
        assertEquals("READING", saved.get("status"));
        assertEquals(Boolean.TRUE, saved.get("is_favorite"));
        assertEquals(Boolean.TRUE, saved.get("is_hidden"));
        configure("book", null, 0);
        assertEquals(200, get(publicText("book", -10211), null).statusCode());
    }

    @Test void unownedPaidContentCannotGenerateProgressOrBookmarkSnippets() throws Exception {
        configure("book", null, 100);
        var a = login("a", false);
        var location = Map.of("chapterId", "-10211", "offset", 0, "contentVersion", 1, "contentHash", "0".repeat(64), "workId", "purchase-book");
        assertEquals(402, post("/api/members/bookmarks", a, location, true).statusCode());
        var input = new java.util.LinkedHashMap<String, Object>(location);
        input.remove("workId");
        input.put("expectedRevision", null);
        assertError(post("/api/members/works/purchase-book/reading-progress", a, input, true), 402, "PURCHASE_REQUIRED");
        assertEquals(0L, rows("bookmark"));
        assertEquals(0L, rows("reading_progress"));
        assertEquals(0L, rows("library_book"));
    }

    @Test void protectsHighlightSnippetsAndHidesUnownedSavedRecordsWithoutBlockingOwnDeletion() throws Exception {
        var a = login("a", false);
        String hash = ok(get(publicText("book", -10211), null)).get("contentHash").asString();
        var highlightInput = Map.of("workId", "purchase-book", "chapterId", "-10211", "startOffset", 0,
                "endOffset", BODY.length(), "contentVersion", 1, "contentHash", hash, "color", "YELLOW");
        var bookmarkInput = Map.of("workId", "purchase-book", "chapterId", "-10211", "offset", 0,
                "contentVersion", 1, "contentHash", hash);
        var savedHighlight = ok(post("/api/members/highlights", a, highlightInput, true));
        var savedBookmark = ok(post("/api/members/bookmarks", a, bookmarkInput, true));
        assertEquals(BODY, savedHighlight.get("snippet").asString());
        String product = configure("book", null, 100);

        // 위치 조회의 메타데이터 계약은 유지하되 알려진 해시로도 유료 발췌문을 만들 수 없습니다.
        var progress = ok(get("/api/members/works/purchase-book/reading-progress", a));
        assertEquals("new", progress.get("state").asString());
        assertEquals(hash, progress.get("position").get("contentHash").asString());
        assertEquals(402, post("/api/members/highlights", a, highlightInput, true).statusCode());
        assertEquals(402, post("/api/members/bookmarks", a, bookmarkInput, true).statusCode());
        var highlights = get("/api/members/highlights", a);
        var bookmarks = get("/api/members/bookmarks", a);
        contract("/api/members/highlights", Request.Method.GET, highlights);
        contract("/api/members/bookmarks", Request.Method.GET, bookmarks);
        var hiddenHighlight = ok(highlights).get("items").get(0);
        var hiddenBookmark = ok(bookmarks).get("items").get(0);
        for (var item : List.of(hiddenHighlight, hiddenBookmark)) {
            assertEquals("hidden", item.get("state").asString());
            assertTrue(item.get("workId").isNull());
            assertTrue(item.get("workTitle").isNull());
            assertTrue(item.get("kind").isNull());
            assertTrue(item.get("chapterTitle").isNull());
            assertTrue(item.get("snippet").isNull());
            assertFalse(item.get("createdAt").asString().isBlank());
        }
        assertTrue(hiddenHighlight.get("range").isNull());
        assertTrue(hiddenHighlight.get("color").isNull());
        assertTrue(hiddenBookmark.get("position").isNull());
        assertEquals(savedHighlight.get("id"), hiddenHighlight.get("id"));
        assertEquals(savedBookmark.get("id"), hiddenBookmark.get("id"));
        assertEquals(0L, rows("reading_progress"));
        assertEquals(0L, rows("library_book"));

        for (String path : List.of("/api/members/highlights/" + hiddenHighlight.get("id").asString(),
                "/api/members/bookmarks/" + hiddenBookmark.get("id").asString())) {
            var deleted = http.send(base(path).header("Cookie", a.cookie()).header("X-CSRF-TOKEN", a.token())
                    .DELETE().build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(204, deleted.statusCode(), deleted.body());
        }
        assertEquals(0L, rows("highlight"));
        assertEquals(0L, rows("bookmark"));
        assertEquals(201, buy(product, 100, a).statusCode());
        var purchasedHighlight = post("/api/members/highlights", a, highlightInput, true);
        contract("/api/members/highlights", Request.Method.POST, purchasedHighlight);
        assertEquals("available", ok(purchasedHighlight).get("state").asString());
        assertEquals(BODY, ok(purchasedHighlight).get("snippet").asString());
        assertEquals("available", ok(post("/api/members/bookmarks", a, bookmarkInput, true)).get("state").asString());
        assertEquals(BODY, ok(get("/api/members/highlights", a)).get("items").get(0).get("snippet").asString());
    }

    private void chapter(long id, long book, int number, String url, Integer page, boolean future) {
        jdbc.update("INSERT INTO chapter(id,book_id,chapter_no,title,content_url,char_count,start_page,published_at) VALUES(?,?,?,?,?,?,?,?)",
                id, book, number, "회차 " + number, url, BODY.length(), page,
                Timestamp.from(Instant.now().plusSeconds(future ? 86400 : -86400)));
    }
    private static String products(String kind, boolean member) { return (member ? "/api/members" : "") + "/works/purchase-" + kind + "/purchase-products"; }
    private static String publicText(String kind, long chapter) { return "/works/purchase-" + kind + "/chapters/" + chapter; }
    private static String memberText(String kind, long chapter) { return "/api/members" + publicText(kind, chapter); }
    private long rows(String table) { return Objects.requireNonNull(jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class)); }
    private Map<String, Object> input(String product, int price, String request) { return Map.of("productId", product, "expectedPrice", price, "requestId", request); }
    private HttpResponse<String> buy(String product, int price, Session member) throws Exception { return post(ROOT, member, input(product, price, UUID.randomUUID().toString()), true); }
    private String configure(String kind, String chapter, int price) throws Exception { return ok(configureResponse(kind, chapter, price)).get("productId").asString(); }
    private HttpResponse<String> configureResponse(String kind, String chapter, int price) throws Exception {
        var body = new java.util.LinkedHashMap<String, Object>();
        body.put("chapterId", chapter); body.put("price", price);
        return post("/api/admin/works/purchase-" + kind + "/purchase-products", admin, body, true);
    }
    private Session login(String account, boolean administrator) throws Exception {
        String root = administrator ? "/api/admin" : "/api/auth";
        String name = administrator ? "SESSION" : "MEMBER_SESSION";
        var anonymous = get(root + "/csrf", null);
        String cookie = cookie(anonymous, name);
        var request = base(root + "/login").header("Cookie", cookie).header("X-CSRF-TOKEN", ok(anonymous).get("token").asString())
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("email=purchase-" + account + "%40example.test&username=purchase-" + account + "%40example.test&password=TestPass19")).build();
        var result = http.send(request, HttpResponse.BodyHandlers.ofString());
        assertEquals(204, result.statusCode(), result.body());
        String auth = cookie(result, name);
        return new Session(auth, ok(get(root + "/csrf", new Session(auth, ""))).get("token").asString());
    }
    private String cookie(HttpResponse<String> response, String name) {
        String header = response.headers().allValues("Set-Cookie").stream().filter(v -> v.startsWith(name + "=")).findFirst().orElseThrow();
        String cookie = header.substring(0, header.indexOf(';'));
        sessions.add(new String(Base64.getDecoder().decode(cookie.substring(name.length() + 1)), StandardCharsets.UTF_8));
        return cookie;
    }
    private JsonNode json(HttpResponse<String> response) { return mapper.readTree(response.body()); }
    private JsonNode ok(HttpResponse<String> response) { assertEquals(200, response.statusCode(), response.body()); return json(response); }
    private void assertError(HttpResponse<String> response, int status, String code) {
        assertEquals(status, response.statusCode(), response.body());
        assertEquals(code, json(response).get("code").asString());
    }
    private void contract(String path, Request.Method method, HttpResponse<String> response) throws Exception {
        String spec = new ClassPathResource("static/openapi.yaml").getContentAsString(Objects.requireNonNull(StandardCharsets.UTF_8));
        var report = OpenApiInteractionValidator.createForInlineApiSpecification(spec).build().validateResponse(path, method,
                new SimpleResponse.Builder(response.statusCode()).withContentType("application/json").withBody(response.body()).build());
        assertFalse(report.hasErrors(), () -> report.getMessages().toString());
    }
    private HttpRequest.Builder base(String path) { return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(12)); }
    private HttpResponse<String> get(String path, Session session) throws Exception {
        var request = base(path);
        if (session != null) request.header("Cookie", session.cookie());
        return http.send(request.GET().build(), HttpResponse.BodyHandlers.ofString());
    }
    private HttpResponse<String> post(String path, Session session, Object body, boolean csrf) throws Exception {
        var request = base(path).header("Cookie", session.cookie()).header("Content-Type", "application/json");
        if (csrf) request.header("X-CSRF-TOKEN", session.token());
        return http.send(request.POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body))).build(), HttpResponse.BodyHandlers.ofString());
    }
    private record Session(String cookie, String token) { }
}
