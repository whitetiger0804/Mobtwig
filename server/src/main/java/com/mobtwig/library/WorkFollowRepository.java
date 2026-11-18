package com.mobtwig.library;

import java.util.List;
import java.util.Optional;

import com.mobtwig.work.WorkMetadata;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class WorkFollowRepository {
    private final JdbcTemplate jdbc;

    WorkFollowRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    Optional<Work> publishedWork(String slug, boolean lock) {
        return jdbc.query("""
                SELECT id, content_type FROM book WHERE slug=? AND publish_status='PUBLISHED'
                """ + (lock ? " FOR UPDATE" : ""),
                (row, index) -> new Work(row.getLong("id"), "WEBNOVEL".equals(row.getString("content_type"))), slug)
                .stream().findFirst();
    }

    WorkFollowService.State state(long member, Work work) {
        return jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM wishlist WHERE member_id=? AND book_id=?) AS favorite,
                       EXISTS(SELECT 1 FROM work_subscription WHERE member_id=? AND book_id=?) AS subscribed
                """, (row, index) -> new WorkFollowService.State(row.getBoolean("favorite"),
                work.webnovel() && row.getBoolean("subscribed")), member, work.id(), member, work.id());
    }

    void change(long member, long book, Kind kind, boolean present) {
        String table = kind == Kind.FAVORITE ? "wishlist" : "work_subscription";
        if (present) {
            jdbc.update("INSERT INTO " + table + " (member_id, book_id) VALUES (?, ?) "
                    + "ON DUPLICATE KEY UPDATE member_id = " + table + ".member_id", member, book);
        } else {
            jdbc.update("DELETE FROM " + table + " WHERE member_id=? AND book_id=?", member, book);
        }
        if (kind == Kind.FAVORITE) {
            jdbc.update("""
                    UPDATE book SET wishlist_count=(SELECT COUNT(*) FROM wishlist WHERE book_id=?) WHERE id=?
                    """, book, book);
        }
    }

    List<WorkFollowService.Favorite> favorites(long member, long offset, int limit) {
        return jdbc.query("""
                SELECT b.slug, b.title, b.cover_image_url, b.content_type
                FROM wishlist w JOIN book b ON b.id=w.book_id
                WHERE w.member_id=? AND b.publish_status='PUBLISHED'
                ORDER BY w.created_at DESC, w.id DESC LIMIT ? OFFSET ?
                """, (row, index) -> new WorkFollowService.Favorite(WorkMetadata.slug(row.getString("slug")),
                WorkMetadata.requiredText(row.getString("title"), "제목"),
                WorkMetadata.imageUrl(row.getString("cover_image_url")),
                WorkMetadata.kind(row.getString("content_type"))), member, limit, offset);
    }

    enum Kind { FAVORITE, SUBSCRIPTION }
    record Work(long id, boolean webnovel) { }
}
