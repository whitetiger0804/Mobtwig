# Mobtwig HTTP API 명세서

## 작품 찜·웹소설 구독 (#139)

활성 회원은 `GET /api/members/works/{slug}/state`로 자신의 `favorite`, `subscribed` 상태를 조회합니다. `PUT`과 `DELETE`를 같은 경로의 `/state` 대신 `/favorite` 또는 `/subscription`에 보내면 등록과 해제를 처리하고 현재 상태를 반환합니다. 변경에 회원 세션과 CSRF 토큰이 필요합니다. 반복 등록·해제도 같은 상태로 완료됩니다. 찜은 공개 도서·매거진·웹소설에, 구독은 공개 웹소설에 적용합니다. 도서·매거진의 구독 상태는 항상 false입니다.

`GET /api/members/favorites?page=1&size=20`은 본인의 공개 찜 목록을 저장 시각과 ID의 내림차순으로 반환합니다. `page`는 1부터, `size`는 1~50이며 생략 시 위 기본값을 사용합니다. 응답은 `items`, `page`, `hasNext`입니다. 각 항목은 공개 작품 slug인 `id`, `title`, `imageUrl`, `kind`를 포함하며 일치하는 작품이 없으면 빈 배열입니다.

성공 응답은 200이며 캐시하지 않습니다. 입력 오류와 웹소설 이외 구독 변경은 400, 인증 실패는 401, CSRF 실패는 403, 없는 작품과 미공개 작품은 404입니다. 구독은 현재 작품 단위 상태입니다. 회차 알림은 알림 기능에서 다룹니다.

클라이언트가 Java 소스를 읽지 않고 HTTP 요청을 작성할 수 있도록 현재 구현한 계약을 설명합니다. 필드별 타입·필수 여부·최대 길이의 정본은 [OpenAPI 명세](../server/src/main/resources/static/openapi.yaml)입니다. 클래스·메서드의 역할은 기존 Javadoc에서 확인합니다.

이 문서와 명세를 포함한 커밋이 배포된 서버를 기준으로 합니다. 같은 주소라도 이전 버전의 서버에는 새 경로가 없을 수 있습니다. 서버 실행·배포 절차는 [배포 안내](배포%20안내.md)를 참고합니다.

후속 본문·독서 기록 API의 식별자·표시 텍스트·UTF-16 offset·매거진 쪽 번호·개정 시 처리 기준은 [본문·독서위치 규약 v1](본문·독서위치%20규약.md)(#18)을 따릅니다. 해당 문서의 논리 필드 예시는 현재 HTTP API에 추가된 경로/응답이 아니며, 후속 구현 시 OpenAPI에 반영합니다.

## 공유 작품 웹 안내 · #63~#65

`GET /s/works/{slug}`는 로그인 없이 모바일 웹 안내 HTML(`text/html`)을 제공합니다. slug는 영문 소문자·숫자·하이픈 1~120자입니다. 형식이 맞으면 HTML은 200이며 작품의 존재·공개 여부는 브라우저에서 기존 `GET /works/{slug}`를 쿠키 없이 한 번 조회해 확인합니다. 상세 조회의 기존 조회수 집계가 적용되며 자동 폴링은 하지 않습니다. 실패한 조회는 사용자가 재시도할 수 있습니다. 상세 404는 공개 작품 없음, 기타 통신·응답 오류는 재시도 안내로 표시합니다.

HTML은 `Cache-Control: no-store`, `Referrer-Policy: no-referrer`와 CSP를 사용하며 JavaScript·CSS·API는 같은 origin에서 읽습니다. `GET /share/app.js`, `GET /share/work.js`, `GET /share/style.css`, `GET /share/header.png`는 공개 정적 자원입니다. 제목·저자는 DOM 텍스트로 표시하고 표지 주소는 HTTP(S) 또는 서버 기준 절대 경로를 검증하여 사용합니다. query의 제목·문장·이동 주소를 HTML에 삽입하지 않습니다.

앱의 공유 origin은 `EXPO_PUBLIC_SHARE_BASE_URL`이며 기본값은 `https://mobtwig.xn--3h3b098b.kro.kr`입니다. 안내 페이지의 앱 열기는 `mobtwig://works/{slug}`를 사용합니다. 설치 배포 주소가 없어 ‘설치 준비 중’으로 표시하며, 설치 후에는 같은 공유 링크를 다시 열도록 안내합니다. HTTPS OS 자동 연결의 서명·도메인 검증 설정과 실제 설치 전후 검증은 추후 확인 대상입니다.

## 하이라이트 · #40

`GET /api/members/highlights`는 본인의 기록을 저장 시각과 ID 내림차순으로 반환합니다. 선택적 `workId`는 작품 slug이며 `chapterId`는 단독으로도 지정할 수 있습니다. `page`는 1부터 시작하고 응답은 최대 30건의 `items`, `page`, `hasNext`입니다.

`POST /api/members/highlights`에 `workId`, 문자열 `chapterId`, 정수 `startOffset`·`endOffset`, `contentVersion`, `contentHash`, `color`를 보냅니다. 색은 `YELLOW` 또는 `GREEN`입니다. 텍스트는 UTF-16 끝 제외 범위와 표시 원문의 SHA-256을 쓰며, 매거진은 같은 기사에 속하는 양 끝 포함 쪽 범위와 null 해시를 씁니다. 버전·해시·구간이 모두 같으면 기존 기록과 색을 반환합니다. 개정된 본문의 같은 좌표는 새 기록으로 저장하며 이전 기록은 재확인 상태로 보존합니다.

항목은 `id`, `state`, `workId`, `workTitle`, `kind`, `chapterTitle`, `range`, `color`, `snippet`, `createdAt`을 반환합니다. `range`에는 `chapterId`, `startOffset`, `endOffset`, `unit`, `contentVersion`, `contentHash`가 있습니다. `available`의 텍스트 발췌는 서버 원문에서 최대 500 UTF-16 단위로 생성합니다. `stale`은 재확인이 필요한 기록으로 발췌는 null입니다. 비공개 또는 현재 미소장 유료 기록은 `hidden`으로 ID와 저장 시각, 상태만 제공하며 나머지 필드는 null입니다. 숨겨진 본인 기록도 삭제할 수 있습니다.

`DELETE /api/members/highlights/{id}`는 본인 기록을 삭제하고 204를 반환합니다. 없는 ID와 타인 소유 ID는 동일한 404입니다. 변경 요청에는 회원 CSRF가 필요합니다. 입력 오류는 400, 인증 오류는 401, 미소장 유료 자료 저장은 402, CSRF 실패는 403, 공개 범위 밖은 404, 버전·해시 변경은 409입니다. 유효한 본문 해시를 알고 있어도 소장 권한 없이는 발췌를 생성하지 않습니다. 본문 공급 상태에 따라 415 또는 503을 반환합니다. 기록에서 본문을 여는 것만으로 이어보기 진도를 갱신하지 않습니다.

## 책갈피 · #39

`GET /api/members/bookmarks?page=1&workId={slug}`는 회원 본인의 기록을 저장 시각과 ID 내림차순으로 최대 30건 반환합니다. 두 쿼리 값은 생략할 수 있습니다. 응답은 `items`, `page`, `hasNext`입니다.

`POST /api/members/bookmarks`에 `workId`, 문자열 `chapterId`, 정수 `offset`, `contentVersion`을 보냅니다. 텍스트는 표시 본문의 시작, 문단 시작 또는 끝을 UTF-16으로 전송합니다. 매거진은 호 기준 쪽을 씁니다. 예전 앱의 `contentHash`도 선택적으로 받습니다. 성공과 같은 좌표의 재요청 모두 200에 기존 또는 새 기록을 반환합니다. 이전 버전 기록을 갱신하려면 직접 삭제한 뒤 다시 저장합니다.

항목은 `id`, `state`, `workId`, `workTitle`, `kind`, `chapterTitle`, `position`, `snippet`, `createdAt`을 포함합니다. `available`은 이동 가능한 위치이며, `stale`은 본문을 다시 확인해야 하는 저장 위치입니다. 비공개 또는 현재 미소장 유료 자료의 `hidden` 항목은 본인 삭제에 필요한 ID와 저장 시각만 표시하며 작품·회차 정보와 원문은 null입니다. 매거진과 재확인 상태에서는 발췌문을 제공하지 않습니다.

`DELETE /api/members/bookmarks/{id}`는 본인 기록을 삭제하면 204를 반환합니다. 없는 ID와 타인 소유 ID는 동일한 404입니다. POST와 DELETE는 같은 회원 세션의 CSRF를 사용합니다. 잘못된 입력은 400, 미인증은 401, CSRF 실패는 403, 비공개 회차와 타 작품 회차는 404, 본문 변경은 409입니다. 본문 제공 실패는 415 또는 503입니다. 책갈피 읽기·쓰기와 책갈피를 통한 진입은 읽기 진도를 변경하지 않습니다.

## 구매 · #102

구매 기록과 소장 권한을 관리합니다. 도서·매거진은 작품 전체를 소장하고 웹소설은 회차별로 소장합니다. 구매 취소·환불 기능은 제공하지 않습니다. 클라이언트의 기존 작품 상세·구매 내역·서재·리더에서 이 API를 사용합니다.

| 요청 | 인증·역할 | 처리 |
| --- | --- | --- |
| `POST /api/admin/works/{slug}/purchase-products` | 관리자 세션·CSRF입니다. | 상품 가격을 설정합니다. 같은 작품·회차는 갱신합니다. |
| `GET /works/{slug}/purchase-products` | 공개 조회입니다. | 공개된 상품 목록입니다. 비회원 기준이므로 `owned`는 false입니다. |
| `GET /api/members/works/{slug}/purchase-products` | 활성 회원 세션입니다. | 본인의 `owned`·`readable`을 포함한 상품 목록입니다. |
| `POST /api/members/purchases` | 활성 회원 세션·CSRF입니다. | 구매와 서재 등록을 한 트랜잭션에서 처리합니다. |
| `GET /api/members/purchase-history` | 활성 회원 세션입니다. | 본인의 구매 내역이며 없으면 200과 `[]`입니다. |
| `GET /api/members/purchases/{purchaseId}` | 활성 회원 세션입니다. | 본인의 구매 한 건을 반환합니다. 타인의 기록은 404입니다. |
| `GET /api/members/works/{slug}/chapters/{chapterId}` | 활성 회원 세션입니다. | 소장 권한을 검사한 텍스트 본문입니다. 무료 회차도 조회할 수 있습니다. |
| `GET /api/members/works/{slug}/magazine` | 활성 회원 세션입니다. | 공개 호·기사 목록입니다. 본문은 포함하지 않습니다. |
| `GET /api/members/works/{slug}/magazine/pages/{pageNumber}?contentVersion={contentVersion}` | 활성 회원 세션입니다. | 소장 권한·공개 기사·버전을 검사한 PNG입니다. |

### 상품 설정과 구매 요청

관리자는 기존 관리자 로그인 뒤 상품을 설정합니다. `{slug}`는 작품 slug이며 `chapterId`는 공개 목차의 회차 ID입니다. 아래 본문은 자리표시자 템플릿이므로 `{price}`를 0 이상의 정수로 바꿉니다. 도서·매거진의 `chapterId`는 명시적인 null이며, 웹소설은 `"{chapterId}"`로 지정합니다. 두 필드를 모두 보내며 추가 필드는 허용하지 않습니다.

```text
POST /api/admin/works/{slug}/purchase-products
{
  "chapterId": null,
  "price": {price}
}
```

상품의 `productId`를 구매 요청에 사용합니다. `price`는 원 단위 가격이며 0~2147483647입니다. 상품 미설정·0원은 기존처럼 무료 열람합니다. 웹소설의 미공개·예약 회차 상품은 공개 목록에서 제외하고 구매도 404로 거부합니다.

회원은 상품 조회에서 가격을 확인한 뒤 새 구매용 UUID `requestId`를 생성해 다음 세 필드를 전송합니다. 금액을 임의로 지정해도 서버의 상품 가격과 다르면 구매하지 않습니다. 회원 ID·구매 성공 여부·잔액은 요청으로 받지 않습니다.

```text
POST /api/members/purchases
{
  "productId": "{productId}",
  "expectedPrice": {price},
  "requestId": "{requestId}"
}
```

최초 구매 성공은 **201**, 같은 회원이 같은 `requestId`·상품·가격으로 재시도하면 같은 구매를 **200**으로 반환합니다. 네트워크 실패 후 재시도할 때는 `requestId`를 유지합니다. 새 UUID로 이미 소장한 상품을 다시 구매하면 409 `ALREADY_OWNED`, 같은 UUID를 다른 상품·가격에 재사용하면 409 `REQUEST_CONFLICT`입니다. 가격 변경은 409 `PRICE_CHANGED`입니다. 잘못된 입력은 400, 미인증은 본문 없는 401, CSRF 실패는 403, 비공개·타 작품 회차·없는 상품은 404, 서버 오류는 5xx입니다. 구매 API의 업무 오류는 `{ "code": "고정 코드", "message": "안내" }`입니다.

### 내역·서재·열람

구매 결과와 내역 항목은 #102의 `workId`, `kind`, `title`, `imageUrl`, `purchasedAt`에 `purchaseId`, `productId`, `chapterId`, `chapterTitle`, `price`, `currency`, `paymentMode`를 더합니다. 웹소설은 회차마다 내역 한 건이므로 목록의 고유 키에는 `purchaseId`를 사용하고 작품 상세 이동에는 `workId`를 사용합니다. 도서·매거진의 회차 필드는 null입니다. 제목·표지·가격·회차 제목은 **구매 시점의 값**입니다. 이후 작품 수정·숨김·가격 변경에도 내역은 유지합니다. 구매 시각(UTC ISO) 내림차순이며 같은 시각은 구매 ID 내림차순입니다. 개수 제한은 없으며 모든 구매 응답은 `Cache-Control: no-store`입니다.

```json
[
  {
    "purchaseId": "1", "productId": "1", "workId": "sample-book", "kind": "book",
    "title": "예시 도서", "imageUrl": "/media/covers/sample-book.png",
    "purchasedAt": "2026-11-14T00:00:00Z", "chapterId": null, "chapterTitle": null,
    "price": 3000, "currency": "KRW", "paymentMode": "DEMO"
  }
]
```

처음 구매한 작품은 기존 `library_book`에 `WANT_TO_READ`로 등록합니다. 이미 서재에 있으면 독서 상태·즐겨찾기·숨김을 보존합니다. 여러 회차를 구매해도 서재는 작품당 한 건입니다. 구매나 내역 조회는 조회수·최근 본 작품·읽기 위치를 변경하지 않습니다.

**유료 본문은 회원 전용 `/api/members/works/...` 경로로 요청합니다.** 기존 회원 쿠키의 경로는 `/api`이므로 기존 공개 `/works/...` 본문 경로에서는 구매자도 인증하지 않으며, 유료 상품은 401 `PURCHASE_REQUIRED`입니다. 회원 경로에서 미소장 상품은 402 `PURCHASE_REQUIRED`입니다. 클라이언트는 로그인 상태에서 회원 본문 경로를 사용하며, 비회원 무료 열람에는 기존 공개 경로를 사용합니다. 텍스트 응답·매거진 PNG 형식과 본문 버전 검증은 기존 규약을 유지합니다. 작품 상세·목차·상품·호 정보는 계속 공개 조회할 수 있지만, 구매했더라도 숨김 작품·미공개 회차는 열람할 수 없습니다. 유료 자료의 새 읽기 위치·책갈피 저장에도 소장 권한이 필요합니다.

### 로컬 반복 검증

서버를 실행하면 Flyway V13이 상품·구매 테이블을 생성하며 기존 작품은 자동으로 유료화하지 않습니다. 개발용 `node tools/db-seed.mjs seed`는 기존 시드 16종의 상품 491개와 본문도 준비하므로 별도의 관리자 상품 설정 없이 회원 로그인 → 상품 조회 → 구매 → 내역·서재·회원 본문 조회 순서로 검증합니다. 기본 가격은 도서 5,000원·매거진 3,000원·웹소설 첫 화 무료 및 이후 100원이며, 기존에 설정한 가격은 보존합니다. 다른 작품의 상품은 관리자 API로 설정합니다. 테스트를 반복할 때는 로컬 DB를 초기화하고 서버 실행으로 테이블을 다시 만든 뒤 자료를 재시딩합니다. 단순 서버·컨테이너 재시작은 구매 기록을 지우지 않으며 DB를 초기화하면 구매 기록도 함께 삭제됩니다.

## 읽기 위치 · #38

`GET /api/members/works/{slug}/reading-progress`와 같은 경로의 `POST`는 활성 회원 본인의 저장 기록에만 접근합니다. POST는 같은 회원 세션의 CSRF 토큰을 사용합니다. GET은 조회수·진도·서재를 변경하지 않습니다.

두 메서드의 200 응답은 `workId`(slug), `kind`, `state`, `position`, `revision`, `lastReadAt`, `chapterPercent`, `workPercent`, `maxChapterId`, `libraryStatus`, `hasNewChapters`를 반환합니다. 위치는 `chapterId`, `offset`, `unit`(`utf16` 또는 `page`), `contentVersion`, `contentHash`를 포함합니다.

- `new`는 이력이 없으며 첫 공개 회차 시작을 제안합니다. `saved`는 복원 가능한 저장 위치입니다. `stale`은 이전 위치의 버전·해시·공개 범위가 바뀌었거나 검증할 수 없음을 뜻합니다. 기존 회차가 공개 상태이고 읽을 수 있으면 그 시작, 아니면 읽을 수 있는 첫 공개 회차 시작을 제안합니다. 읽을 위치가 없으면 `position`은 null입니다.
- revision은 저장본의 십진 문자열이며 최초에는 null입니다. POST JSON은 `chapterId`, 정수 `offset`, `contentVersion`, `expectedRevision`(최초에는 null)을 보냅니다. `contentHash`는 예전 앱과 호환하는 선택 필드입니다. 매거진은 생략 또는 null을 사용합니다. 성공 응답의 revision과 UTC 저장 시각은 서버가 부여합니다.

텍스트의 해시 없는 쓰기는 해당 버전의 본문을 API에서 먼저 받아야 합니다. 서버가 회차·버전에 고정한 원문과 현재 파일이 다르면 본문 조회와 저장에서 409, 기존 기록 조회에서 재확인 상태를 반환합니다. 정상 텍스트 위치 응답에는 기존 앱이 사용할 해시를 제공합니다. 새 기록은 좌표와 버전을 저장하며 기존 기록의 해시는 재검증에 사용합니다.
- 잘못된 좌표는 400, 미인증은 401, CSRF 실패는 403, 비공개/타 작품 회차는 404입니다. 409의 `code`는 `PROGRESS_CONFLICT` 또는 `CONTENT_CHANGED`입니다. 충돌 시 기존 기록은 유지되며 GET으로 다시 확인합니다. 선택 회차의 파일을 제공할 수 없으면 415 또는 503입니다.
- 진행률은 0~100의 소수점 둘째 자리까지이며 산정 불가는 null입니다. 텍스트는 원문과 같은 UTF-16 길이를 사용합니다. 작품 전체 계산은 한 조회의 공개 본문을 최대 64회차·합계 200만 UTF-16 단위까지 검증하며 한도를 넘거나 자료를 확인할 수 없으면 null입니다. 매거진은 아티클 쪽 범위와 호 전체 쪽 수로 계산합니다. 끝 쪽 수가 없는 경우 해당 진행률은 null입니다.
- 마지막 정상 위치·시각·최고 도달 회차·서재 상태를 한 트랜잭션에서 반영합니다. 마지막 공개 회차의 비어 있지 않은 본문 끝, 또는 마지막 공개 아티클의 호 끝 쪽에서 완독으로 저장합니다. 재독은 마지막 위치를 바꾸되 최고 도달 회차를 보존합니다. 매거진 PNG는 아래 공개 쪽 API에서 제공합니다.

일반 열람은 본문·PNG가 실제로 표시된 뒤 최초 위치를 저장하고, 실제 스크롤·쪽 이동부터 현재 위치를 자동 저장합니다. 책갈피·하이라이트로 이동한 것만으로는 기존 진도·최고 회차를 덮어쓰지 않습니다. 실제 독서를 시작하지 않은 기록 위치에서 바로 다음 회차로 가면 기존 회차를 완독 처리하지 않고 새 회차의 정상 최초 위치만 저장합니다. 일반 열람이나 기록 진입 후 실제 스크롤·쪽 이동을 시작한 상태에서는 다음 회차로 갈 때 현재 회차 끝을 저장합니다. 본문 개정의 복구 후보는 사용자 재확인 전까지 저장을 보류합니다. 정상 상태에는 별도의 위치 저장 버튼이나 저장 완료 문구를 표시하지 않으며 실패·충돌 시에만 재확인과 재시도를 제공합니다. 화면의 회차 진행 막대는 현재 스크롤 비율이며 서버의 작품 전체 진행률과 구분합니다.

## 작품 리뷰 · #138

공개 리뷰·평점, 본인 리뷰 수정·삭제, 댓글 작성·수정·삭제, 리뷰와 댓글의 공감·신고 접수를 제공합니다. 신고는 접수만 하며 관리자 심사·자동 숨김·이미지 첨부·추가 정렬은 현재 계약 범위에 포함하지 않습니다.

`slug`는 공개 작품에서 받은 식별자를 사용합니다. `reviewId`·`commentId`와 응답의 숫자 ID는 문자열이며 `^-?[1-9][0-9]{0,18}$` 형식과 signed BIGINT 범위(-9223372036854775808~9223372036854775807)를 함께 검사합니다. 0·선행 0·범위 초과는 400입니다. 회원 ID는 요청으로 받지 않고 활성 `MEMBER_SESSION`에서 확인합니다. 회원 GET에는 CSRF가 필요하지 않으며 모든 POST·PUT·DELETE는 같은 세션의 `X-CSRF-TOKEN`이 필요합니다.

| 메서드·경로 | 정상 응답과 동작 |
| --- | --- |
| `GET /works/{slug}/reviews?page={page}&size={size}` | 200 공개 리뷰 페이지입니다. 인증 쿠키를 보내도 회원별 플래그는 모두 `false`, `myReview`는 `null`입니다. |
| `GET /api/members/works/{slug}/reviews?page={page}&size={size}` | 200 회원별 상태와 페이지 밖의 본인 활성 리뷰도 함께 반환합니다. |
| `POST /api/members/works/{slug}/reviews` | 201 새 리뷰입니다. 작품별 회원당 활성 리뷰는 한 건이며 중복 등록은 409입니다. |
| `PUT /api/members/reviews/{reviewId}` | 200 수정된 본인 활성 리뷰입니다. ID와 작성 시각은 유지합니다. |
| `DELETE /api/members/reviews/{reviewId}` | 204이며 본문은 없습니다. soft delete 후 재작성하면 새 ID를 발급하며 남은 댓글을 새 리뷰로 옮기지 않습니다. |
| `GET /reviews/{reviewId}/comments` | 200 공개 스레드 `{review, items}`입니다. 회원별 플래그는 모두 `false`입니다. |
| `GET /api/members/reviews/{reviewId}/comments` | 200 현재 회원의 상태를 포함한 스레드입니다. |
| `POST /api/members/reviews/{reviewId}/comments` | 201 새 댓글입니다. 삭제 부모에는 신규 댓글을 작성할 수 없습니다. |
| `PUT /api/members/review-comments/{commentId}` | 200 수정된 본인 댓글입니다. ID와 작성 시각은 유지합니다. |
| `DELETE /api/members/review-comments/{commentId}` | 204이며 본문은 없습니다. 댓글을 실제 삭제하고 해당 댓글의 공감·신고는 FK CASCADE로 정리합니다. |
| `PUT /api/members/reviews/{reviewId}/like` | 200 `{likeCount, liked: true}`입니다. 반복 요청도 중복 없이 200입니다. |
| `DELETE /api/members/reviews/{reviewId}/like` | 200 `{likeCount, liked: false}`입니다. 기존 공감이 없어도 같은 상태를 반환합니다. |
| `PUT /api/members/review-comments/{commentId}/like` | 200 댓글 공감 수와 `liked: true`입니다. 반복 등록은 중복 없이 처리합니다. |
| `DELETE /api/members/review-comments/{commentId}/like` | 200 댓글 공감 수와 `liked: false`입니다. 기존 공감이 없어도 200입니다. |
| `POST /api/members/reviews/{reviewId}/reports` | 최초 201, 중복은 기존 신고 ID로 200 `{id, reported: true}`입니다. |
| `POST /api/members/review-comments/{commentId}/reports` | 최초 201, 중복은 기존 신고 ID로 200 `{id, reported: true}`입니다. |

리뷰 페이지의 `page`는 1부터 시작하고 생략하면 1입니다. `size`는 1~50이며 기본 20입니다. 빈 값·정수가 아닌 값·범위 밖·동일 매개변수의 중복은 400입니다. `items`는 활성 리뷰와 댓글이 한 개 이상 남은 삭제 리뷰 자리표시를 `createdAt`·리뷰 ID 내림차순으로 반환합니다.

200 페이지는 `{averageRating, reviewCount, ratingDistribution, items, hasNext, totalItems, myReview}`입니다. `reviewCount`와 `ratingDistribution`의 `"1"`~`"5"`는 페이지와 관계없이 전체 활성 리뷰만 집계하며 별점만 남긴 리뷰도 포함합니다. `averageRating`은 소수 둘째 자리까지 반올림하고 활성 리뷰가 없으면 `null`입니다. 이때 DB의 `book.average_rating`은 NOT NULL 캐시이므로 `0.00`입니다. `totalItems`와 `hasNext`는 삭제 자리표시를 포함한 표시 항목 기준이므로 평가 수와 표시 항목 수가 다를 수 있습니다. 활성 리뷰가 없어도 남은 댓글이 있으면 `items`는 비어 있지 않을 수 있습니다. 회원 경로의 `myReview`는 현재 페이지와 관계없이 조회한 본인 활성 리뷰이며 없으면 `null`입니다.

| 응답 항목 | 필드 |
| --- | --- |
| 리뷰 | `id: string`, `rating: integer 또는 null`, `body: string 또는 null`, `nickname: string 또는 null`, `createdAt: UTC ISO 8601`, `commentCount: integer`, `likeCount: integer`, `mine: boolean`, `liked: boolean`, `reported: boolean`, `deleted: boolean`입니다. |
| 댓글 | `id: string`, `body: string`, `nickname: string`, `createdAt: UTC ISO 8601`, `likeCount: integer`, `mine: boolean`, `liked: boolean`, `reported: boolean`입니다. |
| 스레드 | `review`는 원문 카드 또는 삭제 자리표시이며 `items`는 `createdAt`·댓글 ID 오름차순의 전체 댓글 배열입니다. 별도 페이지 제한은 없습니다. |

삭제 자리표시는 `deleted: true`, `rating/body/nickname: null`, `mine/liked/reported: false`이며 ID·작성 시각·댓글 수·공감 수만 보존합니다. 알려진 삭제 리뷰의 스레드는 댓글이 0개여도 조회할 수 있습니다. 부모 삭제 후에도 남은 댓글의 본인 수정·삭제와 타인 댓글 공감·신고는 허용하지만 신규 댓글은 404입니다. 작품이 비공개이면 스레드 조회와 모든 변경이 404입니다. 탈퇴 회원의 활성 리뷰·댓글은 `nickname: "탈퇴한 회원"`으로 표시하며 활성 평점 집계에도 계속 포함합니다.

리뷰 작성·수정 JSON은 `{rating, body?}`입니다. `rating`은 JSON 정수 1~5가 필수이며 `1.0` 같은 소수 표기와 문자열은 거부합니다. `body`는 선택이며 생략·`null`·공백뿐인 값은 별점만 남깁니다. 양끝 유니코드 공백을 제거한 뒤 최대 1,000 코드 포인트이며 내부 줄바꿈·공백은 유지합니다. PUT에서 `body`를 생략하면 기존 본문을 유지하는 대신 `null`로 바꿉니다. 댓글 작성·수정 JSON은 `{body}`이며 같은 공백 정규화 후 1~500 코드 포인트입니다. `null`·공백뿐인 댓글·타입 오류·추가 필드는 400입니다.

공감 등록·해제는 본문 없이 요청하며 회원별 대상당 한 건만 저장합니다. 본인 리뷰·댓글에 공감하거나 공감을 해제하거나 신고하면 400입니다. 삭제 리뷰 자체에 대한 반응은 404입니다. 신고 JSON은 `{reason, detail?}`이며 `reason`은 `SPAM`, `ABUSE`, `INAPPROPRIATE`, `SPOILER`, `OTHER` 중 하나입니다. 선택 `detail`은 공백 정규화 후 최대 500 코드 포인트이며 생략·`null`·공백은 `null`로 저장합니다. 같은 회원·대상의 중복 신고도 입력 형식은 검증하며 최초 사유·상세를 변경하지 않습니다. 신고 응답은 본인 신고 ID와 `reported: true`만 제공하고 사유·상세·다른 사람의 신고 여부·신고 수를 노출하지 않습니다. 목록의 `reported`도 현재 회원의 신고 여부만 나타냅니다.

입력·ID 형식·본인 반응 오류는 400, 미인증은 401, CSRF 누락·불일치는 403, 비공개·없는 대상·타인 작성물 수정삭제·삭제 리뷰 자체의 수정삭제와 반응은 404, 활성 리뷰 중복 등록은 409입니다. 업무 오류는 `{ "message": "안내" }`이며 401·403은 본문이 없습니다. 리뷰·댓글 처리 응답은 `Cache-Control: no-store`를 사용합니다. 목록·스레드는 동일 스냅샷으로 읽고, 리뷰 작성·수정·삭제와 평점 재집계는 작품 행 잠금 안에서 함께 처리합니다. 댓글과 공감·신고 변경도 같은 작품 잠금 순서를 지킵니다. 조회수·읽기 위치·독서 진행률은 변경하지 않습니다.

## 내 서재 목록 · #119

`GET /api/members/library?kind={kind}`는 활성 회원 본인의 서재 목록을 반환합니다. `{kind}`에는 `all`, `book`, `magazine`, `novel`을 지정하며 생략하면 `all`입니다. 빈 값·미지원 값·중복 지정은 400이며 미인증은 401입니다. 회원 ID는 요청으로 받지 않고 `MEMBER_SESSION`에서 확인합니다. GET에는 CSRF 토큰이 필요하지 않습니다.

응답은 `id`(작품 slug), `title`, `author`, `imageUrl`, `kind`, `libraryStatus`, `lastReadChapterNumber`, `statistics`, `hasNextChapter`의 배열입니다. `libraryStatus`는 `WANT_TO_READ`, `READING`, `COMPLETED` 중 하나이며 화면의 최근 열람 회차와는 별도 상태입니다. `author`는 저자 ID 순서로 쉼표로 연결한 표시 이름입니다. 표지는 DB에 저장한 HTTP(S) 주소 또는 API 서버 기준 절대 경로를 그대로 반환하며 클라이언트가 현재 서버 주소를 기준으로 해석합니다.

`lastReadChapterNumber`는 본인이 마지막으로 저장한 현재 공개 회차의 실제 번호입니다. 기록이 없거나 저장 회차가 삭제·비공개이면 `null`이며 회차 ID나 최고 도달 회차로 대체하지 않습니다. 웹소설 서재는 이 값으로 `최근 본 화: {lastReadChapterNumber}화`를 표시합니다. `statistics`는 웹소설의 `{views, recommendations, chapterCount}`이며 도서·매거진은 `null`입니다. `chapterCount`는 현재 공개된 회차 수입니다. `hasNextChapter`는 유효한 저장 회차보다 뒤에 공개 회차가 있는지 나타내며, 기록이 없으면 `false`입니다. 이어보기와 다음 회차 이동 시에는 기존 작품 상세·독서 위치 API에서 최신 위치와 공개 목차를 확인합니다.

- 구매와 읽기 위치 저장은 각각 같은 트랜잭션에서 `library_book`을 등록·갱신합니다. 최초 구매는 `WANT_TO_READ`이며 정상 독서 위치를 저장하면 `READING` 또는 `COMPLETED`가 됩니다. 상세 화면을 열거나 최근 본 작품만 기록한 경우에는 서재에 추가하지 않습니다.
- 서재에 담은 시각(`created_at`) 내림차순, 같은 시각이면 서재 ID 내림차순으로 전체 결과를 반환합니다. 개수 제한은 없으며 다시 읽어도 처음 담은 순서는 바뀌지 않습니다. 작품 종류 필터는 정렬 전에 적용합니다.
- 본인의 `is_hidden=true`인 항목과 전역 비공개 작품은 제외하되 DB 기록은 유지합니다. 즐겨찾기 여부는 조회 대상에 영향을 주지 않습니다. 일치하는 작품이 없으면 200과 `[]`를 반환합니다.
- `Cache-Control: no-store`를 사용하며 조회수·최근 본 작품·읽기 위치·서재를 변경하지 않습니다. 공개 작품의 필수 정보가 잘못되면 500을 반환하며 해당 작품을 조용히 누락하지 않습니다.

서재 화면은 도서·매거진을 3열 표지 목록으로, 웹소설을 최근 본 회차와 이어보기·다음화보기 카드로 표시합니다. 별도 담기·즐겨찾기·숨기기 변경 API는 이번 서버 조회 범위에 포함하지 않습니다.

## 최근 본 작품 · #110

`GET /api/members/recent-works`는 활성 회원 본인이 최근 본 공개 작품을 최근 본 순서로 최대 20개 반환합니다. 기록이 없으면 빈 배열입니다. 각 항목은 `id`(작품 slug), `title`, `imageUrl`, `kind`(`book`, `novel`, `magazine`), `lastReadAt`(UTC ISO 시각, 예: `2026-01-02T03:04:05Z`)입니다.

`POST /api/members/recent-works/{slug}`는 요청 본문 없이 같은 회원 세션의 CSRF 토큰을 보내며, 성공하면 본문 없는 204를 반환합니다. 같은 작품을 다시 열면 행을 추가하지 않고 최근 본 시각만 갱신합니다. 두 요청 모두 `Cache-Control: no-store`를 사용하며 조회수·읽기 위치·서재를 변경하지 않습니다.

- 비공개 작품은 목록에서 제외합니다. 기록은 유지되므로 다시 공개되면 목록에 다시 나타납니다. 공개 작품의 제목·표지 등 필수 정보가 잘못되면 홈·상세와 같이 오류를 반환하며 해당 항목을 조용히 누락하지 않습니다.
- 시각은 초 단위로 저장합니다. 같은 초에 연 작품 사이의 순서는 보장하지 않습니다.
- 미인증은 본문 없는 401, CSRF 실패는 403, 조회되는 공개 작품이 없으면 404 `NOT_FOUND`입니다.

홈과 최근 본 전용 화면은 `RecentWorksProvider`의 같은 목록을 표시합니다. 회원 목록은 위 API로 조회·기록하며 저장 실패를 메모리 기록으로 대체하지 않습니다. 비회원 기록은 현재 인증 범위의 메모리에 최대 20개를 보관합니다. 로그인·로그아웃·회원 변경 시 목록을 초기화하며 비회원 기록을 회원 DB로 자동 합치지 않습니다.

## 매거진 쪽 열람 · #38

| 요청 | 200 응답 |
| --- | --- |
| `GET /works/{slug}/magazine` | `{workId, title, pageCount, articles}`. 기사별 `chapterId, title, startPage, endPage, contentVersion`을 쪽 순으로 반환합니다. |
| `GET /works/{slug}/magazine/pages/{pageNumber}?contentVersion={version}` | 해당 공개 기사 버전의 호 전체 기준 PNG 한 쪽입니다. |

두 요청은 공개 매거진 호에만 접근하며 진도·조회수를 변경하지 않습니다. 비공개 기사는 표시 목록에서 빠지지만 앞 기사의 끝 쪽 계산에는 반영됩니다. 쪽 번호와 버전은 양의 32비트 정수입니다. 잘못된 입력은 400, 공개 범위 밖이거나 매거진이 아니면 404, 버전이 바뀌면 409, 쪽 수·범위 또는 PNG를 확인할 수 없으면 503입니다. 응답은 `Cache-Control: no-store`를 사용합니다. 미확정 쪽 수 자료의 기존 위치 API 동작은 유지되며 공개 PNG 뷰어에는 호 전체 쪽 수가 필요합니다.

PNG 등록 규칙은 [매거진 PNG 콘텐츠 등록](매거진%20PNG%20콘텐츠%20등록.md)을 따릅니다. 회원의 저장은 별도의 회원 위치 API를 사용합니다.

## 문서와 접속 주소

| 용도 | 주소와 사용 방법 |
| --- | --- |
| PC 브라우저의 로컬 API | `http://localhost:8080`을 사용합니다. |
| Android 에뮬레이터의 로컬 API | `http://10.0.2.2:8080`을 사용합니다. |
| 운영 API | `https://mobtwig.xn--3h3b098b.kro.kr`을 사용합니다. |
| Swagger UI | 해당 API 서버의 `/api-docs/index.html`에 접속합니다. |
| OpenAPI 원본 | 해당 API 서버의 `/openapi.yaml`에서 받습니다. Postman 등 OpenAPI를 지원하는 도구에도 불러올 수 있습니다. |
| 관리자 입력 화면 | 해당 API 서버의 `/admin`에 접속합니다. |

Swagger UI는 자신을 제공한 서버에 요청합니다. 관리자 POST 요청마다 CSRF 토큰을 자동으로 받으며, 로그인 응답의 쿠키는 브라우저가 관리합니다. `Authorize` 창에 쿠키나 토큰을 직접 붙여 넣지 않아도 됩니다. 먼저 `POST /api/admin/login`을 실행하고 `GET /api/admin/session`의 200 응답으로 권한을 확인합니다. 사용을 마치면 `POST /api/admin/logout`을 실행합니다.

`Try it out`의 등록·공개·계정 생성 요청은 해당 서버의 실제 DB를 변경합니다. 문서의 계정·자료는 예시이며 이미 존재하는 자료라는 뜻은 아닙니다. 실제 비밀번호와 세션 쿠키는 저장소나 요청 예제에 기록하지 않습니다.

## 공통 요청·응답 규칙

- JSON API에는 `Accept: application/json`을 사용합니다.
- JSON을 보내는 POST에는 `Content-Type: application/json`을 사용합니다.
- 로그인만 `application/x-www-form-urlencoded`로 `username`, `password`를 보냅니다.
- 201 응답에는 생성한 식별자가 있으며, 204 응답에는 본문이 없습니다. 204에 `response.json()`을 호출하지 않습니다.
- 작품 발행일은 `YYYY-MM-DD`, 회차 공개 시각은 `2026-01-01T00:00:00Z`처럼 UTC 또는 오프셋을 포함한 ISO 8601 문자열입니다.
- 공개 작품 상세의 선택 필드는 값이 null이면 생략합니다. 관리자 입력의 선택 필드에는 명세에 따라 null을 보낼 수 있습니다.
- 표지·배너·본문 주소는 HTTP(S) 또는 `/`로 시작하는 API 서버 기준 경로입니다. `/images/cover.jpg`는 `new URL(imageUrl, apiBase).toString()`으로 절대 주소로 바꿀 수 있습니다.
- 등록 API는 파일을 업로드하지 않습니다. 입력한 주소의 실제 파일 제공은 별도로 준비해야 합니다.
- HTTP 성공 여부를 먼저 확인합니다. 401 등 보안 응답에는 본문이 없을 수 있으므로 모든 실패 응답을 곧바로 JSON으로 해석하지 않습니다.

## API 목록

| 메서드 | 경로 | 인증·조건 | 정상 응답 |
| --- | --- | --- | --- |
| GET | `/works?query={query}&kind={kind}&genre={genre}` | 공개 조회이며 query가 필수이고 kind·genre는 선택 사항입니다. | 200 작품 검색 결과 배열입니다. |
| GET | `/sdui/home?kind={kind}` | 공개 조회이며 kind가 필수입니다. | 200 홈 SDUI입니다. |
| GET | `/works/{slug}` | 공개 작품만 조회합니다. | 200 작품 상세입니다. |
| GET | `/s/works/{slug}` | 공개 공유 안내이며 브라우저가 기존 상세 API로 작품을 확인합니다. | 200 HTML 안내입니다. |
| GET | `/share/{file}` | 공유 안내의 JavaScript·CSS·로고를 제공합니다. | 200 정적 파일입니다. |
| GET | `/works/{slug}/reviews?page={page}&size={size}` | 공개 작품의 활성 리뷰와 댓글이 남은 삭제 자리표시를 최신순으로 조회합니다. | 200 전체 활성 평점 요약과 표시 페이지입니다. |
| GET | `/api/members/works/{slug}/reviews?page={page}&size={size}` | 활성 회원 세션이 필요합니다. | 200 회원별 상태·본인 활성 리뷰를 포함한 페이지입니다. |
| POST | `/api/members/works/{slug}/reviews` | 회원 세션과 CSRF가 필요합니다. 별점은 필수이며 본문은 선택입니다. | 201 새 리뷰입니다. |
| PUT | `/api/members/reviews/{reviewId}` | 회원 세션과 CSRF로 본인 활성 리뷰만 수정합니다. | 200 수정된 리뷰입니다. |
| DELETE | `/api/members/reviews/{reviewId}` | 회원 세션과 CSRF로 본인 활성 리뷰만 삭제 처리합니다. | 204이며 본문은 없습니다. |
| GET | `/reviews/{reviewId}/comments` | 공개 작품의 스레드를 조회하며 삭제 부모도 자리표시로 반환합니다. | 200 `{review, items}`입니다. |
| GET | `/api/members/reviews/{reviewId}/comments` | 활성 회원 세션이 필요합니다. | 200 회원별 상태를 포함한 스레드입니다. |
| POST | `/api/members/reviews/{reviewId}/comments` | 회원 세션과 CSRF로 활성 리뷰에 댓글을 작성합니다. | 201 새 댓글입니다. |
| PUT | `/api/members/review-comments/{commentId}` | 회원 세션과 CSRF로 본인 댓글만 수정합니다. | 200 수정된 댓글입니다. |
| DELETE | `/api/members/review-comments/{commentId}` | 회원 세션과 CSRF로 본인 댓글을 실제 삭제합니다. | 204이며 본문은 없습니다. |
| PUT·DELETE | `/api/members/reviews/{reviewId}/like` | 회원 세션과 CSRF로 타인 활성 리뷰의 공감을 등록·해제합니다. | 200 `{likeCount, liked}`입니다. |
| PUT·DELETE | `/api/members/review-comments/{commentId}/like` | 회원 세션과 CSRF로 타인 댓글의 공감을 등록·해제합니다. | 200 `{likeCount, liked}`입니다. |
| POST | `/api/members/reviews/{reviewId}/reports` | 회원 세션과 CSRF로 타인 활성 리뷰의 신고를 접수합니다. | 최초 201, 중복 200 `{id, reported}`입니다. |
| POST | `/api/members/review-comments/{commentId}/reports` | 회원 세션과 CSRF로 타인 댓글의 신고를 접수합니다. | 최초 201, 중복 200 `{id, reported}`입니다. |
| GET | `/works/{slug}/chapters/{chapterId}` | 공개 작품의 공개된 회차만 조회합니다. | 200 텍스트 본문·목차·회차 이동 정보입니다. |
| GET | `/api/members/recent-works` | 활성 회원 세션이 필요합니다. | 200 최근 본 공개 작품 최대 20개입니다. |
| GET | `/api/members/library?kind={kind}` | 활성 회원 세션이 필요하며 kind는 선택 사항입니다. | 200 본인의 분류별 서재 목록입니다. |
| POST | `/api/members/recent-works/{slug}` | 회원 세션과 CSRF가 필요하며 본문은 없습니다. | 204이며 본문은 없습니다. |
| GET | `/api/auth/csrf` | 회원 인증 영역의 익명 CSRF 세션을 사용합니다. | 200 현재 세션의 CSRF 토큰입니다. |
| GET | `/api/admin/csrf` | 로그인 전에도 호출합니다. | 200 CSRF 토큰입니다. |
| POST | `/api/admin/login` | 같은 세션의 CSRF 토큰과 폼을 보냅니다. | 204이며 본문은 없습니다. |
| POST | `/api/admin/logout` | 같은 세션의 CSRF 토큰을 보냅니다. | 204이며 본문은 없습니다. |
| GET | `/api/admin/session` | 활성 ADMIN 계정의 세션이 필요합니다. | 200 관리자 정보입니다. |
| GET | `/api/admin/catalog` | 활성 ADMIN 계정의 세션이 필요합니다. | 200 저자·분류·작품 목록입니다. |
| POST | `/api/admin/accounts` | ADMIN 세션과 CSRF가 필요합니다. | 201 `{ "id": 1 }`입니다. |
| POST | `/api/admin/authors` | ADMIN 세션과 CSRF가 필요합니다. | 201 `{ "id": 1 }`입니다. |
| POST | `/api/admin/genres` | ADMIN 세션과 CSRF가 필요합니다. | 201 `{ "id": 1 }`입니다. |
| POST | `/api/admin/categories` | ADMIN 세션과 CSRF가 필요합니다. | 201 `{ "id": 1 }`입니다. |
| POST | `/api/admin/works` | ADMIN 세션과 CSRF가 필요합니다. | 201 `{ "id": 1, "slug": "sample-book" }`입니다. |
| POST | `/api/admin/works/{id}/chapters` | ADMIN 세션과 CSRF가 필요합니다. | 201 `{ "id": 1 }`입니다. |
| POST | `/api/admin/works/{id}/status` | ADMIN 세션과 CSRF가 필요합니다. | 204이며 본문은 없습니다. |
| GET | `/actuator/health/readiness` | 공개 조회입니다. | 200 `{ "status": "UP" }`입니다. |

일반 회원용 토큰 인증은 제공하지 않습니다. 커뮤니티를 포함한 회원 기능은 문서에 명시한 쿠키 세션을 사용하며, 커뮤니티의 별도 경로와 작성 규칙은 다음 절을 따릅니다.

## 커뮤니티

작품별·주제별·작품 홍보 게시판과 게시글·댓글, 이미지·이모티콘·임시저장, 게시글 공감·신고를 제공합니다. 작품 리뷰에 달리는 댓글과 별개이며 웹소설 회차 댓글 API가 아닙니다. 기존 `board`, `post`, `post_comment` 등의 테이블을 사용합니다.

### 조회와 인증

| 요청 | 응답과 동작 |
| --- | --- |
| `GET /community/boards?type=work&query=` | 200 `{items, stickers}`입니다. `type`은 `work`, `topic`, `promotion`이며 기본값은 `work`입니다. `query`로 게시판 이름을 부분 검색합니다. |
| `GET /community/works?query=&page=1&size=20` | 200 `{items, page, size, totalItems, hasNext}`입니다. 제목·저자·출판사로 공개 작품을 검색하며 빈 검색어이면 전체 작품입니다. 각 항목은 `{work, boardId}`이고 게시판이 없으면 `boardId=null`입니다. |
| `GET /community/works/{slug}/chapters` | 200 `{items}`입니다. 스포일러 선택에 사용할 공개 회차를 반환하며 작품 조회수를 올리지 않습니다. |
| `GET /community/posts` | 200 `{items, page, size, totalItems, hasNext}`입니다. 공개 게시글을 게시 시각·ID 내림차순으로 반환합니다. |
| `GET /community/posts/{postId}` | 200 게시글 한 건입니다. `reveal=true`로 해당 글의 스포일러를 확인할 수 있습니다. |
| `GET /community/posts/{postId}/comments` | 200 `{items, page, size, totalItems, hasNext}`입니다. 댓글을 작성 시각·ID 오름차순으로 반환합니다. |
| `GET /api/members/community/...` | 위 여섯 조회의 회원 경로입니다. 게시글·댓글에는 활성 회원의 `mine`, `liked`, `reported` 상태를 포함합니다. |
| `GET /api/members/community/posts?mine=true` | 본인이 게시한 `PUBLISHED`·`HIDDEN` 글을 조회합니다. `DRAFT`·`DELETED`는 포함하지 않습니다. |

공개 경로는 비회원 기준이며 `mine`, `liked`, `reported`는 false입니다. 회원 조회에는 `MEMBER_SESSION` 쿠키를 사용하며 GET에 CSRF는 필요하지 않습니다. 변경 요청은 같은 회원 세션으로 받은 `X-CSRF-TOKEN`이 필요합니다. 관리자 세션을 회원 세션으로 사용할 수 없습니다. 커뮤니티 JSON과 첨부 PNG 응답은 `Cache-Control: no-store`입니다.

게시글 목록의 선택 조건은 `boardId`, `type`, `head`, `query`, `mine`입니다. 없는 게시판이나 공개 범위 밖의 게시판으로 제한하면 200과 빈 목록을 반환합니다. `page`는 1~2147483647이며 기본 1, `size`는 1~50이며 기본 20입니다. `query`는 양끝 Unicode 공백 제거 후 최대 100자로 제목·본문을 부분 검색합니다. 본인이 아닌 스포일러 글은 검색 대상에서 제외하여 결과 유무로 원문이 노출되지 않게 합니다. 같은 쿼리 이름을 반복하거나 `true`·`false` 외의 불리언 값을 보내면 400입니다. 공개 경로의 `mine=true`는 401입니다.

작품 게시판과 연결 작품은 공개 상태여야 합니다. 비공개 작품의 게시글은 공개·내 글 목록에서 제외합니다. 공개 상세는 `PUBLISHED`만, 회원 상세는 본인의 `HIDDEN`도 조회합니다. 초안은 별도 경로로 읽으며 삭제 글은 조회할 수 없습니다.

게시판에는 문자열 `id`, `type`, `name`, `work`, `heads`, `latestPost`가 있습니다. `work`는 작품별 게시판에서만 존재하고 주제·홍보 게시판에서는 null입니다. 작품 요약은 `id`(slug), `title`, `author`, `imageUrl`, `kind`이며 저자 미등록은 빈 문자열입니다. 회차는 `id`, `number`, `title`입니다. 게시판·게시글·댓글·회차·이모티콘 ID는 signed BIGINT 범위의 십진 **문자열**이며 0·선행 0은 허용하지 않습니다.

`latestPost`는 게시판의 최신 공개글 한 건이며 없으면 null입니다. 필드는 `id`, `head`, `title`, `nickname`, `likeCount`, `commentCount`, `hasSpoiler`, `locked`입니다. 게시 시각·ID 내림차순으로 고르며 비공개 작품에 연결된 주제글은 제외합니다. 게시판 목록과 생성 응답 모두 공개 미리보기이므로 회원 경로도 `hasSpoiler=true`이면 `locked=true`, `title=null`을 반환합니다.

게시판·작품 검색의 `query`도 양끝 Unicode 공백 제거 후 최대 100자입니다. 작품 검색은 제목·ID 순서이며 `page`·`size`의 범위와 기본값은 게시글 목록과 같습니다. 검색 조회는 게시판을 생성하지 않습니다.

### 게시판 생성

활성 회원은 `POST /api/members/community/boards`로 게시판을 만듭니다. 회원 세션·CSRF가 필요하며 다음 둘 중 하나의 입력만 받습니다.

| 종류 | 입력 |
| --- | --- |
| 작품별 | `{"type":"work","workId":"sample-novel"}` |
| 주제별 | `{"type":"topic","name":"독서 모임"}` |

신규 생성은 201, 같은 작품 또는 같은 주제명의 게시판이 이미 있으면 200과 기존 게시판 객체를 반환합니다. 작품은 기존 공개 작품만 선택할 수 있으며 없는 작품·비공개 작품은 404입니다. 작품을 새로 등록하거나 공개할 때 게시판을 자동 생성하지 않습니다. 주제명은 양끝 Unicode 공백을 제거한 뒤 1~100자이고 중복은 DB collation 기준입니다. 작품별 중복은 `uk_board_book`, 주제명 중복은 V16의 `uk_board_type_name(type,name)`으로 제한합니다. 홍보 게시판을 만들거나 추가 필드를 보내면 400입니다.

### 게시글 작성·수정·삭제

| 요청 | 성공 응답 |
| --- | --- |
| `POST /api/members/community/posts` | 201 새로 게시한 본인 글입니다. 기존 서버 초안은 소비하거나 변경하지 않습니다. |
| `PUT /api/members/community/posts/{postId}` | 200 수정한 본인 글입니다. |
| `DELETE /api/members/community/posts/{postId}` | 204이며 본문은 없습니다. |

작성·수정은 다음 필드를 모두 보내며 추가 필드는 허용하지 않습니다. 아래 ID와 작품은 요청 형식을 보여 주는 예시이며 접속한 서버에 존재한다는 뜻은 아닙니다.

```json
{
  "boardId": "10",
  "workId": "sample-novel",
  "head": "IMPRESSION",
  "title": "두 번째 이야기를 읽고",
  "body": "이번 회차에서 인상적인 장면을 이야기합니다.",
  "spoilerChapterId": null,
  "hasSpoiler": true,
  "images": [],
  "stickerIds": []
}
```

| 게시판 | 말머리 | 연결 작품 |
| --- | --- | --- |
| `work` | `IMPRESSION`, `QUESTION`, `THEORY`, `FREE` | 게시판의 작품입니다. `workId=null`이면 해당 작품을 사용하며 다른 작품을 지정하면 400입니다. |
| `topic` | `STORY`, `QUESTION` | 선택입니다. 연결하지 않으면 `workId=null`입니다. |
| `promotion` | `PROMOTION` | 공개 작품을 반드시 지정합니다. 모든 활성 회원이 작성할 수 있으며 별도 작가 역할은 요구하지 않습니다. |

제목은 100자, 본문의 표시 텍스트는 10,000자 이하이며 인라인 이미지 표식을 포함한 전체 저장값은 25,000자 이하입니다. 등록된 첨부 URL과 일치하는 `![이미지](<URL>)` 표식만 URL별 첨부 개수만큼 최대 3개를 글자 수에서 제외합니다. 관리 이미지의 회원 접두사·`reveal` 차이와 목적지 퍼센트 인코딩을 인식하며 미등록·초과·잘못된 표식은 일반 텍스트로 계산합니다. 서버는 양끝 Unicode 공백을 제거하고 내부 공백·줄바꿈은 유지합니다. 길이는 Unicode 코드 포인트 기준이며 게시·수정에는 빈 제목·본문을 허용하지 않습니다. `hasSpoiler`는 스포일러 표시 토글이며 작품·회차 연결 없이도 true로 설정할 수 있습니다. 새 작성 화면은 `spoilerChapterId=null`을 보냅니다. 기존 회차 범위를 지정할 때는 연결 작품의 공개 회차여야 하며 `hasSpoiler=false`와 함께 지정할 수 없습니다. 이전 요청이 `hasSpoiler`를 생략한 경우에만 회차 지정 여부로 스포일러를 판단합니다.

게시글 응답은 `id`, `boardId`, `boardType`, `boardName`, `work`, `head`, `title`, `body`, `nickname`, `createdAt`, `updatedAt`, `publishedAt`, `status`, `spoiler`, `hasSpoiler`, `locked`, `mine`, `liked`, `reported`, `likeCount`, `commentCount`, `images`, `stickers`입니다. 시각은 UTC ISO 8601이며 탈퇴 회원은 `탈퇴한 회원`으로 표시합니다. `images` 항목은 `url`, `width`, `height`, `representative`이고 첫 이미지가 대표가 됩니다.

본인의 `PUBLISHED`·`HIDDEN` 글만 수정할 수 있으며 게시판·연결 작품·게시 시각·현재 공개 상태는 유지합니다. 타인의 글은 404입니다. 게시한 글을 삭제하면 `DELETED`로 변경하고 댓글·공감·신고 기록은 보존합니다. 삭제된 글과 그 댓글은 공개 조회되지 않습니다. 초안 삭제는 실제 삭제이며 이미 삭제된 게시글의 재삭제는 404입니다.

### 댓글과 스포일러 확인

| 요청 | 성공 응답 |
| --- | --- |
| `POST /api/members/community/posts/{postId}/comments` | 201 등록한 본인 댓글입니다. 같은 회원도 여러 개 작성할 수 있습니다. |
| `PUT /api/members/community/comments/{commentId}` | 200 수정한 본인 댓글입니다. 부모 글과 생성 시각은 유지합니다. |
| `DELETE /api/members/community/comments/{commentId}` | 204입니다. 본인 댓글과 연결 이모티콘을 실제 삭제합니다. |

댓글 작성·수정 입력은 `{body, spoilerChapterId, hasSpoiler, stickerIds}`이며 네 필드를 모두 보냅니다. `hasSpoiler`와 기존 회차 입력의 호환 규칙은 게시글과 같습니다. 본문은 양끝 공백 제거 후 2,000자 이하입니다. 본문이 null·빈 문자열·공백이면 이모티콘이 하나 이상 있어야 합니다. 일반 이미지는 댓글에 첨부하지 않습니다. 수정·삭제는 부모 글이 공개 상태일 때 본인 댓글에만 허용하며 타인의 댓글은 404입니다.

댓글 응답은 `id`, `postId`, `body`, `nickname`, `createdAt`, `updatedAt`, `spoiler`, `hasSpoiler`, `locked`, `mine`, `stickers`입니다. `spoiler`는 기존 회차 범위이므로 null이어도 `hasSpoiler=true`일 수 있습니다. 스포일러 확인은 다음처럼 분리합니다.

- 게시글 상세의 `reveal=true`는 해당 게시글을 엽니다. 확인 전에는 서버 응답에서도 `title`, `body`가 null이며 `images`, `stickers`는 빈 배열입니다.
- 댓글 목록의 `revealPost=true`는 부모 글만 확인합니다. 부모가 잠겨 있는데 이 확인 없이 댓글을 조회하면 403입니다.
- 댓글 목록의 `revealIds=21,22`는 해당 댓글만 엽니다. 최대 50개를 쉼표로 지정하고 중복 ID는 한 번으로 처리합니다. 선택하지 않은 댓글은 `body=null`, `stickers=[]`, `locked=true`로 유지합니다.
- 댓글 목록의 `reveal=true`는 부모 글과 해당 목록의 모든 댓글에 대한 확인으로 처리합니다. 개별 열람에는 `revealPost`·`revealIds`를 사용합니다.
- 본인 글·댓글은 자동으로 열립니다. 비회원도 명시적으로 확인할 수 있으며 확인 여부는 DB·독서 진도·구매 상태를 변경하지 않습니다.

### 이미지·이모티콘·임시저장

`POST /api/members/community/images`에 `{base64, mimeType}`을 JSON으로 보냅니다. `base64`에는 `data:` 접두사가 없어야 하며 `mimeType`은 `image/jpeg` 또는 `image/png`입니다. 업로드 전에 클라이언트에서 선택 원본(PNG·JPEG·WebP)을 JPEG·PNG로 변환하고 긴 변을 1024px 이하로 줄입니다. 서버는 디코딩 후 2MiB 이하인지, 실제 형식이 MIME과 일치하는지, 가로·세로가 각각 1~1024px인지 검사합니다. 부가 메타데이터를 제거한 PNG로 다시 인코딩하며 결과도 2MiB 이하여야 합니다.

성공은 201 `{url, width, height}`이며 `url`은 `/api/members/community/images/{owner}/{uuid}.png`입니다. 이 세 값을 게시글·초안 입력의 `images`에 넣습니다. 글당 최대 3장이고 다른 회원의 업로드·임의 외부 URL·파일 경로는 첨부할 수 없습니다. 본인 기존 글의 외부 이미지는 URL·치수를 그대로 보존할 수 있으며 새 업로드 제한을 과거 이미지에 소급 적용하지 않습니다.

이미지는 정적 공개 폴더 밖에 저장합니다. 개발 환경에서는 서버 작업 디렉터리의 `./community-images`를 사용하고, 배포 환경은 `COMMUNITY_IMAGE_ROOT=/app/community-images`와 `community_images` 명명 볼륨으로 컨테이너 교체 후에도 첨부를 유지합니다. 공개 글 응답에서는 `/community/images/{owner}/{uuid}.png` 경로로 반환하며, 스포일러 글의 이미지는 `?reveal=true`가 붙습니다. 공개 경로는 해당 이미지가 `PUBLISHED` 글에 연결되고 작품도 공개일 때만 200 PNG를 반환합니다. 스포일러 이미지는 확인이 필요합니다. 회원 소유자는 회원 경로로 본인 초안·미첨부 업로드도 읽을 수 있으나 다른 회원은 공개 범위 밖 이미지에 접근할 수 없습니다. 숨김·삭제로 더 이상 공개 글에서 사용되지 않는 이미지는 공개 경로에서도 읽을 수 없습니다.

이모티콘은 게시판 응답 `stickers`에서 받은 `id`를 `stickerIds`에 넣습니다. 글은 최대 8개, 댓글은 최대 4개이며 같은 이모티콘을 반복할 수 있습니다. 표시 정보는 `id`, `code`, `name`, `imageUrl`입니다. 정적 `/stickers/emote-wave.svg`, `/stickers/emote-cheer.svg`, `/stickers/emote-think.svg`, `/stickers/emote-thanks.svg`를 로그인 없이 읽을 수 있으며 별도 등록 API는 없습니다.

| 요청 | 임시저장 동작 |
| --- | --- |
| `GET /api/members/community/draft` | 본인 초안을 200 게시글 객체로 반환하며 없으면 204입니다. |
| `PUT /api/members/community/draft` | 게시글 입력과 같은 필드로 저장하고 200 초안을 반환합니다. 제목·본문은 빈 문자열을 허용합니다. |
| `DELETE /api/members/community/draft` | 본인 초안을 실제 삭제하고 204를 반환합니다. 초안이 없어도 204입니다. |

위 서버 초안 API는 기존 자료를 위해 유지합니다. 회원별 서버 초안은 하나이며 동시 저장도 회원 행을 잠가 같은 초안을 갱신합니다. 초안은 `status=DRAFT`, `publishedAt=null`이고 공개 목록·상세로 조회할 수 없습니다. 게시 요청은 항상 새 글을 만들며 기존 서버 초안은 보존합니다. 현재 클라이언트의 임시저장은 게시판별로 기기에 보관하고 위 초안 API를 호출하지 않습니다. 첨부 PNG 파일은 DB 행과 별도로 보관합니다.

#58 클라이언트 초안은 서버 주소·회원·게시판별 기기 로컬 한 개를 수동 저장하며 새 글 작성에서만 지원합니다. 저장·복원·삭제는 로컬 저장소에서 처리합니다. 초안을 불러오거나 이번 작성 화면에서 저장한 뒤 게시하면, 성공한 글과 연결된 저장 버전만 정리합니다. 게시 후 정리 실패는 게시 완료와 구분해서 안내하며 재시도는 삭제만 수행합니다. 새 글 쓰기로 남겨 둔 초안과 이후 저장된 다른 버전은 보존합니다. 현재 게시판에서 허용하지 않는 작품·말머리·이모티콘은 복원하지 않습니다. 상세 사용자 동작과 같은 JS 실행 환경에서의 경합 보호 범위는 [클라이언트 README](../client/README.md)의 #58 절을 따릅니다. 새 HTTP API·DB 마이그레이션은 추가하지 않습니다.

### 공감·신고와 오류

`PUT /api/members/community/posts/{postId}/like`는 공감, `DELETE`는 해제이며 본문 없이 요청합니다. 두 요청 모두 200 `{liked, likeCount}`입니다. 반복 요청은 같은 상태로 처리합니다. 본인 글 공감·해제는 400입니다.

`POST /api/members/community/posts/{postId}/reports`에는 `{reason, detail}`을 모두 보냅니다. 사유는 `SPAM`, `ABUSE`, `INAPPROPRIATE`, `SPOILER`, `OTHER`이며 상세는 양끝 공백 제거 후 최대 500자 또는 null입니다. 최초 접수는 201 `{id, reported:true}`, 동일 회원·글의 재접수는 같은 ID로 200이며 최초 사유·상세를 보존합니다. 본인 글 신고는 400이고 신고 원문은 다른 회원에게 공개하지 않습니다. 자동 숨김·심사 기능 및 댓글 공감·신고는 이번 계약에 포함하지 않습니다.

잘못된 입력·말머리·첨부·스포일러 회차 등은 400, 미인증은 401, CSRF 실패 또는 미확인 부모 스포일러의 댓글 조회는 403, 없는 대상·타인 수정/삭제·공개 범위 밖은 404입니다. 이미지 저장·읽기 실패는 500입니다. 커뮤니티 컨트롤러의 업무 오류는 `{message}` JSON이며 인증·CSRF 필터 오류에는 본문이 없을 수 있습니다. 계정·소유자 ID는 작성 입력으로 받지 않으며 서버 세션에서 결정합니다.

## 공개 작품 검색 · #104

`GET /works?query={query}&kind={kind}`로 제목·저자·출판사를 부분 검색합니다. `{query}`는 입력한 검색어이며 `{kind}`는 `all`, `book`, `magazine`, `novel` 중 선택한 작품 종류입니다. 중괄호는 자리 표시자이며 실제 요청에는 입력값을 넣습니다.

로그인은 필요하지 않습니다. `query`는 정확히 한 번 지정하며 앞뒤 공백을 제거한 뒤 1자 이상 200자 이하입니다. `kind`를 생략하면 `all`입니다. 선택적인 `genre`는 앞뒤 공백을 제거한 장르 이름이며 기존 검색어·종류와 AND로 결합합니다. 여러 번 지정하면 첫 번째 값을 사용합니다. 지정한 이름의 장르 연결이 없는 작품은 제외하고, 장르를 생략하면 무장르 작품도 포함합니다. 일치하는 장르가 없으면 빈 값이나 긴 값도 `200`과 `[]`를 반환하며 카테고리를 장르로 대체하지 않습니다. 빈 검색어·빈 종류·검색어 길이 초과·`query` 또는 `kind` 중복·지원하지 않는 종류는 400입니다.

검색어의 `%`, `_`, `!`, 쉼표는 문자 그대로 처리합니다. 공개 작품만 출간일·DB ID 내림차순으로 반환하며, 같은 작품의 여러 저자나 장르가 연결되어도 한 번만 반환합니다. 장르 이름의 `%`, `_`, `!`도 와일드카드로 해석하지 않습니다. 검색으로 조회수·최근 본 기록·읽기 위치가 변경되지는 않습니다.

```typescript
const parameters = new URLSearchParams({ query, kind });
// 장르를 제한할 때만 추가합니다.
parameters.set('genre', '판타지');
const response = await fetch(`${apiBase}/works?${parameters}`, {
  headers: { Accept: 'application/json' },
});
if (!response.ok) throw new Error(`작품 검색에 실패했습니다. HTTP ${response.status}`);
const works = await response.json();
```

결과는 다음 형태의 배열입니다. `id`는 상세 조회에 사용하는 slug이며 숫자 DB ID가 아닙니다. 결과가 없으면 `200`과 `[]`을 반환합니다. 제목·표지 등 공개 자료의 필수 정보가 잘못되면 `500`을 반환합니다.

```json
[
  { "id": "sample-book", "title": "과학을 읽는 시간", "imageUrl": "/images/cover.jpg", "kind": "book" }
]
```

## 공개 홈 조회

`kind`에는 `all`, `book`, `magazine`, `novel` 중 하나를 정확히 한 번 보냅니다. 누락·중복·지원하지 않는 값은 400입니다.

```javascript
const apiBase = 'http://10.0.2.2:8080';
const kind = 'book';
const homeResponse = await fetch(
  `${apiBase}/sdui/home?kind=${encodeURIComponent(kind)}`,
  { headers: { Accept: 'application/json' } },
);
if (!homeResponse.ok) throw new Error(`홈 조회에 실패했습니다. HTTP ${homeResponse.status}`);
const home = await homeResponse.json();
```

응답 예시입니다.

```json
{
  "version": 1,
  "sections": [
    {
      "id": "latest",
      "type": "workShelf",
      "title": "새로 공개한 작품",
      "items": [
        {
          "id": "sample-book",
          "title": "예시 도서",
          "imageUrl": "/images/cover.jpg"
        }
      ]
    }
  ]
}
```

`sections`와 `items`를 받은 순서대로 표시합니다. 서버가 `dataSource`로 DB 작품을 채운 구역은 공개 작품이 없으면 빈 `items`를 반환합니다. 빈 목록을 오류나 간이 데이터로 바꾸지 않습니다.

최근 본 구역은 `workShelf`에 `"contentSource": {"type":"recentWorks","kind":"all"}`을 지정하고 `items`는 빈 배열로 보냅니다. `kind`는 `all`, `book`, `magazine`, `novel` 중 하나입니다. 클라이언트는 공통 최근 본 목록을 해당 분류로 걸러 표시하며 제목이나 섹션 ID로 데이터 출처를 추측하지 않습니다. `dataSource`는 서버의 DB 조회 설정이고 `contentSource`는 응답에 포함되는 개인 목록 연결 정보입니다.

| 구역의 `type` | 항목의 필수값 | 선택값 |
| --- | --- | --- |
| `bannerCarousel` | `id`, `title`, `imageUrl`입니다. | `description`, `action`을 사용할 수 있습니다. |
| `workShelf` | `id`, `title`, `imageUrl`입니다. | `subtitle`을 사용할 수 있습니다. |
| `featuredWork` | `id`, `title`, `imageUrl`, `label`입니다. | `subtitle`, `action`을 사용할 수 있습니다. |
| `linkRow` | `id`, `label`, `route`입니다. | `icon`을 사용할 수 있습니다. |

각 구역에는 공통으로 `id`, `type`, `items`가 필요하며 `title`, `action`은 선택값입니다. 구역 ID는 응답 안에서, 항목 ID는 같은 items 안에서 고유해야 합니다.

`action`은 `{ "label": "검색합니다.", "route": { "screen": "search", "kind": "all" } }` 형식입니다. `screen`은 `home`, `search`, `library`, `recent`, `detail` 중 하나입니다. `detail`일 때만 `workId`를 포함하며 반드시 지정합니다. `linkRow`의 `icon`은 `bookmark`, `book`, `heart`, `library`, `search` 중 하나입니다.

기존 클라이언트의 [홈 응답 검사](../client/src/homeSchema.ts)에 JSON을 전달하여 계약을 확인할 수 있습니다.

## 공개 작품 상세 조회

홈 카드의 문자열 `id`를 slug로 사용합니다.

```javascript
const slug = 'sample-book';
const detailResponse = await fetch(`${apiBase}/works/${encodeURIComponent(slug)}`, {
  headers: { Accept: 'application/json' },
});
if (!detailResponse.ok) throw new Error(`상세 조회에 실패했습니다. HTTP ${detailResponse.status}`);
const detail = await detailResponse.json();
```

위 slug는 예시이므로 실제 홈 카드의 id로 교체합니다. 실제 화면에서는 빈 목록일 때 상세 이동을 만들지 않습니다.

```json
{
  "id": "sample-book",
  "kind": "book",
  "title": "예시 도서",
  "author": "예시 저자",
  "imageUrl": "/images/cover.jpg",
  "description": "문서의 예시 작품입니다.",
  "publisher": "예시 출판사",
  "publishedAt": "2026-01-01",
  "category": "판타지 · 장편",
  "fileFormat": "EPUB",
  "pageCount": 120,
  "contents": [
    {
      "id": "1",
      "title": "첫 번째 장",
      "publishedAt": "2026-01-01",
      "characterCount": 1500
    }
  ],
  "statistics": { "views": 0, "recommendations": 0, "rating": 0.00 }
}
```

- 조회되는 공개 작품이 없으면 404입니다. 응답의 slug에는 등록된 영문 소문자·숫자·하이픈을 사용합니다.
- `author`는 저자 이름을 `, `로 연결한 문자열이며, `category`는 장르·카테고리 이름을 ` · `로 연결한 문자열입니다.
- `contents`에는 공개 시각이 현재 이하인 회차만 회차 번호 순서로 포함합니다. 날짜는 Asia/Seoul 기준입니다.
- `pageCount`, `issue`, `publicationCycle`과 회차의 선택값은 null이면 생략합니다. 글자 수가 0이면 `characterCount`도 생략합니다.
- 정상 상세 조회에는 조회 수 집계가 발생합니다. 응답의 `statistics`는 해당 집계 직전에 읽은 값이므로 요청 후 DB 값과 1 차이가 날 수 있습니다.
- `contents`는 목차 정보입니다. 등록할 때 저장한 `contentUrl`이나 실제 본문 파일은 이 API에서 반환하지 않습니다.

기존 클라이언트의 [상세 응답 검사](../client/src/workDetails.ts)에서 지원하는 형식을 유지합니다.

## 관리자 로그인과 요청 작성

관리자 API의 브라우저 요청은 API와 같은 출처에서 사용합니다. 예를 들어 해당 서버의 관리자 화면이나 Swagger UI에서 실행합니다. 현재 공개 조회만 교차 출처 CORS를 허용하며, 임의의 다른 웹사이트에서 관리자 API를 호출하도록 설정하지 않았습니다.

인증 순서는 다음과 같습니다.

1. `GET /api/admin/csrf`를 호출하고 SESSION 쿠키를 보관합니다.
2. 응답의 `headerName`과 `token`을 헤더로 넣어 `POST /api/admin/login`을 호출합니다.
3. 로그인 성공 시 바뀐 SESSION 쿠키를 보관합니다. 이전 CSRF 토큰은 폐기합니다.
4. `GET /api/admin/session`이 200인지 확인합니다. 로그인 자체가 204여도 활성 ADMIN 권한이 없으면 관리자 API는 403입니다.
5. 변경 요청마다 현재 세션으로 CSRF 토큰을 다시 받아 전송합니다.
6. 사용을 마치면 CSRF를 포함한 `POST /api/admin/logout`을 호출합니다.

쿠키는 HttpOnly·SameSite=Strict이며, 운영 HTTPS에서는 Secure도 사용합니다. 세션은 비활동 30분에 만료됩니다. JWT나 Bearer 토큰은 사용하지 않습니다. 다른 HTTP 도구에서는 CSRF 조회·로그인·후속 요청 사이에 쿠키 저장소를 유지해야 합니다.

다음은 같은 출처의 브라우저에서 사용하는 요청 예시입니다. 계정 값은 발급받은 값으로 교체하고 소스에 저장하지 않습니다.

```javascript
const adminBase = window.location.origin;

async function adminRequest(path, options = {}) {
  const response = await fetch(`${adminBase}${path}`, {
    ...options,
    credentials: 'include',
    headers: { Accept: 'application/json', ...options.headers },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body}`);
  return response.status === 204 ? undefined : JSON.parse(body);
}

async function adminPost(path, body, isLogin = false) {
  const csrf = await adminRequest('/api/admin/csrf');
  return adminRequest(path, {
    method: 'POST',
    headers: {
      [csrf.headerName]: csrf.token,
      'Content-Type': isLogin ? 'application/x-www-form-urlencoded' : 'application/json',
    },
    body: isLogin ? new URLSearchParams(body) : JSON.stringify(body),
  });
}

await adminPost('/api/admin/login', {
  username: 'admin@example.com',
  password: '발급받은 비밀번호로 교체합니다.',
}, true);
const currentAdmin = await adminRequest('/api/admin/session');
```

## 자료 등록 예시

이후 예시는 앞의 `adminRequest`, `adminPost`를 사용합니다. 한 번 등록하는 흐름이며 같은 slug·장르를 다시 등록하면 409입니다. 요청 결과가 불확실하면 `/api/admin/catalog`에서 먼저 확인합니다.

### 저자·분류와 ID 조회

```javascript
const author = await adminPost('/api/admin/authors', {
  name: '예시 저자', bio: '문서의 예시 저자입니다.', field: '소설',
});
const genre = await adminPost('/api/admin/genres', { name: '예시 장르', displayOrder: 0 });
const category = await adminPost('/api/admin/categories', {
  name: '예시 분류', description: '문서의 예시 분류입니다.', displayOrder: 0,
});
const catalog = await adminRequest('/api/admin/catalog');
```

응답의 `authors`, `genres`, `categories`는 `{ "id": 1, "name": "예시 저자" }` 같은 항목의 배열입니다. 작품에는 `id`, `slug`, `title`, `kind`, `publishStatus`가 포함됩니다. 관계 ID는 이 목록이나 생성 응답에서 가져오며 임의의 숫자를 넣지 않습니다.

| 식별자 | 사용 위치 |
| --- | --- |
| 홈 카드·공개 상세의 문자열 `id` | `/works/{slug}`에 사용합니다. |
| 관리자 작품의 숫자 `id` | `/api/admin/works/{id}/chapters`, `/status`에 사용합니다. |
| 저자·분류의 숫자 `id` | `authorIds`, `genreIds`, `categoryIds` 배열에 사용합니다. |
| 공개 목차의 문자열 `id` | 회차 DB ID의 문자열 표현입니다. 작품 slug와 다릅니다. |

### 작품과 회차 생성

```javascript
const createdWork = await adminPost('/api/admin/works', {
  kind: 'book',
  slug: 'sample-book',
  title: '예시 도서',
  description: '문서의 예시 작품입니다.',
  imageUrl: '/images/cover.jpg',
  publishedAt: '2026-01-01',
  publisher: '예시 출판사',
  fileFormat: 'EPUB',
  pageCount: 120,
  serialStatus: 'COMPLETED',
  publishStatus: 'DRAFT',
  authorIds: [author.id],
  genreIds: [genre.id],
  categoryIds: [category.id],
  chapters: [{
    chapterNo: 1,
    title: '첫 번째 장',
    publishedAt: '2026-01-01T00:00:00Z',
    characterCount: 1500,
    contentUrl: '/content/sample-book/1.html',
  }],
});
```

201 응답은 `{ "id": 1, "slug": "sample-book" }` 형식입니다. 다음 조건을 확인합니다.

- `kind`는 `book`, `magazine`, `novel` 중 하나입니다.
- `serialStatus`는 `ONGOING`, `HIATUS`, `COMPLETED` 중 하나입니다.
- 최초 `publishStatus`는 `DRAFT` 또는 `PUBLISHED`입니다. DRAFT는 공개 홈·상세에서 조회하지 않습니다.
- 저자는 한 명 이상, 장르와 카테고리는 합쳐 한 개 이상, 회차는 한 개 이상 필요합니다. 빈 쪽의 분류 배열도 `[]`로 보냅니다.
- 관계 배열 안의 ID와 작품 안의 `chapterNo`는 각각 중복할 수 없습니다.
- 매거진의 각 회차에는 `pageNumber`가 필요합니다. 회차 번호 순으로 증가하며 `pageCount`가 있으면 그 이하여야 합니다.
- 회차의 `publishedAt`을 생략하거나 null로 보내면 비공개입니다. 공개 시각을 보내면 `contentUrl`도 필요합니다. 미래 시각은 예약 공개입니다.
- 회차 공개 시각은 DB의 `1970-01-01T00:00:01Z`부터 `2038-01-19T03:14:07Z`까지 허용합니다.
- `description`, 저자 `bio`, 회차 `summary`는 각각 UTF-8 65535바이트 이하입니다. Java의 문자열 길이 제한도 함께 적용하므로 한글·이모지의 바이트 수를 확인합니다.
- 조회 수·추천 수·평점은 서버가 관리합니다. 등록 요청에 통계 필드를 넣어 초기값을 지정하지 않습니다.
- 작품·관계·회차 중 검증이나 저장이 실패하면 해당 등록 전체를 롤백합니다.

### 공개·숨김과 회차 추가

```javascript
await adminPost(`/api/admin/works/${createdWork.id}/status`, { publishStatus: 'PUBLISHED' });
const publishedDetail = await adminRequest(`/works/${encodeURIComponent(createdWork.slug)}`);

await adminPost(`/api/admin/works/${createdWork.id}/chapters`, {
  chapterNo: 2,
  title: '두 번째 장',
  publishedAt: null,
  characterCount: 0,
  contentUrl: null,
});

await adminPost(`/api/admin/works/${createdWork.id}/status`, { publishStatus: 'HIDDEN' });
```

상태 변경은 `PUBLISHED` 또는 `HIDDEN`만 받으며 204를 반환합니다. 공개 시 필수 메타데이터와 연결 관계·회차를 다시 검사합니다. 게시판은 자동 생성하지 않으며 기존 게시판도 공개 상태 변경으로 삭제하지 않습니다.

### 팀원 관리자 생성과 로그아웃

```javascript
const teammate = await adminPost('/api/admin/accounts', {
  email: 'teammate@example.com',
  nickname: '예시 팀원',
  password: '새 계정에 발급할 비밀번호로 교체합니다.',
});
await adminPost('/api/admin/logout', {});
```

이메일은 최대 255자이며 도메인에 점이 필요합니다. 닉네임은 최대 30자입니다. 비밀번호는 Java UTF-16 길이 12자 이상이며 UTF-8 기준 72바이트 이하여야 합니다. 생성한 팀원도 전체 관리자 등록 기능과 다른 관리자 생성 권한을 갖습니다.

## 오류 처리

| 상태 | 처리 기준 |
| --- | --- |
| 400 | 필수값·형식·범위·중복 회차·관계 ID 등을 확인합니다. 입력을 수정한 뒤 다시 요청합니다. |
| 401 | 로그인 실패 또는 세션 부재·만료입니다. 본문이 비어 있을 수 있으며 로그인 흐름부터 다시 진행합니다. |
| 403 | CSRF 토큰과 쿠키의 짝 또는 현재 ADMIN 권한을 확인합니다. 권한이 철회되면 기존 세션도 거부합니다. |
| 404 | 작품이 없거나 비공개이거나 API 경로·서버 버전이 다릅니다. slug와 숫자 ID의 용도를 확인합니다. |
| 409 | slug·장르·분류·이메일·닉네임 등의 고유값이나 DB 관계가 충돌합니다. catalog에서 기존 자료를 먼저 확인합니다. |
| 500 | DB·SDUI 설정·공개 자료의 필수 메타데이터 오류입니다. 간이 데이터로 성공 처리하지 않습니다. |
| 503 | readiness의 API·DB 준비 상태가 정상적이지 않습니다. |

관리자 입력 오류의 응답 예시입니다.

```json
{ "message": "입력값의 필수 항목·길이·숫자·날짜 형식을 확인하십시오." }
```

Spring의 공통 오류는 `status`, `error`, `path` 등의 형식일 수 있으며, 보안 응답은 비어 있을 수도 있습니다. 화면은 HTTP 상태를 우선 사용하고 특정 오류 문장과 완전 일치하는지에 의존하지 않습니다.

등록 성공 후 목록 조회만 실패했다면 같은 등록 요청을 곧바로 반복하지 않습니다. catalog에서 저장 여부를 확인한 뒤 처리합니다. 현재 API에는 중복 요청을 별도로 식별하는 키나 자료 삭제·일괄 수정 기능이 없습니다.

## 문서 변경 기준

[OpenAPI 원본](../server/src/main/resources/static/openapi.yaml)을 수정하면 빌드 시 같은 파일이 서버 JAR에 포함됩니다. Swagger UI도 이 파일을 읽습니다. API를 변경할 때에는 요청·응답 스키마, 예제, 이 문서의 호출 순서를 함께 갱신합니다. 구현 예정 경로는 동작하는 API 목록에 추가하지 않습니다.

OpenAPI 계약 검사는 시험 전용 DB에서 실제 HTTP 요청·응답을 명세와 비교합니다. Javadoc은 기존 Java 코드 설명으로 유지합니다.

## 공개 텍스트 본문 열람 · #35

`GET /works/{slug}/chapters/{chapterId}`를 호출합니다. `slug`는 작품 상세의 `id`, `chapterId`는 `contents[].id`를 그대로 사용합니다. 회차 ID를 숫자로 증감하지 않습니다. 인증 없는 공개 조회이며 `PUBLISHED` 작품과 현재 시각까지 공개한 같은 작품의 회차만 제공합니다. 공개 목차는 회차 번호 오름차순입니다. 조회수·진도·독서 기록을 쓰지 않습니다.

| 필드 | 타입 | 의미 |
| --- | --- | --- |
| `workId`, `workTitle`, `kind` | 문자열 | 작품 slug·제목·`book`/`magazine`/`novel`입니다. |
| `chapter` | 회차 객체 | 현재 회차의 `id`, `title`, `number`(실제 회차 번호)입니다. |
| `contents` | 회차 객체 배열 | 같은 시각에 공개된 목차입니다. |
| `currentIndex` | 정수 | 공개 목차에서 0부터 세는 현재 순서입니다. 쪽수나 독서 진도가 아닙니다. |
| `previous`, `next` | 회차 객체 또는 `null` | 공개 목차의 이웃입니다. 첫·끝·단일 회차의 경계는 명시적 `null`입니다. |
| `body` | 문자열 | 서버가 한 번 정규화한 실제 표시 텍스트입니다. 빈 문자열도 정상입니다. |
| `characterCount` | 0 이상 정수 | `body`의 UTF-16 코드 단위 길이입니다. |
| `contentVersion` | 1 이상 정수 | 기존 DB의 `chapter.content_version`입니다. 조회할 때 갱신하지 않습니다. |
| `contentHash` | 문자열 | `body` UTF-8 바이트의 SHA-256 소문자 hex 64자리입니다. DB 버전과 구분합니다. |

```json
{
  "workId": "sample-book",
  "workTitle": "예시 도서",
  "kind": "book",
  "chapter": {
    "id": "12",
    "title": "첫 장",
    "number": 1
  },
  "contents": [
    {
      "id": "12",
      "title": "첫 장",
      "number": 1
    },
    {
      "id": "41",
      "title": "둘째 장",
      "number": 2
    }
  ],
  "currentIndex": 0,
  "previous": null,
  "next": {
    "id": "41",
    "title": "둘째 장",
    "number": 2
  },
  "body": "본문\n",
  "characterCount": 3,
  "contentVersion": 1,
  "contentHash": "d0bb9a4b74de533001ce57dc13db6183b9ca93244d7e025413f6739f89265a2f"
}
```

| HTTP 상태 | 조건 | 클라이언트 처리 |
| --- | --- | --- |
| 200 | 정상 본문이며 빈 파일도 포함합니다. | 본문·현재 장·목차를 표시합니다. |
| 400 | 회차 식별자 형식이 잘못됐습니다. | 선택 정보를 확인합니다. |
| 404 | 작품/회차 부재, 비공개, 공개 시각 이전, 다른 작품의 회차입니다. | 다른 회차로 대신 이동하지 않습니다. |
| 415 | HTML·EPUB·외부 URL 등 지원하지 않는 공급 형식입니다. | 텍스트 열람 미지원으로 안내합니다. |
| 503 | 파일 부재·손상 UTF-8·경로 제한·2MiB 초과 등입니다. | 안내 후 재시도를 제공합니다. |
| 500 | 서버 처리 오류입니다. | 안전한 오류 안내와 재시도를 제공합니다. |

오류는 `message`가 있는 JSON이며 내부 파일 경로·원본 URL·SQL을 노출하지 않습니다. 클라이언트는 HTTP 성공을 먼저 확인하고 실패 응답이 JSON이라고 가정하지 않습니다.

### 본문 공급과 기존 등록값 호환

`CONTENT_ROOT`(로컬 기본 `./content`)는 정적 공개 폴더 밖의 관리 전용 디렉터리입니다. 기존 `chapter.content_url`이 `/content/...txt`인 회차만 그 안의 일반 파일에 대응시킵니다. 경로 탈출·심볼릭 링크를 거부하고 HTTP/리디렉션 요청은 하지 않습니다. 파일 상한은 UTF-8 원본 2MiB입니다. 기존 HTTP(S)·HTML/EPUB 주소를 DB에서 삭제하거나 바꾸지 않고, 이번 열람 API에서만 415로 구분합니다. 업로드·변환은 #25 후속입니다. 컨테이너의 지속 폴더·읽기 전용 mount 설정은 [배포 안내](배포%20안내.md#텍스트-본문-폴더--35)를 따릅니다.

UTF-8 BOM 하나를 제외하고 `CRLF`/`CR`을 `LF`로 정규화한 문자열이 표시 텍스트입니다. `trim`·NFC·HTML 파싱·태그 삭제·위키 마크업 처리는 하지 않습니다. 공백·빈 줄·이모지는 보존하며 클라이언트도 `body`를 다시 정규화하지 않습니다. 기존 DB `char_count` 대신 실제 `body`에서 응답 길이를 계산하며 DB 저장값은 수정하지 않습니다. 페이지 분할·진도·독서 기록·AI·설정집은 #35 범위가 아닙니다.

## 회원 인증 영역의 CSRF

`GET /api/auth/csrf`에서 `headerName`, `parameterName`, `token`을 받고 같은 `MEMBER_SESSION` 쿠키와 `X-CSRF-TOKEN`으로 후속 변경 요청을 보냅니다. 관리자 `/api/admin/**`의 `SESSION`과 분리합니다. 두 영역의 쿠키 이름만 바꿔 재사용하면 401이며 원래 영역의 세션은 폐기하지 않습니다. 쿠키는 HttpOnly·SameSite=Strict이고 운영 HTTPS의 `SESSION_COOKIE_SECURE`를 따릅니다. 회원 쿠키 Path는 `/api`, 관리자 쿠키 Path는 기존 `/`입니다.

`AUTH_ALLOWED_ORIGINS`는 정확한 웹 origin 목록이며 기본값은 비어 있습니다. 명시한 origin만 credential CORS를 허용합니다. 웹/API는 same-site 구성이 지원 대상이며 cross-site 배포는 CORS만으로 지원하지 않습니다. 현재 구현 및 후속 계약 범위는 [회원 인증 계약](회원%20인증%20계약안.md)을 참고하십시오.

## 회원 로그인·로그아웃·세션 (#20)

- POST /api/auth/login: form email/password, 같은 회원 세션의 X-CSRF-TOKEN. 성공 204, 인증 실패 401, CSRF 실패 403. 비밀번호는 가입 정책으로 재검증하지 않고 기존 해시와 비교한다.
- GET /api/auth/session: 현재 활성 회원 본인의 id(문자열), email, nickname, createdAt(UTC ISO 8601). 200 또는 401, Cache-Control: no-store. 요청의 회원 ID는 사용하지 않는다.
- POST /api/auth/logout: 같은 회원 세션의 CSRF 필요. 204 후 기존 세션 ID 재사용 불가, 관리자 세션은 유지한다.
- MEMBER_SESSION은 HttpOnly/SameSite=Strict/Path=/api이며 7일 미사용 만료다. 활성 회원의 요청에서 서버 세션과 쿠키의 유효기간을 함께 갱신한다. 웹은 same-site API 구성, 네이티브는 플랫폼 쿠키 저장소를 사용한다. 쿠키·비밀번호를 JS 영구 저장소에 저장하지 않는다.
- 앱은 서버 확인 후에만 로그인 성공으로 표시하고 계정 변경 시 이전 요청을 취소한다. 늦은 이전 응답은 새 계정에 반영하지 않는다. 로그아웃 실패는 성공으로 표시하지 않는다.
- 네이티브 실기기 쿠키 동작은 별도 확인이 필요하다.

## 회원 비밀번호 변경 (#22)

`POST /api/auth/password`는 본인의 활성 `MEMBER_SESSION`과 같은 세션의 `X-CSRF-TOKEN`을 사용한다. `application/json` 필수 문자열은 `currentPassword`, `newPassword`, `newPasswordConfirmation`이다. 소유자 ID를 입력받지 않으며 알 수 없는 필드, 누락, 다른 타입과 잘못된 JSON은 거절한다.

현재 비밀번호는 기존 해시와 비교하고 신규 정책을 다시 적용하지 않는다. 새 비밀번호는 가입과 같이 영문·숫자를 포함한 유니코드 8문자 이상, UTF-8 기준 72바이트 이하이며 현재 비밀번호와 달라야 한다. 비밀번호와 확인값은 trim·정규화하지 않고 그대로 비교하며 잘못된 유니코드는 거절한다.

성공은 본문 없는 `204`이며 모든 기기의 **회원 영역 세션**을 종료하고 현재 회원 쿠키를 만료한다. 같은 회원의 별도 관리자 영역 세션과 다른 회원의 세션은 유지한다. 이후 새 비밀번호로 재로그인해야 한다. 입력·현재 비밀번호 불일치는 `400 {message, fieldErrors}`이며 오류 키는 `currentPassword`, `newPassword`, `newPasswordConfirmation`, `request`다. 미인증·만료·비활성·폐기된 자격 정보는 `401`, 인증 영역 불일치·활성 회원의 CSRF 실패는 `403`이다. 응답은 `Cache-Control: no-store`를 사용한다.

기존 회원 행 잠금 안에서 비밀번호 갱신과 저장된 회원 세션 폐기를 처리한다. 인증 때 사용한 해시의 버전을 세션 주체에 남기고 매 회원 요청에서 현재 버전과 비교한다. 변경과 겹친 옛 비밀번호 로그인이나 늦은 요청의 세션 저장도 새 인증으로 사용할 수 없다. DB 열·마이그레이션은 추가하지 않는다. 버전이 없는 기존 회원 세션은 배포 후 재로그인이 필요하다. 관리자 쿠키·CSRF·기존 로그인 계약은 유지한다.

클라이언트는 `204` 확인 후 인증 세대를 바꾸고 개인 요청·개인 화면·비밀번호 입력을 비운다. 이메일을 채운 로그인 화면에서 모든 기기 로그아웃 안내를 표시한다. `400`과 `403`은 입력 또는 보안 확인을 수정해 재시도한다. 통신 실패·예상 밖 응답은 변경 완료로 표시하지 않고 개인 상태를 비운 뒤 재로그인으로 확인한다.

## 시연 회원가입 (#19)

| 메서드와 경로 | 결과 |
| --- | --- |
| `GET /api/auth/terms` | 200에 `{documents: [...]}` 반환. `TERMS`와 `PRIVACY` 문서의 kind, version, title, body, contentHash, temporary(true)를 제공한다. |
| `POST /api/auth/signup` | 같은 회원 세션의 CSRF 토큰과 JSON을 받는다. 201에 `{id, email, nickname}`을 반환하고 로그인 화면으로 이동한다. |

가입 JSON 필수값은 `email`, `nickname`, `password`, `passwordConfirmation`, `consents`다. `consents`는 문서별 `{kind, version, contentHash, agreed: true}` 두 항목을 갖는다. 알 수 없는 속성, 중복 문서 종류와 현재 문서와 다른 버전 또는 해시는 거절한다. 해시는 LF로 통일한 응답 본문 전체의 UTF-8 SHA-256 소문자 64자리다.

이메일은 앞뒤 공백을 제거하고 소문자로 변환한 뒤 도메인의 점과 형식, 255자 한도를 검사한다. 닉네임은 공백을 정리한 뒤 UTF-16 기준 30자까지 허용한다. 비밀번호는 영문·숫자를 포함한 유니코드 문자 8개 이상이며 UTF-8 기준 72바이트까지다. 비밀번호와 확인값은 그대로 비교한다. 계정은 `USER/ACTIVE`로 생성되고 기본 읽기 설정과 함께 동의 문서 종류·버전 및 동의 시각을 같은 트랜잭션으로 저장한다. 문서 원문·해시는 종류·버전별로 한 번 보관한다.

입력·미동의는 400, 중복 이메일·닉네임·구버전 문서·이미 로그인한 회원의 가입은 409다. 400/409 JSON은 `{message, fieldErrors}`이며 오류 키는 `email`, `nickname`, `password`, `passwordConfirmation`, `terms`, `privacy`, `request`다. 문서 변경 시 최신 내용을 다시 읽고 체크한다. CSRF 실패는 403이다.

`SIGNUP_DEMO_ENABLED=true`를 설정한 개발·검증 환경에서 두 API를 제공한다. 기본 설정에서는 약관 조회와 CSRF·JSON 형식이 유효한 가입 요청이 503을 반환한다. 문서·가입 응답은 `Cache-Control: no-store`를 사용한다. 201 이후에도 회원 인증 상태는 익명이다. 정식 약관 교체와 기존 동의 보존·재동의는 [#96](https://github.com/whitetiger0804/Mobtwig/issues/96)에서 다룬다.
