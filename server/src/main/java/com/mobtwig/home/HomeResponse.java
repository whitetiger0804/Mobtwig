package com.mobtwig.home;

import java.util.List;

/**
 * 클라이언트가 지원하는 홈 SDUI 응답입니다.
 * @param version 응답 계약 버전입니다.
 * @param sections 서버 순서대로 표시할 구역입니다.
 */
public record HomeResponse(int version, List<WorkShelf> sections) {
    /**
     * 공개 작품을 가로 목록으로 표시하는 구역입니다.
     * @param id 구역 식별자입니다.
     * @param type 클라이언트 렌더러 이름입니다.
     * @param title 구역 제목입니다.
     * @param items 작품 카드 목록입니다.
     */
    public record WorkShelf(String id, String type, String title, List<WorkItem> items) { }

    /**
     * 작품 상세로 이동하는 홈 카드입니다.
     * @param id 작품의 slug입니다.
     * @param title 작품 제목입니다.
     * @param imageUrl 표지 이미지 주소입니다.
     */
    public record WorkItem(String id, String title, String imageUrl) { }
}
