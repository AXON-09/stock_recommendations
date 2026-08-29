/**
 * QuantView AI — notificationService.js
 */
(function(window) {
  'use strict';
  var STORAGE_KEY = 'QV_NOTIFICATIONS_V1';

  var DEFAULT_NOTIFS = [
    { id: 'n1', title: 'AI Bullish Breakout Detected', message: 'NVIDIA (NVDA) probability jumped to 86.4% on heavy institutional volume.', type: 'ai_regime', timestamp: '10m ago', ticker: 'NVDA', isRead: false },
    { id: 'n2', title: 'FII Inflow Surge in Banking', message: 'HDFC Bank & ICICI Bank registered ₹3,120 Cr net foreign accumulation.', type: 'market_alert', timestamp: '35m ago', ticker: 'HDFCBANK', isRead: false },
    { id: 'n3', title: 'Volatility Squeeze Trigger', message: 'Invesco QQQ ATR contracted into the 4th percentile. Directional breakout imminent.', type: 'market_alert', timestamp: '1h ago', ticker: 'QQQ', isRead: false },
    { id: 'n4', title: 'Reliance Industries Earnings', message: 'Oil-to-Chemicals & Telecom segments exceed consensus EBITDA targets by 6.2%.', type: 'breaking_news', timestamp: '2h ago', ticker: 'RELIANCE', isRead: true }
  ];

  window.NotificationService = {
    getNotifications: function() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch (e) {}
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_NOTIFS));
      return DEFAULT_NOTIFS;
    },
    saveNotifications: function(items) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      } catch (e) {}
    },
    getUnreadCount: function() {
      return this.getNotifications().filter(function(x) { return !x.isRead; }).length;
    },
    markAllAsRead: function() {
      var list = this.getNotifications().map(function(x) {
        return Object.assign({}, x, { isRead: true });
      });
      this.saveNotifications(list);
      return list;
    },
    clearAll: function() {
      this.saveNotifications([]);
      return [];
    },
    addNotification: function(notif) {
      var list = this.getNotifications();
      list.unshift(Object.assign({
        id: 'n_' + Date.now(),
        timestamp: 'Just now',
        isRead: false
      }, notif));
      this.saveNotifications(list);
      return list;
    }
  };
})(window);
