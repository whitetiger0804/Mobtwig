# Mobtwig 모바일 앱

React Native와 Expo를 사용하는 TypeScript 앱입니다. 시작 화면에는 `Mobtwig` 제목을 표시합니다.

## 팀 공통 버전

| 도구 | 버전 |
| --- | --- |
| Node.js | 24.21.0 LTS |
| npm | 12.1.0 |
| Expo | 57.0.25 (SDK 57) |
| React Native | 0.86.3 |
| React | 19.2.3 |
| TypeScript | 6.0.3 |

직접 의존성은 `package.json`에서 고정하고 전체 의존성은 `package-lock.json`으로 공유합니다. 버전을 맞춰 설치할 때에는 `npm ci`를 사용합니다. [Expo SDK 호환표](https://docs.expo.dev/versions/v57.0.0/)와 [SDK 57 릴리스](https://expo.dev/changelog/sdk-57)를 기준으로 구성했습니다.

## PC에 직접 설치할 도구

- [Node.js 24.21.0 LTS](https://nodejs.org/en/blog/release/v24.21.0)를 설치합니다. npm 12.1.0을 설치합니다. `node --version`과 `npm --version`으로 위 표와 일치하는지 확인합니다.
- Android 에뮬레이터를 사용하려면 [Android Studio와 에뮬레이터](https://docs.expo.dev/workflow/android-studio-emulator/)를 설치하고 가상 기기를 실행합니다. 실제 Android 기기를 사용하려면 SDK 57에 맞는 [Expo Go](https://expo.dev/go)를 준비합니다.
- iOS 시뮬레이터는 macOS와 [Xcode](https://docs.expo.dev/workflow/ios-simulator/)가 필요합니다. Windows에서는 iOS 시뮬레이터를 실행할 수 없습니다.

Expo CLI는 이 프로젝트의 `expo` 패키지에 포함되어 있으므로 전역 설치할 필요가 없습니다.

## 설치와 실행

저장소 루트에서 PowerShell로 실행합니다.

```powershell
cd client
npm ci
npm start
```

| 명령 | 용도 |
| --- | --- |
| `npm start` | Expo 개발 서버와 기기 연결 안내를 표시합니다. |
| `npm run android` | 실행 중인 Android 에뮬레이터 또는 연결된 기기로 앱을 엽니다. |
| `npm run ios` | macOS의 iOS 시뮬레이터에서 앱을 엽니다. |
| `npm run web` | 웹 브라우저에서 시작 화면을 확인합니다. |
| `npm run typecheck` | TypeScript 타입을 검사합니다. |
| `npx expo export --platform all` | Android·iOS·웹 배포용 번들을 `dist/`에 생성합니다. |

번들 생성은 APK·IPA 네이티브 빌드 및 실기기 검증과 구분됩니다. 개발 서버는 `Ctrl+C`로 종료합니다.

## 백엔드 주소

API 기능을 구현할 때 `client/.env.example`을 `client/.env`로 복사하고 실행 환경에 맞게 `EXPO_PUBLIC_API_URL`을 설정합니다. 현재 제목 화면은 API 요청을 하지 않습니다.

| 실행 환경 | 개발 PC의 백엔드 주소 |
| --- | --- |
| Android Studio 에뮬레이터 | `http://10.0.2.2:8080` |
| 개발 PC의 웹 브라우저·iOS 시뮬레이터 | `http://localhost:8080` |
| 같은 네트워크의 실제 휴대폰 | `http://개발_PC의_LAN_IP:8080` |

실제 휴대폰에서는 해당 주소로 접근할 수 있어야 합니다. 코드에서는 `process.env.EXPO_PUBLIC_API_URL`로 읽습니다. `EXPO_PUBLIC_` 값은 앱에 포함되어 공개되므로 DB 비밀번호나 인증 비밀키를 넣지 않습니다. [Expo 환경 변수 문서](https://docs.expo.dev/guides/environment-variables/)를 참고합니다.

`.env`, `node_modules/`, `.expo/`, `dist/` 및 자동 생성된 `android/`, `ios/` 폴더는 Git에서 제외합니다. 의존성 변경 시 `package.json`과 `package-lock.json`을 함께 커밋합니다.

## 템플릿 저작권 고지

공식 `expo-template-blank-typescript@57.0.27`을 바탕으로 구성했습니다. `LICENSE.expo-template`은 이 원본 템플릿의 MIT 저작권 고지입니다. Mobtwig 프로젝트 전체의 라이선스를 지정하는 문서는 아닙니다.
