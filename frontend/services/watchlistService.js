/**
 * QuantView AI — watchlistService.js
 */
(function(window) {
  'use strict';
  var STORAGE_KEY = 'QV_LIVE_WATCHLIST_V1';

  var DEFAULT_ITEMS = [
    { ticker: 'RELIANCE', name: 'Reliance Industries Limited', exchange: 'NSE', price: '₹2,984.50', change: '+1.42%', changePos: true, volumeRatio: '1.24x', aiRating: 'Strong Buy', isFavorite: true, addedAt: Date.now() - 500000 },
    { ticker: 'TCS', name: 'Tata Consultancy Services', exchange: 'NSE', price: '₹4,120.00', change: '+0.88%', changePos: true, volumeRatio: '0.95x', aiRating: 'Buy', isFavorite: false, addedAt: Date.now() - 400000 },
    { ticker: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', price: '$128.50', change: '+3.14%', changePos: true, volumeRatio: '2.10x', aiRating: 'Strong Buy', isFavorite: true, addedAt: Date.now() - 300000 },
    { ticker: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', price: '$224.23', change: '-0.32%', changePos: false, volumeRatio: '0.89x', aiRating: 'Hold', isFavorite: false, addedAt: Date.now() - 200000 },
    { ticker: 'QQQ', name: 'Invesco QQQ Trust', exchange: 'NASDAQ', price: '$481.30', change: '+0.95%', changePos: true, volumeRatio: '1.15x', aiRating: 'Buy', isFavorite: false, addedAt: Date.now() - 100000 }
  ];

  window.WatchlistService = {
    getWatchlist: function() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch (e) {}
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_ITEMS));
      return DEFAULT_ITEMS;
    },
    saveWatchlist: function(items) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      } catch (e) {}
    },
    addItem: function(item) {
      var list = this.getWatchlist();
      var clean = (item.ticker || '').toUpperCase().trim();
      var exists = list.some(function(x) { return x.ticker.toUpperCase() === clean; });
      if (!exists) {
        list.unshift(Object.assign({
          ticker: clean,
          name: window.LogoService ? window.LogoService.getCompanyName(clean, clean) : clean,
          exchange: clean.includes('.NS') || ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'ITC', 'NIFTYBEES'].includes(clean) ? 'NSE' : 'NASDAQ',
          price: item.price || '—',
          change: item.change || '+0.00%',
          changePos: (item.change || '').indexOf('-') === -1,
          volumeRatio: item.volumeRatio || '1.00x',
          aiRating: item.aiRating || 'Buy',
          isFavorite: false,
          addedAt: Date.now()
        }, item));
        this.saveWatchlist(list);
      }
      return list;
    },
    removeItem: function(ticker) {
      var clean = (ticker || '').toUpperCase().trim();
      var list = this.getWatchlist().filter(function(x) { return x.ticker.toUpperCase() !== clean; });
      this.saveWatchlist(list);
      return list;
    },
    toggleFavorite: function(ticker) {
      var clean = (ticker || '').toUpperCase().trim();
      var list = this.getWatchlist().map(function(x) {
        if (x.ticker.toUpperCase() === clean) {
          return Object.assign({}, x, { isFavorite: !x.isFavorite });
        }
        return x;
      });
      this.saveWatchlist(list);
      return list;
    },
    hasItem: function(ticker) {
      var clean = (ticker || '').toUpperCase().trim();
      return this.getWatchlist().some(function(x) { return x.ticker.toUpperCase() === clean; });
    }
  };
})(window);
