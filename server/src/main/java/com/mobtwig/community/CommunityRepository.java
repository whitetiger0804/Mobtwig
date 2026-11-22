package com.mobtwig.community;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

/** 기존 게시판 테이블에서 공개 자료와 회원 소유 자료를 조회하고 저장합니다. */
@Repository
class CommunityRepository {
    record BoardData(long id, String type, String name, Long bookId, CommunityService.Work work) {}
    record PostData(long id, long boardId, String boardType, String boardName, Long bookId,
                    long memberId, CommunityService.Work work, String head, String title, String body,
                    String nickname, Instant createdAt, Instant updatedAt, Instant publishedAt, String status,
                    CommunityService.Chapter spoiler, boolean hasSpoiler, boolean visible, long likeCount, long commentCount,
                    boolean liked, boolean reported) {}
    record CommentData(long id, long postId, long memberId, String body, String nickname, Instant createdAt,
                       Instant updatedAt, CommunityService.Chapter spoiler, boolean hasSpoiler) {}
    record SavedImage(String url, int width, int height, boolean representative) {}
    record Filter(Long boardId, String type, String head, String query, boolean mine, Long viewer) {}
    private record Clause(String sql, List<Object> parameters) {}

    private static final String WORK_FIELDS = """
            b.slug AS work_slug,b.title AS work_title,b.cover_image_url AS work_image,b.content_type AS work_kind,
            COALESCE((SELECT GROUP_CONCAT(a.name ORDER BY ba.id SEPARATOR ', ')
                      FROM book_author ba JOIN author a ON a.id=ba.author_id WHERE ba.book_id=b.id),'') AS work_author
            """;
    private static final String BOARDS = "SELECT bo.id,bo.type,COALESCE(bo.name,b.title) AS name,bo.book_id,"
            + WORK_FIELDS + " FROM board bo LEFT JOIN book b ON b.id=bo.book_id";
    private static final String WORKS_FROM = " FROM book b LEFT JOIN board bo ON bo.book_id=b.id";
    private static final String WORKS_WHERE = """
             WHERE b.publish_status='PUBLISHED' AND (?='' OR LOCATE(?,b.title)>0 OR LOCATE(?,b.publisher)>0
                 OR EXISTS(SELECT 1 FROM book_author ba JOIN author a ON a.id=ba.author_id
                           WHERE ba.book_id=b.id AND LOCATE(?,a.name)>0))
            """;
    private static final String VISIBLE = "(bo.type<>'WORK' OR bb.publish_status='PUBLISHED')"
            + " AND (p.book_id IS NULL OR b.publish_status='PUBLISHED')";
    private static final String POSTS_FROM = " FROM post p JOIN board bo ON bo.id=p.board_id"
            + " LEFT JOIN book bb ON bb.id=bo.book_id LEFT JOIN book b ON b.id=p.book_id";
    private static final String POSTS = """
            SELECT p.id,p.board_id,bo.type AS board_type,COALESCE(bo.name,bb.title) AS board_name,
                   p.book_id,p.member_id,p.head,p.title,p.body,p.status,p.has_spoiler,p.created_at,p.updated_at,p.published_at,
                   CASE WHEN m.status='WITHDRAWN' THEN '탈퇴한 회원' ELSE m.nickname END AS nickname,
                   c.id AS spoiler_id,c.chapter_no AS spoiler_number,c.title AS spoiler_title,
                   (SELECT COUNT(*) FROM post_reaction r WHERE r.post_id=p.id) AS like_count,
                   (SELECT COUNT(*) FROM post_comment pc WHERE pc.post_id=p.id) AS comment_count,
                   EXISTS(SELECT 1 FROM post_reaction r WHERE r.post_id=p.id AND r.member_id=?) AS liked,
                   EXISTS(SELECT 1 FROM post_report r WHERE r.post_id=p.id AND r.reporter_member_id=?) AS reported,
            """ + WORK_FIELDS + ",(" + VISIBLE + ") AS visible" + POSTS_FROM
            + " JOIN member m ON m.id=p.member_id LEFT JOIN chapter c ON c.id=p.spoiler_chapter_id";
    private static final String COMMENTS = """
            SELECT pc.id,pc.post_id,pc.member_id,pc.body,pc.has_spoiler,pc.created_at,pc.updated_at,
                   CASE WHEN m.status='WITHDRAWN' THEN '탈퇴한 회원' ELSE m.nickname END AS nickname,
                   c.id AS spoiler_id,c.chapter_no AS spoiler_number,c.title AS spoiler_title
            FROM post_comment pc JOIN member m ON m.id=pc.member_id
            LEFT JOIN chapter c ON c.id=pc.spoiler_chapter_id
            """;
    private static final RowMapper<BoardData> BOARD = (r, n) -> new BoardData(r.getLong("id"),
            r.getString("type"), r.getString("name"), r.getObject("book_id", Long.class), work(r));
    private static final RowMapper<PostData> POST = (r, n) -> new PostData(r.getLong("id"), r.getLong("board_id"),
            r.getString("board_type"), r.getString("board_name"), r.getObject("book_id", Long.class),
            r.getLong("member_id"), work(r), r.getString("head"), r.getString("title"), r.getString("body"),
            r.getString("nickname"), instant(r, "created_at"), instant(r, "updated_at"), instant(r, "published_at"),
            r.getString("status"), spoiler(r), r.getBoolean("has_spoiler"), r.getBoolean("visible"), r.getLong("like_count"),
            r.getLong("comment_count"), r.getBoolean("liked"), r.getBoolean("reported"));
    private static final RowMapper<CommentData> COMMENT = (r, n) -> new CommentData(r.getLong("id"),
            r.getLong("post_id"), r.getLong("member_id"), r.getString("body"), r.getString("nickname"),
            instant(r, "created_at"), instant(r, "updated_at"), spoiler(r), r.getBoolean("has_spoiler"));

    private final JdbcTemplate jdbc;
    CommunityRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    List<BoardData> boards(String type, String query) {
        return jdbc.query(BOARDS + " WHERE bo.type=? AND (bo.book_id IS NULL OR b.publish_status='PUBLISHED')"
                + " AND (?='' OR LOCATE(?,COALESCE(bo.name,b.title))>0)"
                + " ORDER BY COALESCE(b.title,bo.name),bo.id", BOARD, type, query, query);
    }

    /** 목록의 모든 게시판 미리보기를 한 번에 조회하며 공개 스포일러 제목은 가립니다. */
    Map<Long, CommunityService.LatestPost> latestPosts(List<Long> boards) {
        if (boards.isEmpty()) return Map.of();
        String placeholders = String.join(",", java.util.Collections.nCopies(boards.size(), "?"));
        String sql = """
                SELECT latest.*,
                    (SELECT COUNT(*) FROM post_reaction r WHERE r.post_id=latest.id) AS like_count,
                    (SELECT COUNT(*) FROM post_comment c WHERE c.post_id=latest.id) AS comment_count
                FROM (
                    SELECT p.id,p.board_id,p.head,p.title,p.has_spoiler,
                        CASE WHEN m.status='WITHDRAWN' THEN '탈퇴한 회원' ELSE m.nickname END AS nickname,
                        ROW_NUMBER() OVER(PARTITION BY p.board_id ORDER BY p.published_at DESC,p.id DESC) AS board_rank
                """ + POSTS_FROM + " JOIN member m ON m.id=p.member_id WHERE p.status='PUBLISHED' AND " + VISIBLE
                + " AND p.board_id IN (" + placeholders + ")) latest WHERE latest.board_rank=1";
        var latest = new HashMap<Long, CommunityService.LatestPost>();
        jdbc.query(sql, (RowCallbackHandler) r -> {
            boolean spoiler = r.getBoolean("has_spoiler");
            latest.put(r.getLong("board_id"), new CommunityService.LatestPost(r.getString("id"), r.getString("head"),
                    spoiler ? null : r.getString("title"), r.getString("nickname"), r.getLong("like_count"),
                    r.getLong("comment_count"), spoiler, spoiler));
        }, boards.toArray());
        return latest;
    }

    List<CommunityService.WorkBoard> works(String query, int limit, long offset) {
        return jdbc.query("SELECT bo.id AS board_id," + WORK_FIELDS + WORKS_FROM + WORKS_WHERE
                + " ORDER BY b.title,b.id LIMIT ? OFFSET ?", (r, n) ->
                new CommunityService.WorkBoard(work(r), r.getString("board_id")), query, query, query, query, limit, offset);
    }

    long workCount(String query) {
        return jdbc.queryForObject("SELECT COUNT(*)" + WORKS_FROM + WORKS_WHERE,
                Long.class, query, query, query, query);
    }

    Optional<BoardData> workBoard(long book) {
        return jdbc.query(BOARDS + " WHERE bo.book_id=?", BOARD, book).stream().findFirst();
    }

    Optional<BoardData> topicBoard(String name) {
        return jdbc.query(BOARDS + " WHERE bo.type='TOPIC' AND bo.name=?", BOARD, name).stream().findFirst();
    }

    /** 작품 공개 상태를 확인하고 같은 작품의 동시 게시판 생성을 직렬화합니다. */
    long lockBook(String slug) {
        return jdbc.queryForList("SELECT id FROM book WHERE slug=? AND publish_status='PUBLISHED' FOR UPDATE",
                Long.class, slug).stream().findFirst().orElseThrow(CommunityService::notFound);
    }

    long insertBoard(String type, Long book, String name) {
        var key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("INSERT INTO board(type,book_id,name) VALUES (?,?,?)",
                    Statement.RETURN_GENERATED_KEYS);
            statement.setString(1, type); statement.setObject(2, book); statement.setString(3, name);
            return statement;
        }, key);
        return Objects.requireNonNull(key.getKey()).longValue();
    }

    Optional<BoardData> board(long id) {
        return jdbc.query(BOARDS + " WHERE bo.id=? AND (bo.book_id IS NULL OR b.publish_status='PUBLISHED')",
                BOARD, id).stream().findFirst();
    }

    Optional<Long> book(String slug) {
        return jdbc.queryForList("SELECT id FROM book WHERE slug=? AND publish_status='PUBLISHED'", Long.class, slug)
                .stream().findFirst();
    }

    List<CommunityService.Chapter> chapters(long book) {
        return jdbc.query("SELECT id,chapter_no,title FROM chapter WHERE book_id=? AND published_at<=CURRENT_TIMESTAMP"
                + " ORDER BY chapter_no,id", (r, n) -> new CommunityService.Chapter(r.getString("id"),
                r.getInt("chapter_no"), r.getString("title")), book);
    }

    boolean publishedChapter(long chapter, long book) {
        return jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM chapter WHERE id=? AND book_id=?"
                + " AND published_at<=CURRENT_TIMESTAMP)", Boolean.class, chapter, book);
    }

    List<CommunityService.Sticker> stickers() {
        return jdbc.query("SELECT id,code,name,image_url FROM sticker ORDER BY id", (r, n) ->
                new CommunityService.Sticker(r.getString("id"), r.getString("code"), r.getString("name"), r.getString("image_url")));
    }

    List<PostData> posts(Filter filter, int limit, long offset) {
        var clause = clause(filter);
        var args = new ArrayList<Object>();
        args.add(filter.viewer()); args.add(filter.viewer()); args.addAll(clause.parameters());
        args.add(limit); args.add(offset);
        return jdbc.query(POSTS + clause.sql() + " ORDER BY p.published_at DESC,p.id DESC LIMIT ? OFFSET ?", POST, args.toArray());
    }

    long postCount(Filter filter) {
        var clause = clause(filter);
        return jdbc.queryForObject("SELECT COUNT(*)" + POSTS_FROM + clause.sql(),
                Long.class, clause.parameters().toArray());
    }

    private static Clause clause(Filter filter) {
        StringBuilder sql = new StringBuilder(" WHERE " + VISIBLE);
        var args = new ArrayList<Object>();
        if (filter.mine()) { sql.append(" AND p.member_id=? AND p.status IN ('PUBLISHED','HIDDEN')"); args.add(filter.viewer()); }
        else sql.append(" AND p.status='PUBLISHED'");
        if (filter.boardId() != null) { sql.append(" AND p.board_id=?"); args.add(filter.boardId()); }
        if (filter.type() != null) { sql.append(" AND bo.type=?"); args.add(filter.type()); }
        if (filter.head() != null) { sql.append(" AND p.head=?"); args.add(filter.head()); }
        if (!filter.query().isEmpty()) {
            // 확인하지 않은 스포일러 원문이 검색 결과 유무로 노출되지 않게 합니다.
            sql.append(" AND (NOT p.has_spoiler OR p.member_id=?) AND (LOCATE(?,p.title)>0 OR LOCATE(?,p.body)>0)");
            args.add(filter.viewer()); args.add(filter.query()); args.add(filter.query());
        }
        return new Clause(sql.toString(), args);
    }

    Optional<PostData> post(long id, Long viewer) {
        return jdbc.query(POSTS + " WHERE p.id=?", POST, viewer, viewer, id).stream().findFirst();
    }

    void lockMember(long id) {
        if (jdbc.queryForList("SELECT id FROM member WHERE id=? AND status='ACTIVE' FOR UPDATE", Long.class, id).isEmpty())
            throw CommunityService.unauthorized();
    }

    void lockPost(long id) {
        if (jdbc.queryForList("SELECT id FROM post WHERE id=? FOR UPDATE", Long.class, id).isEmpty())
            throw CommunityService.notFound();
    }

    Optional<Long> draftId(long member) {
        return jdbc.queryForList("SELECT id FROM post WHERE member_id=? AND status='DRAFT' ORDER BY id DESC LIMIT 1",
                Long.class, member).stream().findFirst();
    }

    long insert(long member, CommunityService.Draft input, Long book, boolean published) {
        var key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("""
                    INSERT INTO post(board_id,book_id,member_id,head,title,body,spoiler_chapter_id,has_spoiler,status,published_at)
                    VALUES (?,?,?,?,?,?,?,?,?,IF(?='PUBLISHED',CURRENT_TIMESTAMP,NULL))
                    """, Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, input.boardId()); statement.setObject(2, book); statement.setLong(3, member);
            statement.setString(4, input.head()); statement.setString(5, input.title()); statement.setString(6, input.body());
            statement.setObject(7, input.spoilerChapterId()); statement.setBoolean(8, input.hasSpoiler());
            statement.setString(9, published ? "PUBLISHED" : "DRAFT"); statement.setString(10, published ? "PUBLISHED" : "DRAFT");
            return statement;
        }, key);
        return Objects.requireNonNull(key.getKey()).longValue();
    }

    void update(long id, CommunityService.Draft input, Long book, boolean publishDraft) {
        jdbc.update("""
                UPDATE post SET board_id=?,book_id=?,head=?,title=?,body=?,spoiler_chapter_id=?,has_spoiler=?,
                    published_at=CASE WHEN status='DRAFT' AND ? THEN CURRENT_TIMESTAMP ELSE published_at END,
                    status=CASE WHEN status='DRAFT' AND ? THEN 'PUBLISHED' ELSE status END,updated_at=CURRENT_TIMESTAMP
                WHERE id=?
                """, input.boardId(), book, input.head(), input.title(), input.body(), input.spoilerChapterId(), input.hasSpoiler(),
                publishDraft, publishDraft, id);
    }

    void delete(long id, boolean draft) {
        jdbc.update(draft ? "DELETE FROM post WHERE id=?" : "UPDATE post SET status='DELETED',updated_at=CURRENT_TIMESTAMP WHERE id=?", id);
    }

    List<SavedImage> images(long post) {
        return jdbc.query("SELECT image_url,width,height,is_representative FROM post_image WHERE post_id=? ORDER BY sort_order",
                (r, n) -> new SavedImage(r.getString("image_url"), r.getInt("width"), r.getInt("height"), r.getBoolean("is_representative")), post);
    }

    /** 현재 페이지에서 공개할 글의 이미지만 첨부 순서대로 한 번에 조회합니다. */
    Map<Long, List<SavedImage>> images(List<Long> posts) {
        if (posts.isEmpty()) return Map.of();
        String placeholders = String.join(",", java.util.Collections.nCopies(posts.size(), "?"));
        var images = new HashMap<Long, List<SavedImage>>();
        jdbc.query("SELECT post_id,image_url,width,height,is_representative FROM post_image WHERE post_id IN ("
                + placeholders + ") ORDER BY post_id,sort_order", (RowCallbackHandler) r ->
                images.computeIfAbsent(r.getLong("post_id"), id -> new ArrayList<>()).add(new SavedImage(
                        r.getString("image_url"), r.getInt("width"), r.getInt("height"), r.getBoolean("is_representative"))), posts.toArray());
        return images;
    }

    List<CommunityService.Sticker> selectedStickers(long id, boolean comment) {
        return jdbc.query("SELECT s.id,s.code,s.name,s.image_url FROM " + (comment ? "post_comment_sticker" : "post_sticker")
                + " ps JOIN sticker s ON s.id=ps.sticker_id WHERE " + (comment ? "comment_id" : "post_id") + "=? ORDER BY sort_order",
                (r, n) -> new CommunityService.Sticker(r.getString("id"), r.getString("code"), r.getString("name"), r.getString("image_url")), id);
    }

    /** 글·댓글별 스티커의 반복 선택과 정렬을 유지하여 페이지 단위로 조회합니다. */
    Map<Long, List<CommunityService.Sticker>> selectedStickers(List<Long> ids, boolean comment) {
        if (ids.isEmpty()) return Map.of();
        String table = comment ? "post_comment_sticker" : "post_sticker", column = comment ? "comment_id" : "post_id";
        String placeholders = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
        var stickers = new HashMap<Long, List<CommunityService.Sticker>>();
        jdbc.query("SELECT ps." + column + " AS owner_id,s.id,s.code,s.name,s.image_url FROM " + table
                + " ps JOIN sticker s ON s.id=ps.sticker_id WHERE ps." + column + " IN (" + placeholders
                + ") ORDER BY ps." + column + ",ps.sort_order", (RowCallbackHandler) r ->
                stickers.computeIfAbsent(r.getLong("owner_id"), id -> new ArrayList<>()).add(new CommunityService.Sticker(
                        r.getString("id"), r.getString("code"), r.getString("name"), r.getString("image_url"))), ids.toArray());
        return stickers;
    }

    void replaceAttachments(long post, List<SavedImage> images, List<Long> stickers) {
        jdbc.update("DELETE FROM post_image WHERE post_id=?", post);
        for (int i = 0; i < images.size(); i++) {
            var image = images.get(i);
            jdbc.update("INSERT INTO post_image(post_id,image_url,width,height,sort_order,is_representative) VALUES (?,?,?,?,?,?)",
                    post, image.url(), image.width(), image.height(), i + 1, i == 0);
        }
        replaceStickers(post, stickers, false);
    }

    void replaceStickers(long id, List<Long> stickers, boolean comment) {
        String table = comment ? "post_comment_sticker" : "post_sticker";
        String column = comment ? "comment_id" : "post_id";
        jdbc.update("DELETE FROM " + table + " WHERE " + column + "=?", id);
        for (int i = 0; i < stickers.size(); i++)
            jdbc.update("INSERT INTO " + table + "(" + column + ",sort_order,sticker_id) VALUES (?,?,?)", id, i + 1, stickers.get(i));
    }

    List<CommentData> comments(long post, int limit, long offset) {
        return jdbc.query(COMMENTS + " WHERE pc.post_id=? ORDER BY pc.created_at,pc.id LIMIT ? OFFSET ?", COMMENT, post, limit, offset);
    }

    Optional<CommentData> comment(long id) { return jdbc.query(COMMENTS + " WHERE pc.id=?", COMMENT, id).stream().findFirst(); }

    long commentCount(long post) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM post_comment WHERE post_id=?", Long.class, post);
    }

    long insertComment(long post, Long book, long member, CommunityService.CommentDraft input) {
        var key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("INSERT INTO post_comment(post_id,book_id,member_id,body,spoiler_chapter_id,has_spoiler) VALUES (?,?,?,?,?,?)",
                    Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, post); statement.setObject(2, book); statement.setLong(3, member);
            statement.setString(4, input.body()); statement.setObject(5, input.spoilerChapterId()); statement.setBoolean(6, input.hasSpoiler());
            return statement;
        }, key);
        return Objects.requireNonNull(key.getKey()).longValue();
    }

    void updateComment(long id, CommunityService.CommentDraft input) {
        jdbc.update("UPDATE post_comment SET body=?,spoiler_chapter_id=?,has_spoiler=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
                input.body(), input.spoilerChapterId(), input.hasSpoiler(), id);
    }

    void deleteComment(long id) { jdbc.update("DELETE FROM post_comment WHERE id=?", id); }

    void like(long post, long member, boolean liked) {
        if (liked) {
            if (jdbc.queryForList("SELECT id FROM post_reaction WHERE post_id=? AND member_id=?", Long.class, post, member).isEmpty())
                jdbc.update("INSERT INTO post_reaction(post_id,member_id) VALUES (?,?)", post, member);
        } else jdbc.update("DELETE FROM post_reaction WHERE post_id=? AND member_id=?", post, member);
    }

    Optional<Long> report(long post, long member) {
        return jdbc.queryForList("SELECT id FROM post_report WHERE post_id=? AND reporter_member_id=?", Long.class, post, member)
                .stream().findFirst();
    }

    long insertReport(long post, long member, String reason, String detail) {
        var key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("INSERT INTO post_report(post_id,reporter_member_id,reason,detail) VALUES (?,?,?,?)",
                    Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, post); statement.setLong(2, member); statement.setString(3, reason); statement.setString(4, detail);
            return statement;
        }, key);
        return Objects.requireNonNull(key.getKey()).longValue();
    }

    boolean publicImage(String url, boolean reveal) {
        return jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM post_image pi JOIN post p ON p.id=pi.post_id"
                + " JOIN board bo ON bo.id=p.board_id LEFT JOIN book bb ON bb.id=bo.book_id LEFT JOIN book b ON b.id=p.book_id"
                + " WHERE pi.image_url=? AND p.status='PUBLISHED' AND " + VISIBLE
                + " AND (NOT p.has_spoiler OR ?))", Boolean.class, url, reveal);
    }

    private static CommunityService.Work work(ResultSet r) throws SQLException {
        if (r.getString("work_slug") == null) return null;
        String kind = switch (r.getString("work_kind")) { case "BOOK" -> "book"; case "MAGAZINE" -> "magazine"; case "WEBNOVEL" -> "novel"; default -> throw new SQLException("작품 종류가 올바르지 않습니다."); };
        return new CommunityService.Work(r.getString("work_slug"), r.getString("work_title"), r.getString("work_author"), r.getString("work_image"), kind);
    }

    private static CommunityService.Chapter spoiler(ResultSet r) throws SQLException {
        return r.getString("spoiler_id") == null ? null : new CommunityService.Chapter(r.getString("spoiler_id"), r.getInt("spoiler_number"), r.getString("spoiler_title"));
    }

    private static Instant instant(ResultSet r, String column) throws SQLException {
        var value = r.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }
}
