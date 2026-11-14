package com.mobtwig.library;

import java.util.List;
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
     * 숨기지 않은 공개 작품을 서재에 담은 최신순으로 모두 반환합니다.
     * @param member 현재 인증된 회원 ID입니다.
     * @param contentType DB 작품 종류이며 null이면 전체입니다.
     * @return 담은 시각과 서재 ID의 내림차순 목록입니다.
     */
    List<Row> list(long member, @Nullable String contentType) {
        return jdbc.query("""
                SELECT b.slug,b.title,b.cover_image_url,b.content_type,l.status
                FROM library_book l JOIN book b ON b.id=l.book_id
                WHERE l.member_id=? AND l.is_hidden=FALSE AND b.publish_status='PUBLISHED'
                  AND (? IS NULL OR b.content_type=?)
                ORDER BY l.created_at DESC,l.id DESC
                """, (rs, row) -> new Row(rs.getString("slug"), rs.getString("title"), rs.getString("cover_image_url"),
                rs.getString("content_type"), rs.getString("status")), member, contentType, contentType);
    }

    record Row(String slug, String title, String imageUrl, String contentType, String status) { }
}
