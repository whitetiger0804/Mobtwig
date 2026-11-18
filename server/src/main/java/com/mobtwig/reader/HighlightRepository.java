package com.mobtwig.reader;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
class HighlightRepository {
    private static final String SELECT = """
            SELECT h.id,b.slug,h.chapter_id,h.start_offset,h.end_offset,h.content_version,h.content_hash,h.color,h.created_at
            FROM highlight h JOIN book b ON b.id=h.book_id WHERE h.member_id=?
            """;
    private static final RowMapper<Saved> ROW = (rs, index) -> new Saved(rs.getLong("id"), rs.getString("slug"),
            rs.getLong("chapter_id"), rs.getInt("start_offset"), rs.getInt("end_offset"), rs.getInt("content_version"),
            rs.getString("content_hash"), rs.getString("color"), rs.getTimestamp("created_at").toInstant());
    private final JdbcTemplate jdbc;

    HighlightRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    List<Saved> list(long member, String slug, Long chapter, long skip) {
        var sql = new StringBuilder(SELECT);
        var args = new ArrayList<Object>();
        args.add(member);
        if (slug != null) {
            sql.append(" AND b.slug=?");
            args.add(slug);
        }
        if (chapter != null) {
            sql.append(" AND h.chapter_id=?");
            args.add(chapter);
        }
        sql.append(" ORDER BY h.created_at DESC,h.id DESC LIMIT 31 OFFSET ?");
        args.add(skip);
        return jdbc.query(sql.toString(), ROW, args.toArray());
    }

    Optional<Saved> find(long member, HighlightService.Input input) {
        return jdbc.query(SELECT + """
                 AND h.chapter_id=? AND h.start_offset=? AND h.end_offset=? AND h.content_version=? AND h.content_hash <=> ?
                """, ROW, member, input.chapterId(), input.startOffset(), input.endOffset(),
                input.contentVersion(), input.contentHash()).stream().findFirst();
    }

    Saved insert(long member, long book, HighlightService.Input input, String snippet) {
        jdbc.update("""
                INSERT INTO highlight(member_id,book_id,chapter_id,start_offset,end_offset,content_version,content_hash,color,snippet)
                VALUES(?,?,?,?,?,?,?,?,?)
                """, member, book, input.chapterId(), input.startOffset(), input.endOffset(), input.contentVersion(),
                input.contentHash(), input.color(), snippet);
        return find(member, input).orElseThrow();
    }

    boolean delete(long member, long id) {
        return jdbc.update("DELETE FROM highlight WHERE member_id=? AND id=?", member, id) == 1;
    }

    record Saved(long id, String slug, long chapter, int start, int end, int version, String hash, String color, Instant created) { }
}
