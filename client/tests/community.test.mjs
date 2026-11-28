import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemberSessionClient, MemberRequestError } from '../src/memberSession.ts';
import { normalizeCommunityBody } from '../src/communityBody.ts';
import {
  communityImageUrl, normalizeCommunityText, readCommunityBoards, readCommunityWorks, createCommunityBoard,
  parseCommunityDraftInput,
  readCommunityPosts, readCommunityPost, readCommunityComments,
  createCommunityPost, updateCommunityPost, deleteCommunityPost,
  createCommunityComment, updateCommunityComment, deleteCommunityComment,
  setCommunityLike, reportCommunityPost, uploadCommunityImage,
} from '../src/community.ts';

const base = 'https://community.example.test/backend';
const timestamp = '2026-11-21T01:02:03.456Z';
const signal = new AbortController().signal;
const work = { id: 'test-work', title: '별의 기록', author: '기록가', imageUrl: '/covers/star.png', kind: 'novel' };
const chapter = { id: '15', number: 2, title: '다음 기록' };
const sticker = { id: '1', code: 'WAVE', name: '반가워요', imageUrl: '/stickers/emote-wave.svg' };
const board = { id: '10', type: 'work', name: '별의 기록', work, heads: ['IMPRESSION', 'QUESTION', 'THEORY', 'FREE'], latestPost: null };
const post = {
  id: '9007199254740993', boardId: '10', boardType: 'work', boardName: '별의 기록', work,
  head: 'IMPRESSION', title: '두 번째 이야기', body: '본문입니다.', nickname: '독자',
  createdAt: timestamp, updatedAt: timestamp, publishedAt: timestamp, status: 'PUBLISHED',
  spoiler: null, hasSpoiler: false, locked: false, mine: false, liked: false, reported: false,
  likeCount: 0, commentCount: 0, images: [], stickers: [],
};
const own = { ...post, mine: true };
const locked = { ...post, spoiler: chapter, hasSpoiler: true, title: null, body: null, locked: true };
const comment = { id: '21', postId: post.id, body: '이 장면이 좋습니다.', nickname: '독자',
  createdAt: timestamp, updatedAt: timestamp, spoiler: null, hasSpoiler: false, locked: false, mine: false, stickers: [] };
const input = { boardId: board.id, workId: work.id, head: post.head, title: post.title, body: post.body,
  hasSpoiler: false, spoilerChapterId: null, images: [], stickerIds: [] };
const page = (items, values = {}) => ({ items, hasNext: false, ...values });

test('게시 API는 Unicode 최대 길이와 서버 공백 정리를 유지하고 초과·공백·중복 첨부를 보내지 않습니다.', async () => {
  let calls = 0;
  const valid = { ...input, title: ' \u0085' + '😀'.repeat(100) + '\uFEFF', body: '\n' + '🙂'.repeat(10000) + '\u0085' };
  const client = { request: async (path, init) => {
    calls++; assert.equal(path, '/api/members/community/posts');
    const body = JSON.parse(init.body); assert.equal(body.title, '😀'.repeat(100)); assert.equal(body.body, '🙂'.repeat(10000));
    return { ...own, title: body.title, body: body.body };
  } };
  assert.equal((await createCommunityPost(client, valid, signal)).title, '😀'.repeat(100));
  const image = { url: '/community-images/13/one.png', width: 32, height: 32 };
  for (const value of [{ ...input, title: '😀'.repeat(101) }, { ...input, body: '🙂'.repeat(10001) },
    { ...input, title: '\u0085 \n' }, { ...input, body: '\u0085 \n' }, { ...input, boardId: '0' }, { ...input, images: [image, image] }]) {
    await assert.rejects(createCommunityPost(client, value, signal));
  }
  assert.equal(calls, 1);
});

test('공개 게시판은 쿠키를 보내지 않고 기준 경로와 선택 종류를 유지합니다.', async context => {
  context.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, base + '/community/boards?type=work');
    assert.deepEqual(init, { signal, credentials: 'omit' });
    return Response.json({ items: [{ ...board, privateNote: '제외' }], stickers: [sticker], hidden: '제외' });
  });
  assert.deepEqual(await readCommunityBoards(base + '/', 'work', signal), { items: [board], stickers: [sticker] });
});

test('게시판의 종류·작품 연결·말머리·중복 식별자가 잘못되면 거부합니다.', async context => {
  let response;
  context.mock.method(globalThis, 'fetch', async () => Response.json(response));
  for (const invalid of [
    { ...board, type: 'promotion' }, { ...board, work: null }, { ...board, heads: ['STORY'], latestPost: null },
    { ...board, heads: ['FREE', 'FREE'] }, { ...board, heads: [] }, { ...board, id: 10 },
    { ...board, work: { ...work, imageUrl: 'javascript:alert(1)' } },
    { ...board, work: { ...work, id: 'a'.repeat(101) } },
  ]) {
    response = { items: [invalid], stickers: [sticker] };
    await assert.rejects(readCommunityBoards(base, 'work', signal), /형식/);
  }
  response = { items: [board, board], stickers: [sticker] };
  await assert.rejects(readCommunityBoards(base, 'work', signal), /형식/);
});

test('게시판 최신 글은 공개 요약만 표시하고 스포일러 제목 노출이나 누락된 상태를 거부합니다.', async context => {
  const latestPost = { id: post.id, head: post.head, title: post.title, nickname: post.nickname,
    likeCount: 2, commentCount: 3, hasSpoiler: false, locked: false };
  let payload = { ...board, latestPost };
  context.mock.method(globalThis, 'fetch', async () => Response.json({ items: [payload], stickers: [sticker] }));
  assert.deepEqual((await readCommunityBoards(base, 'work', signal)).items[0].latestPost, latestPost);
  payload = { ...board, latestPost: { ...latestPost, title: null, hasSpoiler: true, locked: true } };
  assert.deepEqual((await readCommunityBoards(base, 'work', signal)).items[0].latestPost, payload.latestPost);
  for (const invalid of [
    undefined, { ...latestPost, hasSpoiler: undefined }, { ...latestPost, hasSpoiler: true },
    { ...latestPost, hasSpoiler: true, locked: true }, { ...latestPost, title: null },
    { ...latestPost, head: 'STORY' }, { ...latestPost, likeCount: -1 },
  ]) {
    payload = { ...board, latestPost: invalid };
    await assert.rejects(readCommunityBoards(base, 'work', signal), /형식/);
  }
});

test('주제 게시판 검색은 입력의 양끝 공백을 정리하고 검색어를 URL 인코딩합니다.', async context => {
  const topic = { id: '11', type: 'topic', name: '독서 & 창작 이야기', work: null, heads: ['STORY', 'QUESTION'], latestPost: null };
  context.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.deepEqual(Object.fromEntries(new URL(url).searchParams), { type: 'topic', query: '독서 & 창작' });
    assert.equal(new URL(url).pathname, '/backend/community/boards');
    assert.deepEqual(init, { signal, credentials: 'omit' });
    return Response.json({ items: [topic], stickers: [sticker] });
  });
  assert.deepEqual((await readCommunityBoards(base, 'topic', signal, '\u0085 독서 & 창작　')).items, [topic]);
});

test('작품 목록은 빈 검색어를 허용하고 게시판이 없는 작품도 함께 반환합니다.', async context => {
  const items = [{ work, boardId: board.id }, { work: { ...work, id: 'new-work', imageUrl: null }, boardId: null }];
  context.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(new URL(url).pathname, '/backend/community/works');
    assert.deepEqual(Object.fromEntries(new URL(url).searchParams), { page: '1', size: '20', query: '' });
    assert.deepEqual(init, { signal, credentials: 'omit' });
    return Response.json(page(items));
  });
  assert.deepEqual(await readCommunityWorks(base, { page: 1, size: 20 }, signal), page(items));
});

test('작품 검색의 페이지·검색어를 전달하고 잘못된 작품·게시판 연결을 거부합니다.', async context => {
  const item = { work, boardId: null }, filter = { page: 2, size: 1, query: ' 별 & 기록 ' };
  let payload = page([item], { hasNext: true });
  context.mock.method(globalThis, 'fetch', async url => {
    assert.deepEqual(Object.fromEntries(new URL(url).searchParams), { page: '2', size: '1', query: '별 & 기록' });
    return Response.json(payload);
  });
  assert.deepEqual(await readCommunityWorks(base, filter, signal), payload);
  for (const invalid of [
    { work: null, boardId: null }, { work, boardId: '0' }, { work, boardId: 10 }, { work },
    { work: { ...work, id: '../secret' }, boardId: null }, { work: { ...work, kind: 'audio' }, boardId: null },
  ]) {
    payload = page([invalid], { hasNext: true });
    await assert.rejects(readCommunityWorks(base, filter, signal), /형식/);
  }
  payload = page([item], { page: '무시', size: 0, totalItems: -1, hasNext: false });
  assert.deepEqual(await readCommunityWorks(base, filter, signal), page([item]));
});

test('작품 목록의 중복 작품·게시판 식별자는 거부하고 여러 미생성 게시판은 허용합니다.', async context => {
  const first = { work, boardId: '10' }, second = { work: { ...work, id: 'other-work' }, boardId: '11' };
  let payload;
  context.mock.method(globalThis, 'fetch', async () => Response.json(payload));
  for (const items of [[first, first], [first, { ...second, boardId: '10' }]]) {
    payload = page(items);
    await assert.rejects(readCommunityWorks(base, { page: 1, size: 20 }, signal), /형식/);
  }
  payload = page([{ ...first, boardId: null }, { ...second, boardId: null }]);
  assert.deepEqual(await readCommunityWorks(base, { page: 1, size: 20 }, signal), payload);
});

test('게시판과 작품 검색의 잘못된 입력은 네트워크 요청 전에 거부합니다.', async context => {
  context.mock.method(globalThis, 'fetch', () => assert.fail('잘못된 검색을 전송했습니다.'));
  for (const query of [null, 3, '가'.repeat(101)]) {
    await assert.rejects(readCommunityBoards(base, 'topic', signal, query), /검색어/);
    await assert.rejects(readCommunityWorks(base, { page: 1, size: 20, query }, signal), /검색어/);
  }
  for (const filter of [{ page: 0, size: 20 }, { page: 1, size: 51 }, { page: 1.5, size: 20 }]) {
    await assert.rejects(readCommunityWorks(base, filter, signal), /페이지/);
  }
});

test('게시판 생성은 작품 또는 정리한 주제명만 전송하고 기존 게시판 응답도 받습니다.', async () => {
  const topic = { id: '11', type: 'topic', name: '창작 이야기', work: null, heads: ['STORY', 'QUESTION'], latestPost: null };
  for (const [input, body, result] of [
    [{ type: 'work', workId: work.id }, { type: 'work', workId: work.id }, board],
    [{ type: 'topic', name: '\u0085　창작 이야기 \n' }, { type: 'topic', name: '창작 이야기' }, topic],
  ]) {
    const client = { request: async (path, init) => {
      assert.equal(path, '/api/members/community/boards');
      assert.equal(init.method, 'POST');
      assert.equal(init.signal, signal);
      assert.equal(init.headers['Content-Type'], 'application/json');
      assert.deepEqual(JSON.parse(init.body), body);
      return result;
    } };
    assert.deepEqual(await createCommunityBoard(client, input, signal), result);
    assert.deepEqual(await createCommunityBoard(client, input, signal), result);
  }
});

test('게시판 생성은 허용되지 않은 종류·작품·주제명과 다른 작품 응답을 거부합니다.', async () => {
  const never = { request: () => assert.fail('잘못된 게시판 생성을 전송했습니다.') };
  for (const input of [null, {}, { type: 'promotion', name: '홍보' }, { type: 'work', workId: '../work' },
    { type: 'work', workId: '' }, { type: 'topic', name: '\u0085　' }, { type: 'topic', name: '가'.repeat(101) }]) {
    await assert.rejects(createCommunityBoard(never, input, signal));
  }
  for (const result of [{ ...board, work: { ...work, id: 'other-work' } },
    { id: '11', type: 'topic', name: '주제', work: null, heads: ['STORY'], latestPost: null }]) {
    await assert.rejects(createCommunityBoard({ request: async () => result }, { type: 'work', workId: work.id }, signal), /형식/);
  }
});

test('로컬 초안 입력 검증은 빈 본문을 허용하고 게시글 식별자·첨부 조건을 유지합니다.', () => {
  assert.deepEqual(parseCommunityDraftInput({ ...input, title: '', body: '　' }), { ...input, title: '', body: '' });
  for (const invalid of [null, [], { ...input, boardId: '0' }, { ...input, head: 'NONE' },
    { ...input, images: [{ url: 'file:///tmp/a.png', width: 20, height: 20 }] }]) {
    assert.throws(() => parseCommunityDraftInput(invalid));
  }
});

test('한글과 중간 공백이 있는 표지·첨부 경로를 조회하고 이미지 URL에서는 인코딩합니다.', async context => {
  const cover = '/media/covers/도서/고요를 연습하는 시간.png';
  const attachment = 'https://assets.example.test/사진/독서 기록.png';
  const linked = { ...work, imageUrl: cover };
  const entry = { ...post, work: linked, images: [{ url: attachment, width: 512, height: 768, representative: true }] };
  context.mock.method(globalThis, 'fetch', async url => Response.json(url.includes('/boards?')
    ? { items: [{ ...board, work: linked }], stickers: [sticker] } : page([entry])));
  assert.equal((await readCommunityBoards(base, 'work', signal)).items[0].work.imageUrl, cover);
  assert.equal((await readCommunityPosts(base, { page: 1, size: 20 }, signal)).items[0].images[0].url, attachment);
  assert.equal(communityImageUrl(base, cover), base + '/media/covers/' + encodeURIComponent('도서') + '/' + encodeURIComponent('고요를 연습하는 시간.png'));
  assert.equal(communityImageUrl(base, attachment), 'https://assets.example.test/' + encodeURIComponent('사진') + '/' + encodeURIComponent('독서 기록.png'));
  for (const control of ['\u0000', '\u001f', '\t', '\n', '\r']) {
    assert.throws(() => communityImageUrl(base, '/media/고요' + control + '시간.png'), /형식/);
  }
});

test('게시글 조건은 URL 인코딩하고 회원 조회는 회원 경로로 전달합니다.', async () => {
  const client = { request: async (path, init) => {
    const url = new URL(path, base);
    assert.equal(url.pathname, '/api/members/community/posts');
    assert.deepEqual(Object.fromEntries(url.searchParams), { page: '1', size: '20', boardId: '10', type: 'work',
      head: 'IMPRESSION', query: '별 & 기록', mine: 'true' });
    assert.deepEqual(init, { signal });
    return page([own]);
  } };
  const result = await readCommunityPosts(base, { page: 1, size: 20, boardId: '10', type: 'work',
    head: 'IMPRESSION', query: ' 별 & 기록 ', mine: true }, signal, client);
  assert.equal(result.items[0].id, '9007199254740993');
});

test('잘못된 페이지·식별자·내 글 조회는 네트워크 전송 전에 거부합니다.', async context => {
  context.mock.method(globalThis, 'fetch', () => assert.fail('잘못된 조회를 전송했습니다.'));
  for (const filter of [
    { page: 0, size: 20 }, { page: 1, size: 51 }, { page: 1.5, size: 20 }, { page: 2147483648, size: 20 },
    { page: 1, size: 20, boardId: '10\n' }, { page: 1, size: 20, boardId: '../10' },
    { page: 1, size: 20, boardId: '9223372036854775808' }, { page: 1, size: 20, type: 'other' },
    { page: 1, size: 20, head: 'UNRECOGNIZED' }, { page: 1, size: 20, mine: true },
  ]) await assert.rejects(readCommunityPosts(base, filter, signal));
});

test('공개 목록은 개인 상태와 초안·숨김 글 및 잘못된 기본 형식을 거부합니다.', async context => {
  let payload;
  context.mock.method(globalThis, 'fetch', async () => Response.json(payload));
  for (const invalid of [
    page([own]), page([{ ...post, liked: true, likeCount: 1 }]), page([{ ...post, reported: true }]),
    page([{ ...post, status: 'HIDDEN' }]), page([{ ...post, status: 'DRAFT', publishedAt: null }]),
    page([{ ...post, status: 'DELETED' }]), page([post, post]), page([post], { hasNext: 'true' }), page([{ ...post, createdAt: '2026-02-30T00:00:00Z' }]),
    page([{ ...post, likeCount: -1 }]), page([{ ...post, commentCount: '0' }]),
  ]) {
    payload = invalid;
    await assert.rejects(readCommunityPosts(base, { page: 1, size: 20 }, signal), /형식/);
  }
});

test('가려진 글에는 제목·본문·첨부·이모티콘 원문이 섞여 있으면 안 됩니다.', async context => {
  let payload = page([locked]);
  context.mock.method(globalThis, 'fetch', async () => Response.json(payload));
  assert.deepEqual(await readCommunityPosts(base, { page: 1, size: 20 }, signal), payload);
  for (const invalid of [
    { ...locked, title: '비밀 제목' }, { ...locked, body: '비밀 내용' },
    { ...locked, images: [{ url: '/secret.png', width: 10, height: 10, representative: true }] },
    { ...locked, stickers: [sticker] }, { ...locked, hasSpoiler: false },
    { ...post, spoiler: chapter, hasSpoiler: true },
  ]) {
    payload = page([invalid]);
    await assert.rejects(readCommunityPosts(base, { page: 1, size: 20 }, signal), /형식/);
  }
});

test('상세 스포일러는 확인 후에만 요청하며 다른 글 응답을 거부합니다.', async context => {
  const revealed = { ...post, spoiler: chapter, hasSpoiler: true };
  let payload = revealed;
  context.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(init.signal, signal);
    assert.ok(url.startsWith(base + '/community/posts/' + post.id));
    return Response.json(payload);
  });
  await assert.rejects(readCommunityPost(base, post.id, false, signal), /형식/);
  assert.deepEqual(await readCommunityPost(base, post.id, true, signal), revealed);
  payload = { ...post, id: '19' };
  await assert.rejects(readCommunityPost(base, post.id, false, signal), /형식/);
  assert.equal((await readCommunityPost(base, post.id, false, signal, { request: async () => ({ ...revealed, mine: true }) })).locked, false);
});

test('작품·회차 연결이 없는 주제 글과 댓글도 스포일러 확인 전에는 가립니다.', async context => {
  const topicPost = { ...post, boardType: 'topic', boardName: '독서 이야기', work: null, head: 'STORY',
    hasSpoiler: true, spoiler: null, title: null, body: null, locked: true };
  const spoilerComment = { ...comment, hasSpoiler: true, spoiler: null, body: null, locked: true };
  let response = topicPost;
  context.mock.method(globalThis, 'fetch', async () => Response.json(response));
  assert.deepEqual(await readCommunityPost(base, post.id, false, signal), topicPost);
  response = { ...topicPost, locked: false, title: post.title, body: post.body };
  await assert.rejects(readCommunityPost(base, post.id, false, signal), /형식/);
  assert.deepEqual(await readCommunityPost(base, post.id, true, signal), response);
  response = page([spoilerComment]);
  assert.deepEqual((await readCommunityComments(base, post.id, { page: 1, size: 20 }, signal)).items, [spoilerComment]);
  response = page([{ ...spoilerComment, locked: false, body: comment.body }]);
  await assert.rejects(readCommunityComments(base, post.id, { page: 1, size: 20 }, signal), /형식/);
  assert.equal((await readCommunityComments(base, post.id, { page: 1, size: 20, revealIds: [comment.id] }, signal)).items[0].body, comment.body);
  response = { ...topicPost, hasSpoiler: undefined };
  await assert.rejects(readCommunityPost(base, post.id, false, signal), /형식/);
  response = page([{ ...spoilerComment, hasSpoiler: undefined }]);
  await assert.rejects(readCommunityComments(base, post.id, { page: 1, size: 20 }, signal), /형식/);
});

test('기존 세로 이미지와 저자 미등록 작품도 조회·수정에서 보존합니다.', async context => {
  const image = { url: '/community-assets/workshop.svg', width: 1024, height: 1536, representative: true };
  const payload = { ...post, work: { ...work, author: '' }, images: [image] };
  context.mock.method(globalThis, 'fetch', async () => Response.json(payload));
  assert.deepEqual(await readCommunityPost(base, post.id, false, signal), payload);
  const client = { request: async (_path, init) => {
    assert.deepEqual(JSON.parse(init.body).images, [{ url: image.url, width: 1024, height: 1536 }]);
    return { ...payload, mine: true };
  } };
  assert.equal((await updateCommunityPost(client, post.id, { ...input, images: [image] }, signal)).images[0].height, 1536);
});

test('댓글 여러 개는 같은 작성자라도 서로 다른 식별자로 유지합니다.', async context => {
  const items = [comment, { ...comment, id: '22', body: '덧붙일 내용입니다.' }];
  context.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, base + '/community/posts/' + post.id + '/comments?page=1&size=20');
    assert.equal(init.credentials, 'omit');
    return Response.json(page(items));
  });
  assert.deepEqual((await readCommunityComments(base, post.id, { page: 1, size: 20 }, signal)).items, items);
});

test('댓글 스포일러는 부모 확인과 분리하여 선택한 댓글만 해제합니다.', async context => {
  const first = { ...comment, spoiler: chapter, hasSpoiler: true }, second = { ...comment, id: '22', spoiler: chapter, hasSpoiler: true, body: null, locked: true };
  let payload = page([first, second]);
  context.mock.method(globalThis, 'fetch', async url => {
    const query = new URL(url).searchParams;
    assert.equal(query.get('revealPost'), 'true');
    assert.equal(query.get('revealIds'), '21');
    assert.equal(query.has('reveal'), false);
    return Response.json(payload);
  });
  const filter = { page: 1, size: 20, revealPost: true, revealIds: ['21', '21'] };
  assert.deepEqual(await readCommunityComments(base, post.id, filter, signal), payload);
  payload = page([first, { ...second, locked: false, body: '아직 확인하지 않은 내용' }]);
  await assert.rejects(readCommunityComments(base, post.id, filter, signal), /형식/);
});

test('댓글의 잠금 원문·다른 부모·중복 댓글·열람 ID 오류를 거부합니다.', async context => {
  let payload;
  context.mock.method(globalThis, 'fetch', async () => Response.json(payload));
  for (const invalid of [
    { ...comment, spoiler: chapter, hasSpoiler: true, locked: true },
    { ...comment, spoiler: chapter, hasSpoiler: true, locked: true, body: null, stickers: [sticker] },
    { ...comment, postId: '100' }, { ...comment, body: null }, { ...comment, mine: true },
  ]) {
    payload = page([invalid]);
    await assert.rejects(readCommunityComments(base, post.id, { page: 1, size: 20 }, signal), /형식/);
  }
  payload = page([comment, comment]);
  await assert.rejects(readCommunityComments(base, post.id, { page: 1, size: 20 }, signal), /형식/);
  for (const revealIds of [['../1'], ['1\n'], Array.from({ length: 51 }, (_, index) => String(index + 1))]) {
    await assert.rejects(readCommunityComments(base, post.id, { page: 1, size: 20, revealIds }, signal), /열람/);
  }
});

test('게시와 수정은 Unicode 공백을 정리하고 본인의 저장 응답을 확인합니다.', async () => {
  const title = '😀'.repeat(100), body = '😀'.repeat(10000);
  for (const update of [false, true]) {
    const client = { request: async (path, init) => {
      assert.equal(path, '/api/members/community/posts' + (update ? '/' + post.id : ''));
      assert.equal(init.method, update ? 'PUT' : 'POST');
      assert.equal(init.headers['Content-Type'], 'application/json');
      assert.equal(init.signal, signal);
      assert.deepEqual(JSON.parse(init.body), { ...input, title, body });
      return { ...own, title, body };
    } };
    const draft = { ...input, title: '\u0085 ' + title + '　', body: '\n' + body + '\u0085' };
    const result = update ? await updateCommunityPost(client, post.id, draft, signal) : await createCommunityPost(client, draft, signal);
    assert.equal(result.body, body);
  }
  const never = { request: () => assert.fail('유효하지 않은 글을 전송했습니다.') };
  for (const invalid of [{ ...input, title: '' }, { ...input, title: title + '😀' }, { ...input, body: body + '😀' },
    { ...input, workId: 'a'.repeat(101) },
    { ...input, workId: null, spoilerChapterId: chapter.id }, { ...input, stickerIds: Array(9).fill('1') }]) {
    await assert.rejects(createCommunityPost(never, invalid, signal));
  }
  const stored = { ...own, title: '서버의 제목', body: '서버의 본문' };
  assert.deepEqual(await createCommunityPost({ request: async () => stored }, input, signal), stored);
  assert.deepEqual(await updateCommunityPost({ request: async () => stored }, post.id, input, signal), stored);
  await assert.rejects(createCommunityPost({ request: async () => post }, input, signal), /형식/);
  await assert.rejects(updateCommunityPost({ request: async () => ({ ...own, id: '50' }) }, post.id, input, signal), /형식/);
});

test('기존 10,000자 본문과 첨부는 인라인 변환 뒤에도 제목을 수정하고 다시 조회할 수 있습니다.', async context => {
  const image = { url: '/community-images/2/kept.png', width: 800, height: 1200 };
  const original = '가'.repeat(9999) + '🙂';
  const body = normalizeCommunityBody(original, [image]);
  const edited = { ...input, title: '바뀐 제목', body, images: [image] };
  const result = { ...own, title: edited.title, body, images: [{ ...image, representative: true }] };
  let sent = 0;
  const client = { request: async (_path, init) => {
    sent++;
    assert.deepEqual(JSON.parse(init.body), edited);
    return result;
  } };
  assert.deepEqual(await updateCommunityPost(client, post.id, edited, signal), result);
  assert.equal(sent, 1);
  assert.deepEqual(parseCommunityDraftInput(edited), edited);
  context.mock.method(globalThis, 'fetch', async () => Response.json({ ...result, mine: false }));
  assert.equal((await readCommunityPost(base, post.id, false, signal)).body, body);
});

test('표시 본문 10,001자와 미등록·초과 이미지 표식은 작성·조회에서 길이 제한을 우회하지 못합니다.', async context => {
  const image = { url: '/community-images/2/kept.png', width: 800, height: 1200 };
  const marker = normalizeCommunityBody('', [image]);
  const unknown = normalizeCommunityBody('', [{ ...image, url: '/community-images/2/unknown.png' }]);
  let response;
  const never = { request: () => assert.fail('본문 제한을 넘은 글을 전송했습니다.') };
  context.mock.method(globalThis, 'fetch', async () => Response.json(response));
  for (const body of ['가'.repeat(10001) + marker, '가'.repeat(10000) + marker + marker, '가'.repeat(10000) + unknown]) {
    const edited = { ...input, body, images: [image] };
    await assert.rejects(updateCommunityPost(never, post.id, edited, signal), /10,000자/);
    assert.throws(() => parseCommunityDraftInput(edited), /10,000자/);
    response = { ...post, body, images: [{ ...image, representative: true }] };
    await assert.rejects(readCommunityPost(base, post.id, false, signal), /형식/);
  }
});

test('유효한 이미지 표식을 제외해도 저장 문자열 전체는 25,000자로 제한합니다.', async context => {
  const image = { url: 'https://images.example.test/' + 'a'.repeat(15000), width: 800, height: 1200 };
  const marker = normalizeCommunityBody('', [image]);
  const body = '가'.repeat(25000 - [...marker].length) + marker;
  const edited = { ...input, body, images: [image] };
  const result = { ...own, body, images: [{ ...image, representative: true }] };
  assert.deepEqual(await updateCommunityPost({ request: async () => result }, post.id, edited, signal), result);
  let response = { ...result, mine: false };
  context.mock.method(globalThis, 'fetch', async () => Response.json(response));
  assert.equal((await readCommunityPost(base, post.id, false, signal)).body, body);
  await assert.rejects(updateCommunityPost({ request: () => assert.fail('직렬화 제한을 넘은 글을 전송했습니다.') }, post.id,
    { ...edited, body: body + '가' }, signal), /10,000자/);
  response = { ...response, body: body + '가' };
  await assert.rejects(readCommunityPost(base, post.id, false, signal), /형식/);
});

test('회차 없는 스포일러 글·댓글을 등록하고 서버가 토글 값을 보존했는지 확인합니다.', async () => {
  const topicInput = { ...input, workId: null, head: 'STORY', hasSpoiler: true };
  const topicPost = { ...own, boardType: 'topic', work: null, head: 'STORY', hasSpoiler: true };
  const commentInput = { body: comment.body, hasSpoiler: true, spoilerChapterId: null, stickerIds: [] };
  const client = { request: async (path, init) => {
    const commentRequest = path.endsWith('/comments');
    assert.deepEqual(JSON.parse(init.body), commentRequest ? commentInput : topicInput);
    return commentRequest ? { ...comment, hasSpoiler: true, mine: true } : topicPost;
  } };
  assert.equal((await createCommunityPost(client, topicInput, signal)).hasSpoiler, true);
  assert.equal((await createCommunityComment(client, post.id, commentInput, signal)).hasSpoiler, true);
  await assert.rejects(createCommunityPost({ request: async () => ({ ...topicPost, hasSpoiler: false }) }, topicInput, signal), /형식/);
  await assert.rejects(createCommunityComment({ request: async () => ({ ...comment, mine: true }) }, post.id, commentInput, signal), /형식/);
  const never = { request: () => assert.fail('잘못된 스포일러 입력을 전송했습니다.') };
  for (const hasSpoiler of [undefined, null, 'true']) {
    await assert.rejects(createCommunityPost(never, { ...input, hasSpoiler }, signal), /입력/);
    await assert.rejects(createCommunityComment(never, post.id, { ...commentInput, hasSpoiler }, signal), /댓글/);
  }
  await assert.rejects(createCommunityPost(never, { ...input, hasSpoiler: false, spoilerChapterId: chapter.id }, signal), /입력/);
  await assert.rejects(createCommunityComment(never, post.id, { ...commentInput, hasSpoiler: false, spoilerChapterId: chapter.id }, signal), /댓글/);
});

test('댓글 생성·수정은 본문 또는 이모티콘을 보내고 다른 소유자 응답은 거부합니다.', async () => {
  let sequence = 30;
  const client = { request: async (path, init) => {
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.signal, signal);
    const draft = JSON.parse(init.body);
    assert.deepEqual(draft, { body: null, hasSpoiler: false, spoilerChapterId: null, stickerIds: ['1'] });
    assert.ok(path.startsWith('/api/members/community/'));
    return { ...comment, id: init.method === 'PUT' ? comment.id : String(++sequence), body: null, mine: true, stickers: [sticker] };
  } };
  const draft = { body: '　', hasSpoiler: false, spoilerChapterId: null, stickerIds: ['1'] };
  assert.notEqual((await createCommunityComment(client, post.id, draft, signal)).id, (await createCommunityComment(client, post.id, draft, signal)).id);
  assert.equal((await updateCommunityComment(client, comment.id, draft, signal)).id, comment.id);
  await assert.rejects(createCommunityComment(client, post.id, { ...draft, stickerIds: [] }, signal), /댓글/);
  await assert.rejects(createCommunityComment(client, post.id, { ...draft, stickerIds: Array(5).fill('1') }, signal), /이모티콘/);
  const stored = { ...comment, mine: true, body: '서버의 댓글' }, original = { body: comment.body, hasSpoiler: false, spoilerChapterId: null, stickerIds: [] };
  assert.deepEqual(await createCommunityComment({ request: async () => stored }, post.id, original, signal), stored);
  assert.deepEqual(await updateCommunityComment({ request: async () => stored }, comment.id, original, signal), stored);
  await assert.rejects(createCommunityComment({ request: async () => comment }, post.id,
    { body: comment.body, hasSpoiler: false, spoilerChapterId: null, stickerIds: [] }, signal), /형식/);
});

test('삭제는 대상별 DELETE 요청을 보내고 204 외 응답을 성공 처리하지 않습니다.', async () => {
  for (const [remove, path] of [
    [(client) => deleteCommunityPost(client, post.id, signal), '/api/members/community/posts/' + post.id],
    [(client) => deleteCommunityComment(client, comment.id, signal), '/api/members/community/comments/' + comment.id],
  ]) {
    await remove({ request: async (received, init) => { assert.equal(received, path); assert.deepEqual(init, { method: 'DELETE', signal }); return null; } });
    await assert.rejects(remove({ request: async () => ({ deleted: true }) }), /형식/);
  }
});

test('공감은 PUT·DELETE로 지정하고 신고는 사유와 선택 상세만 전송합니다.', async () => {
  for (const liked of [true, false]) {
    const client = { request: async (path, init) => {
      assert.equal(path, '/api/members/community/posts/' + post.id + '/like');
      assert.deepEqual(init, { method: liked ? 'PUT' : 'DELETE', signal });
      return { liked, likeCount: liked ? 1 : 0 };
    } };
    assert.deepEqual(await setCommunityLike(client, post.id, liked, signal), { liked, likeCount: liked ? 1 : 0 });
  }
  const client = { request: async (path, init) => {
    assert.equal(path, '/api/members/community/posts/' + post.id + '/reports');
    assert.deepEqual(JSON.parse(init.body), { reason: 'SPAM', detail: null });
    return { id: '70', reported: true };
  } };
  assert.equal(await reportCommunityPost(client, post.id, 'SPAM', '　', signal), undefined);
  assert.equal(await reportCommunityPost({ request: async () => ({ reported: true }) }, post.id, 'SPAM', '', signal), undefined);
  assert.deepEqual(await setCommunityLike({ request: async () => ({ liked: true, likeCount: 0 }) }, post.id, true, signal), { liked: true, likeCount: 0 });
  assert.equal((await readCommunityPost(base, post.id, false, signal, { request: async () => ({ ...post, liked: true }) })).liked, true);
  await assert.rejects(setCommunityLike({ request: async () => ({ liked: false, likeCount: 0 }) }, post.id, true, signal), /형식/);
  await assert.rejects(reportCommunityPost({ request: async () => ({ reported: false }) }, post.id, 'SPAM', '', signal), /형식/);
  await assert.rejects(reportCommunityPost(client, post.id, 'UNRECOGNIZED', '', signal), /신고/);
});

test('이미지 업로드는 형식·2MB·변환 크기를 확인하고 상대 URL을 유지합니다.', async () => {
  const image = { url: '/api/members/community/images/2/123.png', width: 512, height: 1024 };
  const base64 = Buffer.from([1, 2, 3, 4]).toString('base64');
  const client = { request: async (path, init) => {
    assert.equal(path, '/api/members/community/images');
    assert.deepEqual(JSON.parse(init.body), { base64, mimeType: 'image/png' });
    return image;
  } };
  assert.deepEqual(await uploadCommunityImage(client, base64, 'image/png', signal), image);
  const never = { request: () => assert.fail('유효하지 않은 이미지를 전송했습니다.') };
  for (const invalid of ['', 'data:image/png;base64,AAAA', 'AAA', 'AA===', 'AA*A', Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')]) {
    await assert.rejects(uploadCommunityImage(never, invalid, 'image/png', signal), /이미지/);
  }
  await assert.rejects(uploadCommunityImage({ request: async () => ({ ...image, height: 1025 }) }, base64, 'image/png', signal), /형식/);
  await assert.rejects(uploadCommunityImage({ request: async () => ({ ...image, url: 'https://other.test/image.png' }) }, base64, 'image/png', signal), /형식/);
});

test('이미지 절대 주소 변환은 API 접두사를 유지하고 실행·파일·경로 탈출 주소를 거부합니다.', () => {
  assert.equal(communityImageUrl(base + '/', '/stickers/emote-wave.svg'), base + '/stickers/emote-wave.svg');
  assert.equal(communityImageUrl(base, 'community/images/2/1.png?reveal=true'), base + '/community/images/2/1.png?reveal=true');
  assert.equal(communityImageUrl(base, 'https://images.example.test/a.png'), 'https://images.example.test/a.png');
  for (const invalid of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///tmp/image.png', '//other.test/a.png',
    'https://user:password@example.test/a.png', '../secret.png', '/images/../secret.png', '/images/%2e%2e/secret.png', '/a\\b.png', '/a.png#part', '/a.png\n']) {
    assert.throws(() => communityImageUrl(base, invalid), /형식/);
  }
  assert.equal(normalizeCommunityText('\u0085　본문\n다음 줄　'), '본문\n다음 줄');
});

test('실제 회원 클라이언트의 쿠키·CSRF·권한 오류 처리를 그대로 사용합니다.', async () => {
  const identity = { id: '2', email: 'reader@example.test', nickname: '독자', createdAt: timestamp };
  let deny = false;
  const client = createMemberSessionClient(base, async (url, init) => {
    assert.equal(init.credentials, 'include');
    if (url.endsWith('/api/auth/session')) return Response.json(identity);
    if (url.endsWith('/api/auth/csrf')) return Response.json({ token: 'test-token', headerName: 'X-CSRF-TOKEN' });
    assert.equal(url, base + '/api/members/community/posts');
    assert.equal(new Headers(init.headers).get('X-CSRF-TOKEN'), 'test-token');
    assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json');
    return deny ? Response.json({}, { status: 403 }) : Response.json(own, { status: 201 });
  });
  await client.refresh();
  assert.deepEqual(await createCommunityPost(client, input, signal), own);
  deny = true;
  await assert.rejects(createCommunityPost(client, input, signal), error => error instanceof MemberRequestError && error.status === 403);
  client.dispose();
});

test('취소된 공개 조회와 폐기된 회원 세션의 늦은 응답을 성공으로 바꾸지 않습니다.', async context => {
  const cancellation = new Error('조회 취소'); cancellation.name = 'AbortError';
  const controller = new AbortController(); controller.abort();
  context.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(init.signal, controller.signal);
    throw cancellation;
  });
  await assert.rejects(readCommunityPosts(base, { page: 1, size: 20 }, controller.signal), error => error === cancellation);

  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const identity = { id: '2', email: 'reader@example.test', nickname: '독자', createdAt: timestamp };
  const client = createMemberSessionClient(base, async url => {
    if (url.endsWith('/api/auth/session')) return Response.json(identity);
    if (url.endsWith('/api/auth/csrf')) return Response.json({ token: 'token', headerName: 'X-CSRF-TOKEN' });
    return pending;
  });
  await client.refresh();
  const request = createCommunityPost(client, input, signal);
  await new Promise(resolve => setImmediate(resolve));
  client.dispose(); complete(Response.json(own));
  await assert.rejects(request, error => error.name === 'AbortError');
});
