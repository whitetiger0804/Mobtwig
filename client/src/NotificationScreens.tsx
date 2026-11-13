import { StyleSheet, Text, View } from 'react-native';
import { useApp } from './appState';
import { Action, colors, Icon, s } from './ui';

/** 표시할 알림이 없을 때 안내와 홈 이동을 제공하는 알림 화면입니다. */
export function NotificationsScreen() {
  const app = useApp();
  return (
    <View style={s.page}>
      <View style={styles.emptyCard}>
        <View style={styles.bellBadge}>
          <Icon name="bell" size={28} color={colors.green} />
        </View>
        <Text style={[s.subtitle, styles.heading]}>새로운 알림이 없어요</Text>
        <Text style={[s.muted, styles.description]}>
          새 작품 소식이나 댓글, 이벤트 알림이 생기면 여기에 모아 보여드릴게요.
        </Text>
        <Action label="홈 둘러보기" onPress={() => app.navigate({ screen: 'home', kind: 'all' }, true)} style={styles.homeAction} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyCard: {
    flex: 1,
    minHeight: 360,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 26,
    paddingVertical: 40,
    borderRadius: 22,
    backgroundColor: '#FFFDF6',
  },
  bellBadge: {
    width: 68,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
    borderRadius: 34,
    backgroundColor: '#EAF1E6',
  },
  heading: { textAlign: 'center', marginBottom: 10 },
  description: { maxWidth: 280, textAlign: 'center', lineHeight: 22 },
  homeAction: { alignSelf: 'stretch', marginTop: 28 },
});
