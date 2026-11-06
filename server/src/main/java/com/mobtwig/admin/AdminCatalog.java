package com.mobtwig.admin;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;

import org.jspecify.annotations.NonNull;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.DataClassRowMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** 기존 콘텐츠 스키마에 관리자 입력과 관계·게시판을 원자적으로 저장합니다. */
@Service
public class AdminCatalog {
    private final @NonNull JdbcTemplate jdbc;

    /**
     * 기존 DB 접근기를 주입받습니다.
     * @param jdbc 공용 DB 접근기입니다.
     */
    public AdminCatalog(@NonNull JdbcTemplate jdbc) { this.jdbc = jdbc; }

    /**
     * 입력 화면에서 선택할 현재 DB 자료를 반환합니다.
     * @return 저자·분류와 작품 목록입니다.
     */
    @Transactional(readOnly = true)
    public Catalog catalog() {
        var lookup = DataClassRowMapper.newInstance(Lookup.class);
        return new Catalog(jdbc.query("SELECT id,name FROM author ORDER BY id", lookup),
                jdbc.query("SELECT id,name FROM genre ORDER BY display_order,id", lookup),
                jdbc.query("SELECT id,name FROM category ORDER BY display_order,id", lookup),
                jdbc.query("""
                        SELECT id,slug,title,CASE content_type WHEN 'BOOK' THEN 'book'
                        WHEN 'MAGAZINE' THEN 'magazine' WHEN 'WEBNOVEL' THEN 'novel' END AS kind,publish_status
                        FROM book ORDER BY id DESC
                        """, DataClassRowMapper.newInstance(WorkRow.class)));
    }

    /**
     * 저자를 생성합니다.
     * @param input 저자 정보입니다.
     * @return 생성한 저자 ID입니다.
     */
    @Transactional
    public long author(AdminRequests.Author input) {
        return insert("INSERT INTO author(name,bio,field) VALUES (?,?,?)",
                AdminRules.text(input.name(), "저자 이름", 100),
                AdminRules.optional(input.bio(), "저자 소개", 65535),
                AdminRules.optional(input.field(), "활동 분야", 100));
    }

    /**
     * 장르를 생성합니다.
     * @param input 장르 이름과 순서입니다.
     * @return 생성한 장르 ID입니다.
     */
    @Transactional
    public long genre(AdminRequests.Genre input) {
        return insert("INSERT INTO genre(name,display_order) VALUES (?,?)",
                AdminRules.text(input.name(), "장르 이름", 50), input.displayOrder());
    }

    /**
     * 카테고리를 생성합니다.
     * @param input 카테고리 정보입니다.
     * @return 생성한 카테고리 ID입니다.
     */
    @Transactional
    public long category(AdminRequests.Category input) {
        return insert("INSERT INTO category(name,description,display_order) VALUES (?,?,?)",
                AdminRules.text(input.name(), "카테고리 이름", 50),
                AdminRules.optional(input.description(), "카테고리 설명", 255), input.displayOrder());
    }

    /**
     * 관리자 작품과 저자·분류·회차를 함께 생성합니다.
     * @param input 공개 API의 필수 정보를 갖춘 작품입니다.
     * @return 생성한 작품의 DB ID입니다.
     */
    @Transactional
    public long work(AdminRequests.Work input) {
        String contentType = switch (input.kind()) {
            case "book" -> "BOOK";
            case "magazine" -> "MAGAZINE";
            case "novel" -> "WEBNOVEL";
            default -> throw AdminRules.bad("지원하지 않는 작품 종류입니다.");
        };
        AdminRules.text(input.title(), "작품 제목", 200);
        AdminRules.text(input.description(), "작품 소개", 65535);
        AdminRules.url(input.imageUrl(), "표지 주소");
        AdminRules.text(input.publisher(), "출판사", 100);
        AdminRules.text(input.fileFormat(), "파일 형식", 20);
        if (input.publishedAt().getYear() < 1000 || input.publishedAt().getYear() > 9999) {
            throw AdminRules.bad("발행일은 1000년부터 9999년 사이여야 합니다.");
        }
        references("author", input.authorIds());
        references("genre", input.genreIds());
        references("category", input.categoryIds());
        if (input.genreIds().isEmpty() && input.categoryIds().isEmpty()) {
            throw AdminRules.bad("장르 또는 카테고리를 한 개 이상 선택하십시오.");
        }
        chapters(input.chapters(), input.kind(), input.pageCount());
        long id = insert("""
                INSERT INTO book(content_type,slug,title,description,cover_image_url,published_date,
                    publisher,file_format,page_count,volume_label,publish_cycle,serial_status,publish_status)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, contentType, input.slug(), input.title(), input.description(), input.imageUrl(),
                input.publishedAt(), input.publisher(), input.fileFormat(), input.pageCount(),
                AdminRules.optional(input.issue(), "권·호", 50),
                AdminRules.optional(input.publicationCycle(), "발행 주기", 20), input.serialStatus(), input.publishStatus());
        link("book_author", "author_id", id, input.authorIds());
        link("book_genre", "genre_id", id, input.genreIds());
        link("book_category", "category_id", id, input.categoryIds());
        for (var chapter : input.chapters()) { insertChapter(id, chapter); }
        if ("PUBLISHED".equals(input.publishStatus())) { board(id); }
        return id;
    }

    /**
     * 기존 작품에 회차를 추가하고 매거진 쪽 순서를 함께 검사합니다.
     * @param id 작품 DB ID입니다.
     * @param input 새 회차입니다.
     * @return 생성한 회차 ID입니다.
     */
    @Transactional
    public long chapter(long id, AdminRequests.@NonNull Chapter input) {
        StoredWork work = stored(id);
        var existing = new java.util.ArrayList<>(storedChapters(id));
        existing.add(input);
        chapters(existing, "MAGAZINE".equals(work.contentType()) ? "magazine" : "book", work.pageCount());
        return insertChapter(id, input);
    }

    /**
     * 필수 정보를 검사하여 공개하거나 작품을 숨깁니다.
     * @param id 작품 DB ID입니다.
     * @param status 공개 또는 숨김 상태입니다.
     */
    @Transactional
    public void status(long id, String status) {
        StoredWork work = stored(id);
        if ("PUBLISHED".equals(status)) {
            String slug = AdminRules.text(work.slug(), "작품 식별자", 100);
            if (!slug.matches("[a-z0-9-]+")) { throw AdminRules.bad("작품 식별자가 올바르지 않습니다."); }
            AdminRules.text(work.title(), "작품 제목", 200);
            AdminRules.text(work.description(), "작품 소개", 65535);
            AdminRules.url(AdminRules.text(work.imageUrl(), "표지 주소", 500), "표지 주소");
            AdminRules.text(work.publisher(), "출판사", 100);
            AdminRules.text(work.fileFormat(), "파일 형식", 20);
            if (work.publishedAt() == null) { throw AdminRules.bad("작품 발행일을 입력하십시오."); }
            var authors = jdbc.queryForList("""
                    SELECT a.name FROM author a JOIN book_author ba ON a.id=ba.author_id WHERE ba.book_id=?
                    """, String.class, id);
            var classifications = jdbc.queryForList("""
                    SELECT g.name FROM genre g JOIN book_genre bg ON g.id=bg.genre_id WHERE bg.book_id=?
                    UNION ALL
                    SELECT c.name FROM category c JOIN book_category bc ON c.id=bc.category_id WHERE bc.book_id=?
                    """, String.class, id, id);
            if (authors.isEmpty() || classifications.isEmpty()) {
                throw AdminRules.bad("저자와 장르 또는 카테고리를 연결하십시오.");
            }
            authors.forEach(name -> AdminRules.text(name, "저자 이름", 100));
            classifications.forEach(name -> AdminRules.text(name, "분류 이름", 50));
            chapters(storedChapters(id), "MAGAZINE".equals(work.contentType()) ? "magazine" : "book", work.pageCount());
            board(id);
        }
        jdbc.update("UPDATE book SET publish_status=? WHERE id=?", status, id);
    }

    private void references(String table, List<Long> ids) {
        if (new HashSet<>(ids).size() != ids.size()) { throw AdminRules.bad("같은 연결 항목을 중복 선택할 수 없습니다."); }
        for (long id : ids) {
            var names = jdbc.queryForList("SELECT name FROM " + table + " WHERE id=?", String.class, id);
            if (names.isEmpty()) {
                throw AdminRules.bad("선택한 연결 항목이 DB에 없습니다.");
            }
            names.forEach(name -> AdminRules.text(name, "연결 항목 이름", table.equals("author") ? 100 : 50));
        }
    }

    private void link(String table, String column, long id, List<Long> values) {
        for (long value : values) { jdbc.update("INSERT INTO " + table + "(book_id," + column + ") VALUES (?,?)", id, value); }
    }

    private void board(long id) {
        jdbc.update("""
                INSERT INTO board(type,book_id,name) SELECT 'WORK',?,NULL
                WHERE NOT EXISTS(SELECT 1 FROM board WHERE book_id=?)
                """, id, id);
    }

    private StoredWork stored(long id) {
        return jdbc.query("""
                SELECT id,content_type,slug,title,description,cover_image_url AS image_url,
                published_date AS published_at,publisher,file_format,page_count FROM book WHERE id=? FOR UPDATE
                """, DataClassRowMapper.newInstance(StoredWork.class), id).stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "작품이 없습니다."));
    }

    private List<AdminRequests.@NonNull Chapter> storedChapters(long id) {
        return jdbc.query("SELECT * FROM chapter WHERE book_id=? ORDER BY chapter_no", (rs, row) -> {
            Timestamp published = rs.getTimestamp("published_at");
            return new AdminRequests.Chapter(rs.getInt("chapter_no"),
                    AdminRules.text(rs.getString("title"), "회차 제목", 200),
                    published == null ? null : published.toInstant(), rs.getInt("char_count"),
                    rs.getString("summary"), rs.getString("category_label"),
                    rs.getObject("start_page", Integer.class), rs.getString("content_url"));
        }, id);
    }

    private void chapters(List<AdminRequests.@NonNull Chapter> values, String kind, @Nullable Integer pageCount) {
        if (values.isEmpty()) { throw AdminRules.bad("회차를 한 개 이상 등록하십시오."); }
        int previousChapter = 0;
        int previousPage = 0;
        for (var chapter : values.stream().sorted(Comparator.comparingInt(AdminRequests.Chapter::chapterNo)).toList()) {
            if (chapter.chapterNo() <= previousChapter) { throw AdminRules.bad("회차 번호가 중복되었습니다."); }
            previousChapter = chapter.chapterNo();
            AdminRules.text(chapter.title(), "회차 제목", 200);
            AdminRules.optional(chapter.summary(), "회차 요약", 65535);
            AdminRules.optional(chapter.category(), "회차 분류", 50);
            String content = AdminRules.optional(chapter.contentUrl(), "본문 주소", 500);
            if (chapter.publishedAt() != null && content == null) { throw AdminRules.bad("공개 회차에는 본문 주소가 필요합니다."); }
            Instant published = chapter.publishedAt();
            if (published != null && (published.isBefore(Instant.parse("1970-01-01T00:00:01Z"))
                    || published.isAfter(Instant.parse("2038-01-19T03:14:07Z")))) {
                throw AdminRules.bad("회차 공개 시각은 DB의 1970년부터 2038년 범위 안이어야 합니다.");
            }
            if (content != null) { AdminRules.url(content, "본문 주소"); }
            if ("magazine".equals(kind)) {
                Integer page = chapter.pageNumber();
                if (page == null || page <= previousPage || (pageCount != null && page > pageCount)) {
                    throw AdminRules.bad("매거진 시작 쪽은 회차 순서대로 증가하고 전체 쪽수 이하여야 합니다.");
                }
                previousPage = page;
            }
        }
    }

    private long insertChapter(long bookId, AdminRequests.Chapter chapter) {
        Instant published = chapter.publishedAt();
        return insert("""
                INSERT INTO chapter(book_id,chapter_no,title,published_at,char_count,summary,category_label,start_page,content_url)
                VALUES (?,?,?,?,?,?,?,?,?)
                """, bookId, chapter.chapterNo(), chapter.title(), published == null ? null : Timestamp.from(published),
                chapter.characterCount(), AdminRules.optional(chapter.summary(), "회차 요약", 65535),
                AdminRules.optional(chapter.category(), "회차 분류", 50), chapter.pageNumber(),
                AdminRules.optional(chapter.contentUrl(), "본문 주소", 500));
    }

    private long insert(@NonNull String sql, @Nullable Object @NonNull ... values) {
        GeneratedKeyHolder key = new GeneratedKeyHolder();
        JdbcClient.create(jdbc).sql(sql).params(values).update(key);
        Number id = key.getKey();
        if (id == null) { throw new IllegalStateException("생성한 자료의 식별자를 받지 못했습니다."); }
        return id.longValue();
    }

    /**
     * 관계 선택 항목입니다.
     * @param id DB 식별자입니다.
     * @param name 표시 이름입니다.
     */
    public record Lookup(long id, String name) { }

    /**
     * 관리자 작품 목록입니다.
     * @param id DB 식별자입니다.
     * @param slug 공개 URL 식별자입니다.
     * @param title 작품 제목입니다.
     * @param kind 앱의 콘텐츠 분류입니다.
     * @param publishStatus 게시 상태입니다.
     */
    public record WorkRow(long id, String slug, String title, String kind, String publishStatus) { }

    /**
     * 입력 화면의 DB 자료입니다.
     * @param authors 저자 목록입니다.
     * @param genres 장르 목록입니다.
     * @param categories 카테고리 목록입니다.
     * @param works 작품 목록입니다.
     */
    public record Catalog(List<@NonNull Lookup> authors, List<@NonNull Lookup> genres,
            List<@NonNull Lookup> categories, List<@NonNull WorkRow> works) { }

    private record StoredWork(long id, String contentType, String slug, String title,
            @Nullable String description, @Nullable String imageUrl, @Nullable LocalDate publishedAt,
            @Nullable String publisher, @Nullable String fileFormat, @Nullable Integer pageCount) { }
}
