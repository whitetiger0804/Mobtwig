package com.mobtwig.work;

import java.time.LocalDate;
import java.time.ZoneId;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** 작품 조회 응답과 분리한 트랜잭션으로 누적·일별 조회 수를 기록합니다. */
@Service
public class ViewCountService {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private final BookRepository bookRepository;

    /**
     * 조회 수 저장소를 주입받습니다.
     * @param bookRepository 작품 저장소입니다.
     */
    public ViewCountService(BookRepository bookRepository) {
        this.bookRepository = bookRepository;
    }

    /**
     * 누적 조회 수와 KST 일별 조회 수를 같은 독립 트랜잭션에서 증가시킵니다.
     * @param bookId 작품 내부 식별자입니다.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordView(Long bookId) {
        bookRepository.incrementViewCount(bookId);
        bookRepository.incrementDailyViewCount(bookId, LocalDate.now(KST));
    }
}
