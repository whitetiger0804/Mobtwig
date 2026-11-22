package com.mobtwig;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.*;
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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.doAnswer;

/** 전용 MySQL과 실제 HTTP에서 커뮤니티 권한·스포일러·초안·첨부의 경계를 확인합니다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"mobtwig.admin.bootstrap-enabled=false", "server.servlet.session.cookie.secure=false"})
@ContextConfiguration(initializers = CatalogApiTest.TestDatabaseOnly.class)
class CommunityApiTest {
    private static final String API = "/api/members/community";
    private static final String PUBLIC = "/community";
    private static final String MEMBERS = "-16101,-16102,-16103";
    private static final String BOOKS = "-16101,-16102,-16103";
    private static final String CREATED_TOPIC = "커뮤니티 생성 검증";
    private static final String CONCURRENT_TOPIC = "커뮤니티 동시 생성 검증";
    private static final Path IMAGE_ROOT = temporaryImages();
    @Value("${local.server.port}") int port;
    @MockitoSpyBean JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired PasswordEncoder passwords;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private String topic;
    private String promotion;
    private String sticker;
    private final List<String> measuredQueries = new CopyOnWriteArrayList<>();
    record Session(String cookie, String csrf) { }

    @DynamicPropertySource static void imageRoot(DynamicPropertyRegistry properties) {
        properties.add("mobtwig.community.image-root", () -> IMAGE_ROOT.toString());
    }

    /** 각 테스트의 첨부 정리가 끝난 빈 전용 디렉터리만 제거합니다. */
    @AfterAll static void removeImageDirectory() throws Exception {
        assertTrue(IMAGE_ROOT.startsWith(Path.of(System.getProperty("java.io.tmpdir")).toAbsolutePath().normalize()));
        Files.delete(IMAGE_ROOT);
    }

    /** 실제 개발 자료와 겹치지 않는 식별자로 검증 자료만 준비합니다. */
    @BeforeEach void seed() throws Exception {
        cleanup();
        String hash = passwords.encode("TestPass19");
        jdbc.update("""
                INSERT INTO member(id,email,nickname,password_hash,role,status) VALUES
                (-16101,'community-a@example.test','커뮤니티 독자 하나',?,'USER','ACTIVE'),
                (-16102,'community-b@example.test','커뮤니티 독자 둘',?,'USER','ACTIVE'),
                (-16103,'community-c@example.test','커뮤니티 독자 셋',?,'USER','ACTIVE')
                """, hash, hash, hash);
        jdbc.update("""
                INSERT INTO book(id,content_type,slug,title,publish_status,cover_image_url) VALUES
                (-16101,'WEBNOVEL','community-public','커뮤니티 공개 소설','PUBLISHED','/test-cover.png'),
                (-16102,'BOOK','community-hidden','커뮤니티 비공개 도서','HIDDEN','/test-cover.png'),
                (-16103,'BOOK','community-other','커뮤니티 다른 도서','PUBLISHED','/test-cover.png')
                """);
        jdbc.update("INSERT INTO author(id,name) VALUES(-16101,'커뮤니티 작가')");
        jdbc.update("INSERT INTO book_author(book_id,author_id) VALUES(-16101,-16101),(-16102,-16101),(-16103,-16101)");
        jdbc.update("""
                INSERT INTO board(id,type,book_id,name) VALUES
                (-16101,'WORK',-16101,NULL),(-16102,'WORK',-16102,NULL),(-16103,'WORK',-16103,NULL)
                """);
        jdbc.update("""
                INSERT INTO chapter(id,book_id,chapter_no,title,published_at) VALUES
                (-16111,-16101,1,'공개 첫 화','2000-01-01 00:00:00'),
                (-16112,-16101,2,'미래 회차',DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 1 DAY)),
                (-16113,-16101,3,'비공개 회차',NULL),
                (-16121,-16103,1,'다른 작품 회차','2000-01-01 00:00:00')
                """);
        topic = jdbc.queryForObject("SELECT CAST(MIN(id) AS CHAR) FROM board WHERE type='TOPIC'", String.class);
        promotion = jdbc.queryForObject("SELECT CAST(MIN(id) AS CHAR) FROM board WHERE type='PROMOTION'", String.class);
        sticker = jdbc.queryForObject("SELECT CAST(id AS CHAR) FROM sticker WHERE code='WAVE'", String.class);
        doAnswer(call -> {
            var request = RequestContextHolder.getRequestAttributes();
            if (request instanceof ServletRequestAttributes servlet
                    && "true".equals(servlet.getRequest().getHeader("X-Test-Community-Queries"))) {
                String sql = ((SqlProvider) call.getArgument(0)).getSql().replaceAll("\\s+", " ").toLowerCase(java.util.Locale.ROOT);
                if (sql.contains(" from post ") || sql.contains(" from post_") || sql.contains(" from board "))
                    measuredQueries.add(sql);
            }
            return call.callRealMethod();
        }).when(jdbc).query(any(PreparedStatementCreator.class), nullable(PreparedStatementSetter.class),
                org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any());
    }

    /** 전용 DB를 다시 확인하고 이번 검증 자료와 전용 임시 첨부만 정리합니다. */
    @AfterEach void cleanup() throws Exception {
        String database = jdbc.queryForObject("SELECT DATABASE()", String.class);
        assertTrue(database != null && (database.equals("mobtwig_ci") || database.matches("[A-Za-z0-9_]+_test")));
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME IN ('-16101','-16102','-16103')");
        for (String table : List.of("post_report", "post_reaction")) {
            jdbc.update("DELETE FROM " + table + " WHERE post_id IN (SELECT id FROM post WHERE member_id IN (" + MEMBERS + "))");
        }
        jdbc.update("DELETE FROM post_comment WHERE post_id IN (SELECT id FROM post WHERE member_id IN (" + MEMBERS + "))");
        jdbc.update("DELETE FROM post WHERE member_id IN (" + MEMBERS + ")");
        jdbc.update("DELETE FROM board WHERE book_id IN (" + BOOKS + ")");
        jdbc.update("DELETE FROM board WHERE type='TOPIC' AND name IN (?,?)", CREATED_TOPIC, CONCURRENT_TOPIC);
        jdbc.update("DELETE FROM chapter WHERE book_id IN (" + BOOKS + ")");
        jdbc.update("DELETE FROM book_author WHERE book_id IN (" + BOOKS + ")");
        jdbc.update("DELETE FROM book WHERE id IN (" + BOOKS + ")");
        jdbc.update("DELETE FROM author WHERE id=-16101");
        jdbc.update("DELETE FROM member WHERE id IN (" + MEMBERS + ")");
        assertTrue(IMAGE_ROOT.toAbsolutePath().normalize().startsWith(Path.of(System.getProperty("java.io.tmpdir")).toAbsolutePath().normalize()));
        try (var paths = Files.walk(IMAGE_ROOT)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) {
                assertTrue(path.toAbsolutePath().normalize().startsWith(IMAGE_ROOT));
                if (!path.equals(IMAGE_ROOT)) Files.delete(path);
            }
        }
    }

    /** 빈 검색·검색어·페이지 조회에서 게시판이 없는 공개 작품도 반환합니다. */
    @Test void discoversPublishedWorksWithTheirOptionalBoards() throws Exception {
        jdbc.update("DELETE FROM board WHERE book_id=-16103");
        var all = json(get(PUBLIC + "/works?query="), 200);
        assertEquals(2, all.get("totalItems").asInt());
        assertEquals(2, all.get("items").size());
        for (var item : all.get("items")) {
            if (item.get("work").get("id").asString().equals("community-other")) assertTrue(item.get("boardId").isNull());
            else assertEquals("-16101", item.get("boardId").asString());
        }
        String query = URLEncoder.encode("커뮤니티", java.nio.charset.StandardCharsets.UTF_8);
        var first = json(get(PUBLIC + "/works?query=" + query + "&size=1"), 200);
        var second = json(get(PUBLIC + "/works?query=" + query + "&size=1&page=2"), 200);
        assertTrue(first.get("hasNext").asBoolean());
        assertFalse(second.get("hasNext").asBoolean());
        assertNotEquals(first.get("items").get(0).get("work").get("id"), second.get("items").get(0).get("work").get("id"));
        assertEquals(2, json(get(PUBLIC + "/works?query=" + URLEncoder.encode("작가", java.nio.charset.StandardCharsets.UTF_8)), 200).get("totalItems").asInt());
        assertEquals(0, json(get(PUBLIC + "/works?query=%25"), 200).get("totalItems").asInt());
        for (String invalid : List.of("?page=0", "?size=51", "?query=a&query=b", "?query=" + "a".repeat(101)))
            assertEquals(400, get(PUBLIC + "/works" + invalid).statusCode());
        var cors = http.send(base(PUBLIC + "/works").header("Origin", "http://localhost:8081").GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals("*", cors.headers().firstValue("Access-Control-Allow-Origin").orElseThrow());
    }

    /** 로그인·CSRF 및 공개 작품 조건을 만족한 회원만 게시판을 생성합니다. */
    @Test void boardCreationRequiresMemberCsrfAndValidTargets() throws Exception {
        var work = Map.of("type", "work", "workId", "community-other");
        assertEquals(401, change("POST", API + "/boards", null, work).statusCode());
        var a = login("a");
        assertEquals(403, change("POST", API + "/boards", new Session(a.cookie(), null), work).statusCode());
        for (Object invalid : List.of(Map.of(), Map.of("type", "promotion", "name", "홍보"),
                Map.of("type", "topic", "name", " \t\uFEFF"), Map.of("type", "topic", "name", "가".repeat(101)),
                Map.of("type", "work", "workId", ""), Map.of("type", "work", "workId", "community-other", "name", "제목"),
                Map.of("type", "topic", "name", "이름", "workId", "community-other"), List.of())) {
            assertEquals(400, change("POST", API + "/boards", a, invalid).statusCode());
        }
        for (String unavailable : List.of("community-hidden", "community-missing"))
            assertEquals(404, change("POST", API + "/boards", a, Map.of("type", "work", "workId", unavailable)).statusCode());
    }

    /** 게시판이 없는 작품에 하나를 생성하고 반복 요청은 기존 게시판을 반환합니다. */
    @Test void createsWorkBoardsWithoutChangingWorks() throws Exception {
        jdbc.update("DELETE FROM board WHERE book_id=-16103");
        var a = login("a");
        var b = login("b");
        var input = Map.of("type", "work", "workId", "community-other");
        var created = json(change("POST", API + "/boards", a, input), 201);
        assertEquals("work", created.get("type").asString());
        assertEquals("community-other", created.get("work").get("id").asString());
        assertEquals(4, created.get("heads").size());
        assertEquals(created.get("id"), json(change("POST", API + "/boards", b, input), 200).get("id"));
        assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM board WHERE book_id=-16103", Long.class));
        assertEquals(3L, jdbc.queryForObject("SELECT COUNT(*) FROM book WHERE id IN (" + BOOKS + ")", Long.class));
        var found = json(get(PUBLIC + "/works?query=" + URLEncoder.encode("다른 도서", java.nio.charset.StandardCharsets.UTF_8)), 200);
        assertEquals(created.get("id"), found.get("items").get(0).get("boardId"));
    }

    /** 주제 이름을 정리하고 검색·중복 반환을 같은 DB 이름으로 처리합니다. */
    @Test void createsAndFindsNamedTopicBoards() throws Exception {
        var a = login("a");
        var created = json(change("POST", API + "/boards", a, Map.of("type", "topic", "name", " \uFEFF" + CREATED_TOPIC + "\t ")), 201);
        assertEquals(CREATED_TOPIC, created.get("name").asString());
        assertTrue(created.get("work").isNull());
        assertEquals(2, created.get("heads").size());
        assertEquals(created.get("id"), json(change("POST", API + "/boards", login("b"), Map.of("type", "topic", "name", CREATED_TOPIC)), 200).get("id"));
        var found = json(get(PUBLIC + "/boards?type=topic&query=" + URLEncoder.encode("생성 검증", java.nio.charset.StandardCharsets.UTF_8)), 200);
        assertEquals(1, found.get("items").size());
        assertEquals(created.get("id"), found.get("items").get(0).get("id"));
        assertEquals(0, json(get(PUBLIC + "/boards?type=topic&query=%25"), 200).get("items").size());
        assertEquals(400, get(PUBLIC + "/boards?query=a&query=b").statusCode());
    }

    /** 서로 다른 회원의 동시 작품·주제 생성도 게시판 하나만 만듭니다. */
    @Test void concurrentBoardCreationKeepsOneBoardPerTarget() throws Exception {
        jdbc.update("DELETE FROM board WHERE book_id=-16103");
        var sessions = List.of(login("a"), login("b"), login("c"));
        for (var input : List.of(Map.of("type", "work", "workId", "community-other"), Map.of("type", "topic", "name", CONCURRENT_TOPIC))) {
            var requests = new ArrayList<java.util.concurrent.CompletableFuture<HttpResponse<String>>>();
            for (int i = 0; i < 6; i++) {
                var session = sessions.get(i % sessions.size());
                var request = base(API + "/boards").header("Cookie", session.cookie()).header("X-CSRF-TOKEN", session.csrf())
                        .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(input))).build();
                requests.add(http.sendAsync(request, HttpResponse.BodyHandlers.ofString()));
            }
            var ids = new java.util.HashSet<String>();
            int created = 0;
            for (var request : requests) {
                var response = request.get(20, java.util.concurrent.TimeUnit.SECONDS);
                assertTrue(List.of(200, 201).contains(response.statusCode()), response.body());
                if (response.statusCode() == 201) created++;
                ids.add(mapper.readTree(response.body()).get("id").asString());
            }
            assertEquals(1, created);
            assertEquals(1, ids.size());
        }
        assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM board WHERE book_id=-16103", Long.class));
        assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM board WHERE type='TOPIC' AND name=?", Long.class, CONCURRENT_TOPIC));
    }

    /** 글이 많은 게시판과 무관하게 각 게시판의 최신 공개글 하나와 집계만 반환합니다. */
    @Test void boardPreviewsChooseLatestVisiblePostPerBoard() throws Exception {
        for (int i = 0; i < 25; i++) insertPost(-16200 - i, -16101, -16101L, "PUBLISHED", "많은 글 " + i);
        insertPost(-16300, -16103, -16103L, "PUBLISHED", "다른 게시판 최신글");
        insertPost(-16150, -16101, -16101L, "HIDDEN", "숨긴 글");
        insertPost(-16151, -16101, -16101L, "DELETED", "삭제한 글");
        insertPost(-16152, -16101, -16101L, "DRAFT", "초안");
        jdbc.update("INSERT INTO post_reaction(post_id,member_id) VALUES(-16200,-16102)");
        jdbc.update("INSERT INTO post_comment(post_id,book_id,member_id,body) VALUES(-16200,-16101,-16102,'댓글')");
        var boards = json(get(PUBLIC + "/boards?type=work"), 200);
        for (var board : boards.get("items")) {
            var preview = board.get("latestPost");
            assertFalse(preview.isNull());
            if (board.get("id").asString().equals("-16101")) {
                assertEquals("-16200", preview.get("id").asString());
                assertEquals(1, preview.get("likeCount").asInt());
                assertEquals(1, preview.get("commentCount").asInt());
                assertFalse(preview.get("hasSpoiler").asBoolean());
                assertFalse(preview.get("locked").asBoolean());
            } else assertEquals("-16300", preview.get("id").asString());
        }
        long topicId = Long.parseLong(topic);
        insertPost(-16310, topicId, null, "PUBLISHED", "공개 주제글");
        insertPost(-16100, topicId, -16102L, "PUBLISHED", "비공개 작품 연결글");
        jdbc.update("UPDATE post SET head='STORY' WHERE board_id=?", topicId);
        var topics = json(get(PUBLIC + "/boards?type=topic"), 200);
        for (var board : topics.get("items")) {
            if (board.get("id").asString().equals(topic)) assertEquals("-16310", board.get("latestPost").get("id").asString());
            else assertTrue(board.get("latestPost").isNull());
        }
        jdbc.update("UPDATE post SET has_spoiler=TRUE WHERE id=-16300");
        for (String path : List.of(PUBLIC + "/boards?type=work", API + "/boards?type=work")) {
            var result = json(get(path, login("a")), 200);
            for (var board : result.get("items")) if (board.get("id").asString().equals("-16103")) {
                var preview = board.get("latestPost");
                assertTrue(preview.get("hasSpoiler").asBoolean());
                assertTrue(preview.get("locked").asBoolean());
                assertTrue(preview.get("title").isNull());
            }
        }
        var existing = json(change("POST", API + "/boards", login("a"), Map.of("type", "work", "workId", "community-other")), 200);
        assertEquals("-16300", existing.get("latestPost").get("id").asString());
        assertTrue(existing.get("latestPost").get("title").isNull());
    }

    /** 회차가 없는 주제 글·댓글도 토글로 원문·검색·첨부를 가리고 다시 공개할 수 있습니다. */
    @Test void standaloneSpoilerFlagsProtectTopicPostsCommentsAndImages() throws Exception {
        var a = login("a");
        var b = login("b");
        var image = upload(a, "png", 8, 8);
        var input = copy(copy(copy(copy(draft(), "boardId", topic), "workId", null), "head", "STORY"), "hasSpoiler", true);
        input.put("images", List.of(imageInput(image)));
        input.put("stickerIds", List.of(sticker));
        input.put("body", "회차 없는 스포일러 원문");
        var published = create(a, input);
        String post = published.get("id").asString();
        assertTrue(published.get("hasSpoiler").asBoolean());
        assertTrue(published.get("spoiler").isNull());
        var locked = json(get(PUBLIC + "/posts/" + post), 200);
        assertTrue(locked.get("locked").asBoolean());
        assertTrue(locked.get("title").isNull());
        assertTrue(locked.get("body").isNull());
        assertTrue(locked.get("images").isEmpty());
        assertTrue(locked.get("stickers").isEmpty());
        assertFalse(json(get(API + "/posts/" + post, a), 200).get("locked").asBoolean());
        assertEquals(403, get(PUBLIC + "/posts/" + post + "/comments").statusCode());
        String imageUrl = published.get("images").get(0).get("url").asString();
        assertTrue(imageUrl.endsWith("?reveal=true"));
        assertEquals(404, getBytes(imageUrl.split("\\?")[0], null).statusCode());
        assertEquals(200, getBytes(imageUrl, null).statusCode());
        String query = URLEncoder.encode("회차 없는", java.nio.charset.StandardCharsets.UTF_8);
        assertEquals(0, json(get(PUBLIC + "/posts?query=" + query), 200).get("totalItems").asInt());
        assertEquals(1, json(get(API + "/posts?query=" + query, a), 200).get("totalItems").asInt());
        var comment = copy(comment("회차 없는 댓글 스포일러"), "hasSpoiler", true);
        var reply = json(change("POST", API + "/posts/" + post + "/comments", b, comment), 201);
        var replies = json(get(PUBLIC + "/posts/" + post + "/comments?revealPost=true"), 200);
        assertTrue(replies.get("items").get(0).get("locked").asBoolean());
        assertTrue(replies.get("items").get(0).get("spoiler").isNull());
        var revealed = json(get(PUBLIC + "/posts/" + post + "/comments?revealPost=true&revealIds=" + reply.get("id").asString()), 200);
        assertEquals("회차 없는 댓글 스포일러", revealed.get("items").get(0).get("body").asString());
        json(change("PUT", API + "/posts/" + post, a, copy(input, "hasSpoiler", false)), 200);
        var unlocked = json(get(PUBLIC + "/posts/" + post), 200);
        assertFalse(unlocked.get("hasSpoiler").asBoolean());
        assertFalse(unlocked.get("locked").asBoolean());
        assertEquals(200, getBytes(imageUrl.split("\\?")[0], null).statusCode());
        json(change("PUT", API + "/comments/" + reply.get("id").asString(), b, copy(comment, "hasSpoiler", false)), 200);
        var visible = json(get(PUBLIC + "/posts/" + post + "/comments"), 200).get("items").get(0);
        assertFalse(visible.get("hasSpoiler").asBoolean());
        assertFalse(visible.get("locked").asBoolean());
        assertEquals("회차 없는 댓글 스포일러", visible.get("body").asString());
    }

    /** 새 플래그는 불리언만 받고 이전 입력은 회차 지정 여부로 해석합니다. */
    @Test void spoilerFlagsValidateBooleanAndPreserveLegacyInput() throws Exception {
        var a = login("a");
        var plain = create(a, draft());
        assertFalse(plain.get("hasSpoiler").asBoolean());
        var legacy = create(a, copy(draft(), "spoilerChapterId", "-16111"));
        assertTrue(legacy.get("hasSpoiler").asBoolean());
        assertEquals("-16111", legacy.get("spoiler").get("id").asString());
        for (Object invalid : new Object[]{null, "true", 1}) {
            assertEquals(400, change("POST", API + "/posts", a, copy(draft(), "hasSpoiler", invalid)).statusCode());
            assertEquals(400, change("POST", API + "/posts/" + plain.get("id").asString() + "/comments", a,
                    copy(comment("댓글"), "hasSpoiler", invalid)).statusCode());
        }
        assertEquals(400, change("POST", API + "/posts", a, copy(copy(draft(), "spoilerChapterId", "-16111"), "hasSpoiler", false)).statusCode());
        assertEquals(400, change("POST", API + "/posts/" + plain.get("id").asString() + "/comments", a,
                copy(copy(comment("댓글"), "spoilerChapterId", "-16111"), "hasSpoiler", false)).statusCode());
    }

    /** 공개 상태와 작품 공개 여부를 목록·상세·댓글에서 동일하게 적용합니다. */
    @Test void publicListsHideNonPublicWorkAndPostStates() throws Exception {
        insertPost(-16131, -16101, -16101L, "PUBLISHED", "첫 공개 글");
        insertPost(-16132, -16101, -16101L, "PUBLISHED", "둘째 공개 글");
        insertPost(-16133, -16101, -16101L, "HIDDEN", "숨긴 글");
        insertPost(-16134, -16101, -16101L, "DELETED", "삭제 글");
        insertPost(-16135, -16101, -16101L, "DRAFT", "초안");
        insertPost(-16136, -16102, -16102L, "PUBLISHED", "비공개 작품 글");
        var boards = json(get(PUBLIC + "/boards?type=work"), 200);
        var ids = new ArrayList<String>();
        for (var item : boards.get("items")) ids.add(item.get("id").asString());
        assertTrue(ids.contains("-16101"));
        assertFalse(ids.contains("-16102"));
        assertEquals(4, boards.get("stickers").size());
        var first = json(get(PUBLIC + "/posts?boardId=-16101&page=1&size=1"), 200);
        var second = json(get(PUBLIC + "/posts?boardId=-16101&page=2&size=1"), 200);
        assertEquals(2, first.get("totalItems").asInt());
        assertEquals("-16131", first.get("items").get(0).get("id").asString());
        assertEquals("-16132", second.get("items").get(0).get("id").asString());
        assertTrue(first.get("hasNext").asBoolean());
        assertFalse(second.get("hasNext").asBoolean());
        for (String board : List.of("-16102", "-999999")) {
            var empty = json(get(PUBLIC + "/posts?boardId=" + board), 200);
            assertEquals(0, empty.get("items").size());
            assertEquals(0, empty.get("totalItems").asInt());
            assertFalse(empty.get("hasNext").asBoolean());
        }
        for (long id : List.of(-16133L, -16134L, -16135L, -16136L)) {
            assertEquals(404, get(PUBLIC + "/posts/" + id).statusCode());
            assertEquals(404, get(PUBLIC + "/posts/" + id + "/comments").statusCode());
        }
        var a = login("a");
        var own = json(get(API + "/posts?mine=true", a), 200);
        assertEquals(3, own.get("totalItems").asInt());
        for (var item : own.get("items")) assertTrue(item.get("mine").asBoolean());
        for (String query : List.of("?page=0", "?size=0", "?size=101", "?page=abc")) {
            assertEquals(400, get(PUBLIC + "/posts" + query).statusCode());
        }
    }

    /** 인증·CSRF 및 본인 수정·삭제 경계를 실제 HTTP 요청으로 확인합니다. */
    @Test void mutationsRequireMemberCsrfAndOwnership() throws Exception {
        Map<String, Object> draft = draft();
        assertEquals(401, change("POST", API + "/posts", null, draft).statusCode());
        var a = login("a");
        var b = login("b");
        assertEquals(403, change("POST", API + "/posts", new Session(a.cookie(), null), draft).statusCode());
        assertEquals(403, change("POST", API + "/posts", new Session(a.cookie(), "invalid"), draft).statusCode());
        var post = create(a, draft);
        String id = post.get("id").asString();
        String path = API + "/posts/" + id;
        assertEquals(404, change("PUT", path, b, draft).statusCode());
        assertEquals(404, change("DELETE", path, b, null).statusCode());
        var edited = copy(draft, "title", "수정한 제목");
        var updated = json(change("PUT", path, a, edited), 200);
        assertEquals("수정한 제목", updated.get("title").asString());
        assertEquals(post.get("publishedAt"), updated.get("publishedAt"));
        assertEquals(post.get("createdAt"), updated.get("createdAt"));
        assertEquals(204, change("DELETE", path, a, null).statusCode());
        assertEquals("DELETED", jdbc.queryForObject("SELECT status FROM post WHERE id=?", String.class, id));
        assertEquals(404, get(PUBLIC + "/posts/" + id).statusCode());
        assertEquals(404, change("PUT", path, a, draft).statusCode());
    }

    /** 기존 서버 초안은 새 게시글 등록과 독립적으로 보존합니다. */
    @Test void oneDraftIsPrivateAndPublishingPreservesIt() throws Exception {
        var a = login("a");
        var b = login("b");
        assertEquals(204, get(API + "/draft", a).statusCode());
        var empty = copy(copy(draft(), "title", ""), "body", "");
        var first = json(change("PUT", API + "/draft", a, empty), 200);
        assertEquals("DRAFT", first.get("status").asString());
        assertTrue(first.get("publishedAt").isNull());
        String id = first.get("id").asString();
        assertEquals(404, get(PUBLIC + "/posts/" + id).statusCode());
        assertEquals(204, get(API + "/draft", b).statusCode());
        var saved = json(change("PUT", API + "/draft", a, copy(draft(), "body", "보관할 본문")), 200);
        assertEquals(id, saved.get("id").asString());
        assertEquals("보관할 본문", json(get(API + "/draft", login("a")), 200).get("body").asString());
        assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM post WHERE member_id=-16101 AND status='DRAFT'", Long.class));
        json(change("PUT", API + "/draft", b, draft()), 200);
        var published = create(a, draft());
        assertNotEquals(id, published.get("id").asString());
        assertEquals("PUBLISHED", published.get("status").asString());
        var remaining = json(get(API + "/draft", a), 200);
        assertEquals(id, remaining.get("id").asString());
        assertEquals("보관할 본문", remaining.get("body").asString());
        assertEquals(200, get(API + "/draft", b).statusCode());
        assertEquals(204, change("DELETE", API + "/draft", b, null).statusCode());
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM post WHERE member_id=-16102 AND status='DRAFT'", Long.class));
    }

    /** 동시에 임시저장해도 계정별 초안 하나만 남습니다. */
    @Test void concurrentDraftSavesKeepOneRow() throws Exception {
        var a = login("a");
        var requests = new ArrayList<java.util.concurrent.CompletableFuture<HttpResponse<String>>>();
        for (int i = 0; i < 3; i++) {
            var request = base(API + "/draft").header("Cookie", a.cookie()).header("X-CSRF-TOKEN", a.csrf())
                    .header("Content-Type", "application/json")
                    .PUT(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(copy(draft(), "body", "초안 " + i)))).build();
            requests.add(http.sendAsync(request, HttpResponse.BodyHandlers.ofString()));
        }
        var ids = new java.util.HashSet<String>();
        for (var request : requests) ids.add(json(request.get(20, java.util.concurrent.TimeUnit.SECONDS), 200).get("id").asString());
        assertEquals(1, ids.size());
        assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM post WHERE member_id=-16101 AND status='DRAFT'", Long.class));
        assertTrue(ids.contains(json(get(API + "/draft", a), 200).get("id").asString()));
    }

    /** 게시판 말머리·연결 작품·길이·공개된 스포일러 회차를 검사합니다. */
    @Test void validatesBoardWorkHeadLengthsAndSpoilerChapter() throws Exception {
        var a = login("a");
        for (Map<String, Object> invalid : List.of(
                copy(draft(), "title", " "), copy(draft(), "body", "\t"),
                copy(draft(), "title", "가".repeat(101)), copy(draft(), "body", "가".repeat(10001)),
                copy(draft(), "head", "STORY"), copy(draft(), "boardId", "-16102"),
                copy(draft(), "workId", "community-other"), copy(draft(), "spoilerChapterId", "-16121"),
                copy(draft(), "spoilerChapterId", "-16112"), copy(draft(), "spoilerChapterId", "-16113"),
                copy(draft(), "spoilerChapterId", "999999999"))) {
            assertTrue(List.of(400, 404).contains(change("POST", API + "/posts", a, invalid).statusCode()));
        }
        Map<String, Object> maximum = copy(copy(draft(), "title", "😀".repeat(100)), "body", "😀".repeat(10000));
        assertEquals("😀".repeat(10000), create(a, maximum).get("body").asString());
        var topicDraft = copy(copy(copy(draft(), "boardId", topic), "head", "STORY"), "workId", null);
        assertTrue(create(a, topicDraft).get("work").isNull());
        assertEquals(400, change("POST", API + "/posts", a, copy(topicDraft, "spoilerChapterId", "-16111")).statusCode());
        var promo = copy(copy(draft(), "boardId", promotion), "head", "PROMOTION");
        assertEquals(400, change("POST", API + "/posts", a, copy(promo, "workId", null)).statusCode());
        assertEquals("promotion", create(a, promo).get("boardType").asString());
        var chapters = json(get(PUBLIC + "/works/community-public/chapters"), 200).get("items");
        assertEquals(1, chapters.size());
        assertEquals("-16111", chapters.get(0).get("id").asString());
        assertEquals(404, get(PUBLIC + "/works/community-hidden/chapters").statusCode());
    }

    /** 최대 길이의 기존 본문도 인라인 첨부를 넣고 제목만 수정할 수 있습니다. */
    @Test void inlineImagesDoNotConsumeTheVisibleBodyLimit() throws Exception {
        var a = login("a");
        var attachments = List.of(imageInput(upload(a, "png", 8, 8)), imageInput(upload(a, "png", 9, 9)),
                imageInput(upload(a, "png", 10, 10)));
        String markers = "![이미지](<" + attachments.get(0).get("url") + ">)"
                + "![이미지](<" + attachments.get(1).get("url").toString().replace("/api/members", "") + "?reveal=true>)"
                + "![이미지](<" + attachments.get(2).get("url") + "?reveal=true>)";
        var input = copy(copy(draft(), "body", "😀".repeat(10000) + markers), "images", attachments);
        var created = create(a, input);
        String path = API + "/posts/" + created.get("id").asString();
        var edited = json(change("PUT", path, a, copy(input, "title", "제목만 수정")), 200);
        assertEquals(input.get("body"), edited.get("body").asString());
        assertEquals(3, edited.get("images").size());
        assertEquals(400, change("PUT", path, a, copy(input, "body", "😀".repeat(10001) + markers)).statusCode());
        for (String extra : List.of("![이미지](<" + attachments.get(0).get("url") + ">)",
                "![이미지](<https://example.test/unregistered.png>)", "![다른 글자](<" + attachments.get(0).get("url") + ">)",
                "![이미지](" + attachments.get(0).get("url") + ")")) {
            assertEquals(400, change("PUT", path, a, copy(input, "body", input.get("body") + extra)).statusCode());
        }
    }

    /** 기존 외부 첨부의 인코딩된 표식을 인식하되 전체 저장값은 25,000자로 제한합니다. */
    @Test void encodedLegacyImagesPreserveTheSerializedBodyLimit() throws Exception {
        var a = login("a");
        var created = create(a, draft());
        String postId = created.get("id").asString();
        var attachments = new ArrayList<Map<String, Object>>();
        var markers = new StringBuilder();
        for (int index = 1; index <= 3; index++) {
            String suffix = "/" + index + "%20cover.png?size=1&mode=full#crop";
            String url = "https://example.test/" + "😀".repeat(430) + suffix;
            attachments.add(Map.of("url", url, "width", 8, "height", 8));
            jdbc.update("INSERT INTO post_image(post_id,image_url,width,height,sort_order,is_representative) VALUES(?,?,8,8,?,?)",
                    postId, url, index, index == 1);
            markers.append("![이미지](<https://example.test/").append("%F0%9F%98%80".repeat(430)).append(suffix).append(">)");
        }
        String maximum = "가".repeat(25000 - markers.length()) + markers;
        var input = copy(copy(draft(), "body", maximum), "images", attachments);
        String path = API + "/posts/" + postId;
        assertEquals(maximum, json(change("PUT", path, a, input), 200).get("body").asString());
        assertEquals(400, change("PUT", path, a, copy(input, "body", maximum + "가")).statusCode());
        assertEquals(400, change("PUT", path, a, copy(input, "body", "가".repeat(10001) + markers)).statusCode());
    }

    /** 한 회원의 여러 댓글을 허용하고 타인 변경·빈 댓글·잘못된 스티커를 거부합니다. */
    @Test void multipleCommentsHaveOwnershipLengthsAndStickerRules() throws Exception {
        var a = login("a");
        var b = login("b");
        String post = create(a, draft()).get("id").asString();
        String path = API + "/posts/" + post + "/comments";
        var first = json(change("POST", path, b, comment("첫 댓글")), 201);
        var second = json(change("POST", path, b, comment("둘째 댓글")), 201);
        assertNotEquals(first.get("id"), second.get("id"));
        var empty = comment("");
        assertEquals(400, change("POST", path, b, empty).statusCode());
        assertEquals(400, change("POST", path, b, comment("가".repeat(2001))).statusCode());
        json(change("POST", path, b, comment("😀".repeat(2000))), 201);
        json(change("POST", path, b, copy(empty, "stickerIds", List.of(sticker, sticker, sticker, sticker))), 201);
        assertEquals(400, change("POST", path, b, copy(empty, "stickerIds", List.of("999999999"))).statusCode());
        assertEquals(400, change("POST", path, b, copy(empty, "stickerIds", java.util.Collections.nCopies(5, sticker))).statusCode());
        String target = API + "/comments/" + first.get("id").asString();
        assertEquals(404, change("PUT", target, a, comment("타인 수정")).statusCode());
        assertEquals(404, change("DELETE", target, a, null).statusCode());
        assertEquals("수정한 댓글", json(change("PUT", target, b, comment("수정한 댓글")), 200).get("body").asString());
        var page = json(get(PUBLIC + "/posts/" + post + "/comments?page=1&size=2"), 200);
        assertEquals(4, page.get("totalItems").asInt());
        assertTrue(page.get("hasNext").asBoolean());
        assertEquals(first.get("id"), page.get("items").get(0).get("id"));
        assertEquals(second.get("id"), page.get("items").get(1).get("id"));
        assertEquals(204, change("DELETE", target, b, null).statusCode());
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM post_comment WHERE id=?", Long.class, first.get("id").asString()));
        assertEquals(3, json(get(PUBLIC + "/posts/" + post), 200).get("commentCount").asInt());
        assertEquals(204, change("DELETE", API + "/posts/" + post, a, null).statusCode());
        assertEquals(3L, jdbc.queryForObject("SELECT COUNT(*) FROM post_comment WHERE post_id=?", Long.class, post));
        assertEquals(404, get(PUBLIC + "/posts/" + post + "/comments").statusCode());
    }

    /** 확인 전 원문·제목·이미지·스티커를 응답에서 제거하며 댓글의 지정 회차에도 같은 규칙을 적용합니다. */
    @Test void spoilerConsentProtectsPostAndCommentContent() throws Exception {
        var a = login("a");
        var b = login("b");
        var input = copy(copy(draft(), "spoilerChapterId", "-16111"), "stickerIds", List.of(sticker));
        String id = create(a, input).get("id").asString();
        var locked = json(get(PUBLIC + "/posts/" + id), 200);
        assertTrue(locked.get("locked").asBoolean());
        assertTrue(locked.get("title").isNull());
        assertTrue(locked.get("body").isNull());
        assertTrue(locked.get("images").isEmpty());
        assertTrue(locked.get("stickers").isEmpty());
        var list = json(get(PUBLIC + "/posts?boardId=-16101"), 200);
        assertTrue(list.get("items").get(0).get("title").isNull());
        assertTrue(json(get(API + "/posts/" + id, b), 200).get("locked").asBoolean());
        assertFalse(json(get(API + "/posts/" + id, a), 200).get("locked").asBoolean());
        var revealed = json(get(PUBLIC + "/posts/" + id + "?reveal=true"), 200);
        assertEquals("검증할 게시글", revealed.get("title").asString());
        assertEquals(1, revealed.get("stickers").size());
        var reply = copy(copy(comment("스포일러 댓글 원문"), "spoilerChapterId", "-16111"), "stickerIds", List.of(sticker));
        json(change("POST", API + "/posts/" + id + "/comments", b, reply), 201);
        assertEquals(403, get(PUBLIC + "/posts/" + id + "/comments").statusCode());
        var comments = json(get(PUBLIC + "/posts/" + id + "/comments?revealPost=true"), 200).get("items");
        assertTrue(comments.get(0).get("locked").asBoolean());
        assertTrue(comments.get(0).get("body").isNull());
        assertTrue(comments.get(0).get("stickers").isEmpty());
        var visible = json(get(PUBLIC + "/posts/" + id + "/comments?reveal=true"), 200).get("items").get(0);
        assertEquals("스포일러 댓글 원문", visible.get("body").asString());
        assertTrue(json(get(PUBLIC + "/posts/" + id), 200).get("title").isNull());
    }

    /** 댓글 하나만 확인하면 같은 목록의 다른 스포일러 댓글은 계속 가립니다. */
    @Test void revealingOneCommentDoesNotRevealOtherSpoilers() throws Exception {
        var a = login("a");
        var b = login("b");
        String post = create(a, draft()).get("id").asString();
        var input = copy(copy(comment("첫 비공개 댓글"), "spoilerChapterId", "-16111"), "stickerIds", List.of(sticker));
        var first = json(change("POST", API + "/posts/" + post + "/comments", b, input), 201);
        json(change("POST", API + "/posts/" + post + "/comments", b, copy(input, "body", "둘째 비공개 댓글")), 201);
        String path = PUBLIC + "/posts/" + post + "/comments";
        var selected = json(get(path + "?revealIds=" + first.get("id").asString()), 200).get("items");
        assertEquals("첫 비공개 댓글", selected.get(0).get("body").asString());
        assertFalse(selected.get(0).get("locked").asBoolean());
        assertEquals(1, selected.get(0).get("stickers").size());
        assertTrue(selected.get(1).get("body").isNull());
        assertTrue(selected.get(1).get("locked").asBoolean());
        assertTrue(selected.get(1).get("stickers").isEmpty());
        var fresh = json(get(path), 200).get("items");
        assertTrue(fresh.get(0).get("body").isNull());
        assertTrue(fresh.get(1).get("body").isNull());
    }

    /** 공감 설정·해제를 멱등 처리하고 신고 원본과 신고자 개인정보를 보존합니다. */
    @Test void likesAndReportsKeepIndependentMemberStateAndOriginalReason() throws Exception {
        var a = login("a");
        var b = login("b");
        var c = login("c");
        String id = create(a, draft()).get("id").asString();
        String path = API + "/posts/" + id;
        assertEquals(400, change("PUT", path + "/like", a, null).statusCode());
        assertEquals(400, change("POST", path + "/reports", a, Map.of("reason", "SPAM")).statusCode());
        for (int i = 0; i < 2; i++) {
            var liked = json(change("PUT", path + "/like", b, null), 200);
            assertTrue(liked.get("liked").asBoolean());
            assertEquals(1, liked.get("likeCount").asInt());
        }
        assertEquals(2, json(change("PUT", path + "/like", c, null), 200).get("likeCount").asInt());
        for (int i = 0; i < 2; i++) {
            var unliked = json(change("DELETE", path + "/like", b, null), 200);
            assertFalse(unliked.get("liked").asBoolean());
            assertEquals(1, unliked.get("likeCount").asInt());
        }
        var receipt = json(change("POST", path + "/reports", b, Map.of("reason", "SPAM", "detail", "최초 신고")), 201);
        var repeated = json(change("POST", path + "/reports", b, Map.of("reason", "OTHER", "detail", "변경 신고")), 200);
        assertEquals(receipt.get("id"), repeated.get("id"));
        assertEquals("SPAM", jdbc.queryForObject("SELECT reason FROM post_report WHERE id=?", String.class, receipt.get("id").asString()));
        assertEquals("최초 신고", jdbc.queryForObject("SELECT detail FROM post_report WHERE id=?", String.class, receipt.get("id").asString()));
        assertTrue(json(get(path, b), 200).get("reported").asBoolean());
        assertFalse(json(get(path, c), 200).get("reported").asBoolean());
        var anonymous = get(PUBLIC + "/posts/" + id, b);
        assertFalse(json(anonymous, 200).get("reported").asBoolean());
        assertFalse(anonymous.body().contains("최초 신고"));
        for (Map<String, String> invalid : List.of(Map.of("reason", "INVALID"), Map.of("reason", "OTHER", "detail", "가".repeat(501)))) {
            assertEquals(400, change("POST", path + "/reports", c, invalid).statusCode());
        }
    }

    /** 스티커와 이미지 수를 서버에서 제한하며 검증 실패한 글은 저장하지 않습니다. */
    @Test void attachmentLimitsAndUnknownStickerDoNotPartiallySave() throws Exception {
        var a = login("a");
        assertEquals(400, change("POST", API + "/posts", a, copy(draft(), "stickerIds", List.of("999999999"))).statusCode());
        assertEquals(400, change("POST", API + "/posts", a, copy(draft(), "stickerIds", java.util.Collections.nCopies(9, sticker))).statusCode());
        var post = create(a, copy(draft(), "stickerIds", java.util.Collections.nCopies(8, sticker)));
        assertEquals(8, post.get("stickers").size());
        var uploaded = upload(a, "png", 8, 8);
        assertEquals(400, change("POST", API + "/posts", a, copy(draft(), "images", java.util.Collections.nCopies(4, imageInput(uploaded)))).statusCode());
        assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM post WHERE member_id=-16101", Long.class));
    }

    /** 실제 이미지 형식·크기·치수를 검증하고 인증 없는 업로드를 차단합니다. */
    @Test void imageUploadRejectsInvalidBytesMimeSizeAndDimensions() throws Exception {
        var a = login("a");
        var valid = Map.of("base64", Base64.getEncoder().encodeToString(picture("png", 10, 6)), "mimeType", "image/png");
        assertEquals(401, change("POST", API + "/images", null, valid).statusCode());
        assertEquals(403, change("POST", API + "/images", new Session(a.cookie(), null), valid).statusCode());
        for (Object invalid : List.of(Map.of("base64", "not base64", "mimeType", "image/png"),
                Map.of("base64", Base64.getEncoder().encodeToString("<svg></svg>".getBytes(java.nio.charset.StandardCharsets.UTF_8)), "mimeType", "image/png"),
                Map.of("base64", valid.get("base64"), "mimeType", "image/jpeg"),
                Map.of("base64", valid.get("base64"), "mimeType", "image/svg+xml"))) {
            assertEquals(400, change("POST", API + "/images", a, invalid).statusCode());
        }
        var huge = Map.of("base64", Base64.getEncoder().encodeToString(new byte[2 * 1024 * 1024 + 1]), "mimeType", "image/png");
        assertTrue(List.of(400, 413).contains(change("POST", API + "/images", a, huge).statusCode()));
        var wide = Map.of("base64", Base64.getEncoder().encodeToString(picture("png", 1025, 1)), "mimeType", "image/png");
        assertEquals(400, change("POST", API + "/images", a, wide).statusCode());
        var png = upload(a, "png", 10, 6);
        assertEquals(10, png.get("width").asInt());
        assertEquals(6, png.get("height").asInt());
        var jpeg = upload(a, "jpeg", 9, 7);
        assertEquals(9, jpeg.get("width").asInt());
        var response = getBytes(png.get("url").asString(), a);
        assertEquals(200, response.statusCode());
        assertEquals("image/png", response.headers().firstValue("Content-Type").orElseThrow());
        assertNotNull(ImageIO.read(new java.io.ByteArrayInputStream(response.body())));
    }

    /** 미첨부·초안·숨김 첨부를 보호하고 타인 첨부·임의 경로를 거부합니다. */
    @Test void imageUrlsFollowOwnershipAndPostPublication() throws Exception {
        var a = login("a");
        var b = login("b");
        var image = upload(a, "png", 10, 10);
        String ownerUrl = image.get("url").asString();
        String publicUrl = ownerUrl.replace("/api/members/community/", "/community/");
        assertEquals(401, getBytes(ownerUrl, null).statusCode());
        assertEquals(404, getBytes(ownerUrl, b).statusCode());
        assertEquals(404, getBytes(publicUrl, null).statusCode());
        var input = copy(draft(), "images", List.of(imageInput(image)));
        assertEquals(400, change("POST", API + "/posts", b, input).statusCode());
        for (String url : List.of("https://example.test/foreign.png", "/api/members/community/images/-16101/../secret.png", "/community/images/-16101/%2e%2e/secret.png")) {
            assertEquals(400, change("POST", API + "/posts", a, copy(draft(), "images", List.of(Map.of("url", url, "width", 10, "height", 10)))).statusCode());
        }
        var saved = json(change("PUT", API + "/draft", a, input), 200);
        assertEquals(404, getBytes(publicUrl, null).statusCode());
        assertEquals(200, getBytes(ownerUrl, a).statusCode());
        var published = create(a, input);
        assertNotEquals(saved.get("id"), published.get("id"));
        var publicPost = json(get(PUBLIC + "/posts/" + published.get("id").asString()), 200);
        assertTrue(publicPost.get("images").get(0).get("representative").asBoolean());
        assertEquals(200, getBytes(publicPost.get("images").get(0).get("url").asString(), null).statusCode());
        jdbc.update("UPDATE post SET status='HIDDEN' WHERE id=?", published.get("id").asString());
        assertEquals(404, getBytes(publicUrl, null).statusCode());
        assertEquals(200, getBytes(ownerUrl, a).statusCode());
        jdbc.update("UPDATE post SET status='PUBLISHED' WHERE id=?", published.get("id").asString());
        jdbc.update("UPDATE book SET publish_status='HIDDEN' WHERE id=-16101");
        assertEquals(404, getBytes(publicUrl, null).statusCode());
    }

    /** 이미지 주소를 알고 있어도 스포일러 확인이 없으면 파일을 공개하지 않습니다. */
    @Test void spoilerImagesRequireExplicitConsentEvenWithKnownUrl() throws Exception {
        var a = login("a");
        var image = upload(a, "png", 7, 5);
        var draft = copy(copy(draft(), "images", List.of(imageInput(image))), "spoilerChapterId", "-16111");
        var post = create(a, draft);
        String path = PUBLIC + "/posts/" + post.get("id").asString();
        assertTrue(json(get(path), 200).get("images").isEmpty());
        var revealed = json(get(path + "?reveal=true"), 200);
        String url = revealed.get("images").get(0).get("url").asString();
        assertTrue(url.contains("reveal=true"));
        assertEquals(200, getBytes(url, null).statusCode());
        assertEquals(404, getBytes(url.split("\\?")[0], null).statusCode());
        assertTrue(json(get(path), 200).get("images").isEmpty());
    }

    /** 웹의 SvgUri가 읽는 고정 SVG만 교차 출처 GET을 허용합니다. */
    @Test void stickerCorsAllowsOnlyPublicGet() throws Exception {
        var image = http.send(base("/stickers/emote-wave.svg").header("Origin", "http://localhost:8081")
                .GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, image.statusCode());
        assertEquals("*", image.headers().firstValue("Access-Control-Allow-Origin").orElseThrow());
        assertTrue(image.headers().firstValue("Content-Type").orElseThrow().startsWith("image/svg+xml"));
        assertTrue(image.body().startsWith("<svg"));
        var unsupported = http.send(base("/stickers/emote-wave.svg").header("Origin", "http://localhost:8081")
                .header("Access-Control-Request-Method", "POST").method("OPTIONS", HttpRequest.BodyPublishers.noBody())
                .build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(403, unsupported.statusCode());
    }

    /** 글 수가 늘어도 첨부 조회 횟수와 기존 단건 응답을 유지합니다. */
    @Test void postAttachmentsUseConstantQueriesAndKeepOrder() throws Exception {
        attachmentPosts(20);
        countedGet(PUBLIC + "/posts?size=1", null, 4);
        var page = countedGet(PUBLIC + "/posts?size=20", null, 4);
        assertEquals(20, page.get("totalItems").asInt());
        assertFalse(page.get("hasNext").asBoolean());
        for (var item : page.get("items")) {
            assertEquals(json(get(PUBLIC + "/posts/" + item.get("id").asString()), 200), item);
            assertEquals(2, item.get("images").size());
            assertEquals(11, item.get("images").get(0).get("width").asInt());
            assertTrue(item.get("images").get(0).get("representative").asBoolean());
            assertEquals(21, item.get("images").get(1).get("width").asInt());
            assertFalse(item.get("images").get(1).get("representative").asBoolean());
            assertStickerSequence(item);
        }
        var second = countedGet(PUBLIC + "/posts?boardId=-16101&page=2&size=7", null, 4);
        assertEquals("-16207", second.get("items").get(0).get("id").asString());
        assertTrue(second.get("hasNext").asBoolean());
    }

    /** 본인 숨김 글과 스포일러 첨부는 공개 목록과 소유자 목록에서 구분합니다. */
    @Test void ownAndLockedPostsKeepTheirAttachmentVisibility() throws Exception {
        attachmentPosts(4);
        jdbc.update("UPDATE post SET has_spoiler=TRUE WHERE id=-16201");
        jdbc.update("UPDATE post SET status='HIDDEN' WHERE id=-16202");
        jdbc.update("DELETE FROM post_image WHERE post_id=-16203");
        jdbc.update("DELETE FROM post_sticker WHERE post_id=-16203");
        var publicPage = countedGet(PUBLIC + "/posts?size=20", null, 4);
        assertEquals(3, publicPage.get("totalItems").asInt());
        var locked = publicPage.get("items").get(1);
        assertTrue(locked.get("locked").asBoolean());
        assertTrue(locked.get("title").isNull());
        assertTrue(locked.get("body").isNull());
        assertTrue(locked.get("images").isEmpty());
        assertTrue(locked.get("stickers").isEmpty());
        assertTrue(publicPage.get("items").get(2).get("images").isEmpty());
        assertTrue(publicPage.get("items").get(2).get("stickers").isEmpty());
        var owner = login("a");
        var own = countedGet(API + "/posts?mine=true&size=20", owner, 4);
        assertEquals(4, own.get("totalItems").asInt());
        for (var item : own.get("items")) {
            assertFalse(item.get("locked").asBoolean());
            assertTrue(item.get("mine").asBoolean());
            assertEquals(json(get(API + "/posts/" + item.get("id").asString(), owner), 200), item);
        }
        assertTrue(own.get("items").get(1).get("images").get(0).get("url").asString().endsWith("?reveal=true"));
        assertTrue(own.get("items").get(2).get("images").get(0).get("url").asString().startsWith("/api/members/community/images/"));
    }

    /** 댓글 수와 무관하게 스티커를 조회하며 같은 스티커의 반복과 순서를 보존합니다. */
    @Test void commentStickersUseConstantQueriesAndKeepOrder() throws Exception {
        attachmentComments(20);
        countedGet(PUBLIC + "/posts/-16131/comments?size=1", null, 4);
        var page = countedGet(PUBLIC + "/posts/-16131/comments?size=20", null, 4);
        assertEquals(20, page.get("totalItems").asInt());
        assertFalse(page.get("hasNext").asBoolean());
        for (int i = 0; i < 20; i++) {
            var item = page.get("items").get(i);
            assertEquals(Long.toString(-16200L - i), item.get("id").asString());
            assertEquals("댓글 " + i, item.get("body").asString());
            assertEquals("커뮤니티 독자 둘", item.get("nickname").asString());
            assertStickerSequence(item);
        }
        var second = countedGet(PUBLIC + "/posts/-16131/comments?page=2&size=7", null, 4);
        assertEquals("-16207", second.get("items").get(0).get("id").asString());
        assertTrue(second.get("hasNext").asBoolean());
    }

    /** 개별 공개·전체 공개·소유자 조회에서 댓글마다 공개 범위를 적용합니다. */
    @Test void commentSpoilerChoicesKeepTheirAttachmentVisibility() throws Exception {
        attachmentComments(3);
        jdbc.update("UPDATE post_comment SET has_spoiler=TRUE WHERE id IN (-16201,-16202)");
        jdbc.update("DELETE FROM post_comment_sticker WHERE comment_id=-16200");
        var hidden = countedGet(PUBLIC + "/posts/-16131/comments?revealPost=true", null, 4);
        assertTrue(hidden.get("items").get(0).get("stickers").isEmpty());
        for (int i : List.of(1, 2)) {
            var item = hidden.get("items").get(i);
            assertTrue(item.get("body").isNull());
            assertTrue(item.get("stickers").isEmpty());
            assertTrue(item.get("locked").asBoolean());
        }
        var selected = countedGet(PUBLIC + "/posts/-16131/comments?revealIds=-16201", null, 4);
        assertStickerSequence(selected.get("items").get(1));
        assertEquals("댓글 1", selected.get("items").get(1).get("body").asString());
        assertTrue(selected.get("items").get(2).get("stickers").isEmpty());
        for (var page : List.of(countedGet(PUBLIC + "/posts/-16131/comments?reveal=true", null, 4),
                countedGet(API + "/posts/-16131/comments", login("b"), 4))) {
            assertStickerSequence(page.get("items").get(1));
            assertStickerSequence(page.get("items").get(2));
            for (var item : page.get("items")) assertFalse(item.get("locked").asBoolean());
        }
    }

    /** 빈 페이지와 전부 가려진 페이지에는 첨부 SQL을 실행하지 않습니다. */
    @Test void emptyAndFullyLockedPagesSkipAttachmentQueries() throws Exception {
        assertTrue(countedGet(PUBLIC + "/posts", null, 2).get("items").isEmpty());
        attachmentPosts(2);
        jdbc.update("UPDATE post SET has_spoiler=TRUE WHERE member_id=-16101");
        var locked = countedGet(PUBLIC + "/posts", null, 2);
        assertEquals(2, locked.get("items").size());
        for (var item : locked.get("items")) {
            assertTrue(item.get("locked").asBoolean());
            assertTrue(item.get("images").isEmpty());
            assertTrue(item.get("stickers").isEmpty());
        }
        assertTrue(countedGet(PUBLIC + "/posts?page=2", null, 2).get("items").isEmpty());
        attachmentComments(2);
        jdbc.update("UPDATE post_comment SET has_spoiler=TRUE WHERE post_id=-16131");
        var comments = countedGet(PUBLIC + "/posts/-16131/comments", null, 3);
        for (var item : comments.get("items")) assertTrue(item.get("stickers").isEmpty());
        assertTrue(countedGet(PUBLIC + "/posts/-16131/comments?page=2", null, 3).get("items").isEmpty());
    }

    private void attachmentPosts(int count) {
        for (int i = 0; i < count; i++) {
            long id = -16200L - i;
            insertPost(id, -16101, -16101L, "PUBLISHED", "첨부 글 " + i);
            for (int order : List.of(2, 1))
                jdbc.update("INSERT INTO post_image(post_id,image_url,width,height,sort_order,is_representative) VALUES(?,?,?,?,?,?)",
                        id, "/community/images/-16101/00000000-0000-0000-0000-" + "%012d".formatted(i * 2 + order) + ".png",
                        order * 10 + 1, order * 10 + 2, order, order == 1);
            attachmentStickers(id, false);
        }
    }

    private void attachmentComments(int count) {
        insertPost(-16131, -16101, -16101L, "PUBLISHED", "댓글 첨부 부모");
        for (int i = 0; i < count; i++) {
            long id = -16200L - i;
            jdbc.update("INSERT INTO post_comment(id,post_id,book_id,member_id,body,created_at) VALUES(?,-16131,-16101,-16102,?,?)",
                    id, "댓글 " + i, "2026-01-01 00:00:" + "%02d".formatted(i));
            attachmentStickers(id, true);
        }
    }

    private void attachmentStickers(long id, boolean comment) {
        String table = comment ? "post_comment_sticker" : "post_sticker", column = comment ? "comment_id" : "post_id";
        for (int order : List.of(3, 1, 2))
            jdbc.update("INSERT INTO " + table + "(" + column + ",sort_order,sticker_id) SELECT ?,?,id FROM sticker WHERE code=?",
                    id, order, order == 2 ? "WAVE" : "THINK");
    }

    private void assertStickerSequence(JsonNode item) {
        var values = item.get("stickers");
        assertEquals(3, values.size());
        assertEquals(List.of("THINK", "WAVE", "THINK"), List.of(values.get(0).get("code").asString(),
                values.get(1).get("code").asString(), values.get(2).get("code").asString()));
    }

    private JsonNode countedGet(String path, Session session, int expected) throws Exception {
        measuredQueries.clear();
        var request = base(path).header("X-Test-Community-Queries", "true");
        if (session != null) request.header("Cookie", session.cookie());
        var result = json(http.send(request.GET().build(), HttpResponse.BodyHandlers.ofString()), 200);
        System.out.printf("커뮤니티 조회 %s의 SQL 수는 %d회입니다.%n", path, measuredQueries.size());
        assertEquals(expected, measuredQueries.size(), path);
        return result;
    }

    private void insertPost(long id, long board, Long book, String status, String title) {
        jdbc.update("INSERT INTO post(id,board_id,book_id,member_id,head,title,body,status,published_at) VALUES(?,?,?,-16101,'FREE',?,'본문',?,?)",
                id, board, book, title, status, status.equals("DRAFT") ? null : "2026-01-01 00:00:00");
    }

    private Map<String, Object> draft() {
        var value = new LinkedHashMap<String, Object>();
        value.put("boardId", "-16101"); value.put("workId", "community-public"); value.put("head", "FREE");
        value.put("title", "검증할 게시글"); value.put("body", "검증할 본문"); value.put("spoilerChapterId", null);
        value.put("images", List.of()); value.put("stickerIds", List.of());
        return value;
    }

    private Map<String, Object> comment(String body) {
        var value = new LinkedHashMap<String, Object>();
        value.put("body", body); value.put("spoilerChapterId", null); value.put("stickerIds", List.of());
        return value;
    }

    private static Map<String, Object> copy(Map<String, Object> original, String key, Object value) {
        var result = new LinkedHashMap<>(original); result.put(key, value); return result;
    }

    private JsonNode create(Session session, Map<String, Object> draft) throws Exception {
        return json(change("POST", API + "/posts", session, draft), 201);
    }

    private JsonNode upload(Session session, String format, int width, int height) throws Exception {
        return json(change("POST", API + "/images", session, Map.of("base64", Base64.getEncoder().encodeToString(picture(format, width, height)),
                "mimeType", "image/" + format)), 201);
    }

    private static Map<String, Object> imageInput(JsonNode image) {
        return Map.of("url", image.get("url").asString(), "width", image.get("width").asInt(), "height", image.get("height").asInt());
    }

    private static byte[] picture(String format, int width, int height) throws Exception {
        var output = new ByteArrayOutputStream();
        assertTrue(ImageIO.write(new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB), format, output));
        return output.toByteArray();
    }

    private static Path temporaryImages() {
        try { return Files.createTempDirectory("mobtwig-community-api-test-").toAbsolutePath().normalize(); }
        catch (java.io.IOException failure) { throw new java.io.UncheckedIOException(failure); }
    }

    private Session login(String label) throws Exception {
        var token = get("/api/auth/csrf");
        var response = http.send(base("/api/auth/login").header("Cookie", cookie(token))
                .header("X-CSRF-TOKEN", json(token, 200).get("token").asString())
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("email=community-" + label + "%40example.test&password=TestPass19")).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(204, response.statusCode(), response.body());
        String cookie = cookie(response);
        var csrf = http.send(base("/api/auth/csrf").header("Cookie", cookie).GET().build(), HttpResponse.BodyHandlers.ofString());
        return new Session(cookie, json(csrf, 200).get("token").asString());
    }

    private static String cookie(HttpResponse<String> response) {
        return response.headers().allValues("Set-Cookie").stream().filter(value -> value.startsWith("MEMBER_SESSION="))
                .map(value -> value.substring(0, value.indexOf(';'))).findFirst().orElseThrow();
    }

    private HttpRequest.Builder base(String path) {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(20));
    }

    private HttpResponse<String> get(String path) throws Exception { return get(path, null); }
    private HttpResponse<String> get(String path, Session session) throws Exception {
        var request = base(path);
        if (session != null) request.header("Cookie", session.cookie());
        return http.send(request.GET().build(), HttpResponse.BodyHandlers.ofString());
    }
    private HttpResponse<byte[]> getBytes(String path, Session session) throws Exception {
        var request = base(path);
        if (session != null) request.header("Cookie", session.cookie());
        return http.send(request.GET().build(), HttpResponse.BodyHandlers.ofByteArray());
    }
    private HttpResponse<String> change(String method, String path, Session session, Object body) throws Exception {
        var request = base(path).header("Content-Type", "application/json");
        if (session != null) {
            request.header("Cookie", session.cookie());
            if (session.csrf() != null) request.header("X-CSRF-TOKEN", session.csrf());
        }
        return http.send(request.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body))).build(), HttpResponse.BodyHandlers.ofString());
    }
    private JsonNode json(HttpResponse<String> response, int status) {
        assertEquals(status, response.statusCode(), response.body());
        return mapper.readTree(response.body());
    }
}
