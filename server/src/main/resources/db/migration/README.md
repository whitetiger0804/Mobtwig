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
| `V7__create_member_policy_consent.sql` | 인증 | `member_policy_consent` (1개) |
| `V8__version_reading_progress.sql` | 독서 활동 | `reading_progress` revision·본문 해시 |
| `V9__version_bookmark_text.sql` | 독서 활동 | `bookmark` 본문 해시 |
| `V10__version_highlight_text.sql` | 독서 활동 | `highlight` 본문 해시 |
| `V11__normalize_policy_consent.sql` | 인증 | 약관 원문을 종류·버전별로 보관하고 동의 이력에서 참조 |
| `V12__bind_reading_positions_to_text_version.sql` | 독서 활동 | 회차·버전별 `chapter_text_version`과 버전으로 검증한 위치 표시 |
| `V13__create_demo_purchases.sql` | 구매 | `purchase_product`, `purchase` (2개) |
| `V14__create_work_subscription.sql` | 독서 활동 | 웹소설 구독 `work_subscription` |
| `V15__create_review_engagement.sql` | 리뷰 | 리뷰·댓글 공감 `review_like`, 신고 접수 `review_report` (2개) |
| `V16__unique_named_community_boards.sql` | 커뮤니티 | 게시판 종류·이름별 중복 제한 |
| `V17__add_community_spoiler_flags.sql` | 커뮤니티 | 게시글·댓글의 스포일러 표시와 기존 표시 이관 |

V15는 리뷰 또는 리뷰 댓글 중 정확히 한 대상을 참조하고 회원·대상별 중복을 UNIQUE로 막습니다. 댓글을 실제 삭제하면 그 댓글의 공감·신고는 FK CASCADE로 정리하며 회원·리뷰 FK는 RESTRICT입니다. 리뷰 삭제는 기존 V4의 soft delete를 유지하고 남은 댓글을 보존합니다. 신고는 최초 사유·상세를 보존하는 접수만 제공하며 별도의 심사·자동 숨김 컬럼이나 공감 수 캐시는 추가하지 않습니다.

V16은 게시판 `(type, name)`의 유일성을 추가하며 작품별 게시판은 기존 `uk_board_book` 제약을 유지합니다. V17은 게시글·댓글에 `has_spoiler`를 추가하고 기존 회차 지정 스포일러 표시를 이관합니다. 다음 스키마 변경에는 V18 이후를 사용합니다.

공통 기준은 `snake_case`, `utf8mb4`, `BIGINT AUTO_INCREMENT` PK, `{참조테이블}_id` FK, UTC `TIMESTAMP`입니다.

SQL 파일 이름은 `V<순번>__<설명>.sql` 형식을 사용합니다. 이미 적용한 파일은 수정하지 않고 다음 버전 파일로 변경합니다. Flyway가 스키마 변경을 담당하며, Hibernate 자동 DDL이나 Python의 `create_all()`로 별도 구조를 생성하지 않습니다.
