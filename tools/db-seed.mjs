/** 로컬 Docker DB에 시연 자료를 적용하거나 제거합니다. */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

const sql = readFileSync(join(toolsDirectory, `${action}_design_demo.sql`));
const result = spawnSync('docker', [
  '--context', context.Name,
  'compose', '--project-name', 'mobtwig-local84',
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
if (result.status === 0) {
  console.log(`시연 자료 ${action === 'seed' ? '적용' : '제거'} 명령을 완료했습니다.`);
}
process.exit(result.status ?? 1);
