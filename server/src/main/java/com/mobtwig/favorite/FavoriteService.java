package com.mobtwig.favorite;

import java.util.List;
import com.mobtwig.work.WorkMetadata;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** 회원 본인의 찜을 공개 작품 기준으로 조회·추가·해제합니다. */
@Service
public class FavoriteService {
    private final FavoriteRepository repository;

    public FavoriteService(FavoriteRepository repository) { this.repository = repository; }

    /** 공개 작품의 필수 정보가 잘못되면 항목을 빼지 않고 IllegalStateException을 던집니다. */
    @Transactional(readOnly = true)
    public List<FavoriteWorkResponse> list(long member) {
        var authors = repository.authors(member);
        return repository.list(member).stream().map(row -> new FavoriteWorkResponse(
                WorkMetadata.slug(row.slug()), WorkMetadata.kind(row.contentType()),
                WorkMetadata.requiredText(row.title(), "제목"),
                WorkMetadata.authorNames(authors.getOrDefault(row.bookId(), List.of())),
                WorkMetadata.imageUrl(row.imageUrl()))).toList();
    }

    @Transactional(readOnly = true)
    public FavoriteStatusResponse status(long member, String slug) {
        validate(slug);
        long book = repository.publishedBook(slug).orElseThrow(FavoriteFailure::notFound);
        return new FavoriteStatusResponse(repository.exists(member, book));
    }

    /** 이미 찜했으면 아무것도 바꾸지 않습니다. 실제로 1행을 추가했을 때만 wishlist_count를 1 늘립니다. */
    @Transactional
    public void add(long member, String slug) {
        long book = lock(member, slug);
        if (repository.insert(member, book) == 1) repository.adjustCount(book, 1);
    }

    /** 찜하지 않았으면 아무것도 바꾸지 않습니다. 실제로 1행을 삭제했을 때만 wishlist_count를 1 줄입니다. */
    @Transactional
    public void remove(long member, String slug) {
        long book = lock(member, slug);
        if (repository.delete(member, book) == 1) repository.adjustCount(book, -1);
    }

    /** 읽기 위치 저장과 같은 순서(회원 → 작품)로 잠급니다. */
    private long lock(long member, String slug) {
        validate(slug);
        if (!repository.lockActiveMember(member)) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        return repository.lockPublishedBook(slug).orElseThrow(FavoriteFailure::notFound);
    }

    private static void validate(String slug) {
        if (slug == null || slug.length() > 120 || !slug.matches("[a-z0-9-]+")) throw FavoriteFailure.invalid();
    }
}
