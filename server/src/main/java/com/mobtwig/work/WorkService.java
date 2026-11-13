package com.mobtwig.work;

import java.time.Instant;
import java.time.ZoneId;

import org.jspecify.annotations.NonNull;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/** 공개 작품과 회차를 클라이언트의 상세 응답으로 구성합니다. */
@Service
public class WorkService {
    private static final Logger LOG = LoggerFactory.getLogger(WorkService.class);
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private final BookRepository bookRepository;
    private final ChapterRepository chapterRepository;
    private final ViewCountService viewCountService;
    private final TransactionTemplate readTransaction;

    /**
     * 작품·회차 조회와 통계 기록 의존성을 주입받습니다.
     * @param bookRepository 작품 저장소입니다.
     * @param chapterRepository 회차 저장소입니다.
     * @param viewCountService 독립 트랜잭션의 조회 수 서비스입니다.
     * @param transactionManager 조회 트랜잭션을 관리합니다.
     */
    public WorkService(BookRepository bookRepository, ChapterRepository chapterRepository,
                       ViewCountService viewCountService, @NonNull PlatformTransactionManager transactionManager) {
        this.bookRepository = bookRepository;
        this.chapterRepository = chapterRepository;
        this.viewCountService = viewCountService;
        this.readTransaction = new TransactionTemplate(transactionManager);
        this.readTransaction.setReadOnly(true);
    }

    /**
     * 공개 작품과 공개 시각이 지난 회차를 조회하고 조회 수를 기록합니다.
     * 통계 기록의 DB 오류는 로그에 남기며 완성된 상세 응답을 유지합니다.
     * @param slug 작품의 URL 식별자입니다.
     * @return 클라이언트 계약에 맞는 상세 정보입니다.
     * @throws ResponseStatusException 식별자가 잘못되었거나 공개 작품이 없으면 발생합니다.
     * @throws IllegalStateException 조회 결과나 공개 자료의 필수 메타데이터가 없으면 발생합니다.
     */
    public WorkDetailResponse getPublishedDetail(String slug) {
        if (!slug.matches("[a-z0-9-]+")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "작품 식별자가 올바르지 않습니다.");
        }
        ReadResult result = readTransaction.execute(status -> readDetail(slug));
        if (result == null) {
            throw new IllegalStateException("작품 조회 트랜잭션의 결과가 없습니다.");
        }
        try {
            viewCountService.recordView(result.bookId());
        }
        catch (DataAccessException | TransactionException exception) {
            LOG.warn("작품 {}의 조회 수 집계에 실패했습니다.", result.bookId(), exception);
        }
        return result.response();
    }

    /** 읽기 트랜잭션 안에서 상세 DTO와 집계 대상 식별자를 완성합니다. */
    private ReadResult readDetail(String slug) {
        Book book = bookRepository.findBySlugAndPublishStatus(slug, "PUBLISHED")
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "공개된 작품이 없습니다."));
        String author = WorkMetadata.authors(book.getAuthors());
        String category = WorkMetadata.categories(book.getGenres(), book.getCategories());
        var contents = chapterRepository
                .findByBookIdAndPublishedAtLessThanEqualOrderByChapterNoAsc(book.getId(), Instant.now())
                .stream().map(chapter -> new WorkDetailResponse.Content(
                        chapter.getId().toString(), WorkMetadata.requiredText(chapter.getTitle(), "회차 제목"),
                        WorkMetadata.optionalText(chapter.getCategoryLabel()), chapter.getStartPage(),
                        chapter.getPublishedAt().atZone(KST).toLocalDate(),
                        chapter.getCharCount() > 0 ? chapter.getCharCount() : null))
                .toList();
        WorkDetailResponse response = new WorkDetailResponse(
                WorkMetadata.slug(book.getSlug()), WorkMetadata.kind(book.getContentType()),
                WorkMetadata.requiredText(book.getTitle(), "제목"), WorkMetadata.requiredText(author, "저자"),
                WorkMetadata.imageUrl(book.getCoverImageUrl()),
                WorkMetadata.requiredText(book.getDescription(), "소개"),
                WorkMetadata.requiredText(book.getPublisher(), "출판사"),
                WorkMetadata.publishedDate(book.getPublishedDate()),
                WorkMetadata.requiredText(category, "장르·카테고리"),
                WorkMetadata.requiredText(book.getFileFormat(), "파일 형식"), contents, book.getPageCount(),
                WorkMetadata.optionalText(book.getVolumeLabel()), WorkMetadata.optionalText(book.getPublishCycle()),
                new WorkDetailResponse.Statistics(book.getViewCount(), book.getRecommendCount(), book.getAverageRating()));
        return new ReadResult(book.getId(), response);
    }

    private record ReadResult(Long bookId, WorkDetailResponse response) { }
}
