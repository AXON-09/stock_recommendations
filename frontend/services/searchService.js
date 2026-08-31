/**
 * QuantView AI — searchService.js
 */
(function(window) {
  'use strict';
  var RECENT_KEY = 'QV_RECENT_SEARCHES_V1';

  var ASSET_DIRECTORY = [
    // 🏛️ Benchmark Indices
    { ticker: '^NSEI', name: 'NIFTY 50 Benchmark Index', exchange: 'NSE', type: 'Index', country: 'India' },
    { ticker: '^BSESN', name: 'S&P BSE SENSEX Index', exchange: 'BSE', type: 'Index', country: 'India' },
    { ticker: '^GSPC', name: 'S&P 500 Benchmark Index', exchange: 'NYSE', type: 'Index', country: 'US' },
    { ticker: '^NDX', name: 'NASDAQ 100 Benchmark Index', exchange: 'NASDAQ', type: 'Index', country: 'US' },

    // 🇮🇳 India Equities
    { ticker: 'RELIANCE', name: 'Reliance Industries Limited', exchange: 'NSE', type: 'Stock', country: 'India' },
    { ticker: 'TCS', name: 'Tata Consultancy Services', exchange: 'NSE', type: 'Stock', country: 'India' },
    { ticker: 'INFY', name: 'Infosys Limited', exchange: 'NSE', type: 'Stock', country: 'India' },
    { ticker: 'HDFCBANK', name: 'HDFC Bank Limited', exchange: 'NSE', type: 'Stock', country: 'India' },
    { ticker: 'ICICIBANK', name: 'ICICI Bank Limited', exchange: 'NSE', type: 'Stock', country: 'India' },
    { ticker: 'SBIN', name: 'State Bank of India', exchange: 'NSE', type: 'Stock', country: 'India' },
    { ticker: 'ITC', name: 'ITC Limited', exchange: 'NSE', type: 'Stock', country: 'India' },
    { ticker: 'BHARTIARTL', name: 'Bharti Airtel Limited', exchange: 'NSE', type: 'Stock', country: 'India' },
    { ticker: 'TATAMOTORS', name: 'Tata Motors Limited', exchange: 'NSE', type: 'Stock', country: 'India' },
    { ticker: 'LT', name: 'Larsen & Toubro Limited', exchange: 'NSE', type: 'Stock', country: 'India' },
    { ticker: 'NIFTYBEES', name: 'Nippon India ETF Nifty BeES', exchange: 'NSE', type: 'ETF', country: 'India' },
    { ticker: 'BANKBEES', name: 'Nippon India ETF Bank BeES', exchange: 'NSE', type: 'ETF', country: 'India' },
    { ticker: 'GOLDBEES', name: 'Nippon India ETF Gold BeES', exchange: 'NSE', type: 'ETF', country: 'India' },

    // 🇺🇸 US Equities & ETFs
    { ticker: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'Stock', country: 'US' },
    { ticker: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', type: 'Stock', country: 'US' },
    { ticker: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', type: 'Stock', country: 'US' },
    { ticker: 'GOOGL', name: 'Alphabet Inc. (Google)', exchange: 'NASDAQ', type: 'Stock', country: 'US' },
    { ticker: 'AMZN', name: 'Amazon.com, Inc.', exchange: 'NASDAQ', type: 'Stock', country: 'US' },
    { ticker: 'META', name: 'Meta Platforms, Inc.', exchange: 'NASDAQ', type: 'Stock', country: 'US' },
    { ticker: 'TSLA', name: 'Tesla, Inc.', exchange: 'NASDAQ', type: 'Stock', country: 'US' },
    { ticker: 'AMD', name: 'Advanced Micro Devices, Inc.', exchange: 'NASDAQ', type: 'Stock', country: 'US' },
    { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', exchange: 'NYSE Arca', type: 'ETF', country: 'US' },
    { ticker: 'QQQ', name: 'Invesco QQQ Trust', exchange: 'NASDAQ', type: 'ETF', country: 'US' },
    { ticker: 'VOO', name: 'Vanguard S&P 500 ETF', exchange: 'NYSE Arca', type: 'ETF', country: 'US' },
    { ticker: 'VTI', name: 'Vanguard Total Stock Market', exchange: 'NYSE Arca', type: 'ETF', country: 'US' }
  ];

  window.SearchService = {
    search: function(query) {
      var q = (query || '').toLowerCase().trim();
      if (!q) return [];
      return ASSET_DIRECTORY.filter(function(item) {
        return item.ticker.toLowerCase().includes(q) ||
               item.name.toLowerCase().includes(q) ||
               item.exchange.toLowerCase().includes(q) ||
               item.type.toLowerCase().includes(q);
      }).slice(0, 8);
    },
    getRecentSearches: function() {
      try {
        var raw = localStorage.getItem(RECENT_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) {}
      return ['NVDA', 'RELIANCE', 'AAPL', 'QQQ', 'TCS'];
    },
    addRecentSearch: function(ticker) {
      var clean = (ticker || '').toUpperCase().trim();
      if (!clean) return;
      var list = this.getRecentSearches().filter(function(t) { return t !== clean; });
      list.unshift(clean);
      if (list.length > 8) list = list.slice(0, 8);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(list));
      } catch (e) {}
    }
  };
})(window);
