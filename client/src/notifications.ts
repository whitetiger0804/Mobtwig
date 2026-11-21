import type { MemberSessionClient } from './memberSession';

export interface MemberNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationList {
  unreadCount: number;
  items: MemberNotification[];
}

function parseItem(value: unknown): MemberNotification {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('알림 응답 형식이 올바르지 않습니다.');
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !item.id.trim()
      || typeof item.type !== 'string' || !item.type.trim()
      || typeof item.title !== 'string' || !item.title.trim()
      || typeof item.message !== 'string'
      || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))
      || !(item.readAt === null || (typeof item.readAt === 'string' && Number.isFinite(Date.parse(item.readAt))))) {
    throw new Error('알림 응답 형식이 올바르지 않습니다.');
  }
  return { id: item.id, type: item.type, title: item.title, message: item.message,
    createdAt: item.createdAt, readAt: item.readAt as string | null };
}

export function parseNotificationList(value: unknown): NotificationList {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('알림 목록 응답 형식이 올바르지 않습니다.');
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.items) || typeof result.unreadCount !== 'number'
      || !Number.isSafeInteger(result.unreadCount) || result.unreadCount < 0) {
    throw new Error('알림 목록 응답 형식이 올바르지 않습니다.');
  }
  return { unreadCount: result.unreadCount, items: result.items.map(parseItem) };
}

export async function listNotifications(client: MemberSessionClient): Promise<NotificationList> {
  return parseNotificationList(await client.request('/api/members/notifications'));
}

export async function markNotificationRead(client: MemberSessionClient, id: string): Promise<void> {
  await client.request('/api/members/notifications/' + encodeURIComponent(id) + '/read', { method: 'PATCH' });
}
