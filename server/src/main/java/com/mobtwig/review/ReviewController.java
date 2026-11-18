package com.mobtwig.review;

import java.security.Principal;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;

/** 공개 리뷰 조회와 회원 본인의 리뷰 등록을 제공합니다. */
@RestController
class ReviewController {
    private static final String BODY_SPACE = "[\\p{IsWhite_Space}\\uFEFF]";
    // 긴 내부 공백을 만났을 때 같은 공백 구간을 반복 검색하지 않는다.
    private static final Pattern BODY_EDGES = Pattern.compile("^" + BODY_SPACE + "++|(?<!" + BODY_SPACE + ")" + BODY_SPACE + "++$");
    private final ReviewService reviews;

    ReviewController(ReviewService reviews) { this.reviews = reviews; }

    @CrossOrigin(origins = "*")
    @GetMapping("/works/{slug}/reviews")
    ResponseEntity<ReviewService.Page> list(@PathVariable String slug,
            @RequestParam MultiValueMap<String, String> parameters) {
        int page = positive(parameters.get("page"), 1, Integer.MAX_VALUE);
        int size = positive(parameters.get("size"), 20, 50);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(reviews.list(slug, page, size));
    }

    @PostMapping(path = "/api/members/works/{slug}/reviews", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<ReviewService.Item> create(@PathVariable String slug, Principal principal, @RequestBody JsonNode input) {
        if (!input.isObject() || input.size() != (input.has("body") ? 2 : 1)) throw invalid();
        var rating = input.path("rating");
        var body = input.path("body");
        if (!rating.isIntegralNumber() || !rating.canConvertToInt() || rating.asInt() < 1 || rating.asInt() > 5
                || !body.isMissingNode() && !body.isNull() && !body.isString()) throw invalid();
        String content = body.isString() ? BODY_EDGES.matcher(body.asString()).replaceAll("") : "";
        if (content.codePointCount(0, content.length()) > 1000) throw invalid();
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore())
                .body(reviews.create(slug, Long.parseLong(principal.getName()), rating.asInt(),
                        content.isEmpty() ? null : content));
    }

    private static int positive(List<String> values, int defaultValue, int max) {
        if (values == null) return defaultValue;
        if (values.size() != 1 || !values.getFirst().matches("[0-9]{1,10}")) throw invalid();
        long number = Long.parseLong(values.getFirst());
        if (number < 1 || number > max) throw invalid();
        return (int) number;
    }

    private static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "리뷰 요청 값이 올바르지 않습니다.");
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> rejected(ResponseStatusException failure) {
        return ResponseEntity.status(failure.getStatusCode()).cacheControl(CacheControl.noStore())
                .body(Map.of("message", java.util.Objects.requireNonNull(failure.getReason())));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, String>> malformed() { return rejected(invalid()); }
}
