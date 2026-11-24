package com.mobtwig.notification;

/** 앱의 parseNotificationList 규칙에 맞춘 알림 응답 형식입니다. */
final class NotificationResponse {
    private NotificationResponse() { }

    /**
     * 최신 알림 목록과 전체 안 읽은 개수입니다.
     * @param unreadCount 목록 제한과 무관한 본인의 안 읽은 알림 수입니다.
     * @param items 생성 시각·ID 내림차순의 최신 알림입니다.
     */
    record List(long unreadCount, java.util.List<Item> items) { }

    /**
     * 알림 한 건입니다. 시각은 UTC ISO 8601 문자열입니다.
     * @param id 알림 ID의 십진 문자열입니다.
     * @param type 소문자 종류(notice, comment, work, event)입니다.
     */
    record Item(String id, String type, String title, String message, String createdAt, String readAt) { }
}
