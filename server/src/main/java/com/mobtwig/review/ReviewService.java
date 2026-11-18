package com.mobtwig.review;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** 공개 작품의 리뷰 요약과 목록을 일관된 상태로 읽으며 등록 시 작품 통계도 함께 갱신합니다. */
@Service
class ReviewService {
    record Item(String id, int rating, String body, String nickname, Instant createdAt) {}
    record Page(BigDecimal averageRating, long reviewCount, Map<String, Long> ratingDistribution,
                List<Item> items, boolean hasNext) {}
    record Summary(BigDecimal average, long count, Map<String, Long> distribution) {}

    private final ReviewRepository reviews;

    ReviewService(ReviewRepository reviews) { this.reviews = reviews; }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Page list(String slug, int page, int size) {
        long book = book(slug, false);
        var summary = summarize(reviews.counts(book));
        long offset = (long) (page - 1) * size;
        var items = reviews.page(book, size, offset);
        return new Page(summary.average(), summary.count(), summary.distribution(), items,
                offset + items.size() < summary.count());
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Item create(String slug, long member, int rating, String body) {
        // 작품 행을 먼저 잠가 같은 작품의 등록과 집계를 직렬화한다.
        long book = book(slug, true);
        long id;
        try {
            id = reviews.insert(book, member, rating, body);
        } catch (DuplicateKeyException duplicate) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 이 작품에 리뷰를 등록했습니다.");
        }
        reviews.updateSummary(book, summarize(reviews.counts(book)));
        return reviews.created(book, id);
    }

    private long book(String slug, boolean lock) {
        if (slug.matches("[a-z0-9-]{1,120}")) {
            return reviews.publishedBookId(slug, lock).orElseThrow(ReviewService::notFound);
        }
        throw notFound();
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
