package com.mobtwig.work;

/**
 * @param id
 * @param title
 * @param imageUrl
 * @param kind book, magazine, novel
 */
public record WorkSearchResponse(String id, String title, String imageUrl, String kind) {
}
