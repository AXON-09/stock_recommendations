/**
 * QuantView AI — logoService.js
 */
(function(window) {
  'use strict';
  window.LogoService = {
    getLogo: function(ticker, isIndia, isEtf) {
      if (!ticker) return '';
      var clean = ticker.toUpperCase().replace(/\.(NS|BO|US)$/i, '').trim();
      if (window.QVLogos && window.QVLogos.BRAND_SVGS && window.QVLogos.BRAND_SVGS[clean]) {
        return window.QVLogos.getSvgDataUri(window.QVLogos.BRAND_SVGS[clean]);
      }
      return window.QVLogos ? window.QVLogos.getSvgDataUri(window.QVLogos.generateVectorSvg(clean, isIndia, isEtf)) : '';
    },
    getCompanyName: function(ticker, fallback) {
      return window.QVLogos ? window.QVLogos.getCompanyName(ticker, fallback) : (fallback || ticker);
    }
  };
})(window);
