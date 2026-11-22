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

/** 실제 HTTP와 전용 MySQL로 리뷰·댓글 권한, 삭제 자리표시와 동시 집계를 확인합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=false"})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class WorkReviewApiTest {
    private static final String GET = "/works/review-public/reviews";
    private static final String POST = "/api/members/works/review-public/reviews";
    private static final String MEMBER_GET = "/api/members/works/review-public/reviews";
    private static final String FIELDS = "id,rating,body,nickname,createdAt,commentCount,likeCount,mine,liked,reported,deleted";
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
        jdbc.update("""
                DELETE FROM review_report WHERE member_id IN (-13801,-13802)
                OR review_id IN (SELECT id FROM review WHERE book_id IN (-13801,-13802))
                OR review_comment_id IN (SELECT c.id FROM review_comment c JOIN review r ON r.id=c.review_id WHERE r.book_id IN (-13801,-13802))
                """);
        jdbc.update("""
                DELETE FROM review_like WHERE member_id IN (-13801,-13802)
                OR review_id IN (SELECT id FROM review WHERE book_id IN (-13801,-13802))
                OR review_comment_id IN (SELECT c.id FROM review_comment c JOIN review r ON r.id=c.review_id WHERE r.book_id IN (-13801,-13802))
                """);
        jdbc.update("DELETE FROM review_comment WHERE review_id IN (SELECT id FROM review WHERE book_id IN (-13801,-13802))");
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
        assertEquals(0, body.get("totalItems").asInt());
        assertTrue(body.get("myReview").isNull());
        assertEquals(401, get(MEMBER_GET).statusCode());
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
        assertTrue(review.get("mine").asBoolean());
        assertFalse(review.get("deleted").asBoolean());
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

    @Test void memberPagesReturnOwnReviewOutsidePageAndPublicReadsIgnoreSession() throws Exception {
        var a = login("a");
        var b = login("b");
        var own = json(post(POST, a, "{\"rating\":5,\"body\":\"내 리뷰\"}"), 201);
        var other = json(post(POST, b, "{\"rating\":2}"), 201);
        var memberResponse = get(MEMBER_GET + "?size=1", a);
        contract("/api/members/works/{slug}/reviews", Request.Method.GET, memberResponse);
        var memberPage = json(memberResponse, 200);
        assertEquals(own.get("id"), memberPage.get("myReview").get("id"));
        assertTrue(memberPage.get("myReview").get("mine").asBoolean());
        assertEquals(other.get("id"), memberPage.get("items").get(0).get("id"));
        assertFalse(memberPage.get("items").get(0).get("mine").asBoolean());
        assertEquals(2, memberPage.get("totalItems").asInt());
        json(get(MEMBER_GET + "?size=0", a), 400);
        var publicPage = json(get(GET, a), 200);
        assertTrue(publicPage.get("myReview").isNull());
        for (var item : publicPage.get("items")) {
            assertFalse(item.get("mine").asBoolean());
            assertFalse(item.get("liked").asBoolean());
            assertFalse(item.get("reported").asBoolean());
        }
    }

    @Test void ownReviewUpdateDeleteAndRecreateKeepCachesAndHideOriginal() throws Exception {
        var a = login("a");
        var b = login("b");
        var created = json(post(POST, a, "{\"rating\":5,\"body\":\"삭제 전 원문\"}"), 201);
        String id = created.get("id").asString();
        String path = "/api/members/reviews/" + id;
        assertEquals(401, change("PUT", path, null, "{\"rating\":1}").statusCode());
        assertEquals(403, change("PUT", path, new Session(a.cookie(), null), "{\"rating\":1}").statusCode());
        assertEquals(403, change("DELETE", path, new Session(a.cookie(), "invalid"), null).statusCode());
        assertEquals(404, change("PUT", path, b, "{\"rating\":1}").statusCode());
        assertEquals(404, change("DELETE", path, b, null).statusCode());
        for (String invalid : List.of("{}", "{\"rating\":1.0}", "{\"rating\":6}", "{\"rating\":2,\"body\":false}",
                "{\"rating\":2,\"unknown\":true}", "{\"rating\":2,\"body\":\"" + "😀".repeat(1001) + "\"}")) {
            json(change("PUT", path, a, invalid), 400);
        }
        var response = change("PUT", path, a, "{\"rating\":2,\"body\":\"　수정 내용 \"}");
        contract("/api/members/reviews/{reviewId}", Request.Method.PUT, response);
        var updated = json(response, 200);
        assertEquals(id, updated.get("id").asString());
        assertEquals(created.get("createdAt"), updated.get("createdAt"));
        assertEquals("수정 내용", updated.get("body").asString());
        assertEquals(2.0, summaryAverage());
        assertEquals(1, summaryCount());
        assertEquals(204, change("DELETE", path, a, null).statusCode());
        assertEquals(0.0, summaryAverage());
        assertEquals(0, summaryCount());
        assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM review WHERE id=? AND deleted_at IS NOT NULL AND active_key IS NULL", Long.class, id));
        var empty = json(get(MEMBER_GET, a), 200);
        assertTrue(empty.get("averageRating").isNull());
        assertEquals(0, empty.get("totalItems").asInt());
        assertTrue(empty.get("myReview").isNull());
        var thread = json(get("/reviews/" + id + "/comments"), 200);
        assertDeleted(thread.get("review"));
        assertTrue(thread.get("items").isEmpty());
        assertEquals(404, change("PUT", path, a, "{\"rating\":4}").statusCode());
        assertEquals(404, change("DELETE", path, a, null).statusCode());
        var recreated = json(post(POST, a, "{\"rating\":4}"), 201);
        assertNotEquals(id, recreated.get("id").asString());
        assertEquals(4.0, summaryAverage());
        assertEquals(1, summaryCount());
        assertEquals(0L, jdbc.queryForObject("SELECT view_count FROM book WHERE id=-13801", Long.class));
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM reading_progress WHERE book_id=-13801", Long.class));
    }

    @Test void commentsHaveOwnerPermissionsUnicodeLimitsAndStableOrder() throws Exception {
        var a = login("a");
        var b = login("b");
        String id = json(post(POST, a, "{\"rating\":4}"), 201).get("id").asString();
        String path = "/api/members/reviews/" + id + "/comments";
        assertEquals(401, get(path).statusCode());
        assertEquals(401, post(path, null, "{\"body\":\"댓글\"}").statusCode());
        assertEquals(403, post(path, new Session(a.cookie(), null), "{\"body\":\"댓글\"}").statusCode());
        for (String invalid : List.of("{", "{}", "null", "[]", "{\"body\":null}", "{\"body\":1}",
                "{\"body\":\" \\t　 \"}", "{\"body\":\"댓글\",\"memberId\":\"-13802\"}",
                "{\"body\":\"" + "😀".repeat(501) + "\"}")) {
            json(post(path, a, invalid), 400);
        }
        String content = "😀".repeat(500);
        var response = post(path, a, "{\"body\":\"　" + content + " \"}");
        contract("/api/members/reviews/{reviewId}/comments", Request.Method.POST, response);
        var first = json(response, 201);
        assertEquals(content, first.get("body").asString());
        assertTrue(first.get("mine").asBoolean());
        var second = json(post(path, b, "{\"body\":\"둘째 댓글\"}"), 201);
        jdbc.update("UPDATE review_comment SET created_at='2026-01-01 00:00:00' WHERE review_id=?", id);
        var threadResponse = get("/api/members/reviews/" + id + "/comments", a);
        contract("/api/members/reviews/{reviewId}/comments", Request.Method.GET, threadResponse);
        var thread = json(threadResponse, 200);
        assertEquals(first.get("id"), thread.get("items").get(0).get("id"));
        assertEquals(second.get("id"), thread.get("items").get(1).get("id"));
        assertEquals(2, thread.get("review").get("commentCount").asInt());
        assertTrue(thread.get("items").get(0).get("mine").asBoolean());
        assertFalse(thread.get("items").get(1).get("mine").asBoolean());
        String firstPath = "/api/members/review-comments/" + first.get("id").asString();
        assertEquals(404, change("PUT", firstPath, b, "{\"body\":\"다른 회원 수정\"}").statusCode());
        assertEquals(404, change("DELETE", firstPath, b, null).statusCode());
        assertEquals(403, change("DELETE", firstPath, new Session(a.cookie(), null), null).statusCode());
        json(change("PUT", firstPath, a, "{\"body\":\"　 \"}"), 400);
        var editResponse = change("PUT", firstPath, a, "{\"body\":\" 수정 댓글 \"}");
        contract("/api/members/review-comments/{commentId}", Request.Method.PUT, editResponse);
        assertEquals("수정 댓글", json(editResponse, 200).get("body").asString());
        assertEquals(204, change("DELETE", firstPath, a, null).statusCode());
        assertEquals(404, change("DELETE", firstPath, a, null).statusCode());
        var remaining = json(get("/reviews/" + id + "/comments"), 200);
        assertEquals(1, remaining.get("items").size());
        assertEquals(1, remaining.get("review").get("commentCount").asInt());
        assertFalse(remaining.get("items").get(0).get("mine").asBoolean());
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM review_comment WHERE id=?", Long.class, first.get("id").asString()));
    }

    @Test void deletedReviewWithCommentsUsesSeparateDisplayCountAndAllowsCommentOwnerChanges() throws Exception {
        var a = login("a");
        var b = login("b");
        String review = json(post(POST, a, "{\"rating\":5,\"body\":\"삭제 원문\"}"), 201).get("id").asString();
        String comment = json(post("/api/members/reviews/" + review + "/comments", b, "{\"body\":\"남은 댓글\"}"), 201).get("id").asString();
        assertEquals(204, change("DELETE", "/api/members/reviews/" + review, a, null).statusCode());
        var placeholder = json(get(MEMBER_GET, a), 200);
        assertEquals(0, placeholder.get("reviewCount").asInt());
        assertEquals(1, placeholder.get("totalItems").asInt());
        assertTrue(placeholder.get("averageRating").isNull());
        assertDeleted(placeholder.get("items").get(0));
        String newer = json(post(POST, a, "{\"rating\":3}"), 201).get("id").asString();
        var first = json(get(GET + "?size=1"), 200);
        var second = json(get(GET + "?size=1&page=2"), 200);
        assertEquals(1, first.get("reviewCount").asInt());
        assertEquals(2, first.get("totalItems").asInt());
        assertTrue(first.get("hasNext").asBoolean());
        assertFalse(second.get("hasNext").asBoolean());
        assertEquals(newer, first.get("items").get(0).get("id").asString());
        assertDeleted(second.get("items").get(0));
        assertEquals(404, post("/api/members/reviews/" + review + "/comments", b, "{\"body\":\"새 댓글\"}").statusCode());
        String commentPath = "/api/members/review-comments/" + comment;
        assertEquals("삭제 후 수정", json(change("PUT", commentPath, b, "{\"body\":\"삭제 후 수정\"}"), 200).get("body").asString());
        var thread = json(get("/reviews/" + review + "/comments"), 200);
        assertDeleted(thread.get("review"));
        assertEquals(1, thread.get("items").size());
        assertEquals(204, change("DELETE", commentPath, b, null).statusCode());
        assertEquals(1, json(get(GET), 200).get("totalItems").asInt());
        assertTrue(json(get("/reviews/" + review + "/comments"), 200).get("items").isEmpty());
    }

    @Test void hiddenWorksRejectReviewAndCommentReadsAndChanges() throws Exception {
        var a = login("a");
        String review = json(post(POST, a, "{\"rating\":4}"), 201).get("id").asString();
        String comment = json(post("/api/members/reviews/" + review + "/comments", a, "{\"body\":\"댓글\"}"), 201).get("id").asString();
        jdbc.update("UPDATE book SET publish_status='HIDDEN' WHERE id=-13801");
        assertEquals(404, get(MEMBER_GET, a).statusCode());
        assertEquals(404, get("/reviews/" + review + "/comments").statusCode());
        assertEquals(404, get("/api/members/reviews/" + review + "/comments", a).statusCode());
        assertEquals(404, change("PUT", "/api/members/reviews/" + review, a, "{\"rating\":1}").statusCode());
        assertEquals(404, change("DELETE", "/api/members/reviews/" + review, a, null).statusCode());
        assertEquals(404, post("/api/members/reviews/" + review + "/comments", a, "{\"body\":\"추가\"}").statusCode());
        assertEquals(404, change("PUT", "/api/members/review-comments/" + comment, a, "{\"body\":\"수정\"}").statusCode());
        assertEquals(404, change("DELETE", "/api/members/review-comments/" + comment, a, null).statusCode());
        assertEquals(4.0, summaryAverage());
        assertEquals(1, summaryCount());
    }

    @Test void memberSpecificEngagementAndWithdrawnNamesStayOutOfPublicIdentity() throws Exception {
        var a = login("a");
        var b = login("b");
        String review = json(post(POST, a, "{\"rating\":5}"), 201).get("id").asString();
        String comment = json(post("/api/members/reviews/" + review + "/comments", a, "{\"body\":\"댓글\"}"), 201).get("id").asString();
        jdbc.update("INSERT INTO review_like(member_id,review_id) VALUES (-13802,?)", review);
        jdbc.update("INSERT INTO review_like(member_id,review_comment_id) VALUES (-13802,?)", comment);
        jdbc.update("INSERT INTO review_report(member_id,review_id,reason) VALUES (-13802,?,'SPAM')", review);
        jdbc.update("INSERT INTO review_report(member_id,review_comment_id,reason) VALUES (-13802,?,'SPAM')", comment);
        var member = json(get("/api/members/reviews/" + review + "/comments", b), 200);
        for (var item : List.of(member.get("review"), member.get("items").get(0))) {
            assertEquals(1, item.get("likeCount").asInt());
            assertTrue(item.get("liked").asBoolean());
            assertTrue(item.get("reported").asBoolean());
            assertFalse(item.get("mine").asBoolean());
        }
        assertTrue(json(get(MEMBER_GET, b), 200).get("myReview").isNull());
        var publicThread = json(get("/reviews/" + review + "/comments", b), 200);
        for (var item : List.of(publicThread.get("review"), publicThread.get("items").get(0))) {
            assertEquals(1, item.get("likeCount").asInt());
            assertFalse(item.get("liked").asBoolean());
            assertFalse(item.get("reported").asBoolean());
        }
        assertEquals(204, change("DELETE", "/api/members/reviews/" + review, a, null).statusCode());
        assertDeleted(json(get("/api/members/reviews/" + review + "/comments", b), 200).get("review"));
        jdbc.update("UPDATE member SET nickname=NULL,status='WITHDRAWN',withdrawn_at=CURRENT_TIMESTAMP WHERE id=-13801");
        var withdrawn = json(get("/reviews/" + review + "/comments"), 200);
        assertEquals("탈퇴한 회원", withdrawn.get("items").get(0).get("nickname").asString());
        assertDeleted(withdrawn.get("review"));
        String active = json(post(POST, b, "{\"rating\":2}"), 201).get("id").asString();
        jdbc.update("UPDATE member SET nickname=NULL,status='WITHDRAWN',withdrawn_at=CURRENT_TIMESTAMP WHERE id=-13802");
        var activeWithdrawn = json(get(GET), 200).get("items").get(0);
        assertEquals(active, activeWithdrawn.get("id").asString());
        assertEquals("탈퇴한 회원", activeWithdrawn.get("nickname").asString());
        assertFalse(activeWithdrawn.get("deleted").asBoolean());
    }

    @Test void signedFixtureIdentifiersAndRangeValidationApplyToAllTargets() throws Exception {
        var a = login("a");
        jdbc.update("INSERT INTO review(id,book_id,member_id,rating) VALUES (-13811,-13801,-13801,4)");
        jdbc.update("INSERT INTO review_comment(id,review_id,member_id,content) VALUES (-13812,-13811,-13801,'기존 댓글')");
        json(get("/reviews/-13811/comments"), 200);
        json(change("PUT", "/api/members/reviews/-13811", a, "{\"rating\":3}"), 200);
        json(change("PUT", "/api/members/review-comments/-13812", a, "{\"body\":\"수정\"}"), 200);
        for (String id : List.of("abc", "9223372036854775808", "-9223372036854775809")) {
            json(get("/reviews/" + id + "/comments"), 400);
            json(change("PUT", "/api/members/reviews/" + id, a, "{\"rating\":3}"), 400);
            json(change("DELETE", "/api/members/review-comments/" + id, a, null), 400);
        }
        assertEquals(404, get("/reviews/-13899/comments").statusCode());
        assertEquals(404, change("PUT", "/api/members/reviews/-13899", a, "{\"rating\":3}").statusCode());
        assertEquals(404, change("DELETE", "/api/members/review-comments/-13899", a, null).statusCode());
    }

    @Test void concurrentUpdateAndDeleteRecalculateLastActiveRating() throws Exception {
        var a = login("a");
        var b = login("b");
        String first = json(post(POST, a, "{\"rating\":5}"), 201).get("id").asString();
        String second = json(post(POST, b, "{\"rating\":2}"), 201).get("id").asString();
        var update = http.sendAsync(mutationRequest("PUT", "/api/members/reviews/" + first, a, "{\"rating\":1}"), HttpResponse.BodyHandlers.ofString());
        var delete = http.sendAsync(mutationRequest("DELETE", "/api/members/reviews/" + second, b, null), HttpResponse.BodyHandlers.ofString());
        json(update.get(), 200);
        assertEquals(204, delete.get().statusCode());
        assertEquals(1, summaryCount());
        assertEquals(1.0, summaryAverage());
        var page = json(get(GET), 200);
        assertEquals(1, page.get("reviewCount").asInt());
        assertEquals(1, page.get("totalItems").asInt());
        assertEquals(1, page.get("ratingDistribution").get("1").asInt());
        assertEquals(0, page.get("ratingDistribution").get("2").asInt());
        assertEquals(1.0, page.get("averageRating").asDouble());
    }

    @Test void concurrentCommentAndParentDeleteKeepThreadAndCountsConsistent() throws Exception {
        var a = login("a");
        var b = login("b");
        String review = json(post(POST, a, "{\"rating\":5}"), 201).get("id").asString();
        var comment = http.sendAsync(postRequest("/api/members/reviews/" + review + "/comments", b, "{\"body\":\"동시 댓글\"}"), HttpResponse.BodyHandlers.ofString());
        var delete = http.sendAsync(mutationRequest("DELETE", "/api/members/reviews/" + review, a, null), HttpResponse.BodyHandlers.ofString());
        assertEquals(204, delete.get().statusCode());
        int commentStatus = comment.get().statusCode();
        assertTrue(commentStatus == 201 || commentStatus == 404, comment.get().body());
        var thread = json(get("/reviews/" + review + "/comments"), 200);
        assertDeleted(thread.get("review"));
        int expected = commentStatus == 201 ? 1 : 0;
        assertEquals(expected, thread.get("items").size());
        assertEquals(expected, thread.get("review").get("commentCount").asInt());
        var page = json(get(GET), 200);
        assertEquals(expected, page.get("totalItems").asInt());
        assertEquals(0, page.get("reviewCount").asInt());
        assertEquals(0, summaryCount());
        assertEquals(0.0, summaryAverage());
    }

    @Test void concurrentChangesKeepEachPageAndThreadInOneSnapshot() throws Exception {
        var a = login("a");
        var b = login("b");
        String review = json(post(POST, a, "{\"rating\":5}"), 201).get("id").asString();
        json(post(POST, b, "{\"rating\":2}"), 201);
        var comments = new java.util.ArrayList<java.util.concurrent.CompletableFuture<HttpResponse<String>>>();
        var updates = new java.util.ArrayList<java.util.concurrent.CompletableFuture<HttpResponse<String>>>();
        for (int i = 0; i < 8; i++) {
            comments.add(http.sendAsync(postRequest("/api/members/reviews/" + review + "/comments", b,
                    "{\"body\":\"댓글 " + i + "\"}"), HttpResponse.BodyHandlers.ofString()));
            updates.add(http.sendAsync(mutationRequest("PUT", "/api/members/reviews/" + review, a,
                    "{\"rating\":" + (i % 2 == 0 ? 1 : 5) + "}"), HttpResponse.BodyHandlers.ofString()));
        }
        for (int i = 0; i < 8; i++) {
            var page = json(get(GET), 200);
            long[] distribution = new long[5];
            long points = 0;
            for (var item : page.get("items")) {
                int rating = item.get("rating").asInt();
                distribution[rating - 1]++;
                points += rating;
            }
            assertEquals(2, page.get("reviewCount").asInt());
            assertEquals(2, page.get("totalItems").asInt());
            assertEquals(2, page.get("items").size());
            assertEquals(points / 2.0, page.get("averageRating").asDouble());
            for (int rating = 1; rating <= 5; rating++) {
                assertEquals(distribution[rating - 1], page.get("ratingDistribution").get(Integer.toString(rating)).asLong());
            }
            var thread = json(get("/reviews/" + review + "/comments"), 200);
            assertEquals(thread.get("items").size(), thread.get("review").get("commentCount").asInt());
        }
        for (var comment : comments) json(comment.get(), 201);
        for (var update : updates) json(update.get(), 200);
        var finalThread = json(get("/reviews/" + review + "/comments"), 200);
        assertEquals(8, finalThread.get("items").size());
        assertEquals(8, finalThread.get("review").get("commentCount").asInt());
    }

    private static void assertDeleted(JsonNode item) {
        assertTrue(item.get("deleted").asBoolean());
        assertTrue(item.get("rating").isNull());
        assertTrue(item.get("body").isNull());
        assertTrue(item.get("nickname").isNull());
        assertFalse(item.get("mine").asBoolean());
        assertFalse(item.get("liked").asBoolean());
        assertFalse(item.get("reported").asBoolean());
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
        return mutationRequest("POST", path, session, body);
    }

    private HttpRequest mutationRequest(String method, String path, Session session, String body) {
        var request = base(path).header("Content-Type", "application/json");
        if (session != null) {
            request.header("Cookie", session.cookie());
            if (session.csrf() != null) request.header("X-CSRF-TOKEN", session.csrf());
        }
        return request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build();
    }

    private HttpRequest.Builder base(String path) {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(15));
    }

    private HttpResponse<String> post(String path, Session session, String body) throws Exception { return send(postRequest(path, session, body)); }
    private HttpResponse<String> change(String method, String path, Session session, String body) throws Exception { return send(mutationRequest(method, path, session, body)); }
    private HttpResponse<String> get(String path) throws Exception { return send(base(path).GET().build()); }
    private HttpResponse<String> get(String path, Session session) throws Exception { return send(base(path).header("Cookie", session.cookie()).GET().build()); }
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
