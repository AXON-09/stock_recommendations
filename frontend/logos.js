/**
 * QuantView AI — logos.js
 * Official company & ETF logo resolver with local caching, lazy loading,
 * smooth fade-in animation, and high-fidelity fintech placeholders.
 */

(function () {
  'use strict';

  const CACHE_KEY = 'QV_FINTECH_LOGO_CACHE_V2';
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  let _memoryCache = null;

  function _loadCache() {
    if (_memoryCache) return _memoryCache;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        _memoryCache = JSON.parse(raw);
        return _memoryCache;
      }
    } catch (e) {
      console.warn('[QuantView Logos] Local storage unavailable:', e);
    }
    _memoryCache = {};
    return _memoryCache;
  }

  function _saveCache() {
    try {
      if (_memoryCache) {
        localStorage.setItem(CACHE_KEY, JSON.stringify(_memoryCache));
      }
    } catch (e) {
      // ignore quota
    }
  }

  function getCachedLogo(ticker) {
    const cache = _loadCache();
    const key = (ticker || '').toUpperCase().trim();
    const entry = cache[key];
    if (entry && (Date.now() - entry.timestamp < CACHE_TTL_MS)) {
      return entry;
    }
    return null;
  }

  function setCachedLogo(ticker, data) {
    const cache = _loadCache();
    const key = (ticker || '').toUpperCase().trim();
    cache[key] = Object.assign({}, data, { timestamp: Date.now() });
    _saveCache();
  }

  const KNOWN_ASSETS = {
    // 🇮🇳 Indian Stocks (NSE/BSE)
    'RELIANCE': {
      name: 'Reliance Industries Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/RELIANCE.NS.webp',
      domain: 'ril.com',
      exchange: 'NSE',
    },
    'TCS': {
      name: 'Tata Consultancy Services',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/TCS.NS.webp',
      domain: 'tcs.com',
      exchange: 'NSE',
    },
    'INFY': {
      name: 'Infosys Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/INFY.webp',
      domain: 'infosys.com',
      exchange: 'NSE',
    },
    'HDFCBANK': {
      name: 'HDFC Bank Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/HDB.webp',
      domain: 'hdfcbank.com',
      exchange: 'NSE',
    },
    'ICICIBANK': {
      name: 'ICICI Bank Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/IBN.webp',
      domain: 'icicibank.com',
      exchange: 'NSE',
    },
    'SBIN': {
      name: 'State Bank of India',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/SBIN.NS.webp',
      domain: 'sbi.co.in',
      exchange: 'NSE',
    },
    'ITC': {
      name: 'ITC Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/ITC.NS.webp',
      domain: 'itcportal.com',
      exchange: 'NSE',
    },
    'BHARTIARTL': {
      name: 'Bharti Airtel Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/BHARTIARTL.NS.webp',
      domain: 'airtel.in',
      exchange: 'NSE',
    },
    'HINDUNILVR': {
      name: 'Hindustan Unilever Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/HINDUNILVR.NS.webp',
      domain: 'hul.co.in',
      exchange: 'NSE',
    },
    'LT': {
      name: 'Larsen & Toubro Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/LT.NS.webp',
      domain: 'larsentoubro.com',
      exchange: 'NSE',
    },
    'BAJFINANCE': {
      name: 'Bajaj Finance Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/BAJFINANCE.NS.webp',
      domain: 'bajajfinserv.in',
      exchange: 'NSE',
    },
    'KOTAKBANK': {
      name: 'Kotak Mahindra Bank',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/KOTAKBANK.NS.webp',
      domain: 'kotak.com',
      exchange: 'NSE',
    },
    'ASIANPAINT': {
      name: 'Asian Paints Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/ASIANPAINT.NS.webp',
      domain: 'asianpaints.com',
      exchange: 'NSE',
    },
    'MARUTI': {
      name: 'Maruti Suzuki India Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/MARUTI.NS.webp',
      domain: 'marutisuzuki.com',
      exchange: 'NSE',
    },
    'TITAN': {
      name: 'Titan Company Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/TITAN.NS.webp',
      domain: 'titancompany.in',
      exchange: 'NSE',
    },
    'TATAMOTORS': {
      name: 'Tata Motors Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/TTM.webp',
      domain: 'tatamotors.com',
      exchange: 'NSE',
    },
    'TATASTEEL': {
      name: 'Tata Steel Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/TATASTEEL.NS.webp',
      domain: 'tatasteel.com',
      exchange: 'NSE',
    },
    'SUNPHARMA': {
      name: 'Sun Pharmaceutical Industries',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/SUNPHARMA.NS.webp',
      domain: 'sunpharma.com',
      exchange: 'NSE',
    },
    'WIPRO': {
      name: 'Wipro Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/WIT.webp',
      domain: 'wipro.com',
      exchange: 'NSE',
    },
    'HCLTECH': {
      name: 'HCL Technologies Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/HCLTECH.NS.webp',
      domain: 'hcltech.com',
      exchange: 'NSE',
    },
    'AXISBANK': {
      name: 'Axis Bank Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/AXISBANK.NS.webp',
      domain: 'axisbank.com',
      exchange: 'NSE',
    },
    'NTPC': {
      name: 'NTPC Limited',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/NTPC.NS.webp',
      domain: 'ntpc.co.in',
      exchange: 'NSE',
    },
    'ONGC': {
      name: 'Oil and Natural Gas Corporation',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/ONGC.NS.webp',
      domain: 'ongcindia.com',
      exchange: 'NSE',
    },
    'POWERGRID': {
      name: 'Power Grid Corporation of India',
      logo: 'https://companiesmarketcap.com/img/company-logos/64/POWERGRID.NS.webp',
      domain: 'powergrid.in',
      exchange: 'NSE',
    },

    // 🇮🇳 Indian ETFs & Funds
    'NIFTYBEES': {
      name: 'Nippon India ETF Nifty BeES',
      logo: 'https://assets.parqet.com/logos/symbol/NIFTYBEES.NS?format=png',
      domain: 'nipponindiamf.com',
      isEtf: true,
      exchange: 'NSE',
    },
    'BANKBEES': {
      name: 'Nippon India ETF Bank BeES',
      logo: 'https://assets.parqet.com/logos/symbol/BANKBEES.NS?format=png',
      domain: 'nipponindiamf.com',
      isEtf: true,
      exchange: 'NSE',
    },
    'GOLDBEES': {
      name: 'Nippon India ETF Gold BeES',
      logo: 'https://assets.parqet.com/logos/symbol/GOLDBEES.NS?format=png',
      domain: 'nipponindiamf.com',
      isEtf: true,
      exchange: 'NSE',
    },
    'SILVERBEES': {
      name: 'Nippon India ETF Silver BeES',
      logo: 'https://assets.parqet.com/logos/symbol/SILVERBEES.NS?format=png',
      domain: 'nipponindiamf.com',
      isEtf: true,
      exchange: 'NSE',
    },
    'JUNIORBEES': {
      name: 'Nippon India ETF Junior BeES',
      logo: 'https://assets.parqet.com/logos/symbol/JUNIORBEES.NS?format=png',
      domain: 'nipponindiamf.com',
      isEtf: true,
      exchange: 'NSE',
    },

    // 🇺🇸 US Stocks (NASDAQ/NYSE)
    'AAPL': {
      name: 'Apple Inc.',
      logo: 'https://assets.parqet.com/logos/symbol/AAPL?format=png',
      domain: 'apple.com',
      exchange: 'NASDAQ',
    },
    'MSFT': {
      name: 'Microsoft Corporation',
      logo: 'https://assets.parqet.com/logos/symbol/MSFT?format=png',
      domain: 'microsoft.com',
      exchange: 'NASDAQ',
    },
    'NVDA': {
      name: 'NVIDIA Corporation',
      logo: 'https://assets.parqet.com/logos/symbol/NVDA?format=png',
      domain: 'nvidia.com',
      exchange: 'NASDAQ',
    },
    'GOOGL': {
      name: 'Alphabet Inc.',
      logo: 'https://assets.parqet.com/logos/symbol/GOOGL?format=png',
      domain: 'abc.xyz',
      exchange: 'NASDAQ',
    },
    'GOOG': {
      name: 'Alphabet Inc.',
      logo: 'https://assets.parqet.com/logos/symbol/GOOG?format=png',
      domain: 'abc.xyz',
      exchange: 'NASDAQ',
    },
    'AMZN': {
      name: 'Amazon.com, Inc.',
      logo: 'https://assets.parqet.com/logos/symbol/AMZN?format=png',
      domain: 'amazon.com',
      exchange: 'NASDAQ',
    },
    'META': {
      name: 'Meta Platforms, Inc.',
      logo: 'https://assets.parqet.com/logos/symbol/META?format=png',
      domain: 'meta.com',
      exchange: 'NASDAQ',
    },
    'TSLA': {
      name: 'Tesla, Inc.',
      logo: 'https://assets.parqet.com/logos/symbol/TSLA?format=png',
      domain: 'tesla.com',
      exchange: 'NASDAQ',
    },
    'AMD': {
      name: 'Advanced Micro Devices, Inc.',
      logo: 'https://assets.parqet.com/logos/symbol/AMD?format=png',
      domain: 'amd.com',
      exchange: 'NASDAQ',
    },
    'NFLX': {
      name: 'Netflix, Inc.',
      logo: 'https://assets.parqet.com/logos/symbol/NFLX?format=png',
      domain: 'netflix.com',
      exchange: 'NASDAQ',
    },
    'INTC': {
      name: 'Intel Corporation',
      logo: 'https://assets.parqet.com/logos/symbol/INTC?format=png',
      domain: 'intel.com',
      exchange: 'NASDAQ',
    },
    'JPM': {
      name: 'JPMorgan Chase & Co.',
      logo: 'https://assets.parqet.com/logos/symbol/JPM?format=png',
      domain: 'jpmorganchase.com',
      exchange: 'NYSE',
    },
    'V': {
      name: 'Visa Inc.',
      logo: 'https://assets.parqet.com/logos/symbol/V?format=png',
      domain: 'visa.com',
      exchange: 'NYSE',
    },
    'DIS': {
      name: 'The Walt Disney Company',
      logo: 'https://assets.parqet.com/logos/symbol/DIS?format=png',
      domain: 'thewaltdisneycompany.com',
      exchange: 'NYSE',
    },

    // 🇺🇸 US ETFs
    'SPY': {
      name: 'SPDR S&P 500 ETF Trust',
      logo: 'https://assets.parqet.com/logos/symbol/SPY?format=png',
      domain: 'ssga.com',
      isEtf: true,
      exchange: 'NYSE Arca',
    },
    'QQQ': {
      name: 'Invesco QQQ Trust',
      logo: 'https://assets.parqet.com/logos/symbol/QQQ?format=png',
      domain: 'invesco.com',
      isEtf: true,
      exchange: 'NASDAQ',
    },
    'VOO': {
      name: 'Vanguard S&P 500 ETF',
      logo: 'https://assets.parqet.com/logos/symbol/VOO?format=png',
      domain: 'vanguard.com',
      isEtf: true,
      exchange: 'NYSE Arca',
    },
    'VTI': {
      name: 'Vanguard Total Stock Market ETF',
      logo: 'https://assets.parqet.com/logos/symbol/VTI?format=png',
      domain: 'vanguard.com',
      isEtf: true,
      exchange: 'NYSE Arca',
    },
    'IWM': {
      name: 'iShares Russell 2000 ETF',
      logo: 'https://assets.parqet.com/logos/symbol/IWM?format=png',
      domain: 'ishares.com',
      isEtf: true,
      exchange: 'NYSE Arca',
    },
    'DIA': {
      name: 'SPDR Dow Jones Industrial Average ETF',
      logo: 'https://assets.parqet.com/logos/symbol/DIA?format=png',
      domain: 'ssga.com',
      isEtf: true,
      exchange: 'NYSE Arca',
    },
    'XLK': {
      name: 'Technology Select Sector SPDR Fund',
      logo: 'https://assets.parqet.com/logos/symbol/XLK?format=png',
      domain: 'ssga.com',
      isEtf: true,
      exchange: 'NYSE Arca',
    },
  };

  function normalizeTicker(ticker) {
    if (!ticker) return '';
    return ticker.toUpperCase().replace(/\.(NS|BO|US)$/i, '').trim();
  }

  function generatePlaceholderSvg(ticker, isIndia, isEtf) {
    const clean = normalizeTicker(ticker);
    const initials = clean.slice(0, 3);
    let g1 = '#3B82F6', g2 = '#1D4ED8', accent = '#60A5FA';
    if (isEtf) {
      g1 = '#8B5CF6'; g2 = '#6D28D9'; accent = '#C4B5FD';
    } else if (isIndia) {
      g1 = '#F97316'; g2 = '#C2410C'; accent = '#FDBA74';
    }

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">' +
      '<defs>' +
      '<linearGradient id="bg-grad-' + clean + '" x1="0%" y1="0%" x2="100%" y2="100%">' +
      '<stop offset="0%" stop-color="' + g1 + '" stop-opacity="0.9" />' +
      '<stop offset="100%" stop-color="' + g2 + '" stop-opacity="0.95" />' +
      '</linearGradient>' +
      '<linearGradient id="glow-grad-' + clean + '" x1="0%" y1="0%" x2="100%" y2="100%">' +
      '<stop offset="0%" stop-color="' + accent + '" stop-opacity="0.6" />' +
      '<stop offset="100%" stop-color="' + g1 + '" stop-opacity="0.1" />' +
      '</linearGradient>' +
      '</defs>' +
      '<rect width="100" height="100" rx="24" fill="url(#bg-grad-' + clean + ')" />' +
      '<rect x="1.5" y="1.5" width="97" height="97" rx="22.5" fill="none" stroke="url(#glow-grad-' + clean + ')" stroke-width="3" />' +
      '<path d="M15 80 Q 35 40, 55 60 T 85 20" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="4" stroke-linecap="round" />' +
      '<text x="50%" y="56%" text-anchor="middle" dominant-baseline="middle" fill="#FFFFFF" font-family="Space Grotesk, system-ui, sans-serif" font-weight="800" font-size="' + (initials.length > 2 ? '30' : '34') + '" letter-spacing="0.5">' +
      initials +
      '</text>' +
      '</svg>';

    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  function getLogoCandidates(ticker, isIndia, isEtf) {
    const clean = normalizeTicker(ticker);
    const raw = (ticker || '').toUpperCase().trim();
    const known = KNOWN_ASSETS[clean];
    const candidates = [];

    if (known && known.logo) {
      candidates.push(known.logo);
    }

    if (isIndia || raw.endsWith('.NS')) {
      candidates.push('https://assets.parqet.com/logos/symbol/' + clean + '.NS?format=png');
      candidates.push('https://companiesmarketcap.com/img/company-logos/64/' + clean + '.NS.webp');
    } else {
      candidates.push('https://assets.parqet.com/logos/symbol/' + clean + '?format=png');
      candidates.push('https://financialmodelingprep.com/image-stock/' + clean + '.png');
      candidates.push('https://companiesmarketcap.com/img/company-logos/64/' + clean + '.webp');
    }

    if (known && known.domain) {
      candidates.push('https://logo.clearbit.com/' + known.domain);
      candidates.push('https://www.google.com/s2/favicons?domain=' + known.domain + '&sz=128');
    }

    candidates.push(generatePlaceholderSvg(ticker, isIndia, isEtf));
    return candidates;
  }

  function getCompanyName(ticker, fallbackName) {
    const clean = normalizeTicker(ticker);
    if (KNOWN_ASSETS[clean] && KNOWN_ASSETS[clean].name) {
      return KNOWN_ASSETS[clean].name;
    }
    if (fallbackName && fallbackName !== '—' && fallbackName !== 'Unknown') {
      return fallbackName;
    }
    return clean;
  }

  function renderLogo(imgEl, ticker, isIndia, isEtf) {
    if (!imgEl) return;
    const clean = normalizeTicker(ticker);
    if (!clean) return;

    imgEl.classList.remove('loaded');
    imgEl.classList.add('loading');
    imgEl.setAttribute('loading', 'lazy');

    const cached = getCachedLogo(clean);
    if (cached && cached.url) {
      imgEl.src = cached.url;
      imgEl.onload = function() {
        imgEl.classList.remove('loading');
        imgEl.classList.add('loaded');
      };
      imgEl.onerror = function() {
        _tryCandidates(imgEl, clean, isIndia, isEtf);
      };
      return;
    }

    _tryCandidates(imgEl, clean, isIndia, isEtf);
  }

  function _tryCandidates(imgEl, clean, isIndia, isEtf) {
    const candidates = getLogoCandidates(clean, isIndia, isEtf);
    let index = 0;

    function tryNext() {
      if (index >= candidates.length) {
        const fallback = generatePlaceholderSvg(clean, isIndia, isEtf);
        imgEl.src = fallback;
        imgEl.classList.remove('loading');
        imgEl.classList.add('loaded');
        setCachedLogo(clean, { url: fallback, isPlaceholder: true });
        return;
      }

      const url = candidates[index++];
      const temp = new Image();
      temp.onload = function() {
        imgEl.src = url;
        imgEl.classList.remove('loading');
        imgEl.classList.add('loaded');
        setCachedLogo(clean, { url: url, isPlaceholder: url.startsWith('data:') });
      };
      temp.onerror = function() {
        tryNext();
      };
      temp.src = url;
    }

    tryNext();
  }

  window.QVLogos = {
    KNOWN_ASSETS: KNOWN_ASSETS,
    normalizeTicker: normalizeTicker,
    getCompanyName: getCompanyName,
    generatePlaceholderSvg: generatePlaceholderSvg,
    getLogoCandidates: getLogoCandidates,
    renderLogo: renderLogo,
  };
})();
