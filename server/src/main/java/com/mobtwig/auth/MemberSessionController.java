package com.mobtwig.auth;

import java.security.Principal;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** 현재 인증 주체의 회원 정보만 반환합니다. */
@RestController
public class MemberSessionController {
    private final MemberSessions sessions;
    public MemberSessionController(MemberSessions sessions) { this.sessions = sessions; }

    @GetMapping("/api/auth/session")
    public ResponseEntity<MemberSessions.Identity> session(Principal principal) {
        return sessions.current(principal.getName())
                .map(member -> ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(member))
                .orElseGet(() -> ResponseEntity.status(401).cacheControl(CacheControl.noStore()).build());
    }
}
