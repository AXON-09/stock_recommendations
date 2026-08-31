/**
 * QuantView AI — marketauxService.js v3.0
 * Live Market News with Marketaux API integration, 5-minute auto refresh,
 * multi-filter combinations, live search, and target="_blank" original article links.
 */

(function(window) {
  'use strict';

  var CACHE_KEY = 'QV_CACHED_NEWS';
  var CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

  window.MarketauxService = {
    fetchNews: async function(filterCategories, searchQuery) {
      var allArticles = [];

      // Check client-side cache first if no custom search query
      try {
        var cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          var parsed = JSON.parse(cached);
          if (parsed && Array.isArray(parsed.articles) && (Date.now() - parsed.timestamp < CACHE_TTL_MS)) {
            allArticles = parsed.articles;
          }
        }
      } catch (e) {}

      // If no valid client cache, fetch live from backend API
      if (!allArticles || allArticles.length === 0) {
        try {
          var base = (window.location.protocol === 'file:' ? 'http://127.0.0.1:8000' : '');
          var res = await fetch(base + '/api/news/live');
          if (res.ok) {
            var data = await res.json();
            if (data && Array.isArray(data.articles)) {
              allArticles = data.articles;
              localStorage.setItem(CACHE_KEY, JSON.stringify({
                articles: allArticles,
                timestamp: Date.now()
              }));
            }
          }
        } catch (err) {
          console.warn('[MarketauxService] Error fetching live news feed:', err);
        }
      }

      var filtered = allArticles || [];

      // Apply category filters
      if (filterCategories && filterCategories.length > 0 && !filterCategories.includes('all')) {
        filtered = filtered.filter(function(art) {
          if (!art.category) return false;
          return filterCategories.some(function(cat) {
            return art.category.indexOf(cat) !== -1 || (art.sentiment && art.sentiment === cat);
          });
        });
      }

      // Apply search query
      if (searchQuery && searchQuery.trim()) {
        var q = searchQuery.toLowerCase().trim();
        filtered = filtered.filter(function(art) {
          return (art.headline && art.headline.toLowerCase().indexOf(q) !== -1) ||
                 (art.summary && art.summary.toLowerCase().indexOf(q) !== -1) ||
                 (art.tickers && art.tickers.some(function(t) { return t.toLowerCase().indexOf(q) !== -1; }));
        });
      }

      return filtered;
    }
  };
})(window);
