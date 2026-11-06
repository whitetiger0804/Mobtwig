import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHomeResponse } from '../../../../client/src/homeSchema.ts';
import { parseWorkDetail } from '../../../../client/src/workDetails.ts';

const responseFile = new URL('../../../target/catalog-contract.json', import.meta.url);
const responses = JSON.parse(await readFile(responseFile, 'utf8'));

assert.equal(responses.homes.length, 4);
assert.equal(responses.configuredHomes.length, 2);
assert.equal(responses.works.length, 3);

const homes = [...responses.homes, ...responses.configuredHomes];
for (const home of homes) {
  assert.deepEqual(parseHomeResponse(home), home);
}

for (const work of responses.works) {
  assert.deepEqual(parseWorkDetail(work), work);
}

assert.deepEqual(responses.works.map(work => work.kind).sort(), ['book', 'magazine', 'novel']);
const detailIds = new Set(responses.works.map(work => work.id));
for (const home of homes) {
  for (const section of home.sections.filter(section => ['workShelf', 'featuredWork'].includes(section.type))) {
    for (const item of section.items) {
      assert.ok(detailIds.has(item.id), `상세 응답이 없는 홈 작품입니다: ${item.id}`);
    }
  }
}

console.log('실제 DB와 연결한 Java API 응답이 클라이언트 계약을 통과했습니다.');
