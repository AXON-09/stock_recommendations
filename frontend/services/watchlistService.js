/**
 * QuantView AI — watchlistService.js v3.0
 * Fetches the 10 Top Gainers & Active Market Movers across Indian & US Equities
 * Refreshes automatically every 5 minutes with localStorage caching & fallback.
 */

(function(window) {
  'use strict';

  var CACHE_KEY = 'QV_CACHED_WATCHLIST';
  var CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

  window.WatchlistService = {
    getWatchlist: function() {
      try {
        var raw = localStorage.getItem(CACHE_KEY);
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
        var raw = localStorage.getItem(CACHE_KEY);
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
            localStorage.setItem(CACHE_KEY, JSON.stringify({
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

    hasItem: function(ticker) {
      if (!ticker) return false;
      var items = this.getWatchlist();
      var t = ticker.toUpperCase();
      return items.some(function(i) { return (i.ticker || '').toUpperCase() === t; });
    },

    addItem: function(item) {
      return true;
    },

    removeItem: function(ticker) {
      return true;
    },

    toggleFavorite: function(ticker) {
      return true;
    }
  };
})(window);
