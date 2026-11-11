// #region 의존성 가져오기
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { colors } from './ui';
// #endregion

// #region 로딩 화면
/**
 * 초기 설정과 로그인 상태를 확인하는 동안 앱 로고를 표시합니다.
 * @returns 화면 이동 공급자 없이 표시할 수 있는 로딩 화면입니다.
 */
export function LoadingScreens() {
  return (
    <View style={styles.screen}>
      <Image
        source={require('../assets/brand/header.png')}
        style={styles.logo}
        resizeMode='contain'
        accessibilityLabel="모북이 로고"
      />
      <ActivityIndicator
        size="large"
        color={colors.green}
        accessibilityLabel="불러오는 중입니다."
      />
    </View>
  );
}
// #endregion

// #region 스타일
/** 로고와 로딩 표시를 화면 가운데 배치합니다. */
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    backgroundColor: colors.cream,
  },
  logo: {
    width: 120,
    height: 140,
  },
});
// #endregion
