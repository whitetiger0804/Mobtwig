package com.mobtwig.reader;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 회원별 최근 본 작품 기록 저장소입니다. 조회수 집계와 읽기 위치에는 접근하지 않습니다. */
@Repository
public class RecentWorksRepository {
    static final int LIMIT = 20;
    private final JdbcTemplate jdbc;

    public RecentWorksRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    /** 공개 작품만 최근 본 순서로 반환합니다. 비공개 작품의 기록은 삭제하지 않습니다. */
    List<Row> list(long member) {
        return jdbc.query("""
                SELECT b.slug,b.title,b.cover_image_url,b.content_type,r.last_viewed_at
                FROM recent_view r JOIN book b ON b.id=r.book_id
                WHERE r.member_id=? AND b.publish_status='PUBLISHED' AND b.cover_image_url IS NOT NULL
                ORDER BY r.last_viewed_at DESC, r.id DESC LIMIT ?
                """, (rs, row) -> new Row(rs.getString("slug"), rs.getString("title"), rs.getString("cover_image_url"),
                rs.getString("content_type"), rs.getTimestamp("last_viewed_at").toInstant()), member, LIMIT);
    }

    Optional<Long> publishedBook(String slug) {
        return jdbc.queryForList("SELECT id FROM book WHERE slug=? AND publish_status='PUBLISHED' FOR SHARE", Long.class, slug)
                .stream().findFirst();
    }

    /** 같은 작품을 다시 보면 행을 추가하지 않고 시각만 갱신합니다. */
    void upsert(long member, long book, Instant viewedAt) {
        var at = Timestamp.from(viewedAt);
        jdbc.update("""
                INSERT INTO recent_view (member_id,book_id,last_viewed_at) VALUES (?,?,?)
                ON DUPLICATE KEY UPDATE last_viewed_at=?
                """, member, book, at, at);
    }

    record Row(String slug, String title, String imageUrl, String contentType, Instant lastViewedAt) { }
}
