# Mobtwig HTTP API 명세서

클라이언트가 Java 소스를 읽지 않고 HTTP 요청을 작성할 수 있도록 현재 구현한 계약을 설명합니다. 필드별 타입·필수 여부·최대 길이의 정본은 [OpenAPI 명세](../server/src/main/resources/static/openapi.yaml)입니다. 클래스·메서드의 역할은 기존 Javadoc에서 확인합니다.

이 문서와 명세를 포함한 커밋이 배포된 서버를 기준으로 합니다. 같은 주소라도 이전 버전의 서버에는 새 경로가 없을 수 있습니다. 서버 실행·배포 절차는 [배포 안내](배포%20안내.md)를 참고합니다.

후속 본문·독서 기록 API의 식별자·표시 텍스트·UTF-16 offset·매거진 쪽 번호·개정 시 처리 기준은 [본문·독서위치 규약 v1](본문·독서위치%20규약.md)(#18)을 따릅니다. 해당 문서의 논리 필드 예시는 현재 HTTP API에 추가된 경로/응답이 아니며, 후속 구현 시 OpenAPI에 반영합니다.

## 읽기 위치 · #38

`GET /api/members/works/{slug}/reading-progress`와 같은 경로의 `POST`는 활성 회원 본인의 저장 기록에만 접근합니다. POST는 같은 회원 세션의 CSRF 토큰을 사용합니다. GET은 조회수·진도·서재를 변경하지 않습니다.

두 메서드의 200 응답은 `workId`(slug), `kind`, `state`, `position`, `revision`, `lastReadAt`, `chapterPercent`, `workPercent`, `maxChapterId`, `libraryStatus`, `hasNewChapters`를 반환합니다. 위치는 `chapterId`, `offset`, `unit`(`utf16` 또는 `page`), `contentVersion`, `contentHash`를 포함합니다.

- `new`는 이력이 없으며 첫 공개 회차 시작을 제안합니다. `saved`는 복원 가능한 저장 위치입니다. `stale`은 이전 위치의 버전·해시·공개 범위가 바뀌었거나 검증할 수 없음을 뜻합니다. 기존 회차가 공개 상태이고 읽을 수 있으면 그 시작, 아니면 읽을 수 있는 첫 공개 회차 시작을 제안합니다. 읽을 위치가 없으면 `position`은 null입니다.
- revision은 저장본의 십진 문자열이며 최초에는 null입니다. POST JSON은 `chapterId`, 정수 `offset`, `contentVersion`, `contentHash`(매거진은 null), `expectedRevision`(최초에는 null)을 모두 보냅니다. 성공 응답의 revision과 UTC 저장 시각은 서버가 부여합니다.
- 잘못된 좌표는 400, 미인증은 401, CSRF 실패는 403, 비공개/타 작품 회차는 404입니다. 409의 `code`는 `PROGRESS_CONFLICT` 또는 `CONTENT_CHANGED`입니다. 충돌 시 기존 기록은 유지되며 GET으로 다시 확인합니다. 선택 회차의 파일을 제공할 수 없으면 415 또는 503입니다.
- 진행률은 0~100의 소수점 둘째 자리까지이며 산정 불가는 null입니다. 텍스트는 원문과 같은 UTF-16 길이를 사용합니다. 작품 전체 계산은 한 조회의 공개 본문을 최대 64회차·합계 200만 UTF-16 단위까지 검증하며 한도를 넘거나 자료를 확인할 수 없으면 null입니다. 매거진은 아티클 쪽 범위와 호 전체 쪽 수로 계산합니다. 끝 쪽 수가 없는 경우 해당 진행률은 null입니다.
- 마지막 정상 위치·시각·최고 도달 회차·서재 상태를 한 트랜잭션에서 반영합니다. 마지막 공개 회차의 비어 있지 않은 본문 끝, 또는 마지막 공개 아티클의 호 끝 쪽에서 완독으로 저장합니다. 재독은 마지막 위치를 바꾸되 최고 도달 회차를 보존합니다. 매거진 PNG는 아래 공개 쪽 API에서 제공합니다.

## 최근 본 작품 · #110

`GET /api/members/recent-works`는 활성 회원 본인이 최근 본 공개 작품을 최근 본 순서로 최대 20개 반환합니다. 기록이 없으면 빈 배열입니다. 각 항목은 `id`(작품 slug), `title`, `imageUrl`, `kind`(`book`, `novel`, `magazine`), `lastReadAt`(UTC ISO 시각, 예: `2026-01-02T03:04:05Z`)입니다.

`POST /api/members/recent-works/{slug}`는 요청 본문 없이 같은 회원 세션의 CSRF 토큰을 보내며, 성공하면 본문 없는 204를 반환합니다. 같은 작품을 다시 열면 행을 추가하지 않고 최근 본 시각만 갱신합니다. 두 요청 모두 `Cache-Control: no-store`를 사용하며 조회수·읽기 위치·서재를 변경하지 않습니다.

- 비공개 작품은 목록에서 제외합니다. 기록은 유지되므로 다시 공개되면 목록에 다시 나타납니다. 공개 작품의 제목·표지 등 필수 정보가 잘못되면 홈·상세와 같이 오류를 반환하며 해당 항목을 조용히 누락하지 않습니다.
- 시각은 초 단위로 저장합니다. 같은 초에 연 작품 사이의 순서는 보장하지 않습니다.
- 잘못된 slug는 400 `INVALID_SLUG`, 미인증은 본문 없는 401, CSRF 실패는 403, 없거나 비공개인 작품은 404 `NOT_FOUND`입니다.

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
| GET | `/sdui/home?kind=all` | 공개 조회이며 kind가 필수입니다. | 200 홈 SDUI입니다. |
| GET | `/works/{slug}` | 공개 작품만 조회합니다. | 200 작품 상세입니다. |
| GET | `/works/{slug}/chapters/{chapterId}` | 공개 작품의 공개된 회차만 조회합니다. | 200 텍스트 본문·목차·회차 이동 정보입니다. |
| GET | `/api/members/recent-works` | 활성 회원 세션이 필요합니다. | 200 최근 본 공개 작품 최대 20개입니다. |
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

회원 가입, 일반 회원용 토큰 인증, 검색·서재·리뷰·커뮤니티 요청은 이 명세의 구현 범위에 포함하지 않습니다. 표의 경로를 다른 기능의 API로 재사용하지 않습니다.

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

- 작품이 없거나 공개 상태가 아니면 404입니다. slug에는 영문 소문자·숫자·하이픈을 사용합니다.
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

상태 변경은 `PUBLISHED` 또는 `HIDDEN`만 받으며 204를 반환합니다. 공개 시 필수 메타데이터와 연결 관계·회차를 다시 검사하고 작품 게시판을 생성합니다. 같은 작품을 다시 공개해도 게시판을 중복 생성하지 않습니다.

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
| 400 | 식별자 형식이 잘못됐습니다. | 선택 정보를 확인합니다. |
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

## 시연 회원가입 (#19)

| 메서드와 경로 | 결과 |
| --- | --- |
| `GET /api/auth/terms` | 200에 `{documents: [...]}` 반환. `TERMS`와 `PRIVACY` 문서의 kind, version, title, body, contentHash, temporary(true)를 제공한다. |
| `POST /api/auth/signup` | 같은 회원 세션의 CSRF 토큰과 JSON을 받는다. 201에 `{id, email, nickname}`을 반환하고 로그인 화면으로 이동한다. |

가입 JSON 필수값은 `email`, `nickname`, `password`, `passwordConfirmation`, `consents`다. `consents`는 문서별 `{kind, version, contentHash, agreed: true}` 두 항목을 갖는다. 알 수 없는 속성, 중복 문서 종류와 현재 문서와 다른 버전 또는 해시는 거절한다. 해시는 LF로 통일한 응답 본문 전체의 UTF-8 SHA-256 소문자 64자리다.

이메일은 앞뒤 공백을 제거하고 소문자로 변환한 뒤 도메인의 점과 형식, 255자 한도를 검사한다. 닉네임은 공백을 정리한 뒤 UTF-16 기준 30자까지 허용한다. 비밀번호는 영문·숫자를 포함한 유니코드 문자 8개 이상이며 UTF-8 기준 72바이트까지다. 비밀번호와 확인값은 그대로 비교한다. 계정은 `USER/ACTIVE`로 생성되고 기본 읽기 설정, 문서별 원문과 동의 시각이 같은 트랜잭션으로 저장된다.

입력·미동의는 400, 중복 이메일·닉네임·구버전 문서·이미 로그인한 회원의 가입은 409다. 400/409 JSON은 `{message, fieldErrors}`이며 오류 키는 `email`, `nickname`, `password`, `passwordConfirmation`, `terms`, `privacy`, `request`다. 문서 변경 시 최신 내용을 다시 읽고 체크한다. CSRF 실패는 403이다.

`SIGNUP_DEMO_ENABLED=true`를 설정한 개발·검증 환경에서 두 API를 제공한다. 기본 설정에서는 약관 조회와 CSRF·JSON 형식이 유효한 가입 요청이 503을 반환한다. 문서·가입 응답은 `Cache-Control: no-store`를 사용한다. 201 이후에도 회원 인증 상태는 익명이다. 정식 약관 교체와 기존 동의 보존·재동의는 [#96](https://github.com/whitetiger0804/Mobtwig/issues/96)에서 다룬다.
