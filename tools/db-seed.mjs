/** 로컬 Docker DB에 시드 자료를 적용하거나 제거합니다. */
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const action = process.argv[2];
if (!['seed', 'unseed'].includes(action) || process.argv.length !== 3) {
  console.error('사용법: node tools/db-seed.mjs seed 또는 unseed');
  process.exit(1);
}

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(toolsDirectory, '..');
const [context] = JSON.parse(execFileSync('docker', ['context', 'inspect'], { encoding: 'utf8' }));
if (!/^(npipe|unix):\/\//.test(context.Endpoints.docker.Host)) {
  throw new Error('로컬 Docker 소켓에 연결한 상태에서만 실행할 수 있습니다.');
}

const content = action === 'seed' ? prepareContent() : null;
const sql = Buffer.concat([
  Buffer.from(content ? `SET @mobtwig_seed_chapters = CONVERT(X'${Buffer.from(JSON.stringify(content.chapters)).toString('hex')}' USING utf8mb4);\n` : ''),
  readFileSync(join(toolsDirectory, `${action}_design_demo.sql`)),
]);
const replaced = [];
let result;
try {
  for (const file of content?.files ?? []) {
    if (!file.changed) continue;
    mkdirSync(dirname(file.target), { recursive: true });
    replaceContent(file.target, file.bytes, file.previous);
    replaced.push(file);
  }
  result = spawnSync('docker', [
    '--context', context.Name,
    'compose',
    '--env-file', join(repositoryDirectory, 'server', '.env'),
    '-f', join(repositoryDirectory, 'server', 'db', 'compose.yaml'),
    'exec', '-T', 'mysql', 'sh', '-c',
    'MYSQL_PWD="$MYSQL_PASSWORD" mysql --host=127.0.0.1 --default-character-set=utf8mb4 --user="$MYSQL_USER" --database="$MYSQL_DATABASE"',
  ], {
    cwd: repositoryDirectory,
    input: sql,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Object.assign(new Error('시드 SQL 실행에 실패했습니다.'), { status: result.status ?? 1 });
} catch (failure) {
  let restoreFailure;
  for (const file of replaced.reverse()) {
    try {
      assert.ok(matchesContent(file.target, file.bytes), `다른 작업이 변경한 본문은 복원하지 않습니다: ${file.target}`);
      if (file.previous === null) unlinkSync(file.target);
      else replaceContent(file.target, file.previous, file.bytes);
    } catch (problem) {
      restoreFailure = problem;
      console.error(problem.message);
    }
  }
  console.error(failure.message);
  if (restoreFailure) console.error('일부 본문을 복원하지 못했습니다. 위 파일을 확인하십시오.');
  process.exit(Number.isInteger(failure.status) ? failure.status : 1);
}
console.log(`시드 자료 ${action === 'seed' ? '적용' : '제거'} 명령을 완료했습니다.`);
if (content) console.log(`본문 ${content.chapters.length}개 회차와 파일 ${content.files.length}개를 연결했습니다.`);
process.exit(0);

/**
 * 창작 채팅이 전달한 파일 목록·인코딩·해시를 검사하고 DB 연결용 메타데이터만 구성합니다.
 * @returns 본문 문자열을 출력하지 않는 회차 메타데이터와 복사 작업입니다.
 */
function prepareContent() {
  const sourceRoot = resolve(toolsDirectory, 'seed-content');
  assert.ok(lstatSync(sourceRoot).isDirectory() && !lstatSync(sourceRoot).isSymbolicLink(), '시드 본문 폴더를 확인하십시오.');
  const manifest = JSON.parse(readFileSync(join(sourceRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, 1, '시드 본문 목록 버전을 확인하십시오.');
  assert.ok(Array.isArray(manifest.works) && manifest.works.length === 16, '시드 작품 16종이 필요합니다.');
  const environment = readFileSync(join(repositoryDirectory, 'server', '.env'), 'utf8');
  const configuredRoot = process.env.CONTENT_ROOT ?? environment.match(/^CONTENT_ROOT[ \t]*=[ \t]*(.*?)[ \t]*$/m)?.[1] ?? './content';
  const targetRoot = resolve(repositoryDirectory, 'server', configuredRoot);
  const files = [], chapters = [], workIds = new Set(), chapterIds = new Set(), paths = new Set();
  const decoder = new TextDecoder('utf-8', { fatal: true });

  function file(path, text) {
    assert.ok(typeof path === 'string' && !paths.has(path), '본문 파일 경로가 없거나 중복됩니다.');
    const source = resolve(sourceRoot, path);
    assert.ok(!relative(sourceRoot, source).startsWith('..') && realpathSync(source) === source
      && lstatSync(source).isFile(), `일반 본문 파일을 확인하십시오: ${path}`);
    const bytes = readFileSync(source);
    assert.ok(bytes.length <= (text ? 2 : 8) * 1024 * 1024, `본문 파일 크기를 확인하십시오: ${path}`);
    const body = text ? decoder.decode(bytes).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n') : null;
    if (text) assert.ok(body.trim() && !body.includes('\0'), `비어 있거나 잘못된 본문입니다: ${path}`);
    else assert.ok(bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), `PNG 파일을 확인하십시오: ${path}`);
    const target = resolve(targetRoot, path);
    for (let cursor = target; ; cursor = dirname(cursor)) {
      if (existsSync(cursor)) assert.ok(!lstatSync(cursor).isSymbolicLink(), `본문 경로에 링크를 사용할 수 없습니다: ${path}`);
      if (cursor === targetRoot) break;
      assert.ok(relative(targetRoot, cursor) && !relative(targetRoot, cursor).startsWith('..'), '본문 저장 범위를 벗어났습니다.');
    }
    if (existsSync(target)) assert.ok(lstatSync(target).isFile(), `본문 파일 경로를 확인하십시오: ${path}`);
    const canonical = text ? Buffer.from(body, 'utf8') : bytes;
    const previous = existsSync(target) ? readFileSync(target) : null;
    const changed = previous === null || !canonical.equals(previous);
    files.push({ target, text, changed, bytes: changed ? canonical : null, previous: changed ? previous : null });
    paths.add(path);
    return { body, changed };
  }

  for (const work of manifest.works) {
    assert.ok(Number.isInteger(work.bookId) && work.bookId >= 81001 && work.bookId <= 81016 && !workIds.has(work.bookId), '시드 작품 ID를 확인하십시오.');
    assert.ok(typeof work.slug === 'string' && /^[a-z0-9-]{1,100}$/.test(work.slug), '시드 작품 slug를 확인하십시오.');
    assert.ok(['book', 'magazine', 'novel'].includes(work.kind) && Array.isArray(work.chapters) && Array.isArray(work.pages), '작품 종류·목차·쪽 목록을 확인하십시오.');
    assert.ok(work.pageCount === null || Number.isInteger(work.pageCount) && work.pageCount > 0, '시드 작품 쪽 수를 확인하십시오.');
    workIds.add(work.bookId);
    let changedPages = false;
    if (work.kind === 'magazine') {
      assert.equal(work.pages.length, work.pageCount, '매거진 전체 쪽이 필요합니다.');
      for (const [index, page] of work.pages.entries()) {
        assert.equal(page.number, index + 1, '매거진 쪽은 1부터 순서대로 지정하십시오.');
        assert.equal(page.path, `magazine/demo/${work.slug}/${page.number}.png`, '매거진 파일 경로를 확인하십시오.');
        changedPages = file(page.path, false).changed || changedPages;
      }
    } else assert.equal(work.pages.length, 0, '텍스트 작품에 PNG 쪽 목록을 지정할 수 없습니다.');
    for (const chapter of work.chapters) {
      assert.ok(Number.isInteger(chapter.id) && !chapterIds.has(chapter.id)
        && Number.isInteger(chapter.number) && chapter.number > 0, '회차 ID·순서를 확인하십시오.');
      assert.ok(Number.isInteger(chapter.characterCount) && chapter.characterCount > 0, '본문 UTF-16 길이를 확인하십시오.');
      chapterIds.add(chapter.id);
      let hash = null, sample = null, changed = changedPages;
      if (work.kind === 'magazine') {
        assert.equal(chapter.path, `magazine/demo/${work.slug}/`, '매거진 기사 경로를 확인하십시오.');
        assert.equal(chapter.contentHash, null, '매거진 기사의 텍스트 해시는 null입니다.');
      } else {
        assert.equal(chapter.path, `demo/text/${work.slug}/${chapter.number}.txt`, '텍스트 파일 경로를 확인하십시오.');
        const checked = file(chapter.path, true);
        assert.equal(checked.body.length, chapter.characterCount, `본문 UTF-16 길이가 다릅니다: ${chapter.path}`);
        hash = createHash('sha256').update(checked.body, 'utf8').digest('hex');
        assert.equal(hash, chapter.contentHash, `본문 해시가 다릅니다: ${chapter.path}`);
        sample = Array.from(checked.body).slice(0, 120).join('');
        changed = checked.changed;
      }
      chapters.push({ id: chapter.id, number: chapter.number, bookId: work.bookId, slug: work.slug,
        kind: work.kind, pageCount: work.pageCount, contentUrl: '/content/' + chapter.path,
        characterCount: chapter.characterCount, contentHash: hash, sample, sampleEnd: sample?.length ?? 0, changed: Number(changed) });
    }
  }
  assert.equal(chapters.length, 536, '시드 회차 536개가 필요합니다.');
  assert.equal(files.filter(file => file.text).length, 510, '텍스트 본문 510개가 필요합니다.');
  assert.equal(files.filter(file => !file.text).length, 532, '매거진 PNG 532개가 필요합니다.');
  return { files, chapters };
}

/**
 * 준비 시 확인한 값이 아직 같은 파일에만 적용·복원합니다.
 * @param path 본문 저장 경로입니다.
 * @param expected 기존 파일 bytes이며 null이면 파일이 없어야 합니다.
 * @returns 현재 파일이 확인한 값과 같은지 나타냅니다.
 */
function matchesContent(path, expected) {
  return expected === null ? !existsSync(path) : existsSync(path) && expected.equals(readFileSync(path));
}

/** 검증한 본문만 같은 디렉터리의 임시 파일을 거쳐 교체합니다. */
function replaceContent(path, bytes, expected) {
  const temporary = path + '.seed-' + process.pid;
  const descriptor = openSync(temporary, 'wx');
  let closed = false;
  try {
    writeFileSync(descriptor, bytes);
    closeSync(descriptor);
    closed = true;
    assert.ok(matchesContent(path, expected), `준비 이후 변경된 본문은 덮어쓰지 않습니다: ${path}`);
    renameSync(temporary, path);
  } finally {
    if (!closed) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
