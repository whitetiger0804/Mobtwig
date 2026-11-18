package com.mobtwig.favorite;

import java.security.Principal;
import java.util.List;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** 인증된 회원의 찜(wishlist)입니다. 회원 ID는 요청으로 받지 않습니다. */
@RestController
@RequestMapping("/api/members/favorites")
public class FavoriteController {
    private final FavoriteService favorites;

    public FavoriteController(FavoriteService favorites) { this.favorites = favorites; }

    @GetMapping
    public ResponseEntity<List<FavoriteWorkResponse>> list(Principal principal) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(favorites.list(member(principal)));
    }

    @GetMapping("/{slug}")
    public ResponseEntity<FavoriteStatusResponse> status(@PathVariable String slug, Principal principal) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(favorites.status(member(principal), slug));
    }

    @PostMapping("/{slug}")
    public ResponseEntity<Void> add(@PathVariable String slug, Principal principal) {
        favorites.add(member(principal), slug);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @DeleteMapping("/{slug}")
    public ResponseEntity<Void> remove(@PathVariable String slug, Principal principal) {
        favorites.remove(member(principal), slug);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    private static long member(Principal principal) { return Long.parseLong(principal.getName()); }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> error(ResponseStatusException failure) {
        if (failure.getStatusCode().value() == 401) return ResponseEntity.status(401).cacheControl(CacheControl.noStore()).build();
        String code = failure instanceof FavoriteFailure expected ? expected.code : "UNAVAILABLE";
        String message = failure.getReason() == null ? "찜을 처리하지 못했습니다." : failure.getReason();
        return ResponseEntity.status(failure.getStatusCode()).cacheControl(CacheControl.noStore()).body(Map.of("code", code, "message", message));
    }
}
