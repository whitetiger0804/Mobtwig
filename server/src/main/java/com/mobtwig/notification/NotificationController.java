package com.mobtwig.notification;

import java.math.BigInteger;
import java.security.Principal;
import java.util.Map;
import java.util.Objects;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** 회원 본인의 알림 목록과 읽음 처리를 제공합니다. */
@RestController
class NotificationController {
    private final NotificationService notifications;

    NotificationController(NotificationService notifications) { this.notifications = notifications; }

    /** 최신 50개 알림과 전체 안 읽은 개수를 반환합니다. */
    @GetMapping("/api/members/notifications")
    ResponseEntity<NotificationResponse.List> list(Principal principal) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(notifications.list(member(principal)));
    }

    /** 본인 알림을 읽음으로 표시하며 반복 요청도 204입니다. */
    @PatchMapping("/api/members/notifications/{notificationId}/read")
    ResponseEntity<Void> read(@PathVariable String notificationId, Principal principal) {
        notifications.markRead(id(notificationId), member(principal));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    private static long member(Principal principal) { return Long.parseLong(principal.getName()); }

    private static long id(String value) {
        if (!value.matches("-?[1-9][0-9]{0,18}")) throw invalid();
        var number = new BigInteger(value);
        if (number.compareTo(BigInteger.valueOf(Long.MIN_VALUE)) < 0
                || number.compareTo(BigInteger.valueOf(Long.MAX_VALUE)) > 0) throw invalid();
        return number.longValue();
    }

    private static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "알림 요청 값이 올바르지 않습니다.");
    }

    /** 401은 본문 없이, 그 밖의 오류는 리뷰·커뮤니티와 같은 {message} 형식으로 반환합니다. */
    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> rejected(ResponseStatusException failure) {
        if (failure.getStatusCode().value() == 401) {
            return ResponseEntity.status(failure.getStatusCode()).cacheControl(CacheControl.noStore()).build();
        }
        return ResponseEntity.status(failure.getStatusCode()).cacheControl(CacheControl.noStore())
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("message", Objects.requireNonNull(failure.getReason())));
    }
}
