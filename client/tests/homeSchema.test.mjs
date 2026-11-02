import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseHomeResponse } from '../src/homeSchema.ts';

// #region 실제 간이 서버 예시와 입력 변경 유틸리티

const fixtures = JSON.parse(await readFile(new URL('../../server/mock/fixtures/home.json', import.meta.url), 'utf8'));

/**
 * 원본 예시를 보존하면서 지정한 입력만 바꿉니다.
 *
 * @param change - 전체 화면의 복사본에 적용할 변경입니다.
 * @returns 검사에 사용할 독립된 화면 응답입니다.
 */
function changedHome(change) {
  const home = structuredClone(fixtures.all);
  change(home);
  return home;
}

/**
 * 검증 대상의 특정 요소를 응답에서 가져옵니다.
 *
 * @param home - 조회할 화면 응답입니다.
 * @param type - 찾을 요소의 종류입니다.
 * @returns 지정한 종류의 첫 번째 구역입니다.
 */
function sectionOf(home, type) {
  const section = home.sections.find((candidate) => candidate.type === type);
  assert.ok(section, `${type} 예시가 있어야 합니다.`);
  return section;
}

// #endregion

// #region 정상 응답과 가변 화면 구성

test('간이 서버의 네 종류 실제 응답을 내용 변경 없이 수용합니다.', () => {
  for (const kind of ['all', 'book', 'magazine', 'novel']) {
    assert.deepEqual(parseHomeResponse(fixtures[kind]), fixtures[kind], kind);
  }
});

test('세 요소 모두 0개·1개·여러 개 입력과 서버의 표시 순서를 보존합니다.', () => {
  for (const count of [0, 1, 9]) {
    const home = changedHome((response) => {
      response.sections = ['linkRow', 'workShelf', 'bannerCarousel'].map((type) => {
        const section = sectionOf(response, type);
        const example = section.items[0];
        section.title = `서버에서 지정한 ${type} 제목`;
        section.items = Array.from({ length: count }, (_, index) => ({
          ...example,
          id: `${type}-item-${index}`,
        })).reverse();
        return section;
      });
    });

    const parsed = parseHomeResponse(home);
    assert.deepEqual(parsed, home);
    assert.deepEqual(parsed.sections.map((section) => section.type), ['linkRow', 'workShelf', 'bannerCarousel']);

    for (const section of parsed.sections) {
      assert.equal(section.items.length, count);
      assert.deepEqual(section.items.map((item) => item.id), home.sections.find((source) => source.id === section.id).items.map((item) => item.id));
    }
  }
});

test('빈 화면·최소 필수 속성의 빈 구역·선택 속성 생략을 수용합니다.', () => {
  assert.deepEqual(parseHomeResponse({ version: 1, sections: [] }), { version: 1, sections: [] });
  const emptySections = {
    version: 1,
    sections: ['bannerCarousel', 'featuredWork', 'workShelf', 'linkRow'].map((type) => ({ id: type, type, items: [] })),
  };
  assert.deepEqual(parseHomeResponse(emptySections), emptySections);
  const home = changedHome((response) => {
    for (const section of response.sections) {
      delete section.title;
      delete section.action;
      for (const item of section.items) {
        delete item.description;
        delete item.subtitle;
        delete item.icon;
        delete item.action;
      }
    }
  });
  assert.deepEqual(parseHomeResponse(home), home);
});

test('추천 작품의 문구·순서·0개·1개·여러 개 구성을 서버 응답 그대로 수용합니다.', () => {
  for (const count of [0, 1, 3]) {
    const home = structuredClone(fixtures.book);
    const featured = sectionOf(home, 'featuredWork');
    const example = featured.items[0];
    featured.items = Array.from({ length: count }, (_, index) => ({
      ...example,
      id: `featured-${index}`,
      label: `서버에서 정한 추천 ${index}`,
      title: `서버에서 정한 작품 ${index}`,
    })).reverse();
    for (const item of featured.items) {
      delete item.subtitle;
      delete item.action;
    }
    home.sections.reverse();
    const parsed = parseHomeResponse(home);
    assert.deepEqual(parsed, home);
    assert.equal(sectionOf(parsed, 'featuredWork').items.length, count);
  }
});

test('다른 구역 사이에서는 같은 작품 식별자를 재사용할 수 있습니다.', () => {
  const home = changedHome((response) => {
    const shelf = structuredClone(sectionOf(response, 'workShelf'));
    shelf.id = 'same-works-another-section';
    response.sections.push(shelf);
  });
  assert.deepEqual(parseHomeResponse(home), home);
});

test('한글·공백 이미지 파일명과 HTTP(S) 이미지 주소를 수용합니다.', () => {
  for (const imageUrl of [
    '/assets/도서/고요를 연습하는 시간.png',
    '/assets/React%20Native%20첫걸음.png',
    'http://127.0.0.1:8090/assets/cover.png',
    'https://example.com/assets/cover.png?version=2',
  ]) {
    const home = changedHome((response) => { sectionOf(response, 'workShelf').items[0].imageUrl = imageUrl; });
    assert.deepEqual(parseHomeResponse(home), home, imageUrl);
  }
});

test('작품 식별자가 있는 상세 이동을 수용하고 누락되거나 잘못된 식별자는 거절합니다.', () => {
  const home = changedHome((response) => {
    response.sections[0].action = { label: '상세 보기', route: { screen: 'detail', workId: 'book-care' } };
  });
  assert.deepEqual(parseHomeResponse(home), home);
  for (const workId of [undefined, '', ' ', 3, null]) {
    home.sections[0].action.route.workId = workId;
    assert.throws(() => parseHomeResponse(home), Error);
  }
});

// #endregion

// #region 잘못된 응답의 명시적 거절

test('지원하지 않는 버전과 최상위 응답 형태를 거절합니다.', () => {
  for (const invalid of [null, [], {}, { version: 2, sections: [] }, { version: '1', sections: [] }, { version: 1, sections: {} }]) {
    assert.throws(() => parseHomeResponse(invalid), Error);
  }
});

test('알 수 없는 요소와 배열이 아닌 항목을 조용히 건너뛰지 않습니다.', () => {
  for (const change of [
    (home) => { home.sections[0].type = 'customUnknownWidget'; },
    (home) => { home.sections[0].items = {}; },
    (home) => { home.sections[0].items = null; },
    (home) => { home.sections.push(null); },
    (home) => { home.sections[0].items.push(null); },
  ]) {
    assert.throws(() => parseHomeResponse(changedHome(change)), Error);
  }
});

test('같은 배열의 중복 구역·항목 식별자를 거절합니다.', () => {
  const duplicateSection = changedHome((home) => { home.sections.push(structuredClone(home.sections[0])); });
  assert.throws(() => parseHomeResponse(duplicateSection), Error);

  for (const type of ['bannerCarousel', 'workShelf', 'linkRow']) {
    const duplicateItem = changedHome((home) => {
      const section = sectionOf(home, type);
      section.items.push(structuredClone(section.items[0]));
    });
    assert.throws(() => parseHomeResponse(duplicateItem), Error, type);
  }
});

test('필수 문자열과 제공된 선택 문자열이 비어 있으면 거절합니다.', () => {
  for (const change of [
    (home) => { home.sections[0].id = ' '; },
    (home) => { home.sections[0].title = '\t'; },
    (home) => { sectionOf(home, 'workShelf').items[0].id = ''; },
    (home) => { sectionOf(home, 'workShelf').items[0].title = ' '; },
    (home) => { sectionOf(home, 'workShelf').items[0].subtitle = ''; },
    (home) => { sectionOf(home, 'bannerCarousel').items[0].description = ''; },
    (home) => { sectionOf(home, 'linkRow').items[0].label = ''; },
  ]) {
    assert.throws(() => parseHomeResponse(changedHome(change)), Error);
  }
});

test('구역·배너·바로가기의 잘못된 동작을 모두 거절합니다.', () => {
  for (const action of [
    null,
    { label: '', route: { screen: 'home' } },
    { label: '이동', route: null },
    { label: '이동', route: { screen: 'https://example.com' } },
    { label: '이동', route: { screen: 'home', kind: 'unsupported' } },
  ]) {
    for (const change of [
      (home) => { home.sections[0].action = action; },
      (home) => { sectionOf(home, 'bannerCarousel').items[0].action = action; },
      (home) => { sectionOf(home, 'linkRow').items[0] = { id: 'invalid-link', ...action }; },
    ]) {
      assert.throws(() => parseHomeResponse(changedHome(change)), Error);
    }
  }
});

test('등록되지 않은 바로가기 아이콘을 다른 아이콘으로 대체하지 않습니다.', () => {
  const home = changedHome((response) => { sectionOf(response, 'linkRow').items[0].icon = 'not-registered'; });
  assert.throws(() => parseHomeResponse(home), Error);
});

test('추천 작품의 잘못된 문구·표지·이동 대상과 중복 항목을 거절합니다.', () => {
  for (const change of [
    (section) => { delete section.items[0].label; },
    (section) => { section.items[0].label = ' '; },
    (section) => { section.items[0].title = ''; },
    (section) => { section.items[0].imageUrl = 'javascript:alert(1)'; },
    (section) => { section.items[0].subtitle = null; },
    (section) => { section.items[0].action = { label: '이동', route: { screen: 'unknown' } }; },
    (section) => { section.items.push(structuredClone(section.items[0])); },
  ]) {
    const home = structuredClone(fixtures.book);
    change(sectionOf(home, 'featuredWork'));
    assert.throws(() => parseHomeResponse(home), Error);
  }
});

test('지원하지 않는 스킴과 올바르지 않은 이미지 주소를 거절합니다.', () => {
  for (const imageUrl of [
    '',
    'javascript:alert(1)',
    'file:///C:/private/cover.png',
    'data:image/png;base64,AAAA',
    '//example.com/cover.png',
    '../cover.png',
    '/assets\\cover.png',
    '/assets/\ncover.png',
    'https://',
    'https://?',
    'https://example.com:invalid/cover.png',
  ]) {
    for (const type of ['bannerCarousel', 'workShelf']) {
      const home = changedHome((response) => { sectionOf(response, type).items[0].imageUrl = imageUrl; });
      assert.throws(() => parseHomeResponse(home), Error, `${type}: ${imageUrl}`);
    }
  }
});

// #endregion
