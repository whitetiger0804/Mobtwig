import assert from 'node:assert/strict';
import { test } from 'node:test';
import { communityBodyTextLength, insertCommunityBodyImage, normalizeCommunityBody, removeCommunityBodyImage, splitCommunityBody } from '../src/communityBody.ts';

const first = { url: '/community-images/1/first.png', width: 800, height: 1200 };
const second = { url: '/community-images/1/second.png', width: 900, height: 600 };
const third = { url: '/community-images/1/third.png', width: 400, height: 400 };
const fourth = { url: '/community-images/1/fourth.png', width: 400, height: 400 };
const marker = image => `![이미지](<${image.url}>)`;
const text = blocks => blocks.filter(block => block.type === 'text').map(block => block.text).join('');

test('이미지가 없는 본문과 빈 본문은 원문 범위 그대로 하나의 입력 블록입니다.', () => {
  for (const body of ['', '첫 줄\n🙂 둘째 줄  ']) {
    assert.deepEqual(splitCommunityBody(body, []), [{ type: 'text', text: body, start: 0, end: body.length }]);
  }
});

test('기존 별도 첨부는 텍스트를 바꾸지 않고 끝에 배치하며 다시 정규화해도 늘어나지 않습니다.', () => {
  const body = '기존 글의 앞뒤 공백을 유지합니다.  \n';
  const normalized = normalizeCommunityBody(body, [first, second]);
  assert.equal(normalized, body + marker(first) + marker(second));
  assert.equal(text(splitCommunityBody(normalized, [first, second])), body);
  assert.equal(normalizeCommunityBody(normalized, [first, second]), normalized);
  assert.equal(normalizeCommunityBody(marker(first) + '중간', [first, second]), marker(first) + '중간' + marker(second));
  const backslash = normalizeCommunityBody('기존 역슬래시\\', [first]);
  assert.equal(normalizeCommunityBody(backslash, [first]), backslash);
  assert.equal(text(splitCommunityBody(backslash, [first])), '기존 역슬래시\\');
});

test('한글·이모지가 있는 본문 중간의 UTF-16 커서 위치에 이미지를 삽입합니다.', () => {
  const body = '가🙂나\n다';
  const inserted = insertCommunityBodyImage(body, [], { start: 3, end: 3 }, first);
  assert.equal(inserted.body, '가🙂' + marker(first) + '나\n다');
  assert.deepEqual(inserted.selection, { start: 3 + marker(first).length, end: 3 + marker(first).length });
  const blocks = splitCommunityBody(inserted.body, inserted.images);
  assert.deepEqual(blocks.map(block => block.type), ['text', 'image', 'text']);
  assert.equal(blocks[0].text, '가🙂');
  assert.equal(blocks[0].end, 3);
  assert.equal(blocks[2].text, '나\n다');
  assert.equal(blocks[2].start, inserted.selection.start);
});

test('선택한 텍스트만 교체하고 빈 앞뒤 블록을 남겨 이미지 전후에 계속 입력할 수 있습니다.', () => {
  const replaced = insertCommunityBodyImage('가운데를 선택', [], { start: 0, end: 7 }, first);
  assert.equal(replaced.body, marker(first));
  assert.deepEqual(splitCommunityBody(replaced.body, replaced.images).map(block => block.type === 'text' ? block.text : block.image.url),
    ['', first.url, '']);
  const added = insertCommunityBodyImage(replaced.body, replaced.images, replaced.selection, second);
  assert.deepEqual(splitCommunityBody(added.body, added.images).map(block => block.type === 'text' ? block.text : block.image.url),
    ['', first.url, '', second.url, '']);
});

test('앞에 삽입한 이미지가 첨부 배열의 첫 항목이 되고 본문 순서를 따릅니다.', () => {
  const inserted = insertCommunityBodyImage('첫 문장' + marker(first), [first], { start: 0, end: 0 }, second);
  assert.deepEqual(inserted.images, [second, first]);
  assert.equal(text(splitCommunityBody(inserted.body, inserted.images)), '첫 문장');
  const original = structuredClone(inserted);
  const removed = removeCommunityBodyImage(inserted.body, inserted.images, inserted.selection, 'Backspace');
  assert.deepEqual(removed, { body: '첫 문장' + marker(first), images: [first], selection: { start: 0, end: 0 } });
  assert.deepEqual(inserted, original);
});

test('첨부에 없는 URL 표식과 다른 마크다운 표식은 이미지로 바꾸지 않습니다.', () => {
  const unknown = '![이미지](<https://unknown.example.test/file.png>)';
  const other = `![다른 이름](<${first.url}>)`;
  const body = unknown + '\n' + other + '\n\\' + marker(first);
  const blocks = splitCommunityBody(body, [first]);
  assert.equal(blocks.filter(block => block.type === 'image').length, 1);
  assert.equal(text(blocks), unknown + '\n' + other + '\n\\');
});

test('공백·한글·괄호·꺾쇠와 기존 퍼센트 인코딩이 있는 이미지 URL도 경계를 보존합니다.', () => {
  const image = { url: '/사진/표지 (1)>끝%20.png?q=a&b=(값)', width: 120, height: 80 };
  const inserted = insertCommunityBodyImage('앞뒤', [], { start: 1, end: 1 }, image);
  assert.match(inserted.body, /%3E/);
  assert.doesNotMatch(inserted.body, /%2520/);
  const blocks = splitCommunityBody(inserted.body, inserted.images);
  assert.deepEqual(blocks[1].image, image);
  assert.equal(blocks[0].text, '앞');
  assert.equal(blocks[2].text, '뒤');
  assert.equal(normalizeCommunityBody(inserted.body, inserted.images), inserted.body);
});

test('이미지 앞의 Delete는 해당 표식만 제거하고 다른 이미지와 본문을 보존합니다.', () => {
  const body = '앞' + marker(first) + '중간' + marker(second) + '뒤';
  assert.deepEqual(removeCommunityBodyImage(body, [first, second], { start: 1, end: 1 }, 'Delete'),
    { body: '앞중간' + marker(second) + '뒤', images: [second], selection: { start: 1, end: 1 } });
  const secondStart = 3 + marker(first).length;
  assert.deepEqual(removeCommunityBodyImage(body, [first, second], { start: secondStart, end: secondStart }, 'Delete'),
    { body: '앞' + marker(first) + '중간뒤', images: [first], selection: { start: secondStart, end: secondStart } });
  assert.deepEqual(removeCommunityBodyImage('기존 본문', [first, second], { start: 5, end: 5 }, 'Delete'),
    { body: '기존 본문' + marker(second), images: [second], selection: { start: 5, end: 5 } });
});

test('같은 URL의 기존 첨부도 커서에 인접한 하나만 삭제합니다.', () => {
  const normalized = normalizeCommunityBody('본문', [first, first, second]);
  assert.equal(splitCommunityBody(normalized, [first, first, second]).filter(block => block.type === 'image').length, 3);
  assert.equal(normalizeCommunityBody(normalized, [first, first, second]), normalized);
  const cursor = 2 + marker(first).length * 2;
  const removed = removeCommunityBodyImage(normalized, [first, first, second], { start: cursor, end: cursor }, 'Backspace');
  assert.deepEqual(removed, { body: '본문' + marker(first) + marker(second), images: [first, second],
    selection: { start: 2 + marker(first).length, end: 2 + marker(first).length } });
  assert.deepEqual(removeCommunityBodyImage(removed.body, removed.images, { start: 2, end: 2 }, 'Delete'),
    { body: '본문' + marker(second), images: [second], selection: { start: 2, end: 2 } });
});

test('중복·첨부 한도·본문 한도·이미지 표식 안의 커서를 명확히 거부합니다.', () => {
  assert.throws(() => insertCommunityBodyImage('', [first], { start: 0, end: 0 }, first), /이미 첨부/);
  assert.throws(() => insertCommunityBodyImage('', [first, second, third], { start: 0, end: 0 }, fourth), /3개/);
  assert.throws(() => insertCommunityBodyImage('가'.repeat(10001), [], { start: 0, end: 0 }, first), /10,000자/);
  const maximum = insertCommunityBodyImage('가'.repeat(10000), [], { start: 0, end: 0 }, first);
  assert.equal(communityBodyTextLength(maximum.body, maximum.images), 10000);
  assert.throws(() => insertCommunityBodyImage('가'.repeat(5000), [], { start: 0, end: 0 },
    { ...first, url: '/' + 'a'.repeat(20000) + '.png' }), /저장 크기/);
  for (const selection of [{ start: -1, end: 0 }, { start: 0, end: 2 }, { start: 1, end: 0 }, { start: 0.5, end: 1 }]) {
    assert.throws(() => insertCommunityBodyImage('가', [], selection, first), /본문 위치/);
  }
  assert.throws(() => insertCommunityBodyImage(marker(first), [first], { start: 2, end: 2 }, second), /본문 위치/);
  assert.equal(removeCommunityBodyImage('', [], { start: 0, end: 0 }, 'Backspace'), null);
});

test('업로드·발행·스포일러 해제·수정 왕복에서 이미지 위치·개수·대표 순서를 유지합니다.', () => {
  const canonical = '/community/images/-13/01234567-89ab-cdef-0123-456789abcdef.png';
  const canonicalSecond = '/community/images/-13/11234567-89ab-cdef-0123-456789abcdef.png';
  const upload = { ...first, url: '/api/members' + canonical };
  const uploadSecond = { ...second, url: '/api/members' + canonicalSecond };
  const original = insertCommunityBodyImage('앞🙂뒤', [], { start: 3, end: 3 }, upload);
  assert.equal(original.body, '앞🙂' + marker({ url: canonical }) + '뒤');
  assert.equal(original.images[0].url, upload.url);
  const addedBefore = insertCommunityBodyImage(original.body, original.images, { start: 0, end: 0 }, uploadSecond);
  assert.deepEqual(addedBefore.images.map(image => image.url), [uploadSecond.url, upload.url]);
  const originalPositions = splitCommunityBody(addedBefore.body, addedBefore.images).map(block => [block.type, block.start, block.end]);
  for (const [prefix, query] of [['', ''], ['', '?reveal=true'], ['/api/members', '?reveal=true']]) {
    const responseImages = [{ ...second, url: prefix + canonicalSecond + query }, { ...first, url: prefix + canonical + query }];
    const restored = normalizeCommunityBody(addedBefore.body, responseImages);
    assert.equal(restored, addedBefore.body);
    const blocks = splitCommunityBody(restored, responseImages);
    assert.deepEqual(blocks.map(block => [block.type, block.start, block.end]), originalPositions);
    assert.deepEqual(blocks.filter(block => block.type === 'image').map(block => block.image.url), responseImages.map(image => image.url));
    assert.equal(text(blocks), '앞🙂뒤');
    const edit = insertCommunityBodyImage(restored, responseImages, { start: restored.length, end: restored.length }, third);
    assert.deepEqual(edit.images, [...responseImages, third]);
    assert.deepEqual(removeCommunityBodyImage(edit.body, edit.images, edit.selection, 'Backspace'),
      { body: restored, images: responseImages, selection: { start: restored.length, end: restored.length } });
    assert.throws(() => insertCommunityBodyImage(restored, responseImages, { start: 0, end: 0 }, upload), /이미 첨부/);
  }
});

test('기존 업로드 URL 표식도 공개 또는 회원 응답 이미지 하나로 해석합니다.', () => {
  const canonical = '/community/images/13/01234567-89ab-cdef-0123-456789abcdef.png';
  const body = '앞' + marker({ url: '/api/members' + canonical }) + '중간'
    + marker({ url: canonical + '?reveal=true' }) + '뒤';
  const revealed = { ...first, url: canonical + '?reveal=true' };
  const own = { ...first, url: '/api/members' + canonical + '?reveal=true' };
  for (const image of [revealed, own]) {
    assert.equal(normalizeCommunityBody(body, [image, image]), body);
    const blocks = splitCommunityBody(body, [image, image]);
    assert.equal(blocks.filter(block => block.type === 'image').length, 2);
    assert.equal(text(blocks), '앞중간뒤');
    const removed = removeCommunityBodyImage(body, [image, image], { start: 1, end: 1 }, 'Delete');
    assert.deepEqual(removed, { body: '앞중간' + marker({ url: canonical + '?reveal=true' }) + '뒤',
      images: [image], selection: { start: 1, end: 1 } });
    assert.deepEqual(removeCommunityBodyImage(removed.body, removed.images, { start: 3, end: 3 }, 'Delete'),
      { body: '앞중간뒤', images: [], selection: { start: 3, end: 3 } });
  }
});

test('외부 URL의 query와 서버 관리 규칙 밖의 경로는 서로 다른 이미지로 유지합니다.', () => {
  const canonical = '/community/images/13/01234567-89ab-cdef-0123-456789abcdef.png';
  const distinctUrls = [
    canonical + '?reveal=false', canonical + '?reveal=true&size=small', canonical + '?size=small',
    'https://images.example.test' + canonical, 'https://images.example.test' + canonical + '?reveal=true',
    '/community/images/13/not-a-uuid.png', '/api/members/community/images/13/not-a-uuid.png',
  ];
  const images = distinctUrls.map(url => ({ ...first, url }));
  for (let i = 0; i < images.length; i++) {
    const body = marker(images[i]);
    assert.equal(splitCommunityBody(body, [images[i]])[1].image.url, images[i].url);
    for (let j = 0; j < images.length; j++) {
      if (i === j) continue;
      assert.deepEqual(splitCommunityBody(body, [images[j]]), [{ type: 'text', text: body, start: 0, end: body.length }]);
    }
    assert.deepEqual(splitCommunityBody(body, [{ ...first, url: canonical }]), [{ type: 'text', text: body, start: 0, end: body.length }]);
  }
});

test('기존 10,000자 본문에 첨부를 배치하거나 추가해도 표시 텍스트 한도를 넘지 않습니다.', () => {
  const old = '가'.repeat(9999) + '🙂';
  const normalized = normalizeCommunityBody(old, [first, second]);
  assert.ok([...normalized].length > 10000);
  assert.equal(communityBodyTextLength(normalized, [first, second]), 10000);
  const changed = insertCommunityBodyImage(normalized, [first, second], { start: 0, end: 0 }, third);
  assert.equal(communityBodyTextLength(changed.body, changed.images), 10000);
  assert.deepEqual(changed.images, [third, first, second]);
  assert.equal(text(splitCommunityBody(changed.body, changed.images)), old);
});

test('등록 첨부 개수와 최대 세 개를 넘는 표식은 텍스트 길이에 포함합니다.', () => {
  const repeated = marker(first).repeat(4);
  for (let count = 0; count <= 4; count++) {
    const images = Array(count).fill(first);
    const accepted = Math.min(count, 3);
    assert.equal(splitCommunityBody(repeated, images).filter(block => block.type === 'image').length, accepted);
    assert.equal(communityBodyTextLength(repeated, images), [...marker(first)].length * (4 - accepted));
  }
  assert.equal(communityBodyTextLength(marker(first) + marker(second), [first, first]), [...marker(second)].length);
  const unknown = '![이미지](<https://other.example.test/image.png>)';
  assert.equal(communityBodyTextLength('🙂' + marker(first) + unknown, [first]), 1 + [...unknown].length);
});

test('연속 이미지 사이의 커서는 Backspace와 Delete가 각각 인접한 한 장만 삭제합니다.', () => {
  const body = marker(first) + marker(second);
  const selection = { start: marker(first).length, end: marker(first).length };
  assert.deepEqual(removeCommunityBodyImage(body, [first, second], selection, 'Backspace'),
    { body: marker(second), images: [second], selection: { start: 0, end: 0 } });
  assert.deepEqual(removeCommunityBodyImage(body, [first, second], selection, 'Delete'),
    { body: marker(first), images: [first], selection });
});

test('일반 텍스트와 선택 영역 삭제는 네이티브 입력에 맡깁니다.', () => {
  const body = '가🙂' + marker(first) + '나';
  const imageStart = 3, imageEnd = imageStart + marker(first).length;
  for (const key of ['Backspace', 'Delete']) {
    for (const selection of [{ start: 1, end: 1 }, { start: 0, end: 1 }, { start: imageStart, end: imageEnd },
      { start: imageStart + 1, end: imageStart + 1 }]) {
      assert.equal(removeCommunityBodyImage(body, [first], selection, key), null);
    }
  }
  assert.equal(removeCommunityBodyImage(body, [first], { start: imageStart, end: imageStart }, 'Backspace'), null);
  assert.equal(removeCommunityBodyImage(body, [first], { start: imageEnd, end: imageEnd }, 'Delete'), null);
  assert.deepEqual(removeCommunityBodyImage(body, [first], { start: imageEnd, end: imageEnd }, 'Backspace'),
    { body: '가🙂나', images: [], selection: { start: imageStart, end: imageStart } });
});

test('첨부 수를 넘은 일반 텍스트 표식은 키보드 이미지 삭제로 제거하지 않습니다.', () => {
  const body = marker(first).repeat(2);
  const selection = { start: body.length, end: body.length };
  assert.equal(removeCommunityBodyImage(body, [first], selection, 'Backspace'), null);
  const removed = removeCommunityBodyImage(body, [first], { start: 0, end: 0 }, 'Delete');
  assert.deepEqual(removed, { body: marker(first), images: [], selection: { start: 0, end: 0 } });
  assert.equal(communityBodyTextLength(removed.body, removed.images), [...marker(first)].length);
});
