package com.mobtwig.review;

import java.math.BigDecimal;
import java.sql.Statement;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

/** 리뷰·댓글과 회원별 공감·신고 상태를 조회하고 작품 잠금 안에서 변경합니다. */
@Repository
class ReviewRepository {
    private static final String ITEMS = """
            SELECT r.id,
                   CASE WHEN r.active_key=1 THEN r.rating END AS rating,
                   CASE WHEN r.active_key=1 THEN r.content END AS content,
                   CASE WHEN r.active_key IS NULL THEN NULL
                        WHEN m.status='WITHDRAWN' THEN '탈퇴한 회원' ELSE m.nickname END AS nickname,
                   r.created_at,
                   (SELECT COUNT(*) FROM review_comment c WHERE c.review_id=r.id) AS comment_count,
                   (SELECT COUNT(*) FROM review_like l WHERE l.review_id=r.id) AS like_count,
                   COALESCE(r.active_key=1 AND r.member_id=?,FALSE) AS mine,
                   COALESCE(r.active_key=1 AND EXISTS(SELECT 1 FROM review_like l WHERE l.review_id=r.id AND l.member_id=?),FALSE) AS liked,
                   COALESCE(r.active_key=1 AND EXISTS(SELECT 1 FROM review_report p WHERE p.review_id=r.id AND p.member_id=?),FALSE) AS reported,
                   r.deleted_at IS NOT NULL AS deleted
            FROM review r JOIN member m ON m.id=r.member_id
            """;
    private static final String DISPLAYED = "(r.active_key=1 OR EXISTS(SELECT 1 FROM review_comment c WHERE c.review_id=r.id))";
    private static final RowMapper<ReviewService.Item> ITEM = (row, index) -> new ReviewService.Item(
            row.getString("id"), row.getObject("rating", Integer.class), row.getString("content"), row.getString("nickname"),
            row.getTimestamp("created_at").toInstant(), row.getLong("comment_count"), row.getLong("like_count"),
            row.getBoolean("mine"), row.getBoolean("liked"), row.getBoolean("reported"), row.getBoolean("deleted"));
    private static final String COMMENTS = """
            SELECT c.id,c.content,
                   CASE WHEN m.status='WITHDRAWN' THEN '탈퇴한 회원' ELSE m.nickname END AS nickname,
                   c.created_at,
                   (SELECT COUNT(*) FROM review_like l WHERE l.review_comment_id=c.id) AS like_count,
                   COALESCE(c.member_id=?,FALSE) AS mine,
                   EXISTS(SELECT 1 FROM review_like l WHERE l.review_comment_id=c.id AND l.member_id=?) AS liked,
                   EXISTS(SELECT 1 FROM review_report p WHERE p.review_comment_id=c.id AND p.member_id=?) AS reported
            FROM review_comment c JOIN member m ON m.id=c.member_id
            """;
    private static final RowMapper<ReviewService.Comment> COMMENT = (row, index) -> new ReviewService.Comment(
            row.getString("id"), row.getString("content"), row.getString("nickname"), row.getTimestamp("created_at").toInstant(),
            row.getLong("like_count"), row.getBoolean("mine"), row.getBoolean("liked"), row.getBoolean("reported"));

    private final JdbcTemplate jdbc;

    ReviewRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    Optional<Long> publishedBookId(String slug, boolean lock) {
        return jdbc.queryForList("SELECT id FROM book WHERE slug=? AND publish_status='PUBLISHED'"
                + (lock ? " FOR UPDATE" : ""), Long.class, slug).stream().findFirst();
    }

    Optional<Long> lockPublishedBook(long book) {
        return jdbc.queryForList("SELECT id FROM book WHERE id=? AND publish_status='PUBLISHED' FOR UPDATE", Long.class, book)
                .stream().findFirst();
    }

    Optional<Long> publishedReviewBookId(long review) {
        return jdbc.queryForList("""
                SELECT r.book_id FROM review r JOIN book b ON b.id=r.book_id
                WHERE r.id=? AND b.publish_status='PUBLISHED'
                """, Long.class, review).stream().findFirst();
    }

    Optional<Long> commentBookId(long comment) {
        return jdbc.queryForList("""
                SELECT r.book_id FROM review_comment c JOIN review r ON r.id=c.review_id
                WHERE c.id=?
                """, Long.class, comment).stream().findFirst();
    }

    List<ReviewService.Item> page(long book, Long viewer, int limit, long offset) {
        return jdbc.query(ITEMS + " WHERE r.book_id=? AND " + DISPLAYED + " ORDER BY r.created_at DESC,r.id DESC LIMIT ? OFFSET ?",
                ITEM, viewer, viewer, viewer, book, limit, offset);
    }

    long displayCount(long book) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM review r WHERE r.book_id=? AND " + DISPLAYED,
                Long.class, book);
    }

    Optional<ReviewService.Item> mine(long book, long member) {
        return jdbc.query(ITEMS + " WHERE r.book_id=? AND r.member_id=? AND r.active_key=1", ITEM,
                member, member, member, book, member).stream().findFirst();
    }

    Optional<ReviewService.Item> item(long book, long review, Long viewer) {
        return jdbc.query(ITEMS + " WHERE r.book_id=? AND r.id=?", ITEM, viewer, viewer, viewer, book, review).stream().findFirst();
    }

    List<ReviewService.Comment> comments(long review, Long viewer) {
        return jdbc.query(COMMENTS + " WHERE c.review_id=? ORDER BY c.created_at,c.id", COMMENT, viewer, viewer, viewer, review);
    }

    Optional<ReviewService.Comment> comment(long comment, long viewer) {
        return jdbc.query(COMMENTS + " WHERE c.id=?", COMMENT, viewer, viewer, viewer, comment).stream().findFirst();
    }

    boolean ownsActiveReview(long book, long review, long member) {
        return jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM review WHERE book_id=? AND id=? AND member_id=? AND active_key=1)",
                Boolean.class, book, review, member);
    }

    boolean activeReview(long book, long review) {
        return jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM review WHERE book_id=? AND id=? AND active_key=1)", Boolean.class, book, review);
    }

    boolean ownsComment(long book, long comment, long member) {
        return jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM review_comment c JOIN review r ON r.id=c.review_id
                              WHERE r.book_id=? AND c.id=? AND c.member_id=?)
                """, Boolean.class, book, comment, member);
    }

    long[] counts(long book) {
        long[] counts = new long[5];
        jdbc.query("SELECT rating,COUNT(*) AS total FROM review WHERE book_id=? AND active_key=1 GROUP BY rating", row -> {
            counts[row.getInt("rating") - 1] = row.getLong("total");
        }, book);
        return counts;
    }

    long insert(long book, long member, int rating, String body) {
        var key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("INSERT INTO review(book_id,member_id,rating,content) VALUES (?,?,?,?)",
                    Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, book);
            statement.setLong(2, member);
            statement.setInt(3, rating);
            statement.setString(4, body);
            return statement;
        }, key);
        return Objects.requireNonNull(key.getKey()).longValue();
    }

    void updateSummary(long book, ReviewService.Summary summary) {
        jdbc.update("UPDATE book SET average_rating=?,review_count=? WHERE id=?",
                summary.average() == null ? BigDecimal.ZERO : summary.average(), summary.count(), book);
    }

    void update(long review, int rating, String body) {
        jdbc.update("UPDATE review SET rating=?,content=? WHERE id=?", rating, body, review);
    }

    void delete(long review) {
        jdbc.update("UPDATE review SET deleted_at=CURRENT_TIMESTAMP WHERE id=?", review);
    }

    long insertComment(long review, long member, String body) {
        var key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("INSERT INTO review_comment(review_id,member_id,content) VALUES (?,?,?)",
                    Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, review);
            statement.setLong(2, member);
            statement.setString(3, body);
            return statement;
        }, key);
        return Objects.requireNonNull(key.getKey()).longValue();
    }

    void updateComment(long comment, String body) {
        jdbc.update("UPDATE review_comment SET content=? WHERE id=?", body, comment);
    }

    void deleteComment(long comment) {
        jdbc.update("DELETE FROM review_comment WHERE id=?", comment);
    }
}
