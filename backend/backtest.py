"""
backtest.py - Realistic Backtesting and Strategy Benchmarking Engine for QuantView AI.

METHODOLOGY & EXECUTION TIMING MODEL:
------------------------------------
1. All strategies (QuantView, Buy & Hold, SMA50/200) execute on the exact same historical
   dataset, calendar days, starting capital, and cost/slippage parameters.
2. Next-Bar Execution (No Look-Ahead Bias):
   - Signal at bar t is generated using information available through Close[t].
   - Trade execution for Signal[t] occurs on Bar t+1 at Open[t+1] (or Close[t+1] if Open is unavailable).
   - Buy orders execute at Open[t+1] * (1 + SLIPPAGE).
   - Sell orders execute at Open[t+1] * (1 - SLIPPAGE).
   - Transaction fee (default 0.10% / 10 bps) applies strictly upon position transitions.
   - Holding days with no position change incur zero transaction costs.
   - End-of-day portfolio equity is marked to market at Close[t+1].
   - Final bar (N-1): Signal[N-1] generated at Close[N-1] is not executed as there is no Bar N;
     existing positions are marked to market at Close[N-1].
3. QuantView Strategy Authenticity:
   - QuantView uses genuine Out-Of-Fold (OOF) predicted probabilities from walk-forward validation.
   - If OOF predictions are unavailable, benchmark comparison raises an explicit error rather
     than masquerading a simplistic technical indicator as QuantView.
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
    max_drawdown: float         # maximum peak-to-trough drawdown percentage (strictly <= 0.0)
    volatility: float           # annualized volatility percentage (strictly >= 0.0)
    trades: int                 # number of position transitions
    win_rate: Optional[float]   # percentage of winning round-trips; None for Buy & Hold or 0 trades


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
    open_prices: Optional[pd.Series] = None,
    initial_capital: float = cfg.STARTING_CAPITAL,
    transaction_cost: float = cfg.TRANSACTION_COST,
    slippage: float = cfg.SLIPPAGE,
    is_buy_and_hold: bool = False,
) -> Tuple[StrategyMetrics, pd.Series, List[float]]:
    """
    Simulate a trading strategy with realistic execution timing, costs, and slippage.

    Parameters
    ----------
    prices          : Series of closing prices indexed by date (used for signal gen & mark-to-market).
    signals         : Binary Series (1 = Long, 0 = Cash) generated at bar t.
    open_prices     : Series of open prices for bar t+1 execution (falls back to prices if None).
    initial_capital : Starting cash balance (default 100,000).
    transaction_cost: Proportional fee per trade value (default 0.001 / 0.10%).
    slippage        : Execution penalty on market price (default 0.0005 / 0.05%).
    is_buy_and_hold : If True, executes single buy on Day 0 and holds to end.

    Returns
    -------
    (StrategyMetrics, equity_series, trade_returns)
    """
    n = len(prices)
    if n < 2:
        raise ValueError("Insufficient price series length for backtesting (need at least 2 bars).")

    if open_prices is None:
        open_prices = prices

    dates = prices.index
    cash = float(initial_capital)
    shares = 0.0
    current_pos = 0  # 0 = Cash, 1 = Long

    equity_values = np.zeros(n, dtype=np.float64)
    trades_count = 0
    trade_returns: List[float] = []
    entry_price = 0.0

    if is_buy_and_hold:
        # Buy & Hold: Enters on Day 0 at Open[0] * (1 + slippage) and holds
        exec_p0 = float(open_prices.iloc[0]) * (1.0 + slippage)
        if exec_p0 > 0 and cash > 0:
            trade_val = cash / (1.0 + transaction_cost)
            shares = trade_val / exec_p0
            fee = trade_val * transaction_cost
            cash = cash - (shares * exec_p0 + fee)
            current_pos = 1
            trades_count = 1
            entry_price = exec_p0

        equity_values[0] = cash + (shares * float(prices.iloc[0]))
        for i in range(1, n):
            equity_values[i] = cash + (shares * float(prices.iloc[i]))

    else:
        # Active Strategy: Signal[t] generated at Close[t] -> Executed at Open[t+1]
        equity_values[0] = cash
        pending_target = int(signals.iloc[0]) if len(signals) > 0 else 0

        for i in range(1, n):
            today_open = float(open_prices.iloc[i])
            close_price = float(prices.iloc[i])

            # Execute pending signal from previous bar at today's Open
            if pending_target != current_pos:
                if pending_target == 1 and current_pos == 0:
                    # Entering Long: Buy at Open[i] * (1 + slippage)
                    exec_price = today_open * (1.0 + slippage)
                    if exec_price > 0 and cash > 0:
                        trade_val = cash / (1.0 + transaction_cost)
                        shares = trade_val / exec_price
                        fee = trade_val * transaction_cost
                        cash = cash - (shares * exec_price + fee)
                        current_pos = 1
                        trades_count += 1
                        entry_price = exec_price

                elif pending_target == 0 and current_pos == 1:
                    # Exiting Long: Sell at Open[i] * (1 - slippage)
                    exec_price = today_open * (1.0 - slippage)
                    if shares > 0 and exec_price > 0:
                        gross_proceeds = shares * exec_price
                        fee = gross_proceeds * transaction_cost
                        cash += (gross_proceeds - fee)
                        if entry_price > 0:
                            net_exit = exec_price * (1.0 - transaction_cost)
                            net_entry = entry_price * (1.0 + transaction_cost)
                            trade_ret = (net_exit - net_entry) / net_entry
                            trade_returns.append(trade_ret)
                        shares = 0.0
                        current_pos = 0
                        trades_count += 1
                        entry_price = 0.0

            # Mark-to-market equity at today's Close
            equity_values[i] = cash + (shares * close_price)

            # Generate today's signal from today's Close for tomorrow's execution
            pending_target = int(signals.iloc[i]) if i < len(signals) else 0

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

    # Maximum Drawdown (strictly <= 0.0)
    running_max = equity_series.cummax()
    drawdowns = (equity_series - running_max) / running_max.replace(0, np.nan)
    max_dd_pct = float(drawdowns.min() * 100.0) if not drawdowns.empty else 0.0
    if max_dd_pct > 0.0:
        max_dd_pct = 0.0

    # Win Rate calculation
    if is_buy_and_hold:
        win_rate = None
    else:
        all_eval_trades = list(trade_returns)
        if current_pos == 1 and entry_price > 0:
            open_trade_ret = (float(prices.iloc[-1]) - entry_price) / entry_price
            all_eval_trades.append(open_trade_ret)

        if len(all_eval_trades) > 0:
            winning_trades = sum(1 for r in all_eval_trades if r > 0)
            win_rate = round((winning_trades / len(all_eval_trades)) * 100.0, 1)
        else:
            win_rate = None

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


def generate_hysteresis_signals(
    probabilities: np.ndarray,
    prices: pd.Series,
    sma200: Optional[pd.Series] = None,
    base_buy_thresh: float = 0.50,
    base_sell_thresh: float = 0.44,
    bear_buy_thresh: float = 0.54,
    bear_sell_thresh: float = 0.48,
) -> pd.Series:
    """
    Generate trade execution signals using an institutional Hysteresis Band & Trend-Aware Filter.
    Eliminates noise churn around 0.50 and preserves secular bull runs.
    """
    n = len(probabilities)
    signals_arr = np.zeros(n, dtype=int)
    current_pos = 0

    has_sma = sma200 is not None and len(sma200) == n

    for i in range(n):
        p = float(probabilities[i])
        px = float(prices.iloc[i])

        above_trend = True
        if has_sma and pd.notna(sma200.iloc[i]):
            above_trend = px >= float(sma200.iloc[i])

        buy_thresh = base_buy_thresh if above_trend else bear_buy_thresh
        sell_thresh = base_sell_thresh if above_trend else bear_sell_thresh

        if current_pos == 0 and p >= buy_thresh:
            current_pos = 1
        elif current_pos == 1 and p < sell_thresh:
            current_pos = 0

        signals_arr[i] = current_pos

    return pd.Series(signals_arr, index=prices.index)


# ---------------------------------------------------------------------------
# Benchmark Suite Comparison
# ---------------------------------------------------------------------------
def run_benchmark_comparison(
    df: pd.DataFrame,
    qv_probabilities: Optional[np.ndarray],
    ticker: str = "TICKER",
    initial_capital: float = cfg.STARTING_CAPITAL,
    transaction_cost: float = cfg.TRANSACTION_COST,
    slippage: float = cfg.SLIPPAGE,
) -> BenchmarkComparisonResult:
    """
    Run backtest comparison across QuantView, Buy & Hold, and SMA50/200.

    Ensures all 3 strategies are evaluated over the exact same date range,
    same trading calendar, same starting capital, and same execution timing.

    Raises ValueError if qv_probabilities is None or does not match df length.
    """
    if "Close" not in df.columns:
        raise ValueError("DataFrame must contain 'Close' price column.")

    prices = df["Close"].astype(float)
    open_prices = df["Open"].astype(float) if "Open" in df.columns else prices
    n = len(prices)
    if n < 10:
        raise ValueError(f"Insufficient history ({n} bars) to run benchmark comparison.")

    dates = [d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else str(d) for d in df.index]

    # ── 1. QuantView Strategy (Authentic OOF Predictions with Hysteresis) ────
    if qv_probabilities is None or len(qv_probabilities) != n:
        raise ValueError(
            f"QuantView out-of-fold predictions are required for benchmark comparison "
            f"(expected {n} probabilities, got {len(qv_probabilities) if qv_probabilities is not None else 'None'})."
        )

    sma200_series = df["sma200"] if "sma200" in df.columns else prices.rolling(cfg.SMA_SLOW_PERIOD, min_periods=50).mean()
    qv_signals = generate_hysteresis_signals(qv_probabilities, prices, sma200_series)

    qv_metrics, qv_equity, _ = simulate_strategy(
        prices=prices,
        signals=qv_signals,
        open_prices=open_prices,
        initial_capital=initial_capital,
        transaction_cost=transaction_cost,
        slippage=slippage,
        is_buy_and_hold=False,
    )
    qv_metrics.name = "QuantView"

    # ── 2. Buy & Hold Strategy ───────────────────────────────────────────────
    bh_signals = pd.Series(1, index=df.index)
    bh_metrics, bh_equity, _ = simulate_strategy(
        prices=prices,
        signals=bh_signals,
        open_prices=open_prices,
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
        sma200 = prices.rolling(cfg.SMA_SLOW_PERIOD, min_periods=1).mean()
        sma_signals = pd.Series((prices > sma200).astype(int), index=df.index)

    sma_metrics, sma_equity, _ = simulate_strategy(
        prices=prices,
        signals=sma_signals,
        open_prices=open_prices,
        initial_capital=initial_capital,
        transaction_cost=transaction_cost,
        slippage=slippage,
        is_buy_and_hold=False,
    )
    sma_metrics.name = "SMA50/200"

    # ── Synchronized Daily Equity Curves ──────────────────────────────────────
    step = max(1, n // 200)
    equity_curve: List[Dict[str, Any]] = []
    for i in range(0, n, step):
        equity_curve.append({
            "date": dates[i],
            "quantview": round(float(qv_equity.iloc[i]), 2),
            "buy_hold": round(float(bh_equity.iloc[i]), 2),
            "sma50_200": round(float(sma_equity.iloc[i]), 2),
        })
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
            open_prices=open_prices,
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
