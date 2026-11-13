package com.mobtwig.auth;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import jakarta.validation.Validator;
import jakarta.validation.constraints.Email;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 현재 문서에 대한 동의를 확인하고 회원 가입 데이터를 원자적으로 저장합니다. */
@Service
public class MemberSignupService {
    private static final Set<String> INPUT_KEYS = Set.of("email", "nickname", "password", "passwordConfirmation", "consents");
    private static final Set<String> CONSENT_KEYS = Set.of("kind", "version", "contentHash", "agreed");
    private static final Pattern EDGE_SPACE = Pattern.compile("^[\\p{Z}\\s\\uFEFF]+|[\\p{Z}\\s\\uFEFF]+$");
    private static final Pattern LATIN_LETTER = Pattern.compile("[A-Za-z]");
    private static final Pattern DIGIT = Pattern.compile("[0-9]");
    private final SignupPolicies policies;
    private final MemberSignupRepository repository;
    private final PasswordEncoder passwords;
    private final Validator validator;

    public MemberSignupService(SignupPolicies policies, MemberSignupRepository repository, PasswordEncoder passwords,
            Validator validator) {
        this.policies = policies;
        this.repository = repository;
        this.passwords = passwords;
        this.validator = validator;
    }

    @Transactional
    public Created register(Map<String, Object> input, boolean signedIn) {
        var documents = policies.current();
        if (signedIn) {
            throw SignupFailure.conflict(Map.of("request", "로그아웃한 뒤 다시 가입해 주세요."));
        }
        Map<String, String> errors = new LinkedHashMap<>();
        if (!INPUT_KEYS.containsAll(input.keySet())) {
            errors.put("request", "가입에 사용할 수 없는 항목이 포함되어 있습니다.");
        }
        String email = trim(text(input.get("email"))).toLowerCase(Locale.ROOT);
        String nickname = trim(text(input.get("nickname")));
        String password = text(input.get("password"));
        String confirmation = text(input.get("passwordConfirmation"));
        validateAccount(email, nickname, password, confirmation, errors);
        Map<String, String> staleDocuments = checkConsents(input.get("consents"), documents, errors);
        if (!errors.isEmpty()) throw SignupFailure.invalid(errors);
        if (!staleDocuments.isEmpty()) throw SignupFailure.conflict(staleDocuments);
        var duplicates = repository.duplicates(email, nickname);
        if (!duplicates.isEmpty()) throw SignupFailure.conflict(duplicates);

        long id = repository.insertMember(email, nickname, passwords.encode(password));
        repository.insertReadingSettings(id);
        repository.insertConsents(id, documents, Instant.now());
        return new Created(Long.toString(id), email, nickname);
    }

    private void validateAccount(String email, String nickname, String password, String confirmation, Map<String, String> errors) {
        int at = email.lastIndexOf('@');
        if (at <= 0 || !email.substring(at + 1).contains(".") || email.length() > 255 || invalidDisplayText(email)
                || email.codePoints().anyMatch(c -> Character.isWhitespace(c) || Character.isSpaceChar(c))
                || !validator.validate(new EmailAddress(email)).isEmpty()) {
            errors.put("email", "올바른 이메일을 입력해 주세요.");
        }
        if (nickname.isEmpty() || nickname.length() > 30 || invalidDisplayText(nickname)) {
            errors.put("nickname", "닉네임을 1~30자로 입력해 주세요.");
        }
        if (password.codePointCount(0, password.length()) < 8 || !LATIN_LETTER.matcher(password).find()
                || !DIGIT.matcher(password).find() || hasUnpairedSurrogate(password)) {
            errors.put("password", "영문과 숫자를 포함한 비밀번호를 8자 이상 입력해 주세요.");
        } else if (password.getBytes(StandardCharsets.UTF_8).length > 72) {
            errors.put("password", "비밀번호는 UTF-8 기준 72바이트까지 입력할 수 있습니다.");
        }
        if (confirmation.isEmpty() || !confirmation.equals(password)) {
            errors.put("passwordConfirmation", "비밀번호 확인을 같은 값으로 입력해 주세요.");
        }
    }

    private static Map<String, String> checkConsents(Object input, List<SignupPolicies.Document> documents, Map<String, String> errors) {
        Map<String, Map<?, ?>> byKind = new HashMap<>();
        if (input instanceof List<?> consents && consents.size() <= documents.size()) {
            for (Object item : consents) {
                if (!(item instanceof Map<?, ?> consent) || !CONSENT_KEYS.containsAll(consent.keySet())) {
                    errors.put("request", "약관 동의 항목을 확인해 주세요.");
                    continue;
                }
                String kind = text(consent.get("kind"));
                if ((!kind.equals("TERMS") && !kind.equals("PRIVACY")) || byKind.putIfAbsent(kind, consent) != null) {
                    errors.put("request", "필수 약관 두 종류에 각각 한 번 동의해 주세요.");
                }
            }
        }
        Map<String, String> stale = new LinkedHashMap<>();
        for (var document : documents) {
            var consent = byKind.get(document.kind());
            if (consent == null || !Boolean.TRUE.equals(consent.get("agreed"))) {
                errors.put(document.errorField(), "필수 문서를 확인하고 동의해 주세요.");
                continue;
            }
            String version = text(consent.get("version"));
            String hash = text(consent.get("contentHash"));
            if (version.isEmpty() || version.length() > 80 || !hash.matches("[0-9a-f]{64}")) {
                errors.put(document.errorField(), "문서 정보를 다시 불러온 뒤 동의해 주세요.");
            } else if (!document.version().equals(version) || !document.contentHash().equals(hash)) {
                stale.put(document.errorField(), "문서가 변경되었습니다. 최신 내용을 확인하고 다시 동의해 주세요.");
            }
        }
        return stale;
    }

    private static String text(Object value) { return value instanceof String string ? string : ""; }
    private static String trim(String value) { return EDGE_SPACE.matcher(value).replaceAll(""); }
    private static boolean invalidDisplayText(String value) {
        return hasUnpairedSurrogate(value) || value.codePoints().anyMatch(Character::isISOControl);
    }
    private static boolean hasUnpairedSurrogate(String value) {
        return value.codePoints().anyMatch(c -> c >= Character.MIN_SURROGATE && c <= Character.MAX_SURROGATE);
    }

    private record EmailAddress(@Email String email) { }

    /** 가입한 회원의 공개 표시 정보입니다. */
    public record Created(String id, String email, String nickname) { }
}
