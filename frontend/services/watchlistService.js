/**
 * QuantView AI — watchlistService.js v3.1
 * - Live Market Movers (QV_CACHED_WATCHLIST / ephemeral backend quotes)
 * - Persistent User Saved Watchlist (QV_USER_WATCHLIST_V1 / local user collection)
 */

(function(window) {
  'use strict';

  var MOVERS_CACHE_KEY = 'QV_CACHED_WATCHLIST';
  var USER_WATCHLIST_KEY = 'QV_USER_WATCHLIST_V1';

  window.WatchlistService = {
    // ── Live Market Movers (Top 10 Gainers & Active Leaders) ───────────────
    getWatchlist: function() {
      try {
        var raw = localStorage.getItem(MOVERS_CACHE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
            return parsed.items;
          }
        }
      } catch (e) {}
      return [];
    },

    getLastUpdated: function() {
      try {
        var raw = localStorage.getItem(MOVERS_CACHE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.timestamp) {
            var diff = Math.floor((Date.now() - parsed.timestamp) / 60000);
            if (diff < 1) return 'Live · Just now';
            return 'Updated ' + diff + 'm ago';
          }
        }
      } catch (e) {}
      return 'Live';
    },

    fetchLiveWatchlist: async function() {
      try {
        var base = (window.location.protocol === 'file:' ? 'http://127.0.0.1:8000' : '');
        var res = await fetch(base + '/api/watchlist/live');
        if (res.ok) {
          var data = await res.json();
          if (data && Array.isArray(data.items) && data.items.length > 0) {
            localStorage.setItem(MOVERS_CACHE_KEY, JSON.stringify({
              items: data.items,
              timestamp: (data.timestamp ? data.timestamp * 1000 : Date.now())
            }));
            return data.items;
          }
        }
      } catch (e) {
        console.warn('[WatchlistService] Network error fetching live quotes:', e);
      }
      return this.getWatchlist();
    },

    // ── Persistent User Watchlist (QV_USER_WATCHLIST_V1) ───────────────────
    getUserWatchlist: function() {
      try {
        var raw = localStorage.getItem(USER_WATCHLIST_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch (e) {}
      return [
        { ticker: 'RELIANCE', name: 'Reliance Industries Limited', exchange: 'NSE' },
        { ticker: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ' },
        { ticker: 'TCS', name: 'Tata Consultancy Services', exchange: 'NSE' },
        { ticker: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }
      ];
    },

    hasItem: function(ticker) {
      if (!ticker) return false;
      var list = this.getUserWatchlist();
      var t = String(ticker).toUpperCase().trim();
      return list.some(function(i) {
        var sym = (typeof i === 'string' ? i : i.ticker || '').toUpperCase().trim();
        return sym === t || sym.replace('.NS', '').replace('.BO', '') === t.replace('.NS', '').replace('.BO', '');
      });
    },

    addItem: function(itemOrTicker) {
      if (!itemOrTicker) return false;
      var list = this.getUserWatchlist();
      var tickerStr = typeof itemOrTicker === 'string' ? itemOrTicker : (itemOrTicker.ticker || '');
      var t = tickerStr.toUpperCase().trim();
      if (!t) return false;

      if (!this.hasItem(t)) {
        var entry = typeof itemOrTicker === 'object' ? itemOrTicker : { ticker: t, name: t };
        entry.ticker = t;
        entry.savedAt = Date.now();
        list.push(entry);
        try {
          localStorage.setItem(USER_WATCHLIST_KEY, JSON.stringify(list));
        } catch (e) {}
      }
      return true;
    },

    removeItem: function(ticker) {
      if (!ticker) return false;
      var list = this.getUserWatchlist();
      var t = String(ticker).toUpperCase().trim();
      var filtered = list.filter(function(i) {
        var sym = (typeof i === 'string' ? i : i.ticker || '').toUpperCase().trim();
        return sym !== t && sym.replace('.NS', '').replace('.BO', '') !== t.replace('.NS', '').replace('.BO', '');
      });
      try {
        localStorage.setItem(USER_WATCHLIST_KEY, JSON.stringify(filtered));
      } catch (e) {}
      return true;
    },

    toggleFavorite: function(ticker) {
      if (this.hasItem(ticker)) {
        this.removeItem(ticker);
        return false;
      } else {
        this.addItem(ticker);
        return true;
      }
    }
  };
})(window);
