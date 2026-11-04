# DB 마이그레이션

기준 문서는 `docs/테이블 정의서.md`입니다. 현재 마이그레이션 파일은 다음과 같습니다.

| 파일 | 영역 | 테이블 |
|---|---|---|
| `V1__create_member_and_content.sql` | 회원·콘텐츠 | `member`, `member_reading_setting`, `author`, `genre`, `category`, `book`, `chapter`, `book_author`, `book_genre`, `book_category` (10개) |
| `V2__create_auth_tables.sql` | 인증 | `password_reset_token`, `SPRING_SESSION`, `SPRING_SESSION_ATTRIBUTES` (3개) |
| `V3__create_reading_records.sql` | 독서 활동 | `library_book`, `wishlist`, `reading_progress`, `recent_view`, `bookmark`, `highlight` (6개) |
| `V4__create_review_and_stats.sql` | 리뷰·통계 | `review`, `review_comment`, `book_stat_daily` (3개) |
| `V5__create_wiki.sql` | 설정집 | `wiki_entry`, `member_wiki_range` (2개) |
| `V6__create_media_and_community.sql` | 미디어·커뮤니티 | `chapter_media`, `board`, `post`, `post_image`, `sticker`, `post_sticker`, `post_comment`, `post_comment_sticker`, `post_reaction`, `post_report` (10개) |

V7 이후는 정의서의 '추가 기능 후보'를 확정한 뒤 추가합니다.

공통 기준은 `snake_case`, `utf8mb4`, `BIGINT AUTO_INCREMENT` PK, `{참조테이블}_id` FK, UTC `TIMESTAMP`입니다.

SQL 파일 이름은 `V<순번>__<설명>.sql` 형식을 사용합니다. 이미 적용한 파일은 수정하지 않고 다음 버전 파일로 변경합니다. Flyway가 스키마 변경을 담당하며, Hibernate 자동 DDL이나 Python의 `create_all()`로 별도 구조를 생성하지 않습니다.
