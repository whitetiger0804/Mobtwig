package com.mobtwig.admin;

import java.nio.charset.StandardCharsets;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.Locale;

import jakarta.validation.Validator;
import org.jspecify.annotations.NonNull;
import org.jspecify.annotations.Nullable;
import org.springframework.dao.support.DataAccessUtils;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 기존 회원 테이블의 계정 인증과 허용된 관리자 계정 생성을 담당합니다. */
@Service
public class AdminAccounts implements UserDetailsService {
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwords;
    private final Validator validator;

    /**
     * 계정 저장소와 비밀번호 검증기를 주입받습니다.
     * @param jdbc 공용 DB 접근기입니다.
     * @param passwords BCrypt 비밀번호 처리기입니다.
     * @param validator 입력 제약 검사기입니다.
     */
    public AdminAccounts(JdbcTemplate jdbc, PasswordEncoder passwords, Validator validator) {
        this.jdbc = jdbc;
        this.passwords = passwords;
        this.validator = validator;
    }

    /**
     * 이메일로 로그인하고 세션에는 짧은 회원 ID를 주체 이름으로 저장합니다.
     * @param email 입력한 로그인 이메일입니다.
     * @return 비밀번호 해시와 현재 회원 상태를 갖춘 인증 정보입니다.
     * @throws UsernameNotFoundException 일치하는 계정이 없으면 발생합니다.
     */
    @Override
    public @NonNull UserDetails loadUserByUsername(@NonNull String email) {
        var users = jdbc.<@NonNull UserDetails>query("SELECT id,password_hash,role,status FROM member WHERE email=?",
                (rs, row) -> User.withUsername("" + rs.getLong("id"))
                        .password(rs.getString("password_hash")).roles(rs.getString("role"))
                        .disabled(!"ACTIVE".equals(rs.getString("status"))).build(),
                email.strip().toLowerCase(Locale.ROOT));
        if (users.isEmpty()) {
            throw new UsernameNotFoundException("로그인 정보를 확인하십시오.");
        }
        return DataAccessUtils.requiredSingleResult(users);
    }

    /**
     * 기존 세션에서도 현재 DB의 관리자 권한과 활성 상태를 다시 검사합니다.
     * @param id 인증된 회원 ID입니다.
     * @return 현재 활성 관리자일 때만 참입니다.
     */
    public boolean isAdmin(String id) {
        return !jdbc.queryForList("SELECT id FROM member WHERE id=? AND role='ADMIN' AND status='ACTIVE'",
                Long.class, id).isEmpty();
    }

    /**
     * 로그인한 관리자의 표시 정보를 반환합니다.
     * @param id 인증된 회원 ID입니다.
     * @return 해시를 포함하지 않는 계정 정보입니다.
     */
    public Session session(String id) {
        return jdbc.query("SELECT id,email,nickname FROM member WHERE id=?",
                (rs, row) -> new Session(rs.getLong("id"), rs.getString("email"), rs.getString("nickname")),
                id).getFirst();
    }

    /**
     * 다른 허용 팀원에게 관리자 계정을 발급합니다.
     * @param input 이메일·닉네임·최초 비밀번호입니다.
     * @return 생성한 회원 ID입니다.
     */
    @Transactional
    public long create(AdminRequests.Account input) {
        if (!validator.validate(input).isEmpty()) {
            throw AdminRules.bad("이메일·닉네임과 12자 이상 비밀번호를 확인하십시오.");
        }
        String email = AdminRules.text(input.email(), "이메일", 255).strip().toLowerCase(Locale.ROOT);
        String domain = email.substring(email.lastIndexOf('@') + 1);
        if (!domain.contains(".") || input.password().getBytes(StandardCharsets.UTF_8).length > 72) {
            throw AdminRules.bad("이메일 도메인에는 점이 있어야 하며 비밀번호는 UTF-8 기준 72바이트 이하여야 합니다.");
        }
        String nickname = AdminRules.text(input.nickname(), "닉네임", 30);
        GeneratedKeyHolder key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement statement = connection.prepareStatement(
                    "INSERT INTO member(email,password_hash,nickname,role,status) VALUES (?,?,?,'ADMIN','ACTIVE')",
                    Statement.RETURN_GENERATED_KEYS);
            statement.setString(1, email);
            statement.setString(2, passwords.encode(input.password()));
            statement.setString(3, nickname);
            return statement;
        }, key);
        Number id = key.getKey();
        if (id == null) {
            throw new IllegalStateException("관리자 계정의 식별자를 받지 못했습니다.");
        }
        jdbc.update("INSERT INTO member_reading_setting(member_id) VALUES (?)", id.longValue());
        return id.longValue();
    }

    /**
     * 최초 관리자 생성 여부를 확인합니다.
     * @return 활성 관리자 계정이 이미 있으면 참입니다.
     */
    public boolean hasAdmin() {
        return !jdbc.queryForList("SELECT id FROM member WHERE role='ADMIN' AND status='ACTIVE' LIMIT 1",
                Long.class).isEmpty();
    }

    /**
     * 비밀번호를 포함하지 않는 로그인 상태입니다.
     * @param id 회원 ID입니다.
     * @param email 로그인 이메일입니다.
     * @param nickname 표시 이름입니다.
     */
    public record Session(long id, String email, @Nullable String nickname) { }
}
