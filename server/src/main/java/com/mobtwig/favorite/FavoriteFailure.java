package com.mobtwig.favorite;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** 찜 API가 클라이언트에 알리는 오류 코드입니다. */
final class FavoriteFailure extends ResponseStatusException {
    final String code;

    FavoriteFailure(HttpStatus status, String code, String message) {
        super(status, message);
        this.code = code;
    }

    static FavoriteFailure invalid() {
        return new FavoriteFailure(HttpStatus.BAD_REQUEST, "INVALID_SLUG", "작품 식별자를 확인해 주세요.");
    }
    static FavoriteFailure notFound() {
        return new FavoriteFailure(HttpStatus.NOT_FOUND, "NOT_FOUND", "공개된 작품이 없습니다.");
    }
}
