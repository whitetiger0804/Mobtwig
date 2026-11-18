import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { kindLabel, useApp } from './appState';
import { EmptyState } from './EmptyState';
import { useMemberAuth } from './memberAuth';
import type { WorkKind } from './workDetails';
import { Action, IconButton, colors, s } from './ui';

interface FollowState {
  favorite: boolean;
  subscribed: boolean;
}

interface Favorite {
  id: string;
  title: string;
  kind: WorkKind;
}

interface FavoritePage {
  items: Favorite[];
  hasNext: boolean;
}

function parseFollowState(value: unknown): FollowState {
  if (value && typeof value === 'object' && 'favorite' in value && typeof value.favorite === 'boolean'
    && 'subscribed' in value && typeof value.subscribed === 'boolean') {
    return { favorite: value.favorite, subscribed: value.subscribed };
  }
  throw new Error('작품 상태 응답이 올바르지 않습니다.');
}

function parseFavorites(value: unknown, page: number): FavoritePage {
  if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items)
    || !('page' in value) || value.page !== page || !('hasNext' in value) || typeof value.hasNext !== 'boolean') {
    throw new Error('즐겨찾기 응답이 올바르지 않습니다.');
  }
  const items = value.items.map((item): Favorite => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[a-z0-9-]+$/.test(item.id)
      || typeof item.title !== 'string' || !item.title.trim()
      || (item.kind !== 'book' && item.kind !== 'magazine' && item.kind !== 'novel')) {
      throw new Error('즐겨찾기 작품 정보가 올바르지 않습니다.');
    }
    return { id: item.id, title: item.title, kind: item.kind };
  });
  return { items, hasNext: value.hasNext };
}

/**
 * 공개 작품 상세에 찜과 해당되는 구독 동작을 제공합니다.
 * @param props - 상세에서 확인한 작품 slug와 종류입니다.
 * @returns 현재 회원의 작품 상태를 관리하는 버튼입니다.
 */
export function WorkFollowActions({ workId, kind }: { workId: string; kind: WorkKind }) {
  const { state, client } = useMemberAuth();
  const { navigate } = useApp();
  const path = '/api/members/works/' + encodeURIComponent(workId);
  const [follow, setFollow] = useState<{ key: string; value: FollowState } | null>(null);
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([state.status, state.generation, workId]);
  const value = follow?.key === key ? follow.value : null;
  const message = problem?.key === key ? problem.text : '';
  const busy = busyKey === key;
  useEffect(() => {
    if (state.status !== 'authenticated') return;
    const abort = new AbortController();
    void client.request(path + '/state', { signal: abort.signal }).then(parseFollowState).then(result => {
      if (!abort.signal.aborted) setFollow({ key, value: result });
    }).catch(() => {
      if (!abort.signal.aborted) setProblem({ key, text: '작품 상태를 불러오지 못했습니다.' });
    });
    return () => abort.abort();
  }, [attempt, client, key, path, state.status]);

  async function toggle(field: 'favorite' | 'subscription') {
    if (state.status !== 'authenticated') {
      navigate({ screen: 'login' });
      return;
    }
    if (!value || busy) return;
    setBusyKey(key);
    setProblem(null);
    const enabled = field === 'favorite' ? value.favorite : value.subscribed;
    try {
      const result = parseFollowState(await client.request(path + '/' + field, { method: enabled ? 'DELETE' : 'PUT' }));
      if (client.getSnapshot().generation === state.generation) setFollow({ key, value: result });
    } catch {
      if (client.getSnapshot().generation === state.generation) setProblem({ key, text: '변경을 확인하지 못했습니다.' });
    } finally {
      setBusyKey(current => current === key ? '' : current);
    }
  }

  const disabled = state.status === 'checking' || (state.status === 'authenticated' && (busy || value === null || !!message));
  const favoriteLabel = value?.favorite ? '찜 해제' : '찜';
  const subscriptionLabel = value?.subscribed ? '구독 해제' : '구독';
  return <View style={styles.actionsSection}>
    <View style={s.row}>
      <View style={styles.control}>
        <IconButton icon="heart" label={favoriteLabel} disabled={disabled} selected={value?.favorite} onPress={() => void toggle('favorite')} />
        <Text style={s.muted}>{favoriteLabel}</Text>
      </View>
      {kind === 'novel' && <View style={styles.control}>
        <IconButton icon="bookmark" label={subscriptionLabel} disabled={disabled} selected={value?.subscribed} onPress={() => void toggle('subscription')} />
        <Text style={s.muted}>{subscriptionLabel}</Text>
      </View>}
    </View>
    {!!message && <>
      <Text style={s.error} accessibilityLiveRegion="polite">{message}</Text>
      <Action compact tone="secondary" label="작품 상태 다시 확인" onPress={() => { setProblem(null); setFollow(null); setAttempt(n => n + 1); }} />
    </>}
  </View>;
}

/** 회원의 찜 목록과 작품 상세로 이동할 동작을 표시합니다. */
export function FavoriteWorksScreen() {
  const { state, client } = useMemberAuth();
  const { navigate } = useApp();
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<{ key: string; value: FavoritePage } | null>(null);
  const [failure, setFailure] = useState('');
  const key = JSON.stringify([state.generation, page, attempt]);
  const current = data?.key === key ? data.value : null;

  useEffect(() => {
    if (state.status !== 'authenticated') return;
    const abort = new AbortController();
    void client.request('/api/members/favorites?page=' + page, { signal: abort.signal }).then(value => parseFavorites(value, page)).then(value => {
      if (abort.signal.aborted) return;
      if (value.items.length === 0 && page > 1) setPage(page - 1);
      else setData({ key, value });
    }).catch(() => { if (!abort.signal.aborted) setFailure(key); });
    return () => abort.abort();
  }, [client, key, page, state.status]);

  return <View style={s.page}>
    {state.status === 'checking' ? <ActivityIndicator color={colors.green} />
      : state.status !== 'authenticated' ? <Action label="로그인하고 즐겨찾기 보기" onPress={() => navigate({ screen: 'login' })} />
      : current === null ? failure === key ? <View>
        <Text style={s.error} accessibilityLiveRegion="polite">즐겨찾기를 불러오지 못했습니다.</Text>
        <Action compact label="다시 불러오기" onPress={() => setAttempt(n => n + 1)} />
      </View> : <ActivityIndicator color={colors.green} />
      : <>
        {current.items.length === 0
          ? <EmptyState title="즐겨찾기한 작품이 없어요" description="작품에 찜을 누르면 이곳에서 볼 수 있어요." />
          : current.items.map(item => <Action key={item.id} tone="secondary" label={item.title + ' · ' + kindLabel(item.kind)}
            onPress={() => navigate({ screen: 'detail', workId: item.id, kind: item.kind })} />)}
        {(page > 1 || current.hasNext) && <View style={s.row}>
          <Action compact tone="secondary" label="이전" disabled={page === 1} onPress={() => setPage(n => n - 1)} />
          <Action compact tone="secondary" label="다음" disabled={!current.hasNext} onPress={() => setPage(n => n + 1)} />
        </View>}
      </>}
    <Action label="작품 둘러보기" onPress={() => navigate({ screen: 'home', kind: 'all' }, true)} />
  </View>;
}

const styles = StyleSheet.create({
  actionsSection: { alignItems: 'flex-start', gap: 8, marginVertical: 8 },
  control: { alignItems: 'center', minWidth: 52 },
});
