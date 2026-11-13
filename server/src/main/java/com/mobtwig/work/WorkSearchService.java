package com.mobtwig.work;

import java.util.List;
import java.util.regex.Pattern;
import org.jspecify.annotations.NonNull;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** 공개 작품을 부분 검색하고 공통 작품 정보 규약으로 응답을 구성합니다. */
@Service
public class WorkSearchService {
    private static final Pattern EDGE_WHITESPACE = Pattern.compile(
            "^[\\p{Z}\\x09-\\x0D\\uFEFF]+|[\\p{Z}\\x09-\\x0D\\uFEFF]+$");
    private final BookRepository books;

    /**
     * 기존 작품 저장소를 주입받습니다.
     * @param books 공개 작품 검색을 수행하는 저장소입니다.
     */
    public WorkSearchService(BookRepository books) {
        this.books = books;
    }

    /**
     * 제목·저자·출판사의 일부가 일치하는 공개 작품을 최신순으로 조회합니다.
     * @param query 앞뒤 공백을 제거할 검색어입니다.
     * @param kind all, book, magazine, novel 중 하나입니다.
     * @return 중복 작품이 없는 검색 결과입니다.
     * @throws ResponseStatusException 검색어 또는 종류가 올바르지 않으면 발생합니다.
     * @throws IllegalStateException 공개 작품의 필수 정보가 잘못되면 발생합니다.
     */
    @Transactional(readOnly = true)
    public List<@NonNull WorkSearchResponse> search(String query, String kind) {
        String normalized = EDGE_WHITESPACE.matcher(query).replaceAll("");
        if (normalized.isEmpty() || normalized.codePointCount(0, normalized.length()) > 200) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "검색어는 앞뒤 공백을 제거한 뒤 1자 이상 200자 이하이어야 합니다.");
        }
        String contentType = switch (kind) {
            case "all" -> null;
            case "book" -> "BOOK";
            case "magazine" -> "MAGAZINE";
            case "novel" -> "WEBNOVEL";
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "지원하지 않는 작품 분류입니다.");
        };
        String pattern = "%" + normalized.replace("!", "!!").replace("%", "!%")
                .replace("_", "!_") + "%";
        return books.searchPublished(pattern, contentType).stream().map(book -> new WorkSearchResponse(
                WorkMetadata.slug(book.getSlug()), WorkMetadata.requiredText(book.getTitle(), "제목"),
                WorkMetadata.imageUrl(book.getCoverImageUrl()), WorkMetadata.kind(book.getContentType())))
                .toList();
    }
}
