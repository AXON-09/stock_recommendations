import React from 'react';
import { WatchlistItem } from '../services/watchlistService';
import { CompanyLogo } from './CompanyLogo';

interface WatchlistRowProps {
  item: WatchlistItem;
  onAnalyze: (ticker: string) => void;
}

export const WatchlistRow: React.FC<WatchlistRowProps> = ({ item, onAnalyze }) => {
  return (
    <tr className="wl-row hover:bg-white/[0.02] transition-colors duration-150 border-b border-white/5">
      <td className="py-3 px-4">
        <div className="flex items-center gap-3">
          <CompanyLogo ticker={item.ticker} size={36} isIndia={item.exchange === 'NSE'} />
          <div>
            <strong className="block text-slate-100 text-sm">{item.name}</strong>
            <span className="font-mono text-xs text-slate-400">{item.exchange} · {item.ticker}</span>
          </div>
        </div>
      </td>
      <td className="py-3 px-4 font-mono text-xs text-slate-300">{item.exchange}</td>
      <td className="py-3 px-4 font-mono font-semibold text-slate-100">{item.price}</td>
      <td className="py-3 px-4">
        <span className={`font-mono text-xs font-semibold ${item.changePos ? 'text-emerald-400' : 'text-rose-400'}`}>
          {item.change}
        </span>
      </td>
      <td className="py-3 px-4">
        <button
          onClick={() => onAnalyze(item.ticker)}
          className="qp-btn px-3 py-1.5 rounded font-mono text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500 hover:text-white transition-all duration-150"
        >
          Analyze →
        </button>
      </td>
    </tr>
  );
};
