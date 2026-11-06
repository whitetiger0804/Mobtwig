-- 홈과 작품 상세 API의 응답 계약을 검증하는 데이터입니다.
-- example.test 이미지 주소는 계약 검증용이며 실제 이미지 파일을 제공하지 않습니다.

INSERT INTO author (id, name) VALUES
    (-9201, '둘째 저자'),
    (-9202, '첫째 저자');

INSERT INTO genre (id, name, display_order) VALUES
    (-9301, '계약검증 판타지', 20),
    (-9302, '계약검증 문학', 10);

INSERT INTO category (id, name, display_order) VALUES
    (-9351, '계약검증 교육', 10),
    (-9352, '계약검증 문학', 5);

INSERT INTO book (
    id, content_type, slug, title, description, cover_image_url,
    published_date, publisher, file_format, page_count, volume_label,
    publish_cycle, publish_status, average_rating, view_count
) VALUES
    (-9101, 'BOOK', 'test-book', '계약 검증 도서', '한글 도서 소개입니다.',
     'https://example.test/book.png', '2000-01-01', '검증 출판사', 'EPUB',
     240, NULL, NULL, 'PUBLISHED', 4.25, 17),
    (-9102, 'MAGAZINE', 'test-magazine', '계약 검증 매거진', '한글 매거진 소개입니다.',
     'https://example.test/magazine.png', '2000-01-01', '검증 편집부', 'PDF',
     64, '2026년 11월호', 'MONTHLY', 'PUBLISHED', 3.50, 7),
    (-9103, 'WEBNOVEL', 'test-novel', '계약 검증 웹소설', '한글 웹소설 소개입니다.',
     'https://example.test/novel.png', '2001-01-01', '검증 출판사', 'HTML',
     NULL, NULL, NULL, 'PUBLISHED', 0.00, 2),
    (-9104, 'BOOK', 'test-hidden', '숨긴 검증 작품', '숨긴 작품입니다.',
     'https://example.test/hidden.png', '2002-01-01', '검증 출판사', 'EPUB',
     NULL, NULL, NULL, 'HIDDEN', 0.00, 0),
    (-9105, 'BOOK', 'test-draft', 'test 초안 작품', '작성 중인 작품입니다.',
     'https://example.test/draft.png', '2002-01-01', '검증 출판사', 'EPUB',
     NULL, NULL, NULL, 'DRAFT', 0.00, 0);

INSERT INTO book_author (id, book_id, author_id) VALUES
    (-9401, -9101, -9201),
    (-9402, -9101, -9202),
    (-9403, -9102, -9201),
    (-9404, -9103, -9202);

INSERT INTO book_genre (id, book_id, genre_id) VALUES
    (-9451, -9101, -9301),
    (-9452, -9101, -9302),
    (-9453, -9103, -9301),
    (-9454, -9103, -9302);

INSERT INTO book_category (id, book_id, category_id) VALUES
    (-9501, -9101, -9351),
    (-9502, -9101, -9352),
    (-9503, -9102, -9351),
    (-9504, -9102, -9352);

INSERT INTO chapter (
    id, book_id, chapter_no, title, published_at, char_count,
    category_label, start_page, content_url
) VALUES
    (-9601, -9101, 2, '두 번째 목차', '2000-02-01 00:00:00', 120,
     NULL, NULL, 'https://example.test/book-2.html'),
    (-9602, -9101, 1, '첫 번째 목차', '2000-01-01 16:00:00', 0,
     NULL, NULL, 'https://example.test/book-1.html'),
    (-9603, -9101, 3, '예약 회차', CURRENT_TIMESTAMP + INTERVAL 1 DAY, 30,
     NULL, NULL, 'https://example.test/book-3.html'),
    (-9604, -9101, 4, '비공개 회차', NULL, 30,
     NULL, NULL, 'https://example.test/book-4.html'),
    (-9605, -9102, 1, '매거진 첫 기사', '2000-01-01 16:00:00', 0,
     '문화', 3, 'https://example.test/magazine-1.pdf'),
    (-9606, -9103, 1, '웹소설 1화', '2001-01-01 16:00:00', 3500,
     NULL, NULL, 'https://example.test/novel-1.html');
