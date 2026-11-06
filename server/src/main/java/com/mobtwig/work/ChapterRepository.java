package com.mobtwig.work;

import java.time.Instant;
import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

/** 공개 시각이 지난 작품별 목차·회차를 조회합니다. */
public interface ChapterRepository extends JpaRepository<Chapter, Long> {
    /**
     * 공개 시각이 존재하며 기준 시각 이하인 회차를 조회합니다.
     * @param bookId 부모 작품의 내부 식별자입니다.
     * @param now 공개 여부를 판단할 UTC 시각입니다.
     * @return 회차 번호 오름차순의 목록입니다.
     */
    List<Chapter> findByBookIdAndPublishedAtLessThanEqualOrderByChapterNoAsc(Long bookId, Instant now);
}
