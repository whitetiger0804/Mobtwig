package com.mobtwig.home;

import java.util.List;

import com.mobtwig.work.Book;
import com.mobtwig.work.BookRepository;
import com.mobtwig.work.WorkMetadata;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** DB의 공개 작품을 홈 SDUI의 작품 목록으로 구성합니다. */
@Service
public class HomeService {
    private final BookRepository bookRepository;

    /**
     * 작품 저장소를 주입받습니다.
     * @param bookRepository 작품 저장소입니다.
     */
    public HomeService(BookRepository bookRepository) {
        this.bookRepository = bookRepository;
    }

    /**
     * 분류에 맞는 최신 공개 작품을 최대 20개 반환합니다.
     * @param kind all, book, magazine, novel 중 하나입니다.
     * @return 빈 작품 목록도 표현할 수 있는 홈 응답입니다.
     * @throws ResponseStatusException 지원하지 않는 분류이면 발생합니다.
     */
    @Transactional(readOnly = true)
    public HomeResponse getHome(String kind) {
        String contentType = switch (kind) {
            case "all" -> null;
            case "book" -> "BOOK";
            case "magazine" -> "MAGAZINE";
            case "novel" -> "WEBNOVEL";
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "지원하지 않는 작품 분류입니다.");
        };
        PageRequest page = PageRequest.of(0, 20);
        List<Book> books = contentType == null
                ? bookRepository.findByPublishStatusOrderByPublishedDateDescIdDesc("PUBLISHED", page)
                : bookRepository.findByPublishStatusAndContentTypeOrderByPublishedDateDescIdDesc("PUBLISHED", contentType, page);
        List<HomeResponse.WorkItem> items = books.stream().map(book -> new HomeResponse.WorkItem(
                WorkMetadata.slug(book.getSlug()), WorkMetadata.requiredText(book.getTitle(), "제목"),
                WorkMetadata.imageUrl(book.getCoverImageUrl()))).toList();
        return new HomeResponse(1, List.of(new HomeResponse.WorkShelf(
                "published-works", "workShelf", "공개 작품", items)));
    }
}
