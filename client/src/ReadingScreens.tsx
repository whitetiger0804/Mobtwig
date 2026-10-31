// #region 의존성 가져오기
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from './appState';
import { EmptyState } from './EmptyState';
import { Action, colors, Icon, IconButton, s } from './ui';
// #endregion

// #region 독서 화면
/**
 * 본문 독서 도구 또는 앱북의 미디어 배치를 표시합니다.
 *
 * @remarks
 * 본문 화면은 상단 목차·기록·설정, 이전 회차 요약과 하단 회차 이동 도구를 유지합니다.
 * 실제 작품 제목·본문·진행률은 만들지 않으며 본문과 요약은 {@link EmptyState}입니다.
 * 요약 열기는 화면 내부 상태이고 회차 이동과 이어보기는 비활성화합니다.
 *
 * @returns 현재 독서 종류에 맞는 본문 또는 미디어 화면입니다.
 */
export function ReadingScreen() {
  const app = useApp();
  const [summaryOpen, setSummaryOpen] = useState(false);
  if (app.baseRoute.screen === 'media') return <MediaScreen />;

  return (
    <View style={styles.reader}>
      <View style={styles.readerHeader}>
        <View style={styles.roundTool}><IconButton icon="back" label="읽기 화면에서 돌아가기" onPress={app.back} /></View>
        <Text style={[s.subtitle, styles.readerTitle]}>독서</Text>
        <View style={styles.roundTool}><IconButton icon="list" label="목차" onPress={() => app.navigate({ screen: 'detail', kind: 'novel' })} /></View>
        <View style={styles.roundTool}><IconButton icon="bookmark" label="밑줄과 책갈피" onPress={() => app.navigate({ screen: 'records' })} /></View>
        <Pressable accessibilityRole="button" accessibilityLabel="읽기 설정" onPress={() => app.navigate({ screen: 'readingSettings' })} style={styles.roundTool}><Text style={[s.text, styles.typeTool]}>가</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.readerBody} showsVerticalScrollIndicator={false}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: summaryOpen }} onPress={() => setSummaryOpen(!summaryOpen)} style={styles.summaryButton}>
          <Icon name="refresh" size={16} color={colors.brown} /><Text style={[s.text, styles.summaryLabel]}>이전 회차 요약</Text><View style={summaryOpen && styles.turnUp}><Icon name="down" size={14} color={colors.brown} /></View>
        </Pressable>
        {summaryOpen && <View style={styles.summary}><EmptyState compact title="표시할 요약이 없습니다." /></View>}
        <View style={styles.manuscript}><EmptyState title="표시할 본문이 없습니다." /></View>
      </ScrollView>
      <View style={styles.readerFooter}>
        <View style={styles.progressTrack} />
        <View style={styles.readerActions}>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={styles.footerAction}><Icon name="back" size={14} color={colors.muted} /><Text style={[s.text, styles.footerLabel, styles.disabledText]}>이전화</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={styles.footerAction}><Text style={[s.text, styles.footerLabel, styles.continueLabel]}>이어보기</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => app.navigate({ screen: 'world' })} style={styles.footerAction}><Text style={[s.text, styles.footerLabel]}>세계관</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => app.navigate({ screen: 'reviews' })} style={styles.footerAction}><Text style={[s.text, styles.footerLabel]}>댓글</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={styles.footerAction}><Text style={[s.text, styles.footerLabel, styles.disabledText]}>다음화</Text><Icon name="next" size={14} color={colors.muted} /></Pressable>
        </View>
      </View>
    </View>
  );
}

/**
 * 앱북 시안의 이미지·설명·영상·오디오·상호작용 영역을 배치합니다.
 *
 * @remarks
 * 미디어 내용은 각 영역의 {@link EmptyState}로 유지하고 재생·확대·드래그를 비활성화합니다.
 * 목차와 본문 이동은 화면 이동만 수행하며 미디어 조회나 재생 상태를 만들지 않습니다.
 *
 * @returns 자체 헤더와 하단 이동 도구를 포함한 앱북 화면입니다.
 */
function MediaScreen() {
  const app = useApp();
  return (
    <View style={styles.media}>
      <View style={styles.mediaHeader}><IconButton icon="back" label="앱북에서 돌아가기" onPress={app.back} /><Text style={[s.subtitle, styles.mediaTitle]}>앱북</Text><IconButton icon="more" label="읽기 설정" onPress={() => app.navigate({ screen: 'readingSettings' })} /></View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.mediaBody}>
        <Text style={[s.text, styles.mediaEyebrow]}>앱북 · 관찰하기</Text>
        <EmptyState compact title="표시할 제목이 없습니다." style={styles.mediaHeading} />
        <View style={styles.imageFrame}>
          <EmptyState title="표시할 이미지가 없습니다." />
          <Pressable accessibilityRole="button" accessibilityLabel="이미지 확대" accessibilityState={{ disabled: true }} disabled style={styles.expandImage}><Icon name="image" color="#FFFFFF" size={16} /><Text style={[s.text, styles.expandLabel]}>확대</Text></Pressable>
        </View>
        <EmptyState compact title="표시할 설명이 없습니다." style={styles.caption} />
        <View style={styles.videoCard}>
          <View style={styles.videoThumbnail}><EmptyState compact title="—" style={styles.thumbnailEmpty} /></View>
          <View style={styles.mediaCardContent}><EmptyState compact title="표시할 영상이 없습니다." style={styles.mediaInlineEmpty} /><Text style={[s.muted, styles.videoLabel]}>영상</Text></View>
          <IconButton icon="play" label="영상 재생" disabled />
        </View>
        <View style={styles.audioRow}>
          <View style={styles.audioIcon}><Icon name="audio" color="#405E72" size={18} /></View>
          <View style={styles.mediaCardContent}><Text style={[s.text, styles.mediaLabel]}>오디오</Text><EmptyState compact title="표시할 오디오가 없습니다." style={styles.mediaInlineEmpty} /><View style={styles.audioTrack} /></View>
          <IconButton icon="pause" label="오디오 일시 정지" disabled />
        </View>
        <View style={styles.interactiveCard}><View style={styles.interactiveVisual}><EmptyState compact title="—" /></View><View style={styles.mediaCardContent}><EmptyState compact title="표시할 정보가 없습니다." style={styles.interactiveEmpty} /><Text style={[s.text, styles.interactiveHint]}>드래그하여 둘러보기</Text></View></View>
      </ScrollView>
      <View style={styles.mediaFooter}>
        <Pressable accessibilityRole="button" onPress={() => app.navigate({ screen: 'detail', kind: 'magazine' })} style={styles.mediaFooterAction}><Icon name="list" size={19} /><Text style={[s.text, styles.mediaFooterLabel]}>목차</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => app.navigate({ screen: 'reader' })} style={styles.mediaFooterAction}><Text style={[s.text, styles.mediaFooterLabel]}>본문으로</Text><Icon name="next" size={17} /></Pressable>
      </View>
    </View>
  );
}

/**
 * 이미지 확대 시안의 어두운 바탕과 닫기 도구를 표시합니다.
 *
 * @remarks
 * 이미지·제목·설명은 어두운 배경용 {@link EmptyState}이며 확대나 이미지 조회를 수행하지 않습니다.
 * 닫기는 이전 화면으로 이동합니다.
 *
 * @returns 이미지가 없는 확대 화면의 구조입니다.
 */
export function ImageFullScreen() {
  const app = useApp();
  return (
    <View style={styles.imageFull}>
      <View style={styles.imageFullHeader}><Text style={[s.text, styles.imageFullTitle]}>이미지</Text><Pressable accessibilityRole="button" accessibilityLabel="이미지 닫기" onPress={app.back} style={styles.imageClose}><Icon name="close" size={22} color="#FFFFFF" /></Pressable></View>
      <View style={styles.fullImageArea}><EmptyState title="표시할 이미지가 없습니다." tone="dark" /></View>
      <EmptyState compact title="표시할 이미지 정보가 없습니다." tone="dark" style={styles.fullCaption} />
    </View>
  );
}
// #endregion

// #region 세계관 화면
/**
 * 세계관 화면의 제목과 요약·용어 전환을 표시합니다.
 *
 * @param props - 현재 선택한 세계관 화면입니다.
 * @returns 뒤로 가기와 두 화면 전환을 포함한 헤더입니다.
 */
function WorldHeader({ terms = false }: {
  /** 용어 화면 선택 여부입니다. 생략하면 요약 화면이 선택됩니다. */
  terms?: boolean;
}) {
  const app = useApp();
  return (
    <View style={styles.worldHeader}>
      <IconButton icon="back" label="세계관에서 돌아가기" onPress={app.back} />
      <Text style={[s.subtitle, styles.worldTitle]}>세계관</Text>
      <View style={styles.worldTabs}>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: !terms }} onPress={() => app.navigate({ screen: 'world' })} style={[styles.worldTab, !terms && styles.worldTabSelected]}><Text style={[s.text, styles.worldTabLabel, !terms && styles.worldSelectedText]}>요약</Text></Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: terms }} onPress={() => app.navigate({ screen: 'worldTerms' })} style={[styles.worldTab, terms && styles.worldTabSelected]}><Text style={[s.text, styles.worldTabLabel, terms && styles.worldSelectedText]}>용어</Text></Pressable>
      </View>
    </View>
  );
}

/**
 * 관계도 시안의 작품 정보 영역, 분류 범례와 관계도 공간을 표시합니다.
 *
 * @remarks
 * 표지·작품·읽은 범위·관계도 내용은 생성하지 않습니다. 작품과 관계도에는
 * {@link EmptyState}를 배치하며 범례만 정적 화면 요소로 유지합니다.
 *
 * @returns 요약 탭이 선택된 세계관 화면입니다.
 */
export function WorldScreen() {
  const app = useApp();
  return (
    <View style={styles.world}>
      <WorldHeader />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.worldBody}>
        <View style={styles.workIdentity}><View style={styles.workCover}><EmptyState compact title="—" style={styles.thumbnailEmpty} /></View><EmptyState compact title="작품 정보가 없습니다." style={styles.workIdentityEmpty} /><View style={styles.readScope}><Icon name="lock" size={12} color={colors.muted} /><Text style={[s.muted, styles.scopeLabel]}>읽은 범위</Text></View></View>
        <Text style={[s.subtitle, styles.relationTitle]}>전체 관계도</Text>
        <View style={styles.legend}>{([['인물', '#45714A'], ['사물', '#9A784F'], ['장소', '#8B9054'], ['고유 설정', '#668995']] as const).map(([label, color]) => <View key={label} style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: color }]} /><Text style={[s.muted, styles.legendLabel]}>{label}</Text></View>)}</View>
        <View style={styles.relationMap}><EmptyState title="표시할 관계가 없습니다." /></View>
      </ScrollView>
      <View style={styles.worldFooter}><Action label="본문으로 돌아가기" onPress={() => app.navigate({ screen: 'reader' })} style={styles.returnButton} /></View>
    </View>
  );
}

/**
 * 세계관 시안의 용어 탭과 고유 용어 목록 공간을 표시합니다.
 *
 * @remarks
 * 작품 제목·용어 개수·이름·정의·연결을 만들지 않고 {@link EmptyState}를 표시합니다.
 * 요약 탭과 본문으로 돌아가는 화면 이동만 제공합니다.
 *
 * @returns 용어 탭이 선택된 세계관 화면입니다.
 */
export function WorldTermsScreen() {
  const app = useApp();
  return (
    <View style={styles.world}>
      <WorldHeader terms />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.termsBody}>
        <EmptyState compact title="작품 정보가 없습니다." style={styles.termsWork} />
        <Text style={[s.subtitle, styles.termsTitle]}>고유 용어</Text>
        <View style={styles.termList}><EmptyState title="표시할 고유 용어가 없습니다." /></View>
      </ScrollView>
      <View style={styles.worldFooter}><Action label="본문으로 돌아가기" onPress={() => app.navigate({ screen: 'reader' })} style={styles.returnButton} /></View>
    </View>
  );
}
// #endregion

// #region 독서 화면 스타일
/** 독서·미디어·세계관 시안의 헤더, 빈 본문 공간과 하단 도구 배치를 정의합니다. */
const styles = StyleSheet.create({
  reader: { flex: 1, backgroundColor: '#F7F8F2' },
  readerHeader: { height: 72, paddingHorizontal: 16, gap: 8, flexDirection: 'row', alignItems: 'center' },
  roundTool: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  readerTitle: { flex: 1, marginLeft: 5, fontSize: 15 },
  typeTool: { fontSize: 21 },
  readerBody: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 10 },
  summaryButton: { alignSelf: 'flex-start', minHeight: 32, borderRadius: 16, paddingHorizontal: 12, gap: 8, backgroundColor: '#EEE3D3', flexDirection: 'row', alignItems: 'center' },
  summaryLabel: { color: colors.brown, fontSize: 12, fontWeight: '600' },
  turnUp: { transform: [{ rotate: '180deg' }] },
  summary: { marginTop: 12, backgroundColor: '#EEE3D3', borderRadius: 12 },
  manuscript: { flex: 1, minHeight: 340, justifyContent: 'center' },
  readerFooter: { minHeight: 110, backgroundColor: '#FFFFFF', paddingTop: 17, borderTopWidth: 1, borderColor: '#E3E8DC' },
  progressTrack: { marginHorizontal: 28, height: 4, borderRadius: 2, backgroundColor: '#E3E8DC' },
  readerActions: { flexDirection: 'row', paddingHorizontal: 20, marginTop: 17, minHeight: 48 },
  footerAction: { flex: 1, minHeight: 44, gap: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  footerLabel: { fontSize: 12, fontWeight: '600' },
  disabledText: { color: colors.muted },
  continueLabel: { color: colors.green, opacity: 0.55 },
  media: { flex: 1, backgroundColor: '#FFFFFF' },
  mediaHeader: { height: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: 1, borderColor: '#E3E8DC' },
  mediaTitle: { flex: 1, textAlign: 'center', fontSize: 16 },
  mediaBody: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 12 },
  mediaEyebrow: { fontSize: 12, color: '#6B7D65' },
  mediaHeading: { minHeight: 54, padding: 0, flexDirection: 'row', justifyContent: 'flex-start', gap: 8 },
  imageFrame: { height: 207, borderRadius: 20, backgroundColor: '#F2F6ED', justifyContent: 'center', overflow: 'hidden' },
  expandImage: { position: 'absolute', right: 12, bottom: 12, minHeight: 28, borderRadius: 14, paddingHorizontal: 10, backgroundColor: '#52634E', flexDirection: 'row', alignItems: 'center', gap: 5, opacity: 0.55 },
  expandLabel: { color: '#FFFFFF', fontSize: 10 },
  caption: { minHeight: 68, paddingVertical: 10, flexDirection: 'row', justifyContent: 'flex-start' },
  videoCard: { minHeight: 80, borderRadius: 20, backgroundColor: '#F2F6ED', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 15 },
  videoThumbnail: { width: 78, height: 56, borderRadius: 12, borderWidth: 1, borderColor: '#E3E8DC', justifyContent: 'center' },
  thumbnailEmpty: { padding: 0, gap: 2 },
  videoLabel: { fontSize: 11 },
  mediaCardContent: { flex: 1, minWidth: 0 },
  mediaLabel: { fontSize: 13, fontWeight: '700' },
  mediaInlineEmpty: { minHeight: 28, padding: 0, flexDirection: 'row', justifyContent: 'flex-start', gap: 6 },
  audioRow: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8 },
  audioIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#DCE7EC', alignItems: 'center', justifyContent: 'center' },
  audioTrack: { height: 3, borderRadius: 2, backgroundColor: '#D8E2D0', marginTop: 10 },
  interactiveCard: { minHeight: 109, borderRadius: 16, backgroundColor: '#E6EEF1', flexDirection: 'row', alignItems: 'center', padding: 12, gap: 16 },
  interactiveVisual: { width: 146, height: 85, justifyContent: 'center' },
  interactiveEmpty: { minHeight: 42, padding: 0, alignItems: 'flex-start', gap: 3 },
  interactiveHint: { color: '#405E72', fontSize: 11 },
  mediaFooter: { height: 60, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderColor: '#E3E8DC' },
  mediaFooterAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9 },
  mediaFooterLabel: { fontSize: 12, fontWeight: '600' },
  imageFull: { flex: 1, backgroundColor: '#20372D' },
  imageFullHeader: { minHeight: 76, paddingHorizontal: 24, paddingTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  imageFullTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  imageClose: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#365044', alignItems: 'center', justifyContent: 'center' },
  fullImageArea: { height: 262, marginTop: 98, justifyContent: 'center' },
  fullCaption: { paddingHorizontal: 24, alignItems: 'flex-start', minHeight: 100, marginTop: 36 },
  world: { flex: 1, backgroundColor: '#FFFFFF' },
  worldHeader: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingRight: 20 },
  worldTitle: { flex: 1, fontSize: 20, marginLeft: 13 },
  worldTabs: { width: 129, height: 38, padding: 4, borderRadius: 20, backgroundColor: '#F2F6ED', flexDirection: 'row' },
  worldTab: { flex: 1, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  worldTabSelected: { backgroundColor: '#FFFFFF' },
  worldTabLabel: { fontSize: 12, color: '#625D50' },
  worldSelectedText: { color: colors.green, fontWeight: '700' },
  worldBody: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 18 },
  workIdentity: { minHeight: 110, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: '#E3E8DC', paddingHorizontal: 4, gap: 16 },
  workCover: { width: 44, height: 66, borderRadius: 5, backgroundColor: '#F2F6ED', justifyContent: 'center' },
  workIdentityEmpty: { flex: 1, minHeight: 72, padding: 0, alignItems: 'flex-start', gap: 6 },
  readScope: { alignSelf: 'flex-start', marginTop: 32, minHeight: 26, borderRadius: 13, backgroundColor: '#F2F6ED', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4 },
  scopeLabel: { fontSize: 10 },
  relationTitle: { marginTop: 25, marginHorizontal: 4, fontSize: 18 },
  legend: { flexDirection: 'row', gap: 15, marginHorizontal: 4, marginTop: 12, marginBottom: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendLabel: { fontSize: 10 },
  relationMap: { flex: 1, minHeight: 360, borderRadius: 20, backgroundColor: '#F2F6ED', justifyContent: 'center' },
  worldFooter: { paddingHorizontal: 24, paddingBottom: 16, paddingTop: 12, backgroundColor: '#FFFFFF' },
  returnButton: { minHeight: 48, borderRadius: 26 },
  termsBody: { flexGrow: 1, paddingHorizontal: 24 },
  termsWork: { minHeight: 64, padding: 0, flexDirection: 'row', justifyContent: 'flex-start', gap: 10 },
  termsTitle: { fontSize: 20, marginTop: 10 },
  termList: { flex: 1, minHeight: 360, justifyContent: 'center' },
});
// #endregion
