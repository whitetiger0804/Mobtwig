package com.mobtwig.reader;

import java.security.Principal;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;

/** 회원 본인의 책갈피를 조회·저장·삭제합니다. */
@RestController
@RequestMapping("/api/members/bookmarks")
public class BookmarkController {
    private final BookmarkService bookmarks;

    BookmarkController(BookmarkService bookmarks) { this.bookmarks = bookmarks; }

    @GetMapping
    ResponseEntity<BookmarkService.Page> list(Principal principal, @RequestParam(required = false) String workId,
            @RequestParam(defaultValue = "1") String page) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(bookmarks.read(member(principal), workId, positiveInt(page)));
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<BookmarkService.Item> save(Principal principal, @RequestBody JsonNode body) {
        if (!body.isObject() || body.size() != 5) throw ReadingProgressFailure.invalid();
        var work = body.path("workId");
        var chapter = body.path("chapterId");
        var offset = body.path("offset");
        var version = body.path("contentVersion");
        var hash = body.path("contentHash");
        if (!work.isString() || !chapter.isString() || !offset.isIntegralNumber() || !offset.canConvertToInt() || offset.asInt() < 0
                || !version.isIntegralNumber() || !version.canConvertToInt() || version.asInt() < 1
                || !hash.isNull() && (!hash.isString() || !hash.asString().matches("[a-f0-9]{64}"))) throw ReadingProgressFailure.invalid();
        var input = new BookmarkService.Input(work.asString(), decimal(chapter.asString(), true), offset.asInt(),
                version.asInt(), hash.isNull() ? null : hash.asString());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(bookmarks.save(member(principal), input));
    }

    @DeleteMapping("/{id}")
    ResponseEntity<Void> delete(Principal principal, @PathVariable String id) {
        bookmarks.delete(member(principal), decimal(id, false));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    private static long member(Principal principal) { return Long.parseLong(principal.getName()); }

    private static int positiveInt(String text) {
        long number = decimal(text, false);
        if (number > Integer.MAX_VALUE) throw ReadingProgressFailure.invalid();
        return (int) number;
    }

    private static long decimal(String text, boolean signed) {
        if (!text.matches(signed ? "-?[1-9][0-9]{0,18}" : "[1-9][0-9]{0,18}")) throw ReadingProgressFailure.invalid();
        try { return Long.parseLong(text); }
        catch (NumberFormatException failure) { throw ReadingProgressFailure.invalid(); }
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> error(ResponseStatusException failure) {
        if (failure.getStatusCode().value() == 401) return ResponseEntity.status(401).cacheControl(CacheControl.noStore()).build();
        String message = failure.getReason() == null ? "책갈피 요청을 처리하지 못했습니다." : failure.getReason();
        return ResponseEntity.status(failure.getStatusCode()).cacheControl(CacheControl.noStore()).body(Map.of("message", message));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, String>> malformed() { return error(ReadingProgressFailure.invalid()); }
}
