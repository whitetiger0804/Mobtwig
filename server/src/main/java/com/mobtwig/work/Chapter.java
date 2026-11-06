package com.mobtwig.work;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** 작품 상세의 목차·회차 표시 정보를 매핑합니다. */
@Entity
@Table(name = "chapter")
public class Chapter {
    @Id
    private Long id;

    @Column(name = "book_id", nullable = false)
    private Long bookId;

    @Column(name = "chapter_no", nullable = false)
    private int chapterNo;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(name = "published_at", columnDefinition = "timestamp")
    private Instant publishedAt;

    @Column(name = "char_count", nullable = false)
    private int charCount;

    @Column(name = "category_label", length = 50)
    private String categoryLabel;

    @Column(name = "start_page")
    private Integer startPage;

    @Column(name = "content_url", length = 500)
    private String contentUrl;

    @Column(name = "content_version", nullable = false)
    private int contentVersion;

    /** DB의 본문 버전을 반환합니다. 읽기 요청에서 변경하지 않습니다. */
    public int getContentVersion() { return contentVersion; }

    /** 본문 공급 주소를 반환합니다. API 응답에 원본 주소를 노출하지 않습니다. */
    public String getContentUrl() { return contentUrl; }

    /** 작품 내 회차 번호를 반환합니다. */
    public int getChapterNo() { return chapterNo; }

    /** JPA가 회차를 생성합니다. */
    protected Chapter() { }

    /** 회차 내부 식별자를 반환합니다.
     * @return DB 내부 회차 식별자입니다. */
    public Long getId() { return id; }
    /** 회차 제목을 반환합니다.
     * @return 목차 또는 회차 제목입니다. */
    public String getTitle() { return title; }
    /** 회차 공개 시각을 반환합니다.
     * @return UTC 공개 시각입니다. */
    public Instant getPublishedAt() { return publishedAt; }
    /** 본문 글자 수를 반환합니다.
     * @return 본문 글자 수입니다. */
    public int getCharCount() { return charCount; }
    /** 아티클 분류를 반환합니다.
     * @return 아티클 분류이며 미입력 시 null입니다. */
    public String getCategoryLabel() { return categoryLabel; }
    /** 시작 쪽수를 반환합니다.
     * @return 시작 쪽수이며 미입력 시 null입니다. */
    public Integer getStartPage() { return startPage; }
}
