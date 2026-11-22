package com.mobtwig.reader;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

final class RecentWorkFailure extends ResponseStatusException {
    final String code;

    RecentWorkFailure(HttpStatus status, String code, String message) {
        super(status, message);
        this.code = code;
    }

    static RecentWorkFailure notFound() {
        return new RecentWorkFailure(HttpStatus.NOT_FOUND, "NOT_FOUND", "공개된 작품이 없습니다.");
    }
}
