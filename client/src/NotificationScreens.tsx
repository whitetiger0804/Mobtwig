import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from './appState';
import { useMemberAuth } from './memberAuth';
import { listNotifications, markNotificationRead, type MemberNotification, type NotificationList } from './notifications';
import { Action, colors, Icon, s } from './ui';

/** 회원 알림을 조회하고 선택한 알림을 읽음 처리합니다. */
export function NotificationsScreen() {
  const app = useApp();
  const { state, client } = useMemberAuth();
  const [data, setData] = useState<NotificationList | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const generation = state.generation;

  useEffect(() => {
    if (state.status !== 'authenticated') { setData(null); setError(null); return; }
    let active = true;
    setLoading(true); setError(null);
    void listNotifications(client).then(result => {
      if (active && client.getSnapshot().generation === generation) setData(result);
    }).catch(reason => {
      if (active && client.getSnapshot().generation === generation) {
        setError(reason instanceof Error ? reason.message : '알림을 불러오지 못했습니다.');
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, client, generation, state.status]);

  async function read(item: MemberNotification) {
    if (item.readAt || busyId) return;
    setBusyId(item.id); setError(null);
    try {
      await markNotificationRead(client, item.id);
      if (client.getSnapshot().generation === generation) {
        const readAt = new Date().toISOString();
        setData(current => current && ({ unreadCount: Math.max(0, current.unreadCount - 1),
          items: current.items.map(row => row.id === item.id ? { ...row, readAt } : row) }));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '알림을 읽음 처리하지 못했습니다.');
    } finally { setBusyId(null); }
  }

  if (state.status === 'checking') return <View style={styles.center}><ActivityIndicator color={colors.green} /><Text style={s.muted}>로그인 상태를 확인하고 있어요.</Text></View>;
  if (state.status !== 'authenticated') return (
    <View style={styles.center}>
      <View style={styles.bellBadge}><Icon name="bell" size={28} color={colors.green} /></View>
      <Text style={[s.subtitle, styles.heading]}>로그인 후 알림을 확인할 수 있어요</Text>
      <Text style={[s.muted, styles.description]}>새 작품 소식이나 댓글, 이벤트 알림을 모아 보여드릴게요.</Text>
      <Action label="로그인" onPress={() => app.navigate({ screen: 'login' })} style={styles.homeAction} />
    </View>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View><Text style={styles.title}>알림</Text>{data && <Text style={s.muted}>읽지 않은 알림 {data.unreadCount}개</Text>}</View>
      </View>
      {error && <View accessibilityLiveRegion="polite" style={styles.errorBox}><Text style={styles.errorText}>{error}</Text><Action compact tone="secondary" label="다시 시도" onPress={() => setAttempt(value => value + 1)} /></View>}
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.green} /><Text style={s.muted}>알림을 불러오고 있어요.</Text></View>
        : !error && data?.items.length === 0 ? <View style={styles.center}>
          <View style={styles.bellBadge}><Icon name="bell" size={28} color={colors.green} /></View>
          <Text style={[s.subtitle, styles.heading]}>새로운 알림이 없어요</Text>
          <Text style={[s.muted, styles.description]}>새 작품 소식이나 댓글, 이벤트 알림이 생기면 여기에 모아 보여드릴게요.</Text>
          <Action label="홈 둘러보기" onPress={() => app.navigate({ screen: 'home', kind: 'all' }, true)} style={styles.homeAction} />
        </View> : data && <ScrollView contentContainerStyle={styles.list}>
          {data.items.map(item => <Pressable key={item.id} accessibilityRole="button"
            accessibilityLabel={`${item.readAt ? '' : '읽지 않음, '}${item.title}`}
            accessibilityState={{ disabled: !!busyId }} disabled={!!busyId}
            onPress={() => void read(item)} style={[styles.item, !item.readAt && styles.unreadItem]}>
            <View style={[styles.itemMark, !item.readAt && styles.unreadMark]} />
            <View style={styles.itemCopy}>
              <Text style={styles.itemTitle}>{item.title}</Text>
              {!!item.message && <Text style={styles.itemBody}>{item.message}</Text>}
              <Text style={styles.itemDate}>{new Date(item.createdAt).toLocaleString()}</Text>
            </View>
            {!item.readAt && <Text style={styles.unreadLabel}>안 읽음</Text>}
          </Pressable>)}
        </ScrollView>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { minHeight: 74, paddingHorizontal: 22, paddingVertical: 14, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { ...s.title, color: colors.ink, fontSize: 21 },
  list: { paddingHorizontal: 20, paddingBottom: 32 },
  item: { minHeight: 96, paddingVertical: 17, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  unreadItem: { backgroundColor: '#F8FAF5' },
  itemMark: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'transparent' },
  unreadMark: { backgroundColor: colors.green },
  itemCopy: { flex: 1 },
  itemTitle: { ...s.text, color: colors.ink, fontSize: 14, lineHeight: 21, fontWeight: '700' },
  itemBody: { ...s.text, marginTop: 4, color: colors.brown, fontSize: 12, lineHeight: 19 },
  itemDate: { ...s.text, marginTop: 7, color: colors.muted, fontSize: 10 },
  unreadLabel: { ...s.text, color: colors.green, fontSize: 10, fontWeight: '600' },
  center: { flex: 1, minHeight: 320, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26, paddingVertical: 40, gap: 10 },
  bellBadge: { width: 68, height: 68, alignItems: 'center', justifyContent: 'center', marginBottom: 12, borderRadius: 34, backgroundColor: '#EAF1E6' },
  heading: { textAlign: 'center', marginBottom: 2 },
  description: { maxWidth: 280, textAlign: 'center', lineHeight: 22 },
  homeAction: { alignSelf: 'stretch', marginTop: 18 },
  errorBox: { margin: 18, padding: 14, borderRadius: 14, backgroundColor: '#FFF4F2', gap: 8 },
  errorText: { ...s.text, color: '#A53B32', fontSize: 12, lineHeight: 19 },
});
