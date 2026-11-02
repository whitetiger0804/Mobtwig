// #region 의존성 가져오기
import { Text, View, type ViewStyle } from 'react-native';
import { colors, s } from './ui';
// #endregion

// #region 빈 상태 속성
/** {@link EmptyState}에 표시할 제목과 설명입니다. 업무 데이터 구조를 포함하지 않습니다. */
export interface EmptyStateProps {
  /**
   * 빈 영역의 제목입니다.
   *
   * @defaultValue `'표시할 데이터가 없습니다.'`
   */
  title?: string;
  /**
   * 제목 아래에 표시하는 안내 문구입니다.
   *
   * @defaultValue `'데이터를 불러오면 이곳에 표시됩니다.'`
   */
  description?: string;
  /**
   * 표지·통계 등 좁은 영역에 제목만 작게 표시합니다.
   *
   * @defaultValue `false`
   */
  compact?: boolean;
  /**
   * 빈 영역의 배경에 맞춰 글자 대비를 선택합니다.
   *
   * @defaultValue `'light'`
   */
  tone?: 'light' | 'dark';
  /** 시안의 빈 영역에 맞춰 적용할 크기와 배치입니다. */
  style?: ViewStyle;
}
// #endregion

// #region 빈 상태 컴포넌트
/**
 * 데이터 영역을 채울 수 없을 때 안내 문구를 표시합니다.
 *
 * @remarks
 * 표시만 담당하며 요청 실패 감지, 데이터 조회, 재시도를 수행하지 않습니다.
 * 현재 미연동 화면은 이 요소를 직접 표시합니다. 좁은 카드에서는 `compact`로 설명을 숨깁니다.
 *
 * @param props - 빈 영역에 표시할 제목과 설명입니다.
 * @returns 제목과 설명을 포함한 빈 상태 요소입니다.
 *
 * @example
 * ```tsx
 * <EmptyState title="표시할 작품이 없습니다." />
 * ```
 */
export function EmptyState({
  title = '표시할 데이터가 없습니다.',
  description = '데이터를 불러오면 이곳에 표시됩니다.',
  compact = false,
  tone = 'light',
  style,
}: EmptyStateProps) {
  return (
    <View style={[s.empty, compact && { paddingVertical: 12, paddingHorizontal: 8, gap: 8 }, style]} accessibilityLiveRegion="polite">
      <Text style={[s.subtitle, { textAlign: 'center' }, compact && { fontSize: 12, lineHeight: 18, fontWeight: '400', color: colors.muted }, tone === 'dark' && { color: '#F3F6EC' }]}>{title}</Text>
      {!compact && <Text style={[s.muted, { textAlign: 'center' }, tone === 'dark' && { color: '#CDD8CE' }]}>{description}</Text>}
    </View>
  );
}
// #endregion
