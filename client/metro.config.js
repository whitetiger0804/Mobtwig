const { realpathSync } = require('node:fs');
const { getDefaultConfig } = require('expo/metro-config');

// Windows의 짧은 빌드 경로로 실행해도 실제 소스와 의존성을 감시합니다.
module.exports = getDefaultConfig(realpathSync(__dirname));
