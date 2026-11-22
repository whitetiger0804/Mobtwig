package com.mobtwig.review;

import java.sql.Statement;
import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

/** 리뷰·댓글의 부모와 소유자를 확인하고 회원별 반응을 저장합니다. */
@Repository
class ReviewEngagementRepository {
    record Parent(long book, long review) {}

    private final JdbcTemplate jdbc;

    ReviewEngagementRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    Optional<Parent> parent(long target, boolean comment) {
        String sql = comment
                ? "SELECT r.book_id,r.id FROM review_comment c JOIN review r ON r.id=c.review_id WHERE c.id=?"
                : "SELECT book_id,id FROM review WHERE id=?";
        return jdbc.query(sql, (row, index) -> new Parent(row.getLong("book_id"), row.getLong("id")), target)
                .stream().findFirst();
    }

    boolean lockPublishedBook(long book) {
        return !jdbc.queryForList("SELECT id FROM book WHERE id=? AND publish_status='PUBLISHED' FOR UPDATE",
                Long.class, book).isEmpty();
    }

    Optional<Long> lockReview(long review, long book, boolean active) {
        return jdbc.queryForList("SELECT member_id FROM review WHERE id=? AND book_id=?"
                + (active ? " AND active_key=1" : "") + " FOR UPDATE", Long.class, review, book).stream().findFirst();
    }

    Optional<Long> lockComment(long comment, long review) {
        return jdbc.queryForList("SELECT member_id FROM review_comment WHERE id=? AND review_id=? FOR UPDATE",
                Long.class, comment, review).stream().findFirst();
    }

    boolean liked(long target, long member, boolean comment) {
        return !jdbc.queryForList("SELECT id FROM review_like WHERE member_id=? AND " + column(comment) + "=?",
                Long.class, member, target).isEmpty();
    }

    void insertLike(long target, long member, boolean comment) {
        jdbc.update("INSERT INTO review_like(member_id," + column(comment) + ") VALUES (?,?)", member, target);
    }

    void deleteLike(long target, long member, boolean comment) {
        jdbc.update("DELETE FROM review_like WHERE member_id=? AND " + column(comment) + "=?", member, target);
    }

    long likeCount(long target, boolean comment) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM review_like WHERE " + column(comment) + "=?",
                Long.class, target);
    }

    Optional<Long> reportId(long target, long member, boolean comment) {
        return jdbc.queryForList("SELECT id FROM review_report WHERE member_id=? AND " + column(comment) + "=?",
                Long.class, member, target).stream().findFirst();
    }

    long insertReport(long target, long member, boolean comment, String reason, String detail) {
        var key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("INSERT INTO review_report(member_id," + column(comment)
                    + ",reason,detail) VALUES (?,?,?,?)", Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, member);
            statement.setLong(2, target);
            statement.setString(3, reason);
            statement.setString(4, detail);
            return statement;
        }, key);
        return Objects.requireNonNull(key.getKey()).longValue();
    }

    private static String column(boolean comment) { return comment ? "review_comment_id" : "review_id"; }
}
