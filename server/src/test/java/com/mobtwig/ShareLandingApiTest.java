package com.mobtwig;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ContextConfiguration;
import static org.junit.jupiter.api.Assertions.*;

/** 공개 공유 문서와 정적 자원이 인증 없이 안전한 헤더로 제공되는지 확인합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "mobtwig.admin.bootstrap-enabled=false")
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class ShareLandingApiTest {
    @Value("${local.server.port}") int port;
    final HttpClient http = HttpClient.newHttpClient();

    @Test void servesPublicLandingWithoutEmbeddingQueryContent() throws Exception {
        var response = get("/s/works/novel-record?title=%3Cscript%3Eevil%3C/script%3E");
        assertEquals(200, response.statusCode());
        assertTrue(response.headers().firstValue("Content-Type").orElseThrow().startsWith("text/html"));
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        assertEquals("no-referrer", response.headers().firstValue("Referrer-Policy").orElseThrow());
        String policy = response.headers().firstValue("Content-Security-Policy").orElseThrow();
        assertTrue(policy.contains("script-src 'self'"));
        assertTrue(policy.contains("connect-src 'self'"));
        assertFalse(policy.contains("unsafe-inline"));
        assertTrue(response.body().contains("설치 준비 중"));
        assertFalse(response.body().contains("evil"));
        assertFalse(response.headers().map().containsKey("set-cookie"));
    }

    @Test void servesOnlySlugRoutesAndStaticResources() throws Exception {
        for (String path : new String[]{"/s/works/INVALID", "/s/works/a/b", "/s/works/" + "a".repeat(121)}) {
            assertEquals(404, get(path).statusCode());
        }
        assertEquals(200, get("/s/works/missing-work").statusCode());
        for (String file : new String[]{"app.js", "work.js", "style.css", "header.png"}) {
            assertEquals(200, get("/share/" + file).statusCode(), file);
        }
    }

    private HttpResponse<String> get(String path) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }
}
