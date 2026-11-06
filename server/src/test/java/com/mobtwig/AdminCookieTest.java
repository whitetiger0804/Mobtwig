package com.mobtwig;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ContextConfiguration;

import static org.junit.jupiter.api.Assertions.*;

/** 운영용 Secure 쿠키와 HTTPS 프록시 처리를 시험 DB에서 확인합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=true"
})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class AdminCookieTest {
    @Value("${local.server.port}") private int port;
    @Autowired private JdbcTemplate jdbc;

    @Test
    void enforcesSecureHttpOnlySameSiteCookiesAndAcceptsForwardedHttps() throws Exception {
        var client = HttpClient.newHttpClient();
        List<String> sessionIds = new ArrayList<>();
        try {
            for (boolean forwarded : List.of(false, true)) {
                var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/admin/csrf"));
                if (forwarded) { request.header("X-Forwarded-Proto", "https"); }
                var response = client.send(request.GET().build(), HttpResponse.BodyHandlers.discarding());
                assertEquals(200, response.statusCode());
                String cookie = response.headers().allValues("Set-Cookie").stream()
                        .filter(value -> value.startsWith("SESSION=")).findFirst().orElseThrow();
                String value = cookie.substring("SESSION=".length(), cookie.indexOf(';'));
                sessionIds.add(new String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8));
                assertTrue(cookie.contains("Secure"));
                assertTrue(cookie.contains("HttpOnly"));
                assertTrue(cookie.contains("SameSite=Strict"));
                assertEquals(forwarded, response.headers().firstValue("Strict-Transport-Security").isPresent());
            }
        }
        finally {
            for (String id : sessionIds) { jdbc.update("DELETE FROM SPRING_SESSION WHERE SESSION_ID=?", id); }
        }
    }
}
