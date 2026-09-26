# Mobtwig
Mobile+twig(작은 가지)입니다. React Native + Expo 모바일 앱, Spring Boot API 서버, MySQL 개발 DB의 공통 실행 환경을 관리합니다.

## 프로젝트 구성

```text
teamproject/
├─ client/       # React Native + Expo 앱
├─ server/       # Spring Boot API 서버와 Maven Wrapper
│  ├─ db/        # 로컬 MySQL Compose와 Python 보조 도구 의존성
│  └─ deploy/    # 공용 서버 Compose와 배포 스크립트
├─ .github/workflows/ # develop·PR 검사와 master 배포
├─ docs/         # 문서
└─ README.md
```

## 팀 공통 버전

| 구분 | 버전과 관리 방법 |
| --- | --- |
| Node.js / npm | `24.21.0` / `12.1.0`입니다. `.nvmrc`와 `client/package.json`에 명시합니다. |
| 모바일 앱 | Expo `57.0.25`, React Native `0.86.3`, React `19.2.3`, TypeScript `6.0.3`입니다. `package-lock.json`을 공유합니다. |
| 백엔드 | Java `21`, Spring Boot `4.1.1`입니다. `server/pom.xml`로 의존성을 관리합니다. |
| 빌드 | Maven Wrapper가 Maven `3.9.16`을 내려받습니다. 배포 파일의 SHA-256도 검사합니다. |
| DB | MySQL `8.4.11` LTS입니다. Compose에 이미지 태그와 digest를 고정합니다. |
| DB 보조 도구 | Python `3.13.15`를 기준으로 합니다. SQLAlchemy·PyMySQL 및 간접 의존성은 `server/db/requirements.txt`로 고정합니다. |

Java는 팀 공통 주 버전인 21을 사용하고, 보안 패치는 각 PC에서 유지합니다. 설치된 패키지나 실제 DB 파일을 복사하지 않고 위 설정 파일로 각자 환경을 구성합니다.

## PC에 직접 설치할 항목

Windows 개발 PC에서는 다음 항목을 사용자가 설치합니다. 설치 후 새 PowerShell을 엽니다.

| 항목 | 설치와 확인 |
| --- | --- |
| Git | [Git for Windows](https://git-scm.com/install/windows)를 설치하고 `git --version`을 확인합니다. |
| Node.js | [Node.js 24.21.0 LTS](https://nodejs.org/en/blog/release/v24.21.0)를 설치합니다. npm `12.1.0`을 설치하여 사용합니다. |
| JDK 21 | [Temurin JDK 21](https://adoptium.net/temurin/releases/?version=21)을 설치합니다. `JAVA_HOME`을 JDK 설치 폴더로, `PATH`를 그 폴더의 `bin`을 사용하도록 설정합니다. |
| Docker Desktop / WSL 2 | [Windows 설치 안내](https://docs.docker.com/desktop/setup/install/windows-install/)에 따라 설치하고 Linux 컨테이너 엔진을 실행합니다. 하드웨어 가상화·WSL 요구사항을 확인합니다. |
| 모바일 실행 도구 | 실제 기기의 [Expo Go](https://expo.dev/go) 또는 [Android Studio 에뮬레이터](https://docs.expo.dev/workflow/android-studio-emulator/)를 준비합니다. 웹으로 시작 화면만 확인할 때는 필요하지 않습니다. |
| Python — DB 보조 작업 시 | [Python 3.13.15](https://www.python.org/downloads/release/python-31315/)와 Python Launcher를 설치합니다. Java API 서버 실행에는 필요하지 않습니다. |

Maven, Expo CLI, MySQL 서버, Python 패키지는 전역으로 별도 설치하지 않습니다. Maven Wrapper와 프로젝트 의존성, Docker 컨테이너, Python 가상환경을 사용합니다. iOS 시뮬레이터는 macOS와 Xcode가 필요합니다.

```powershell
git --version
node --version
npm --version
java -version
docker version
docker compose version
```

Node·npm이 표의 버전과 일치하고 Java가 21인지 확인합니다. `docker version`은 클라이언트와 서버 정보가 모두 나와야 합니다. `.nvmrc` 자체가 Node를 설치하거나 전환하지는 않습니다.

## 최초 실행

저장소를 클론한 뒤 루트에서 시작합니다. 이미 클론했다면 해당 폴더를 사용합니다.

### 1. DB 설정과 실행

```powershell
cd server
Copy-Item .env.example .env
```

복사는 `server/.env`가 없는 최초 설정에서만 수행합니다. `.env`에서 비어 있는 `DB_PASSWORD`와 `DB_ROOT_PASSWORD`를 서로 다른 개인 비밀번호로 채웁니다. 두 도구의 설정 파일 형식을 함께 지원하도록 따옴표 없이 충분히 긴 영문 대소문자와 숫자로 작성합니다. 실제 비밀번호와 `.env`는 Git에서 제외합니다.

같은 `server` 폴더에서 실행합니다.

```powershell
docker compose --env-file .env -f db/compose.yaml config --quiet
docker compose --env-file .env -f db/compose.yaml up -d --wait --wait-timeout 180
docker compose --env-file .env -f db/compose.yaml ps
```

MySQL이 `healthy`이면 준비된 상태입니다. 개발 DB 주소는 `127.0.0.1:3307`, DB명은 `mobtwig_dev`, 계정은 `mobtwig_app`입니다. 기존 PC의 `3306` 서비스와 분리합니다. DB 데이터는 저장소 외부의 Docker 볼륨 `mobtwig-local84_mysql_data`에 유지됩니다. 기존 MySQL 8.0의 `mobtwig-local_mysql_data`는 그대로 보존하며 새 MySQL 8.4에 직접 연결하지 않습니다. 기존 컨테이너가 `3307`을 사용 중이라면 [DB 안내](server/db/README.md)의 이전 컨테이너 중지 절차를 먼저 수행합니다.

### 2. 백엔드 실행

같은 `server` 폴더에서 실행합니다. `.env`를 현재 작업 폴더에서 읽으므로 이 위치를 유지합니다. Wrapper 최초 실행에는 Maven·의존성을 내려받을 인터넷 연결이 필요합니다.

```powershell
.\mvnw.cmd -version
.\mvnw.cmd -B -ntp verify
.\mvnw.cmd spring-boot:run
```

`-version` 출력의 Maven이 `3.9.16`, Java가 `21`인지 확인합니다. API 서버는 `8080`에서 실행합니다. 별도 PowerShell에서 DB 연결을 포함한 준비 상태를 확인합니다.

```powershell
Invoke-RestMethod http://127.0.0.1:8080/actuator/health/readiness
```

`status`가 `UP`이면 정상입니다. 현재 업무용 API·엔티티·테이블은 없으며, DB 구조 확정 전이므로 최초 시작 시 적용할 Flyway 마이그레이션이 없다는 메시지는 정상입니다. `verify`는 현재 프로젝트의 컴파일·패키징을 확인하며 아직 업무 기능 테스트는 포함하지 않습니다.

### 3. 프론트엔드 실행

별도 PowerShell을 저장소 루트에서 엽니다.

```powershell
cd client
npm ci
npm run typecheck
npm start
```

Expo 안내에 따라 기기를 연결합니다. 브라우저에서 확인하려면 `npm start` 대신 `npm run web`을 실행합니다. 현재 앱은 `Mobtwig` 제목을 표시하며 API 요청을 하지 않습니다. API 기능을 추가할 때 [클라이언트 안내](client/README.md)의 기기별 주소에 맞춰 `client/.env`를 설정합니다. DB 비밀번호는 앱의 `EXPO_PUBLIC_` 변수에 넣지 않습니다.

## 팀 작업과 종료

- 프론트엔드 의존성을 변경하면 `package.json`과 `package-lock.json`을 함께 공유하고, 받은 팀원은 `npm ci`를 실행합니다. 새 의존성의 버전도 범위 없이 저장하도록 설정했습니다.
- 백엔드 의존성은 `pom.xml`과 Maven Wrapper로 공유합니다. 각자 설치된 Maven 대신 `mvnw.cmd`를 사용합니다.
- DB 구조는 [Flyway 마이그레이션 안내](server/src/main/resources/db/migration/README.md)에 따라 SQL 파일로 공유합니다. Hibernate는 구조 검증만 수행합니다. 실제 테이블의 자료형·제약을 확정한 뒤 첫 마이그레이션을 추가합니다.
- `.env.example`은 설정 항목만 공유합니다. 기존 볼륨의 DB·계정·비밀번호는 `.env` 수정만으로 변경되지 않습니다.
- Python 보조 작업 환경과 DB 접속 방법은 [DB 안내](server/db/README.md)를 따릅니다.

앱과 백엔드는 각 터미널에서 `Ctrl+C`로 종료합니다. DB는 `server` 폴더에서 다음과 같이 중지하며 데이터 볼륨은 유지합니다.

```powershell
docker compose --env-file .env -f db/compose.yaml down
```

`down --volumes`는 데이터를 삭제하므로 일상적인 종료에 사용하지 않습니다. `.env`, `node_modules`, `.venv`, 빌드 결과, 실제 DB 데이터와 백업은 Git에서 제외합니다.

## PR 검사와 공용 서버 배포

팀원은 각자 로컬 환경에서 개발하고 `develop` 대상 PR을 올립니다. `develop` 푸시와 `develop`·`master` 대상 PR에서 `client`·`server` 검사를 실행합니다. 초기 프로젝트 설정도 `develop`에 올려 검사를 확인할 수 있으며, 이 단계에서는 공용 서버에 배포하지 않습니다.

배포할 때에는 검증한 `develop`에서 `master`로 PR을 올리고 검사와 리뷰를 통과한 코드를 병합합니다. `master` 병합 후 같은 검사를 다시 실행하고, 검증된 JAR로 Docker 이미지를 게시하여 Windows 공용 서버에 배포합니다. 배포 마지막에는 DB 연결을 포함한 API readiness를 확인하고 결과를 기록합니다.

실행 흐름은 `.github/workflows/ci.yml`과 `.github/workflows/release.yml`에서 관리합니다. 서버는 배포물을 실행하므로 저장소 전체를 서버에 클론할 필요는 없습니다. 실제 Windows 서버 설치, GitHub Variables·Secrets, Tailscale 연결, 브랜치 보호 설정은 [배포 안내](docs/배포%20안내.md)에 따라 최초 한 번 준비합니다. 설정이 없는 상태에서 `master`에 병합하면 배포 단계가 실패하므로 최초 병합 전에 준비합니다.
