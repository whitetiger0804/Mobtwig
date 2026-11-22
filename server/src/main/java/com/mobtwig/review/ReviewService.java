package com.mobtwig.review;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import com.mobtwig.auth.MemberSessions;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** 공개 리뷰·댓글을 일관되게 읽고 회원·작품 잠금 안에서 변경과 평점 집계를 처리합니다. */
@Service
class ReviewService {
    public record Item(String id, Integer rating, String body, String nickname, Instant createdAt,
                long commentCount, long likeCount, boolean mine, boolean liked, boolean reported, boolean deleted) {}
    public record Comment(String id, String body, String nickname, Instant createdAt,
                   long likeCount, boolean mine, boolean liked, boolean reported) {}
    public record Thread(Item review, List<Comment> items) {}
    public record Page(BigDecimal averageRating, long reviewCount, Map<String, Long> ratingDistribution,
                List<Item> items, boolean hasNext, long totalItems, Item myReview) {}
    record Summary(BigDecimal average, long count, Map<String, Long> distribution) {}

    private final ReviewRepository reviews;
    private final MemberSessions members;

    ReviewService(ReviewRepository reviews, MemberSessions members) { this.reviews = reviews; this.members = members; }

    /** 요약·표시 항목 수·본인 리뷰를 동일한 데이터베이스 스냅샷에서 조회합니다. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Page list(String slug, Long viewer, int page, int size) {
        long book = book(slug, false);
        var summary = summarize(reviews.counts(book));
        long offset = (long) (page - 1) * size;
        long total = reviews.displayCount(book);
        var items = reviews.page(book, viewer, size, offset);
        return new Page(summary.average(), summary.count(), summary.distribution(), items,
                offset + items.size() < total, total, viewer == null ? null : reviews.mine(book, viewer).orElse(null));
    }

    /** 작품별로 등록을 직렬화하고 회원의 활성 리뷰 중복을 차단합니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Item create(String slug, long member, int rating, String body) {
        // 회원·작품 순서로 잠가 같은 작품의 등록과 집계를 직렬화합니다.
        members.lockActiveMember(member);
        long book = book(slug, true);
        long id;
        try {
            id = reviews.insert(book, member, rating, body);
        } catch (DuplicateKeyException duplicate) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 이 작품에 리뷰를 등록했습니다.");
        }
        reviews.updateSummary(book, summarize(reviews.counts(book)));
        return reviews.item(book, id, member).orElseThrow(ReviewService::notFound);
    }

    /** 작품 잠금으로 평점 수정과 캐시 재집계를 같은 순서로 처리합니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Item update(long review, long member, int rating, String body) {
        long book = lockReviewBook(review, member);
        if (!reviews.ownsActiveReview(book, review, member)) throw notFound();
        reviews.update(review, rating, body);
        reviews.updateSummary(book, summarize(reviews.counts(book)));
        return reviews.item(book, review, member).orElseThrow(ReviewService::notFound);
    }

    /** 리뷰만 삭제 처리하여 남은 댓글과 재작성 가능한 활성 키를 보존합니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void delete(long review, long member) {
        long book = lockReviewBook(review, member);
        if (!reviews.ownsActiveReview(book, review, member)) throw notFound();
        reviews.delete(review);
        reviews.updateSummary(book, summarize(reviews.counts(book)));
    }

    /** 알려진 삭제 리뷰도 원문 없는 자리표시와 기존 댓글로 조회합니다. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Thread thread(long review, Long viewer) {
        long book = reviews.publishedReviewBookId(review).orElseThrow(ReviewService::notFound);
        return new Thread(reviews.item(book, review, viewer).orElseThrow(ReviewService::notFound), reviews.comments(review, viewer));
    }

    /** 리뷰 삭제와 경합하지 않도록 작품 잠금 후 활성 부모를 확인합니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Comment createComment(long review, long member, String body) {
        long book = lockReviewBook(review, member);
        if (!reviews.activeReview(book, review)) throw notFound();
        long id = reviews.insertComment(review, member, body);
        return reviews.comment(id, member).orElseThrow(ReviewService::notFound);
    }

    /** 부모가 삭제되었어도 공개 작품에 남은 본인 댓글은 수정합니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Comment updateComment(long comment, long member, String body) {
        long book = lockCommentBook(comment, member);
        if (!reviews.ownsComment(book, comment, member)) throw notFound();
        reviews.updateComment(comment, body);
        return reviews.comment(comment, member).orElseThrow(ReviewService::notFound);
    }

    /** 본인 댓글을 실제 삭제하며 연결 공감·신고 정리는 외래 키에 맡깁니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void deleteComment(long comment, long member) {
        long book = lockCommentBook(comment, member);
        if (!reviews.ownsComment(book, comment, member)) throw notFound();
        reviews.deleteComment(comment);
    }

    private long lockReviewBook(long review, long member) {
        members.lockActiveMember(member);
        long book = reviews.publishedReviewBookId(review).orElseThrow(ReviewService::notFound);
        return reviews.lockPublishedBook(book).orElseThrow(ReviewService::notFound);
    }

    private long lockCommentBook(long comment, long member) {
        members.lockActiveMember(member);
        long book = reviews.commentBookId(comment).orElseThrow(ReviewService::notFound);
        return reviews.lockPublishedBook(book).orElseThrow(ReviewService::notFound);
    }

    private long book(String slug, boolean lock) {
        return reviews.publishedBookId(slug, lock).orElseThrow(ReviewService::notFound);
    }

    private static Summary summarize(long[] counts) {
        long count = 0;
        long points = 0;
        Map<String, Long> distribution = new LinkedHashMap<>();
        for (int index = 0; index < counts.length; index++) {
            int rating = index + 1;
            count += counts[index];
            points += rating * counts[index];
            distribution.put(Integer.toString(rating), counts[index]);
        }
        var average = count == 0 ? null : BigDecimal.valueOf(points).divide(BigDecimal.valueOf(count), 2, RoundingMode.HALF_UP);
        return new Summary(average, count, distribution);
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "공개된 작품이 없습니다.");
    }
}
