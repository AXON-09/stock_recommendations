/**
 * QuantView AI — searchService.ts
 * Autocomplete, recent searches, and popular equity/ETF suggestions.
 */

export interface SearchResultItem {
  ticker: string;
  name: string;
  exchange: string;
  type: 'Stock' | 'ETF' | 'Index';
  country: 'India' | 'US';
}

export class SearchService {
  public static search(query: string): SearchResultItem[] { return []; }
}
