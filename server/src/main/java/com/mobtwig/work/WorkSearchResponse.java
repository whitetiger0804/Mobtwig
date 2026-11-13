package com.mobtwig.work;

/**
 * 공개 작품 검색 결과 한 건입니다.
 * @param id 상세 조회에 사용하는 작품 slug입니다.
 * @param title 작품 제목입니다.
 * @param imageUrl 표지 이미지 주소입니다.
 * @param kind book, magazine, novel 중 하나입니다.
 */
public record WorkSearchResponse(String id, String title, String imageUrl, String kind) {
}
