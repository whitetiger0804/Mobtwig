// #region 책장 모드 쪽 계산
/**
 * 책장 모드는 본문을 별도로 나누지 않고 ScrollView 위치를 쪽 단위로 옮깁니다.
 * 모든 길이는 화면 px이며 쪽 번호는 0부터 셉니다.
 */

/** 쪽 경계에 사용하는 허용 오차이며 기존 본문 끝 판정과 같습니다. */
const edge = 4;
/** 가로 스와이프로 인정하는 최소 이동 거리입니다. */
const swipeDistance = 48;
/** 탭으로 인정하는 최대 이동 거리입니다. */
const tapDistance = 10;
/** 탭으로 인정하는 최대 누름 시간이며 그 이상은 하이라이트 롱프레스에 맡깁니다. */
const tapDuration = 300;
/** 좌우 탭 영역이 차지하는 화면 폭의 비율입니다. */
const tapZone = 0.22;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** 소수 줄 높이가 누적되어 생기는 오차이며 이 범위까지는 줄이 쪽 안에 들어온 것으로 봅니다. */
const fit = 0.5;

/** 콘텐츠 기준 절대 y로 표시한 한 줄이며 머리글처럼 쪼개지 않는 블록도 한 줄로 넣습니다. */
export interface PageLine {
  /** 줄의 시작 y입니다. */
  top: number;
  /** 줄 높이입니다. */
  height: number;
  /** 문단 사이의 빈 줄이면 true이며 쪽 경계 판정에서 빼서 쪽이 빈 줄로 시작하지 않게 합니다. */
  blank?: boolean;
}

/**
 * 모든 쪽의 시작 위치를 줄 경계에 맞춰 계산합니다.
 * 각 쪽은 top+viewport 안에 완전히 들어오는 줄까지 보여 주고, 다음 쪽은 처음 잘리는 줄의 시작에서 시작합니다.
 * 한 줄(블록)이 뷰포트보다 크면 뷰포트만큼 전진하여 무한 반복하지 않습니다.
 * 빈 줄은 문단 사이 간격처럼 다루므로 쪽은 항상 내용이 있는 줄에서 시작합니다.
 * @param lines - 콘텐츠 기준 절대 y의 줄 목록이며 순서는 상관없습니다.
 * @param viewport - 본문 ScrollView 높이입니다.
 * @returns 첫 값이 0인 오름차순 쪽 시작 위치 목록입니다.
 */
export function buildPageTops(lines: readonly PageLine[], viewport: number): number[] {
  const tops = [0];
  if (!(viewport > 0)) return tops;
  const sorted = lines.filter(line => !line.blank && Number.isFinite(line.top) && Number.isFinite(line.height) && line.height > 0)
    .sort((a, b) => a.top - b.top);
  let current = 0;
  for (const line of sorted) {
    while (line.top + line.height > current + viewport + fit) {
      current = line.top > current + fit ? line.top : current + viewport;
      tops.push(current);
    }
  }
  return tops;
}

/**
 * 쪽의 시작 위치이며 범위를 벗어난 번호는 첫 쪽이나 마지막 쪽으로 맞춥니다.
 * @param index - 0부터 센 쪽 번호입니다.
 * @param tops - {@link buildPageTops}의 결과입니다.
 * @returns 스크롤할 y 위치입니다.
 */
export function pageTop(index: number, tops: readonly number[]): number {
  if (tops.length === 0) return 0;
  return tops[clamp(Math.floor(index), 0, tops.length - 1)];
}

/**
 * y 위치가 포함된 쪽이며 현재 쪽 계산과 문단 위치 스냅에 함께 사용합니다.
 * @param y - 스크롤 위치나 문단의 콘텐츠 기준 y이며 쪽 시작 4px 앞부터 그 쪽으로 봅니다.
 * @param tops - {@link buildPageTops}의 결과입니다.
 * @returns 0부터 센 쪽 번호입니다.
 */
export function pageOf(y: number, tops: readonly number[]): number {
  let index = 0;
  for (let next = 1; next < tops.length && tops[next] <= y + edge; next++) index = next;
  return index;
}

/** 쪽 넘김 결과이며 경계에 닿으면 쪽 번호를 유지하고 닿은 방향을 표시합니다. */
export interface PageTurn {
  /** 이동할 쪽 번호입니다. */
  index: number;
  /** 첫 쪽에서 이전, 마지막 쪽에서 다음을 요청했는지입니다. */
  edge: 'start' | 'end' | null;
}

/**
 * 한 쪽 이전이나 다음으로 넘깁니다.
 * @param index - 현재 쪽 번호입니다.
 * @param delta - 이전은 -1, 다음은 1입니다.
 * @param count - 전체 쪽 수입니다.
 * @returns 이동할 쪽과 경계 도달 여부입니다.
 */
export function turnPage(index: number, delta: -1 | 1, count: number): PageTurn {
  const current = clamp(index, 0, Math.max(0, count - 1));
  const next = current + delta;
  if (next < 0) return { index: current, edge: 'start' };
  if (next > count - 1) return { index: current, edge: 'end' };
  return { index: next, edge: null };
}

/** 화면 좌표의 한 점입니다. */
export interface TouchPoint {
  /** 가로 좌표입니다. */
  x: number;
  /** 세로 좌표입니다. */
  y: number;
}

/**
 * 본문 영역의 한 번의 터치를 쪽 넘김 방향으로 바꿉니다.
 * @param start - 터치를 시작한 본문 영역 기준 좌표입니다.
 * @param end - 터치를 끝낸 본문 영역 기준 좌표입니다.
 * @param width - 본문 영역의 폭입니다.
 * @param durationMs - 누른 시간이며 탭 판정에만 사용합니다.
 * @returns 이전 -1, 다음 1, 쪽 넘김이 아니면 null입니다.
 */
export function classifyPageTouch(start: TouchPoint, end: TouchPoint, width: number, durationMs: number): -1 | 1 | null {
  const dx = end.x - start.x, dy = end.y - start.y;
  if (Math.abs(dx) >= swipeDistance && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 1 : -1;
  if (Math.hypot(dx, dy) >= tapDistance || durationMs >= tapDuration || width <= 0) return null;
  if (start.x < width * tapZone) return -1;
  if (start.x > width * (1 - tapZone)) return 1;
  return null;
}
// #endregion
