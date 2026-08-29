import React from 'react';
import { MarketNewsArticle } from '../services/marketauxService';

interface NewsCardProps {
  article: MarketNewsArticle;
  onAnalyzeTicker?: (ticker: string) => void;
}

export const NewsCard: React.FC<NewsCardProps> = ({ article, onAnalyzeTicker }) => {
  return (
    <article className="news-item-card flex flex-col justify-between p-5 rounded-xl bg-slate-900/50 border border-white/10 hover:border-blue-500/40 transition-all duration-200">
      <div>
        <div className="news-meta flex justify-between items-center mb-2 font-mono text-xs text-slate-400">
          <span className="text-blue-400 font-semibold">{article.source}</span>
          <span>{article.publishedAt}</span>
        </div>
        <h4 className="news-headline font-heading font-bold text-slate-100 text-sm md:text-base mb-2 line-clamp-2">
          {article.headline}
        </h4>
        <p className="news-snippet text-slate-300 text-xs md:text-sm line-clamp-3 mb-4">
          {article.summary}
        </p>
      </div>

      <div className="news-bottom-action-row pt-3 border-t border-white/5 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className={`news-badge-sentiment font-mono text-xs px-2 py-0.5 rounded ${article.sentiment === 'bullish' ? 'text-emerald-400 bg-emerald-500/10' : article.sentiment === 'bearish' ? 'text-rose-400 bg-rose-500/10' : 'text-amber-400 bg-amber-500/10'}`}>
            ● {article.sentiment.toUpperCase()}
          </span>
        </div>
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="news-read-more-btn text-xs font-mono text-blue-400 hover:text-blue-300 font-semibold"
        >
          Read Full Story ↗
        </a>
      </div>
    </article>
  );
};
