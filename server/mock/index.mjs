import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// #region 서버 파일과 응답 유틸리티

const mockDirectory = dirname(fileURLToPath(import.meta.url));
const supportedKinds = new Set(['all', 'book', 'magazine', 'novel']);

/**
 * 정적 이미지 디렉터리의 일반 PNG 파일만 URL 허용 목록에 등록합니다.
 *
 * @param directory - 현재 탐색할 디렉터리입니다.
 * @param prefix - 이미지의 공개 URL 경로입니다.
 * @returns 심볼릭 링크를 제외한 URL과 실제 파일 경로의 대응표입니다.
 */
async function collectAssets(directory, prefix = '/assets') {
  const assets = new Map();

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    const publicPath = `${prefix}/${entry.name}`;

    if (entry.isDirectory()) {
      for (const [url, path] of await collectAssets(filePath, publicPath)) {
        assets.set(url, path);
      }
    } else if (entry.isFile() && entry.name.endsWith('.png')) {
      assets.set(publicPath, filePath);
    }
  }

  return assets;
}

/**
 * 한글 JSON 응답을 UTF-8로 전송합니다.
 *
 * @param response - 진행 중인 HTTP 응답입니다.
 * @param status - HTTP 상태 코드입니다.
 * @param body - 직렬화할 응답 본문입니다.
 */
function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

// #endregion

// #region 간이 서버

/**
 * 정해진 화면 구성과 작품 정보, 이미지를 제공하는 테스트용 HTTP 서버를 생성합니다.
 *
 * @remarks
 * 실제 DB를 사용하지 않습니다. JSON은 요청할 때마다 읽으므로 파일 수정 후
 * 앱에서 새로고침하면 화면 구성과 작품 정보 변경을 확인할 수 있습니다.
 * 생성한 서버의 수신 시작과 종료는 호출자가 관리합니다.
 *
 * @param options - 테스트에서 사용할 파일 경로 설정입니다.
 * @param options.fixturePath - 네 종류의 화면 응답이 담긴 JSON 파일입니다.
 * @param options.worksPath - 작품 ID별 상세 정보가 담긴 JSON 배열 파일입니다.
 * @param options.assetsRoot - 공개할 PNG 이미지의 최상위 디렉터리입니다.
 * @returns 아직 포트를 열지 않은 Node HTTP 서버입니다.
 */
export async function createMockServer({
  fixturePath = join(mockDirectory, 'fixtures', 'home.json'),
  worksPath = join(mockDirectory, 'fixtures', 'works.json'),
  assetsRoot = join(mockDirectory, 'assets'),
} = {}) {
  const assets = await collectAssets(assetsRoot);

  return createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendJson(response, 405, { error: 'GET 요청만 사용할 수 있습니다.' });
      return;
    }

    let pathname;
    let url;

    try {
      url = new URL(request.url, 'http://mock.local');
      pathname = decodeURIComponent(request.url.split('?')[0]);
    } catch {
      sendJson(response, 400, { error: '요청 주소가 올바르지 않습니다.' });
      return;
    }

    if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').includes('..')) {
      sendJson(response, 404, { error: '요청한 리소스가 없습니다.' });
      return;
    }

    if (pathname === '/health') {
      sendJson(response, 200, { status: 'ok', service: 'mobtwig-mock' });
      return;
    }

    if (pathname === '/sdui/home') {
      const kinds = url.searchParams.getAll('kind');

      if (kinds.length !== 1 || !supportedKinds.has(kinds[0])) {
        sendJson(response, 400, { error: 'kind는 all, book, magazine, novel 중 하나여야 합니다.' });
        return;
      }

      try {
        const fixtures = JSON.parse(await readFile(fixturePath, 'utf8'));
        const home = fixtures[kinds[0]];

        if (home === undefined) {
          throw new Error('요청한 화면 응답이 JSON에 없습니다.');
        }

        sendJson(response, 200, home);
      } catch {
        sendJson(response, 500, { error: '화면 응답 파일을 읽지 못했습니다.' });
      }

      return;
    }

    const workMatch = /^\/works\/([^/]+)$/.exec(pathname);

    if (workMatch) {
      try {
        const works = JSON.parse(await readFile(worksPath, 'utf8'));
        const work = works.find((item) => item.id === workMatch[1]);

        if (work === undefined) {
          sendJson(response, 404, { error: '요청한 작품이 없습니다.' });
          return;
        }

        sendJson(response, 200, work);
      } catch {
        sendJson(response, 500, { error: '작품 정보 파일을 읽지 못했습니다.' });
      }

      return;
    }

    const assetPath = assets.get(pathname);

    if (assetPath !== undefined) {
      try {
        const image = await readFile(assetPath);
        response.writeHead(200, { 'Content-Type': 'image/png' });
        response.end(image);
      } catch {
        sendJson(response, 500, { error: '이미지 파일을 읽지 못했습니다.' });
      }

      return;
    }

    sendJson(response, 404, { error: '요청한 리소스가 없습니다.' });
  });
}

// #endregion

// #region 명령행 실행

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = process.env.MOCK_HOST ?? '127.0.0.1';
  const port = Number(process.env.MOCK_PORT ?? '8090');

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MOCK_PORT에는 1부터 65535까지의 정수를 지정해야 합니다.');
  }

  const server = await createMockServer();
  server.listen(port, host, () => {
    console.log(`Mobtwig 간이 서버가 http://${host}:${port} 에서 실행 중입니다.`);
    console.log('종료하려면 Ctrl+C를 누르십시오.');
  });
}

// #endregion
