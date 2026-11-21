package com.mobtwig.library;

import java.security.Principal;
import java.util.Map;

import com.mobtwig.library.WorkFollowRepository.Kind;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/members")
public class WorkFollowController {
    private final WorkFollowService follows;

    WorkFollowController(WorkFollowService follows) {
        this.follows = follows;
    }

    @GetMapping("/works/{slug}/state")
    ResponseEntity<WorkFollowService.State> state(Principal principal, @PathVariable String slug) {
        return response(follows.state(member(principal), slug));
    }

    @PutMapping("/works/{slug}/favorite")
    ResponseEntity<WorkFollowService.State> addFavorite(Principal principal, @PathVariable String slug) {
        return response(follows.change(member(principal), slug, Kind.FAVORITE, true));
    }

    @DeleteMapping("/works/{slug}/favorite")
    ResponseEntity<WorkFollowService.State> removeFavorite(Principal principal, @PathVariable String slug) {
        return response(follows.change(member(principal), slug, Kind.FAVORITE, false));
    }

    @PutMapping("/works/{slug}/subscription")
    ResponseEntity<WorkFollowService.State> subscribe(Principal principal, @PathVariable String slug) {
        return response(follows.change(member(principal), slug, Kind.SUBSCRIPTION, true));
    }

    @DeleteMapping("/works/{slug}/subscription")
    ResponseEntity<WorkFollowService.State> unsubscribe(Principal principal, @PathVariable String slug) {
        return response(follows.change(member(principal), slug, Kind.SUBSCRIPTION, false));
    }

    @GetMapping("/favorites")
    ResponseEntity<WorkFollowService.Favorites> favorites(Principal principal,
            @RequestParam MultiValueMap<String, String> parameters) {
        return response(follows.favorites(member(principal), number(parameters, "page", 1, Integer.MAX_VALUE),
                number(parameters, "size", 20, 50)));
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> failure(ResponseStatusException exception) {
        return ResponseEntity.status(exception.getStatusCode()).cacheControl(CacheControl.noStore())
                .body(Map.of("message", exception.getReason()));
    }

    private static int number(MultiValueMap<String, String> parameters, String field, int fallback, int max) {
        var values = parameters.get(field);
        if (values == null) return fallback;
        if (values.size() == 1 && values.getFirst().matches("[1-9][0-9]{0,9}")) {
            long parsed = Long.parseLong(values.getFirst());
            if (parsed <= max) return (int) parsed;
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field + " 값을 확인해 주세요.");
    }

    private static long member(Principal principal) {
        return Long.parseLong(principal.getName());
    }

    private static <T> ResponseEntity<T> response(T value) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value);
    }
}
