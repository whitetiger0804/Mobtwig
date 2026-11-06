package com.mobtwig.work;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import org.jspecify.annotations.NonNull;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;

/** 작품 조회에 필요한 출판 정보와 저자·분류 관계를 매핑합니다. */
@Entity
@Table(name = "book")
public class Book {
    @Id
    private Long id;

    @Column(name = "content_type", nullable = false, length = 20)
    private String contentType;

    @Column(nullable = false, length = 100)
    private String slug;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(columnDefinition = "text")
    private String description;

    @Column(name = "cover_image_url", length = 500)
    private String coverImageUrl;

    @Column(name = "published_date")
    private LocalDate publishedDate;

    @Column(length = 100)
    private String publisher;

    @Column(name = "file_format", length = 20)
    private String fileFormat;

    @Column(name = "page_count")
    private Integer pageCount;

    @Column(name = "volume_label", length = 50)
    private String volumeLabel;

    @Column(name = "publish_cycle", length = 20)
    private String publishCycle;

    @Column(name = "publish_status", nullable = false, length = 20)
    private String publishStatus;

    @Column(name = "average_rating", nullable = false, precision = 3, scale = 2)
    private BigDecimal averageRating;

    @Column(name = "view_count", nullable = false)
    private long viewCount;

    @Column(name = "recommend_count", nullable = false)
    private int recommendCount;

    @ManyToMany
    @JoinTable(name = "book_author", joinColumns = @JoinColumn(name = "book_id"),
            inverseJoinColumns = @JoinColumn(name = "author_id"))
    @OrderBy("id ASC")
    private List<Author> authors;

    @ManyToMany
    @JoinTable(name = "book_genre", joinColumns = @JoinColumn(name = "book_id"),
            inverseJoinColumns = @JoinColumn(name = "genre_id"))
    @OrderBy("displayOrder ASC, id ASC")
    private List<@NonNull Genre> genres;

    @ManyToMany
    @JoinTable(name = "book_category", joinColumns = @JoinColumn(name = "book_id"),
            inverseJoinColumns = @JoinColumn(name = "category_id"))
    @OrderBy("displayOrder ASC, id ASC")
    private List<@NonNull Category> categories;

    /** JPA가 작품을 생성합니다. */
    protected Book() { }

    /** 작품 내부 식별자를 반환합니다.
     * @return DB 내부 작품 식별자입니다. */
    public Long getId() { return id; }
    /** 콘텐츠 종류를 반환합니다.
     * @return DB에 저장된 콘텐츠 종류입니다. */
    public String getContentType() { return contentType; }
    /** URL용 작품 식별자를 반환합니다.
     * @return URL과 클라이언트에 사용하는 작품 식별자입니다. */
    public String getSlug() { return slug; }
    /** 작품 제목을 반환합니다.
     * @return 작품 제목입니다. */
    public String getTitle() { return title; }
    /** 작품 소개를 반환합니다.
     * @return 작품 소개입니다. */
    public String getDescription() { return description; }
    /** 표지 이미지 주소를 반환합니다.
     * @return 표지 이미지 주소입니다. */
    public String getCoverImageUrl() { return coverImageUrl; }
    /** 출간일을 반환합니다.
     * @return 출간일입니다. */
    public LocalDate getPublishedDate() { return publishedDate; }
    /** 출판 정보를 반환합니다.
     * @return 출판사 또는 발행처입니다. */
    public String getPublisher() { return publisher; }
    /** 파일 형식을 반환합니다.
     * @return 파일 형식입니다. */
    public String getFileFormat() { return fileFormat; }
    /** 전체 쪽수를 반환합니다.
     * @return 전체 쪽수이며 미입력 시 null입니다. */
    public Integer getPageCount() { return pageCount; }
    /** 권·호 표시를 반환합니다.
     * @return 권·호 표시이며 미입력 시 null입니다. */
    public String getVolumeLabel() { return volumeLabel; }
    /** 발행 주기를 반환합니다.
     * @return 발행 주기이며 미입력 시 null입니다. */
    public String getPublishCycle() { return publishCycle; }
    /** 평균 평점을 반환합니다.
     * @return 평균 평점입니다. */
    public BigDecimal getAverageRating() { return averageRating; }
    /** 누적 조회 수를 반환합니다.
     * @return 누적 조회 수입니다. */
    public long getViewCount() { return viewCount; }
    /** 누적 추천 수를 반환합니다.
     * @return 누적 추천 수입니다. */
    public int getRecommendCount() { return recommendCount; }
    /** 작품의 저자 목록을 반환합니다.
     * @return 저자 식별자 순서의 저자 목록입니다. */
    public List<Author> getAuthors() { return authors; }
    /** 작품의 장르 목록을 반환합니다.
     * @return 표시 순서와 식별자로 정렬한 장르입니다. */
    public List<@NonNull Genre> getGenres() { return genres; }
    /** 작품의 카테고리 목록을 반환합니다.
     * @return 표시 순서와 식별자로 정렬한 카테고리입니다. */
    public List<@NonNull Category> getCategories() { return categories; }
}
