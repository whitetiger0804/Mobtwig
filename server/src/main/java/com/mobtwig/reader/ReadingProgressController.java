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

/** 인증된 회원의 작품별 읽기 위치입니다. */
@RestController
@RequestMapping("/api/members/works/{slug}/reading-progress")
public class ReadingProgressController {
    private final ReadingProgressService progress;

    public ReadingProgressController(ReadingProgressService progress) { this.progress = progress; }

    @GetMapping
    public ResponseEntity<ReadingProgressResponse> get(@PathVariable String slug, Principal principal) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(progress.read(Long.parseLong(principal.getName()), slug));
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ReadingProgressResponse> save(@PathVariable String slug, @RequestBody JsonNode body, Principal principal) {
        if (!body.isObject() || body.size() != (body.has("contentHash") ? 5 : 4)) throw ReadingProgressFailure.invalid();
        var offset = body.path("offset");
        var version = body.path("contentVersion");
        var hash = body.path("contentHash");
        var revision = body.path("expectedRevision");
        if (!offset.isIntegralNumber() || !offset.canConvertToInt() || offset.asInt() < 0
                || !version.isIntegralNumber() || !version.canConvertToInt() || version.asInt() < 1
                || !hash.isMissingNode() && !hash.isNull() && (!hash.isString() || !hash.asString().matches("[0-9a-f]{64}"))) {
            throw ReadingProgressFailure.invalid();
        }
        var input = new ReadingProgressService.Input(decimal(body.path("chapterId"), true), offset.asInt(), version.asInt(),
                hash.isString() ? hash.asString() : null, revision.isNull() ? null : decimal(revision, false));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(progress.save(Long.parseLong(principal.getName()), slug, input));
    }

    private static long decimal(JsonNode value, boolean signed) {
        if (!value.isString() || !value.asString().matches(signed ? "-?[1-9][0-9]{0,18}" : "[1-9][0-9]{0,18}")) {
            throw ReadingProgressFailure.invalid();
        }
        try { return Long.parseLong(value.asString()); }
        catch (NumberFormatException failure) { throw ReadingProgressFailure.invalid(); }
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> error(ResponseStatusException failure) {
        if (failure.getStatusCode().value() == 401) return ResponseEntity.status(401).cacheControl(CacheControl.noStore()).build();
        String code = failure instanceof ReadingProgressFailure expected ? expected.code : "BODY_UNAVAILABLE";
        String message = failure.getReason() == null ? "읽기 위치를 처리하지 못했습니다." : failure.getReason();
        return ResponseEntity.status(failure.getStatusCode()).cacheControl(CacheControl.noStore()).body(Map.of("code", code, "message", message));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, String>> malformed() { return error(ReadingProgressFailure.invalid()); }
}
