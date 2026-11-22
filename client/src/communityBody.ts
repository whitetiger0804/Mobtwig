// #region 본문과 이미지 블록
import type { CommunityImage } from './community.ts';

/** 본문 안에서 표시할 업로드된 이미지입니다. 배열의 첫 이미지가 대표 이미지입니다. */
export type CommunityBodyImage = Pick<CommunityImage, 'url' | 'width' | 'height'>;
/** TextInput이 제공하는 UTF-16 문자열 선택 범위입니다. */
export interface CommunityBodySelection { start: number; end: number }
/** 시작·끝 위치는 표식을 포함한 원본 본문의 UTF-16 오프셋입니다. */
export type CommunityBodyBlock =
  | { type: 'text'; text: string; start: number; end: number }
  | { type: 'image'; image: CommunityBodyImage; start: number; end: number };
/** 본문과 본문 순서에 맞춘 첨부 목록입니다. */
export interface CommunityBodyContent { body: string; images: CommunityBodyImage[] }

/** 서버가 관리하는 같은 파일의 회원·공개·스포일러 표시 주소만 같은 식별자로 취급합니다. */
function imageKey(url: string): string {
  const managed = /^(?:\/api\/members)?(\/community\/images\/-?[1-9][0-9]{0,18}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png)(?:\?reveal=true)?$/.exec(url);
  return managed?.[0] === url ? managed[1] : url;
}

/** 유효한 퍼센트 인코딩은 보존하고 공백·꺾쇠 등 링크 목적지를 깨는 문자를 인코딩합니다. */
function imageHref(url: string): string {
  return encodeURI(imageKey(url)).replace(/%25([0-9a-f]{2})/gi, '%$1');
}

function imageMarker(image: CommunityBodyImage): string { return `![이미지](<${imageHref(image.url)}>)`; }

/** 등록된 첨부의 표식만 해석하며 빈 텍스트 블록도 보존합니다. */
function blocks(body: string, images: readonly CommunityBodyImage[]): CommunityBodyBlock[] {
  const attachments = new Map<string, { image: CommunityBodyImage; remaining: number }>();
  for (const image of images.slice(0, 3)) {
    const key = imageKey(image.url), existing = attachments.get(key);
    if (existing) existing.remaining++;
    else attachments.set(key, { image, remaining: 1 });
  }
  const byHref = new Map<string, { image: CommunityBodyImage; remaining: number }>();
  for (const [key, attachment] of attachments) { byHref.set(imageHref(key), attachment); byHref.set(key, attachment); }
  const result: CommunityBodyBlock[] = [];
  let cursor = 0;
  for (const match of body.matchAll(/!\[이미지\]\(<([^<>\r\n]*)>\)/g)) {
    const attachment = byHref.get(imageKey(match[1]));
    if (!attachment || attachment.remaining === 0) continue;
    attachment.remaining--;
    result.push({ type: 'text', text: body.slice(cursor, match.index), start: cursor, end: match.index });
    cursor = match.index + match[0].length;
    result.push({ type: 'image', image: attachment.image, start: match.index, end: cursor });
  }
  result.push({ type: 'text', text: body.slice(cursor), start: cursor, end: body.length });
  return result;
}

function orderedImages(body: string, images: readonly CommunityBodyImage[]): CommunityBodyImage[] {
  return blocks(body, images).flatMap(block => block.type === 'image'
    ? [{ url: block.image.url, width: block.image.width, height: block.image.height }] : []);
}
// #endregion

// #region 기존 첨부 복원과 표시
/**
 * 표식 없이 별도 저장했던 기존 첨부를 본문 끝에 배치하여 표시·편집할 본문을 만듭니다.
 * @param body - 저장되어 있던 본문입니다.
 * @param images - 기존 첨부 목록입니다. 같은 URL의 기존 첨부도 개수대로 보존합니다.
 * @returns 기존 텍스트와 표식은 그대로 두고 누락된 이미지 표식만 끝에 추가한 본문입니다.
 * @remarks 저장 요청은 하지 않으며 기존 글의 텍스트를 길이 제한에 맞춰 잘라내지 않습니다.
 */
export function normalizeCommunityBody(body: string, images: readonly CommunityBodyImage[]): string {
  const represented = new Map<string, number>();
  for (const block of blocks(body, images)) {
    if (block.type === 'image') {
      const key = imageKey(block.image.url);
      represented.set(key, (represented.get(key) ?? 0) + 1);
    }
  }
  let result = body;
  for (const image of images) {
    const key = imageKey(image.url), remaining = represented.get(key) ?? 0;
    if (remaining > 0) represented.set(key, remaining - 1);
    else result += imageMarker(image);
  }
  return result;
}

/**
 * 본문을 텍스트 입력 영역과 전체 너비 이미지로 나눕니다.
 * @param body - 표식을 포함한 본문입니다. 기존 별도 첨부는 normalizeCommunityBody로 먼저 배치합니다.
 * @param images - 서버 또는 로컬 초안에서 확인한 첨부 목록입니다.
 * @returns 이미지 앞뒤의 빈 텍스트 블록과 원본 UTF-16 범위를 포함한 블록 목록입니다.
 * @remarks 관리 이미지의 공개·회원·스포일러 주소는 같은 첨부로 해석하되 실제 표시 URL은 응답값을 보존합니다.
 * 등록된 첨부 개수를 넘는 표식과 미등록 URL 표식은 일반 텍스트로 유지하며 다른 마크다운 문법은 해석하지 않습니다.
 */
export function splitCommunityBody(body: string, images: readonly CommunityBodyImage[]): CommunityBodyBlock[] {
  return blocks(body, images);
}

/**
 * 이미지 표식을 제외하고 화면에 표시하는 본문 텍스트의 Unicode 코드포인트 수를 계산합니다.
 * @param body - 이미지 표식을 포함한 본문입니다.
 * @param images - 첨부 목록입니다. 등록된 URL별 개수 안에서 최대 세 표식만 제외합니다.
 * @returns 미등록·초과 표식과 일반 문자를 포함한 표시 텍스트 길이입니다.
 * @remarks UTF-16 커서 오프셋과 달리 이모지 한 코드포인트를 한 글자로 계산합니다.
 */
export function communityBodyTextLength(body: string, images: readonly CommunityBodyImage[]): number {
  return blocks(body, images).reduce((length, block) => length + (block.type === 'text' ? [...block.text].length : 0), 0);
}
// #endregion

// #region 커서 위치의 이미지 삽입과 삭제
/**
 * 선택한 텍스트를 이미지로 바꾸고 이미지 바로 뒤에 입력할 커서를 반환합니다.
 * @param body - 편집 중인 본문입니다.
 * @param images - 기존 첨부 목록입니다.
 * @param selection - TextInput에서 받은 전체 본문 기준 UTF-16 선택 범위입니다.
 * @param image - 업로드를 마친 새 이미지입니다.
 * @returns 변경된 본문, 본문 순서의 첨부 목록, 새 이미지 뒤의 커서입니다.
 * @throws Error - 중복 이미지, 첨부 3개 초과, 잘못된 선택 범위, 표시 본문 10,000자 또는 전체 저장값 25,000자 초과 시 발생합니다.
 */
export function insertCommunityBodyImage(body: string, images: readonly CommunityBodyImage[],
  selection: CommunityBodySelection, image: CommunityBodyImage): CommunityBodyContent & { selection: CommunityBodySelection } {
  if (images.some(item => imageKey(item.url) === imageKey(image.url))) throw new Error('이미 첨부한 이미지입니다.');
  if (images.length >= 3) throw new Error('이미지는 3개까지 첨부할 수 있습니다.');
  const normalized = normalizeCommunityBody(body, images);
  const { start, end } = selection;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > normalized.length
      || blocks(normalized, images).some(block => block.type === 'image' && start < block.end && end > block.start)) {
    throw new Error('이미지를 넣을 본문 위치를 다시 선택해 주십시오.');
  }
  const marker = imageMarker(image);
  const next = normalized.slice(0, start) + marker + normalized.slice(end);
  if (communityBodyTextLength(next, [...images, image]) > 10000) throw new Error('본문은 10,000자 이내로 입력해 주십시오.');
  if ([...next].length > 25000) throw new Error('이미지 경로를 포함한 본문 저장 크기를 초과했습니다.');
  const position = start + marker.length;
  return { body: next, images: orderedImages(next, [...images, image]), selection: { start: position, end: position } };
}

/**
 * 접힌 커서에 인접한 이미지 한 개를 키보드 삭제로 제거하고 앞뒤 텍스트를 합칩니다.
 * @param body - 편집 중인 본문입니다.
 * @param images - 현재 첨부 목록입니다.
 * @param selection - TextInput에서 받은 전체 본문 기준 UTF-16 선택 범위입니다.
 * @param key - 커서 앞을 지우는 Backspace 또는 뒤를 지우는 Delete입니다.
 * @returns 이미지가 제거된 본문·나머지 첨부·새 커서이며, 네이티브 텍스트 입력이 처리할 삭제는 null입니다.
 * @remarks 같은 URL의 기존 첨부가 여러 개여도 커서에 인접한 표식 하나만 제거합니다.
 */
export function removeCommunityBodyImage(body: string, images: readonly CommunityBodyImage[], selection: CommunityBodySelection,
  key: 'Backspace' | 'Delete'): (CommunityBodyContent & { selection: CommunityBodySelection }) | null {
  if (selection.start !== selection.end) return null;
  const normalized = normalizeCommunityBody(body, images);
  const parts = blocks(normalized, images);
  const target = parts.find(block => block.type === 'image'
    && (key === 'Backspace' ? block.end === selection.start : block.start === selection.start));
  if (!target) return null;
  const next = normalized.slice(0, target.start) + normalized.slice(target.end);
  const remaining = parts.flatMap(block => block.type === 'image' && block !== target
    ? [{ url: block.image.url, width: block.image.width, height: block.image.height }] : []);
  return { body: next, images: remaining, selection: { start: target.start, end: target.start } };
}
// #endregion
