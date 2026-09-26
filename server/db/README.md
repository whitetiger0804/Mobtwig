# 로컬 DB 개발 환경

팀원별 PC에서 같은 MySQL 환경을 실행합니다. 개인 서버 컴퓨터의 공용 DB와 API는 별도 `server/deploy/compose.yaml`을 사용하며 [배포 안내](../../docs/배포%20안내.md)에 따라 준비합니다.

| 항목 | 공통 설정 |
| --- | --- |
| DB 이미지 | MySQL `8.4.11` LTS, 이미지 digest까지 고정합니다. |
| 호스트 주소·포트 | `127.0.0.1:3307`입니다. 컨테이너 내부 포트는 `3306`입니다. |
| 개발 DB·계정 | `mobtwig_dev` / `mobtwig_app`입니다. |
| 문자셋·정렬 | `utf8mb4` / `utf8mb4_0900_ai_ci`입니다. |
| 시간대 | UTC입니다. |
| 데이터 보관 | Docker named volume `mobtwig-local84_mysql_data`에 보관합니다. |
| 구조 변경 | 백엔드의 Flyway SQL 마이그레이션으로 관리합니다. |

기존 PC의 MySQL 서비스가 `3306`을 사용해도 함께 실행할 수 있도록 호스트 포트를 `3307`로 정했습니다. 포트는 로컬 PC의 `127.0.0.1`에만 공개합니다.

MySQL 8.0에서 사용한 `mobtwig-local_mysql_data`는 보존합니다. 8.4는 별도 프로젝트 `mobtwig-local84`와 새 볼륨을 사용합니다. 기존 데이터가 필요하면 8.0에서 논리 백업을 만들고 별도 8.4 시험 DB에서 복원을 검증합니다. 이미지 버전만 바꿔 기존 8.0 볼륨을 연결하지 않습니다.

## 사용자가 설치할 도구

Windows 개발 PC에는 [Docker Desktop 공식 설치 안내](https://docs.docker.com/desktop/setup/install/windows-install/)에 따라 Docker Desktop과 WSL 2를 설치합니다. 하드웨어 가상화 및 WSL 요구사항을 확인하고 Linux 컨테이너 엔진을 사용합니다. 설치·재부팅·Docker Desktop 시작은 사용자가 직접 진행합니다.

새 PowerShell에서 다음을 확인합니다. `docker version`은 클라이언트와 서버가 모두 나와야 합니다.

```powershell
docker version
docker compose version
```

DB 보조 도구 담당자만 [Python 3.13.15의 Windows 설치 프로그램](https://www.python.org/downloads/release/python-31315/)을 추가로 설치합니다. MySQL 서버나 Maven, Python 패키지를 전역으로 추가 설치할 필요는 없습니다.

## DB 실행

아래 명령은 저장소의 `server` 폴더에서 실행합니다. 백엔드와 DB는 같은 `server/.env`를 사용합니다. `.env`가 없는 최초 설정에서만 예시 파일을 복사합니다.

이전에 `mobtwig-local` 프로젝트를 실행했다면 먼저 아래 명령으로 해당 프로젝트를 확인합니다. 실행 중인 이전 MySQL이 `3307`을 사용한다면 두 번째 명령으로 컨테이너를 중지합니다. 볼륨은 삭제하지 않습니다.

```powershell
chcp 65001 > $null
docker ps --filter label=com.docker.compose.project=mobtwig-local
docker compose -p mobtwig-local --env-file .env -f db/compose.yaml down
```

```powershell
Copy-Item .env.example .env
```

`.env`의 `DB_HOST=127.0.0.1`, `DB_PORT=3307`, `DB_NAME=mobtwig_dev`, `DB_USERNAME=mobtwig_app`을 사용합니다. 비어 있는 `DB_PASSWORD`와 `DB_ROOT_PASSWORD`에는 각각 사용자 개인의 서로 다른 비밀번호를 입력합니다. 공통 실행 방식에 맞춰 비밀번호는 따옴표 없이 충분히 긴 영문 대소문자와 숫자로 작성하며 실제 값과 `.env`는 Git에 올리지 않습니다. 비밀번호가 비어 있으면 Compose 실행이 거부됩니다.

```powershell
docker compose --env-file .env -f db/compose.yaml config --quiet
docker compose --env-file .env -f db/compose.yaml up -d --wait --wait-timeout 180
docker compose --env-file .env -f db/compose.yaml ps
```

`mysql` 서비스의 상태가 `healthy`여야 합니다. 상태 검사는 전용 앱 계정으로 실제 `SELECT 1`을 실행하므로 DB 생성과 인증까지 확인합니다. `config`는 비밀번호를 출력하지 않도록 `--quiet`을 사용합니다.

공식 이미지가 빈 볼륨에서 최초 실행될 때 DB와 전용 앱 계정을 생성합니다. 로컬 개발용 앱 계정에는 해당 DB의 권한이 부여되어 Flyway도 실행할 수 있으며, 다른 DB의 관리 권한은 부여하지 않습니다. `root`는 컨테이너 내부의 `localhost` 접속으로 제한합니다.

이미 생성된 볼륨에서는 `.env`를 바꿔도 기존 DB명·계정·비밀번호가 자동 변경되지 않습니다. 접속 정보 변경은 MySQL 계정 변경과 `.env` 변경을 함께 처리해야 합니다.

## 접속 확인

DB 도구에서는 호스트 `127.0.0.1`, 포트 `3307`, DB `mobtwig_dev`, 사용자 `mobtwig_app`과 `.env`에 설정한 앱 비밀번호를 사용합니다. CLI를 쓰려면 다음 명령에서 비밀번호를 입력합니다. DB명이나 계정명을 바꾼 경우 명령도 같은 값으로 맞춥니다.

```powershell
docker compose --env-file .env -f db/compose.yaml exec mysql mysql --user=mobtwig_app --password mobtwig_dev
```

```sql
SELECT VERSION(), DATABASE(), CURRENT_USER();
SELECT @@character_set_database, @@collation_database, @@session.time_zone;
SELECT 1;
```

버전 `8.4.11`, 프로젝트 DB, `utf8mb4`, `utf8mb4_0900_ai_ci`, `+00:00`과 쿼리 성공을 확인합니다. DB가 준비되면 백엔드를 실행해 Flyway를 적용합니다. SQL 마이그레이션 작성 기준은 [마이그레이션 안내](../src/main/resources/db/migration/README.md)를 따릅니다. 현재 개념적 ERD만으로 미확정 테이블을 임의 생성하지 않았습니다.

## Python 보조 도구 환경

SQLAlchemy와 PyMySQL은 향후 DB 담당자의 시드·검증 작업을 위한 도구입니다. 실서비스 API는 Java 백엔드가 담당합니다. `requirements.txt`는 직접·간접 패키지 버전을 고정하며, MySQL 기본 인증을 지원하도록 PyMySQL의 `rsa` 의존성을 포함합니다.

Python 3.13.15 설치 후 `server` 폴더에서 다음 명령을 실행합니다.

```powershell
py -3.13 --version
py -3.13 -m venv db/.venv
./db/.venv/Scripts/python.exe -m pip install -r db/requirements.txt
./db/.venv/Scripts/python.exe -m pip check
./db/.venv/Scripts/python.exe -c "from importlib.metadata import version; print('SQLAlchemy', version('SQLAlchemy')); print('PyMySQL', version('PyMySQL'))"
```

패키지는 `server/db/.venv` 안에만 설치합니다. 실행 정책 변경이나 가상환경 활성화가 필요하지 않도록 가상환경의 Python 경로를 직접 사용합니다. 이후 보조 스크립트도 동일한 `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD` 설정을 사용하며, DDL은 Flyway SQL 한 곳에서 관리합니다.

## 중지와 데이터 유지

```powershell
docker compose --env-file .env -f db/compose.yaml down
```

컨테이너를 제거해도 named volume의 DB 데이터는 유지됩니다. 재실행은 같은 `up` 명령을 사용합니다. `down --volumes`는 DB 데이터를 삭제하므로 일상적인 중지에는 사용하지 않습니다. 개발 환경을 되돌릴 때는 먼저 `down`으로 중지하고 추가한 설정 파일을 되돌립니다. 데이터 볼륨 삭제는 필요한 데이터를 백업한 뒤 별도로 판단합니다.

이미지 초기화와 데이터 유지 동작은 [MySQL 공식 Docker 이미지](https://hub.docker.com/_/mysql), 환경변수 필수값 처리와 이중 달러 표기는 [Compose 환경변수 처리](https://docs.docker.com/reference/compose-file/interpolation/), PyMySQL 인증 의존성은 [PyMySQL 공식 배포 안내](https://pypi.org/project/PyMySQL/)를 기준으로 합니다.
