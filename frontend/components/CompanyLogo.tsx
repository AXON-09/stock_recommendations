import React, { useState } from 'react';
import { LogoService } from '../services/logoService';

interface CompanyLogoProps {
  ticker: string;
  name?: string;
  isIndia?: boolean;
  isEtf?: boolean;
  size?: number;
  className?: string;
}

export const CompanyLogo: React.FC<CompanyLogoProps> = ({
  ticker,
  name,
  isIndia = false,
  isEtf = false,
  size = 40,
  className = ''
}) => {
  const [loaded, setLoaded] = useState(false);
  const logoUrl = LogoService.getLogo(ticker, isIndia, isEtf);

  return (
    <div
      className={`asset-logo-container flex items-center justify-center overflow-hidden rounded-xl bg-slate-900/80 border border-white/10 p-1 ${className}`}
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      <img
        src={logoUrl}
        alt={name || ticker}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        className={`w-full h-full object-contain rounded-lg transition-all duration-300 ${loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}
      />
    </div>
  );
};
