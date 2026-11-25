package com.mobtwig.auth;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** 회원 행 잠금 안에서 현재 비밀번호를 확인하고 모든 회원 영역 세션을 폐기합니다. */
@Service
public class MemberPasswordService {
    private static final Set<String> KEYS = Set.of("currentPassword", "newPassword", "newPasswordConfirmation");
    private final MemberPasswordRepository repository;
    private final PasswordEncoder passwords;
    public MemberPasswordService(MemberPasswordRepository repository, PasswordEncoder passwords) {
        this.repository = repository; this.passwords = passwords;
    }

    @Transactional
    public void change(Authentication authentication, Map<String, Object> input) {
        String hash = repository.lockHash(authentication.getName()).orElseThrow(MemberPasswordService::unauthorized);
        if (!(authentication.getPrincipal() instanceof CredentialPrincipal principal) || !principal.matchesVersion(hash)) {
            throw unauthorized();
        }
        Map<String, String> errors = new LinkedHashMap<>();
        if (!KEYS.containsAll(input.keySet())) errors.put("request", "비밀번호 변경에 사용할 수 없는 항목이 포함되어 있습니다.");
        for (String key : KEYS) {
            if (!(input.get(key) instanceof String)) errors.put(key, "문자열로 입력해 주세요.");
        }
        String current = text(input.get("currentPassword")), next = text(input.get("newPassword"));
        String confirmation = text(input.get("newPasswordConfirmation"));
        // 현재 비밀번호는 신규 정책으로 재검사하지 않습니다. BCrypt의 잘림/잘못된 유니코드는 거부합니다.
        if (current.isEmpty() || PasswordRules.invalidUnicode(current) || current.getBytes(StandardCharsets.UTF_8).length > 72
                || !passwords.matches(current, hash)) errors.putIfAbsent("currentPassword", "현재 비밀번호를 확인해 주세요.");
        String problem = PasswordRules.problem(next);
        if (problem != null) errors.putIfAbsent("newPassword", problem);
        else if (passwords.matches(next, hash)) errors.put("newPassword", "현재 비밀번호와 다른 비밀번호를 입력해 주세요.");
        if (confirmation.isEmpty() || !confirmation.equals(next)) {
            errors.putIfAbsent("newPasswordConfirmation", "새 비밀번호 확인을 같은 값으로 입력해 주세요.");
        }
        if (!errors.isEmpty()) throw new Invalid(errors);
        repository.replaceAndRevoke(authentication.getName(), passwords.encode(next));
    }

    private static String text(Object value) { return value instanceof String string ? string : ""; }
    private static ResponseStatusException unauthorized() { return new ResponseStatusException(HttpStatus.UNAUTHORIZED); }
    static final class Invalid extends RuntimeException {
        final Map<String, String> fields;
        Invalid(Map<String, String> fields) { super("비밀번호 변경 정보를 확인해 주세요."); this.fields = Map.copyOf(fields); }
    }
}
