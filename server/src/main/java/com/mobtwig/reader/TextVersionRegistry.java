package com.mobtwig.reader;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** 회차·버전으로 처음 제공한 텍스트를 서버에서 고정합니다. */
@Component
class TextVersionRegistry {
    private final JdbcTemplate jdbc;

    TextVersionRegistry(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    void pin(long chapter, int version, String hash) {
        String previous = find(chapter, version);
        if (previous == null) {
            jdbc.update("""
                    INSERT INTO chapter_text_version(chapter_id,content_version,content_hash) VALUES(?,?,?)
                    ON DUPLICATE KEY UPDATE content_hash=chapter_text_version.content_hash
                    """, chapter, version, hash);
            previous = jdbc.queryForObject("""
                    SELECT content_hash FROM chapter_text_version WHERE chapter_id=? AND content_version=? FOR SHARE
                    """, String.class, chapter, version);
        }
        if (!hash.equals(previous)) throw ReadingProgressFailure.contentChanged();
    }

    void verify(long chapter, int version, String hash, boolean required) {
        String pinned = find(chapter, version);
        if (pinned != null ? !hash.equals(pinned) : required) throw ReadingProgressFailure.contentChanged();
    }

    private String find(long chapter, int version) {
        return jdbc.queryForList("""
                SELECT content_hash FROM chapter_text_version WHERE chapter_id=? AND content_version=?
                """, String.class, chapter, version).stream().findFirst().orElse(null);
    }
}
