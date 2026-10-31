// #region 의존성 가져오기
import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
// #endregion

// #region 공통 색상
/**
 * 화면 전체에서 공유하는 색상 정의입니다.
 *
 * @remarks
 * 텍스트, 배경, 경계선과 조작 상태에 사용하는 배색을 공통으로 지정합니다.
 */
export const colors = {
  /** 본문과 아이콘에 사용하는 짙은 기본 글자색입니다. */
  ink: '#233B2F',
  /** 주요 동작과 선택 상태에 사용하는 녹색입니다. */
  green: '#246D4F',
  /** 보조 설명에 사용하는 낮은 대비의 글자색입니다. */
  muted: '#91998C',
  /** 구분선과 테두리에 사용하는 색상입니다. */
  line: '#E3E8DC',
  /** 카드와 보조 동작의 밝은 배경색입니다. */
  pale: '#F3F6EC',
  /** 화면 바탕에 사용하는 크림색입니다. */
  cream: '#FAF9F3',
  /** 갈색 강조 요소에 사용하는 색상입니다. */
  brown: '#8A6546',
  /** 오류와 삭제 동작에 사용하는 붉은색입니다. */
  red: '#A53C37'
};
// #endregion

// #region 아이콘
/** 아이콘 이름에 대응하는 선형 SVG 경로를 보관합니다. */
const paths: Record<string, string> = {
  home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  search: 'm16 16 5 5M19 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  book: 'M12 5v16M3 4h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z',
  library: 'M3 4h4v17H3ZM10 4h4v17h-4ZM17 4l3-1 4 17-4 1Z',
  heart: 'M20 4a5 5 0 0 0-8 2 5 5 0 0 0-8-2c-5 5 1 11 8 16 7-5 13-11 8-16Z',
  user: 'M5 21v-3a7 7 0 0 1 14 0v3M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  bell: 'M5 17h14l-2-4V8a5 5 0 0 0-10 0v5ZM10 21h4',
  back: 'm15 4-8 8 8 8', next: 'm9 4 8 8-8 8', close: 'm5 5 14 14M19 5 5 19',
  clock: 'M12 7v6h5M22 12A10 10 0 1 1 12 2M16 2h6v6',
  gift: 'M3 8h18v4H3ZM5 12v9h14v-9M12 8v13M12 8C1 9 5-3 12 8Zm0 0c11 1 7-11 0 0Z',
  bookmark: 'M6 3h12v19l-6-4-6 4Z', settings: 'M4 5h16M4 12h16M4 19h16M8 2v6M16 9v6M10 16v6',
  share: 'M12 16V2m-5 5 5-5 5 5M5 11H3v11h18V11h-2',
  edit: 'm4 15-1 6 6-1L21 8l-5-5ZM13 6l5 5',
  check: 'm4 12 5 5L21 5', plus: 'M12 3v18M3 12h18',
  comment: 'M3 3h18v14H8l-5 5Z', trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  globe: 'M2 12h20M12 2c7 7 7 13 0 20-7-7-7-13 0-20ZM22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5Z', play: 'm7 3 14 9-14 9Z',
  mail: 'M3 5h18v14H3ZM3 5l9 7 9-7',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  eyeOff: 'M3 3l18 18M10 5a12 12 0 0 1 12 7 19 19 0 0 1-4 5M14 19C7 20 2 12 2 12a21 21 0 0 1 4-5',
  receipt: 'M6 2l3 2 3-2 3 2 3-2v20l-3-2-3 2-3-2-3 2ZM9 8h6M9 12h6M9 16h4',
  logout: 'M10 3H4v18h6M9 12h13m-5-5 5 5-5 5',
  refresh: 'M20 7a9 9 0 1 0 1 8M16 7h5V2',
  list: 'M7 5h14M7 12h14M7 19h14M3 5h.01M3 12h.01M3 19h.01',
  image: 'M3 3h18v18H3ZM3 16l6-6 5 5 3-3 4 4M17 7h.01',
  audio: 'M4 10v4h4l5 5V5l-5 5ZM17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14',
  pause: 'M7 4v16M17 4v16',
  warning: 'm12 2 10 19H2ZM12 8v5M12 17h.01',
  alert: 'm12 2 10 19H2ZM12 8v5M12 17h.01',
  send: 'm2 3 20 9-20 9 4-9Zm4 9h16',
  link: 'm10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  down: 'm5 9 7 7 7-7',
  gear: 'm9 3 1-2h4l1 2 2 1 2-.5 2 3.5-1.5 1.5v3L21 13l-2 3.5-2-.5-2 1-1 3h-4l-1-3-2-1-2 .5L3 13l1.5-1.5v-3L3 7l2-3.5L7 4ZM15.5 10a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0',
};

/**
 * 이름에 해당하는 선형 SVG 아이콘을 표시합니다.
 *
 * @remarks
 * `more`는 점 세 개로 표시하며, 등록되지 않은 이름은 책 아이콘으로 표시합니다.
 * 크기를 지정하지 않으면 22를 사용하고, 색상은 {@link colors}의 기본 글자색을 사용합니다.
 *
 * @param props - 아이콘 이름, 크기, 선 색상을 지정하는 속성입니다.
 * @returns 지정한 아이콘의 선과 도형을 포함하는 SVG 요소를 반환합니다.
 */
export function Icon({ name, size = 22, color = colors.ink }: {
  /** 표시할 아이콘 이름입니다. 등록되지 않은 이름은 책 아이콘으로 표시합니다. */
  name: string;
  /** 아이콘의 가로와 세로 크기입니다. 생략하면 22를 사용합니다. */
  size?: number;
  /** 아이콘의 선 색상입니다. 생략하면 공통 기본 글자색을 사용합니다. */
  color?: string
}) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    {name === 'more' ? <><Circle cx={5} cy={12} r={1}/><Circle cx={12} cy={12} r={1}/><Circle cx={19} cy={12} r={1}/></> : <Path d={paths[name] ?? paths.book}/>}
  </Svg>;
}
// #endregion

// #region 공통 버튼
/**
 * 레이블과 선택적인 아이콘을 가진 공통 동작 버튼을 표시합니다.
 *
 * @remarks
 * 색상 유형과 크기에 따라 버튼 스타일을 적용하며, 아이콘이 있으면 {@link Icon}을 표시합니다.
 * 비활성 상태를 접근성 정보와 버튼 동작에 함께 반영하고, 눌리거나 비활성화되면 투명도를 낮춥니다.
 *
 * @param props - 레이블, 클릭 콜백, 아이콘, 비활성 여부, 색상 유형, 크기를 지정하는 속성입니다.
 * @returns 아이콘과 레이블을 포함하는 접근성 버튼 요소를 반환합니다.
 *
 * @example
 * ```tsx
 * <Action label="저장" disabled />
 * ```
 */
export function Action({ label, onPress, icon, disabled = false, tone = 'primary', compact = false, style }: {
  /** 버튼에 표시하고 접근성 이름으로 사용하는 문자열입니다. */
  label: string;
  /** 버튼을 눌렀을 때 호출하는 함수입니다. */
  onPress?: () => void;
  /** 레이블 왼쪽에 표시할 아이콘 이름입니다. 생략하면 아이콘을 표시하지 않습니다. */
  icon?: string;
  /** 버튼의 비활성 여부입니다. 생략하면 false를 사용합니다. */
  disabled?: boolean;
  /** 버튼 배경과 글자색을 결정하는 유형입니다. 생략하면 primary를 사용합니다. */
  tone?: 'primary' | 'secondary' | 'quiet' | 'danger';
  /** 작은 높이와 여백을 적용할지 지정합니다. 생략하면 false를 사용합니다. */
  compact?: boolean;
  /** 시안에 맞춰 기본 버튼 다음에 적용할 크기와 배치입니다. */
  style?: ViewStyle;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.action, compact && s.compact, tone === 'primary' ? s.primary : tone === 'secondary' ? s.secondary : tone === 'danger' ? s.danger : s.quiet, style, (disabled || pressed) && { opacity: .55 }]}>
    {icon && <Icon name={icon} size={18} color={tone === 'primary' ? '#fff' : tone === 'danger' ? colors.red : colors.ink}/>}
    <Text style={[s.actionText, { color: tone === 'primary' ? '#fff' : tone === 'danger' ? colors.red : colors.ink }]}>{label}</Text>
  </Pressable>;
}

/**
 * 접근성 레이블을 가진 아이콘 버튼을 표시합니다.
 *
 * @remarks
 * 선택 상태에 따라 배경색과 {@link Icon}의 색상을 변경합니다.
 * 비활성화되면 누름 동작을 막고 투명도를 낮추며, 선택 상태는 호출하는 화면에서 관리합니다.
 *
 * @param props - 아이콘 이름과 크기, 접근성 레이블, 클릭 콜백, 상태와 버튼 스타일을 지정하는 속성입니다.
 * @returns 선택 및 비활성 상태를 반영한 아이콘 버튼 요소를 반환합니다.
 */
export function IconButton({ icon, label, onPress, selected = false, disabled = false, iconSize = 22, style }: {
  /** 버튼에 표시할 아이콘 이름입니다. */
  icon: string;
  /** 화면 읽기 도구에 전달할 버튼의 접근성 이름입니다. */
  label: string;
  /** 버튼을 눌렀을 때 호출하는 함수입니다. */
  onPress?: () => void;
  /** 선택 색상과 접근성 선택 상태를 적용할지 지정합니다. 생략하면 false를 사용합니다. */
  selected?: boolean;
  /** 버튼의 비활성 여부입니다. 생략하면 false를 사용합니다. */
  disabled?: boolean;
  /** 아이콘의 가로와 세로 크기입니다. 생략하면 22를 사용합니다. */
  iconSize?: number;
  /** 기본 버튼 다음에 적용할 크기와 배치입니다. */
  style?: ViewStyle;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={[s.iconButton, style, selected && { backgroundColor: '#E5EDDA' }, disabled && { opacity: .3 }]}><Icon name={icon} size={iconSize} color={selected ? colors.green : colors.ink}/></Pressable>;
}

/**
 * 선택 상태를 표시하는 둥근 텍스트 버튼을 표시합니다.
 *
 * @remarks
 * 선택 상태에 따라 배경, 테두리와 글자 스타일을 변경하며 {@link s}의 칩 스타일을 사용합니다.
 * 상태 변경은 전달받은 클릭 콜백에 맡기며, 비활성화되면 누름 동작을 막고 투명도를 낮춥니다.
 *
 * @param props - 레이블, 선택 상태, 클릭 콜백과 비활성 여부를 지정하는 속성입니다.
 * @returns 선택 및 비활성 상태를 반영한 텍스트 버튼 요소를 반환합니다.
 */
export function Chip({ label, selected, onPress, disabled = false }: {
  /** 칩에 표시할 텍스트입니다. */
  label: string;
  /** 선택 스타일과 접근성 선택 상태를 적용할지 지정합니다. 생략하면 선택되지 않은 상태로 표시합니다. */
  selected?: boolean;
  /** 칩을 눌렀을 때 호출하는 함수입니다. */
  onPress?: () => void;
  /** 칩의 비활성 여부입니다. 생략하면 false를 사용합니다. */
  disabled?: boolean
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected, disabled }} disabled={disabled} onPress={onPress} style={[s.chip, selected && s.chipSelected, disabled && { opacity: .45 }]}><Text style={[s.chipText, selected && { color: '#fff', fontWeight: '700' }]}>{label}</Text></Pressable>;
}
// #endregion

// #region 텍스트 입력
/**
 * 레이블, 텍스트 입력란과 선택적인 오류 메시지를 표시합니다.
 *
 * @remarks
 * 추가 입력 속성은 입력란에 전달하고, 접근성 이름에는 레이블을 사용합니다.
 * {@link s}의 공통 입력 스타일에 여러 줄 입력 스타일과 호출자가 전달한 스타일을 순서대로 적용합니다.
 * 오류 문자열이 있으면 접근성 알림으로 표시하며, 값 검증은 호출하는 화면에서 처리합니다.
 *
 * @param props - 레이블, 오류 문자열 및 입력란에 전달할 텍스트 입력 속성입니다.
 * @returns 레이블과 입력란, 필요하면 오류 알림을 포함하는 컨테이너를 반환합니다.
 */
export function Field({ label, error, ...props }: TextInputProps & {
  /** 입력란 위에 표시하고 접근성 이름으로 사용하는 문자열입니다. */
  label: string;
  /** 입력란 아래에 알림으로 표시할 오류 문자열입니다. 비어 있거나 생략되면 표시하지 않습니다. */
  error?: string
}) {
  return <View style={{ gap: 8 }}><Text style={s.label}>{label}</Text><TextInput {...props} accessibilityLabel={label} placeholderTextColor="#8B9387" style={[s.input, props.multiline && { minHeight: 132, textAlignVertical: 'top' }, props.style]}/>{!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}</View>;
}
// #endregion

// #region 제목과 카드
/**
 * 제목과 선택적인 부제목 및 오른쪽 동작 요소를 한 행에 표시합니다.
 *
 * @remarks
 * 제목 영역이 남는 가로 공간을 채우고, 호출자가 전달한 동작 요소를 오른쪽에 배치합니다.
 * 제목과 부제목에는 {@link s}의 공통 글자 스타일을 적용합니다.
 *
 * @param props - 제목 내용, 부제목과 오른쪽에 배치할 동작 요소를 지정하는 속성입니다.
 * @returns 제목 영역과 선택적인 동작 요소를 포함하는 행 컨테이너를 반환합니다.
 */
export function Title({ children, subtitle, action }: {
  /** 제목 텍스트 요소에 배치할 내용입니다. */
  children: ReactNode;
  /** 제목 아래에 표시할 부제목입니다. 비어 있거나 생략되면 표시하지 않습니다. */
  subtitle?: string;
  /** 제목 영역 오른쪽에 배치할 동작 요소입니다. */
  action?: ReactNode
}) {
  return <View style={s.titleRow}><View style={{ flex: 1, gap: 4 }}><Text style={s.title}>{children}</Text>{!!subtitle && <Text style={s.muted}>{subtitle}</Text>}</View>{action}</View>;
}

/**
 * 공통 배경과 내부 여백을 가진 카드 컨테이너를 표시합니다.
 *
 * @remarks
 * {@link s}의 카드 스타일 다음에 호출자가 전달한 스타일을 적용합니다.
 * 자식 요소를 그대로 배치하며, 누름 동작은 제공하지 않습니다.
 *
 * @param props - 카드에 배치할 자식 요소와 추가 스타일을 지정하는 속성입니다.
 * @returns 자식 요소를 포함하는 카드 컨테이너를 반환합니다.
 */
export function Card({ children, style }: {
  /** 카드 내부에 배치할 자식 요소입니다. */
  children: ReactNode;
  /** 공통 카드 스타일 다음에 적용할 추가 스타일입니다. */
  style?: ViewStyle
}) { return <View style={[s.card, style]}>{children}</View>; }
// #endregion

// #region 공통 스타일
/**
 * 화면 전체에서 공유하는 배치와 구성 요소의 스타일 정의입니다.
 *
 * @remarks
 * 공통 구성 요소와 각 화면에 같은 여백, 글자 스타일과 배색을 적용할 때 사용합니다.
 * 색상은 {@link colors}를 참조하며, 각 화면에서 필요한 스타일을 조합해 사용합니다.
 */
export const s = StyleSheet.create({
  // #region 기본 배치
  /** 스크롤 화면의 기본 내부 여백과 구역 간격을 지정합니다. */
  page: {
    /** 화면 내용과 네 방향 가장자리 사이의 기본 여백을 지정합니다. */
    padding: 20,
    /** 화면의 바로 아래 자식 구역 사이의 간격을 지정합니다. */
    gap: 24,
    /** 마지막 구역 아래의 여백을 기본 여백보다 넓게 지정합니다. */
    paddingBottom: 32
  },
  /** 자식 요소를 세로 중앙에 맞춰 가로로 배치합니다. */
  row: {
    /** 자식 요소를 가로 방향으로 배치합니다. */
    flexDirection: 'row',
    /** 가로로 배치한 자식 요소를 세로 중앙에 정렬합니다. */
    alignItems: 'center',
    /** 가로로 배치한 자식 요소 사이의 간격을 지정합니다. */
    gap: 10
  },
  /** 공간이 부족하면 다음 줄로 넘기는 가로 배치를 지정합니다. */
  wrap: {
    /** 자식 요소를 가로 방향으로 배치합니다. */
    flexDirection: 'row',
    /** 가로 공간이 부족하면 자식 요소를 다음 줄로 넘깁니다. */
    flexWrap: 'wrap',
    /** 자식 요소의 가로 간격과 줄 사이 간격을 지정합니다. */
    gap: 8
  },
  /** 부모 배치에서 남는 공간을 채우도록 지정합니다. */
  grow: {
    /** 부모의 주축에서 사용 가능한 남은 공간을 차지하도록 지정합니다. */
    flex: 1
  },
  // #endregion
  // #region 글자와 제목
  /** 화면이나 구역의 큰 제목에 사용하는 글자 스타일입니다. */
  title: {
    /** 큰 제목의 글자 크기를 지정합니다. */
    fontSize: 20,
    /** 큰 제목의 각 줄 높이를 지정합니다. */
    lineHeight: 29,
    /** 큰 제목을 굵은 글자로 표시합니다. */
    fontWeight: '700',
    /** 큰 제목에 공통 기본 글자색을 적용합니다. */
    color: colors.ink
  },
  /** 소제목에 사용하는 글자 스타일입니다. */
  subtitle: {
    /** 소제목의 글자 크기를 지정합니다. */
    fontSize: 16,
    /** 소제목의 각 줄 높이를 지정합니다. */
    lineHeight: 23,
    /** 소제목을 굵은 글자로 표시합니다. */
    fontWeight: '700',
    /** 소제목에 공통 기본 글자색을 적용합니다. */
    color: colors.ink
  },
  /** 본문에 사용하는 기본 글자 스타일입니다. */
  text: {
    /** 본문의 글자 크기를 지정합니다. */
    fontSize: 14,
    /** 본문의 각 줄 높이를 지정합니다. */
    lineHeight: 23,
    /** 본문에 공통 기본 글자색을 적용합니다. */
    color: colors.ink
  },
  /** 보조 설명에 사용하는 작은 글자 스타일입니다. */
  muted: {
    /** 보조 설명의 작은 글자 크기를 지정합니다. */
    fontSize: 12,
    /** 보조 설명의 각 줄 높이를 지정합니다. */
    lineHeight: 19,
    /** 보조 설명에 공통 보조 글자색을 적용합니다. */
    color: colors.muted
  },
  /** 입력란 등의 레이블에 사용하는 글자 스타일입니다. */
  label: {
    /** 레이블의 글자 크기를 지정합니다. */
    fontSize: 13,
    /** 레이블에 공통 기본 글자색을 적용합니다. */
    color: colors.ink,
    /** 레이블에 중간보다 굵은 글자 두께를 적용합니다. */
    fontWeight: '600'
  },
  /** 제목 영역과 동작 요소를 한 행에 배치합니다. */
  titleRow: {
    /** 제목 영역과 동작 요소를 가로로 배치합니다. */
    flexDirection: 'row',
    /** 제목 영역과 동작 요소를 세로 중앙에 정렬합니다. */
    alignItems: 'center',
    /** 제목 영역과 오른쪽 동작 요소 사이의 간격을 지정합니다. */
    gap: 10
  },
  // #endregion
  // #region 카드와 구분선
  /** 카드의 밝은 배경과 내부 간격을 지정합니다. */
  card: {
    /** 카드에 공통 밝은 배경색을 적용합니다. */
    backgroundColor: colors.pale,
    /** 카드 배경의 모서리를 둥글게 표시합니다. */
    borderRadius: 14,
    /** 카드 테두리와 내부 내용 사이의 여백을 지정합니다. */
    padding: 16,
    /** 카드의 바로 아래 자식 요소 사이의 간격을 지정합니다. */
    gap: 12
  },
  /** 가로 구분선의 두께와 색상을 지정합니다. */
  line: {
    /** 가로 구분선의 세로 두께를 지정합니다. */
    height: 1,
    /** 가로 구분선에 공통 경계선 색상을 적용합니다. */
    backgroundColor: colors.line
  },
  // #endregion
  // #region 버튼
  /** 공통 동작 버튼의 크기와 내용 배치를 지정합니다. */
  action: {
    /** 일반 동작 버튼의 최소 높이를 지정합니다. */
    minHeight: 44,
    /** 버튼 내용의 좌우 여백을 지정합니다. */
    paddingHorizontal: 18,
    /** 버튼 내용의 위아래 여백을 지정합니다. */
    paddingVertical: 12,
    /** 동작 버튼 배경의 모서리를 둥글게 표시합니다. */
    borderRadius: 26,
    /** 가로로 배치한 아이콘과 레이블을 세로 중앙에 정렬합니다. */
    alignItems: 'center',
    /** 아이콘과 레이블 묶음을 버튼의 가로 중앙에 정렬합니다. */
    justifyContent: 'center',
    /** 버튼 아이콘과 레이블을 가로로 배치합니다. */
    flexDirection: 'row',
    /** 버튼 아이콘과 레이블 사이의 간격을 지정합니다. */
    gap: 8
  },
  /** 작은 동작 버튼의 높이와 내부 여백을 지정합니다. */
  compact: {
    /** 작은 동작 버튼의 최소 높이를 지정합니다. */
    minHeight: 36,
    /** 작은 동작 버튼의 위아래 여백을 지정합니다. */
    paddingVertical: 8,
    /** 작은 동작 버튼의 좌우 여백을 지정합니다. */
    paddingHorizontal: 12
  },
  /** 동작 버튼 레이블의 글자 스타일입니다. */
  actionText: {
    /** 동작 버튼 레이블의 글자 크기를 지정합니다. */
    fontSize: 14,
    /** 동작 버튼 레이블에 중간보다 굵은 글자 두께를 적용합니다. */
    fontWeight: '600'
  },
  /** 주요 동작 버튼의 배경색을 지정합니다. */
  primary: {
    /** 주요 동작 버튼에 공통 녹색 배경을 적용합니다. */
    backgroundColor: colors.green
  },
  /** 보조 동작 버튼의 배경과 테두리를 지정합니다. */
  secondary: {
    /** 보조 동작 버튼에 공통 밝은 배경색을 적용합니다. */
    backgroundColor: colors.pale,
    /** 보조 동작 버튼 테두리의 두께를 지정합니다. */
    borderWidth: 1,
    /** 보조 동작 버튼에 공통 경계선 색상의 테두리를 적용합니다. */
    borderColor: colors.line
  },
  /** 배경을 드러내지 않는 동작 버튼 스타일입니다. */
  quiet: {
    /** 버튼 배경을 투명하게 지정합니다. */
    backgroundColor: 'transparent'
  },
  /** 삭제 등 주의가 필요한 동작 버튼의 배경색을 지정합니다. */
  danger: {
    /** 주의가 필요한 동작 버튼에 연한 붉은 배경을 적용합니다. */
    backgroundColor: '#FAEFEC'
  },
  /** 아이콘 버튼의 정사각형 크기와 중앙 정렬을 지정합니다. */
  iconButton: {
    /** 아이콘 버튼의 가로 크기를 지정합니다. */
    width: 44,
    /** 아이콘 버튼의 세로 크기를 지정합니다. */
    height: 44,
    /** 아이콘 버튼 배경을 원형으로 표시합니다. */
    borderRadius: 22,
    /** 아이콘을 버튼의 세로 중앙에 정렬합니다. */
    justifyContent: 'center',
    /** 아이콘을 버튼의 가로 중앙에 정렬합니다. */
    alignItems: 'center'
  },
  // #endregion
  // #region 선택 칩
  /** 선택용 칩 버튼의 모양과 기본 배경을 지정합니다. */
  chip: {
    /** 칩의 모서리를 둥글게 표시합니다. */
    borderRadius: 20,
    /** 칩 텍스트의 좌우 여백을 지정합니다. */
    paddingHorizontal: 15,
    /** 칩 텍스트의 위아래 여백을 지정합니다. */
    paddingVertical: 9,
    /** 선택되지 않은 칩의 밝은 배경색을 지정합니다. */
    backgroundColor: '#F2F6ED',
    /** 칩 테두리의 두께를 지정합니다. */
    borderWidth: 1,
    /** 선택되지 않은 칩의 테두리 색상을 지정합니다. */
    borderColor: '#F2F6ED'
  },
  /** 선택된 칩에 적용할 배경과 테두리를 지정합니다. */
  chipSelected: {
    /** 선택된 칩에 시안의 짙은 녹색 배경을 적용합니다. */
    backgroundColor: colors.green,
    /** 선택된 칩의 테두리를 녹색 계열로 표시합니다. */
    borderColor: colors.green
  },
  /** 칩 레이블의 기본 글자 스타일입니다. */
  chipText: {
    /** 칩 레이블의 글자 크기를 지정합니다. */
    fontSize: 12,
    /** 선택되지 않은 칩 레이블의 글자색을 지정합니다. */
    color: '#626C5C'
  },
  // #endregion
  // #region 입력란과 오류
  /** 텍스트 입력란의 크기, 테두리와 글자 스타일입니다. */
  input: {
    /** 텍스트 입력란의 기본 최소 높이를 지정합니다. */
    minHeight: 48,
    /** 입력 텍스트의 좌우 여백을 지정합니다. */
    paddingHorizontal: 14,
    /** 입력 텍스트의 위아래 여백을 지정합니다. */
    paddingVertical: 12,
    /** 입력란 테두리의 모서리를 둥글게 표시합니다. */
    borderRadius: 16,
    /** 입력란 테두리의 두께를 지정합니다. */
    borderWidth: 1,
    /** 입력란 테두리의 색상을 지정합니다. */
    borderColor: '#DDE3D7',
    /** 입력 텍스트의 글자 크기를 지정합니다. */
    fontSize: 14,
    /** 입력 텍스트에 공통 기본 글자색을 적용합니다. */
    color: colors.ink,
    /** 입력란 내부를 흰색으로 표시합니다. */
    backgroundColor: '#fff'
  },
  /** 입력 오류 등 오류 메시지의 글자 스타일입니다. */
  error: {
    /** 오류 메시지에 공통 붉은색을 적용합니다. */
    color: colors.red,
    /** 오류 메시지의 글자 크기를 지정합니다. */
    fontSize: 13,
    /** 오류 메시지의 각 줄 높이를 지정합니다. */
    lineHeight: 20
  },
  // #endregion
  // #region 빈 상태
  /** 빈 상태 안내의 정렬과 여백을 지정합니다. */
  empty: {
    /** 빈 상태 안내의 자식 요소를 가로 중앙에 정렬합니다. */
    alignItems: 'center',
    /** 빈 상태 안내의 자식 요소 사이 간격을 지정합니다. */
    gap: 12,
    /** 빈 상태 안내의 위아래 여백을 지정합니다. */
    paddingVertical: 40,
    /** 빈 상태 안내의 좌우 여백을 지정합니다. */
    paddingHorizontal: 15
  },
  // #endregion
  // #region 탭
  /** 탭의 내부 여백과 기본 하단 테두리를 지정합니다. */
  tab: {
    /** 탭 내용의 위아래 여백을 지정합니다. */
    paddingVertical: 14,
    /** 탭 내용의 좌우 여백을 지정합니다. */
    paddingHorizontal: 8,
    /** 탭 하단의 선택 표시 영역 두께를 지정합니다. */
    borderBottomWidth: 2,
    /** 선택되지 않은 탭의 하단 테두리를 투명하게 표시합니다. */
    borderBottomColor: 'transparent'
  },
  /** 선택된 탭의 하단 표시 색상을 지정합니다. */
  tabActive: {
    /** 선택된 탭의 하단 테두리에 공통 녹색을 적용합니다. */
    borderBottomColor: colors.green
  },
  /** 선택되지 않은 탭 레이블의 글자 스타일입니다. */
  tabLabel: {
    /** 선택되지 않은 탭 레이블에 공통 보조 글자색을 적용합니다. */
    color: colors.muted,
    /** 탭 레이블의 기본 글자 크기를 지정합니다. */
    fontSize: 14
  },
  /** 선택된 탭 레이블의 강조 스타일입니다. */
  tabLabelActive: {
    /** 선택된 탭 레이블에 공통 녹색을 적용합니다. */
    color: colors.green,
    /** 선택된 탭 레이블을 굵은 글자로 표시합니다. */
    fontWeight: '700'
  },
  // #endregion
});
// #endregion
