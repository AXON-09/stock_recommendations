/**
 * liveQuoteService.js - Centralized Live Quote Engine for QuantView AI.
 * 
 * Provides a single source of truth for all real-time market quotes across
 * Hero Cards, Interactive Charts, Watchlists, Market Ribbons, and Dashboards.
 * 
 * Features:
 * - Lifecycle-safe Pub/Sub subscription management (with Component IDs).
 * - Adaptive polling based on market hours, tab visibility, and network state.
 * - Normalized quote schema with exchange-reported market state and quote freshness.
 * - Comprehensive formatting utilities for multi-currency & timezone synchronization.
 * - Built-in observability diagnostics.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Polling Configuration Constants
  // ---------------------------------------------------------------------------
  const POLL_CONFIG = Object.freeze({
    LIVE_POLL_INTERVAL: 12000,          // 12s during active market hours
    CLOSED_MARKET_INTERVAL: 300000,     // 5m when market is closed
    VISIBILITY_REFRESH_INTERVAL: 1000,  // 1s delay on tab re-focus before poll
    RECONNECT_INTERVAL: 5000,           // 5s retry on network reconnect
    MAX_BATCH_SIZE: 50,                 // Maximum symbols per batch query
  });

  class CentralizedLiveQuoteService {
    constructor() {
      // In-memory quote store { normalized_ticker -> LiveQuote }
      this._quotes = new Map();

      // Subscriptions: Map<ticker, Map<componentId, Callback>>
      this._subscriptions = new Map();

      // Global subscriptions: Map<componentId, Callback>
      this._globalSubscriptions = new Map();

      // Polling State
      this._pollTimer = null;
      this._isPollingActive = false;
      this._isTabVisible = !document.hidden;
      this._isOnline = navigator.onLine !== false;

      // Observability & Diagnostics
      this._diagnostics = {
        lastSuccessfulUpdate: null,
        lastAttempt: null,
        retryCount: 0,
        totalUpdatesDelivered: 0,
        activeSubscriptionsCount: 0,
        activeTickersCount: 0,
      };

      this._initLifecycleListeners();
    }

    // ── Lifecycle & Network Listeners ──────────────────────────────────────────
    _initLifecycleListeners() {
      // Tab Visibility Listener
      document.addEventListener('visibilitychange', () => {
        const wasVisible = this._isTabVisible;
        this._isTabVisible = !document.hidden;

        if (!wasVisible && this._isTabVisible) {
          // Tab became visible: trigger immediate refresh and restart adaptive timer
          setTimeout(() => this._triggerAdaptivePoll(), POLL_CONFIG.VISIBILITY_REFRESH_INTERVAL);
        } else if (!this._isTabVisible) {
          // Tab hidden: pause timer to conserve bandwidth and CPU
          this._stopPollTimer();
        }
      });

      // Network Online / Offline Listeners
      window.addEventListener('online', () => {
        this._isOnline = true;
        setTimeout(() => this._triggerAdaptivePoll(), POLL_CONFIG.RECONNECT_INTERVAL);
      });

      window.addEventListener('offline', () => {
        this._isOnline = false;
        this._stopPollTimer();
      });
    }

    // ── Normalization Helper ───────────────────────────────────────────────────
    _normalizeQuote(raw) {
      if (!raw || typeof raw !== 'object') return null;

      const ticker = String(raw.ticker || raw.symbol || '').trim().toUpperCase();
      if (!ticker) return null;

      const parseNum = (val) => {
        if (val == null) return null;
        if (typeof val === 'number') return isFinite(val) ? val : null;
        const cleaned = String(val).replace(/[^0-9.-]+/g, '');
        if (!cleaned) return null;
        const num = parseFloat(cleaned);
        return isFinite(num) ? num : null;
      };

      const isIndia = Boolean(raw.currency === 'INR' || raw.currency_symbol === '₹' || ticker.endsWith('.NS') || ticker.endsWith('.BO') || ticker === '^NSEI' || ticker === '^BSESN');
      const currency = raw.currency || (isIndia ? 'INR' : 'USD');
      const currencySymbol = raw.currency_symbol || (isIndia ? '₹' : '$');
      const price = parseNum(raw.rawPrice) ?? parseNum(raw.price) ?? 0;
      const prevClose = parseNum(raw.rawPreviousClose) ?? parseNum(raw.previous_close) ?? parseNum(raw.previousClose) ?? price;
      const change = parseNum(raw.rawChange) ?? parseNum(raw.change) ?? (price - prevClose);
      const changePercent = parseNum(raw.rawChangePct) ?? parseNum(raw.change_percent) ?? (prevClose > 0 ? (change / prevClose) * 100 : 0);

      const marketState = String(raw.market_state || raw.marketState || 'UNKNOWN').toUpperCase();
      const isOpen = Boolean(raw.is_market_open != null ? raw.is_market_open : (raw.isMarketOpen != null ? raw.isMarketOpen : (marketState === 'REGULAR' || marketState === 'OPEN')));

      let freshness = raw.quote_freshness || raw.quoteFreshness;
      if (!freshness) {
        freshness = isOpen ? 'LIVE' : 'PREVIOUS_CLOSE';
      }

      return {
        ticker,
        displayName: raw.display_name || raw.displayName || raw.name || ticker,
        assetType: raw.asset_type || raw.assetType || (ticker.startsWith('^') ? 'INDEX' : 'EQUITY'),
        exchange: raw.exchange || (isIndia ? 'NSE' : 'NASDAQ / NYSE'),
        currency,
        currencySymbol,
        timezone: raw.timezone || (isIndia ? 'Asia/Kolkata' : 'America/New_York'),
        exchangeTimezone: raw.exchange_timezone || raw.exchangeTimezone || (isIndia ? 'IST' : 'EST'),
        price: isFinite(price) ? price : 0,
        previousClose: isFinite(prevClose) ? prevClose : price,
        change: isFinite(change) ? change : 0,
        changePercent: isFinite(changePercent) ? changePercent : 0,
        marketState,
        isMarketOpen: isOpen,
        delayStatus: raw.delay_status || raw.delayStatus || (isOpen ? 'REAL_TIME' : 'END_OF_DAY'),
        quoteSource: raw.quote_source || raw.quoteSource || 'UNIFIED_SERVICE',
        quoteFreshness: freshness,
        lastUpdated: raw.last_updated || raw.lastUpdated || new Date().toISOString(),
      };
    }

    // ── Public Store Access & Dispatch ─────────────────────────────────────────
    getQuote(ticker) {
      if (!ticker) return null;
      const key = String(ticker).trim().toUpperCase();
      return this._quotes.get(key) || 
             this._quotes.get(key.replace('.NS', '')) || 
             this._quotes.get(key + '.NS') || 
             null;
    }

    setQuote(ticker, rawQuote) {
      const normalized = this._normalizeQuote(rawQuote);
      if (!normalized) return;

      const key = normalized.ticker;
      this._quotes.set(key, normalized);
      if (rawQuote && rawQuote.symbol && String(rawQuote.symbol).toUpperCase() !== key) {
        this._quotes.set(String(rawQuote.symbol).toUpperCase(), normalized);
      }
      if (rawQuote && rawQuote.ticker && String(rawQuote.ticker).toUpperCase() !== key) {
        this._quotes.set(String(rawQuote.ticker).toUpperCase(), normalized);
      }
      if (key.endsWith('.NS')) {
        this._quotes.set(key.replace('.NS', ''), normalized);
      }

      this._diagnostics.lastSuccessfulUpdate = new Date().toISOString();

      // Dispatch to specific ticker listeners
      const dispatchTargets = [key];
      if (rawQuote && rawQuote.symbol) dispatchTargets.push(String(rawQuote.symbol).toUpperCase());
      if (rawQuote && rawQuote.ticker) dispatchTargets.push(String(rawQuote.ticker).toUpperCase());

      const notified = new Set();
      dispatchTargets.forEach((t) => {
        if (this._subscriptions.has(t)) {
          const componentMap = this._subscriptions.get(t);
          componentMap.forEach((callback, cId) => {
            if (!notified.has(cId)) {
              notified.add(cId);
              try {
                callback(normalized);
                this._diagnostics.totalUpdatesDelivered++;
              } catch (err) {
                console.warn(`[LiveQuoteService] Error in subscriber callback for ${t}:`, err);
              }
            }
          });
        }
      });

      // Dispatch to global listeners
      this._globalSubscriptions.forEach((callback) => {
        try {
          callback(normalized);
        } catch (err) {
          console.warn(`[LiveQuoteService] Error in global subscriber:`, err);
        }
      });
    }

    ingestQuotesBatch(quotesArray) {
      if (!Array.isArray(quotesArray)) return;
      quotesArray.forEach((q) => this.setQuote(q.ticker || q.symbol, q));
    }

    // ── Lifecycle-Safe Subscription API ────────────────────────────────────────
    subscribe(componentId, ticker, callback) {
      if (!componentId || !ticker || typeof callback !== 'function') return () => {};

      const key = String(ticker).trim().toUpperCase();
      if (!this._subscriptions.has(key)) {
        this._subscriptions.set(key, new Map());
      }

      const componentMap = this._subscriptions.get(key);
      componentMap.set(componentId, callback);
      this._updateSubscriptionCounts();

      // Immediately deliver cached quote if available
      const current = this.getQuote(key);
      if (current) {
        try {
          callback(current);
        } catch (e) {}
      }

      // Ensure adaptive polling is running for active subscriptions
      this._startAdaptivePolling();

      // Return cleanup unsubscription function
      return () => this.unsubscribe(componentId, key);
    }

    unsubscribe(componentId, ticker) {
      if (!componentId) return;

      if (ticker) {
        const key = String(ticker).trim().toUpperCase();
        if (this._subscriptions.has(key)) {
          const componentMap = this._subscriptions.get(key);
          componentMap.delete(componentId);
          if (componentMap.size === 0) {
            this._subscriptions.delete(key);
          }
        }
      } else {
        // Unsubscribe component from all tickers
        this._subscriptions.forEach((componentMap, key) => {
          componentMap.delete(componentId);
          if (componentMap.size === 0) {
            this._subscriptions.delete(key);
          }
        });
      }

      this._globalSubscriptions.delete(componentId);
      this._updateSubscriptionCounts();
    }

    subscribeAll(componentId, callback) {
      if (!componentId || typeof callback !== 'function') return () => {};
      this._globalSubscriptions.set(componentId, callback);
      return () => this._globalSubscriptions.delete(componentId);
    }

    _updateSubscriptionCounts() {
      let totalSubscribers = this._globalSubscriptions.size;
      this._subscriptions.forEach((map) => (totalSubscribers += map.size));
      this._diagnostics.activeSubscriptionsCount = totalSubscribers;
      this._diagnostics.activeTickersCount = this._subscriptions.size;
    }

    // ── Asynchronous Network Fetching ──────────────────────────────────────────
    async fetchQuote(ticker) {
      if (!ticker) return null;
      const key = String(ticker).trim().toUpperCase();
      this._diagnostics.lastAttempt = new Date().toISOString();

      try {
        const resp = await fetch(`/api/quote/live?ticker=${encodeURIComponent(key)}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        this.setQuote(key, data);
        return this.getQuote(key);
      } catch (err) {
        this._diagnostics.retryCount++;
        console.warn(`[LiveQuoteService] fetchQuote failed for ${key}:`, err);
        return this.getQuote(key);
      }
    }

    async fetchQuotes(tickersArray) {
      if (!Array.isArray(tickersArray) || tickersArray.length === 0) return {};
      const uniqueTickers = Array.from(new Set(tickersArray.map((t) => String(t).trim().toUpperCase()))).slice(0, POLL_CONFIG.MAX_BATCH_SIZE);
      this._diagnostics.lastAttempt = new Date().toISOString();

      try {
        const resp = await fetch(`/api/quotes/live?tickers=${encodeURIComponent(uniqueTickers.join(','))}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (data && data.quotes) {
          Object.values(data.quotes).forEach((q) => this.setQuote(q.ticker, q));
        }
        return data.quotes || {};
      } catch (err) {
        this._diagnostics.retryCount++;
        console.warn(`[LiveQuoteService] fetchQuotes batch failed:`, err);
        return {};
      }
    }

    // ── Adaptive Polling Heartbeat ─────────────────────────────────────────────
    _startAdaptivePolling() {
      if (this._isPollingActive) return;
      this._isPollingActive = true;
      this._scheduleNextPoll(POLL_CONFIG.LIVE_POLL_INTERVAL);
    }

    _stopPollTimer() {
      if (this._pollTimer) {
        clearTimeout(this._pollTimer);
        this._pollTimer = null;
      }
      this._isPollingActive = false;
    }

    _scheduleNextPoll(delayMs) {
      if (this._pollTimer) clearTimeout(this._pollTimer);
      this._pollTimer = setTimeout(() => this._triggerAdaptivePoll(), delayMs);
    }

    async _triggerAdaptivePoll() {
      if (!this._isTabVisible || !this._isOnline) {
        this._stopPollTimer();
        return;
      }

      const activeTickers = Array.from(this._subscriptions.keys());
      if (activeTickers.length === 0) {
        this._stopPollTimer();
        return;
      }

      await this.fetchQuotes(activeTickers);

      // Determine next polling interval based on market state of active assets
      let anyMarketOpen = false;
      activeTickers.forEach((sym) => {
        const q = this.getQuote(sym);
        if (q && q.isMarketOpen) anyMarketOpen = true;
      });

      const nextInterval = anyMarketOpen ? POLL_CONFIG.LIVE_POLL_INTERVAL : POLL_CONFIG.CLOSED_MARKET_INTERVAL;
      this._scheduleNextPoll(nextInterval);
    }

    // ── Observability & Diagnostics ────────────────────────────────────────────
    getDiagnostics() {
      return {
        ...this._diagnostics,
        isPollingActive: this._isPollingActive,
        isTabVisible: this._isTabVisible,
        isOnline: this._isOnline,
        cachedTickersCount: this._quotes.size,
        subscribedTickers: Array.from(this._subscriptions.keys()),
      };
    }

    // ── Formatting & Display Utilities ─────────────────────────────────────────
    formatPrice(price, currencySymbol = '$') {
      const num = Number(price);
      if (!isFinite(num) || num <= 0) return `${currencySymbol}—`;

      if (currencySymbol === '₹') {
        return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
      return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    formatChange(change, changePercent, currencySymbol = '$') {
      const chg = Number(change || 0);
      const pct = Number(changePercent || 0);
      const isPos = chg >= 0;
      const sign = isPos ? '+' : '';

      const formattedVal = currencySymbol === '₹'
        ? `₹${Math.abs(chg).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `$${Math.abs(chg).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      return {
        isPositive: isPos,
        cssClass: isPos ? 'pos' : 'neg',
        text: `${sign}${formattedVal} (${sign}${pct.toFixed(2)}%)`,
        percentText: `${sign}${pct.toFixed(2)}%`,
      };
    }

    formatMarketBadge(quote) {
      if (!quote) return { badgeHtml: '<span class="status-pill closed">Closed</span>', label: 'Closed' };
      if (quote.isMarketOpen) {
        return {
          badgeHtml: '<span class="status-pill live"><span class="pulse-dot"></span> LIVE</span>',
          label: 'Live',
        };
      }
      const prevPrice = this.formatPrice(quote.previousClose, quote.currencySymbol);
      return {
        badgeHtml: `<span class="status-pill closed" title="Market Closed">Market Closed · Prev Close: ${prevPrice}</span>`,
        label: `Closed (Prev: ${prevPrice})`,
      };
    }
  }

  // Export Singleton to global namespace
  window.LiveQuoteService = new CentralizedLiveQuoteService();
})();
