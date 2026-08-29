"""
test_benchmark.py - Tests for Strategy Benchmarking in QuantView AI.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

import config as cfg
from backtest import simulate_strategy, run_benchmark_comparison, BenchmarkComparisonResult, StrategyMetrics


@pytest.fixture
def sample_price_data():
    """Generates synthetic OHLCV time series data across 252 trading days."""
    np.random.seed(42)
    dates = pd.date_range(start="2024-01-01", periods=252, freq="B")
    # Steady upward trending price series
    returns = np.random.normal(0.0008, 0.015, len(dates))
    price = 100.0 * np.exp(np.cumsum(returns))

    df = pd.DataFrame({
        "Open": price * 0.99,
        "High": price * 1.01,
        "Low": price * 0.98,
        "Close": price,
        "Volume": np.random.randint(100000, 500000, len(dates)),
        "sma200": pd.Series(price).rolling(50, min_periods=1).mean().values,
        "price_vs_sma50": np.random.randn(len(dates)),
        "momentum_20d": np.random.randn(len(dates)),
    }, index=dates)
    return df


class TestStrategyBenchmarking:
    def test_buy_and_hold_simulation(self, sample_price_data):
        """Buy & hold strategy enters on Day 1 and holds through End Date."""
        df = sample_price_data
        signals = pd.Series(1, index=df.index)
        metrics, equity, trade_returns = simulate_strategy(
            prices=df["Close"],
            signals=signals,
            initial_capital=100000.0,
            transaction_cost=0.0,
            slippage=0.0,
            is_buy_and_hold=True,
        )
        assert isinstance(metrics, StrategyMetrics)
        # 1 buy trade
        assert metrics.trades == 1
        assert metrics.win_rate is None
        # Total return should equal raw price return
        expected_ret = ((df["Close"].iloc[-1] - df["Close"].iloc[0]) / df["Close"].iloc[0]) * 100.0
        assert metrics.total_return == pytest.approx(expected_ret, abs=0.1)

    def test_sma_strategy_simulation(self, sample_price_data):
        """SMA strategy exits to cash when Close <= SMA."""
        df = sample_price_data
        sma_signal = (df["Close"] > df["sma200"]).astype(int)
        metrics, equity, trade_returns = simulate_strategy(
            prices=df["Close"],
            signals=sma_signal,
            initial_capital=100000.0,
            transaction_cost=0.001,
            slippage=0.0005,
            is_buy_and_hold=False,
        )
        assert metrics.trades >= 1
        assert len(equity) == len(df)
        assert equity.iloc[0] <= 100000.0  # after entry fee and slippage

    def test_run_benchmark_comparison_suite(self, sample_price_data):
        """Full benchmark comparison returns 3 strategies over identical dates."""
        df = sample_price_data
        res = run_benchmark_comparison(
            df=df,
            qv_probabilities=None,
            ticker="TEST_TICKER",
            initial_capital=100000.0,
            transaction_cost=0.001,
            slippage=0.0005,
        )
        assert isinstance(res, BenchmarkComparisonResult)
        assert res.ticker == "TEST_TICKER"
        assert res.trading_days == len(df)
        assert len(res.strategies) == 3
        strat_names = [s.name for s in res.strategies]
        assert strat_names == ["QuantView", "Buy & Hold", "SMA50/200"]

        # Ensure all strategy metrics are populated
        for s in res.strategies:
            assert isinstance(s.total_return, float)
            assert isinstance(s.cagr, float)
            assert isinstance(s.sharpe, float)
            assert isinstance(s.max_drawdown, float)
            assert isinstance(s.volatility, float)
            assert isinstance(s.trades, int)
            if s.name == "Buy & Hold":
                assert s.win_rate is None
            else:
                assert s.win_rate is None or isinstance(s.win_rate, float)

        # Equity curves must have identical synchronized dates
        assert len(res.equity_curve) > 0
        first_pt = res.equity_curve[0]
        assert "quantview" in first_pt
        assert "buy_hold" in first_pt
        assert "sma50_200" in first_pt
        assert "date" in first_pt

        # Cost sensitivity scenarios
        assert len(res.cost_scenarios) == len(cfg.COST_SCENARIOS)
