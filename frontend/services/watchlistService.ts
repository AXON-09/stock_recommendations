/**
 * QuantView AI — watchlistService.ts
 * Persistent live watchlist with add, remove, favorite, and drag-and-drop support.
 */

export interface WatchlistItem {
  ticker: string;
  name: string;
  exchange: string;
  price: string;
  change: string;
  changePos: boolean;
  volumeRatio: string;
  aiRating: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell';
  isFavorite?: boolean;
  addedAt: number;
}

export class WatchlistService {
  private static STORAGE_KEY = 'QV_LIVE_WATCHLIST_V1';

  public static getWatchlist(): WatchlistItem[] {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {}
    return [];
  }

  public static saveWatchlist(items: WatchlistItem[]): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(items));
    } catch (e) {}
  }
}
