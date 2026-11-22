-- 회원이 같은 주제의 게시판을 동시에 만들어도 하나만 유지합니다.
-- WORK의 name은 NULL이므로 기존 uk_board_book이 작품별 중복을 제한합니다.
ALTER TABLE board
    ADD CONSTRAINT uk_board_type_name UNIQUE (type, name);
