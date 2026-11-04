package com.mobtwig.work;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 클라이언트의 작품 상세 화면에 전달하는 JSON 데이터입니다.
 * @param id 작품의 slug입니다.
 * @param kind 앱의 콘텐츠 분류입니다.
 * @param title 작품 제목입니다.
 * @param author 저자의 표시 이름입니다.
 * @param imageUrl 표지 주소입니다.
 * @param description 작품 소개입니다.
 * @param publisher 출판사 또는 발행처입니다.
 * @param publishedAt 출간일입니다.
 * @param category 장르와 카테고리의 표시 이름입니다.
 * @param fileFormat 파일 형식입니다.
 * @param contents 공개된 목차·회차입니다.
 * @param pageCount 선택적인 전체 쪽수입니다.
 * @param issue 선택적인 권·호 표시입니다.
 * @param publicationCycle 선택적인 발행 주기입니다.
 * @param statistics 조회 시점의 통계입니다.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record WorkDetailResponse(
        String id, String kind, String title, String author, String imageUrl,
        String description, String publisher, LocalDate publishedAt, String category,
        String fileFormat, List<Content> contents, Integer pageCount, String issue,
        String publicationCycle, Statistics statistics) {

    /**
     * 공개된 목차 또는 회차입니다.
     * @param id 회차 내부 식별자의 문자열입니다.
     * @param title 회차 제목입니다.
     * @param category 선택적인 아티클 분류입니다.
     * @param pageNumber 선택적인 시작 쪽수입니다.
     * @param publishedAt KST 기준 공개일입니다.
     * @param characterCount 양수일 때만 제공하는 본문 글자 수입니다.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Content(String id, String title, String category, Integer pageNumber,
                          LocalDate publishedAt, Integer characterCount) { }

    /**
     * DB에 집계된 작품 통계입니다.
     * @param views 누적 조회 수입니다.
     * @param recommendations 누적 추천 수입니다.
     * @param rating 평균 평점입니다.
     */
    public record Statistics(long views, int recommendations, BigDecimal rating) { }
}
