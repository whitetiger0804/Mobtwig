# Mobtwig 모바일 앱

React Native와 Expo를 사용하는 TypeScript 클라이언트입니다. 홈은 서버가 보내는 SDUI 구역을 렌더링하며 메뉴, 패널, 입력란과 공통 빈 요소를 제공합니다.

홈의 화면 표시 계약은 `src/homeSchema.ts`에 정의합니다. 실제 서버는 회원 인증·서재·독서 기록·구매·리뷰·커뮤니티 API를 제공하며 앱에서 사용합니다. HTTP 계약은 [API 명세서](../docs/API%20명세서.md), DB 변경은 [Flyway 안내](../server/src/main/resources/db/migration/README.md)를 따릅니다. `server/mock/`은 공개 조회 계약을 확인하는 읽기 전용 간이 서버이며 회원 변경 API 검증에는 별도 테스트 DB를 연결한 Spring 서버를 사용합니다.

## 팀 공통 버전

작품 공유는 `EXPO_PUBLIC_SHARE_BASE_URL` origin과 `/s/works/{slug}`로 주소를 만듭니다. 미설정 기본값은 `https://mobtwig.xn--3h3b098b.kro.kr`이며 선택한 API 서버와 독립적입니다. 별도 테스트 웹을 사용하면 테스트용 빌드의 환경 변수로 지정합니다. origin에는 경로·계정·쿼리·해시를 넣을 수 없습니다. 하이라이트 문장은 URL에 포함하지 않고 공유 본문에만 넣습니다. 작품 상세와 독서 화면의 공유는 패널로 열어 아래 화면과 현재 읽기 위치를 보존합니다. 운영체제 공유 결과는 완료 수신을 보장하지 않으며 사용자가 취소하거나 실패하면 같은 화면에서 다시 시도할 수 있습니다.

외부 작품 링크는 `mobtwig://works/{slug}` 또는 설정한 공유 origin의 `/s/works/{slug}`만 허용합니다. 서버 선택·읽기 설정·로그인 초기화 중 들어온 링크를 보관하고 최초 인증 확인 후 공개 작품 상세를 엽니다. 실행 중의 링크도 같은 상세로 이동합니다. 쿼리·해시·인코딩된 경로·외부 origin은 허용하지 않습니다. 잘못된 링크는 링크 안내, 조회할 수 없는 작품은 상세 오류 화면으로 구분합니다.

`app.json`의 `scheme: mobtwig`, Android 패키지 `com.whitetiger0804.mobtwig`를 포함한 개발 또는 배포 빌드로 검사합니다. Expo Go는 이 앱의 custom scheme 등록을 대신하지 않습니다. Android cold 검사는 `adb shell am force-stop com.whitetiger0804.mobtwig` 후 `adb shell am start -a android.intent.action.VIEW -d "mobtwig://works/novel-record" com.whitetiger0804.mobtwig`로 시작합니다. 같은 명령을 앱 실행 중 다시 보내 warm 진입을 확인합니다. 존재하지 않는 slug, 잘못된 링크와 하이라이트 공유 취소 후 위치 복귀도 확인합니다.

Expo 개발 앱은 완전히 종료된 상태의 외부 링크를 보관한 뒤 개발 런처를 먼저 표시할 수 있습니다. 이때 개발 프로젝트 선택이 필요합니다. 종료 상태에서 작품으로 바로 진입하는 동작은 JavaScript 번들이 내장되고 개발 런처가 없는 배포 형태의 APK로 검사합니다. 개발 앱의 실행 중 링크 검사와 구분합니다.

HTTPS 앱 연결은 `app.config.js`에서 공유 origin에 맞춰 준비합니다. Android는 `/s/works/` 경로의 `autoVerify` intent filter를 생성하고, iOS는 확정한 `IOS_BUNDLE_IDENTIFIER`가 있을 때 associated domain을 설정합니다. `APPLE_TEAM_ID`는 확정한 Apple 개발 팀을 사용할 때 지정합니다. 로컬 HTTP 공유 origin에서는 HTTPS 앱 연결을 추가하지 않습니다. 설정 변경 후에는 네이티브 앱을 다시 빌드해야 합니다.

이미 `android/`가 생성되어 있다면 재빌드 전에 Expo 설정을 네이티브 프로젝트에 반영합니다. `--no-clean`은 기존 네이티브 폴더를 유지하며, 개발 서버의 새로고침만으로는 설치 앱의 링크 수신 설정이 갱신되지 않습니다.

```powershell
npx expo prebuild --platform android --no-clean --no-install --skip-dependency-update react,react-native
npm run android -- --device
```

공유 웹 안내는 Spring 서버의 `/s/works/{slug}`에서 제공합니다. 기존 공개 `GET /works/{slug}`를 로그인 쿠키 없이 한 번 요청하고 제목·표지·종류·저자를 표시합니다. 실패 시에만 사용자 재시도를 제공하며 자동 갱신이나 폴링은 없습니다. 기존 상세 API에는 조회수 집계가 있으므로 안내 페이지 한 번의 정상 조회에도 기존 집계가 적용됩니다. query의 제목·문장·이동 주소는 사용하지 않습니다. 앱 열기는 검증된 slug의 `mobtwig://works/{slug}`이며 설치 주소는 아직 없어 ‘설치 준비 중’으로 표시합니다. 스토어 설치 후 원래 공유 링크를 다시 여는 흐름은 설치 주소가 준비된 뒤 별도 검증이 필요합니다.

### HTTPS 도메인 검증 파일 준비 · #64

`npm run links:files`는 지정한 출력 폴더에 Android의 `assetlinks.json`과 선택적인 iOS의 `apple-app-site-association`을 생성합니다. 배포할 Android 앱의 실제 서명 인증서 SHA-256을 사용합니다. Play 배포 시에는 Play Console의 앱 서명 인증서를 확인합니다. 개인 키나 비밀번호는 생성 도구에 전달하지 않습니다. iOS의 Bundle ID·Apple 팀 정보와 application-identifier는 Apple Developer 및 서명한 앱의 entitlement에서 확인합니다. 이전 앱은 application-identifier의 prefix와 Team ID가 다를 수 있어 AASA에는 실제 application-identifier를 입력합니다.

PowerShell에서 Android 파일을 준비하는 명령입니다. `ANDROID_APP_LINKS_SHA256`은 미리 확인한 콜론 구분 32바이트 지문이며 인증서 교체 시 `--android-sha256`을 여러 번 지정할 수 있습니다.

```powershell
npm run links:files -- --output-dir .expo/app-links/.well-known --android-sha256 "$env:ANDROID_APP_LINKS_SHA256"
```

iOS도 준비된 경우 프로세스 환경의 `IOS_BUNDLE_IDENTIFIER`와 필요 시 `APPLE_TEAM_ID`를 설정한 뒤 `--ios-app-id "$env:IOS_APPLICATION_IDENTIFIER"`를 추가합니다. 이 명령은 Expo CLI와 별개로 실행하므로 프로세스 환경 변수를 사용합니다. 값이 없거나 형식·Bundle ID가 다르면 파일 생성 전에 오류로 종료합니다. 서명 정보가 미확정이면 검증 파일을 생성하지 않고 설정·단위 검사까지만 진행합니다.

생성한 파일은 공유 origin의 `/.well-known/`에 HTTPS·200·`application/json`으로 제공하며 리다이렉트 없이 접근되어야 합니다. 설치 앱의 서명이 파일의 인증서와 일치해야 합니다. 개발 앱의 인증서로 준비한 파일은 다른 인증서로 서명한 배포 앱까지 인증하지 않으므로 배포 서명에 맞는 지문도 등록합니다.

공용 Windows 서버에서는 Caddy가 `C:/Mobtwig/public/.well-known/assetlinks.json`과 `C:/Mobtwig/public/share/`를 제공합니다. 공유 안내 파일은 `server/src/main/resources/static/share/`의 5개 파일이며, `/s/works/{slug}`는 이 폴더의 `index.html`로 연결합니다. 그 외 API 요청은 기존 `127.0.0.1:8080` 프록시를 사용합니다. 이 정적 배포본을 변경할 때는 원본 파일과 함께 반영해야 합니다. 서버의 작품 데이터는 별개이므로 로컬에만 있는 작품은 공개 웹 안내에서 조회되지 않습니다.

Android에서 새 앱 설치와 파일 배포 후 `adb shell pm verify-app-links --re-verify com.whitetiger0804.mobtwig`, `adb shell pm get-app-links --user 0 com.whitetiger0804.mobtwig`로 검증 결과를 확인합니다. 도메인이 `verified`인지 확인한 다음 HTTPS 공유 링크를 눌러 종료·실행 상태에서 같은 작품으로 이동하는지 검사합니다. iOS는 Associated Domains 권한이 포함된 서명 앱을 실제 iPhone에 설치한 뒤 Safari·메시지의 HTTPS 링크로 확인합니다. 설치 후에는 원래 공유 링크를 다시 열어 같은 작품으로 이동합니다. 자동 설치 후 복원은 후속 검증 대상입니다.

도메인이 `verified`여도 기기에서 앱의 링크 열기를 꺼 두었다면 자동으로 열리지 않습니다. Android의 ‘설정 → 애플리케이션 → 모북이 → 기본으로 설정’에서 ‘지원되는 링크 열기’를 확인합니다. 명령 출력의 `Verification link handling allowed`는 `true`여야 하며, `Selection state: Disabled`만으로 검증된 주소가 차단됐다고 판단하지 않습니다. 실제 연결 검사는 앱 패키지를 강제로 지정하지 않고 HTTPS 주소로 실행합니다.

```powershell
adb -s <기기ID> shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "https://mobtwig.xn--3h3b098b.kro.kr/s/works/<작품slug>"
```

[Expo Android App Links](https://docs.expo.dev/linking/android-app-links/), [Expo iOS Universal Links](https://docs.expo.dev/linking/ios-universal-links/)와 [Apple 도메인 연결 안내](https://developer.apple.com/documentation/xcode/supporting-associated-domains)를 기준으로 합니다.

| 도구 | 버전 |
| --- | --- |
| Node.js | 24.21.0 LTS |
| npm | 12.1.0 |
| Expo | 58.0.23(SDK 58) |
| React Native | 0.88.1 |
| React | 19.3.0 |
| TypeScript | 6.0.3 |

직접 의존성은 `package.json`, 설치 버전은 `package-lock.json`으로 공유합니다. 같은 구성으로 설치할 때에는 `npm ci`를 사용합니다. Expo CLI는 프로젝트의 `expo` 패키지에 포함되어 있습니다.

## 설치와 실행

저장소 루트에서 PowerShell로 실행합니다.

```powershell
cd client
npm ci
```

처음 개발 앱을 설치할 때는 `npm run android`, Expo Go로 열 때는 `npm run android:go`를 실행합니다. 개발 앱 설치 후에는 `npm start`로 개발 서버만 다시 실행할 수 있습니다.

| 명령 | 용도 |
| --- | --- |
| `npm start` | 설치된 개발 앱에 연결할 Expo 개발 서버를 실행합니다. |
| `npm run start:go` | Expo Go에 연결할 개발 서버를 실행합니다. 휴대폰에서 QR을 스캔합니다. |
| `npm run start:test` | 개발 앱에서 간이 서버·실제 개발 서버 선택 화면을 활성화합니다. `-- --go`를 붙이면 Expo Go로 실행합니다. |
| `npm run mock` | 포트 8090에서 SDUI 간이 서버를 실행합니다. |
| `npm run android` | Android 개발 앱을 빌드·설치하고 개발 서버에 연결합니다. |
| `npm run android:go` | Android 기기·에뮬레이터의 Expo Go로 앱을 엽니다. 네이티브 빌드는 하지 않습니다. |
| `npm run ios` | macOS에서 iOS 개발 앱을 빌드·설치하고 개발 서버에 연결합니다. |
| `npm run ios:go` | macOS의 iOS 시뮬레이터에서 Expo Go로 앱을 엽니다. |
| `npm run web` | 웹 개발 화면을 엽니다. |
| `npm run typecheck` | TypeScript 타입을 검사합니다. |
| `npm test` | 조회 계약·회원 요청·독서 저장·구매·리뷰·커뮤니티·공유 및 간이 서버 응답을 검사합니다. |
| `npm run docs` | UI 코드 문서를 `docs-api/`에 생성합니다. |
| `npx expo export --platform all` | Android·iOS·웹 JavaScript와 자산을 `dist/`에 내보냅니다. |

플랫폼별 번들 생성은 APK·IPA 빌드나 실기기 설치와 구분합니다. 개발 서버는 `Ctrl+C`로 종료합니다.

### Android 실행 준비

Expo Go는 프로젝트 SDK와 호환되는 Expo Go 앱이 필요합니다. 개발 앱은 프로젝트의 네이티브 모듈을 포함하여 직접 설치하는 앱이며, `npm run android`로 처음 설치한 뒤 일반 JavaScript·TypeScript 수정은 `npm start`와 Fast Refresh로 확인합니다. 네이티브 의존성이나 네이티브 설정을 변경하면 다시 빌드합니다.

Android 개발 앱을 빌드하려면 JDK 21과 Android Studio의 Android SDK를 설치하고 `JAVA_HOME`·`ANDROID_HOME`을 설정합니다. SDK의 `platform-tools`를 PATH에 추가합니다. 에뮬레이터는 Device Manager에서 만들며 실제 휴대폰은 USB 또는 무선 디버깅으로 연결하고 `adb devices -l`에 `device`로 표시되는지 확인합니다. `npm run android -- --device`로 실행할 기기를 선택할 수 있습니다. iOS 네이티브 빌드와 iOS 시뮬레이터 실행에는 macOS와 Xcode가 필요합니다. Windows에서 iPhone의 Expo Go를 사용할 때는 `npm run start:go`의 QR을 사용합니다.

Windows의 `npm run android`는 한글 경로 및 C++ 빌드 경로 길이 문제를 피하도록 사용자 드라이브의 `MobtwigDev/<프로젝트 경로 해시>`에 짧은 정션 경로를 자동으로 만듭니다. 정션은 원본 `client/`를 가리키며 파일을 복사하지 않습니다. 팀원마다 자신의 저장소 경로에 맞춰 생성되므로 다른 사람의 절대 경로를 설정할 필요가 없습니다. `metro.config.js`는 실제 원본 경로를 감시하여 코드 수정과 의존성 변경을 반영합니다.

한글이 포함된 원본 `client/` 폴더에서 위 명령을 실행합니다. `start`·`start:go`·`start:test`·`android:go`·`web`·`mock`·`typecheck`·`test`·`docs`와 `npx expo export --platform all`은 한글 원본 경로를 그대로 사용합니다. Android 네이티브 빌드는 짧은 경로를 준비하는 `npm run android`를 사용합니다. `npx expo run:android`나 `android/gradlew.bat`를 원본 경로에서 직접 실행하면 이 처리를 거치지 않습니다.

프로젝트의 한글 경로 처리와 개발 도구의 설치 조건은 별개입니다. Android SDK·JDK·Gradle 캐시의 위치는 각 PC의 설정을 사용하며, `ios`·`ios:go`는 앞서 설명한 macOS 실행 조건을 따릅니다.

에뮬레이터가 이전 화면에서 멈추고 실행 명령도 부팅을 계속 기다린다면 Device Manager의 해당 기기에서 **Cold Boot**로 다시 시작합니다. Quick Boot 복원 때마다 같은 문제가 재현되면 해당 기기의 편집 화면에서 **Boot option → Cold boot**를 선택합니다. 이 설정은 각 PC의 에뮬레이터 설정이며 저장소에서 일괄 변경하지 않습니다.

같은 포트에 개발 서버를 중복 실행하지 않습니다. 기존 서버를 `Ctrl+C`로 종료하거나 `npm run android:go -- --port 8083`처럼 별도 포트를 지정합니다. 실행 대상만 바꿀 때에는 실행 중인 Expo 터미널에서 `s`로 개발 앱·Expo Go를 전환하고 `a`로 Android를 열 수 있습니다. 공통 실행 스크립트는 Expo의 앱 선택용 브라우저 페이지를 생략하고 선택한 개발 앱 또는 Expo Go를 바로 엽니다.

## SDUI 테스트 실행

첫 번째 터미널의 `client/`에서 `npm run mock`을 실행합니다. 두 번째 터미널에서는 다음과 같이 실행합니다. `.env`가 이미 있으면 복사하지 말고 필요한 값을 확인합니다.

```powershell
Copy-Item .env.example .env
npm run start:test -- --go
```

앱을 열면 `간이 서버`와 `실제 개발 서버` 중 하나를 선택합니다. 선택은 이번 앱 세션에만 유지되며 앱을 다시 불러오면 다시 선택합니다. 선택하기 전에는 홈 요청을 보내지 않습니다. 일반 `npm start`·`android`·`ios`·`web` 실행은 선택 화면 없이 `EXPO_PUBLIC_API_URL`로 연결합니다. `.env`의 `EXPO_PUBLIC_ENABLE_SERVER_SELECTION`은 기본값 `false`를 유지합니다. 테스트 실행 명령이 자식 Expo 프로세스에만 `true`를 전달합니다. 별도로 테스트 번들을 만들 때도 이 값을 명시적으로 `true`로 지정할 수 있으며 일반 배포에서는 `false`를 사용합니다.

USB로 연결한 Android 휴대폰이나 에뮬레이터에서 간이 서버를 사용하려면 개발 PC의 별도 터미널에서 실행합니다.

```powershell
adb devices -l
adb -s <기기ID> reverse tcp:8090 tcp:8090
```

`EXPO_PUBLIC_MOCK_API_URL=http://127.0.0.1:8090`을 사용하면 기기의 8090 포트가 개발 PC의 간이 서버로 연결됩니다. USB 없이 사용할 때는 서버 README의 LAN 실행 방법과 접근 가능한 PC 주소를 사용합니다. 실제 개발 서버 주소도 기기에서 접근 가능해야 합니다. 예를 들어 Android 에뮬레이터의 `10.0.2.2`는 개발 PC를 가리키지만 실제 휴대폰에서는 같은 뜻이 아닙니다. Metro 연결 주소와 데이터 API 주소는 별개입니다.

Spring Boot 서버와 간이 서버 모두 `GET /sdui/home?kind=all|book|magazine|novel`을 제공합니다. Spring 서버는 `SDUI_HOME_PATH`의 홈 구성 파일을 요청마다 읽고 `dataSource.type`이 `publishedWorks`인 구역에 DB의 공개 작품을 채웁니다. 간이 서버는 `server/mock/fixtures/home.json`을 사용합니다. 조회가 실패하면 오류와 다시 불러오기 버튼을 표시합니다.

테스트를 끝낼 때 두 터미널에서 각각 `Ctrl+C`를 누르고 필요하면 `adb -s <기기ID> reverse --remove tcp:8090`으로 연결을 해제합니다.

## 코드 구성

| 파일 | 역할 |
| --- | --- |
| `index.ts` | Expo에 루트 컴포넌트를 등록합니다. |
| `App.tsx` | 안전 영역, 공통 메뉴, 화면 선택, 패널을 구성합니다. |
| `src/appState.tsx` | 화면 스택·탭·패널·뒤로 가기와 기기에 저장하는 읽기 설정·서재 탭을 관리합니다. |
| `src/serverConnection.tsx` | 테스트 실행의 서버 선택과 일반 실행의 API 주소 공급을 담당합니다. |
| `src/homeSchema.ts` | 홈의 표시 계약과 수신 JSON 검증을 담당합니다. |
| `src/HomeContent.tsx` | 홈을 조회하고 공통 요소로 렌더링합니다. |
| `src/workDetails.ts` | 작품 ID별 상세 조회와 정보 응답 검증을 담당합니다. |
| `src/EmptyState.tsx` | 표시할 데이터가 없을 때 쓰는 공통 빈 요소입니다. |
| `src/ui.tsx` | 버튼·제목·칩·아이콘과 공통 스타일입니다. |
| `src/CatalogScreens.tsx` | 홈·검색·상세·서재·독서 기록·공유 화면을 연결합니다. |
| `src/AccountScreens.tsx` | 회원 인증·계정 정보와 기기에 저장하는 읽기 설정 화면입니다. |
| `src/CommunityScreens.tsx` | 게시판·게시글·이미지·댓글·공감·신고 API와 화면을 연결합니다. |
| `src/ReviewScreens.tsx` | 리뷰·댓글의 조회·작성·수정·삭제와 공감·신고를 연결합니다. |
| `src/ReadingScreens.tsx` | 텍스트·매거진 PNG 열람, 회차 이동·위치 저장과 미연동 앱북 미디어·설정집 화면입니다. |

`Route`는 화면 이동과 작품 상세 조회에 필요한 식별자를 전달하는 타입입니다. 홈의 SDUI 타입과 작품 상세 조회 응답은 표시용 계약이며 DB 테이블을 정의하지 않습니다. 상·하단 메뉴와 상세 화면 배치는 앱에 남고 홈 본문 구역은 서버 응답으로 결정합니다.

## 홈의 공통 요소

| 응답의 `type` | 클라이언트가 제공하는 요소 |
| --- | --- |
| `bannerCarousel` | 배경 이미지·제목·선택적 설명과 이동 버튼을 가진 가로 배너 목록입니다. |
| `featuredWork` | 기존 '오늘의 책'처럼 왼쪽 추천 문구·작품 정보와 오른쪽 표지를 배치합니다. |
| `workShelf` | 표지·제목·선택적 보조 문구를 가진 가로 작품 목록입니다. |
| `linkRow` | 기존 앱 화면으로 이동하는 바로가기 목록입니다. |

전체·도서·매거진·웹소설 홈 모두 `{ version: 1, sections: [...] }`을 받습니다. `sections`의 순서와 개수, 구역 제목, `items`의 내용과 개수를 그대로 표시합니다. 추천과 최근 본 작품은 같은 `workShelf`를 사용합니다. `items: []`이면 클라이언트가 요소별 공통 빈 상태 안내를 표시하고 빈 표지·배너를 만들지 않습니다. 빈 상태 문구는 서버에서 전달하지 않습니다. 구역 자체를 없애려면 `sections`에서 제거합니다. `sections: []`이면 홈 구성 없음 안내를 표시합니다.

간이 서버의 도서·매거진·웹소설 홈은 첫 구역에 `featuredWork`를 보냅니다. '오늘의 책' 등의 추천 문구는 서버 항목의 `label`입니다. 제목·표지·보조 문구·버튼과 항목 개수도 응답으로 바꿀 수 있습니다. 작품 카드와 추천 작품을 누르면 해당 항목의 `id`로 상세 화면을 엽니다.

상세 화면은 `GET /works/:id`에서 작품 정보를 조회합니다. 도서·매거진·웹소설의 화면 배치는 클라이언트에 두고 제목·표지·저자·소개·출판정보·목차·통계는 서버 응답으로 채웁니다. 매거진의 소개 제목·아티클 분류·쪽수, 웹소설 회차의 공개일·글자 수도 전달받은 정보만 표시합니다. 상세 응답에는 SDUI 구역이나 배치 명령이 없습니다. 간이 서버의 `fixtures/works.json`에는 표지 16개에 대응하는 테스트용 가상 정보가 있습니다.

`server/mock/fixtures/home.json`을 바꾸고 다른 홈 탭을 갔다가 돌아오거나 앱을 다시 불러오면 서버 재시작 없이 변경을 확인할 수 있습니다. 제목과 개수는 앱 코드 수정이 필요 없습니다. 새로운 요소 유형이나 새로운 동작을 추가하려면 클라이언트의 계약·렌더러도 구현해야 합니다. 서버에서 임의 코드를 보내 실행하는 구조는 아닙니다.

## 현재 동작 범위

- 상·하단 메뉴와 분류 탭으로 화면을 이동합니다.
- 홈·작품 검색·상세는 선택한 서버의 응답을 표시하고 로딩·오류·빈 목록을 구분합니다. 검색 요청에는 검색어·작품 종류와 선택한 장르를 전달합니다.
- 회원가입·로그인·로그아웃과 현재 회원 정보를 서버에 연결합니다. 시연 회원가입은 서버의 `SIGNUP_DEMO_ENABLED=true` 설정이 필요합니다.
- 회원의 서재·찜·웹소설 구독·최근 본 작품·구매 내역을 API로 조회하거나 변경합니다.
- 텍스트 본문과 매거진 PNG를 열고 회원의 읽기 위치·책갈피·하이라이트를 서버에 저장합니다. 유료 본문은 소장 권한이 필요합니다.
- 리뷰·댓글과 커뮤니티 게시글·댓글·이미지·공감·신고를 API에 연결합니다. 작품 링크 공유와 링크를 통한 상세 진입도 제공합니다.
- 읽기 설정의 테마·글꼴 이름·크기와 마지막 서재 탭은 계정과 관계없이 현재 기기에 저장하고 다음 실행에 복원합니다. 서버의 회원 읽기 설정 테이블과 자동 동기화하지 않습니다.
- 계정 설정에서 현재 비밀번호를 확인한 뒤 새 비밀번호로 변경하고 모든 기기의 회원 세션을 종료합니다. 탈퇴·비밀번호 복구·소셜 로그인은 비활성 상태입니다. 설정집·앱북 이미지/영상/오디오·이벤트·알림은 미연동 화면입니다.
- 웹소설 검색의 장르 칩은 선택하면 결과를 다시 조회하고 같은 칩을 다시 누르면 해제합니다. 처음에는 모든 장르를 포함하며 다른 작품 종류 탭에는 장르 조건을 보내지 않습니다. 결과는 출간일·ID 최신순입니다.
- 상세 검색 패널의 카테고리·가격·정렬 적용은 비활성 상태입니다. 읽기 설정의 글꼴 8개는 번들에 포함한 실제 글꼴을 사용합니다.

미연동 화면의 빈 요소는 API 오류를 감지한 결과가 아닙니다. SDUI 홈에서는 정상 빈 목록과 통신·계약 오류를 별도로 처리합니다. 지원하지 않는 버전·요소와 중복 키는 오류로 표시하며 정상 빈 목록으로 바꾸지 않습니다.

브랜드 아이콘·헤더 이미지는 클라이언트의 `assets/brand/`, 읽기 글꼴은 `assets/fonts/`에 포함합니다. 테스트 표지 16개와 배경 1개는 서버에서 URL로 전달합니다. 화면은 세로 방향과 최대 너비 480의 모바일 배치를 사용합니다.

## 읽기 글꼴

앱은 공식 원본 글꼴 8개를 `assets/fonts/`에 포함합니다. 앱 초기화에서 설정 복원과 글꼴 로드를 함께 완료한 뒤 화면을 열며, 본문·글꼴 타일·테마·크기 미리보기가 같은 등록 이름을 사용합니다. 로드 실패는 기존 오류 화면에서 다시 확인할 수 있습니다.

| 표시 이름 | 실제 글꼴 원본 | 기기 저장 이름 | 원문 라이선스 |
| --- | --- | --- | --- |
| 기본 명조 | [Noto Serif KR](https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Serif/SubsetOTF/KR/NotoSerifKR-Regular.otf) | `기본 명조` | [OFL](https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Serif/LICENSE) |
| 기본 고딕 | [Noto Sans KR](https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/SubsetOTF/KR/NotoSansKR-Regular.otf) | `기본 고딕` | [OFL](https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/LICENSE) |
| 나눔명조 | [NanumMyeongjo](https://raw.githubusercontent.com/google/fonts/06bfe0d62a98375cb09c942fa18e68bd32cff057/ofl/nanummyeongjo/NanumMyeongjo-Regular.ttf) | `나눔명조` | [OFL](https://raw.githubusercontent.com/google/fonts/06bfe0d62a98375cb09c942fa18e68bd32cff057/ofl/nanummyeongjo/OFL.txt) |
| 나눔고딕 | [NanumGothic](https://raw.githubusercontent.com/google/fonts/06bfe0d62a98375cb09c942fa18e68bd32cff057/ofl/nanumgothic/NanumGothic-Regular.ttf) | `나눔고딕` | [OFL](https://raw.githubusercontent.com/google/fonts/06bfe0d62a98375cb09c942fa18e68bd32cff057/ofl/nanumgothic/OFL.txt) |
| 고운바탕 | [Gowun Batang](https://raw.githubusercontent.com/google/fonts/06bfe0d62a98375cb09c942fa18e68bd32cff057/ofl/gowunbatang/GowunBatang-Regular.ttf) | `고운바탕` | [OFL](https://raw.githubusercontent.com/google/fonts/06bfe0d62a98375cb09c942fa18e68bd32cff057/ofl/gowunbatang/OFL.txt) |
| 고운돋움 | [Gowun Dodum](https://raw.githubusercontent.com/google/fonts/06bfe0d62a98375cb09c942fa18e68bd32cff057/ofl/gowundodum/GowunDodum-Regular.ttf) | `고운돋움` | [OFL](https://raw.githubusercontent.com/google/fonts/06bfe0d62a98375cb09c942fa18e68bd32cff057/ofl/gowundodum/OFL.txt) |
| 함렛 | [Hahmlet](https://raw.githubusercontent.com/google/fonts/06bfe0d62a98375cb09c942fa18e68bd32cff057/ofl/hahmlet/Hahmlet%5Bwght%5D.ttf) | `함렛` | [OFL](https://raw.githubusercontent.com/google/fonts/06bfe0d62a98375cb09c942fa18e68bd32cff057/ofl/hahmlet/OFL.txt) |
| 프리텐다드 | [Pretendard](https://raw.githubusercontent.com/orioncactus/pretendard/7aeb0698819be2b4097dae8ec8fe6a795e5cf3ae/packages/pretendard/dist/public/static/Pretendard-Regular.otf) | `플렉스고딕` | [OFL](https://raw.githubusercontent.com/orioncactus/pretendard/7aeb0698819be2b4097dae8ec8fe6a795e5cf3ae/LICENSE) |

기존 `mobtwig:reading-preferences:v1` 저장 형식과 이름을 유지합니다. `플렉스고딕` 저장값은 프리텐다드에 연결하므로 설정을 초기화하지 않습니다. 등록 이름·저작권·OFL 원문은 `src/readingFonts.ts`에서 관리하며 고지도 앱 번들에 포함합니다. 실행 중 사용하지 않는 원본·라이선스 주소는 위 표에 기록합니다. 글꼴의 문자 지원 범위는 각 원본을 따릅니다.

글꼴은 [Noto CJK](https://github.com/notofonts/noto-cjk), [Google Fonts](https://github.com/google/fonts), [프리텐다드](https://github.com/orioncactus/pretendard)의 원본을 사용합니다. 원본 자산은 합계 약 38 MB이며 배포 파일 크기는 압축 방식에 따라 달라집니다.

## 서버 연동 전제

`EXPO_PUBLIC_API_URL`은 일반 실행 및 테스트의 실제 개발 서버 주소이고, `EXPO_PUBLIC_MOCK_API_URL`은 테스트의 간이 서버 주소입니다. 환경 변수는 번들에 반영되므로 변경 후 앱을 완전히 다시 불러옵니다. 이미 배포한 번들의 주소는 서버 환경 변수만 바꿔 변경할 수 없습니다.

Spring 서버는 홈 `GET /sdui/home`, 검색 `GET /works`, 상세 `GET /works/{slug}`와 공개 조회 API를 제공합니다. 회원 인증은 `/api/auth/` 아래 `csrf`, `login`, `logout`, `session`, 시연 가입은 `terms`, `signup`을 사용합니다. 회원 데이터 변경은 `/api/members/` 경로에서 현재 회원 세션과 CSRF를 사용하며 [API 명세서](../docs/API%20명세서.md)를 따릅니다.

`EXPO_PUBLIC_` 값은 앱에 포함되므로 비밀번호나 비밀키를 넣지 않습니다.

## 코드 문서와 생성 파일

소스의 문서 주석은 TSDoc 형식으로 작성합니다. 요약 다음에 필요한 상세 설명은 `@remarks`, 매개변수는 `@param 이름 - 설명`, 반환값은 `@returns`로 작성합니다. 속성은 해당 선언 바로 위에 설명하고, 관련 코드 연결에는 `{@link 심볼명}`을 사용합니다. 인터페이스 속성의 기본값은 `@defaultValue`, 실제로 던지는 예외는 `@throws`, 사용 예시는 `@example`으로 설명합니다.

TypeDoc은 `index.ts`, `App.tsx`, `src/` 전체에서 공개한 화면·공통 컴포넌트·UI 타입과 속성을 문서화합니다. 구조 분해 매개변수는 `@param props - 설명`으로 문서화하고 각 속성 선언에 개별 설명을 작성합니다. 비공개 구현 함수의 설명은 소스에서 확인합니다. 서버 API 문서가 아닙니다.

`npm run typecheck`로 타입을 확인한 뒤 `npm run docs`로 문서를 생성하고 `docs-api/index.html`을 엽니다. 문서 누락·잘못된 링크·잘못된 경로와 문서 생성 경고가 있으면 명령이 실패하도록 설정했습니다. 공개 매개변수도 문서 누락 검사에 포함합니다.

`node_modules/`, `.expo/`, `dist/`, `docs-api/`, 자동 생성된 `android/`·`ios/`, 로컬 `.env`는 Git에서 제외합니다.

## 템플릿 저작권 고지

공식 `expo-template-blank-typescript@57.0.27`을 바탕으로 구성했습니다. `LICENSE.expo-template`은 원본 템플릿의 MIT 저작권 고지이며 프로젝트 전체의 라이선스를 지정하지 않습니다.

## #35 텍스트 열람과 회차 이동

상세의 첫 장/첫 화 읽기 또는 목차 항목은 workId와 chapterId를 reader 화면에 전달합니다. GET /works/{slug}/chapters/{chapterId}의 body를 재정규화하거나 HTML로 해석하지 않고 텍스트로 표시합니다. 공개 목차 순서의 이전/다음 회차, 경계 비활성, 현재 장 정보, 목차 선택, 로딩/오류/재시도/15초 제한과 이탈 취소를 제공합니다. 목차는 본문 응답에 포함돼 상세 조회수를 추가 집계하지 않습니다. 현재 장 버튼은 맨 위로만 이동하고 진도/페이지를 기록하지 않습니다. 세계관 미연동 화면을 왕복해도 읽던 작품과 회차로 돌아옵니다.

기존 DB 정수 contentVersion과 정규화 본문의 contentHash를 구분하며 문자 수는 body.length(UTF-16)입니다. 기존 파일 URL이 HTML/EPUB/외부 HTTP이면 415 안내를 표시합니다. 독서 위치·책갈피·하이라이트는 회원 API와 연결되어 있습니다. 페이지뷰·AI·설정집은 이 텍스트 열람 기능에서 구현하지 않습니다.

간이 서버는 fixtures/chapter-text.json의 명시적인 검증 예문을 반환합니다. 실제 본문·운영 데이터가 아닙니다. 실제 서버 DB 검사는 전용 MySQL을 쓰는 ReaderApiTest와 node server/src/test/js/reader-contract.mjs --with-db를 함께 실행합니다.

## #40 하이라이트

텍스트 뷰어의 현재 문단 하이라이트에서 범위와 노랑·초록을 선택합니다. 웹의 읽기 전용 입력에서는 드래그로 선택할 수 있습니다. 네이티브에서는 문단을 길게 누르거나 버튼을 누른 뒤 전체 선택과 시작·끝 조정으로 범위를 지정합니다. 조정은 유니코드 문자의 경계에서 이루어집니다. 선택 패널은 한 문단만 표시하며, 저장을 마치면 기존 뷰어의 스크롤 위치로 돌아옵니다.

매거진은 이미지를 불러온 현재 쪽에 색을 기록합니다. 독서 기록에서 전체 또는 현재 작품의 하이라이트를 확인하고, 저장 위치 열기·삭제·문장 공유 화면으로 이동합니다. 텍스트 위치를 열면 해당 문단 시작으로 스크롤하고 선택했던 범위에 색을 표시합니다. 기기 공유와 작품 링크 복사를 제공합니다.

## #39 책갈피

텍스트 뷰어는 현재 문단 경계나 본문 끝을, 매거진 뷰어는 이미지가 열린 쪽을 저장합니다. 마이페이지의 독서 기록은 전체 책갈피를, 뷰어의 기록 버튼은 현재 작품의 책갈피를 엽니다. 책갈피를 열면 저장 위치로 이동하며 이어보기 위치는 그대로입니다. 본문을 확인할 수 없거나 개정된 기록은 삭제할 수 있습니다.

## #38 텍스트 이어보기

작품 상세의 이어보기는 회원의 저장 회차와 문단을 엽니다. 목차에서 회차를 직접 고르면 해당 회차 처음에서 읽습니다. 사용자의 스크롤이 멈추면 빈 줄 다음의 UTF-16 문단 경계 또는 회차 끝을 저장합니다. 짧은 회차와 스크롤 제스처를 인식하지 못한 환경에서는 저장 버튼을 사용할 수 있습니다. 긴 단일 문단 내부나 다른 뷰어가 저장한 문단 내부 위치는 해당 문단 처음으로 복원됩니다.

통신으로 저장하지 못하면 화면의 위치를 유지하고 서버 위치를 확인한 뒤 재시도할 수 있습니다. 저장 충돌이나 진입 시 revision 차이는 최신 서버 위치를 조회해 복원합니다. 본문 개정 시에는 현재 본문과 위치를 다시 확인하며, 실패한 옛 위치를 충돌 후 임의로 덮어쓰지 않습니다. 뷰어의 뒤로 가기·회차 이동 버튼은 예약된 저장이나 진행 중 저장의 결과를 먼저 확인합니다. 브라우저 새로고침, OS 뒤로 가기, 앱 종료에는 이 대기가 적용되지 않습니다.

## #38 매거진 쪽 이어보기

이번 호 읽기와 목차는 PNG 한 장씩 표시하는 전용 뷰어를 엽니다. 이어보기는 현재 버전의 저장 쪽으로 돌아갑니다. 이전·다음은 공개 쪽만 이동하며 숨김 기사 사이를 건너뜁니다. 초기 표시와 복원은 조회만 합니다. 로그인 후 사용자가 이동한 쪽은 이미지가 로드된 뒤 저장됩니다. 첫 쪽을 직접 기록하려면 현재 쪽 저장을 사용합니다.

호 전체 쪽 수와 관리자가 등록한 [PNG 콘텐츠](../docs/매거진%20PNG%20콘텐츠%20등록.md)가 필요합니다. 이미지가 실패하면 목차와 쪽을 다시 확인할 수 있습니다. 간이 서버에는 PNG 쪽 API가 없으므로 실제 쪽 검증에는 전용 개발 서버를 사용합니다.

## #56 커뮤니티 글 작성·게시

로그인한 회원이 진입한 작품별·주제별·홍보 게시판에 새 글을 등록합니다. 현재 게시판에 맞는 말머리와 스포일러 여부를 선택하며 홍보 글은 공개 작품을 검색해 연결합니다. 등록한 글은 커뮤니티에 공개됩니다. 스포일러 글은 다른 독자가 확인하기 전 제목·본문·첨부·이모티콘을 가리고, 비회원도 확인 후 열람할 수 있습니다. 작성자는 본인 내용을 바로 볼 수 있습니다.

제목은 100자, 본문 표시 텍스트는 10,000자까지이며 기존 API처럼 Unicode 코드 포인트로 셉니다. 양끝 Unicode 공백은 제외하고 내부 줄바꿈은 유지합니다. 본문에서 등록된 첨부와 일치하는 이미지 표식만 첨부 수만큼 제외합니다. 입력을 UTF-16 길이로 잘라 이모지를 조기 제한하지 않습니다. 초과 붙여넣기는 그대로 남기고 글자 수·초과 안내를 표시하며 게시를 막습니다. 내용을 수정하면 다시 등록할 수 있습니다.

게시 직전에도 공백·길이·첨부 중복·현재 게시판과 말머리·작품 연결·이모티콘을 검사합니다. 같은 회원 세션과 CSRF로 요청하고 게시 성공을 확인한 뒤 상세로 이동합니다. 진행 중에는 입력과 중복 제출을 막으며 실패 시 입력을 유지합니다. 회원·서버 전환 뒤 늦은 완료 응답은 이전 글 화면으로 이동시키지 않습니다. 서버는 게시 시점의 실제 게시판·작품 공개 상태와 소유권을 다시 검사합니다.

`communityWriting.test.mjs`는 실제 작성 화면 함수를 이용해 이모지·이미지 포함 경계, 공개 안내, 게시판별 선택, 실패·중복·회원 전환을 검사합니다. `community.test.mjs`는 API 전송 전 검증과 정상화한 요청·응답 파서를 검사합니다. 브라우저·실서버·실기기 검증 결과는 자동 검사와 구분합니다. API·DB 계약은 추가하거나 변경하지 않습니다.

## #58 커뮤니티 임시저장·복원

새 글 작성에서만 **서버 주소·회원·게시판별로 이 기기에 한 개**를 수동 저장합니다. 제목·본문의 공백과 줄바꿈, 말머리, 작품, 이미지 순서, 이모티콘과 스포일러 선택을 보관합니다. 자동 저장·다른 기기 동기화는 제공하지 않으며 기존 서버 초안 API를 호출하지 않습니다. 기기 저장소를 지우면 초안도 사라집니다. 같은 기기를 공유할 때는 앱의 회원별 구분과 별도로 기기 접근 권한을 관리해야 합니다.

저장 중에는 다른 작업을 막고 기기 저장 완료 후에만 저장됨을 표시합니다. 실패하면 현재 입력과 이전 초안을 유지하고 재시도합니다. 읽기 실패도 작성·등록을 막지 않으며 다시 확인할 수 있습니다. 확인하지 못한 초안은 임의로 덮어쓰지 않습니다. 손상된 초안은 원본 삭제를 확인한 뒤 새로 저장할 수 있습니다.

재진입 시 불러오기 또는 새 글 쓰기를 선택합니다. 불러오기는 현재 입력을 교체하며 현재 게시판의 작품·말머리·이모티콘 규칙에 맞지 않으면 원본을 보존하고 이유를 안내합니다. 새 글 쓰기로 남겨 둔 초안은 다른 글을 게시해도 삭제하지 않습니다. 복원하거나 이번 화면에서 저장한 초안은 게시 성공 후 정리합니다. 게시 실패 시 보존하며, 게시 후 정리만 실패하면 게시 완료 안내에서 정리를 재시도하거나 게시글로 이동합니다. 정리 재시도로 게시 요청을 반복하지 않습니다. 정리하지 않고 이동한 초안은 기기에 남으므로 다시 등록하지 않도록 확인해야 합니다.

저장할 때마다 버전을 붙여 삭제 재시도가 이후 저장한 초안(내용이 같은 새 저장 포함)을 지우지 않게 합니다. 동일 JS 실행 환경에서는 키별로 읽기·저장·비교 삭제를 순서대로 처리합니다. 별도 브라우저 탭이나 다른 앱 프로세스 사이의 동시 변경을 원자적으로 보장하지는 않습니다. 이전 형식 초안은 복원할 수 있습니다.

`communityDrafts.test.mjs`는 저장소 실패·버전 비교·저장과 삭제 경합을, `communityDraftScreen.test.mjs`는 실제 화면·조회·액션 함수를 실행해 저장 중·실패·복원·게시 후 정리 실패·회원 전환을 검사합니다. 브라우저 또는 실기기 확인 결과는 이 자동 검사와 구분합니다.

## #20 회원 인증

이메일로 로그인하며 성공한 서버 세션에서 마이/계정의 회원 정보를 읽습니다. 앱 시작·foreground 복귀·회원 화면 진입 시 세션을 확인합니다. 로그인 전 기존 회원 로그아웃을 확인하며 계정 변경 시 이전 요청과 화면 스택·패널을 정리합니다. 로그아웃 실패는 오류와 재시도를 표시합니다. 비밀번호와 쿠키는 JS 영구 저장소에 저장하지 않습니다.

웹 앱/API는 same-site 배포가 필요하며 서버의 AUTH_ALLOWED_ORIGINS에 앱 origin을 정확히 등록합니다. 네이티브는 플랫폼 쿠키 저장소를 사용합니다. Android/iOS 번들 통과는 실기기의 쿠키 로그인 검증을 대신하지 않습니다. 일반 간이 서버는 읽기 전용으로 인증 계정을 제공하지 않으므로 인증 시연은 전용 테스트 DB 서버를 사용합니다.

`npm test`는 회원 요청 경합과 로컬 HTTP 쿠키 전송도 검사합니다. 실제 Spring Security·JDBC 세션·MySQL 검사는 서버 CI의 MemberSessionApiTest가 담당합니다.

## #22 비밀번호 변경

계정 설정의 비밀번호 변경은 `POST /api/auth/password`에 현재 비밀번호·새 비밀번호·확인값을 JSON으로 보냅니다. 같은 회원 세션의 CSRF가 필요합니다. 비밀번호를 trim하지 않으며 새 값은 영문·숫자 포함 유니코드 8문자 이상, UTF-8 72바이트 이하이고 현재 비밀번호와 달라야 합니다. 서버의 필드 오류는 입력 아래에 표시합니다.

204를 확인하면 모든 기기의 회원 세션이 종료되고 앱은 개인 요청·화면·입력을 정리한 뒤 이메일을 채운 로그인 화면에서 성공을 안내합니다. 별도의 관리자 세션은 유지합니다. 통신 실패는 성공으로 표시하지 않고 개인 상태를 비운 뒤 재로그인으로 변경 여부를 확인합니다. 비밀번호·쿠키를 영구 저장하지 않습니다. 변경과 겹친 세션 확인·계정 전환·화면 해제 및 늦은 응답은 이전 인증을 되살리지 않습니다.

`npm test`의 `memberPassword.test.mjs`는 정책 경계, CSRF 요청, 성공·거절·불확실한 결과와 화면 전환 경합을 검사합니다. 서버 `MemberPasswordApiTest`는 전용 MySQL과 실제 HTTP로 모든 회원 세션 폐기, 관리자 영역 보존, 늦은 세션 저장과 동시 로그인·변경을 검사합니다. 실제 브라우저·네이티브 기기 검증 결과는 별도 기록합니다.

## #19 시연 회원가입

서버를 `SIGNUP_DEMO_ENABLED=true`로 실행한 전용 개발·검증 환경에서 가입을 확인합니다. 기본값은 false입니다. 앱은 서버에서 임시 약관과 개인정보 수집·이용 동의 원문을 읽습니다. 동의한 버전과 해시를 가입 요청에 보내며, 문서가 바뀌면 최신 문서를 다시 불러와 체크합니다. 가입 성공 후 이메일을 채운 로그인 화면으로 이동합니다.

서버는 회원·기본 읽기 설정·동의 원문을 한 트랜잭션으로 저장합니다. 실제 약관 교체와 재동의는 [#96](https://github.com/whitetiger0804/Mobtwig/issues/96)에서 다룹니다.
