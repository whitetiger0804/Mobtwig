package com.mobtwig.review;

import java.sql.Statement;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

/** 공개 작품의 활성 리뷰, 평점 집계와 목록을 저장하거나 조회합니다. */
@Repository
class ReviewRepository {
    private static final String ITEMS = """
            SELECT r.id,r.rating,r.content,m.nickname,r.created_at
            FROM review r JOIN member m ON m.id=r.member_id
            WHERE r.book_id=? AND r.active_key=1
            """;
    private static final RowMapper<ReviewService.Item> ITEM = (row, index) -> new ReviewService.Item(
            row.getString("id"), row.getInt("rating"), row.getString("content"), row.getString("nickname"),
            row.getTimestamp("created_at").toInstant());

    private final JdbcTemplate jdbc;

    ReviewRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    Optional<Long> publishedBookId(String slug, boolean lock) {
        return jdbc.queryForList("SELECT id FROM book WHERE slug=? AND publish_status='PUBLISHED'"
                + (lock ? " FOR UPDATE" : ""), Long.class, slug).stream().findFirst();
    }

    List<ReviewService.Item> page(long book, int limit, long offset) {
        return jdbc.query(ITEMS + " ORDER BY r.created_at DESC,r.id DESC LIMIT ? OFFSET ?", ITEM, book, limit, offset);
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
        jdbc.update("UPDATE book SET average_rating=?,review_count=? WHERE id=?", summary.average(), summary.count(), book);
    }

    ReviewService.Item created(long book, long review) {
        return Objects.requireNonNull(jdbc.queryForObject(ITEMS + " AND r.id=?", ITEM, book, review));
    }
}
