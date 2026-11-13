package com.mobtwig;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Objects;
import com.atlassian.oai.validator.OpenApiInteractionValidator;
import com.atlassian.oai.validator.model.Request;
import com.atlassian.oai.validator.model.SimpleResponse;
import io.swagger.v3.core.util.Json;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.parser.OpenAPIV3Parser;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ContextConfiguration;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

/** 전용 MySQL과 실제 HTTP로 공개 검색 및 OpenAPI 계약을 확인합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "mobtwig.admin.bootstrap-enabled=false")
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class WorkSearchApiTest {
    private static final String BOOK_IDS = "-96001,-96002,-96003,-96004,-96005,-96006";
    private static OpenApiInteractionValidator validator;
    private static OpenAPI specification;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private ObjectMapper mapper;
    @Value("${local.server.port}") private int port;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    @BeforeAll
    static void prepareContract() throws Exception {
        String document = new ClassPathResource("static/openapi.yaml")
                .getContentAsString(Objects.requireNonNull(StandardCharsets.UTF_8));
        var parsed = new OpenAPIV3Parser().readContents(document);
        assertTrue(parsed.getMessages().isEmpty(), () -> parsed.getMessages().toString());
        specification = parsed.getOpenAPI();
        validator = OpenApiInteractionValidator.createForInlineApiSpecification(document).build();
    }

    @BeforeEach
    void prepare() {
        cleanup();
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM book", Long.class),
                "시험 DB에 다른 작품이 있어 검색 검증을 중단합니다.");
        jdbc.update("""
                INSERT INTO author(id,name) VALUES(-96101,'검색검증 김과학'),(-96102,'검색검증 이과학')
                """);
        jdbc.update("""
                INSERT INTO book(id,content_type,slug,title,publisher,cover_image_url,published_date,publish_status) VALUES
                (-96001,'BOOK','search-science','과학 입문','모북출판','/media/도서/과학 표지.png','2026-01-03','PUBLISHED'),
                (-96002,'MAGAZINE','search-magazine','과학 월간','다른출판','/media/magazine.png','2026-01-02','PUBLISHED'),
                (-96003,'WEBNOVEL','search-novel','도시의 밤','북빛출판','/media/novel.png','2026-01-01','PUBLISHED'),
                (-96004,'BOOK','search-private','과학 비밀','모북출판','/media/private.png','2026-02-01','HIDDEN'),
                (-96005,'BOOK','search-literal','100% 자바_입문!, 실전','예시출판','/media/literal.png','2025-01-01','PUBLISHED'),
                (-96006,'BOOK','search-other','100점 자바X입문','예시출판','/media/other.png','2025-01-01','PUBLISHED')
                """);
        jdbc.update("""
                INSERT INTO book_author(book_id,author_id) VALUES
                (-96001,-96101),(-96001,-96102),(-96003,-96101),(-96004,-96101)
                """);
    }

    @AfterEach
    void cleanup() {
        String database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertTrue(database != null && (database.equals("mobtwig_ci") || database.matches("[A-Za-z0-9_]+_test")));
        jdbc.update("DELETE FROM book_stat_daily WHERE book_id IN (" + BOOK_IDS + ")");
        jdbc.update("DELETE FROM book_author WHERE book_id IN (" + BOOK_IDS + ")");
        jdbc.update("DELETE FROM book WHERE id IN (" + BOOK_IDS + ")");
        jdbc.update("DELETE FROM author WHERE id IN (-96101,-96102)");
    }

    @Test
    void searchesTitlesAuthorsAndPublishersWithoutDuplicateWorks() throws Exception {
        var response = search("과", "all");
        assertEquals(List.of("search-science", "search-magazine", "search-novel"), ids(results(response)));
        assertEquals(List.of("search-science", "search-novel"), ids(results(search("김과학", "all"))));
        var science = results(search("모북출", "all"));
        assertEquals(List.of("search-science"), ids(science));
        assertEquals("과학 입문", science.path(0).path("title").asString());
        assertEquals("/media/도서/과학 표지.png", science.path(0).path("imageUrl").asString());
        assertEquals("book", science.path(0).path("kind").asString());
    }

    @Test
    void filtersKindsAndDefaultsToAllKinds() throws Exception {
        for (var pair : List.of(List.of("book", "search-science"), List.of("magazine", "search-magazine"),
                List.of("novel", "search-novel"))) {
            assertEquals(List.of(pair.get(1)), ids(results(search("과학", pair.get(0)))));
        }
        assertEquals(3, results(get("/works?query=" + encode("과학"))).size());
        assertEquals(3, results(search(" \u00A0과학\uFEFF ", "all")).size());
    }

    @Test
    void excludesEveryNonPublicStatusIncludingAuthorMatches() throws Exception {
        for (String status : List.of("DRAFT", "PENDING_REVIEW", "REJECTED", "HIDDEN")) {
            jdbc.update("UPDATE book SET publish_status=? WHERE id=-96004", status);
            assertEquals(3, results(search("과학", "all")).size());
        }
        jdbc.update("UPDATE book SET publish_status='PUBLISHED' WHERE id=-96004");
        assertEquals(4, results(search("과학", "all")).size());
    }

    @Test
    void treatsSqlWildcardsAndCommaAsLiteralSearchCharacters() throws Exception {
        for (String query : List.of("%", "_", "!", "입문!, 실전")) {
            assertEquals(List.of("search-literal"), ids(results(search(query, "all"))), query);
        }
        assertEquals(0, results(search("' OR 1=1 --", "all")).size());
    }

    @Test
    void returnsAnEmptyArrayAndUsesDatabaseCaseInsensitiveMatching() throws Exception {
        assertEquals("[]", get("/works?query=not-found-search-104").body());
        jdbc.update("UPDATE book SET title='Java 실전' WHERE id=-96001");
        assertEquals(List.of("search-science"), ids(results(search("jAvA", "all"))));
    }

    @Test
    void ordersEqualPublicationDatesByDescendingDatabaseId() throws Exception {
        jdbc.update("UPDATE book SET published_date='2026-01-01' WHERE id IN (-96001,-96002,-96003)");
        assertEquals(List.of("search-science", "search-magazine", "search-novel"), ids(results(search("과학", "all"))));
    }

    @Test
    void rejectsMissingBlankRepeatedOversizedOrUnsupportedConditions() throws Exception {
        for (String parameters : List.of("", "query=", "query=" + encode(" \u00A0\uFEFF "),
                "query=a&query=b", "query=a&kind=", "query=a&kind=other", "query=a&kind=book&kind=book",
                "query=" + encode("😀".repeat(201)))) {
            assertEquals(400, get("/works?" + parameters).statusCode(), parameters);
        }
        assertEquals(0, results(search("😀".repeat(200), "all")).size());
    }

    @Test
    void doesNotChangeViewCountsOrReaderRecordsAndAllowsPublicCors() throws Exception {
        for (String table : List.of("book_stat_daily", "recent_view", "reading_progress")) {
            long before = Objects.requireNonNull(jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class));
            results(search("과학", "all"));
            assertEquals(before, jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class));
        }
        assertEquals(0L, jdbc.queryForObject("SELECT SUM(view_count) FROM book WHERE id IN (" + BOOK_IDS + ")", Long.class));
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/works?query=a"))
                .header("Origin", "http://localhost:8081").GET().build();
        var response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        assertEquals(200, response.statusCode());
        assertEquals("*", response.headers().firstValue("Access-Control-Allow-Origin").orElseThrow());
    }

    @Test
    void rejectsBrokenPublicMetadataInsteadOfReturningPartialResults() throws Exception {
        jdbc.update("UPDATE book SET cover_image_url=NULL WHERE id=-96001");
        assertEquals(500, search("과학", "all").statusCode());
    }

    @Test
    void validatesThePublishedFoundAndEmptyExamples() throws Exception {
        var examples = specification.getPaths().get("/works").getGet().getResponses().get("200")
                .getContent().get("application/json").getExamples();
        assertEquals(2, examples.size());
        for (var example : examples.values()) validate(Json.mapper().writeValueAsString(example.getValue()));
    }

    private HttpResponse<String> search(String query, String kind) throws Exception {
        return get("/works?query=" + encode(query) + "&kind=" + encode(kind));
    }

    private HttpResponse<String> get(String path) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(10)).GET().build();
        return http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private JsonNode results(HttpResponse<String> response) {
        assertEquals(200, response.statusCode(), response.body());
        validate(response.body());
        return mapper.readTree(response.body());
    }

    private static List<String> ids(JsonNode results) {
        return results.valueStream().map(value -> value.path("id").asString()).toList();
    }

    private static void validate(String body) {
        var report = validator.validateResponse("/works", Request.Method.GET,
                SimpleResponse.Builder.ok().withContentType("application/json").withBody(body).build());
        assertFalse(report.hasErrors(), () -> report.getMessages().toString());
    }
}
