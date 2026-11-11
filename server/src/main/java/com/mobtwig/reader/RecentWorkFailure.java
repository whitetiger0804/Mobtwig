package com.mobtwig.reader;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

final class RecentWorkFailure extends ResponseStatusException {
    final String code;

    RecentWorkFailure(HttpStatus status, String code, String message) {
        super(status, message);
        this.code = code;
    }

    static RecentWorkFailure invalid() {
        return new RecentWorkFailure(HttpStatus.BAD_REQUEST, "INVALID_SLUG", "작품 식별자를 확인해 주세요.");
    }
    static RecentWorkFailure notFound() {
        return new RecentWorkFailure(HttpStatus.NOT_FOUND, "NOT_FOUND", "공개된 작품이 없습니다.");
    }
}
