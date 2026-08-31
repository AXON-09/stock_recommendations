/**
 * QuantView AI — notificationService.js v4.0
 * Live event-driven intelligence alerts with strict deduplication and robust rendering.
 */
(function(window) {
  'use strict';
  var STORAGE_KEY = 'QV_NOTIFICATIONS_V4';
  var MAX_NOTIFICATIONS = 8;

  // Clean up any legacy bloated keys from earlier test iterations
  try {
    localStorage.removeItem('QV_NOTIFICATIONS_V1');
    localStorage.removeItem('QV_NOTIFICATIONS_V2');
    localStorage.removeItem('QV_NOTIFICATIONS_V3');
  } catch (e) {}

  function getSeedNotifications() {
    var now = Date.now();
    return [
      {
        id: 'notif_init_session',
        title: 'Trading Session Active · NSE / BSE',
        message: 'Live quote streaming and real-time feature engineering pipelines are active for Indian equities.',
        type: 'market_alert',
        ticker: 'RELIANCE',
        timestamp: new Date(now - 4 * 60 * 1000).toISOString(),
        isRead: false
      },
      {
        id: 'notif_init_ai',
        title: 'AI Machine Learning Pipeline Ready',
        message: 'XGBoost & PyTorch LSTM walk-forward cross-validation initialized. Search any stock or ETF to generate signals.',
        type: 'ai_regime',
        ticker: 'NVDA',
        timestamp: new Date(now - 14 * 60 * 1000).toISOString(),
        isRead: false
      },
      {
        id: 'notif_init_news',
        title: 'Macro Market Intelligence Stream Online',
        message: 'Aggregating live verified market headlines and financial sentiment scores across global assets.',
        type: 'breaking_news',
        ticker: 'SPY',
        timestamp: new Date(now - 28 * 60 * 1000).toISOString(),
        isRead: true
      }
    ];
  }

  window.NotificationService = {
    getNotifications: function() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            // Ensure all items are valid objects
            return parsed.filter(function(item) {
              return item && typeof item === 'object' && item.title;
            });
          }
        }
      } catch (e) {}

      var initial = getSeedNotifications();
      this.saveNotifications(initial);
      return initial;
    },

    saveNotifications: function(items) {
      try {
        var clean = (Array.isArray(items) ? items : []).slice(0, MAX_NOTIFICATIONS);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
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
      this.notifySubscribers();
      return list;
    },

    markAsRead: function(id) {
      var list = this.getNotifications().map(function(x) {
        if (x.id === id) return Object.assign({}, x, { isRead: true });
        return x;
      });
      this.saveNotifications(list);
      this.notifySubscribers();
      return list;
    },

    clearAll: function() {
      this.saveNotifications([]);
      this.notifySubscribers();
      return [];
    },

    formatRelativeTime: function(isoTimestamp) {
      if (!isoTimestamp) return 'Just now';
      try {
        var date = new Date(isoTimestamp);
        var diffMs = Date.now() - date.getTime();
        var diffSec = Math.floor(diffMs / 1000);
        if (diffSec < 45) return 'Just now';
        var diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return diffMin + 'm ago';
        var diffHours = Math.floor(diffMin / 60);
        if (diffHours < 24) return diffHours + 'h ago';
        var diffDays = Math.floor(diffHours / 24);
        return diffDays + 'd ago';
      } catch (e) {
        return 'Just now';
      }
    },

    addNotification: function(notif) {
      if (!notif || !notif.title) return [];
      var list = this.getNotifications();

      // Deduplicate: if an alert for this ticker already exists, replace it
      var filtered = list.filter(function(item) {
        if (notif.ticker && item.ticker === notif.ticker.toUpperCase()) return false;
        if (item.title === notif.title) return false;
        return true;
      });

      var newEntry = {
        id: 'n_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        title: String(notif.title || 'Market Alert'),
        message: String(notif.message || ''),
        type: String(notif.type || 'ai_regime'),
        ticker: notif.ticker ? String(notif.ticker).toUpperCase() : null,
        timestamp: new Date().toISOString(),
        isRead: false
      };

      filtered.unshift(newEntry);
      this.saveNotifications(filtered);
      this.notifySubscribers();
      return filtered;
    },

    notifySubscribers: function() {
      if (typeof window.updateNotificationBadge === 'function') {
        window.updateNotificationBadge();
      }
    }
  };
})(window);
