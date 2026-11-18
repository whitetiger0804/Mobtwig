package com.mobtwig.purchase;

import org.jspecify.annotations.Nullable;

/** 상품·구매 응답입니다. 금액 단위는 원입니다. */
public final class PurchaseResponses {
    private PurchaseResponses() { }

    /**
     * 공개된 판매 대상과 현재 회원의 소장 여부입니다. 비회원의 owned는 false입니다.
     * @param productId 구매 요청에 사용하는 상품 ID입니다.
     * @param workId 작품 slug입니다.
     * @param kind book, magazine, novel 중 하나입니다.
     * @param title 작품 제목입니다.
     * @param imageUrl 표지 주소입니다.
     * @param chapterId 웹소설 회차 ID이며 도서·매거진은 null입니다.
     * @param chapterTitle 웹소설 회차 제목이며 도서·매거진은 null입니다.
     * @param price 서버가 설정한 가격입니다.
     * @param currency KRW입니다.
     * @param owned 현재 회원이 상품을 소장하는지 나타냅니다.
     * @param readable 가격이 0원이거나 소장 중이면 true입니다. 공개 상태 검증은 별도로 수행합니다.
     * @param paymentMode 구매 처리 방식입니다.
     */
    public record Product(String productId, String workId, String kind, String title, String imageUrl,
            @Nullable String chapterId, @Nullable String chapterTitle, int price, String currency,
            boolean owned, boolean readable, String paymentMode) { }

    /**
     * 구매 당시의 작품 정보·가격을 보존하는 회원 본인의 기록입니다.
     * @param purchaseId 구매 기록 조회에 사용하는 ID입니다.
     * @param productId 구매한 상품 ID입니다.
     * @param workId 구매 당시 작품 slug입니다.
     * @param kind 구매 단위의 작품 종류입니다.
     * @param title 구매 당시 작품 제목입니다.
     * @param imageUrl 구매 당시 표지 주소입니다.
     * @param purchasedAt 서버의 UTC ISO 구매 시각입니다.
     * @param chapterId 웹소설 회차 ID이며 작품 전체 구매는 null입니다.
     * @param chapterTitle 구매 당시 회차 제목이며 작품 전체 구매는 null입니다.
     * @param price 구매 당시의 가격입니다.
     * @param currency KRW입니다.
     * @param paymentMode 구매 처리 방식입니다.
     */
    public record Purchase(String purchaseId, String productId, String workId, String kind, String title,
            String imageUrl, String purchasedAt, @Nullable String chapterId, @Nullable String chapterTitle,
            int price, String currency, String paymentMode) { }
}
