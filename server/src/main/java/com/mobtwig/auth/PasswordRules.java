package com.mobtwig.auth;

import java.nio.charset.StandardCharsets;

/** 가입과 비밀번호 변경이 공유하는 가공 없는 비밀번호 정책입니다. */
final class PasswordRules {
    private PasswordRules() { }

    static String problem(String password) {
        if (password.codePointCount(0, password.length()) < 8 || !password.matches("(?s).*[A-Za-z].*")
                || !password.matches("(?s).*[0-9].*") || invalidUnicode(password)) {
            return "영문과 숫자를 포함한 비밀번호를 8자 이상 입력해 주세요.";
        }
        return password.getBytes(StandardCharsets.UTF_8).length > 72
                ? "비밀번호는 UTF-8 기준 72바이트까지 입력할 수 있습니다." : null;
    }

    static boolean invalidUnicode(String value) {
        return value.codePoints().anyMatch(c -> c >= Character.MIN_SURROGATE && c <= Character.MAX_SURROGATE);
    }
}
