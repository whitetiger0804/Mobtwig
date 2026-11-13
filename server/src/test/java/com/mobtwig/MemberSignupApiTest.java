package com.mobtwig;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import com.mobtwig.auth.MemberSignupRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.doAnswer;

/** 전용 MySQL에서 가입 HTTP 요청, 실제 동의 저장과 롤백을 검사합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=false",
        "mobtwig.auth.signup-demo-enabled=true"
})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class MemberSignupApiTest {
    private static final String PASSWORD = "Abcdef12";
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired PasswordEncoder passwords;
    @MockitoSpyBean MemberSignupRepository repository;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final List<String> emails = new ArrayList<>();
    private final List<String> sessions = new ArrayList<>();

    @AfterEach void cleanup() {
        String database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertTrue(database != null && (database.equals("mobtwig_ci") || database.matches("[A-Za-z0-9_]+_test")));
        for (String session : sessions) jdbc.update("DELETE FROM SPRING_SESSION WHERE SESSION_ID=?", session);
        for (String email : emails) {
            jdbc.update("DELETE FROM member_policy_consent WHERE member_id IN (SELECT id FROM member WHERE email=?)", email);
            jdbc.update("DELETE FROM member_reading_setting WHERE member_id IN (SELECT id FROM member WHERE email=?)", email);
            jdbc.update("DELETE FROM member WHERE email=?", email);
        }
    }

    @Test void storesTheDisplayedDocumentsAndDefaultSettingsWithoutSigningIn() throws Exception {
        var current = documents();
        var person = fixture();
        var csrf = csrf();
        var input = signupInput(person, current);
        input.put("email", "  " + person.email().toUpperCase(Locale.ROOT) + "  ");
        assertEquals(403, send(signupRequest(input, csrf.cookie(), null)).statusCode());
        assertEquals(0, members(person.email()));
        var before = Instant.now().minusSeconds(1);
        var created = send(signupRequest(input, csrf.cookie(), csrf.token()));
        assertEquals(201, created.statusCode());
        var payload = mapper.readTree(created.body());
        long member = Long.parseLong(payload.get("id").asString());
        assertEquals(person.email(), payload.get("email").asString());
        assertEquals(person.nickname(), payload.get("nickname").asString());
        assertFalse(payload.has("password"));
        assertFalse(payload.has("role"));
        assertEquals(401, send(get("/api/auth/session", csrf.cookie())).statusCode());
        assertEquals("USER", jdbc.queryForObject("SELECT role FROM member WHERE id=?", String.class, member));
        assertEquals("ACTIVE", jdbc.queryForObject("SELECT status FROM member WHERE id=?", String.class, member));
        assertTrue(passwords.matches(PASSWORD, jdbc.queryForObject("SELECT password_hash FROM member WHERE id=?", String.class, member)));
        assertEquals(3, jdbc.queryForObject("SELECT font_size_level FROM member_reading_setting WHERE member_id=?", Integer.class, member));

        var recorded = recorded(member);
        assertEquals(2, recorded.size());
        assertEquals(recorded.getFirst().agreedAt(), recorded.getLast().agreedAt());
        for (var doc : current) {
            var row = recorded.stream().filter(r -> r.kind().equals(doc.get("kind").asString())).findFirst().orElseThrow();
            assertEquals(doc.get("version").asString(), row.version());
            assertEquals(doc.get("title").asString(), row.title());
            assertEquals(doc.get("body").asString(), row.body());
            assertEquals(doc.get("contentHash").asString(), row.hash());
            assertEquals(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(row.body().getBytes(StandardCharsets.UTF_8))), row.hash());
            assertTrue(row.temporary());
            assertTrue(row.agreedAt().isAfter(before) && !row.agreedAt().isAfter(Instant.now().plusSeconds(1)));
        }
        var duplicate = send(signupRequest(input, csrf.cookie(), csrf.token()));
        assertEquals(409, duplicate.statusCode());
        assertTrue(mapper.readTree(duplicate.body()).get("fieldErrors").has("email"));
        assertTrue(mapper.readTree(duplicate.body()).get("fieldErrors").has("nickname"));
        assertEquals(recorded, recorded(member));

        var login = HttpRequest.newBuilder(url("/api/auth/login")).timeout(Duration.ofSeconds(15))
                .header("Cookie", csrf.cookie()).header("X-CSRF-TOKEN", csrf.token())
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("email=" + URLEncoder.encode(person.email(), StandardCharsets.UTF_8)
                        + "&password=" + PASSWORD)).build();
        var authenticated = send(login);
        assertEquals(204, authenticated.statusCode());
        var memberCookie = capture(authenticated);
        assertEquals(200, send(get("/api/auth/session", memberCookie)).statusCode());
        var another = fixture();
        var memberToken = send(get("/api/auth/csrf", memberCookie));
        var secondSignup = send(signupRequest(signupInput(another, current), memberCookie,
                mapper.readTree(memberToken.body()).get("token").asString()));
        assertEquals(409, secondSignup.statusCode());
        assertEquals(0, members(another.email()));
    }

    @Test void rejectsConsentAndRoleErrorsBeforeCreatingAnything() throws Exception {
        var current = documents();
        var person = fixture();
        var csrf = csrf();
        var input = signupInput(person, current);
        input.put("role", "ADMIN");
        var response = send(signupRequest(input, csrf.cookie(), csrf.token()));
        assertEquals(400, response.statusCode());
        assertTrue(mapper.readTree(response.body()).get("fieldErrors").has("request"));
        input.remove("role");
        input.put("consents", List.of(agreement(current.getFirst(), false)));
        response = send(signupRequest(input, csrf.cookie(), csrf.token()));
        assertEquals(400, response.statusCode());
        assertTrue(mapper.readTree(response.body()).get("fieldErrors").has("terms"));
        assertTrue(mapper.readTree(response.body()).get("fieldErrors").has("privacy"));
        var outdated = agreement(current.getLast(), true);
        outdated.put("version", "older-demo");
        input.put("consents", List.of(agreement(current.getFirst(), true), outdated));
        response = send(signupRequest(input, csrf.cookie(), csrf.token()));
        assertEquals(409, response.statusCode());
        assertTrue(mapper.readTree(response.body()).get("fieldErrors").has("privacy"));
        assertEquals(0, members(person.email()));
    }

    @Test void rollsBackMemberSettingsAndConsentsOnLateWriteFailure() throws Exception {
        var current = documents();
        var person = fixture();
        var csrf = csrf();
        var failedId = new AtomicLong();
        doAnswer(invocation -> {
            long id = invocation.getArgument(0);
            failedId.set(id);
            invocation.callRealMethod();
            assertEquals(2, recorded(id).size());
            assertEquals(1, settings(id));
            throw new DataAccessResourceFailureException("private-test-write-failure");
        }).when(repository).insertConsents(anyLong(), anyList(), any(Instant.class));
        var response = send(signupRequest(signupInput(person, current), csrf.cookie(), csrf.token()));
        assertEquals(500, response.statusCode());
        assertFalse(response.body().contains("private-test-write-failure"));
        assertTrue(failedId.get() > 0);
        assertEquals(0, members(person.email()));
        assertEquals(0, settings(failedId.get()));
        assertTrue(recorded(failedId.get()).isEmpty());
    }

    @Test void concurrentSignupLeavesOneAccountAndOneSetOfConsents() throws Exception {
        var current = documents();
        var first = fixture();
        var second = new Person(first.email(), fixture().nickname());
        var firstCsrf = csrf();
        var secondCsrf = csrf();
        var one = http.sendAsync(signupRequest(signupInput(first, current), firstCsrf.cookie(), firstCsrf.token()), HttpResponse.BodyHandlers.ofString());
        var two = http.sendAsync(signupRequest(signupInput(second, current), secondCsrf.cookie(), secondCsrf.token()), HttpResponse.BodyHandlers.ofString());
        var responses = List.of(one.get(20, TimeUnit.SECONDS), two.get(20, TimeUnit.SECONDS));
        assertEquals(List.of(201, 409), responses.stream().map(HttpResponse::statusCode).sorted().toList());
        var loser = responses.stream().filter(response -> response.statusCode() == 409).findFirst().orElseThrow();
        assertTrue(mapper.readTree(loser.body()).get("fieldErrors").has("email"));
        assertEquals(1, members(first.email()));
        long id = jdbc.queryForObject("SELECT id FROM member WHERE email=?", Long.class, first.email());
        assertEquals(1, settings(id));
        assertEquals(2, recorded(id).size());
    }

    private Person fixture() {
        String id = UUID.randomUUID().toString().substring(0, 12);
        String email = "signup-test-" + id + "@example.test";
        emails.add(email);
        return new Person(email, "signup-" + id);
    }
    private long members(String email) { return jdbc.queryForObject("SELECT COUNT(*) FROM member WHERE email=?", Long.class, email); }
    private long settings(long id) { return jdbc.queryForObject("SELECT COUNT(*) FROM member_reading_setting WHERE member_id=?", Long.class, id); }
    private List<ConsentRow> recorded(long id) {
        return jdbc.query("""
                SELECT document_kind,document_version,document_title,document_body,content_hash,temporary,agreed_at
                FROM member_policy_consent WHERE member_id=? ORDER BY document_kind
                """, (row, number) -> new ConsentRow(row.getString(1), row.getString(2), row.getString(3),
                row.getString(4), row.getString(5), row.getBoolean(6), row.getTimestamp(7).toInstant()), id);
    }
    private List<JsonNode> documents() throws Exception {
        var response = send(get("/api/auth/terms", null));
        assertEquals(200, response.statusCode());
        var result = new ArrayList<JsonNode>();
        mapper.readTree(response.body()).get("documents").forEach(result::add);
        assertEquals(2, result.size());
        return result;
    }
    private Csrf csrf() throws Exception {
        var response = send(get("/api/auth/csrf", null));
        assertEquals(200, response.statusCode());
        return new Csrf(capture(response), mapper.readTree(response.body()).get("token").asString());
    }
    private String capture(HttpResponse<?> response) {
        var header = response.headers().allValues("Set-Cookie").stream().filter(v -> v.startsWith("MEMBER_SESSION=")).findFirst().orElseThrow();
        String cookie = header.substring(0, header.indexOf(';'));
        sessions.add(new String(Base64.getDecoder().decode(cookie.substring("MEMBER_SESSION=".length())), StandardCharsets.UTF_8));
        return cookie;
    }
    private Map<String, Object> signupInput(Person person, List<JsonNode> current) {
        return new LinkedHashMap<>(Map.of("email", person.email(), "nickname", person.nickname(),
                "password", PASSWORD, "passwordConfirmation", PASSWORD,
                "consents", current.stream().map(doc -> agreement(doc, true)).toList()));
    }
    private Map<String, Object> agreement(JsonNode doc, boolean agreed) {
        return new LinkedHashMap<>(Map.of("kind", doc.get("kind").asString(), "version", doc.get("version").asString(),
                "contentHash", doc.get("contentHash").asString(), "agreed", agreed));
    }
    private HttpRequest get(String path, String cookie) {
        var request = HttpRequest.newBuilder(url(path)).timeout(Duration.ofSeconds(15));
        if (cookie != null) request.header("Cookie", cookie);
        return request.GET().build();
    }
    private HttpRequest signupRequest(Map<String, Object> input, String cookie, String token) {
        var request = HttpRequest.newBuilder(url("/api/auth/signup")).timeout(Duration.ofSeconds(15))
                .header("Cookie", cookie).header("Content-Type", "application/json");
        if (token != null) request.header("X-CSRF-TOKEN", token);
        return request.POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(input))).build();
    }
    private URI url(String path) { return URI.create("http://127.0.0.1:" + port + path); }
    private HttpResponse<String> send(HttpRequest request) throws Exception {
        return http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    private record Person(String email, String nickname) { }
    private record Csrf(String cookie, String token) { }
    private record ConsentRow(String kind, String version, String title, String body, String hash, boolean temporary, Instant agreedAt) { }
}
