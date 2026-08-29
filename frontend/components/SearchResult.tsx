import React from 'react';
import { SearchResultItem } from '../services/searchService';
import { CompanyLogo } from './CompanyLogo';

interface SearchResultProps {
  item: SearchResultItem;
  onSelect: (ticker: string) => void;
}

export const SearchResult: React.FC<SearchResultProps> = ({ item, onSelect }) => {
  return (
    <div
      onClick={() => onSelect(item.ticker)}
      className="search-auto-row flex justify-between items-center p-2.5 rounded-lg cursor-pointer hover:bg-blue-500/15 transition-all duration-150"
    >
      <div className="flex items-center gap-3">
        <CompanyLogo ticker={item.ticker} size={28} isIndia={item.country === 'India'} isEtf={item.type === 'ETF'} />
        <div>
          <div className="text-sm font-semibold text-slate-100">
            <span className="text-blue-400 font-mono mr-2">{item.ticker}</span>
            <span className="text-slate-300 font-normal">{item.name}</span>
          </div>
          <div className="font-mono text-xs text-slate-400">
            {item.country === 'India' ? '🇮🇳 India' : '🇺🇸 US'} · {item.exchange} · <span className="bg-white/5 px-1 rounded">{item.type}</span>
          </div>
        </div>
      </div>
      <span className="text-blue-400 font-mono text-xs">→</span>
    </div>
  );
};
