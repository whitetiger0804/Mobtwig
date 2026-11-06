import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseChapterText } from '../../../../client/src/chapterText.ts';

const files = process.argv.includes('--with-db') ? ['reader-contract.json', 'reader-db-contract.json'] : ['reader-contract.json'];
for (const file of files) {
  const values = JSON.parse(await readFile(new URL('../../../target/' + file, import.meta.url), 'utf8'));
  assert.ok(values.length >= 2);
  for (const value of values) assert.deepEqual(parseChapterText(value), value);
}
console.log('Java HTTP 본문 응답이 클라이언트 파서의 계약을 통과했습니다:', files.join(', '));
