package com.mobtwig.library;

import java.util.List;
import java.util.HashMap;
import java.util.Map;
import com.mobtwig.work.WorkMetadata;
import org.jspecify.annotations.Nullable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 기존 library_book에서 회원 본인의 서재를 조회합니다. 읽기 위치나 최근 본 기록은 변경하지 않습니다. */
@Repository
public class LibraryRepository {
    private final JdbcTemplate jdbc;

    /**
     * DB 조회 도구를 주입받습니다.
     * @param jdbc 현재 환경의 DB 연결입니다.
     */
    public LibraryRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    /**
     * 숨기지 않은 공개 작품과 현재 회원의 마지막 공개 회차·웹소설 집계를 서재에 담은 최신순으로 반환합니다.
     * @param member 현재 인증된 회원 ID입니다.
     * @param contentType DB 작품 종류이며 null이면 전체입니다.
     * @return 담은 시각과 서재 ID의 내림차순 목록입니다.
     */
    List<Row> list(long member, @Nullable String contentType) {
        Map<Long, String> authors = new HashMap<>();
        jdbc.query("""
                SELECT ba.book_id,a.name FROM library_book l
                JOIN book b ON b.id=l.book_id JOIN book_author ba ON ba.book_id=b.id
                JOIN author a ON a.id=ba.author_id
                WHERE l.member_id=? AND l.is_hidden=FALSE AND b.publish_status='PUBLISHED'
                  AND (? IS NULL OR b.content_type=?) ORDER BY a.id
                """, rs -> { authors.merge(rs.getLong("book_id"), WorkMetadata.requiredText(rs.getString("name"), "저자"),
                (previous, name) -> previous + ", " + name); }, member, contentType, contentType);
        return jdbc.query("""
                SELECT b.id,b.slug,b.title,b.cover_image_url,b.content_type,l.status,
                  b.view_count,b.recommend_count,c.chapter_no AS last_read_chapter_no,
                  (SELECT COUNT(*) FROM chapter counted WHERE counted.book_id=b.id
                    AND counted.published_at<=UTC_TIMESTAMP(6)) AS chapter_count,
                  EXISTS(SELECT 1 FROM chapter next_chapter WHERE next_chapter.book_id=b.id
                    AND next_chapter.chapter_no>c.chapter_no AND next_chapter.published_at<=UTC_TIMESTAMP(6)) AS has_next_chapter
                FROM library_book l JOIN book b ON b.id=l.book_id
                LEFT JOIN reading_progress p ON p.member_id=l.member_id AND p.book_id=l.book_id
                LEFT JOIN chapter c ON c.id=p.chapter_id AND c.book_id=b.id AND c.published_at<=UTC_TIMESTAMP(6)
                WHERE l.member_id=? AND l.is_hidden=FALSE AND b.publish_status='PUBLISHED'
                  AND (? IS NULL OR b.content_type=?)
                ORDER BY l.created_at DESC,l.id DESC
                """, (rs, row) -> new Row(rs.getString("slug"), rs.getString("title"), authors.get(rs.getLong("id")), rs.getString("cover_image_url"),
                rs.getString("content_type"), rs.getString("status"), rs.getObject("last_read_chapter_no", Integer.class),
                rs.getLong("view_count"), rs.getLong("recommend_count"), rs.getInt("chapter_count"), rs.getBoolean("has_next_chapter")),
                member, contentType, contentType);
    }

    record Row(String slug, String title, @Nullable String author, String imageUrl, String contentType, String status,
            @Nullable Integer lastReadChapterNumber, long views, long recommendations, int chapterCount, boolean hasNextChapter) { }
}
