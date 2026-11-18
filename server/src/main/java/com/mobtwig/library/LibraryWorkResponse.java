package com.mobtwig.library;

import org.jspecify.annotations.Nullable;

/**
 * 회원 서재의 작품 한 건입니다. id는 상세 조회에 사용하는 작품 slug입니다.
 * @param id 작품 slug입니다.
 * @param title 작품 제목입니다.
 * @param author 저자 식별자 순서로 쉼표로 연결한 표시 이름입니다.
 * @param imageUrl HTTP(S) 주소 또는 API 서버 기준 절대 경로인 표지입니다.
 * @param kind book, magazine, novel 중 하나입니다.
 * @param libraryStatus 읽고 싶은 작품·읽는 중·완독 상태입니다.
 * @param lastReadChapterNumber 현재 회원이 마지막으로 저장한 공개 회차 번호이며 기록이 없거나 비공개이면 null입니다.
 * @param statistics 웹소설의 누적 조회·추천·현재 공개 회차 수이며 다른 종류는 null입니다.
 * @param hasNextChapter 저장한 공개 회차 뒤에 공개된 회차가 있으면 true입니다.
 */
public record LibraryWorkResponse(String id, String title, String author, String imageUrl, String kind, Status libraryStatus,
        @Nullable Integer lastReadChapterNumber, @Nullable Statistics statistics, boolean hasNextChapter) {
    /** DB의 서재 상태와 동일한 응답 값입니다. */
    public enum Status { WANT_TO_READ, READING, COMPLETED }

    /**
     * 웹소설 서재 카드의 실제 집계입니다.
     * @param views 작품의 누적 조회 수입니다.
     * @param recommendations 작품의 누적 추천 수입니다.
     * @param chapterCount 현재 시각까지 공개된 회차 수입니다.
     */
    public record Statistics(long views, long recommendations, int chapterCount) { }
}
