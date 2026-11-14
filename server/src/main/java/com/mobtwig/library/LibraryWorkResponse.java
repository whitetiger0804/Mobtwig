package com.mobtwig.library;

/**
 * 회원 서재의 작품 한 건입니다. id는 상세 조회에 사용하는 작품 slug입니다.
 * @param id 작품 slug입니다.
 * @param title 작품 제목입니다.
 * @param imageUrl HTTP(S) 주소 또는 API 서버 기준 절대 경로인 표지입니다.
 * @param kind book, magazine, novel 중 하나입니다.
 * @param libraryStatus 읽고 싶은 작품·읽는 중·완독 상태입니다.
 */
public record LibraryWorkResponse(String id, String title, String imageUrl, String kind, Status libraryStatus) {
    /** DB의 서재 상태와 동일한 응답 값입니다. */
    public enum Status { WANT_TO_READ, READING, COMPLETED }
}
