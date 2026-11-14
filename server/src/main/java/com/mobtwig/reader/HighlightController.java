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

@RestController
@RequestMapping("/api/members/highlights")
public class HighlightController {
    private final HighlightService highlights;

    HighlightController(HighlightService highlights) { this.highlights = highlights; }

    @GetMapping
    ResponseEntity<HighlightService.Page> list(Principal principal, @RequestParam(required = false) String workId,
            @RequestParam(required = false) String chapterId, @RequestParam(defaultValue = "1") String page) {
        long number = decimal(page, false);
        if (number > Integer.MAX_VALUE) throw ReadingProgressFailure.invalid();
        Long chapter = chapterId == null ? null : decimal(chapterId, true);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(highlights.list(member(principal), workId, chapter, (int) number));
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<HighlightService.Item> save(Principal principal, @RequestBody JsonNode body) {
        if (!body.isObject() || body.size() != 7) throw ReadingProgressFailure.invalid();
        var slug = body.path("workId");
        var chapter = body.path("chapterId");
        var hash = body.path("contentHash");
        var color = body.path("color");
        if (!slug.isString() || !chapter.isString() || !color.isString() || !color.asString().matches("YELLOW|GREEN")
                || !hash.isNull() && (!hash.isString() || !hash.asString().matches("[a-f0-9]{64}"))) throw ReadingProgressFailure.invalid();
        var input = new HighlightService.Input(slug.asString(), decimal(chapter.asString(), true), integer(body.path("startOffset"), 0),
                integer(body.path("endOffset"), 0), integer(body.path("contentVersion"), 1), hash.isNull() ? null : hash.asString(), color.asString());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(highlights.save(member(principal), input));
    }

    @DeleteMapping("/{id}")
    ResponseEntity<Void> delete(Principal principal, @PathVariable String id) {
        highlights.delete(member(principal), decimal(id, false));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    private static long member(Principal principal) { return Long.parseLong(principal.getName()); }

    private static int integer(JsonNode node, int min) {
        if (!node.isIntegralNumber() || !node.canConvertToInt() || node.asInt() < min) throw ReadingProgressFailure.invalid();
        return node.asInt();
    }

    private static long decimal(String text, boolean signed) {
        if (!text.matches(signed ? "-?[1-9][0-9]{0,18}" : "[1-9][0-9]{0,18}")) throw ReadingProgressFailure.invalid();
        try { return Long.parseLong(text); }
        catch (NumberFormatException failure) { throw ReadingProgressFailure.invalid(); }
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> error(ResponseStatusException failure) {
        if (failure.getStatusCode().value() == 401) return ResponseEntity.status(401).cacheControl(CacheControl.noStore()).build();
        return ResponseEntity.status(failure.getStatusCode()).cacheControl(CacheControl.noStore())
                .body(Map.of("message", failure.getReason() == null ? "하이라이트 요청을 처리하지 못했습니다." : failure.getReason()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, String>> malformed() { return error(ReadingProgressFailure.invalid()); }
}
