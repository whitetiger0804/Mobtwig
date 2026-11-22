package com.mobtwig;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.mockito.invocation.InvocationOnMock;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementCreator;
import org.springframework.jdbc.core.PreparedStatementSetter;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.SqlProvider;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.doAnswer;

/** 최근 본 기록과 다른 회원 쓰기를 실제 HTTP·동일 회원·동일 작품으로 경합시킵니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=false"
})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class MemberBookLockOrderTest {
    private static final long MEMBER = -18801, OTHER = -18802, BOOK = -18801;
    private static final long REVIEW = 888001, OWN_REVIEW = 888002, COMMENT = 888003, OWN_COMMENT = 888004;
    private static final String SLUG = "lock-order-novel", BASE = "/api/members/";
    @Value("${local.server.port}") int port;
    @MockitoSpyBean JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;
    @Autowired ObjectMapper mapper;
    final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    final List<String> sessions = new ArrayList<>();
    volatile LockProbe probe;

    record Write(String name, String method, String path, String body, int status, boolean ownReview, boolean ownComment) {
        @Override public String toString() { return name; }
    }
    record Session(String cookie, String token) {}
    static final class LockProbe {
        final CountDownLatch memberHeld = new CountDownLatch(1), firstWriterLock = new CountDownLatch(1);
        final CountDownLatch bookHeld = new CountDownLatch(1), releaseReader = new CountDownLatch(1), releaseWriter = new CountDownLatch(1);
        final AtomicBoolean claimed = new AtomicBoolean();
        String firstSql;
    }

    static Stream<Write> writes() {
        String work = BASE + "works/" + SLUG;
        String review = BASE + "reviews/" + REVIEW, comment = BASE + "review-comments/" + COMMENT;
        return Stream.of(
                new Write("찜 추가", "PUT", work + "/favorite", null, 200, false, false),
                new Write("찜 해제", "DELETE", work + "/favorite", null, 200, false, false),
                new Write("구독 추가", "PUT", work + "/subscription", null, 200, false, false),
                new Write("구독 해제", "DELETE", work + "/subscription", null, 200, false, false),
                new Write("리뷰 생성", "POST", work + "/reviews", "{\"rating\":5,\"body\":\"새 리뷰\"}", 201, false, false),
                new Write("리뷰 수정", "PUT", BASE + "reviews/" + OWN_REVIEW, "{\"rating\":5,\"body\":\"수정 리뷰\"}", 200, true, false),
                new Write("리뷰 삭제", "DELETE", BASE + "reviews/" + OWN_REVIEW, null, 204, true, false),
                new Write("댓글 생성", "POST", review + "/comments", "{\"body\":\"새 댓글\"}", 201, false, false),
                new Write("댓글 수정", "PUT", BASE + "review-comments/" + OWN_COMMENT, "{\"body\":\"수정 댓글\"}", 200, false, true),
                new Write("댓글 삭제", "DELETE", BASE + "review-comments/" + OWN_COMMENT, null, 204, false, true),
                new Write("리뷰 공감 추가", "PUT", review + "/like", null, 200, false, false),
                new Write("리뷰 공감 해제", "DELETE", review + "/like", null, 200, false, false),
                new Write("댓글 공감 추가", "PUT", comment + "/like", null, 200, false, false),
                new Write("댓글 공감 해제", "DELETE", comment + "/like", null, 200, false, false),
                new Write("리뷰 신고", "POST", review + "/reports", "{\"reason\":\"SPAM\"}", 201, false, false),
                new Write("댓글 신고", "POST", comment + "/reports", "{\"reason\":\"SPAM\"}", 201, false, false));
    }

    @BeforeEach void fixtures() {
        cleanup();
        String hash = passwords.encode("LockPass19");
        jdbc.update("""
                INSERT INTO member(id,email,nickname,password_hash,role,status) VALUES
                (?, 'lock-actor@example.test','잠금 회원',?,'USER','ACTIVE'),
                (?, 'lock-owner@example.test','다른 회원',?,'USER','ACTIVE')
                """, MEMBER, hash, OTHER, hash);
        jdbc.update("""
                INSERT INTO book(id,content_type,slug,title,cover_image_url,publish_status)
                VALUES(?,'WEBNOVEL',?,'잠금 검증 작품','/media/covers/lock-order.png','PUBLISHED')
                """, BOOK, SLUG);
        jdbc.update("INSERT INTO review(id,book_id,member_id,rating,content) VALUES(?,?,?,4,'기준 리뷰')", REVIEW, BOOK, OTHER);
        jdbc.update("INSERT INTO review_comment(id,review_id,member_id,content) VALUES(?,?,?,'기준 댓글')", COMMENT, REVIEW, OTHER);
        doAnswer(this::coordinate).when(jdbc).query(any(PreparedStatementCreator.class),
                nullable(PreparedStatementSetter.class), org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any());
    }

    /** 잠금 SQL의 실행 전·취득 후 시점만 제어하며 SQL과 트랜잭션은 그대로 실행합니다. */
    Object coordinate(InvocationOnMock call) throws Throwable {
        var current = probe;
        var creator = call.getArgument(0);
        var attributes = RequestContextHolder.getRequestAttributes();
        if (current == null || !(creator instanceof SqlProvider source)
                || !(attributes instanceof ServletRequestAttributes servlet)) return call.callRealMethod();
        String sql = source.getSql().replaceAll("\\s+", " ").strip().toLowerCase(Locale.ROOT);
        String role = servlet.getRequest().getHeader("X-Test-Lock-Role");
        if (!sql.contains(" for update") || !(sql.contains(" from member ") || sql.contains(" from book ")))
            return call.callRealMethod();
        if ("reader".equals(role) && sql.contains(" from member ")) {
            Object result = call.callRealMethod();
            current.memberHeld.countDown();
            assertTrue(current.releaseReader.await(10, TimeUnit.SECONDS), "최근 본 요청의 잠금을 해제하지 못했습니다.");
            return result;
        }
        if ("writer".equals(role) && current.claimed.compareAndSet(false, true)) {
            current.firstSql = sql;
            current.firstWriterLock.countDown();
            Object result = call.callRealMethod();
            if (sql.contains(" from book ")) {
                current.bookHeld.countDown();
                assertTrue(current.releaseWriter.await(10, TimeUnit.SECONDS), "작품 잠금을 해제하지 못했습니다.");
            }
            return result;
        }
        return call.callRealMethod();
    }

    @ParameterizedTest(name = "{0}") @MethodSource("writes")
    void bothFeatureRequestsCommitWithoutMemberBookDeadlock(Write write) throws Exception {
        if (write.ownReview()) jdbc.update("INSERT INTO review(id,book_id,member_id,rating,content) VALUES(?,?,?,4,'본인 리뷰')",
                OWN_REVIEW, BOOK, MEMBER);
        if (write.ownComment()) jdbc.update("INSERT INTO review_comment(id,review_id,member_id,content) VALUES(?,?,?,'본인 댓글')",
                OWN_COMMENT, REVIEW, MEMBER);
        if (write.name().equals("찜 해제")) {
            jdbc.update("INSERT INTO wishlist(member_id,book_id) VALUES(?,?)", MEMBER, BOOK);
            jdbc.update("UPDATE book SET wishlist_count=1 WHERE id=?", BOOK);
        }
        if (write.name().equals("구독 해제")) jdbc.update("INSERT INTO work_subscription(member_id,book_id) VALUES(?,?)", MEMBER, BOOK);
        if (write.name().equals("리뷰 공감 해제")) jdbc.update("INSERT INTO review_like(review_id,member_id) VALUES(?,?)", REVIEW, MEMBER);
        if (write.name().equals("댓글 공감 해제")) jdbc.update("INSERT INTO review_like(review_comment_id,member_id) VALUES(?,?)", COMMENT, MEMBER);
        Session session = login();
        var locks = new LockProbe(); probe = locks;
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                var recent = executor.submit(() -> send("POST", BASE + "recent-works/" + SLUG, null, session, "reader"));
                assertTrue(locks.memberHeld.await(10, TimeUnit.SECONDS), "최근 본 요청이 회원 잠금을 잡지 못했습니다.");
                var mutation = executor.submit(() -> send(write.method(), write.path(), write.body(), session, "writer"));
                assertTrue(locks.firstWriterLock.await(10, TimeUnit.SECONDS), "변경 요청이 잠금에 도달하지 못했습니다.");
                // 수정 전에는 작품을 실제로 잡은 뒤 회원을 기다리게 하여 교착을 결정적으로 만듭니다.
                if (locks.firstSql.contains(" from book "))
                    assertTrue(locks.bookHeld.await(10, TimeUnit.SECONDS), "작품 잠금을 취득하지 못했습니다.");
                locks.releaseReader.countDown(); locks.releaseWriter.countDown();
                var viewed = recent.get(15, TimeUnit.SECONDS);
                var changed = mutation.get(15, TimeUnit.SECONDS);
                System.out.printf("잠금 검증: %s, 첫 SQL: %s, 최근 본 응답: %d, 변경 응답: %d%n",
                        write.name(), locks.firstSql, viewed.statusCode(), changed.statusCode());
                assertEquals(204, viewed.statusCode(), viewed.body());
                assertEquals(write.status(), changed.statusCode(), changed.body());
                assertEquals(1, count("SELECT COUNT(*) FROM recent_view WHERE member_id=? AND book_id=?", MEMBER, BOOK));
                assertStored(write);
            } finally {
                locks.releaseReader.countDown(); locks.releaseWriter.countDown();
            }
        }
    }

    void assertStored(Write write) {
        switch (write.name()) {
            case "찜 추가", "찜 해제" -> {
                int expected = write.method().equals("PUT") ? 1 : 0;
                assertEquals(expected, count("SELECT COUNT(*) FROM wishlist WHERE member_id=? AND book_id=?", MEMBER, BOOK));
                assertEquals(expected, count("SELECT wishlist_count FROM book WHERE id=?", BOOK));
            }
            case "구독 추가", "구독 해제" ->
                assertEquals(write.method().equals("PUT") ? 1 : 0,
                        count("SELECT COUNT(*) FROM work_subscription WHERE member_id=? AND book_id=?", MEMBER, BOOK));
            case "리뷰 생성", "리뷰 수정" -> {
                assertEquals(1, count("SELECT COUNT(*) FROM review WHERE member_id=? AND book_id=? AND rating=5 AND active_key=1", MEMBER, BOOK));
                assertEquals(2, count("SELECT review_count FROM book WHERE id=?", BOOK));
            }
            case "리뷰 삭제" -> {
                assertEquals(0, count("SELECT COUNT(*) FROM review WHERE member_id=? AND book_id=? AND active_key=1", MEMBER, BOOK));
                assertEquals(1, count("SELECT review_count FROM book WHERE id=?", BOOK));
            }
            case "댓글 생성" -> assertEquals(1, count("SELECT COUNT(*) FROM review_comment WHERE review_id=? AND member_id=?", REVIEW, MEMBER));
            case "댓글 수정" -> assertEquals("수정 댓글", jdbc.queryForObject("SELECT content FROM review_comment WHERE id=?", String.class, OWN_COMMENT));
            case "댓글 삭제" -> assertEquals(0, count("SELECT COUNT(*) FROM review_comment WHERE id=?", OWN_COMMENT));
            case "리뷰 공감 추가", "리뷰 공감 해제" ->
                assertEquals(write.method().equals("PUT") ? 1 : 0, count("SELECT COUNT(*) FROM review_like WHERE review_id=? AND member_id=?", REVIEW, MEMBER));
            case "댓글 공감 추가", "댓글 공감 해제" ->
                assertEquals(write.method().equals("PUT") ? 1 : 0, count("SELECT COUNT(*) FROM review_like WHERE review_comment_id=? AND member_id=?", COMMENT, MEMBER));
            case "리뷰 신고" -> assertEquals(1, count("SELECT COUNT(*) FROM review_report WHERE review_id=? AND member_id=?", REVIEW, MEMBER));
            case "댓글 신고" -> assertEquals(1, count("SELECT COUNT(*) FROM review_report WHERE review_comment_id=? AND member_id=?", COMMENT, MEMBER));
            default -> fail("검증하지 않은 쓰기 종류입니다.");
        }
    }

    static Stream<Write> activeMemberWrites() {
        return writes().filter(write -> List.of("찜 추가", "리뷰 생성", "리뷰 신고").contains(write.name()));
    }

    /** 필터의 활성 상태 조회 이후 비활성화가 확정돼도 쓰기 트랜잭션에서 다시 거부합니다. */
    @ParameterizedTest(name = "인증 조회 후 비활성화: {0}") @MethodSource("activeMemberWrites")
    void rejectsMemberDeactivatedAfterAuthenticationCheck(Write write) throws Exception {
        Session session = login();
        var locks = new LockProbe(); probe = locks;
        try (var connection = Objects.requireNonNull(jdbc.getDataSource()).getConnection();
                var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            connection.setAutoCommit(false);
            try {
                try (var statement = connection.prepareStatement("UPDATE member SET status='SUSPENDED' WHERE id=?")) {
                    statement.setLong(1, MEMBER); assertEquals(1, statement.executeUpdate());
                }
                var mutation = executor.submit(() -> send(write.method(), write.path(), write.body(), session, "writer"));
                assertTrue(locks.firstWriterLock.await(10, TimeUnit.SECONDS), "인증 필터 이후 쓰기 잠금에 도달하지 못했습니다.");
                connection.commit(); locks.releaseWriter.countDown();
                var response = mutation.get(15, TimeUnit.SECONDS);
                assertEquals(401, response.statusCode(), response.body());
                assertEquals(0, count("SELECT COUNT(*) FROM wishlist WHERE member_id=?", MEMBER));
                assertEquals(0, count("SELECT COUNT(*) FROM review WHERE member_id=?", MEMBER));
                assertEquals(0, count("SELECT COUNT(*) FROM review_report WHERE member_id=?", MEMBER));
            } finally {
                connection.rollback(); locks.releaseWriter.countDown();
            }
        }
    }

    private int count(String sql, Object... values) { return jdbc.queryForObject(sql, Integer.class, values); }

    Session login() throws Exception {
        var csrf = send("GET", "/api/auth/csrf", null, null, null);
        String anonymous = cookie(csrf);
        String token = mapper.readTree(csrf.body()).get("token").asString();
        var response = http.send(HttpRequest.newBuilder(url("/api/auth/login"))
                .header("Cookie", anonymous).header("X-CSRF-TOKEN", token)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("email=lock-actor%40example.test&password=LockPass19")).build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(204, response.statusCode(), response.body());
        String authenticated = cookie(response);
        var current = send("GET", "/api/auth/csrf", null, new Session(authenticated, ""), null);
        assertEquals(200, current.statusCode());
        return new Session(authenticated, mapper.readTree(current.body()).get("token").asString());
    }

    HttpResponse<String> send(String method, String path, String body, Session session, String role) throws Exception {
        var request = HttpRequest.newBuilder(url(path)).timeout(Duration.ofSeconds(20));
        if (session != null) request.header("Cookie", session.cookie()).header("X-CSRF-TOKEN", session.token());
        if (role != null) request.header("X-Test-Lock-Role", role);
        if (body != null) request.header("Content-Type", "application/json");
        return http.send(request.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }

    String cookie(HttpResponse<?> response) {
        String header = response.headers().allValues("Set-Cookie").stream()
                .filter(value -> value.startsWith("MEMBER_SESSION=")).findFirst().orElseThrow();
        String pair = header.substring(0, header.indexOf(';'));
        sessions.add(new String(Base64.getDecoder().decode(pair.substring("MEMBER_SESSION=".length())), StandardCharsets.UTF_8));
        return pair;
    }

    private URI url(String path) { return URI.create("http://127.0.0.1:" + port + path); }

    @AfterEach void cleanup() {
        probe = null;
        String database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertTrue(database != null && (database.equals("mobtwig_ci") || database.matches("[A-Za-z0-9_]+_test")));
        for (String id : sessions) jdbc.update("DELETE FROM SPRING_SESSION WHERE SESSION_ID=?", id);
        sessions.clear();
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME IN ('-18801','-18802')");
        jdbc.update("DELETE FROM review_report WHERE member_id IN (?,?)", MEMBER, OTHER);
        jdbc.update("DELETE FROM review_like WHERE member_id IN (?,?)", MEMBER, OTHER);
        jdbc.update("DELETE FROM review_comment WHERE review_id IN (SELECT id FROM review WHERE book_id=?)", BOOK);
        jdbc.update("DELETE FROM review WHERE book_id=?", BOOK);
        jdbc.update("DELETE FROM recent_view WHERE book_id=?", BOOK);
        jdbc.update("DELETE FROM wishlist WHERE book_id=?", BOOK);
        jdbc.update("DELETE FROM work_subscription WHERE book_id=?", BOOK);
        jdbc.update("DELETE FROM book WHERE id=?", BOOK);
        jdbc.update("DELETE FROM member WHERE id IN (?,?)", MEMBER, OTHER);
    }
}
