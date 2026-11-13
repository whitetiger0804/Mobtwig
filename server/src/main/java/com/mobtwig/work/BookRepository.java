package com.mobtwig.work;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.jspecify.annotations.Nullable;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 공개 작품 조회와 작품별 조회 수 갱신을 담당합니다. */
public interface BookRepository extends JpaRepository<Book, Long> {
    /**
     * 제목·저자·출판사의 부분 일치로 공개 작품을 검색합니다.
     * 저자 일치는 EXISTS로 검사하여 공동 저자 때문에 작품이 중복되지 않습니다.
     * @param pattern 느낌표를 이스케이프 문자로 사용하는 LIKE 검색 패턴입니다.
     * @param contentType DB 콘텐츠 종류이며 null이면 전체입니다.
     * @return 출간일과 식별자 내림차순의 검색 결과입니다.
     */
    @Query("""
            SELECT b FROM Book b
            WHERE b.publishStatus = 'PUBLISHED'
              AND (:contentType IS NULL OR b.contentType = :contentType)
              AND (b.title LIKE :pattern ESCAPE '!'
                   OR b.publisher LIKE :pattern ESCAPE '!'
                   OR EXISTS (SELECT a.id FROM Book authored JOIN authored.authors a
                              WHERE authored.id = b.id AND a.name LIKE :pattern ESCAPE '!'))
            ORDER BY b.publishedDate DESC, b.id DESC
            """)
    List<Book> searchPublished(@Param("pattern") String pattern,
            @Param("contentType") @Nullable String contentType);

    /**
     * 지정한 게시 상태의 작품을 출간일과 식별자 내림차순으로 조회합니다.
     * @param status 게시 상태입니다.
     * @param pageable 조회 범위입니다.
     * @return 정렬된 작품 목록입니다.
     */
    List<Book> findByPublishStatusOrderByPublishedDateDescIdDesc(String status, Pageable pageable);

    /**
     * 게시 상태와 콘텐츠 종류에 해당하는 작품을 조회합니다.
     * @param status 게시 상태입니다.
     * @param contentType DB의 콘텐츠 종류입니다.
     * @param pageable 조회 범위입니다.
     * @return 출간일과 식별자 내림차순의 작품 목록입니다.
     */
    List<Book> findByPublishStatusAndContentTypeOrderByPublishedDateDescIdDesc(
            String status, String contentType, Pageable pageable);

    /**
     * 전체 공개 추천 작품을 찜 수·평점·출간일·식별자 내림차순으로 조회합니다.
     * @param status 게시 상태입니다.
     * @param pageable 조회 범위입니다.
     * @return DB 집계 기준으로 정렬한 추천 작품입니다.
     */
    List<Book> findByPublishStatusOrderByWishlistCountDescAverageRatingDescPublishedDateDescIdDesc(
            String status, Pageable pageable);

    /**
     * 분류별 공개 추천 작품을 찜 수·평점·출간일·식별자 내림차순으로 조회합니다.
     * @param status 게시 상태입니다.
     * @param contentType DB의 콘텐츠 종류입니다.
     * @param pageable 조회 범위입니다.
     * @return 해당 분류의 DB 추천 작품입니다.
     */
    List<Book> findByPublishStatusAndContentTypeOrderByWishlistCountDescAverageRatingDescPublishedDateDescIdDesc(
            String status, String contentType, Pageable pageable);

    /**
     * URL 식별자와 게시 상태가 일치하는 작품을 조회합니다.
     * @param slug URL 식별자입니다.
     * @param status 게시 상태입니다.
     * @return 조건에 해당하는 작품입니다.
     */
    Optional<Book> findBySlugAndPublishStatus(String slug, String status);

    /**
     * 작품의 누적 조회 수를 원자적으로 증가시킵니다.
     * @param bookId 작품 내부 식별자입니다.
     * @return 갱신한 행 수입니다.
     */
    @Modifying
    @Query(value = "UPDATE book SET view_count = view_count + 1 WHERE id = :bookId", nativeQuery = true)
    int incrementViewCount(@Param("bookId") Long bookId);

    /**
     * KST 날짜의 일별 조회 수를 생성하거나 증가시킵니다.
     * @param bookId 작품 내부 식별자입니다.
     * @param date KST 기준 집계 날짜입니다.
     */
    @Modifying
    @Query(value = """
            INSERT INTO book_stat_daily (book_id, stat_date, view_count)
            VALUES (:bookId, :date, 1)
            ON DUPLICATE KEY UPDATE view_count = view_count + 1
            """, nativeQuery = true)
    void incrementDailyViewCount(@Param("bookId") Long bookId, @Param("date") LocalDate date);
}
