package com.mobtwig;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.SQLException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ContextConfiguration;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

/** 실제 HTTP와 전용 MySQL로 리뷰·댓글 공감 및 신고의 접근·중복·동시성을 확인합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=false"})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class ReviewEngagementApiTest {
    private static final String REVIEWS = "/api/members/reviews/";
    private static final String COMMENTS = "/api/members/review-comments/";
    private static final String MEMBERS = "-13901,-13902,-13903";
    private static final String REVIEW_IDS = "-13901,-13902,-13903,-13904";
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired PasswordEncoder passwords;
    final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    record Session(String cookie, String csrf) {}

    /** 다른 검증과 겹치지 않는 음수 식별자의 회원·공개 및 비공개 대상을 준비합니다. */
    @BeforeEach void seed() {
        cleanup();
        var hash = passwords.encode("TestPass19");
        jdbc.update("""
                INSERT INTO member(id,email,nickname,password_hash,role,status) VALUES
                (-13901,'engagement-a@example.test','공감 독자 하나',?,'USER','ACTIVE'),
                (-13902,'engagement-b@example.test','공감 독자 둘',?,'USER','ACTIVE'),
                (-13903,'engagement-c@example.test','공감 독자 셋',?,'USER','ACTIVE')
                """, hash, hash, hash);
        jdbc.update("""
                INSERT INTO book(id,content_type,slug,title,publish_status) VALUES
                (-13901,'WEBNOVEL','engagement-public','반응 공개 작품','PUBLISHED'),
                (-13902,'BOOK','engagement-hidden','반응 비공개 작품','HIDDEN')
                """);
        jdbc.update("""
                INSERT INTO review(id,book_id,member_id,rating,content,deleted_at) VALUES
                (-13901,-13901,-13901,5,'공개 리뷰',NULL),
                (-13902,-13901,-13902,4,'다른 회원 리뷰',NULL),
                (-13903,-13901,-13901,3,'삭제된 리뷰','2026-01-01 00:00:00'),
                (-13904,-13902,-13901,2,'비공개 작품 리뷰',NULL)
                """);
        jdbc.update("""
                INSERT INTO review_comment(id,review_id,member_id,content) VALUES
                (-13901,-13901,-13902,'공개 댓글'),
                (-13902,-13903,-13902,'삭제된 리뷰에 남은 댓글'),
                (-13903,-13904,-13902,'비공개 작품 댓글')
                """);
    }

    /** 전용 DB를 확인하고 이번 검증의 세션과 FK 자식부터 정리합니다. */
    @AfterEach void cleanup() {
        var database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertTrue(database != null && (database.equals("mobtwig_ci") || database.matches("[A-Za-z0-9_]+_test")));
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME IN ('-13901','-13902','-13903')");
        for (String table : List.of("review_like", "review_report")) {
            jdbc.update("DELETE FROM " + table + " WHERE member_id IN (" + MEMBERS + ") OR review_id IN (" + REVIEW_IDS
                    + ") OR review_comment_id IN (SELECT id FROM review_comment WHERE review_id IN (" + REVIEW_IDS + "))");
        }
        jdbc.update("DELETE FROM review_comment WHERE review_id IN (" + REVIEW_IDS + ")");
        jdbc.update("DELETE FROM review WHERE id IN (" + REVIEW_IDS + ")");
        jdbc.update("DELETE FROM book WHERE id IN (-13901,-13902)");
        jdbc.update("DELETE FROM member WHERE id IN (" + MEMBERS + ")");
    }

    /** 리뷰와 댓글 모두 중복 공감·해제를 허용하고 다른 회원의 공감을 보존합니다. */
    @Test void likeCountsAndMemberStatesRemainIndependent() throws Exception {
        var a = login("a");
        var b = login("b");
        var c = login("c");
        for (String target : List.of(REVIEWS + "-13901", COMMENTS + "-13901")) {
            var other = target.startsWith(REVIEWS) ? b : a;
            like(send("DELETE", target + "/like", c, null), 0, false);
            like(send("PUT", target + "/like", c, null), 1, true);
            like(send("PUT", target + "/like", c, null), 1, true);
            like(send("PUT", target + "/like", other, null), 2, true);
            like(send("DELETE", target + "/like", c, null), 1, false);
            like(send("DELETE", target + "/like", c, null), 1, false);
            like(send("PUT", target + "/like", other, null), 1, true);
            like(send("DELETE", target + "/like", other, null), 0, false);
        }
        assertEquals(0L, count("review_like", "review_id=-13901 OR review_comment_id=-13901"));
    }

    /** 본인 리뷰·댓글의 공감·신고는 차단하되 다른 회원이 쓴 자기 리뷰의 댓글은 허용합니다. */
    @Test void authorsCannotLikeOrReportTheirOwnTargets() throws Exception {
        var a = login("a");
        var b = login("b");
        for (String method : List.of("PUT", "DELETE")) {
            error(send(method, REVIEWS + "-13901/like", a, null), 400);
            error(send(method, COMMENTS + "-13901/like", b, null), 400);
        }
        error(send("POST", REVIEWS + "-13901/reports", a, "{\"reason\":\"SPAM\"}"), 400);
        error(send("POST", COMMENTS + "-13901/reports", b, "{\"reason\":\"SPAM\"}"), 400);
        assertEquals(0L, count("review_like", "member_id IN (" + MEMBERS + ")"));
        assertEquals(0L, count("review_report", "member_id IN (" + MEMBERS + ")"));
        like(send("PUT", COMMENTS + "-13901/like", a, null), 1, true);
    }

    /** 중복 신고는 최초 사유·상세를 보존하고 신고자 자신의 접수 결과만 공개합니다. */
    @Test void reportsKeepOriginalReasonsAndExposeOnlyOwnReceipt() throws Exception {
        var a = login("a");
        var b = login("b");
        var c = login("c");
        String detail = "😀".repeat(500);
        String firstBody = mapper.writeValueAsString(java.util.Map.of("reason", "SPAM", "detail", " \t　﻿" + detail + "  "));
        for (String target : List.of(REVIEWS + "-13901", COMMENTS + "-13901")) {
            String id = receipt(send("POST", target + "/reports", c, firstBody), 201);
            assertEquals(id, receipt(send("POST", target + "/reports", c,
                    "{\"reason\":\"SPOILER\",\"detail\":\"바뀐 사유\"}"), 200));
            assertEquals("SPAM", jdbc.queryForObject("SELECT reason FROM review_report WHERE id=?", String.class, id));
            assertEquals(detail, jdbc.queryForObject("SELECT detail FROM review_report WHERE id=?", String.class, id));
            var other = target.startsWith(REVIEWS) ? b : a;
            String otherId = receipt(send("POST", target + "/reports", other, "{\"reason\":\"OTHER\",\"detail\":null}"), 201);
            assertNotEquals(id, otherId);
            assertNull(jdbc.queryForObject("SELECT detail FROM review_report WHERE id=?", String.class, otherId));
            assertEquals(2L, count("review_report", (target.startsWith(REVIEWS) ? "review_id" : "review_comment_id") + "=-13901"));
        }
    }

    /** 기존 게시글 신고의 모든 사유를 허용하고 빈 상세는 NULL로 저장합니다. */
    @Test void acceptsExistingReportReasonsAndNormalizesBlankDetails() throws Exception {
        var c = login("c");
        int index = 0;
        for (String reason : List.of("SPAM", "ABUSE", "INAPPROPRIATE", "SPOILER", "OTHER")) {
            long comment = -13910L - index++;
            jdbc.update("INSERT INTO review_comment(id,review_id,member_id,content) VALUES (?,-13901,-13901,'신고 사유 확인 댓글')", comment);
            String body = mapper.writeValueAsString(java.util.Map.of("reason", reason, "detail", " \t　 ﻿"));
            String id = receipt(send("POST", COMMENTS + comment + "/reports", c, body), 201);
            assertEquals(reason, jdbc.queryForObject("SELECT reason FROM review_report WHERE id=?", String.class, id));
            assertNull(jdbc.queryForObject("SELECT detail FROM review_report WHERE id=?", String.class, id));
        }
    }

    /** 모든 쓰기 경로가 인증을 요구하고 인증된 요청에는 CSRF를 요구합니다. */
    @Test void requiresMemberSessionAndCsrfForEveryEndpoint() throws Exception {
        var c = login("c");
        for (String target : List.of(REVIEWS + "-13901", COMMENTS + "-13901")) {
            for (String method : List.of("PUT", "DELETE", "POST")) {
                String path = target + (method.equals("POST") ? "/reports" : "/like");
                String body = method.equals("POST") ? "{\"reason\":\"SPAM\"}" : null;
                assertEquals(401, send(method, path, null, body).statusCode());
                assertEquals(403, send(method, path, new Session(c.cookie(), null), body).statusCode());
                assertEquals(403, send(method, path, new Session(c.cookie(), "invalid"), body).statusCode());
            }
        }
    }

    /** 추가 필드·잘못된 타입·500자를 넘는 상세와 BIGINT 범위 밖 식별자를 거부합니다. */
    @Test void validatesReportBodiesAndSignedBigintIdentifiers() throws Exception {
        var c = login("c");
        for (String target : List.of(REVIEWS + "-13901", COMMENTS + "-13901")) {
            for (String invalid : List.of("{", "{}", "null", "[]", "{\"reason\":null}", "{\"reason\":1}",
                    "{\"reason\":\"spam\"}", "{\"reason\":\"UNKNOWN\"}", "{\"reason\":\"SPAM\",\"detail\":1}",
                    "{\"reason\":\"SPAM\",\"detail\":[]}", "{\"reason\":\"SPAM\",\"memberId\":\"-13901\"}",
                    "{\"reason\":\"SPAM\",\"detail\":null,\"extra\":true}",
                    "{\"reason\":\"SPAM\",\"detail\":\"" + "😀".repeat(501) + "\"}")) {
                error(send("POST", target + "/reports", c, invalid), 400);
            }
        }
        for (String prefix : List.of(REVIEWS, COMMENTS)) {
            for (String invalid : List.of("abc", "0", "01", "-01", "1.0", "--1", "9223372036854775808", "-9223372036854775809", "00000000000000000000")) {
                error(send("PUT", prefix + invalid + "/like", c, null), 400);
                error(send("DELETE", prefix + invalid + "/like", c, null), 400);
                error(send("POST", prefix + invalid + "/reports", c, "{\"reason\":\"SPAM\"}"), 400);
            }
            for (String validButAbsent : List.of("-9223372036854775808", "9223372036854775807")) {
                error(send("PUT", prefix + validButAbsent + "/like", c, null), 404);
            }
        }
        assertEquals(0L, count("review_report", "member_id IN (" + MEMBERS + ")"));
    }

    /** 비공개·삭제·누락 대상은 감추고 삭제된 리뷰에 남은 공개 댓글은 허용합니다. */
    @Test void rejectsUnavailableTargetsAndAllowsCommentsUnderDeletedReviews() throws Exception {
        var c = login("c");
        for (String target : List.of(REVIEWS + "-13903", REVIEWS + "-13904", REVIEWS + "-13999",
                COMMENTS + "-13903", COMMENTS + "-13999")) {
            error(send("PUT", target + "/like", c, null), 404);
            error(send("DELETE", target + "/like", c, null), 404);
            error(send("POST", target + "/reports", c, "{\"reason\":\"SPAM\"}"), 404);
        }
        like(send("PUT", COMMENTS + "-13902/like", c, null), 1, true);
        receipt(send("POST", COMMENTS + "-13902/reports", c, "{\"reason\":\"SPAM\"}"), 201);
        like(send("DELETE", COMMENTS + "-13902/like", c, null), 0, false);
        assertEquals(1L, count("review_report", "review_comment_id=-13902"));
    }

    /** 댓글 실제 삭제는 댓글 반응만 함께 지우고 리뷰 반응은 유지합니다. */
    @Test void deletingCommentCascadesOnlyItsLikesAndReports() throws Exception {
        var b = login("b");
        var c = login("c");
        for (String target : List.of(REVIEWS + "-13901", COMMENTS + "-13901")) {
            like(send("PUT", target + "/like", c, null), 1, true);
            receipt(send("POST", target + "/reports", c, "{\"reason\":\"ABUSE\"}"), 201);
        }
        assertEquals(204, send("DELETE", COMMENTS + "-13901", b, null).statusCode());
        assertEquals(0L, count("review_comment", "id=-13901"));
        for (String table : List.of("review_like", "review_report")) {
            assertEquals(0L, count(table, "review_comment_id=-13901"));
            assertEquals(1L, count(table, "review_id=-13901"));
        }
        error(send("PUT", COMMENTS + "-13901/like", c, null), 404);
        error(send("POST", COMMENTS + "-13901/reports", c, "{\"reason\":\"SPAM\"}"), 404);
    }

    /** 병렬 공감·해제·신고에도 중복 행과 집계 오차가 생기지 않습니다. */
    @Test void parallelLikesAndReportsAreIdempotentAndKeepActualCounts() throws Exception {
        var a = login("a");
        var b = login("b");
        var c = login("c");
        for (String target : List.of(REVIEWS + "-13901", COMMENTS + "-13901")) {
            var additions = new ArrayList<CompletableFuture<HttpResponse<String>>>();
            for (int i = 0; i < 6; i++) additions.add(async("PUT", target + "/like", c, null));
            for (var addition : additions) like(addition.get(20, TimeUnit.SECONDS), 1, true);
            var removals = new ArrayList<CompletableFuture<HttpResponse<String>>>();
            for (int i = 0; i < 6; i++) removals.add(async("DELETE", target + "/like", c, null));
            for (var removal : removals) like(removal.get(20, TimeUnit.SECONDS), 0, false);
            var other = target.startsWith(REVIEWS) ? b : a;
            var mixed = List.of(async("PUT", target + "/like", c, null), async("PUT", target + "/like", other, null),
                    async("PUT", target + "/like", c, null), async("PUT", target + "/like", other, null));
            for (var request : mixed) {
                var response = json(request.get(20, TimeUnit.SECONDS), 200);
                assertTrue(response.get("liked").asBoolean());
                assertTrue(response.get("likeCount").asLong() == 1 || response.get("likeCount").asLong() == 2);
            }
            like(send("PUT", target + "/like", c, null), 2, true);
            String condition = (target.startsWith(REVIEWS) ? "review_id" : "review_comment_id") + "=-13901";
            assertEquals(2L, count("review_like", condition));
            var reports = new ArrayList<CompletableFuture<HttpResponse<String>>>();
            for (int i = 0; i < 6; i++) reports.add(async("POST", target + "/reports", c,
                    "{\"reason\":\"SPAM\",\"detail\":\"최초 접수\"}"));
            var responses = new ArrayList<HttpResponse<String>>();
            for (var report : reports) responses.add(report.get(20, TimeUnit.SECONDS));
            assertEquals(1L, responses.stream().filter(response -> response.statusCode() == 201).count());
            assertEquals(5L, responses.stream().filter(response -> response.statusCode() == 200).count());
            var ids = new java.util.HashSet<String>();
            for (var response : responses) ids.add(receipt(response, response.statusCode()));
            assertEquals(1, ids.size());
            assertEquals(1L, count("review_report", condition));
            String id = ids.iterator().next();
            assertEquals(id, receipt(send("POST", target + "/reports", c, "{\"reason\":\"OTHER\"}"), 200));
            assertEquals("SPAM", jdbc.queryForObject("SELECT reason FROM review_report WHERE id=?", String.class, id));
            assertEquals("최초 접수", jdbc.queryForObject("SELECT detail FROM review_report WHERE id=?", String.class, id));
        }
    }

    /** 저장소 제약도 대상이 없거나 둘인 행과 회원별 중복 반응을 차단합니다. */
    @Test void databaseRequiresExactlyOneTargetAndRejectsDuplicateMemberTargets() {
        for (String table : List.of("review_like", "review_report")) {
            String extraColumn = table.equals("review_report") ? ",reason" : "";
            String extraValue = table.equals("review_report") ? ",'SPAM'" : "";
            var noTarget = assertThrows(DataAccessException.class, () -> jdbc.update("INSERT INTO " + table
                    + "(member_id" + extraColumn + ") VALUES (-13903" + extraValue + ")"));
            assertEquals(3819, assertInstanceOf(SQLException.class, noTarget.getMostSpecificCause()).getErrorCode());
            var bothTargets = assertThrows(DataAccessException.class, () -> jdbc.update("INSERT INTO " + table
                    + "(member_id,review_id,review_comment_id" + extraColumn + ") VALUES (-13903,-13901,-13901" + extraValue + ")"));
            assertEquals(3819, assertInstanceOf(SQLException.class, bothTargets.getMostSpecificCause()).getErrorCode());
            jdbc.update("INSERT INTO " + table + "(member_id,review_id" + extraColumn + ") VALUES (-13903,-13901" + extraValue + ")");
            assertThrows(DataIntegrityViolationException.class, () -> jdbc.update("INSERT INTO " + table
                    + "(member_id,review_id" + extraColumn + ") VALUES (-13903,-13901" + extraValue + ")"));
            jdbc.update("INSERT INTO " + table + "(member_id,review_comment_id" + extraColumn + ") VALUES (-13903,-13901" + extraValue + ")");
            assertThrows(DataIntegrityViolationException.class, () -> jdbc.update("INSERT INTO " + table
                    + "(member_id,review_comment_id" + extraColumn + ") VALUES (-13903,-13901" + extraValue + ")"));
        }
    }

    private long count(String table, String condition) {
        return java.util.Objects.requireNonNull(jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE " + condition, Long.class));
    }

    private Session login(String label) throws Exception {
        var token = send(base("/api/auth/csrf").GET().build());
        var login = send(base("/api/auth/login").header("Cookie", cookie(token))
                .header("X-CSRF-TOKEN", json(token, 200).get("token").asString())
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("email=engagement-" + label + "%40example.test&password=TestPass19")).build());
        assertEquals(204, login.statusCode());
        String cookie = cookie(login);
        var csrf = send(base("/api/auth/csrf").header("Cookie", cookie).GET().build());
        return new Session(cookie, json(csrf, 200).get("token").asString());
    }

    private static String cookie(HttpResponse<String> response) {
        return response.headers().allValues("Set-Cookie").stream().filter(value -> value.startsWith("MEMBER_SESSION="))
                .map(value -> value.substring(0, value.indexOf(';'))).findFirst().orElseThrow();
    }

    private HttpRequest request(String method, String path, Session session, String body) {
        var request = base(path);
        if (session != null) {
            request.header("Cookie", session.cookie());
            if (session.csrf() != null) request.header("X-CSRF-TOKEN", session.csrf());
        }
        if (body != null) request.header("Content-Type", "application/json");
        return request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build();
    }

    private HttpRequest.Builder base(String path) {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(15));
    }

    private HttpResponse<String> send(String method, String path, Session session, String body) throws Exception {
        return send(request(method, path, session, body));
    }

    private CompletableFuture<HttpResponse<String>> async(String method, String path, Session session, String body) {
        return http.sendAsync(request(method, path, session, body), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> send(HttpRequest request) throws Exception {
        return http.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private JsonNode json(HttpResponse<String> response, int status) {
        assertEquals(status, response.statusCode(), response.body());
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        return mapper.readTree(response.body());
    }

    private void like(HttpResponse<String> response, long count, boolean liked) {
        var body = json(response, 200);
        assertEquals(Set.of("likeCount", "liked"), Set.copyOf(body.propertyNames()));
        assertEquals(count, body.get("likeCount").asLong());
        assertEquals(liked, body.get("liked").asBoolean());
    }

    private String receipt(HttpResponse<String> response, int status) {
        var body = json(response, status);
        assertEquals(Set.of("id", "reported"), Set.copyOf(body.propertyNames()));
        assertTrue(body.get("id").isString());
        assertTrue(body.get("id").asString().matches("[0-9]+"));
        assertTrue(body.get("reported").asBoolean());
        return body.get("id").asString();
    }

    private void error(HttpResponse<String> response, int status) {
        var body = json(response, status);
        assertEquals(Set.of("message"), Set.copyOf(body.propertyNames()));
        assertTrue(body.get("message").isString());
        assertFalse(body.get("message").asString().isBlank());
    }
}
