/**
 * QuantView AI — notificationService.ts
 * Real-time notification center for market, AI regime, and watchlist price alerts.
 */

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'market_alert' | 'ai_regime' | 'watchlist' | 'breaking_news' | 'price_alert';
  timestamp: string;
  ticker?: string;
  isRead: boolean;
}

export class NotificationService {
  public static getNotifications(): NotificationItem[] { return []; }
  public static markAsRead(id: string): void {}
  public static clearAll(): void {}
}
