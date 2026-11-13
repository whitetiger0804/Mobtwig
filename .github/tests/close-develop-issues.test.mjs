import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../workflows/close-develop-issues.yml', import.meta.url), 'utf8')
  .replaceAll('\r\n', '\n');
const marker = '          script: |\n';
assert.equal(workflow.split(marker).length, 2);
const script = workflow.split(marker)[1].split('\n').map(line => line.slice(12)).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction('github', 'context', 'core', script);

async function execute(body, states = {}) {
  const reads = [];
  const updates = [];
  const context = { repo: { owner: 'whitetiger0804', repo: 'Mobtwig' }, payload: { pull_request: { body } } };
  const github = { rest: { issues: {
    async get(parameters) {
      reads.push(parameters);
      const data = states[parameters.issue_number] ?? { state: 'open' };
      if (data instanceof Error) throw data;
      return { data };
    },
    async update(parameters) { updates.push(parameters); },
  } } };
  await run(github, context, { info() {} });
  return { reads, updates };
}

test('develop 대상 PR이 실제 병합된 경우에만 쓰기 작업을 실행합니다.', () => {
  assert.match(workflow, /pull_request:\n\s+types: \[closed\]\n\s+branches: \[develop\]/);
  assert.match(workflow, /if: github\.event\.pull_request\.merged == true/);
  assert.match(workflow, /permissions:\n  issues: write/);
  assert.doesNotMatch(workflow, /actions\/checkout|\$\{\{.*body/);
});

test('종료 키워드 9종과 대소문자·콜론을 처리합니다.', async () => {
  const keywords = ['close', 'Closes', 'CLOSED', 'fix', 'Fixes', 'FIXED', 'resolve', 'Resolves', 'RESOLVED'];
  const { updates } = await execute(keywords.map((keyword, index) => `${keyword}: #${index + 1}`).join('\n'));
  assert.deepEqual(updates.map(value => value.issue_number), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const value of updates) {
    assert.equal(value.owner, 'whitetiger0804');
    assert.equal(value.repo, 'Mobtwig');
    assert.equal(value.state, 'closed');
    assert.equal(value.state_reason, 'completed');
  }
});

test('Ref·Refs·일반 참조·다른 저장소 번호는 종료하지 않습니다.', async () => {
  const { reads, updates } = await execute('Ref #1\nRefs #2\n#3\ndisclosed #4\nCloses other/repo#5\nCloses https://github.com/other/repo/issues/6');
  assert.deepEqual(reads, []);
  assert.deepEqual(updates, []);
});

test('각 번호에 종료 키워드가 필요하며 중복 번호는 한 번만 종료합니다.', async () => {
  const { reads, updates } = await execute('Closes #1, #2, fixes #3\nResolved #1\nRefs #4');
  assert.deepEqual(reads.map(value => value.issue_number), [1, 3]);
  assert.deepEqual(updates.map(value => value.issue_number), [1, 3]);
});

test('주석·인라인 코드·인용·들여쓰기 코드 속 예시는 제외합니다.', async () => {
  const { updates } = await execute([
    '<!--\nCloses #1\n-->', '`Fixes #2`', '``Closes `example` #3``',
    '> Closes #4', 'Closes #5', '', '    Closes #6', '\tCloses #7',
    'Closes #8', 'Closes `example` #9', 'Closes <!--example--> #10',
  ].join('\n'));
  assert.deepEqual(updates.map(value => value.issue_number), [8]);
});

test('백틱·물결표·긴 펜스 안의 예시는 제외합니다.', async () => {
  const { updates } = await execute([
    '```md', 'Closes #1', '```', '~~~', 'Fixes #2', '~~~',
    '````', '```', 'Closes #3', '````', 'Closes #4',
  ].join('\n'));
  assert.deepEqual(updates.map(value => value.issue_number), [4]);
});

test('목록 내부의 코드·인용 예시도 종료 지시로 처리하지 않습니다.', async () => {
  const { updates } = await execute([
    '- ```md', '  Closes #1', '  ```', '',
    '- > Closes #2', '', '1. > Closes #3', '',
    '- Closes #4',
  ].join('\n'));
  assert.deepEqual(updates.map(value => value.issue_number), [4]);
});

test('닫히지 않은 코드 펜스와 주석 이후의 예시는 제외합니다.', async () => {
  for (const body of ['Closes #1\n```\nCloses #2', 'Closes #1\n<!--\nCloses #2']) {
    const { updates } = await execute(body);
    assert.deepEqual(updates.map(value => value.issue_number), [1]);
  }
});

test('이미 종료된 이슈의 사유를 보존하며 PR 번호는 변경하지 않습니다.', async () => {
  const { updates } = await execute('Closes #1, closes #2, closes #3', {
    1: { state: 'closed', state_reason: 'not_planned' },
    2: { state: 'open', pull_request: { url: 'https://api.github.com/repos/whitetiger0804/Mobtwig/pulls/2' } },
  });
  assert.deepEqual(updates.map(value => value.issue_number), [3]);
});

test('본문이 없거나 종료 지시가 없으면 이슈 API를 호출하지 않습니다.', async () => {
  for (const body of [null, '', '검색 화면을 수정했습니다.']) {
    assert.deepEqual(await execute(body), { reads: [], updates: [] });
  }
});

test('API 실패를 성공으로 숨기지 않습니다.', async () => {
  await assert.rejects(execute('Closes #1', { 1: new Error('이슈 조회에 실패했습니다.') }), /이슈 조회에 실패/);
});

test('PR 본문을 JavaScript로 실행하지 않습니다.', async () => {
  const { updates } = await execute('throw new Error("본문 실행 오류");\nCloses #1');
  assert.deepEqual(updates.map(value => value.issue_number), [1]);
});
