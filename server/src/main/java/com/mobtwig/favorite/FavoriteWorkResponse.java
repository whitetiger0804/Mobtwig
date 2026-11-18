package com.mobtwig.favorite;

/**
 * 회원이 찜한 작품 한 건입니다.
 * @param id 상세 조회에 사용하는 작품 slug입니다.
 * @param kind book, magazine, novel 중 하나입니다.
 * @param title 작품 제목입니다.
 * @param author 저자 ID 순으로 쉼표와 공백을 넣어 연결한 저자 이름입니다.
 * @param imageUrl HTTP(S) 주소 또는 API 서버 기준 절대 경로인 표지입니다.
 */
public record FavoriteWorkResponse(String id, String kind, String title, String author, String imageUrl) { }
