package com.mobtwig.work;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 공개 작품 조회와 작품별 조회 수 갱신을 담당합니다. */
public interface BookRepository extends JpaRepository<Book, Long> {
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
