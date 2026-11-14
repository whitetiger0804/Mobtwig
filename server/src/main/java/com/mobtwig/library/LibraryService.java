package com.mobtwig.library;

import java.util.List;
import com.mobtwig.work.WorkMetadata;
import org.jspecify.annotations.NonNull;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** 회원 서재를 공통 작품 응답 규약으로 변환합니다. */
@Service
public class LibraryService {
    private final LibraryRepository library;

    /**
     * 기존 서재 조회 저장소를 주입받습니다.
     * @param library 회원별 서재 저장소입니다.
     */
    public LibraryService(LibraryRepository library) { this.library = library; }

    /**
     * 회원 본인의 서재를 선택한 분류로 조회합니다.
     * @param member 인증에서 확인한 회원 ID입니다.
     * @param kind all, book, magazine, novel 중 하나입니다.
     * @return 서재에 담은 최신순의 목록이며 기록이 없으면 빈 목록입니다.
     * @throws ResponseStatusException 지원하지 않는 종류이면 발생합니다.
     * @throws IllegalStateException 공개 작품의 필수 정보가 잘못되면 발생합니다.
     */
    @Transactional(readOnly = true)
    public List<@NonNull LibraryWorkResponse> list(long member, String kind) {
        String contentType = switch (kind) {
            case "all" -> null;
            case "book" -> "BOOK";
            case "magazine" -> "MAGAZINE";
            case "novel" -> "WEBNOVEL";
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "지원하지 않는 작품 분류입니다.");
        };
        return library.list(member, contentType).stream().map(row -> new LibraryWorkResponse(
                WorkMetadata.slug(row.slug()), WorkMetadata.requiredText(row.title(), "제목"),
                WorkMetadata.imageUrl(row.imageUrl()), WorkMetadata.kind(row.contentType()),
                LibraryWorkResponse.Status.valueOf(row.status()))).toList();
    }
}
