import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMemberAuth } from './memberAuth';
import { isTextBoundary, listHighlights, saveHighlight, type Highlight, type HighlightColor, type HighlightRange } from './highlights';
import { Action, colors, s } from './ui';

const noHighlights: Highlight[] = [];

/**
 * 뷰어에 표시할 현재 회원의 회차별 기록을 조회합니다.
 * @param workId - 읽고 있는 작품입니다.
 * @param chapterId - 읽고 있는 회차입니다.
 * @returns 기록과 조회 갱신 함수입니다.
 */
export function useReaderHighlights(workId?: string, chapterId?: string): ReaderHighlights {
  const { state, client } = useMemberAuth();
  const key = JSON.stringify([state.generation, workId, chapterId]);
  const [result, setResult] = useState<{ key: string; items: Highlight[]; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const authenticated = state.status === 'authenticated';
  useEffect(() => {
    if (!authenticated || !workId || !chapterId) return;
    let active = true;
    async function read(slug: string, chapter: string) {
      const items: Highlight[] = [];
      let page = 1;
      while (active) {
        const response = await listHighlights(client, page, slug, chapter);
        items.push(...response.items);
        if (!response.hasNext) {
          if (active) setResult({ key, items, failed: false });
          return;
        }
        page++;
      }
    }
    void read(workId, chapterId).catch(() => {
      if (active) setResult({ key, items: [], failed: true });
    });
    return () => { active = false; };
  }, [authenticated, key, workId, chapterId, client, attempt]);
  return { items: authenticated && result?.key === key ? result.items : noHighlights, authenticated,
    failed: authenticated && result?.key === key && result.failed, refresh: () => setAttempt(value => value + 1) };
}

/** 현재 회차의 하이라이트 조회 결과입니다. */
export interface ReaderHighlights {
  /** 현재 회원과 회차에 속하는 기록입니다. */
  items: Highlight[];
  /** 회원 전용 저장이 가능한지 나타냅니다. */
  authenticated: boolean;
  /** 서버 기록을 불러오지 못했는지 나타냅니다. */
  failed: boolean;
  /** 서버 목록을 다시 읽습니다. */
  refresh: () => void;
}

/** 색 선택과 저장을 표시할 본문 또는 쪽입니다. */
export interface HighlightEditorProps {
  /** 읽고 있는 작품입니다. */
  workId: string;
  /** 회차 ID입니다. */
  chapterId: string;
  /** 원문 버전입니다. */
  contentVersion: number;
  /** 텍스트 원문 해시 또는 null입니다. */
  contentHash: string | null;
  /** 문단 원문입니다. 쪽에는 지정하지 않습니다. */
  text?: string;
  /** 문단 시작 또는 매거진 쪽 번호입니다. */
  offset: number;
  /** 화면을 닫습니다. */
  onClose: () => void;
  /** 저장 후 목록을 다시 읽습니다. */
  onSaved: () => void;
}

/** 실제 선택 이벤트 또는 유니코드 경계 버튼으로 범위를 지정합니다.
 * @param props - 표시한 좌표와 완료 동작입니다.
 * @returns 본문 위치에 영향을 주지 않는 선택 패널입니다.
 */
export function HighlightEditor({ workId, chapterId, contentVersion, contentHash, text, offset, onClose, onSaved }: HighlightEditorProps) {
  const { client } = useMemberAuth();
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [color, setColor] = useState<HighlightColor>('YELLOW');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const writing = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  const valid = text === undefined || selection.start < selection.end;

  function step(edge: 'start' | 'end', direction: -1 | 1) {
    if (!text) return;
    setSelection(previous => {
      let next = previous[edge] + direction;
      while (next >= 0 && next <= text.length && !isTextBoundary(text, next)) next += direction;
      if (next < 0 || next > text.length) return previous;
      return edge === 'start' ? { start: next, end: Math.max(next, previous.end) }
        : { start: Math.min(next, previous.start), end: next };
    });
  }

  async function save() {
    if (!valid || writing.current) return;
    const range: HighlightRange = { chapterId, contentVersion, contentHash, unit: text === undefined ? 'page' : 'utf16',
      startOffset: offset + selection.start, endOffset: offset + selection.end };
    writing.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await saveHighlight(client, workId, range, color);
      if (!live.current) return;
      onSaved();
      if (result.state === 'available') onClose();
      else setMessage('이 범위에 이전 기록이 있습니다. 독서 기록에서 확인해 주세요.');
    } catch {
      if (live.current) setMessage('하이라이트를 저장하지 못했습니다. 본문을 확인하고 다시 시도해 주세요.');
    } finally {
      writing.current = false;
      if (live.current) setBusy(false);
    }
  }

  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <View accessibilityViewIsModal style={styles.panel}>
        <Text style={s.title}>{text === undefined ? offset + '쪽 표시' : '하이라이트 범위 선택'}</Text>
        {text !== undefined && <>
          {Platform.OS === 'web' ? <TextInput accessibilityLabel="하이라이트할 문장 선택" multiline readOnly value={text}
            onSelectionChange={event => {
              const next = event.nativeEvent.selection;
              if (next.start < next.end && isTextBoundary(text, next.start) && isTextBoundary(text, next.end)) setSelection(next);
            }} style={[s.text, styles.input]} /> : <ScrollView style={styles.preview}>
              <Text style={s.text}>{text.slice(0, selection.start)}<Text style={styles.selected}>
                {text.slice(selection.start, selection.end)}</Text>{text.slice(selection.end)}</Text>
            </ScrollView>}
          <View style={styles.actions}>
            <Action compact tone="secondary" label="시작 왼쪽" onPress={() => step('start', -1)} />
            <Action compact tone="secondary" label="시작 오른쪽" onPress={() => step('start', 1)} />
            <Action compact tone="secondary" label="끝 왼쪽" onPress={() => step('end', -1)} />
            <Action compact tone="secondary" label="끝 오른쪽" onPress={() => step('end', 1)} />
            <Action compact tone="secondary" label="문단 전체 선택" onPress={() => setSelection({ start: 0, end: text.length })} />
          </View>
          {valid && <Text style={styles.selected} numberOfLines={3}>{text.slice(selection.start, selection.end)}</Text>}
        </>}
        <View style={styles.actions}>
          <Action compact tone={color === 'YELLOW' ? 'primary' : 'secondary'} label="노랑" onPress={() => setColor('YELLOW')} />
          <Action compact tone={color === 'GREEN' ? 'primary' : 'secondary'} label="초록" onPress={() => setColor('GREEN')} />
        </View>
        {!!message && <Text accessibilityRole="alert" style={s.error}>{message}</Text>}
        <View style={styles.actions}>
          <Action compact label="하이라이트 저장" disabled={!valid || busy} onPress={() => { void save(); }} />
          <Action compact tone="secondary" label="닫기" disabled={busy} onPress={onClose} />
        </View>
      </View>
    </View>
  </Modal>;
}

/** 기록 색을 텍스트나 쪽 표식에 표시할 값입니다. */
export const highlightColors = {
  /** 노란 밑줄입니다. */
  YELLOW: '#F7DF7B',
  /** 초록 밑줄입니다. */
  GREEN: '#A7DFAB',
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0007', padding: 18 },
  panel: { width: '100%', maxWidth: 480, maxHeight: '90%', backgroundColor: '#fff', borderRadius: 16, padding: 18, gap: 12 },
  input: { minHeight: 88, maxHeight: 180, padding: 10, borderWidth: 1, borderColor: colors.line, textAlignVertical: 'top' },
  preview: { maxHeight: 180, flexGrow: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selected: { backgroundColor: '#F7DF7B', color: '#22352C' },
});
