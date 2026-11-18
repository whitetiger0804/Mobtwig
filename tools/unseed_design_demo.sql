-- 저장소 루트에서 node tools/db-seed.mjs unseed로 실행합니다.
-- 시드 식별자와 후속 참조를 확인하며, 공용 분류와 AUTO_INCREMENT 번호는 보존합니다.
DROP PROCEDURE IF EXISTS undo_mobtwig_design_demo_20261106;
DELIMITER $$
CREATE PROCEDURE undo_mobtwig_design_demo_20261106()
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    START TRANSACTION;
    -- CASCADE 자식은 FK가 삭제를 막지 않으므로 새로 추가한 행을 먼저 검사합니다.
    IF NOT EXISTS (SELECT 1 FROM member WHERE id = 81001 AND email = 'design.booki@mobtwig.test')
       OR EXISTS (SELECT 1 FROM post_image WHERE post_id BETWEEN 81001 AND 81008 AND id <> 81001)
       OR EXISTS (SELECT 1 FROM post_sticker WHERE post_id BETWEEN 81001 AND 81008 AND id <> 81001)
       OR EXISTS (SELECT 1 FROM post_comment_sticker WHERE comment_id BETWEEN 81001 AND 81014
           AND id NOT IN (81001,81002))
       OR EXISTS (SELECT 1 FROM chapter_media WHERE book_id BETWEEN 81001 AND 81016 AND id <> 81001)
       OR EXISTS (SELECT 1 FROM book_author WHERE book_id BETWEEN 81001 AND 81016
           AND id NOT BETWEEN 81001 AND 81016)
       OR EXISTS (SELECT 1 FROM book_category WHERE book_id BETWEEN 81001 AND 81016
           AND id NOT IN (81002,81003,81004,81005,81006,81007,81009,81010,81011,81012,81013))
       OR EXISTS (SELECT 1 FROM book_genre WHERE book_id BETWEEN 81001 AND 81016
           AND id NOT IN (81001,81008,81014,81015,81016))
       OR EXISTS (SELECT 1 FROM purchase r JOIN purchase_product p ON p.id=r.product_id
           WHERE p.book_id BETWEEN 81001 AND 81016)
       OR EXISTS (SELECT 1 FROM purchase_product WHERE book_id BETWEEN 81001 AND 81016
           AND NOT ((chapter_id IS NULL AND id=book_id) OR (chapter_id IS NOT NULL AND id=chapter_id))) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '시드 식별자 불일치 또는 후속 구매/첨부/관계로 제거를 취소했습니다. 반복 테스트는 로컬 DB 초기화 후 재시딩하십시오.';
    END IF;
    DELETE FROM post_reaction WHERE id BETWEEN 810101 AND 810805 AND post_id BETWEEN 81001 AND 81008;
    DELETE FROM post_comment_sticker WHERE id IN (81001, 81002) AND comment_id IN (81001, 81014);
    DELETE FROM post_comment WHERE id BETWEEN 81001 AND 81014 AND post_id BETWEEN 81001 AND 81008;
    DELETE FROM post_image WHERE id = 81001 AND post_id = 81006;
    DELETE FROM post_sticker WHERE id = 81001 AND post_id = 81007;
    DELETE FROM post WHERE id BETWEEN 81001 AND 81008;
    DELETE FROM board WHERE id BETWEEN 81001 AND 81016 AND book_id BETWEEN 81001 AND 81016;
    DELETE FROM review_comment WHERE id BETWEEN 81001 AND 81004;
    DELETE FROM review WHERE id BETWEEN 810101 AND 811610 AND book_id BETWEEN 81001 AND 81016;
    DELETE FROM member_wiki_range WHERE id = 81001 AND member_id = 81001;
    DELETE FROM wiki_entry WHERE id BETWEEN 81001 AND 81008 AND book_id = 81001;
    DELETE FROM chapter_media WHERE id = 81001 AND book_id = 81004;
    DELETE FROM highlight WHERE id BETWEEN 81001 AND 81004 AND member_id = 81001;
    DELETE FROM bookmark WHERE id BETWEEN 81001 AND 81004 AND member_id = 81001;
    DELETE FROM recent_view WHERE id BETWEEN 81001 AND 81008 AND member_id = 81001;
    DELETE FROM reading_progress WHERE id BETWEEN 81001 AND 81016 AND member_id = 81001;
    DELETE FROM library_book WHERE id BETWEEN 81001 AND 81016 AND member_id = 81001;
    DELETE FROM wishlist WHERE ((id BETWEEN 810101 AND 811607) OR (id IN (819002,819005,819009,819017)))
        AND book_id BETWEEN 81001 AND 81016 AND member_id BETWEEN 81001 AND 81030;
    DELETE FROM book_stat_daily WHERE id BETWEEN 810010 AND 810166 AND book_id BETWEEN 81001 AND 81016;
    DELETE FROM book_author WHERE id BETWEEN 81001 AND 81016 AND book_id BETWEEN 81001 AND 81016;
    DELETE FROM book_category WHERE id IN (81002,81003,81004,81005,81006,81007,81009,81010,81011,81012,81013)
        AND book_id BETWEEN 81001 AND 81016;
    DELETE FROM book_genre WHERE id IN (81001,81008,81014,81015,81016) AND book_id BETWEEN 81001 AND 81016;
    DELETE FROM purchase_product WHERE book_id BETWEEN 81001 AND 81016
        AND ((chapter_id IS NULL AND id=book_id) OR (chapter_id IS NOT NULL AND id=chapter_id));
    -- 해당 회차의 chapter_text_version만 FK CASCADE로 함께 제거합니다.
    -- 다른 회원의 독서·책갈피·하이라이트가 참조하면 RESTRICT로 전체 작업을 롤백합니다.
    DELETE FROM chapter WHERE id BETWEEN 81001001 AND 81016156 AND book_id BETWEEN 81001 AND 81016;
    DELETE FROM book WHERE id BETWEEN 81001 AND 81016;
    DELETE FROM author WHERE id BETWEEN 81001 AND 81016;
    DELETE FROM member_reading_setting WHERE id IN (81001, 81002) AND member_id IN (81001,81002);
    DELETE FROM member WHERE id BETWEEN 81001 AND 81030;
    COMMIT;
END$$
DELIMITER ;
CALL undo_mobtwig_design_demo_20261106();
DROP PROCEDURE undo_mobtwig_design_demo_20261106;
