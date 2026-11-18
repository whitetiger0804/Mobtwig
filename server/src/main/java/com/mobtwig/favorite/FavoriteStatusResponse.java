package com.mobtwig.favorite;

/**
 * 회원 본인이 작품을 찜했는지 여부입니다.
 * @param favorite 찜했으면 true입니다.
 */
public record FavoriteStatusResponse(boolean favorite) { }
