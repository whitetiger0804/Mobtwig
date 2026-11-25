package com.mobtwig.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.springframework.security.core.userdetails.User;

/** 비밀번호 원문이나 해시 대신 로그인에 사용한 자격 정보의 버전을 세션에 남깁니다. */
public final class CredentialPrincipal extends User {
    private static final long serialVersionUID = 1L;
    private final String credentialVersion;

    public CredentialPrincipal(String id, String hash, String role, boolean active) {
        super(id, hash, active, true, true, true, User.withUsername(id).password(hash).roles(role).build().getAuthorities());
        credentialVersion = version(hash);
    }

    /** BCrypt 해시가 바뀌면 과거 요청이 세션을 다시 저장해도 인증에 사용할 수 없습니다. */
    public boolean matchesVersion(String hash) { return credentialVersion.equals(version(hash)); }

    private static String version(String hash) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(hash.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
