package com.mobtwig.home;

import java.util.List;

import tools.jackson.databind.node.ObjectNode;

/**
 * 클라이언트가 지원하는 홈 SDUI 응답입니다.
 * @param version 응답 계약 버전입니다.
 * @param sections 서버 순서대로 표시할 구역입니다.
 */
public record HomeResponse(int version, List<ObjectNode> sections) {
    /**
     * 작품 상세로 이동하는 홈 카드입니다.
     * @param id 작품의 slug입니다.
     * @param title 작품 제목입니다.
     * @param imageUrl 표지 이미지 주소입니다.
     */
    public record WorkItem(String id, String title, String imageUrl) { }
}
