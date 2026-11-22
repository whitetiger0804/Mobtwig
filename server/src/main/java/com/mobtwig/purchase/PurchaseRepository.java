package com.mobtwig.purchase;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.jspecify.annotations.Nullable;
import org.jspecify.annotations.NonNull;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

/** 상품·구매 스냅샷·소장 권한을 같은 MySQL 트랜잭션에서 관리합니다. */
@Repository
public class PurchaseRepository {
    private final @NonNull JdbcTemplate jdbc;
    private static final String WORK = "SELECT id,slug,title,cover_image_url,content_type,publish_status FROM book ";

    /**
     * DB 연결 도구를 주입받습니다.
     * @param jdbc 현재 환경의 DB 연결입니다.
     */
    public PurchaseRepository(@NonNull JdbcTemplate jdbc) { this.jdbc = jdbc; }

    /** 같은 회원의 구매·읽기 위치 저장을 회원 행 기준으로 직렬화합니다. */
    boolean lockMember(long member) {
        return !jdbc.queryForList("SELECT id FROM member WHERE id=? AND status='ACTIVE' FOR UPDATE", Long.class, member).isEmpty();
    }

    Optional<Work> work(String slug, boolean exclusive) {
        return jdbc.query(WORK + "WHERE slug=?" + (exclusive ? " FOR UPDATE" : ""),
                (rs, row) -> new Work(rs.getLong("id"), rs.getString("slug"), rs.getString("title"),
                        rs.getString("cover_image_url"), rs.getString("content_type"), rs.getString("publish_status")), slug)
                .stream().findFirst();
    }

    Optional<Work> work(long book) {
        return jdbc.query(WORK + "WHERE id=? FOR SHARE",
                (rs, row) -> new Work(rs.getLong("id"), rs.getString("slug"), rs.getString("title"),
                        rs.getString("cover_image_url"), rs.getString("content_type"), rs.getString("publish_status")), book)
                .stream().findFirst();
    }

    Optional<Chapter> chapter(long book, long chapter, boolean lock) {
        return jdbc.query("SELECT title,published_at FROM chapter WHERE book_id=? AND id=?" + (lock ? " FOR SHARE" : ""), (rs, row) -> {
            var at = rs.getTimestamp("published_at");
            return new Chapter(rs.getString("title"), at == null ? null : at.toInstant());
        }, book, chapter).stream().findFirst();
    }

    Product configure(long book, @Nullable Long chapter, int price) {
        jdbc.update("""
                INSERT INTO purchase_product(book_id,chapter_id,price) VALUES(?,?,?)
                ON DUPLICATE KEY UPDATE price=?
                """, book, chapter, price, price);
        return jdbc.query("SELECT id,book_id,chapter_id,price FROM purchase_product WHERE book_id=? AND chapter_id <=> ?",
                (rs, row) -> new Product(rs.getLong("id"), rs.getLong("book_id"), rs.getObject("chapter_id", Long.class),
                        rs.getInt("price")), book, chapter).getFirst();
    }

    Optional<Product> product(long id, boolean lock) {
        return jdbc.query("SELECT id,book_id,chapter_id,price FROM purchase_product WHERE id=?" + (lock ? " FOR UPDATE" : ""),
                (rs, row) -> new Product(rs.getLong("id"), rs.getLong("book_id"), rs.getObject("chapter_id", Long.class),
                        rs.getInt("price")), id).stream().findFirst();
    }

    /** 회차 공개 시각을 지난 상품만 회차 순서로 표시합니다. */
    List<Offer> products(long book, @Nullable Long member) {
        return jdbc.query("""
                SELECT p.id,p.book_id,p.chapter_id,p.price,c.title AS chapter_title,
                       EXISTS(SELECT 1 FROM purchase r WHERE r.member_id=? AND r.product_id=p.id) AS owned
                FROM purchase_product p LEFT JOIN chapter c ON c.id=p.chapter_id AND c.book_id=p.book_id
                WHERE p.book_id=? AND (p.chapter_id IS NULL OR c.published_at<=CURRENT_TIMESTAMP)
                ORDER BY c.chapter_no,p.id
                """, (rs, row) -> new Offer(new Product(rs.getLong("id"), rs.getLong("book_id"),
                        rs.getObject("chapter_id", Long.class), rs.getInt("price")),
                        rs.getString("chapter_title"), rs.getBoolean("owned")), member, book);
    }

    Optional<Stored> byRequest(long member, String request) {
        return stored("WHERE member_id=? AND request_key=?", member, request).stream().findFirst();
    }

    Optional<Stored> purchase(long member, long id) {
        return stored("WHERE member_id=? AND id=?", member, id).stream().findFirst();
    }

    List<Stored> history(long member) {
        return stored("WHERE member_id=? ORDER BY purchased_at DESC,id DESC", member);
    }

    boolean owned(long member, long product) {
        return !jdbc.queryForList("SELECT id FROM purchase WHERE member_id=? AND product_id=?", Long.class, member, product).isEmpty();
    }

    /** 구매 시의 값만 보존합니다. 이후 작품의 제목·표지·가격·공개 상태를 바꿔도 이 기록은 바뀌지 않습니다. */
    Stored insert(long member, Product product, Work work, @Nullable Chapter chapter, String request) {
        var key = new GeneratedKeyHolder();
        JdbcClient.create(jdbc).sql("""
                INSERT INTO purchase(member_id,product_id,request_key,work_slug,content_type,title,image_url,chapter_id,chapter_title,price)
                VALUES(?,?,?,?,?,?,?,?,?,?)
                """).params(member, product.id(), request, work.slug(), work.type(), work.title(), work.image(),
                        product.chapter(), chapter == null ? null : chapter.title(), product.price()).update(key);
        return purchase(member, Objects.requireNonNull(key.getKey()).longValue()).orElseThrow();
    }

    /**
     * 구매로 서재에 처음 담을 때만 WANT_TO_READ를 사용하며 기존 상태·숨김·즐겨찾기는 보존합니다.
     * @param member 현재 회원입니다.
     * @param book 구매한 작품의 DB ID입니다.
     */
    public void addToLibrary(long member, long book) {
        jdbc.update("""
                INSERT INTO library_book(member_id,book_id,status) VALUES(?,?,'WANT_TO_READ')
                ON DUPLICATE KEY UPDATE member_id=member_id
                """, member, book);
    }

    /** 상품 미설정·0원은 무료이며 구매한 상품은 가격 변경 후에도 열람할 수 있습니다. */
    boolean readable(@Nullable Long member, long book, @Nullable Long chapter) {
        return jdbc.queryForList("""
                SELECT p.id FROM purchase_product p
                WHERE p.book_id=? AND (p.chapter_id IS NULL OR p.chapter_id=?) AND p.price>0
                  AND NOT EXISTS(SELECT 1 FROM purchase r WHERE r.member_id=? AND r.product_id=p.id)
                """, Long.class, book, chapter, member).isEmpty();
    }

    private List<Stored> stored(String condition, @Nullable Object... args) {
        return jdbc.query("SELECT * FROM purchase " + condition, (rs, row) ->
                new Stored(rs.getLong("id"), rs.getLong("product_id"), rs.getString("work_slug"), rs.getString("content_type"),
                    rs.getString("title"), rs.getString("image_url"), rs.getObject("chapter_id", Long.class),
                    rs.getString("chapter_title"), rs.getInt("price"), rs.getTimestamp("purchased_at").toInstant()), args);
    }

    record Work(long id, String slug, String title, String image, String type, String status) { }
    record Chapter(String title, @Nullable Instant publishedAt) { }
    record Product(long id, long book, @Nullable Long chapter, int price) { }
    record Offer(Product product, @Nullable String chapterTitle, boolean owned) { }
    record Stored(long id, long product, String slug, String type, String title, String image,
            @Nullable Long chapter, @Nullable String chapterTitle, int price, Instant purchasedAt) { }
}
