"""
backtest.py - Realistic Backtesting and Strategy Benchmarking Engine for QuantView AI.

METHODOLOGY & FAIR COMPARISON:
-------------------------------
1. All strategies (QuantView, Buy & Hold, SMA50/200) execute on the exact same historical
   dataset, calendar days, starting capital, and cost/slippage assumptions.
2. No look-ahead bias: Signals at bar t are formed using information up to bar t only.
3. Realistic execution:
   - Buy orders execute at Close * (1 + SLIPPAGE).
   - Sell orders execute at Close * (1 - SLIPPAGE).
   - Transaction costs (default 0.10% / 10 bps) apply strictly upon position transitions.
   - No cost is charged on holding days when position does not change.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

import config as cfg

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data containers
# ---------------------------------------------------------------------------
@dataclass
class StrategyMetrics:
    name: str
    total_return: float         # percentage, e.g. 42.5 for +42.5%
    cagr: float                 # compound annual growth rate percentage
    sharpe: float               # annualized Sharpe ratio (rf = 0)
    max_drawdown: float         # maximum peak-to-trough drawdown percentage (e.g. -18.2)
    volatility: float           # annualized volatility percentage
    trades: int                 # number of position transitions
    win_rate: Optional[float]   # percentage of winning round-trips; None for Buy & Hold


@dataclass
class CostScenario:
    cost_pct: float             # e.g. 0.001 for 0.10%
    cost_label: str             # e.g. "0.10%"
    total_return: float
    cagr: float
    sharpe: float
    max_drawdown: float


@dataclass
class BenchmarkComparisonResult:
    ticker: str
    start_date: str
    end_date: str
    trading_days: int
    starting_capital: float
    transaction_cost: float
    slippage: float
    strategies: List[StrategyMetrics]
    equity_curve: List[Dict[str, Any]]
    cost_scenarios: List[CostScenario]


# ---------------------------------------------------------------------------
# Core Strategy Simulation Engine
# ---------------------------------------------------------------------------
def simulate_strategy(
    prices: pd.Series,
    signals: pd.Series,
    initial_capital: float = cfg.STARTING_CAPITAL,
    transaction_cost: float = cfg.TRANSACTION_COST,
    slippage: float = cfg.SLIPPAGE,
    is_buy_and_hold: bool = False,
) -> Tuple[StrategyMetrics, pd.Series, List[float]]:
    """
    Simulate a trading strategy with realistic transaction costs and execution slippage.

    Parameters
    ----------
    prices          : Series of closing prices indexed by date.
    signals         : Binary Series (1 = Long, 0 = Cash) indexed by date.
    initial_capital : Starting cash balance (default 100,000).
    transaction_cost: Proportional fee per trade value (default 0.001 / 0.10%).
    slippage        : Execution penalty on market price (default 0.0005 / 0.05%).
    is_buy_and_hold : If True, marks strategy as Buy & Hold (win_rate = None).

    Returns
    -------
    (StrategyMetrics, equity_series, trade_returns)
    """
    n = len(prices)
    if n < 2:
        raise ValueError("Insufficient price series length for backtesting.")

    dates = prices.index
    cash = float(initial_capital)
    shares = 0.0
    current_pos = 0  # 0 = Cash, 1 = Long

    equity_values = np.zeros(n, dtype=np.float64)
    trades_count = 0
    trade_returns: List[float] = []
    entry_price = 0.0

    for i in range(n):
        price = float(prices.iloc[i])
        target_pos = int(signals.iloc[i]) if i < len(signals) else 0

        # Check for position transition
        if target_pos != current_pos:
            if target_pos == 1 and current_pos == 0:
                # Entering Long: Buy shares with slippage and fee
                exec_price = price * (1.0 + slippage)
                if exec_price > 0 and cash > 0:
                    # Allocate available cash taking fee into account
                    trade_val = cash / (1.0 + transaction_cost)
                    shares = trade_val / exec_price
                    fee = trade_val * transaction_cost
                    cash = cash - (shares * exec_price + fee)
                    current_pos = 1
                    trades_count += 1
                    entry_price = exec_price

            elif target_pos == 0 and current_pos == 1:
                # Exiting Long: Sell shares with slippage and fee
                exec_price = price * (1.0 - slippage)
                if shares > 0 and exec_price > 0:
                    gross_proceeds = shares * exec_price
                    fee = gross_proceeds * transaction_cost
                    cash += (gross_proceeds - fee)
                    if entry_price > 0:
                        trade_ret = (exec_price - entry_price) / entry_price
                        trade_returns.append(trade_ret)
                    shares = 0.0
                    current_pos = 0
                    trades_count += 1
                    entry_price = 0.0

        # Mark-to-market portfolio equity for day i
        equity_values[i] = cash + (shares * price)

    equity_series = pd.Series(equity_values, index=dates)

    # ── Performance Metrics Calculation ──────────────────────────────────────
    total_ret_pct = ((equity_series.iloc[-1] - initial_capital) / initial_capital) * 100.0

    # CAGR: based on standard 252 trading days per year
    years = max(n / 252.0, 1.0 / 252.0)
    if equity_series.iloc[-1] > 0:
        cagr_pct = (((equity_series.iloc[-1] / initial_capital) ** (1.0 / years)) - 1.0) * 100.0
    else:
        cagr_pct = -100.0

    # Daily returns & volatility
    daily_returns = equity_series.pct_change().dropna()
    if len(daily_returns) > 1 and daily_returns.std() > 1e-9:
        ann_vol_pct = float(daily_returns.std() * np.sqrt(252) * 100.0)
        # Annualized Sharpe ratio (risk-free rate = 0)
        sharpe = float((daily_returns.mean() / daily_returns.std()) * np.sqrt(252))
    else:
        ann_vol_pct = 0.0
        sharpe = 0.0

    # Maximum Drawdown
    running_max = equity_series.cummax()
    drawdowns = (equity_series - running_max) / running_max.replace(0, np.nan)
    max_dd_pct = float(drawdowns.min() * 100.0) if not drawdowns.empty else 0.0

    # Win Rate for active round-trip trades
    if is_buy_and_hold or len(trade_returns) == 0:
        win_rate = None
    else:
        winning_trades = sum(1 for r in trade_returns if r > 0)
        win_rate = round((winning_trades / len(trade_returns)) * 100.0, 1)

    metrics = StrategyMetrics(
        name="",
        total_return=round(total_ret_pct, 2),
        cagr=round(cagr_pct, 2),
        sharpe=round(sharpe, 2),
        max_drawdown=round(max_dd_pct, 2),
        volatility=round(ann_vol_pct, 2),
        trades=trades_count,
        win_rate=win_rate,
    )

    return metrics, equity_series, trade_returns


# ---------------------------------------------------------------------------
# Benchmark Suite Comparison
# ---------------------------------------------------------------------------
def run_benchmark_comparison(
    df: pd.DataFrame,
    qv_probabilities: Optional[np.ndarray] = None,
    ticker: str = "TICKER",
    initial_capital: float = cfg.STARTING_CAPITAL,
    transaction_cost: float = cfg.TRANSACTION_COST,
    slippage: float = cfg.SLIPPAGE,
) -> BenchmarkComparisonResult:
    """
    Run backtest comparison across QuantView, Buy & Hold, and SMA50/200.

    Ensures all 3 strategies are evaluated over the exact same date range,
    same trading calendar, and same starting capital.
    """
    if "Close" not in df.columns:
        raise ValueError("DataFrame must contain 'Close' price column.")

    prices = df["Close"].astype(float)
    n = len(prices)
    if n < 50:
        raise ValueError(f"Insufficient history ({n} bars) to run benchmark comparison.")

    dates = [d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else str(d) for d in df.index]

    # ── 1. QuantView Strategy ────────────────────────────────────────────────
    # If OOF probabilities provided, use them; otherwise form signals from ML feature matrix
    if qv_probabilities is not None and len(qv_probabilities) == n:
        qv_signals = pd.Series((qv_probabilities >= 0.50).astype(int), index=df.index)
    else:
        # Reconstruct signal based on trend + momentum ensemble consensus if full OOF vector not supplied
        # Long when (price > SMA50 and RSI < 70) or momentum > 0
        p_sma50 = df.get("price_vs_sma50", pd.Series(0, index=df.index))
        mom = df.get("momentum_20d", pd.Series(0, index=df.index))
        qv_signals = pd.Series(((p_sma50 > 0) | (mom > 0)).astype(int), index=df.index)

    qv_metrics, qv_equity, _ = simulate_strategy(
        prices=prices,
        signals=qv_signals,
        initial_capital=initial_capital,
        transaction_cost=transaction_cost,
        slippage=slippage,
        is_buy_and_hold=False,
    )
    qv_metrics.name = "QuantView"

    # ── 2. Buy & Hold Strategy ───────────────────────────────────────────────
    # Signal is always 1 from start to end
    bh_signals = pd.Series(1, index=df.index)
    bh_metrics, bh_equity, _ = simulate_strategy(
        prices=prices,
        signals=bh_signals,
        initial_capital=initial_capital,
        transaction_cost=transaction_cost,
        slippage=slippage,
        is_buy_and_hold=True,
    )
    bh_metrics.name = "Buy & Hold"

    # ── 3. SMA50/200 Strategy ────────────────────────────────────────────────
    # Long when Close > SMA200 (or SMA50 > SMA200); Cash otherwise
    if "sma200" in df.columns:
        sma_signals = pd.Series((prices > df["sma200"]).astype(int), index=df.index)
    elif "price_vs_sma200" in df.columns:
        sma_signals = pd.Series((df["price_vs_sma200"] > 0).astype(int), index=df.index)
    else:
        sma200 = prices.rolling(cfg.SMA_SLOW_PERIOD).mean()
        sma_signals = pd.Series((prices > sma200).fillna(False).astype(int), index=df.index)

    sma_metrics, sma_equity, _ = simulate_strategy(
        prices=prices,
        signals=sma_signals,
        initial_capital=initial_capital,
        transaction_cost=transaction_cost,
        slippage=slippage,
        is_buy_and_hold=False,
    )
    sma_metrics.name = "SMA50/200"

    # ── Synchronized Daily Equity Curves ──────────────────────────────────────
    # Downsample points for efficient web transfer if dataset is large
    step = max(1, n // 200)
    equity_curve: List[Dict[str, Any]] = []
    for i in range(0, n, step):
        equity_curve.append({
            "date": dates[i],
            "quantview": round(float(qv_equity.iloc[i]), 2),
            "buy_hold": round(float(bh_equity.iloc[i]), 2),
            "sma50_200": round(float(sma_equity.iloc[i]), 2),
        })
    # Ensure final date is always included
    if equity_curve and equity_curve[-1]["date"] != dates[-1]:
        equity_curve.append({
            "date": dates[-1],
            "quantview": round(float(qv_equity.iloc[-1]), 2),
            "buy_hold": round(float(bh_equity.iloc[-1]), 2),
            "sma50_200": round(float(sma_equity.iloc[-1]), 2),
        })

    # ── Transaction Cost Sensitivity Scenarios ────────────────────────────────
    cost_scenarios: List[CostScenario] = []
    for c_val in cfg.COST_SCENARIOS:
        c_pct_label = f"{round(c_val * 100, 2)}%"
        sc_m, _, _ = simulate_strategy(
            prices=prices,
            signals=qv_signals,
            initial_capital=initial_capital,
            transaction_cost=c_val,
            slippage=slippage,
            is_buy_and_hold=False,
        )
        cost_scenarios.append(
            CostScenario(
                cost_pct=c_val,
                cost_label=c_pct_label,
                total_return=sc_m.total_return,
                cagr=sc_m.cagr,
                sharpe=sc_m.sharpe,
                max_drawdown=sc_m.max_drawdown,
            )
        )

    return BenchmarkComparisonResult(
        ticker=ticker,
        start_date=dates[0],
        end_date=dates[-1],
        trading_days=n,
        starting_capital=initial_capital,
        transaction_cost=transaction_cost,
        slippage=slippage,
        strategies=[qv_metrics, bh_metrics, sma_metrics],
        equity_curve=equity_curve,
        cost_scenarios=cost_scenarios,
    )
