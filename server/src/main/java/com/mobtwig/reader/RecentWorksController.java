package com.mobtwig.reader;

import java.security.Principal;
import java.util.List;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** 인증된 회원의 최근 본 작품입니다. */
@RestController
@RequestMapping("/api/members/recent-works")
public class RecentWorksController {
    private final RecentWorksService recent;

    public RecentWorksController(RecentWorksService recent) { this.recent = recent; }

    @GetMapping
    public ResponseEntity<List<RecentWorkResponse>> list(Principal principal) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(recent.list(Long.parseLong(principal.getName())));
    }

    @PostMapping("/{slug}")
    public ResponseEntity<Void> view(@PathVariable String slug, Principal principal) {
        recent.view(Long.parseLong(principal.getName()), slug);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> error(ResponseStatusException failure) {
        if (failure.getStatusCode().value() == 401) return ResponseEntity.status(401).cacheControl(CacheControl.noStore()).build();
        String code = failure instanceof RecentWorkFailure expected ? expected.code : "UNAVAILABLE";
        String message = failure.getReason() == null ? "최근 본 작품을 처리하지 못했습니다." : failure.getReason();
        return ResponseEntity.status(failure.getStatusCode()).cacheControl(CacheControl.noStore()).body(Map.of("code", code, "message", message));
    }
}
