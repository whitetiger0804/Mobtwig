package com.mobtwig;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
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

/** 실제 HTTP와 전용 MySQL로 리뷰 조회·등록·동시 집계를 확인합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=false"})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class WorkReviewApiTest {
    private static final String GET = "/works/review-public/reviews";
    private static final String POST = "/api/members/works/review-public/reviews";
    private static final String FIELDS = "id,rating,body,nickname,createdAt";
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired PasswordEncoder passwords;
    final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    record Session(String cookie, String csrf) {}

    @BeforeEach void seed() {
        cleanup();
        var hash = passwords.encode("TestPass19");
        jdbc.update("""
                INSERT INTO member(id,email,nickname,password_hash,role,status) VALUES
                (-13801,'review-a@example.test','독자 하나',?,'USER','ACTIVE'),
                (-13802,'review-b@example.test','독자 둘',?,'USER','ACTIVE')
                """, hash, hash);
        jdbc.update("""
                INSERT INTO book(id,content_type,slug,title,publish_status) VALUES
                (-13801,'WEBNOVEL','review-public','공개 작품','PUBLISHED'),
                (-13802,'BOOK','review-hidden','비공개 작품','HIDDEN')
                """);
    }

    @AfterEach void cleanup() {
        var database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertTrue(database != null && (database.equals("mobtwig_ci") || database.matches("[A-Za-z0-9_]+_test")));
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME IN ('-13801','-13802')");
        jdbc.update("DELETE FROM review WHERE book_id IN (-13801,-13802)");
        jdbc.update("DELETE FROM book WHERE id IN (-13801,-13802)");
        jdbc.update("DELETE FROM member WHERE id IN (-13801,-13802)");
    }

    @Test void emptyAndNonPublicReviewsDoNotIncrementViews() throws Exception {
        var empty = get(GET);
        contract("/works/{slug}/reviews", Request.Method.GET, empty);
        assertEquals("no-store", empty.headers().firstValue("Cache-Control").orElseThrow());
        var body = json(empty, 200);
        assertTrue(body.get("averageRating").isNull());
        assertEquals(0, body.get("reviewCount").asInt());
        for (int i = 1; i <= 5; i++) assertEquals(0, body.get("ratingDistribution").get(Integer.toString(i)).asInt());
        assertTrue(body.get("items").isEmpty());
        assertFalse(body.get("hasNext").asBoolean());
        for (String query : List.of("?page=", "?page=0", "?page=2147483648", "?size=51", "?size=2&size=3", "?page=abc")) {
            json(get(GET + query), 400);
        }
        assertEquals(404, get("/works/review-hidden/reviews").statusCode());
        assertEquals(404, get("/works/review-missing/reviews").statusCode());
        assertEquals(0L, jdbc.queryForObject("SELECT SUM(view_count) FROM book WHERE id IN (-13801,-13802)", Long.class));
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM book_stat_daily WHERE book_id=-13801", Long.class));
    }

    @Test void activeReviewPagesKeepFullDistributionAndStableTieOrder() throws Exception {
        jdbc.update("""
                INSERT INTO review(id,book_id,member_id,rating,content,created_at,deleted_at) VALUES
                (-13804,-13801,-13801,1,'삭제된 리뷰','2026-01-02 00:00:00','2026-01-02 00:01:00'),
                (-13803,-13801,-13801,3,NULL,'2026-01-01 00:00:00',NULL),
                (-13802,-13801,-13802,4,'리뷰','2026-01-01 00:00:00',NULL)
                """);
        var first = json(get(GET + "?page=1&size=1"), 200);
        var next = json(get(GET + "?page=2&size=1"), 200);
        assertEquals(3.5, first.get("averageRating").asDouble());
        assertEquals(2, first.get("reviewCount").asInt());
        assertEquals(0, first.get("ratingDistribution").get("1").asInt());
        assertEquals(1, first.get("ratingDistribution").get("3").asInt());
        assertEquals(1, first.get("ratingDistribution").get("4").asInt());
        assertEquals(first.get("ratingDistribution"), next.get("ratingDistribution"));
        assertTrue(first.get("hasNext").asBoolean());
        assertFalse(next.get("hasNext").asBoolean());
        assertEquals("-13802", first.get("items").get(0).get("id").asString());
        assertEquals("-13803", next.get("items").get(0).get("id").asString());
        assertEquals("2026-01-01T00:00:00Z", next.get("items").get(0).get("createdAt").asString());
        assertTrue(json(get(GET + "?page=2147483647"), 200).get("items").isEmpty());
    }

    @Test void validatesSessionCsrfAndBodyAndAllowsRatingOnly() throws Exception {
        assertEquals(401, post(POST, null, "{\"rating\":5}").statusCode());
        var a = login("a");
        assertEquals(403, post(POST, new Session(a.cookie(), null), "{\"rating\":5}").statusCode());
        assertEquals(403, post(POST, new Session(a.cookie(), "invalid"), "{\"rating\":5}").statusCode());
        assertEquals(404, post("/api/members/works/review-hidden/reviews", a, "{\"rating\":5}").statusCode());
        for (String invalid : List.of("{", "{}", "null", "{\"rating\":1.0}", "{\"rating\":0}", "{\"rating\":6}",
                "{\"rating\":\"5\"}", "{\"rating\":2,\"body\":123}", "{\"rating\":4,\"memberId\":\"-13802\"}",
                "{\"rating\":5,\"body\":\"" + "😀".repeat(1001) + "\"}")) {
            json(post(POST, a, invalid), 400);
        }
        var response = post(POST, a, "{\"rating\":5,\"body\":\"  \\t　 \"}");
        contract("/api/members/works/{slug}/reviews", Request.Method.POST, response);
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        var review = json(response, 201);
        assertEquals(List.of(FIELDS.split(",")), review.propertyNames().stream().toList());
        assertEquals("독자 하나", review.get("nickname").asString());
        assertTrue(review.get("body").isNull());
        assertEquals(409, post(POST, a, "{\"rating\":1}").statusCode());
        assertEquals(1, summaryCount());
        assertEquals(5.0, summaryAverage());
    }

    @Test void concurrentWritesSerializeSummaryAndPreventDuplicateActiveReviews() throws Exception {
        var a = login("a");
        var b = login("b");
        String text = "😀".repeat(1000);
        var a1 = http.sendAsync(postRequest(POST, a, "{\"rating\":5,\"body\":\" " + text + " \"}"), HttpResponse.BodyHandlers.ofString());
        var b1 = http.sendAsync(postRequest(POST, b, "{\"rating\":2}"), HttpResponse.BodyHandlers.ofString());
        var b2 = http.sendAsync(postRequest(POST, b, "{\"rating\":2,\"body\":null}"), HttpResponse.BodyHandlers.ofString());
        assertEquals(text, json(a1.get(), 201).get("body").asString());
        assertEquals(List.of(201, 409), java.util.stream.Stream.of(b1.get().statusCode(), b2.get().statusCode()).sorted().toList());
        var page = json(get(GET), 200);
        assertEquals(2, page.get("reviewCount").asInt());
        assertEquals(3.5, page.get("averageRating").asDouble());
        assertEquals(2, summaryCount());
        assertEquals(3.5, summaryAverage());
    }

    private int summaryCount() { return jdbc.queryForObject("SELECT review_count FROM book WHERE id=-13801", Integer.class); }
    private double summaryAverage() { return jdbc.queryForObject("SELECT average_rating FROM book WHERE id=-13801", Double.class); }

    private Session login(String label) throws Exception {
        var token = get("/api/auth/csrf");
        var login = send(base("/api/auth/login").header("Cookie", cookie(token)).header("X-CSRF-TOKEN", json(token, 200).get("token").asString())
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("email=review-" + label + "%40example.test&password=TestPass19")).build());
        assertEquals(204, login.statusCode());
        String cookie = cookie(login);
        var csrf = send(base("/api/auth/csrf").header("Cookie", cookie).GET().build());
        return new Session(cookie, json(csrf, 200).get("token").asString());
    }

    private static String cookie(HttpResponse<String> response) {
        return response.headers().allValues("Set-Cookie").stream().filter(value -> value.startsWith("MEMBER_SESSION="))
                .map(value -> value.substring(0, value.indexOf(';'))).findFirst().orElseThrow();
    }

    private HttpRequest postRequest(String path, Session session, String body) {
        var request = base(path).header("Content-Type", "application/json");
        if (session != null) {
            request.header("Cookie", session.cookie());
            if (session.csrf() != null) request.header("X-CSRF-TOKEN", session.csrf());
        }
        return request.POST(HttpRequest.BodyPublishers.ofString(body)).build();
    }

    private HttpRequest.Builder base(String path) {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(15));
    }

    private HttpResponse<String> post(String path, Session session, String body) throws Exception { return send(postRequest(path, session, body)); }
    private HttpResponse<String> get(String path) throws Exception { return send(base(path).GET().build()); }
    private HttpResponse<String> send(HttpRequest request) throws Exception { return http.send(request, HttpResponse.BodyHandlers.ofString()); }

    private JsonNode json(HttpResponse<String> response, int status) {
        assertEquals(status, response.statusCode(), response.body());
        return mapper.readTree(response.body());
    }

    private static void contract(String path, Request.Method method, HttpResponse<String> response) throws Exception {
        var spec = new ClassPathResource("static/openapi.yaml").getContentAsString(StandardCharsets.UTF_8);
        var report = OpenApiInteractionValidator.createForInlineApiSpecification(spec).build().validateResponse(path, method,
                SimpleResponse.Builder.status(response.statusCode()).withContentType("application/json").withBody(response.body()).build());
        assertFalse(report.hasErrors(), () -> report.getMessages().toString());
    }
}
