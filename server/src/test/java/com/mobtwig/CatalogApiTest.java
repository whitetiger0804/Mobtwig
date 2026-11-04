package com.mobtwig;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.test.context.ContextConfiguration;

import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 시험용 MySQL과 실제 HTTP 서버로 홈·작품 상세의 응답 및 집계를 검증합니다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.datasource.hikari.maximum-pool-size=2",
        "spring.datasource.hikari.connection-timeout=2000"
})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class CatalogApiTest {

    private static final long BOOK_ID = -9101L;
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final String BOOK_IDS = "-9101,-9102,-9103,-9104,-9105,"
            + IntStream.range(0, 25).mapToObj(index -> Long.toString(-9110L - index))
                    .collect(Collectors.joining(","));

    @Value("${local.server.port}")
    private int port;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private ObjectMapper mapper;

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5)).build();

    /**
     * DB 초기화 전에 JDBC 주소의 시험용 DB 이름을 검사합니다.
     */
    public static final class TestDatabaseOnly
            implements ApplicationContextInitializer<ConfigurableApplicationContext> {

        @Override
        public void initialize(ConfigurableApplicationContext context) {
            String url = context.getEnvironment().getRequiredProperty("spring.datasource.url");
            if (!url.matches("^jdbc:mysql://[^/]+/(mobtwig_ci|[A-Za-z0-9_]+_test)(?:\\?.*)?$")) {
                throw new IllegalStateException(
                        "통합 검증은 mobtwig_ci 또는 _test로 끝나는 MySQL DB에서만 실행합니다.");
            }
        }
    }

    /** 시험 DB를 확인하고 이번 검증의 자료만 준비합니다. */
    @BeforeEach
    void prepareFixtures() {
        clearFixtures();
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM book", Long.class),
                "시험 DB에 다른 작품이 있어 통합 검증을 중단합니다.");
        ResourceDatabasePopulator populator = new ResourceDatabasePopulator(
                new ClassPathResource("catalog-data.sql"));
        populator.setSqlScriptEncoding(StandardCharsets.UTF_8.name());
        populator.execute(Objects.requireNonNull(jdbc.getDataSource()));
    }

    /** 이번 검증에서 사용한 식별자의 자료만 FK 순서로 정리합니다. */
    @AfterEach
    void clearFixtures() {
        String database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertTrue(database != null && (database.equals("mobtwig_ci")
                || database.matches("[A-Za-z0-9_]+_test")), "시험 DB만 변경할 수 있습니다.");
        jdbc.update("DELETE FROM book_stat_daily WHERE book_id IN (" + BOOK_IDS + ")");
        jdbc.update("DELETE FROM book_author WHERE book_id IN (" + BOOK_IDS + ")");
        jdbc.update("DELETE FROM book_genre WHERE book_id IN (" + BOOK_IDS + ")");
        jdbc.update("DELETE FROM book_category WHERE book_id IN (" + BOOK_IDS + ")");
        jdbc.update("DELETE FROM chapter WHERE book_id IN (" + BOOK_IDS + ")");
        jdbc.update("DELETE FROM book WHERE id IN (" + BOOK_IDS + ")");
        jdbc.update("DELETE FROM author WHERE id IN (-9201,-9202)");
        jdbc.update("DELETE FROM genre WHERE id IN (-9301,-9302)");
        jdbc.update("DELETE FROM category WHERE id IN (-9351,-9352)");
    }

    @Test
    void capturesRealResponsesForClientParsers() throws Exception {
        List<Map<String, Object>> homes = new ArrayList<>();
        for (String kind : List.of("all", "book", "magazine", "novel")) {
            HttpResponse<String> response = get("/sdui/home?kind=" + kind);
            assertEquals(200, response.statusCode());
            assertTrue(response.headers().firstValue("Content-Type").orElse("")
                    .contains("application/json"));
            Map<String, Object> home = object(response);
            assertEquals(1, home.get("version"));
            List<Map<String, Object>> sections = objects(home.get("sections"));
            assertEquals(1, sections.size());
            assertEquals("published-works", sections.getFirst().get("id"));
            assertEquals("workShelf", sections.getFirst().get("type"));
            assertEquals("공개 작품", sections.getFirst().get("title"));
            homes.add(home);
        }
        assertEquals(List.of("test-novel", "test-book", "test-magazine"), ids(items(homes.get(0))));
        assertEquals(List.of("test-book"), ids(items(homes.get(1))));
        assertEquals(List.of("test-magazine"), ids(items(homes.get(2))));
        assertEquals(List.of("test-novel"), ids(items(homes.get(3))));

        List<Map<String, Object>> works = new ArrayList<>();
        for (String slug : List.of("test-book", "test-magazine", "test-novel")) {
            HttpResponse<String> response = get("/works/" + slug);
            assertEquals(200, response.statusCode());
            Map<String, Object> work = object(response);
            assertEquals(slug, work.get("id"));
            works.add(work);
        }
        assertEquals(List.of("book", "magazine", "novel"),
                works.stream().map(work -> work.get("kind")).toList());
        assertEquals("첫째 저자, 둘째 저자", works.get(0).get("author"));
        assertEquals("계약검증 문학 · 계약검증 판타지 · 계약검증 교육", works.get(0).get("category"));
        assertEquals("계약검증 문학 · 계약검증 교육", works.get(1).get("category"));
        assertEquals("계약검증 문학 · 계약검증 판타지", works.get(2).get("category"));
        assertEquals("계약 검증 도서", works.get(0).get("title"));
        assertEquals("한글 도서 소개입니다.", works.get(0).get("description"));

        Path output = Path.of("target", "catalog-contract.json");
        Files.createDirectories(output.getParent());
        Files.writeString(output, mapper.writeValueAsString(Map.of("homes", homes, "works", works)),
                StandardCharsets.UTF_8);
    }

    @Test
    void publishesOnlyReleasedChaptersInChapterOrderAndOmitsAbsentOptions() throws Exception {
        Map<String, Object> book = object(get("/works/test-book"));
        List<Map<String, Object>> contents = objects(book.get("contents"));
        assertEquals(List.of("-9602", "-9601"), ids(contents));
        assertEquals(List.of("첫 번째 목차", "두 번째 목차"),
                contents.stream().map(content -> content.get("title")).toList());
        assertEquals("2000-01-02", contents.getFirst().get("publishedAt"));
        assertFalse(contents.getFirst().containsKey("characterCount"));
        assertFalse(contents.getFirst().containsKey("category"));
        assertFalse(contents.getFirst().containsKey("pageNumber"));
        assertEquals(120, contents.get(1).get("characterCount"));
        for (String absent : List.of("quote", "descriptionTitle", "issue", "publicationCycle")) {
            assertFalse(book.containsKey(absent), absent);
        }
        assertEquals(240, book.get("pageCount"));
        Map<String, Object> magazine = object(get("/works/test-magazine"));
        assertEquals("2026년 11월호", magazine.get("issue"));
        assertEquals("MONTHLY", magazine.get("publicationCycle"));
        Map<String, Object> article = objects(magazine.get("contents")).getFirst();
        assertEquals("문화", article.get("category"));
        assertEquals(3, article.get("pageNumber"));
        assertFalse(object(get("/works/test-novel")).containsKey("pageCount"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "?kind=", "?kind=BOOK", "?kind=unknown",
            "?kind=all&kind=all", "?kind=book&kind=novel"})
    void rejectsMissingInvalidOrRepeatedHomeKind(String query) throws Exception {
        assertEquals(400, get("/sdui/home" + query).statusCode());
    }

    @ParameterizedTest
    @ValueSource(strings = {"TEST-BOOK", "test_book", "test.book"})
    void rejectsMalformedSlugs(String slug) throws Exception {
        assertEquals(400, get("/works/" + slug).statusCode());
    }

    @ParameterizedTest
    @ValueSource(strings = {"test-missing", "test-hidden", "test-draft"})
    void hidesMissingAndUnpublishedWorks(String slug) throws Exception {
        assertEquals(404, get("/works/" + slug).statusCode());
    }

    @Test
    void returnsAnEmptyShelfWhenNoPublishedWorksExist() throws Exception {
        jdbc.update("UPDATE book SET publish_status = 'HIDDEN' WHERE id IN (-9101,-9102,-9103)");
        HttpResponse<String> response = get("/sdui/home?kind=all");
        assertEquals(200, response.statusCode());
        assertEquals(List.of(), items(object(response)));
    }

    @Test
    void limitsTheShelfToTwentyWorksInPublicationAndIdOrder() throws Exception {
        for (int index = 0; index < 25; index++) {
            long id = -9110L - index;
            jdbc.update("""
                    INSERT INTO book (id, content_type, slug, title, description, cover_image_url,
                                      published_date, publisher, file_format, publish_status)
                    VALUES (?, 'BOOK', ?, ?, '추가 검증 작품의 소개입니다.',
                            'https://example.test/extra.png', '2002-01-01',
                            '검증 출판사', 'EPUB', 'PUBLISHED')
                    """, id, "test-extra-" + index, "추가 검증 작품 " + index);
            jdbc.update("INSERT INTO book_author (book_id, author_id) VALUES (?, -9202)", id);
            jdbc.update("INSERT INTO book_genre (book_id, genre_id) VALUES (?, -9302)", id);
        }
        HttpResponse<String> response = get("/sdui/home?kind=book");
        assertEquals(200, response.statusCode());
        assertEquals(IntStream.range(0, 20).mapToObj(index -> "test-extra-" + index).toList(),
                ids(items(object(response))));
    }

    @ParameterizedTest
    @ValueSource(strings = {"description", "cover_image_url", "published_date", "publisher", "file_format"})
    void rejectsIncompletePublishedMetadataWithoutInventingValues(String column) throws Exception {
        jdbc.update("UPDATE book SET " + column + " = NULL WHERE id = ?", BOOK_ID);
        assertEquals(500, get("/works/test-book").statusCode());
        assertEquals(17L, views());
        assertEquals(0L, jdbc.queryForObject(
                "SELECT COUNT(*) FROM book_stat_daily WHERE book_id = ?", Long.class, BOOK_ID));
    }

    @ParameterizedTest
    @ValueSource(strings = {"https://example.test:invalid/cover.png",
            "https://exa mple.test/cover.png", "https://example.test:65536/cover.png"})
    void rejectsImageAddressesTheClientCannotParse(String imageUrl) throws Exception {
        jdbc.update("UPDATE book SET cover_image_url = ? WHERE id = ?", imageUrl, BOOK_ID);
        assertEquals(500, get("/sdui/home?kind=book").statusCode());
        assertEquals(500, get("/works/test-book").statusCode());
        assertEquals(17L, views());
    }

    @Test
    void preservesKoreanAndSpaceCharactersInRelativeCoverAddresses() throws Exception {
        String imageUrl = "/assets/도서/표지 이미지.png";
        jdbc.update("UPDATE book SET cover_image_url = ? WHERE id = ?", imageUrl, BOOK_ID);
        HttpResponse<String> home = get("/sdui/home?kind=book");
        assertEquals(200, home.statusCode());
        assertEquals(imageUrl, items(object(home)).getFirst().get("imageUrl"));
        HttpResponse<String> detail = get("/works/test-book");
        assertEquals(200, detail.statusCode());
        assertEquals(imageUrl, object(detail).get("imageUrl"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"\u00A0", "\uFEFF"})
    void rejectsRequiredTitlesContainingOnlyClientWhitespace(String title) throws Exception {
        jdbc.update("UPDATE book SET title = ? WHERE id = ?", title, BOOK_ID);
        assertEquals(500, get("/sdui/home?kind=book").statusCode());
        assertEquals(500, get("/works/test-book").statusCode());
        assertEquals(17L, views());
    }

    @ParameterizedTest
    @ValueSource(strings = {"\u00A0", "\uFEFF"})
    void omitsOptionalIssueContainingOnlyClientWhitespace(String issue) throws Exception {
        jdbc.update("UPDATE book SET volume_label = ? WHERE id = ?", issue, BOOK_ID);
        HttpResponse<String> response = get("/works/test-book");
        assertEquals(200, response.statusCode());
        Map<String, Object> work = object(response);
        assertEquals("test-book", work.get("id"));
        assertFalse(work.containsKey("issue"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"author", "classification"})
    void rejectsMissingRelatedDisplayMetadata(String relation) throws Exception {
        if (relation.equals("author")) {
            jdbc.update("DELETE FROM book_author WHERE book_id = ?", BOOK_ID);
        } else {
            jdbc.update("DELETE FROM book_genre WHERE book_id = ?", BOOK_ID);
            jdbc.update("DELETE FROM book_category WHERE book_id = ?", BOOK_ID);
        }
        assertEquals(500, get("/works/test-book").statusCode());
    }

    @Test
    void incrementsLifetimeAndKoreanDailyViewsTogether() throws Exception {
        LocalDate before = LocalDate.now(KST);
        assertEquals(200, get("/works/test-book").statusCode());
        assertEquals(200, get("/works/test-book").statusCode());
        LocalDate after = LocalDate.now(KST);
        assertEquals(19L, views());
        assertEquals(2L, jdbc.queryForObject(
                "SELECT SUM(view_count) FROM book_stat_daily WHERE book_id = ?", Long.class, BOOK_ID));
        List<LocalDate> dates = jdbc.query(
                "SELECT stat_date FROM book_stat_daily WHERE book_id = ?",
                (result, index) -> result.getDate(1).toLocalDate(), BOOK_ID);
        for (LocalDate date : dates) {
            assertFalse(date.isBefore(before) || date.isAfter(after));
        }
    }

    @Test
    void preservesTheDetailAndRollsBackBothCountersWhenDailyIncrementFails() throws Exception {
        LocalDate date = LocalDate.now(KST);
        for (LocalDate candidate : List.of(date, date.plusDays(1))) {
            jdbc.update("INSERT INTO book_stat_daily (book_id, stat_date, view_count) VALUES (?, ?, ?)",
                    BOOK_ID, candidate, Integer.MAX_VALUE);
        }
        HttpResponse<String> response = get("/works/test-book");
        assertEquals(200, response.statusCode());
        assertEquals("test-book", object(response).get("id"));
        assertEquals(17L, views());
        assertEquals(2L * Integer.MAX_VALUE, jdbc.queryForObject(
                "SELECT SUM(view_count) FROM book_stat_daily WHERE book_id = ?", Long.class, BOOK_ID));
    }

    @Test
    void doesNotLoseConcurrentViewIncrements() throws Exception {
        List<Future<HttpResponse<String>>> responses = new ArrayList<>();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int index = 0; index < 8; index++) {
                responses.add(executor.submit(() -> get("/works/test-book")));
            }
            for (Future<HttpResponse<String>> response : responses) {
                assertEquals(200, response.get().statusCode());
            }
        }
        assertEquals(25L, views());
        assertEquals(8L, jdbc.queryForObject(
                "SELECT SUM(view_count) FROM book_stat_daily WHERE book_id = ?", Long.class, BOOK_ID));
    }

    @Test
    void allowsTheWebClientToReadPublicResponses() throws Exception {
        for (String path : List.of("/sdui/home?kind=all", "/works/test-book")) {
            HttpRequest request = HttpRequest.newBuilder(address(path))
                    .timeout(Duration.ofSeconds(10)).header("Origin", "http://localhost:8081").GET().build();
            HttpResponse<String> response = client.send(request,
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            assertEquals(200, response.statusCode());
            String allowed = response.headers().firstValue("Access-Control-Allow-Origin").orElse("");
            assertTrue(allowed.equals("*") || allowed.equals("http://localhost:8081"));
        }
    }

    @Test
    void keepsTheDeploymentReadinessEndpointAvailable() throws Exception {
        HttpResponse<String> response = get("/actuator/health/readiness");
        assertEquals(200, response.statusCode());
        assertEquals("UP", object(response).get("status"));
    }

    @Test
    void rejectsNonTestDatabaseAddressesBeforeContextInitialization() {
        for (String database : List.of("mobtwig_dev", "mobtwig_shared", "mobtwig_ci_backup", "test_schema")) {
            try (GenericApplicationContext context = new GenericApplicationContext()) {
                context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("guard", Map.of(
                        "spring.datasource.url", "jdbc:mysql://127.0.0.1:3307/" + database)));
                assertThrows(IllegalStateException.class, () -> new TestDatabaseOnly().initialize(context));
            }
        }
    }

    /** 실제 HTTP 응답을 UTF-8로 수신합니다. */
    private HttpResponse<String> get(String path) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(address(path)).timeout(Duration.ofSeconds(10))
                .header("Accept", "application/json").GET().build();
        return client.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    /** 현재 시험 서버의 요청 주소를 구성합니다. */
    private URI address(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }

    /** 응답의 JSON 객체를 읽습니다. */
    @SuppressWarnings("unchecked")
    private Map<String, Object> object(HttpResponse<String> response) throws Exception {
        return mapper.readValue(response.body(), Map.class);
    }

    /** JSON 객체 배열을 읽습니다. */
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> objects(Object value) {
        return (List<Map<String, Object>>) value;
    }

    /** 홈의 공개 작품 목록을 읽습니다. */
    private List<Map<String, Object>> items(Map<String, Object> home) {
        return objects(objects(home.get("sections")).getFirst().get("items"));
    }

    /** 응답 순서를 유지한 식별자 목록을 반환합니다. */
    private List<Object> ids(List<Map<String, Object>> values) {
        return values.stream().map(value -> value.get("id")).toList();
    }

    /** 검증 작품의 누적 조회 수를 읽습니다. */
    private long views() {
        return jdbc.queryForObject("SELECT view_count FROM book WHERE id = ?", Long.class, BOOK_ID);
    }
}
