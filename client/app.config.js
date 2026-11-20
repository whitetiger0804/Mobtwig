const { shareOrigin } = require('./src/workSharing.ts');

/** 공유 origin과 네이티브 앱의 HTTPS 연결 도메인을 같은 빌드 설정에서 결정합니다. */
module.exports = ({ config }) => {
  const origin = new URL(shareOrigin(process.env.EXPO_PUBLIC_SHARE_BASE_URL));
  if (origin.protocol === 'https:' && origin.port) {
    throw new Error('HTTPS 앱 연결에는 포트가 없는 공유 origin을 지정해 주세요.');
  }

  const bundleIdentifier = process.env.IOS_BUNDLE_IDENTIFIER ?? config.ios?.bundleIdentifier;
  const appleTeamId = process.env.APPLE_TEAM_ID ?? config.ios?.appleTeamId;
  if (bundleIdentifier !== undefined && !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleIdentifier)) {
    throw new Error('IOS_BUNDLE_IDENTIFIER를 확인해 주세요.');
  }
  if (appleTeamId !== undefined && (!/^[A-Z0-9]{10}$/.test(appleTeamId) || !bundleIdentifier)) {
    throw new Error('APPLE_TEAM_ID와 IOS_BUNDLE_IDENTIFIER를 함께 확인해 주세요.');
  }

  const verified = origin.protocol === 'https:';
  const filters = verified ? [{
    action: 'VIEW',
    autoVerify: true,
    category: ['BROWSABLE', 'DEFAULT'],
    data: [{ scheme: 'https', host: origin.hostname, pathPrefix: '/s/works/' }],
  }] : [];
  const domains = verified ? ['applinks:' + origin.hostname] : [];

  return {
    ...config,
    android: {
      ...config.android,
      intentFilters: [...(config.android?.intentFilters ?? []), ...filters],
    },
    ...(bundleIdentifier ? {
      ios: {
        ...config.ios,
        bundleIdentifier,
        ...(appleTeamId ? { appleTeamId } : {}),
        associatedDomains: [...new Set([...(config.ios?.associatedDomains ?? []), ...domains])],
      },
    } : {}),
  };
};
