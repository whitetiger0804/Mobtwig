package com.mobtwig.favorite;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** wishlist와 book.wishlist_count 캐시를 다룹니다. library_book.is_favorite에는 접근하지 않습니다. */
@Repository
public class FavoriteRepository {
    private final JdbcTemplate jdbc;

    public FavoriteRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    /** 읽기 위치·최근 본 작품 저장과 같은 순서로 활성 회원 행을 먼저 잠급니다. */
    boolean lockActiveMember(long member) {
        return !jdbc.queryForList("SELECT id FROM member WHERE id=? AND status='ACTIVE' FOR UPDATE", Long.class, member).isEmpty();
    }

    /** 같은 트랜잭션에서 wishlist_count를 갱신하므로 S→X 승격 교착을 피하려고 처음부터 쓰기 잠금을 잡습니다. */
    Optional<Long> lockPublishedBook(String slug) {
        return jdbc.queryForList("SELECT id FROM book WHERE slug=? AND publish_status='PUBLISHED' FOR UPDATE", Long.class, slug)
                .stream().findFirst();
    }

    Optional<Long> publishedBook(String slug) {
        return jdbc.queryForList("SELECT id FROM book WHERE slug=? AND publish_status='PUBLISHED'", Long.class, slug)
                .stream().findFirst();
    }

    boolean exists(long member, long book) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM wishlist WHERE member_id=? AND book_id=?)", Boolean.class, member, book));
    }

    /** 이미 찜했으면 uk_wishlist_member_book 때문에 0을 반환합니다. 회원·작품 행은 호출 전에 잠가 존재를 확인합니다. */
    int insert(long member, long book) {
        return jdbc.update("INSERT IGNORE INTO wishlist (member_id,book_id) VALUES (?,?)", member, book);
    }

    int delete(long member, long book) {
        return jdbc.update("DELETE FROM wishlist WHERE member_id=? AND book_id=?", member, book);
    }

    void adjustCount(long book, int delta) {
        jdbc.update("UPDATE book SET wishlist_count=wishlist_count+? WHERE id=?", delta, book);
    }

    /** 공개 작품만 찜한 시각 내림차순, 같은 시각이면 찜 ID 내림차순으로 모두 반환합니다. 비공개 작품의 찜은 삭제하지 않습니다. */
    List<Row> list(long member) {
        return jdbc.query("""
                SELECT b.id,b.slug,b.title,b.cover_image_url,b.content_type
                FROM wishlist w JOIN book b ON b.id=w.book_id
                WHERE w.member_id=? AND b.publish_status='PUBLISHED'
                ORDER BY w.created_at DESC,w.id DESC
                """, (rs, row) -> new Row(rs.getLong("id"), rs.getString("slug"), rs.getString("title"),
                rs.getString("cover_image_url"), rs.getString("content_type")), member);
    }

    /** 찜한 작품별 저자 이름입니다. Book.authors와 같이 저자 ID 오름차순입니다. */
    Map<Long, List<String>> authors(long member) {
        Map<Long, List<String>> names = new HashMap<>();
        jdbc.query("""
                SELECT ba.book_id,a.name
                FROM wishlist w JOIN book_author ba ON ba.book_id=w.book_id JOIN author a ON a.id=ba.author_id
                WHERE w.member_id=?
                ORDER BY ba.book_id,a.id
                """, rs -> {
            names.computeIfAbsent(rs.getLong("book_id"), id -> new ArrayList<>()).add(rs.getString("name"));
        }, member);
        return names;
    }

    record Row(long bookId, String slug, String title, String imageUrl, String contentType) { }
}
