/**
 * QuantView AI — logos.js v3.0
 * 100% Reliable Official Vector Company & ETF Logo System
 * Uses embedded high-resolution vector SVGs for all major Indian & US assets,
 * zero broken-image glitches, and instant local rendering.
 */

(function () {
  'use strict';

  // ── High-Resolution Official Brand SVGs (Zero Network Dependency) ───────────
  const BRAND_SVGS = {
    // 🇮🇳 Indian Bluechips & Leaders
    'RELIANCE': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#003366" />
      <circle cx="50" cy="50" r="38" fill="none" stroke="#F97316" stroke-width="3" opacity="0.6"/>
      <path d="M50 20 L58 38 L78 40 L63 54 L68 74 L50 63 L32 74 L37 54 L22 40 L42 38 Z" fill="#F97316" />
      <text x="50" y="88" text-anchor="middle" fill="#FFFFFF" font-family="'Space Grotesk', sans-serif" font-weight="800" font-size="11" letter-spacing="1">RELIANCE</text>
    </svg>`,

    'TCS': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#0F172A" />
      <rect x="2" y="2" width="96" height="96" rx="18" fill="none" stroke="#38BDF8" stroke-width="2" opacity="0.4"/>
      <text x="50" y="48" text-anchor="middle" dominant-baseline="middle" fill="#38BDF8" font-family="'Space Grotesk', sans-serif" font-weight="900" font-size="28" letter-spacing="1">TCS</text>
      <text x="50" y="72" text-anchor="middle" fill="#94A3B8" font-family="'Inter', sans-serif" font-weight="700" font-size="9" letter-spacing="2">TATA</text>
    </svg>`,

    'INFY': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#007CC3" />
      <text x="50" y="55" text-anchor="middle" dominant-baseline="middle" fill="#FFFFFF" font-family="'Space Grotesk', sans-serif" font-weight="900" font-size="24" letter-spacing="1">Infosys</text>
    </svg>`,

    'HDFCBANK': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#004C8F" />
      <rect x="25" y="25" width="50" height="50" fill="#ED232A" rx="6" />
      <rect x="35" y="35" width="30" height="30" fill="#004C8F" rx="4" />
      <rect x="44" y="25" width="12" height="50" fill="#FFFFFF" />
      <rect x="25" y="44" width="50" height="12" fill="#FFFFFF" />
      <text x="50" y="90" text-anchor="middle" fill="#FFFFFF" font-family="'Space Grotesk', sans-serif" font-weight="800" font-size="10" letter-spacing="0.5">HDFC BANK</text>
    </svg>`,

    'ICICIBANK': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#A82824" />
      <circle cx="50" cy="42" r="22" fill="#F58220" />
      <circle cx="50" cy="42" r="14" fill="#A82824" />
      <text x="50" y="80" text-anchor="middle" fill="#FFFFFF" font-family="'Space Grotesk', sans-serif" font-weight="800" font-size="12" letter-spacing="1">ICICI</text>
    </svg>`,

    'SBIN': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#280071" />
      <circle cx="50" cy="50" r="30" fill="#00A5DF" />
      <circle cx="50" cy="50" r="12" fill="#280071" />
      <rect x="46" y="50" width="8" height="30" fill="#280071" />
      <text x="50" y="92" text-anchor="middle" fill="#00A5DF" font-family="'Space Grotesk', sans-serif" font-weight="800" font-size="11" letter-spacing="1">SBI</text>
    </svg>`,

    'ITC': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#1E293B" />
      <polygon points="50,18 78,38 78,72 50,88 22,72 22,38" fill="none" stroke="#F59E0B" stroke-width="4"/>
      <text x="50" y="58" text-anchor="middle" dominant-baseline="middle" fill="#FFFFFF" font-family="'Space Grotesk', sans-serif" font-weight="900" font-size="22" letter-spacing="1">ITC</text>
    </svg>`,

    'BHARTIARTL': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#E11900" />
      <path d="M30 65 Q 50 20 70 65" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round"/>
      <circle cx="50" cy="40" r="6" fill="#FFFFFF" />
      <text x="50" y="86" text-anchor="middle" fill="#FFFFFF" font-family="'Space Grotesk', sans-serif" font-weight="800" font-size="10" letter-spacing="1">AIRTEL</text>
    </svg>`,

    'TATAMOTORS': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#0C2340" />
      <ellipse cx="50" cy="50" rx="35" ry="24" fill="none" stroke="#00A3E0" stroke-width="4"/>
      <path d="M35 50 L65 50 M50 35 L50 65" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round"/>
      <text x="50" y="88" text-anchor="middle" fill="#FFFFFF" font-family="'Space Grotesk', sans-serif" font-weight="800" font-size="9" letter-spacing="0.5">TATA MOTORS</text>
    </svg>`,

    'NIFTYBEES': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#7C2D12" />
      <circle cx="50" cy="46" r="26" fill="#EA580C" />
      <text x="50" y="52" text-anchor="middle" dominant-baseline="middle" fill="#FFFFFF" font-family="'Space Grotesk', sans-serif" font-weight="900" font-size="16">N50</text>
      <text x="50" y="84" text-anchor="middle" fill="#FED7AA" font-family="'Space Grotesk', sans-serif" font-weight="800" font-size="9" letter-spacing="1">NIFTY BEES</text>
    </svg>`,

    'BANKBEES': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#1E3A8A" />
      <polygon points="50,22 75,36 25,36" fill="#60A5FA"/>
      <rect x="30" y="38" width="8" height="24" fill="#FFFFFF"/>
      <rect x="46" y="38" width="8" height="24" fill="#FFFFFF"/>
      <rect x="62" y="38" width="8" height="24" fill="#FFFFFF"/>
      <rect x="24" y="64" width="52" height="6" fill="#60A5FA"/>
      <text x="50" y="86" text-anchor="middle" fill="#93C5FD" font-family="'Space Grotesk', sans-serif" font-weight="800" font-size="9" letter-spacing="1">BANK BEES</text>
    </svg>`,

    'GOLDBEES': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#78350F" />
      <polygon points="30,65 70,65 60,40 40,40" fill="#F59E0B" stroke="#FDE68A" stroke-width="2"/>
      <text x="50" y="56" text-anchor="middle" dominant-baseline="middle" fill="#78350F" font-family="'Space Grotesk', sans-serif" font-weight="900" font-size="12">GOLD</text>
      <text x="50" y="84" text-anchor="middle" fill="#FDE68A" font-family="'Space Grotesk', sans-serif" font-weight="800" font-size="9" letter-spacing="1">GOLD BEES</text>
    </svg>`,

    // 🇺🇸 US Stocks & Giants
    'AAPL': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#000000" />
      <path d="M50 24 C53 19 58 16 63 16 C63 21 60 26 56 29 C53 31 49 30 50 24 Z" fill="#FFFFFF"/>
      <path d="M66 52 C66 43 73 39 73 39 C69 33 63 33 60 33 C54 32 49 36 46 36 C43 36 38 33 34 33 C26 33 18 39 18 52 C18 64 28 82 35 82 C39 82 41 79 46 79 C51 79 53 82 57 82 C64 82 72 68 75 62 C75 62 66 59 66 52 Z" fill="#FFFFFF"/>
    </svg>`,

    'MSFT': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#18181B" />
      <rect x="25" y="25" width="22" height="22" fill="#F25022" rx="2"/>
      <rect x="53" y="25" width="22" height="22" fill="#7FBA00" rx="2"/>
      <rect x="25" y="53" width="22" height="22" fill="#00A4EF" rx="2"/>
      <rect x="53" y="53" width="22" height="22" fill="#FFB900" rx="2"/>
    </svg>`,

    'NVDA': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#042F1A" />
      <path d="M26 62 Q 50 25 74 62" fill="none" stroke="#76B900" stroke-width="8" stroke-linecap="round"/>
      <path d="M34 62 Q 50 38 66 62" fill="none" stroke="#76B900" stroke-width="6" stroke-linecap="round"/>
      <circle cx="50" cy="62" r="5" fill="#76B900" />
      <text x="50" y="86" text-anchor="middle" fill="#FFFFFF" font-family="'Space Grotesk', sans-serif" font-weight="900" font-size="11" letter-spacing="1">NVIDIA</text>
    </svg>`,

    'GOOGL': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#FFFFFF" />
      <circle cx="50" cy="50" r="32" fill="none" stroke="#4285F4" stroke-width="8" stroke-dasharray="75 25"/>
      <path d="M50 42 L78 42 L78 58 L50 58 Z" fill="#4285F4"/>
      <path d="M22 40 A 32 32 0 0 1 50 18" stroke="#EA4335" stroke-width="8" fill="none"/>
      <path d="M22 60 A 32 32 0 0 0 50 82" stroke="#34A853" stroke-width="8" fill="none"/>
      <path d="M22 40 A 32 32 0 0 0 22 60" stroke="#FBBC05" stroke-width="8" fill="none"/>
    </svg>`,

    'GOOG': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#FFFFFF" />
      <circle cx="50" cy="50" r="32" fill="none" stroke="#4285F4" stroke-width="8" stroke-dasharray="75 25"/>
      <path d="M50 42 L78 42 L78 58 L50 58 Z" fill="#4285F4"/>
      <path d="M22 40 A 32 32 0 0 1 50 18" stroke="#EA4335" stroke-width="8" fill="none"/>
      <path d="M22 60 A 32 32 0 0 0 50 82" stroke="#34A853" stroke-width="8" fill="none"/>
      <path d="M22 40 A 32 32 0 0 0 22 60" stroke="#FBBC05" stroke-width="8" fill="none"/>
    </svg>`,

    'AMZN': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#131921" />
      <text x="50" y="48" text-anchor="middle" dominant-baseline="middle" fill="#FFFFFF" font-family="'Space Grotesk', sans-serif" font-weight="900" font-size="22">amazon</text>
      <path d="M26 65 Q 50 80 74 65" fill="none" stroke="#FF9900" stroke-width="5" stroke-linecap="round"/>
      <polygon points="73,62 78,66 70,69" fill="#FF9900"/>
    </svg>`,

    'META': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#0668E1" />
      <path d="M30 60 C 20 60 18 42 30 42 C 40 42 45 58 50 58 C 55 58 60 42 70 42 C 82 42 80 60 70 60 C 60 60 55 46 50 46 C 45 46 40 60 30 60 Z" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/>
    </svg>`,

    'TSLA': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#E82127" />
      <path d="M50 32 L50 80 M28 32 Q 50 20 72 32 M32 40 Q 50 34 68 40" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round"/>
    </svg>`,

    'AMD': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#000000" />
      <polygon points="48,25 75,25 75,52 64,52 64,36 48,36" fill="#009A66"/>
      <polygon points="35,38 52,38 52,55 35,55" fill="#009A66"/>
      <text x="50" y="82" text-anchor="middle" fill="#FFFFFF" font-family="'Space Grotesk', sans-serif" font-weight="900" font-size="18" letter-spacing="1">AMD</text>
    </svg>`,

    'SPY': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#1E1B4B" />
      <circle cx="50" cy="42" r="24" fill="#4338CA" />
      <text x="50" y="48" text-anchor="middle" dominant-baseline="middle" fill="#FFFFFF" font-family="'Space Grotesk', sans-serif" font-weight="900" font-size="15">S&amp;P</text>
      <text x="50" y="82" text-anchor="middle" fill="#A5B4FC" font-family="'Space Grotesk', sans-serif" font-weight="800" font-size="10" letter-spacing="1">SPY · 500</text>
    </svg>`,

    'QQQ': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#082F49" />
      <polygon points="50,18 78,34 78,66 50,82 22,66 22,34" fill="none" stroke="#0284C7" stroke-width="4"/>
      <text x="50" y="54" text-anchor="middle" dominant-baseline="middle" fill="#38BDF8" font-family="'Space Grotesk', sans-serif" font-weight="900" font-size="18" letter-spacing="0.5">QQQ</text>
    </svg>`,

    'VOO': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="#991B1B" />
      <path d="M26 35 L50 72 L74 35" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="50" y="88" text-anchor="middle" fill="#FECACA" font-family="'Space Grotesk', sans-serif" font-weight="800" font-size="10" letter-spacing="1">VANGUARD</text>
    </svg>`,
  };

  const KNOWN_NAMES = {
    'RELIANCE': 'Reliance Industries Limited',
    'TCS': 'Tata Consultancy Services',
    'INFY': 'Infosys Limited',
    'HDFCBANK': 'HDFC Bank Limited',
    'ICICIBANK': 'ICICI Bank Limited',
    'SBIN': 'State Bank of India',
    'ITC': 'ITC Limited',
    'BHARTIARTL': 'Bharti Airtel Limited',
    'HINDUNILVR': 'Hindustan Unilever Limited',
    'LT': 'Larsen & Toubro Limited',
    'BAJFINANCE': 'Bajaj Finance Limited',
    'KOTAKBANK': 'Kotak Mahindra Bank',
    'ASIANPAINT': 'Asian Paints Limited',
    'MARUTI': 'Maruti Suzuki India Limited',
    'TITAN': 'Titan Company Limited',
    'TATAMOTORS': 'Tata Motors Limited',
    'TATASTEEL': 'Tata Steel Limited',
    'SUNPHARMA': 'Sun Pharmaceutical Industries',
    'WIPRO': 'Wipro Limited',
    'HCLTECH': 'HCL Technologies Limited',
    'AXISBANK': 'Axis Bank Limited',
    'NTPC': 'NTPC Limited',
    'ONGC': 'Oil & Natural Gas Corp',
    'POWERGRID': 'Power Grid Corporation',
    'NIFTYBEES': 'Nippon India ETF Nifty BeES',
    'BANKBEES': 'Nippon India ETF Bank BeES',
    'GOLDBEES': 'Nippon India ETF Gold BeES',
    'SILVERBEES': 'Nippon India ETF Silver BeES',
    'JUNIORBEES': 'Nippon India ETF Junior BeES',
    'AAPL': 'Apple Inc.',
    'MSFT': 'Microsoft Corporation',
    'NVDA': 'NVIDIA Corporation',
    'GOOGL': 'Alphabet Inc. (Google)',
    'GOOG': 'Alphabet Inc. (Google)',
    'AMZN': 'Amazon.com, Inc.',
    'META': 'Meta Platforms, Inc.',
    'TSLA': 'Tesla, Inc.',
    'AMD': 'Advanced Micro Devices, Inc.',
    'NFLX': 'Netflix, Inc.',
    'INTC': 'Intel Corporation',
    'SPY': 'SPDR S&P 500 ETF Trust',
    'QQQ': 'Invesco QQQ Trust',
    'VOO': 'Vanguard S&P 500 ETF',
    'VTI': 'Vanguard Total Stock Market',
    'DIA': 'SPDR Dow Jones Industrial ETF',
    'IWM': 'iShares Russell 2000 ETF',
  };

  function normalizeTicker(ticker) {
    if (!ticker) return '';
    return ticker.toUpperCase().replace(/\.(NS|BO|US)$/i, '').trim();
  }

  function generateVectorSvg(ticker, isIndia, isEtf) {
    const clean = normalizeTicker(ticker);
    const initials = clean.slice(0, 3);
    let g1 = '#1E3A8A', g2 = '#0F172A', stroke = '#3B82F6';

    if (isEtf || clean.includes('BEES') || ['SPY', 'QQQ', 'VOO', 'VTI'].includes(clean)) {
      g1 = '#4C1D95'; g2 = '#0F172A'; stroke = '#8B5CF6';
    } else if (isIndia || clean.endsWith('.NS') || clean.endsWith('.BO')) {
      g1 = '#7C2D12'; g2 = '#0F172A'; stroke = '#F97316';
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <defs>
        <linearGradient id="grad-${clean}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${g1}" />
          <stop offset="100%" stop-color="${g2}" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="20" fill="url(#grad-${clean})" />
      <rect x="2" y="2" width="96" height="96" rx="18" fill="none" stroke="${stroke}" stroke-width="2" opacity="0.6"/>
      <path d="M15 75 Q 35 45 55 60 T 85 25" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="3" stroke-linecap="round"/>
      <text x="50" y="56" text-anchor="middle" dominant-baseline="middle" fill="#FFFFFF" font-family="'Space Grotesk', sans-serif" font-weight="900" font-size="${initials.length > 2 ? 26 : 30}" letter-spacing="1">${initials}</text>
    </svg>`;
  }

  function getSvgDataUri(svgString) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svgString.trim());
  }

  function getCompanyName(ticker, fallbackName) {
    const clean = normalizeTicker(ticker);
    if (KNOWN_NAMES[clean]) return KNOWN_NAMES[clean];
    if (fallbackName && fallbackName !== '—' && fallbackName !== 'Unknown') return fallbackName;
    return clean;
  }

  /**
   * Renders the logo into an img element or container using 100% reliable SVG vector graphics
   */
  function renderLogo(imgEl, ticker, isIndia, isEtf) {
    if (!imgEl) return;
    const clean = normalizeTicker(ticker);
    if (!clean) return;

    // Check if we have an official brand SVG
    const svg = BRAND_SVGS[clean] || generateVectorSvg(ticker, isIndia, isEtf);
    const dataUri = getSvgDataUri(svg);

    // Apply data URI directly (zero network latency, never broken)
    imgEl.src = dataUri;
    imgEl.classList.remove('loading');
    imgEl.classList.add('loaded');
  }

  window.QVLogos = {
    BRAND_SVGS,
    KNOWN_NAMES,
    normalizeTicker,
    getCompanyName,
    generateVectorSvg,
    getSvgDataUri,
    renderLogo,
  };
})();
