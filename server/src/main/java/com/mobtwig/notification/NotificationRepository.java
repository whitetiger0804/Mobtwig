package com.mobtwig.notification;

import java.sql.Timestamp;
import java.util.List;
import java.util.Locale;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 회원 본인의 알림을 조회하고 읽음 시각을 기록합니다. */
@Repository
class NotificationRepository {
    private final JdbcTemplate jdbc;

    NotificationRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    List<NotificationResponse.Item> latest(long member, int limit) {
        return jdbc.query("""
                SELECT id,type,title,message,created_at,read_at FROM notification
                WHERE member_id=? ORDER BY created_at DESC, id DESC LIMIT ?
                """, (rs, row) -> new NotificationResponse.Item(Long.toString(rs.getLong("id")),
                rs.getString("type").toLowerCase(Locale.ROOT), rs.getString("title"), rs.getString("message"),
                rs.getTimestamp("created_at").toInstant().toString(), iso(rs.getTimestamp("read_at"))), member, limit);
    }

    long unreadCount(long member) {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM notification WHERE member_id=? AND read_at IS NULL",
                Long.class, member);
        return count == null ? 0 : count;
    }

    /** 안 읽은 본인 알림만 현재 시각으로 표시하고 갱신한 행 수를 반환합니다. */
    int markRead(long id, long member) {
        return jdbc.update("UPDATE notification SET read_at=CURRENT_TIMESTAMP WHERE id=? AND member_id=? AND read_at IS NULL",
                id, member);
    }

    boolean owned(long id, long member) {
        return !jdbc.queryForList("SELECT id FROM notification WHERE id=? AND member_id=?", Long.class, id, member).isEmpty();
    }

    private static String iso(Timestamp value) { return value == null ? null : value.toInstant().toString(); }
}
