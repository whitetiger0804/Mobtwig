package com.mobtwig.purchase;

import org.springframework.http.HttpStatus;
import org.jspecify.annotations.NonNull;
import org.springframework.web.server.ResponseStatusException;

/** 구매의 HTTP 상태와 클라이언트가 구분할 오류 코드를 제공합니다. */
public final class PurchaseFailure extends ResponseStatusException {
    /** 예외 직렬화 버전입니다. */
    private static final long serialVersionUID = 1L;
    /** 클라이언트가 문구와 독립적으로 구분하는 오류 코드입니다. */
    private final @NonNull String code;

    /**
     * 입력·가격·소장 권한 오류를 생성합니다.
     * @param status HTTP 오류 상태입니다.
     * @param code 문구와 독립적인 고정 오류 코드입니다.
     * @param message 민감한 원문을 제외한 안내입니다.
     */
    public PurchaseFailure(HttpStatus status, @NonNull String code, String message) {
        super(status, message);
        this.code = code;
    }

    /**
     * 클라이언트용 고정 코드를 반환합니다.
     * @return 클라이언트가 분기할 고정 코드입니다.
     */
    public @NonNull String code() { return code; }

    static PurchaseFailure invalid() {
        return new PurchaseFailure(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "상품·가격·구매 요청 식별자를 확인하십시오.");
    }

    static PurchaseFailure notFound() {
        return new PurchaseFailure(HttpStatus.NOT_FOUND, "NOT_FOUND", "요청한 작품·회차·구매 기록이 없습니다.");
    }
}
