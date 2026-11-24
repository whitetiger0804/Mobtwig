package com.mobtwig.notification;

import com.mobtwig.auth.MemberSessions;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** 회원 본인의 최신 알림 조회와 멱등 읽음 처리를 제공합니다. */
@Service
class NotificationService {
    static final int LIMIT = 50;
    private final NotificationRepository notifications;
    private final MemberSessions members;

    NotificationService(NotificationRepository notifications, MemberSessions members) {
        this.notifications = notifications;
        this.members = members;
    }

    /** 최신 50개와 전체 안 읽은 개수를 같은 스냅샷에서 읽습니다. */
    @Transactional(readOnly = true)
    NotificationResponse.List list(long member) {
        var items = notifications.latest(member, LIMIT);
        return new NotificationResponse.List(notifications.unreadCount(member), items);
    }

    /** 회원을 먼저 잠근 뒤 본인 알림의 읽음 시각을 한 번만 기록합니다. 이미 읽었어도 성공입니다. */
    @Transactional
    void markRead(long id, long member) {
        members.lockActiveMember(member);
        if (notifications.markRead(id, member) == 0 && !notifications.owned(id, member)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "알림을 찾을 수 없습니다.");
        }
    }
}
