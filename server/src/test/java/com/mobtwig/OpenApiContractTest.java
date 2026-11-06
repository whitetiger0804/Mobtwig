package com.mobtwig;

import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import com.atlassian.oai.validator.OpenApiInteractionValidator;
import com.atlassian.oai.validator.model.Request;
import com.atlassian.oai.validator.model.SimpleRequest;
import com.atlassian.oai.validator.model.SimpleResponse;
import com.atlassian.oai.validator.report.ValidationReport;
import io.swagger.v3.core.util.Json;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.parser.OpenAPIV3Parser;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ContextConfiguration;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.*;

/** 공개 명세·문서 자산과 실제 MySQL HTTP 요청·응답의 계약 일치를 검증합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=false"
})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class OpenApiContractTest {
    private static final String EMAIL = "openapi-test-root@example.com";
    private static final String PASSWORD = "openapi-test-password-2026";
    private final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
    private final HttpClient client = HttpClient.newBuilder().cookieHandler(cookies)
            .connectTimeout(Duration.ofSeconds(5)).build();
    @Value("${local.server.port}") private int port;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private PasswordEncoder passwords;
    @Autowired private ObjectMapper mapper;
    private String specification;
    private OpenAPI api;
    private OpenApiInteractionValidator validator;

    @BeforeEach
    void prepare() throws Exception {
        cleanup();
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM book", Long.class));
        specification = new ClassPathResource("static/openapi.yaml")
                .getContentAsString(Objects.requireNonNull(StandardCharsets.UTF_8));
        var parsed = new OpenAPIV3Parser().readContents(specification);
        assertTrue(parsed.getMessages().isEmpty(), () -> parsed.getMessages().toString());
        api = parsed.getOpenAPI();
        assertNotNull(api);
        validator = OpenApiInteractionValidator.createForInlineApiSpecification(specification)
                .withResolveCombinators(true).build();
        jdbc.update("""
                INSERT INTO member(id,email,password_hash,nickname,role,status)
                VALUES (-9901,?,?,'openapi-test-root','ADMIN','ACTIVE')
                """, EMAIL, passwords.encode(PASSWORD));
    }

    @AfterEach
    void cleanup() {
        String database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertTrue(database != null && (database.equals("mobtwig_ci") || database.matches("[A-Za-z0-9_]+_test")));
        cookies.getCookieStore().getCookies().stream().filter(cookie -> cookie.getName().equals("SESSION"))
                .forEach(cookie -> jdbc.update("DELETE FROM SPRING_SESSION WHERE SESSION_ID=?",
                        new String(Base64.getDecoder().decode(cookie.getValue()), StandardCharsets.UTF_8)));
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME IN (SELECT CAST(id AS CHAR) FROM member WHERE email LIKE 'openapi-test-%')");
        for (String table : List.of("book_stat_daily", "board", "book_author", "book_genre", "book_category", "chapter")) {
            jdbc.update("DELETE FROM " + table + " WHERE book_id IN (SELECT id FROM book WHERE slug LIKE 'openapi-test-%')");
        }
        jdbc.update("DELETE FROM book WHERE slug LIKE 'openapi-test-%'");
        jdbc.update("DELETE FROM author WHERE name LIKE 'openapi-test-%'");
        jdbc.update("DELETE FROM genre WHERE name LIKE 'openapi-test-%'");
        jdbc.update("DELETE FROM category WHERE name LIKE 'openapi-test-%'");
        jdbc.update("DELETE FROM member_reading_setting WHERE member_id IN (SELECT id FROM member WHERE email LIKE 'openapi-test-%')");
        jdbc.update("DELETE FROM member WHERE email LIKE 'openapi-test-%'");
        cookies.getCookieStore().removeAll();
    }

    @Test
    void servesTheExactSpecificationAndLocalSwaggerAssets() throws Exception {
        var specificationResponse = rawGet("/openapi.yaml");
        assertEquals(200, specificationResponse.statusCode());
        assertEquals(specification, specificationResponse.body());
        var page = rawGet("/api-docs/index.html");
        assertEquals(200, page.statusCode());
        assertTrue(page.body().contains("/api-docs/api-docs.js"));
        assertFalse(page.body().contains(PASSWORD));
        assertTrue(page.headers().firstValue("Content-Security-Policy").orElseThrow().contains("frame-ancestors 'none'"));
        assertTrue(page.headers().firstValue("Content-Security-Policy").orElseThrow().contains("img-src 'self' https: data:"));
        assertFalse(rawGet("/admin").headers().firstValue("Content-Security-Policy").orElseThrow().contains("data:"));
        assertEquals(200, rawGet("/api-docs/api-docs.js").statusCode());
        assertEquals(200, rawGet("/webjars/swagger-ui/5.34.1/swagger-ui.css").statusCode());
        assertEquals(200, rawGet("/webjars/swagger-ui/5.34.1/swagger-ui-bundle.js").statusCode());
    }

    @Test
    void validatesThePublishedJsonExamples() throws Exception {
        for (String path : List.of("/sdui/home", "/works/{slug}")) {
            Object example = api.getPaths().get(path).getGet().getResponses().get("200")
                    .getContent().get("application/json").getExample();
            assertNotNull(example);
            valid(validator.validateResponse(path.replace("{slug}", "sample-book"), Request.Method.GET,
                    SimpleResponse.Builder.ok().withContentType("application/json")
                            .withBody(Json.mapper().writeValueAsString(example)).build()));
        }
        Object workExample = api.getComponents().getSchemas().get("WorkInput").getExample();
        valid(validator.validateRequest(SimpleRequest.Builder.post("/api/admin/works")
                .withContentType("application/json").withHeader("Cookie", "SESSION=example-session")
                .withHeader("X-CSRF-TOKEN", "example-token").withBody(Json.mapper().writeValueAsString(workExample)).build()));
        Object chapterExample = api.getComponents().getSchemas().get("ChapterInput").getExample();
        valid(validator.validateRequest(SimpleRequest.Builder.post("/api/admin/works/1/chapters")
                .withContentType("application/json").withHeader("Cookie", "SESSION=example-session")
                .withHeader("X-CSRF-TOKEN", "example-token").withBody(Json.mapper().writeValueAsString(chapterExample)).build()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"book", "magazine", "novel"})
    void matchesTheDocumentedRegistrationAndPublicReadFlow(String kind) throws Exception {
        assertEquals(204, login().statusCode());
        assertEquals(200, get("/api/admin/session").statusCode());
        long authorId = id(post("/api/admin/authors", Map.of("name", "openapi-test-author", "bio", "예시 소개입니다.")));
        long genreId = id(post("/api/admin/genres", Map.of("name", "openapi-test-genre", "displayOrder", 0)));
        long categoryId = id(post("/api/admin/categories", Map.of("name", "openapi-test-category", "displayOrder", 0)));
        var chapter = Map.of("chapterNo", 1, "title", "첫 번째 장", "publishedAt", "2026-01-01T00:00:00Z",
                "characterCount", 1500, "pageNumber", 1, "contentUrl", "/content/openapi-test/1.html");
        var input = new java.util.LinkedHashMap<String, Object>();
        input.put("kind", kind);
        input.put("slug", "openapi-test-" + kind);
        input.put("title", "계약 검증 작품");
        input.put("description", "실제 API와 문서의 계약을 검증합니다.");
        input.put("imageUrl", "/images/openapi-test.jpg");
        input.put("publishedAt", "2026-01-01");
        input.put("publisher", "예시 발행처");
        input.put("fileFormat", "EPUB");
        input.put("pageCount", 120);
        input.put("serialStatus", "COMPLETED");
        input.put("publishStatus", "DRAFT");
        input.put("authorIds", List.of(authorId));
        input.put("genreIds", List.of(genreId));
        input.put("categoryIds", List.of(categoryId));
        input.put("chapters", List.of(chapter));
        var created = post("/api/admin/works", input);
        assertEquals(201, created.statusCode(), created.body());
        long workId = id(created);
        assertEquals(404, get("/works/openapi-test-" + kind).statusCode());
        assertEquals(204, post("/api/admin/works/" + workId + "/status", Map.of("publishStatus", "PUBLISHED")).statusCode());
        for (String homeKind : List.of("all", "book", "magazine", "novel")) {
            assertEquals(200, get("/sdui/home?kind=" + homeKind).statusCode());
        }
        assertEquals(200, get("/works/openapi-test-" + kind).statusCode());
        assertEquals(201, post("/api/admin/works/" + workId + "/chapters",
                Map.of("chapterNo", 2, "title", "비공개 회차", "characterCount", 0, "pageNumber", 2)).statusCode());
        assertEquals(200, get("/api/admin/catalog").statusCode());
        assertEquals(201, post("/api/admin/accounts", Map.of("email", "openapi-test-team@example.com",
                "nickname", "openapi-test-team", "password", PASSWORD)).statusCode());
        assertEquals(204, post("/api/admin/works/" + workId + "/status", Map.of("publishStatus", "HIDDEN")).statusCode());
        assertEquals(404, get("/works/openapi-test-" + kind).statusCode());
        assertEquals(204, post("/api/admin/logout", Map.of()).statusCode());
        assertEquals(401, exchange(Request.Method.GET, "/api/admin/session", "", "application/json", false).statusCode());
        assertEquals(200, get("/actuator/health/readiness").statusCode());
    }

    @Test
    void documentsSecurityValidationAndConflictResponses() throws Exception {
        assertEquals(401, exchange(Request.Method.GET, "/api/admin/catalog", "", "application/json", false).statusCode());
        var denied = client.send(HttpRequest.newBuilder(URI.create(base() + "/api/admin/login"))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Accept", "application/json").POST(HttpRequest.BodyPublishers.ofString("username=none&password=none"))
                .build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        assertEquals(403, denied.statusCode(), denied.body());
        responseMatches("/api/admin/login", Request.Method.POST, denied);
        assertEquals(400, exchange(Request.Method.GET, "/sdui/home?kind=invalid", "", "application/json", false).statusCode());
        assertEquals(404, get("/works/openapi-test-missing").statusCode());
        assertEquals(204, login().statusCode());
        assertEquals(400, exchange(Request.Method.POST, "/api/admin/authors", "{\"name\":\"\"}", "application/json", false).statusCode());
        assertEquals(404, post("/api/admin/works/9223372036854775807/status", Map.of("publishStatus", "PUBLISHED")).statusCode());
        var genre = Map.of("name", "openapi-test-duplicate", "displayOrder", 0);
        assertEquals(201, post("/api/admin/genres", genre).statusCode());
        assertEquals(409, post("/api/admin/genres", genre).statusCode());
        assertEquals(204, post("/api/admin/logout", Map.of()).statusCode());
    }

    private String base() { return "http://127.0.0.1:" + port; }

    private HttpResponse<String> rawGet(String path) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create(base() + path)).GET().build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    private HttpResponse<String> get(String path) throws Exception {
        return exchange(Request.Method.GET, path, "", "application/json", true);
    }

    private HttpResponse<String> post(String path, Object body) throws Exception {
        return exchange(Request.Method.POST, path, mapper.writeValueAsString(body), "application/json", true);
    }

    private HttpResponse<String> login() throws Exception {
        return exchange(Request.Method.POST, "/api/admin/login",
                "username=" + URLEncoder.encode(EMAIL, StandardCharsets.UTF_8)
                        + "&password=" + URLEncoder.encode(PASSWORD, StandardCharsets.UTF_8),
                "application/x-www-form-urlencoded", true);
    }

    private HttpResponse<String> exchange(Request.Method method, String path, String body,
                                          String contentType, boolean validateRequest) throws Exception {
        URI relative = URI.create(path);
        var contract = new SimpleRequest.Builder(method, relative.getPath()).withAccept("application/json");
        var request = HttpRequest.newBuilder(URI.create(base() + path)).timeout(Duration.ofSeconds(15))
                .header("Accept", "application/json").header("Content-Type", contentType);
        if (relative.getRawQuery() != null) {
            for (String pair : relative.getRawQuery().split("&")) {
                String[] parts = pair.split("=", 2);
                contract.withQueryParam(URLDecoder.decode(parts[0], StandardCharsets.UTF_8),
                        URLDecoder.decode(parts[1], StandardCharsets.UTF_8));
            }
        }
        if (method == Request.Method.POST) {
            var csrf = object(get("/api/admin/csrf"));
            String header = (String) csrf.get("headerName");
            String token = (String) csrf.get("token");
            request.header(header, token);
            contract.withHeader(header, token).withContentType(contentType).withBody(body);
        }
        cookies.getCookieStore().getCookies().forEach(cookie ->
                contract.withHeader("Cookie", cookie.getName() + "=" + cookie.getValue()));
        if (validateRequest) { valid(validator.validateRequest(contract.build())); }
        request.method(method.name(), method == Request.Method.GET ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        var response = client.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        responseMatches(relative.getPath(), method, response);
        return response;
    }

    private void responseMatches(String path, Request.Method method, HttpResponse<String> response) {
        var contract = SimpleResponse.Builder.status(response.statusCode());
        response.headers().map().forEach(contract::withHeader);
        if (!response.body().isEmpty()) { contract.withBody(response.body()); }
        var report = validator.validateResponse(path, method, contract.build());
        assertFalse(report.hasErrors(), () -> method + " " + path + " HTTP " + response.statusCode()
                + ": " + report.getMessages());
    }

    private static void valid(ValidationReport report) {
        assertFalse(report.hasErrors(), () -> report.getMessages().toString());
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> object(HttpResponse<String> response) throws Exception {
        return mapper.readValue(response.body(), Map.class);
    }

    private long id(HttpResponse<String> response) throws Exception {
        assertEquals(201, response.statusCode(), response.body());
        return ((Number) object(response).get("id")).longValue();
    }
}
