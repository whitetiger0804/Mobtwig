package com.mobtwig.admin;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import org.jspecify.annotations.NonNull;
import org.jspecify.annotations.Nullable;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;

/** 관리자 등록 API의 입력과 DB 길이·범위 제약을 정의합니다. */
public final class AdminRequests {
    private AdminRequests() { }

    /**
     * 허용할 관리자 계정입니다.
     * @param email 로그인 이메일입니다.
     * @param nickname 표시 이름입니다.
     * @param password 해시 전에 검증할 비밀번호입니다.
     */
    public record Account(@NotBlank @Email @Size(max = 255) String email,
            @NotBlank @Size(max = 30) String nickname,
            @NotBlank @Size(min = 12, max = 72) String password) { }

    /**
     * 작품의 저자입니다.
     * @param name 표시 이름입니다.
     * @param bio 선택적인 소개입니다.
     * @param field 선택적인 활동 분야입니다.
     */
    public record Author(@NotBlank @Size(max = 100) String name,
            @Nullable @Size(max = 65535) String bio, @Nullable @Size(max = 100) String field) { }

    /**
     * 장르입니다.
     * @param name 고유한 이름입니다.
     * @param displayOrder 표시 순서입니다.
     */
    public record Genre(@NotBlank @Size(max = 50) String name, int displayOrder) { }

    /**
     * 카테고리입니다.
     * @param name 고유한 이름입니다.
     * @param description 선택적인 설명입니다.
     * @param displayOrder 표시 순서입니다.
     */
    public record Category(@NotBlank @Size(max = 50) String name,
            @Nullable @Size(max = 255) String description, int displayOrder) { }

    /**
     * 작품과 함께 저장할 회차입니다.
     * @param chapterNo 작품 안의 고유한 순서입니다.
     * @param title 회차 제목입니다.
     * @param publishedAt 공개 시각이며 null이면 비공개입니다.
     * @param characterCount UTF-16 본문 글자 수입니다.
     * @param summary 선택적인 요약입니다.
     * @param category 선택적인 분류 문구입니다.
     * @param pageNumber 매거진 아티클의 시작 쪽입니다.
     * @param contentUrl 공개 회차의 본문 주소입니다.
     */
    public record Chapter(@Positive int chapterNo, @NotBlank @Size(max = 200) String title,
            @Nullable Instant publishedAt, @PositiveOrZero int characterCount,
            @Nullable @Size(max = 65535) String summary,
            @Nullable @Size(max = 50) String category,
            @Nullable @Positive Integer pageNumber, @Nullable @Size(max = 500) String contentUrl) { }

    /**
     * 공개 API에 필요한 메타데이터와 연결 관계를 갖춘 작품입니다.
     * @param kind 앱의 콘텐츠 분류입니다.
     * @param slug URL용 고유 식별자입니다.
     * @param title 작품 제목입니다.
     * @param description 작품 소개입니다.
     * @param imageUrl 표지 주소입니다.
     * @param publishedAt 발행일입니다.
     * @param publisher 출판사 또는 발행처입니다.
     * @param fileFormat 파일 형식입니다.
     * @param pageCount 선택적인 전체 쪽수입니다.
     * @param issue 선택적인 권·호입니다.
     * @param publicationCycle 선택적인 발행 주기입니다.
     * @param serialStatus 연재 상태입니다.
     * @param publishStatus 최초 게시 상태입니다.
     * @param authorIds 저자 식별자입니다.
     * @param genreIds 장르 식별자입니다.
     * @param categoryIds 카테고리 식별자입니다.
     * @param chapters 한 개 이상의 회차입니다.
     */
    public record Work(@NotBlank @Pattern(regexp = "book|magazine|novel") String kind,
            @NotBlank @Size(max = 100) @Pattern(regexp = "[a-z0-9-]+") String slug,
            @NotBlank @Size(max = 200) String title,
            @NotBlank @Size(max = 65535) String description,
            @NotBlank @Size(max = 500) String imageUrl, @NotNull LocalDate publishedAt,
            @NotBlank @Size(max = 100) String publisher,
            @NotBlank @Size(max = 20) String fileFormat,
            @Nullable @Positive Integer pageCount, @Nullable @Size(max = 50) String issue,
            @Nullable @Size(max = 20) String publicationCycle,
            @NotBlank @Pattern(regexp = "ONGOING|HIATUS|COMPLETED") String serialStatus,
            @NotBlank @Pattern(regexp = "DRAFT|PUBLISHED") String publishStatus,
            @NotEmpty List<@NotNull @Positive Long> authorIds,
            @NotNull List<@NotNull @Positive Long> genreIds,
            @NotNull List<@NotNull @Positive Long> categoryIds,
            @NotEmpty List<@Valid @NotNull @NonNull Chapter> chapters) { }

    /**
     * 관리자 공개·숨김 전환입니다.
     * @param publishStatus 공개 또는 숨김 상태입니다.
     */
    public record Status(@NotBlank @Pattern(regexp = "PUBLISHED|HIDDEN") String publishStatus) { }
}
