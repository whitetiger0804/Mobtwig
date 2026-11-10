package com.mobtwig.reader;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import com.mobtwig.work.WorkMetadata;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 본문 조회수 집계와 분리된 공개 회차·회원 기록 저장소입니다. */
@Repository
public class ReadingProgressRepository {
    private final JdbcTemplate jdbc;

    public ReadingProgressRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    boolean lockActiveMember(long member) {
        return !jdbc.queryForList("SELECT id FROM member WHERE id=? AND status='ACTIVE' FOR UPDATE", Long.class, member).isEmpty();
    }

    Optional<Work> work(String slug, Instant now, boolean writing) {
        String lock = writing ? " FOR SHARE" : "";
        var works = jdbc.query("SELECT id,slug,content_type,page_count FROM book WHERE slug=? AND publish_status='PUBLISHED'" + lock,
                (rs, row) -> new Work(rs.getLong("id"), rs.getString("slug"), WorkMetadata.kind(rs.getString("content_type")),
                        rs.getObject("page_count", Integer.class), List.of()), slug);
        if (works.isEmpty()) return Optional.empty();
        Work work = works.getFirst();
        var chapters = jdbc.query("""
                SELECT id,chapter_no,content_version,start_page,content_url,published_at<=? AS visible
                FROM chapter WHERE book_id=? ORDER BY chapter_no
                """ + lock, (rs, row) -> new Chapter(rs.getLong("id"), rs.getInt("chapter_no"), rs.getInt("content_version"),
                rs.getObject("start_page", Integer.class), rs.getString("content_url"), rs.getBoolean("visible")),
                Timestamp.from(now), work.id());
        return Optional.of(new Work(work.id(), work.slug(), work.kind(), work.pageCount(), List.copyOf(chapters)));
    }

    Optional<Saved> saved(long member, long book) {
        return jdbc.query("""
                SELECT chapter_id,chapter_offset,max_chapter_id,content_version,content_hash,revision,last_read_at
                FROM reading_progress WHERE member_id=? AND book_id=?
                """, (rs, row) -> new Saved(rs.getLong("chapter_id"), rs.getInt("chapter_offset"),
                rs.getObject("max_chapter_id", Long.class), rs.getInt("content_version"), rs.getString("content_hash"),
                rs.getLong("revision"), rs.getTimestamp("last_read_at").toInstant()), member, book).stream().findFirst();
    }

    String libraryStatus(long member, long book) {
        return jdbc.queryForList("SELECT status FROM library_book WHERE member_id=? AND book_id=?", String.class, member, book)
                .stream().findFirst().orElse(null);
    }

    void store(long member, long book, Saved next, boolean existing) {
        if (existing) {
            jdbc.update("""
                    UPDATE reading_progress
                    SET chapter_id=?,chapter_offset=?,max_chapter_id=?,content_version=?,content_hash=?,revision=?,last_read_at=?
                    WHERE member_id=? AND book_id=?
                    """, next.chapter(), next.offset(), next.maxChapter(), next.version(), next.hash(), next.revision(),
                    Timestamp.from(next.lastReadAt()), member, book);
        } else {
            jdbc.update("""
                    INSERT INTO reading_progress
                      (member_id,book_id,chapter_id,chapter_offset,max_chapter_id,content_version,content_hash,revision,last_read_at)
                    VALUES (?,?,?,?,?,?,?,?,?)
                    """, member, book, next.chapter(), next.offset(), next.maxChapter(), next.version(), next.hash(), next.revision(),
                    Timestamp.from(next.lastReadAt()));
        }
    }

    /** 위치와 같은 트랜잭션에서 상태만 변경하고 즐겨찾기·숨김은 유지합니다. */
    public void storeLibrary(long member, long book, String status) {
        jdbc.update("""
                INSERT INTO library_book (member_id,book_id,status) VALUES (?,?,?)
                ON DUPLICATE KEY UPDATE status=?
                """, member, book, status, status);
    }

    record Work(long id, String slug, String kind, Integer pageCount, List<Chapter> chapters) {
        boolean magazine() { return kind.equals("magazine"); }
        List<Chapter> visible() { return chapters.stream().filter(Chapter::visible).toList(); }
    }
    record Chapter(long id, int number, int version, Integer startPage, String url, boolean visible) { }
    record Saved(long chapter, int offset, Long maxChapter, int version, String hash, long revision, Instant lastReadAt) { }
}
