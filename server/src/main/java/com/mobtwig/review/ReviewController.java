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

/** 공개·회원 리뷰 조회와 본인 리뷰·댓글의 작성, 수정, 삭제를 제공합니다. */
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
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(reviews.list(slug, null, page, size));
    }

    /** 페이지와 무관한 본인 리뷰 및 회원별 공감·신고 상태를 함께 조회합니다. */
    @GetMapping("/api/members/works/{slug}/reviews")
    ResponseEntity<ReviewService.Page> memberList(@PathVariable String slug, Principal principal,
            @RequestParam MultiValueMap<String, String> parameters) {
        int page = positive(parameters.get("page"), 1, Integer.MAX_VALUE);
        int size = positive(parameters.get("size"), 20, 50);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(reviews.list(slug, member(principal), page, size));
    }

    @PostMapping(path = "/api/members/works/{slug}/reviews", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<ReviewService.Item> create(@PathVariable String slug, Principal principal, @RequestBody JsonNode input) {
        var draft = draft(input);
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore())
                .body(reviews.create(slug, member(principal), draft.rating(), draft.body()));
    }

    /** 본인의 활성 리뷰만 수정합니다. */
    @PutMapping(path = "/api/members/reviews/{reviewId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<ReviewService.Item> update(@PathVariable String reviewId, Principal principal, @RequestBody JsonNode input) {
        var draft = draft(input);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(reviews.update(identifier(reviewId), member(principal), draft.rating(), draft.body()));
    }

    /** 본인 리뷰를 삭제하고 남은 댓글의 스레드는 보존합니다. */
    @DeleteMapping("/api/members/reviews/{reviewId}")
    ResponseEntity<Void> delete(@PathVariable String reviewId, Principal principal) {
        reviews.delete(identifier(reviewId), member(principal));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    /** 삭제된 리뷰의 원문을 숨긴 상태로 공개 댓글 스레드를 조회합니다. */
    @CrossOrigin(origins = "*")
    @GetMapping("/reviews/{reviewId}/comments")
    ResponseEntity<ReviewService.Thread> comments(@PathVariable String reviewId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(reviews.thread(identifier(reviewId), null));
    }

    /** 댓글 스레드와 회원별 공감·신고 상태를 조회합니다. */
    @GetMapping("/api/members/reviews/{reviewId}/comments")
    ResponseEntity<ReviewService.Thread> memberComments(@PathVariable String reviewId, Principal principal) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(reviews.thread(identifier(reviewId), member(principal)));
    }

    /** 삭제되지 않은 공개 리뷰에 댓글을 작성합니다. */
    @PostMapping(path = "/api/members/reviews/{reviewId}/comments", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<ReviewService.Comment> createComment(@PathVariable String reviewId, Principal principal, @RequestBody JsonNode input) {
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore())
                .body(reviews.createComment(identifier(reviewId), member(principal), commentBody(input)));
    }

    /** 부모 리뷰 삭제 여부와 관계없이 공개 작품의 본인 댓글을 수정합니다. */
    @PutMapping(path = "/api/members/review-comments/{commentId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<ReviewService.Comment> updateComment(@PathVariable String commentId, Principal principal, @RequestBody JsonNode input) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(reviews.updateComment(identifier(commentId), member(principal), commentBody(input)));
    }

    /** 공개 작품의 본인 댓글을 실제 삭제합니다. */
    @DeleteMapping("/api/members/review-comments/{commentId}")
    ResponseEntity<Void> deleteComment(@PathVariable String commentId, Principal principal) {
        reviews.deleteComment(identifier(commentId), member(principal));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    private record Draft(int rating, String body) {}

    private static Draft draft(JsonNode input) {
        if (!input.isObject() || input.size() != (input.has("body") ? 2 : 1)) throw invalid();
        var rating = input.path("rating");
        var body = input.path("body");
        if (!rating.isIntegralNumber() || !rating.canConvertToInt() || rating.asInt() < 1 || rating.asInt() > 5
                || !body.isMissingNode() && !body.isNull() && !body.isString()) throw invalid();
        String content = body.isString() ? BODY_EDGES.matcher(body.asString()).replaceAll("") : "";
        if (content.codePointCount(0, content.length()) > 1000) throw invalid();
        return new Draft(rating.asInt(), content.isEmpty() ? null : content);
    }

    private static String commentBody(JsonNode input) {
        if (!input.isObject() || input.size() != 1 || !input.path("body").isString()) throw invalid();
        String content = BODY_EDGES.matcher(input.get("body").asString()).replaceAll("");
        if (content.isEmpty() || content.codePointCount(0, content.length()) > 500) throw invalid();
        return content;
    }

    private static long member(Principal principal) { return Long.parseLong(principal.getName()); }

    private static long identifier(String value) {
        if (!value.matches("-?[1-9][0-9]{0,18}")) throw invalid();
        try { return Long.parseLong(value); }
        catch (NumberFormatException failure) { throw invalid(); }
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
