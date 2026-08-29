/**
 * QuantView AI — logoService.ts
 * Multi-provider company and ETF logo resolver with caching and fallback generators.
 */

export interface LogoInfo {
  ticker: string;
  name: string;
  logoUrl: string;
  isEtf: boolean;
  isIndia: boolean;
  source: 'brand_svg' | 'finnhub' | 'fmp' | 'clearbit' | 'vector_fallback';
}

export class LogoService {
  private static CACHE_KEY = 'QV_LOGO_CACHE_V3';
  private static CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

  public static getLogo(ticker: string, isIndia: boolean = false, isEtf: boolean = false): string {
    const clean = ticker.toUpperCase().replace(/\.(NS|BO|US)$/i, '').trim();
    if (window.QVLogos && window.QVLogos.BRAND_SVGS[clean]) {
      return window.QVLogos.getSvgDataUri(window.QVLogos.BRAND_SVGS[clean]);
    }
    return window.QVLogos ? window.QVLogos.getSvgDataUri(window.QVLogos.generateVectorSvg(clean, isIndia, isEtf)) : '';
  }

  public static getCompanyName(ticker: string, fallback?: string): string {
    return window.QVLogos ? window.QVLogos.getCompanyName(ticker, fallback) : (fallback || ticker);
  }
}
