package com.mobtwig.reader;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/** 책갈피 조회와 변경은 항상 회원 ID를 조건으로 사용합니다. */
@Repository
class BookmarkRepository {
    private static final String COLUMNS = """
            SELECT m.id,m.book_id,b.slug,m.chapter_id,m.chapter_offset,m.content_version,m.content_hash,m.version_bound,m.snippet,m.created_at
            FROM bookmark m JOIN book b ON b.id=m.book_id
            """;
    private static final RowMapper<Saved> SAVED = (rs, row) -> new Saved(rs.getLong("id"), rs.getLong("book_id"),
            rs.getString("slug"), rs.getLong("chapter_id"), rs.getInt("chapter_offset"), rs.getInt("content_version"),
            rs.getString("content_hash"), rs.getBoolean("version_bound"), rs.getString("snippet"), rs.getTimestamp("created_at").toInstant());
    private final JdbcTemplate jdbc;

    BookmarkRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    List<Saved> list(long member, String slug, long offset, int limit) {
        String order = " ORDER BY m.created_at DESC,m.id DESC LIMIT ? OFFSET ?";
        if (slug == null) {
            return jdbc.query(COLUMNS + " WHERE m.member_id=?" + order, SAVED, member, limit, offset);
        }
        return jdbc.query(COLUMNS + " WHERE m.member_id=? AND b.slug=?" + order, SAVED, member, slug, limit, offset);
    }

    Optional<Saved> byPosition(long member, long chapter, int offset) {
        return jdbc.query(COLUMNS + " WHERE m.member_id=? AND m.chapter_id=? AND m.chapter_offset=?",
                SAVED, member, chapter, offset).stream().findFirst();
    }

    Saved insert(long member, long book, ReadingCoordinates.Checked position, String snippet) {
        jdbc.update("""
                INSERT INTO bookmark(member_id,book_id,chapter_id,chapter_offset,content_version,version_bound,snippet)
                VALUES(?,?,?,?,?,?,?)
                """, member, book, position.chapter().id(), position.offset(), position.chapter().version(), position.hash() != null, snippet);
        return byPosition(member, position.chapter().id(), position.offset()).orElseThrow();
    }

    boolean delete(long member, long id) {
        return jdbc.update("DELETE FROM bookmark WHERE id=? AND member_id=?", id, member) == 1;
    }

    record Saved(long id, long book, String slug, long chapter, int offset, int version, String hash, boolean bound, String snippet, Instant createdAt) { }
}
