# 화면 구성·작품 정보 간이 서버

Node.js 기본 모듈로 실행하는 개발용 서버입니다. DB나 추가 패키지를 설치하지 않으며, `fixtures/home.json`의 화면 구성, `fixtures/works.json`의 작품 상세 정보, [`../src/main/resources/static/media/`](../src/main/resources/static/media/)의 이미지를 제공합니다. 이미지는 실제 서버와 공유하는 **test(테스트)용 자료**입니다.

저장소 루트에서 다음 명령으로 실행합니다.

```powershell
node server/mock/index.mjs
```

기본 주소는 `http://127.0.0.1:8090`입니다. 종료하려면 실행한 터미널에서 `Ctrl+C`를 누릅니다. 다른 기기에서 PC의 LAN 주소로 접근할 때는 필요한 네트워크에서만 접근을 허용하고 다음과 같이 실행합니다.

```powershell
$env:MOCK_HOST = '0.0.0.0'
$env:MOCK_PORT = '8090'
node server/mock/index.mjs
```

클라이언트에서는 `npm run start:test`로 서버 선택 화면을 엽니다. `client/.env`의 `EXPO_PUBLIC_MOCK_API_URL`은 테스트할 API 주소이며, 이 간이 서버 대신 로컬 Spring 서버 주소를 지정해도 됩니다. 이 값은 서버의 실행 포트나 수신 주소를 변경하지 않습니다.

`EXPO_PUBLIC_MOCK_USE_EXPO_HOST`로 모바일의 주소 변환 여부를 지정합니다. 미설정 또는 `false`이면 지정한 주소를 그대로 사용합니다. `.env.example`은 LAN 테스트를 위해 `true`를 예시로 제공합니다.

| 연결 방식 | 설정과 동작 |
| --- | --- |
| Android·iOS LAN | `true`이면 로컬 mock 주소의 호스트만 Expo 개발 PC의 IP로 바꿉니다. PC와 기기는 같은 네트워크에 있어야 하며, API 서버의 LAN 수신과 방화벽 접근이 허용되어야 합니다. |
| Android USB | `false`로 지정해 `localhost` 주소를 유지하고, 해당 API 포트에 `adb reverse`를 설정합니다. |
| iOS 시뮬레이터 | 개발 Mac의 `localhost`를 직접 사용할 때는 `false`로 지정합니다. |
| PC 웹 | 설정값과 관계없이 `EXPO_PUBLIC_MOCK_API_URL`을 그대로 사용합니다. |
| Expo 터널 | 터널은 API 포트까지 노출하지 않습니다. Expo 터널 호스트로 자동 변환하지 않으며, 기기에서 접속 가능한 API 주소를 직접 지정해야 합니다. |

자동 변환은 Expo가 알려 준 LAN IP에만 적용합니다. Expo 주소가 없거나 터널 호스트이면 mock 선택지에 오류를 표시하고 실제 개발 서버 선택은 유지합니다. PC의 IP나 API 도메인을 직접 지정하면 자동 변환 대상이 아닙니다. 이 간이 서버에는 로그인 API가 없으므로 회원 기능은 해당 API를 제공하는 Spring 서버로 테스트해야 합니다.

| 요청 | 응답 |
| --- | --- |
| `GET /health` | 간이 서버의 실행 상태를 반환합니다. |
| `GET /sdui/home?kind={kind}` | `{kind}`에 `all`, `book`, `magazine`, `novel`을 넣어 해당 화면 구성을 조회합니다. |
| `GET /works/:id` | 해당 ID의 작품 상세 정보 객체 하나를 반환합니다. |
| `GET /works?query={query}&kind={kind}` | `{query}`는 검색어, `{kind}`는 `all`, `book`, `magazine`, `novel` 중 선택한 종류입니다. 제목·저자·출판사 부분 검색 결과를 `id`, `title`, `imageUrl`, `kind` 배열로 반환하며 결과가 없으면 `[]`입니다. 종류는 생략할 수 있습니다. |
| `GET /api/members/recent-works` | `fixtures/recent-works.json`의 최근 본 작품 고정 예시를 반환합니다. 인증을 확인하지 않으며 기록 요청(`POST /api/members/recent-works/{slug}`)은 제공하지 않습니다. |
| `GET /media/covers/...` | 공용 `media/covers/`의 도서·매거진·웹소설 표지 PNG를 반환합니다. |
| `GET /media/backgrounds/...` | 공용 `media/backgrounds/`의 배경 PNG를 반환합니다. |

홈 요청의 `kind`는 반드시 한 번 지정합니다. 누락하거나 지원하지 않는 값을 지정하면 `400`, 없는 경로나 작품 ID는 `404`, GET 이외의 메서드는 `405`를 반환합니다. 파일을 읽거나 JSON을 해석하지 못하면 `500`을 반환합니다. 웹 개발 화면의 GET 요청을 위해 CORS를 허용하며 인증이나 개인정보 처리에는 사용하지 않습니다.

`fixtures/home.json`의 각 응답은 `{ "version": 1, "sections": [...] }` 형태입니다. 섹션은 `bannerCarousel`(배너 목록), `featuredWork`(좌측 정보·우측 표지의 추천 작품), `workShelf`(작품 목록), `linkRow`(바로가기 목록) 중 하나를 지정합니다. 서버에서 섹션의 제목·순서·항목 수를 바꾸면 앱이 그 구성을 렌더링합니다. `bannerCarousel`은 배경 이미지와 문구를 표시하며, 별도 표지 배치가 필요하면 `featuredWork`를 선택합니다.

도서 홈의 상단 배너 자리는 `featuredWork`로 구성합니다. 예시 항목의 `label`은 '오늘의 책', 작품은 제공된 시안·표지의 '나를 돌보는 연습'입니다. `label`, `title`, `imageUrl`은 필수이며 `subtitle`, `action`은 선택 사항입니다. `items`가 비어 있으면 클라이언트가 표지 없이 공통 빈 상태 안내를 표시합니다. 작품 목록과 추천 작품을 누르면 해당 `id`의 상세 화면으로 이동합니다.

각 섹션은 `id`, `type`, `items`를 포함합니다. `title`, `action`은 선택 사항이며, 이동 동작은 `{ "label": "문구", "route": { "screen": "home", "kind": "book" } }` 형태입니다. 목록 화면의 `screen`은 `home`, `search`, `library`, `recent` 중 하나이며 `kind`는 선택 사항입니다. 특정 작품으로 이동할 때는 `{ "screen": "detail", "workId": "book-care" }`처럼 작품 ID를 지정합니다. 이미지 주소는 실제 서버와 동일한 `/media/...` 상대 경로입니다. 빈 상태 문구는 클라이언트에서 관리하며 서버 응답에 포함하지 않습니다.

화면 JSON은 요청할 때마다 다시 읽습니다. 서버를 재시작하지 않고 JSON을 수정한 뒤 앱에서 화면을 새로고침하여 다음 항목을 검증할 수 있습니다.

- `sections`를 재배열하거나 삭제해 섹션 순서·개수를 변경합니다.
- `title`을 변경해 카테고리별 문구를 변경합니다.
- `items`를 추가·삭제해 실제 표시할 항목 수를 변경합니다.
- `items: []`로 빈 상태를 확인합니다. 표지·배너 자리 수를 따로 예약하지 않습니다.

기본 예시에는 홈 화면의 빈 최근 본 작품과 도서 화면의 빈 최근 본 도서가 포함되어 있습니다. 이벤트 배너는 홈(`all`) 응답에만 포함합니다. 작품 제목은 제공받은 이미지 파일명에서 가져왔으며, 표지 16개와 배경 1개는 제공된 `temp` 폴더에서 가져온 테스트 자료입니다. 기존 `mock/assets/`의 파일을 공용 정적 리소스 폴더로 옮겼으며 이미지 내용은 변경하지 않았습니다.

표지는 `../src/main/resources/static/media/covers/도서/`, `covers/매거진/`, `covers/웹소설/`에, 배경은 같은 `media/` 아래의 `backgrounds/`에 있습니다. mock은 이 폴더를 직접 읽으며 Spring Boot는 빌드에 포함한 같은 파일을 제공합니다. 실행 명령은 그대로 사용합니다. JSON 예시는 `mock/fixtures/`에 유지하며 실제 DB에 자동 등록하지 않습니다. 공유·배포 방식은 [이미지 저장소 구현 안내](../../docs/이미지%20저장소%20구현%20안내.md)를 참고합니다.

`fixtures/works.json`은 도서 6개, 매거진 5개, 웹소설 5개의 정보 배열입니다. 홈 응답의 작품 `id`, `title`, `imageUrl`과 대응하며, `GET /works/book-care`처럼 요청하면 해당 작품 객체만 반환합니다. 상세 응답에는 SDUI의 `sections`나 요소 `type`을 포함하지 않으며, 상세 화면의 배치는 클라이언트가 정합니다.

작품 정보는 `id`, `kind`, `title`, `author`, `imageUrl`, `description`, `publisher`, `publishedAt`, `category`, `fileFormat`, `contents`를 포함합니다. `kind`는 `book`, `magazine`, `novel` 중 하나이며 발행일은 `YYYY-MM-DD`, 목차는 `{ "id": "항목 ID", "title": "항목 제목" }`의 배열입니다. `descriptionTitle`, `pageCount`, `quote`, `issue`, `publicationCycle`, `statistics`는 선택 정보입니다. `descriptionTitle`은 매거진 소개 제목이며 통계는 `views`, `recommendations`, `rating`으로 조회 수·추천 수·평점을 전달합니다.

목차 항목에는 `category`(분류), `pageNumber`(시작 쪽), `publishedAt`(회차 발행일), `characterCount`(글자 수)를 선택적으로 포함합니다. 시작 쪽과 글자 수는 양의 정수이고 시작 쪽은 전체 `pageCount`를 넘지 않으며, 회차 발행일도 `YYYY-MM-DD` 형식입니다. 예시에서는 매거진 목차에 분류·쪽수를, 웹소설 회차에 발행일·글자 수를 제공합니다. 회차 번호는 클라이언트가 표시하므로 회차 제목에는 번호를 중복해서 넣지 않습니다.

소개·목차·출판정보·통계는 상세 화면 검증용 가상 예시입니다. 제목·표지·저자와 일부 정보는 제공된 표지·시안을 참고했으며, 실제 출간 정보나 서비스 지표를 뜻하지 않습니다. 이 JSON은 DB 저장 모델을 확정하지 않습니다. 작품 JSON도 매 요청마다 다시 읽으므로 파일 수정 후 앱에서 다시 요청하면 변경을 확인할 수 있습니다. 실제 개발 서버를 연결할 때는 화면 구성 API와 작품 상세 API를 모두 제공해야 합니다.

검증은 저장소 루트에서 다음 명령으로 실행합니다. 테스트는 임시 포트의 서버를 실행하고 종료합니다.

```powershell
node --test server/mock/server.test.mjs
```

## 텍스트 본문 검증 · #35

GET /works/{slug}/chapters/{chapterId}는 works.json의 공개 목차와 chapter-text.json의 검증용 가상 예문을 조합합니다. 작품 16개·목차 91개에 각각 예문이 있으며 실제 출판 본문이 아닙니다. ID는 기존의 문자열을 보존합니다. 응답 필드는 실제 API와 같고 정규화 body, UTF-16 characterCount, 정수 contentVersion, SHA-256 contentHash를 구분합니다. 처음/끝에는 명시적 null 이웃이 있고 없는 회차는404, 준비되지 않은 본문 파일은503입니다. 정상 빈 body는200입니다. 본문 예문과 작품 JSON 파일 자체는 HTTP로 공개하지 않습니다.
