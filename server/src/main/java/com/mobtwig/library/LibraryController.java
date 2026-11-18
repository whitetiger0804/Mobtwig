package com.mobtwig.library;

import java.security.Principal;
import java.util.List;
import org.jspecify.annotations.NonNull;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** 기존 회원 세션으로 인증된 본인의 서재만 제공합니다. */
@RestController
public class LibraryController {
    private final LibraryService library;

    /**
     * 서재 조회 서비스를 주입받습니다.
     * @param library 서재 목록 서비스입니다.
     */
    public LibraryController(LibraryService library) { this.library = library; }

    /**
     * 분류별 서재를 캐시하지 않는 응답으로 반환합니다.
     * @param principal 서버에서 인증한 회원이며 요청으로 회원 ID를 받지 않습니다.
     * @param parameters 선택적인 kind입니다. 생략하면 all이며 중복은 허용하지 않습니다.
     * @return 회원 본인의 공개 서재 목록입니다.
     * @throws ResponseStatusException kind를 여러 번 지정하거나 지원하지 않는 값을 지정하면 발생합니다.
     */
    @GetMapping("/api/members/library")
    public ResponseEntity<List<@NonNull LibraryWorkResponse>> list(Principal principal,
            @RequestParam MultiValueMap<String, String> parameters) {
        List<String> kinds = parameters.get("kind");
        if (kinds != null && kinds.size() != 1) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "작품 분류는 한 번만 지정하십시오.");
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(library.list(Long.parseLong(principal.getName()), kinds == null ? "all" : kinds.getFirst()));
    }
}
