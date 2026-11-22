import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadLocalCommunityDraft, saveLocalCommunityDraft, deleteLocalCommunityDraft } from '../src/communityDrafts.ts';

const scope = { apiUrl: 'https://community.example.test/api', memberId: '13', boardId: '21' };
const input = {
  boardId: '21', workId: 'star-record', head: 'IMPRESSION', title: '  별의 기록  ', body: '\n첫 번째 줄\n\n두 번째 줄  ',
  hasSpoiler: true, spoilerChapterId: '31', images: [{ url: '/community-images/13/test.png', width: 512, height: 768 }], stickerIds: ['2', '1'],
};

function device(values = new Map()) {
  return {
    values,
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async key => { values.delete(key); },
  };
}

test('게시판에 저장한 초안이 없으면 서버에 요청하지 않고 null을 반환합니다.', async context => {
  context.mock.method(globalThis, 'fetch', () => assert.fail('로컬 초안을 서버에 요청했습니다.'));
  assert.equal(await loadLocalCommunityDraft(device(), scope), null);
});

test('앱을 다시 열어도 원문 공백·줄바꿈·첨부·이모티콘 순서를 복원합니다.', async context => {
  context.mock.method(globalThis, 'fetch', () => assert.fail('로컬 초안을 서버에 전송했습니다.'));
  const first = device();
  const editable = structuredClone(input);
  const saved = await saveLocalCommunityDraft(first, scope, editable);
  editable.title = '작성 중인 다른 값';
  editable.images[0].url = '/changed.png';
  editable.stickerIds.reverse();
  assert.deepEqual(saved, input);
  const restarted = device(first.values);
  assert.deepEqual(await loadLocalCommunityDraft(restarted, scope), input);
  assert.deepEqual(await loadLocalCommunityDraft(restarted, { ...scope, apiUrl: scope.apiUrl + '/' }), input);
});

test('스포일러 토글 이전에 저장한 초안은 기존 회차 선택으로 상태를 복원하고 원본을 보존합니다.', async () => {
  const storage = device();
  await saveLocalCommunityDraft(storage, scope, input);
  const [key] = storage.values.keys();
  const { hasSpoiler, ...legacy } = input;
  for (const spoilerChapterId of ['31', null]) {
    const raw = JSON.stringify({ ...legacy, spoilerChapterId });
    storage.values.set(key, raw);
    assert.deepEqual(await loadLocalCommunityDraft(storage, scope), { ...legacy, spoilerChapterId, hasSpoiler: spoilerChapterId !== null });
    assert.equal(storage.values.get(key), raw);
  }
  storage.values.set(key, JSON.stringify({ ...input, hasSpoiler: null }));
  await assert.rejects(loadLocalCommunityDraft(storage, scope));
});

test('작품·주제·홍보 게시판과 회원·서버별 초안을 독립적으로 저장합니다.', async () => {
  const storage = device();
  const scopes = [scope, { ...scope, boardId: '22' }, { ...scope, boardId: '23' }, { ...scope, boardId: '24' },
    { ...scope, memberId: '14' }, { ...scope, apiUrl: 'https://another.example.test/api' },
    { ...scope, apiUrl: 'https://community.example.test/another-api' }];
  const drafts = scopes.map((target, index) => ({ ...input, boardId: target.boardId, title: `초안 ${index}` }));
  drafts[2] = { ...drafts[2], workId: null, head: 'STORY', spoilerChapterId: null };
  drafts[3] = { ...drafts[3], head: 'PROMOTION' };
  for (let i = 0; i < scopes.length; i++) await saveLocalCommunityDraft(storage, scopes[i], drafts[i]);
  for (let i = 0; i < scopes.length; i++) assert.deepEqual(await loadLocalCommunityDraft(storage, scopes[i]), drafts[i]);
  await deleteLocalCommunityDraft(storage, scopes[1]);
  assert.equal(await loadLocalCommunityDraft(storage, scopes[1]), null);
  for (const i of [0, 2, 3, 4, 5, 6]) assert.deepEqual(await loadLocalCommunityDraft(storage, scopes[i]), drafts[i]);
});

test('작성 중인 빈 제목·본문도 저장하며 다른 게시판으로 잘못 저장하지 않습니다.', async () => {
  const storage = device();
  const blank = { ...input, title: '', body: '' };
  await saveLocalCommunityDraft(storage, scope, blank);
  assert.deepEqual(await loadLocalCommunityDraft(storage, scope), blank);
  const before = [...storage.values];
  await assert.rejects(saveLocalCommunityDraft(storage, { ...scope, boardId: '22' }, input), /다른 게시판/);
  assert.deepEqual([...storage.values], before);
});

test('손상된 초안은 빈 초안으로 대체하거나 삭제하지 않습니다.', async () => {
  const storage = device();
  await saveLocalCommunityDraft(storage, scope, input);
  const [key] = storage.values.keys();
  const invalid = ['{', 'null', '[]', '{}', JSON.stringify({ ...input, boardId: '22' }),
    JSON.stringify({ ...input, head: '없는 말머리' }), JSON.stringify({ ...input, title: 123 }),
    JSON.stringify({ ...input, images: [{ url: 'javascript:alert(1)', width: 1, height: 1 }] })];
  for (const raw of invalid) {
    storage.values.set(key, raw);
    await assert.rejects(loadLocalCommunityDraft(storage, scope));
    assert.equal(storage.values.get(key), raw);
  }
});

test('저장 범위가 잘못되면 기기의 다른 데이터를 읽거나 변경하지 않습니다.', async () => {
  const storage = {
    getItem: () => assert.fail('잘못된 범위를 읽었습니다.'),
    setItem: () => assert.fail('잘못된 범위를 저장했습니다.'),
    removeItem: () => assert.fail('잘못된 범위를 삭제했습니다.'),
  };
  const invalid = [
    { ...scope, memberId: '' }, { ...scope, memberId: '0' }, { ...scope, boardId: '21\n' },
    { ...scope, memberId: '9223372036854775808' }, { ...scope, apiUrl: 'file:///private' },
    { ...scope, apiUrl: 'https://member:password@example.test' }, { ...scope, apiUrl: scope.apiUrl + '?token=a' },
  ];
  for (const target of invalid) {
    await assert.rejects(loadLocalCommunityDraft(storage, target));
    await assert.rejects(saveLocalCommunityDraft(storage, target, input));
    assert.throws(() => deleteLocalCommunityDraft(storage, target));
  }
});

test('읽기·저장·삭제 오류를 전달하고 실제 저장 완료 전에는 성공하지 않습니다.', async () => {
  const failure = new Error('기기 저장소 오류');
  await assert.rejects(loadLocalCommunityDraft({ getItem: async () => { throw failure; } }, scope), failure);
  await assert.rejects(saveLocalCommunityDraft({ setItem: async () => { throw failure; } }, scope, input), failure);
  await assert.rejects(deleteLocalCommunityDraft({ removeItem: async () => { throw failure; } }, scope), failure);
  let finish;
  let completed = false;
  const writing = new Promise(resolve => { finish = resolve; });
  const save = saveLocalCommunityDraft({ setItem: () => writing }, scope, input).then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  finish();
  await save;
  assert.equal(completed, true);
});
