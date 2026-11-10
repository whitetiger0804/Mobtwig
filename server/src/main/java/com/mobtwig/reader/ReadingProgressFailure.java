package com.mobtwig.reader;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

final class ReadingProgressFailure extends ResponseStatusException {
    final String code;

    ReadingProgressFailure(HttpStatus status, String code, String message) {
        super(status, message);
        this.code = code;
    }

    static ReadingProgressFailure invalid() {
        return new ReadingProgressFailure(HttpStatus.BAD_REQUEST, "INVALID_POSITION", "읽기 위치를 확인해 주세요.");
    }
    static ReadingProgressFailure notFound() {
        return new ReadingProgressFailure(HttpStatus.NOT_FOUND, "NOT_FOUND", "공개된 작품 또는 회차가 없습니다.");
    }
    static ReadingProgressFailure contentChanged() {
        return new ReadingProgressFailure(HttpStatus.CONFLICT, "CONTENT_CHANGED", "본문이 변경되었습니다. 위치를 다시 확인해 주세요.");
    }
    static ReadingProgressFailure conflict() {
        return new ReadingProgressFailure(HttpStatus.CONFLICT, "PROGRESS_CONFLICT", "새 저장 위치가 있습니다. 서버의 위치를 확인해 주세요.");
    }
}
