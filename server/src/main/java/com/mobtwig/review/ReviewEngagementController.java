package com.mobtwig.review;

import java.math.BigInteger;
import java.security.Principal;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;

/** 회원의 리뷰·댓글 공감과 신고를 접수합니다. */
@RestController
class ReviewEngagementController {
    private static final Set<String> REASONS = Set.of("SPAM", "ABUSE", "INAPPROPRIATE", "SPOILER", "OTHER");
    private static final String SPACE = "[\\p{IsWhite_Space}\\uFEFF]";
    private static final Pattern EDGES = Pattern.compile("^" + SPACE + "++|(?<!" + SPACE + ")" + SPACE + "++$");
    private final ReviewEngagementService engagement;

    ReviewEngagementController(ReviewEngagementService engagement) { this.engagement = engagement; }

    /** 리뷰 공감을 멱등하게 등록합니다. */
    @PutMapping("/api/members/reviews/{reviewId}/like")
    ResponseEntity<ReviewEngagementService.LikeState> likeReview(@PathVariable String reviewId, Principal principal) {
        return like(reviewId, principal, false, true);
    }

    /** 리뷰 공감을 멱등하게 해제합니다. */
    @DeleteMapping("/api/members/reviews/{reviewId}/like")
    ResponseEntity<ReviewEngagementService.LikeState> unlikeReview(@PathVariable String reviewId, Principal principal) {
        return like(reviewId, principal, false, false);
    }

    /** 댓글 공감을 멱등하게 등록합니다. */
    @PutMapping("/api/members/review-comments/{commentId}/like")
    ResponseEntity<ReviewEngagementService.LikeState> likeComment(@PathVariable String commentId, Principal principal) {
        return like(commentId, principal, true, true);
    }

    /** 댓글 공감을 멱등하게 해제합니다. */
    @DeleteMapping("/api/members/review-comments/{commentId}/like")
    ResponseEntity<ReviewEngagementService.LikeState> unlikeComment(@PathVariable String commentId, Principal principal) {
        return like(commentId, principal, true, false);
    }

    /** 리뷰 신고를 회원별 한 번 접수합니다. */
    @PostMapping(path = "/api/members/reviews/{reviewId}/reports", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<ReviewEngagementService.Report> reportReview(@PathVariable String reviewId, Principal principal,
            @RequestBody JsonNode input) {
        return report(reviewId, principal, input, false);
    }

    /** 댓글 신고를 회원별 한 번 접수합니다. */
    @PostMapping(path = "/api/members/review-comments/{commentId}/reports", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<ReviewEngagementService.Report> reportComment(@PathVariable String commentId, Principal principal,
            @RequestBody JsonNode input) {
        return report(commentId, principal, input, true);
    }

    private ResponseEntity<ReviewEngagementService.LikeState> like(String target, Principal principal,
            boolean comment, boolean liked) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(
                engagement.like(id(target), Long.parseLong(principal.getName()), comment, liked));
    }

    private ResponseEntity<ReviewEngagementService.Report> report(String target, Principal principal,
            JsonNode input, boolean comment) {
        if (!input.isObject() || input.size() != (input.has("detail") ? 2 : 1)
                || !input.path("reason").isString() || !REASONS.contains(input.path("reason").asString())) throw invalid();
        var detail = input.path("detail");
        if (!detail.isMissingNode() && !detail.isNull() && !detail.isString()) throw invalid();
        String text = detail.isString() ? EDGES.matcher(detail.asString()).replaceAll("") : "";
        if (text.codePointCount(0, text.length()) > 500) throw invalid();
        var result = engagement.report(id(target), Long.parseLong(principal.getName()), comment,
                input.path("reason").asString(), text.isEmpty() ? null : text);
        return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .cacheControl(CacheControl.noStore()).body(result.report());
    }

    private static long id(String value) {
        if (!value.matches("-?[1-9][0-9]{0,18}")) throw invalid();
        var number = new BigInteger(value);
        if (number.compareTo(BigInteger.valueOf(Long.MIN_VALUE)) < 0
                || number.compareTo(BigInteger.valueOf(Long.MAX_VALUE)) > 0) throw invalid();
        return number.longValue();
    }

    private static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "리뷰 요청 값이 올바르지 않습니다.");
    }

    /** 기존 리뷰 API와 같은 메시지 형식으로 요청 오류를 반환합니다. */
    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> rejected(ResponseStatusException failure) {
        return ResponseEntity.status(failure.getStatusCode()).cacheControl(CacheControl.noStore())
                .body(Map.of("message", java.util.Objects.requireNonNull(failure.getReason())));
    }

    /** 잘못된 JSON을 요청 오류로 반환합니다. */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, String>> malformed() { return rejected(invalid()); }
}
