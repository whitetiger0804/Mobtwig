package com.mobtwig.work;

import java.net.URI;
import java.time.LocalDate;
import java.util.regex.Pattern;

/** 공개 작품의 값이 클라이언트의 응답 계약을 만족하는지 검사합니다. */
public final class WorkMetadata {
    private static final Pattern BLANK_TEXT = Pattern.compile("[\\p{Z}\\x09-\\x0D\\uFEFF]*");

    private WorkMetadata() { }

    /**
     * 공백이 아닌 필수 문자열을 반환합니다.
     * @param value DB에서 읽은 값입니다.
     * @param field 오류를 식별할 필드 이름입니다.
     * @return 원본 문자열입니다.
     * @throws IllegalStateException 공개 자료에 필수 값이 없으면 발생합니다.
     */
    public static String requiredText(String value, String field) {
        if (value == null || BLANK_TEXT.matcher(value).matches()) {
            throw new IllegalStateException("공개 작품의 " + field + " 값이 없습니다.");
        }
        return value;
    }

    /**
     * URL용 작품 식별자를 검사합니다.
     * @param value DB의 slug입니다.
     * @return 소문자·숫자·하이픈으로 구성한 식별자입니다.
     * @throws IllegalStateException DB 식별자가 계약과 다르면 발생합니다.
     */
    public static String slug(String value) {
        if (!requiredText(value, "식별자").matches("[a-z0-9-]+")) {
            throw new IllegalStateException("공개 작품의 URL 식별자가 올바르지 않습니다.");
        }
        return value;
    }

    /**
     * HTTP(S) 또는 API 서버 기준의 표지 주소를 검사합니다.
     * @param value DB의 표지 주소입니다.
     * @return 원본 표지 주소입니다.
     * @throws IllegalStateException 지원하지 않는 주소이면 발생합니다.
     * @throws IllegalArgumentException URI 문법이 잘못되었으면 발생합니다.
     */
    public static String imageUrl(String value) {
        String image = requiredText(value, "표지 주소");
        if (image.chars().anyMatch(character -> character <= 31 || character == '\\')
                || image.startsWith("//")) {
            throw new IllegalStateException("공개 작품의 표지 주소가 올바르지 않습니다.");
        }
        URI uri = URI.create(image.replace(" ", "%20"));
        if (image.startsWith("/")) {
            return image;
        }
        String scheme = uri.getScheme();
        if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                || uri.getHost() == null || uri.getHost().contains("%") || uri.getPort() > 65535
                || uri.getRawAuthority().contains("@")) {
            throw new IllegalStateException("공개 작품의 표지 주소가 올바르지 않습니다.");
        }
        return image;
    }

    /**
     * 공개 작품의 출간일을 반환합니다.
     * @param date DB의 출간일입니다.
     * @return 실제 출간일입니다.
     * @throws IllegalStateException 출간일이 없으면 발생합니다.
     */
    public static LocalDate publishedDate(LocalDate date) {
        if (date == null) {
            throw new IllegalStateException("공개 작품의 출간일이 없습니다.");
        }
        return date;
    }

    /**
     * DB의 콘텐츠 종류를 앱의 분류로 변환합니다.
     * @param contentType DB의 콘텐츠 종류입니다.
     * @return book, magazine, novel 중 하나입니다.
     */
    public static String kind(String contentType) {
        return switch (contentType) {
            case "BOOK" -> "book";
            case "MAGAZINE" -> "magazine";
            case "WEBNOVEL" -> "novel";
            default -> throw new IllegalStateException("공개 작품의 콘텐츠 종류가 올바르지 않습니다.");
        };
    }

    /**
     * 내용이 없는 선택 문자열을 응답에서 생략할 수 있게 변환합니다.
     * @param value DB의 선택 문자열입니다.
     * @return 값이 있으면 원본이며 없으면 null입니다.
     */
    public static String optionalText(String value) {
        return value == null || BLANK_TEXT.matcher(value).matches() ? null : value;
    }
}
