package com.mobtwig;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ContextConfiguration;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

/** 전용 MySQL에서 실제 공개 시각·소유 작품·HTTP와 읽기 부작용을 검증합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "mobtwig.admin.bootstrap-enabled=false", "mobtwig.reader.content-root=./target/reader-api-content"
})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class ReaderApiTest {
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Value("${local.server.port}") int port;
    final HttpClient client = HttpClient.newHttpClient();

    @BeforeEach void prepare() throws Exception {
        cleanup();
        Path root = Path.of("target/reader-api-content"); Files.createDirectories(root);
        Files.writeString(root.resolve("one.txt"), "첫 본문 🌱\r\n\n둘째 줄");
        Files.writeString(root.resolve("empty.txt"), "");
        jdbc.update("INSERT INTO book(id,content_type,slug,title,publish_status) VALUES(-9501,'WEBNOVEL','reader-api','본문 검증','PUBLISHED'),(-9502,'BOOK','reader-hidden','숨김','HIDDEN')");
        insert(-9511, -9501, 2, "2000-01-01 00:00:00", "/content/one.txt");
        insert(-9519, -9501, 9, "2000-01-01 00:00:00", "/content/empty.txt");
        insert(-9513, -9501, 3, null, "/content/one.txt");
        insert(-9515, -9501, 5, java.time.LocalDateTime.now(java.time.ZoneOffset.UTC).plusDays(1).toString().replace('T', ' '), "/content/one.txt");
        insert(-9521, -9502, 1, "2000-01-01 00:00:00", "/content/one.txt");
    }

    @AfterEach void cleanup() {
        String database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertTrue(database != null && (database.equals("mobtwig_ci") || database.matches("[A-Za-z0-9_]+_test")));
        jdbc.update("DELETE FROM chapter WHERE book_id IN (-9501,-9502)");
        jdbc.update("DELETE FROM book WHERE id IN (-9501,-9502)");
    }

    @Test void publishedNavigationExcludesDraftFutureAndOtherWorkAndNeverWritesProgressOrViews() throws Exception {
        var responses = new ArrayList<Object>();
        for (String id : List.of("-9511", "-9519")) {
            var http = get("/works/reader-api/chapters/" + id); assertEquals(200, http.statusCode());
            var json = mapper.readTree(http.body()); assertEquals(2, json.get("contents").size());
            assertEquals(3, json.get("contentVersion").asInt());
            assertEquals(id, json.get("chapter").get("id").asString());
            if (id.equals("-9511")) { assertTrue(json.get("previous").isNull()); assertEquals("-9519", json.get("next").get("id").asString()); }
            else { assertTrue(json.get("next").isNull()); assertEquals("", json.get("body").asString()); }
            responses.add(json);
        }
        Files.writeString(Path.of("target/reader-db-contract.json"), mapper.writeValueAsString(responses));
        for (String id : List.of("-9513", "-9515", "-9521", "missing")) assertEquals(404, get("/works/reader-api/chapters/" + id).statusCode());
        assertEquals(404, get("/works/reader-hidden/chapters/-9521").statusCode());
        assertEquals(404, get("/content/one.txt").statusCode());
        assertEquals(0L, jdbc.queryForObject("SELECT view_count FROM book WHERE id=-9501", Long.class));
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM book_stat_daily WHERE book_id=-9501", Long.class));
        assertEquals(123, jdbc.queryForObject("SELECT char_count FROM chapter WHERE id=-9511", Integer.class));
    }

    @Test void keepsLegacyUrlsAndReportsUnsupportedOrUnavailableWithoutLeakingThem() throws Exception {
        for (String url : List.of("https://127.0.0.1/secret.html", "/content/old.html", "/content/old.epub")) {
            jdbc.update("UPDATE chapter SET content_url=? WHERE id=-9511", url);
            var response = get("/works/reader-api/chapters/-9511"); assertEquals(415, response.statusCode());
            assertFalse(response.body().contains(url));
            assertEquals(url, jdbc.queryForObject("SELECT content_url FROM chapter WHERE id=-9511", String.class));
        }
        jdbc.update("UPDATE chapter SET content_url='/content/missing.txt' WHERE id=-9511");
        assertEquals(503, get("/works/reader-api/chapters/-9511").statusCode());
    }

    private void insert(long id, long work, int number, String published, String url) {
        jdbc.update("INSERT INTO chapter(id,book_id,chapter_no,title,published_at,char_count,content_version,content_url) VALUES(?,?,?,?,?,123,3,?)",
                id, work, number, "공개 장 " + number, published, url);
    }
    private HttpResponse<String> get(String path) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).GET().build(), HttpResponse.BodyHandlers.ofString());
    }
}
