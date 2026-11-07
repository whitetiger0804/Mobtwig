package com.mobtwig.auth;

import java.util.Map;

/** 입력 원문과 저장소 오류를 반환하지 않는 가입 실패입니다. */
final class SignupFailure extends RuntimeException {
    final int status;
    final Map<String, String> fields;

    SignupFailure(int status, String message, Map<String, String> fields) {
        super(message);
        this.status = status;
        this.fields = Map.copyOf(fields);
    }

    static SignupFailure invalid(Map<String, String> fields) {
        return new SignupFailure(400, "가입 정보를 확인해 주세요.", fields);
    }

    static SignupFailure conflict(Map<String, String> fields) {
        return new SignupFailure(409, "가입 정보를 확인해 주세요.", fields);
    }
}
