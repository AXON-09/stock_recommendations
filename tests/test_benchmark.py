"""
test_benchmark.py - Tests for Strategy Benchmarking and Next-Bar Execution in QuantView AI.
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
    # Upward trending price series
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
        """Buy & hold strategy enters on Day 0 and holds through End Date."""
        df = sample_price_data
        signals = pd.Series(1, index=df.index)
        metrics, equity, trade_returns = simulate_strategy(
            prices=df["Close"],
            signals=signals,
            open_prices=df["Open"],
            initial_capital=100000.0,
            transaction_cost=0.0,
            slippage=0.0,
            is_buy_and_hold=True,
        )
        assert isinstance(metrics, StrategyMetrics)
        assert metrics.trades == 1
        assert metrics.win_rate is None
        # Return starts at Open[0] and marks to Close[-1]
        expected_ret = ((df["Close"].iloc[-1] - df["Open"].iloc[0]) / df["Open"].iloc[0]) * 100.0
        assert metrics.total_return == pytest.approx(expected_ret, abs=0.1)

    def test_next_bar_execution_timing(self):
        """Signal generated at Close[t] must execute at Open[t+1], not Close[t]."""
        dates = pd.date_range("2024-01-01", periods=3, freq="B")
        # Day 0: Open 100, Close 102
        # Day 1: Open 104, Close 108
        # Day 2: Open 110, Close 112
        df = pd.DataFrame({
            "Open": [100.0, 104.0, 110.0],
            "Close": [102.0, 108.0, 112.0],
        }, index=dates)

        # Signal turns 1 at Close[0], 0 at Close[1]
        signals = pd.Series([1, 0, 0], index=dates)

        metrics, equity, trade_ret = simulate_strategy(
            prices=df["Close"],
            signals=signals,
            open_prices=df["Open"],
            initial_capital=10000.0,
            transaction_cost=0.0,
            slippage=0.0,
            is_buy_and_hold=False,
        )

        # On Day 0: Portfolio is in Cash (equity = 10000.0)
        assert equity.iloc[0] == 10000.0

        # On Day 1: Executes at Open[1] = 104.0, buys 10000/104 = 96.1538 shares.
        # Marked to market at Close[1] = 108.0 -> 96.1538 * 108.0 = 10384.615
        expected_eq1 = (10000.0 / 104.0) * 108.0
        assert equity.iloc[1] == pytest.approx(expected_eq1, abs=1e-2)

        # On Day 2: Signal was 0 at Close[1], so executes exit at Open[2] = 110.0.
        # Cash proceeds: 96.1538 * 110.0 = 10576.92
        expected_eq2 = (10000.0 / 104.0) * 110.0
        assert equity.iloc[2] == pytest.approx(expected_eq2, abs=1e-2)

    def test_run_benchmark_comparison_suite(self, sample_price_data):
        """Full benchmark comparison returns 3 strategies over identical dates."""
        df = sample_price_data
        qv_probs = np.random.uniform(0.4, 0.7, len(df))
        res = run_benchmark_comparison(
            df=df,
            qv_probabilities=qv_probs,
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
            assert s.max_drawdown <= 0.0
            assert isinstance(s.volatility, float)
            assert s.volatility >= 0.0
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

    def test_benchmark_requires_genuine_qv_probabilities(self, sample_price_data):
        """Benchmark comparison must reject None or mismatched qv_probabilities."""
        df = sample_price_data
        with pytest.raises(ValueError, match="QuantView out-of-fold predictions are required"):
            run_benchmark_comparison(df=df, qv_probabilities=None)

    def test_equity_consistency(self, sample_price_data):
        """Final equity value must match initial_capital * (1 + total_return/100)."""
        df = sample_price_data
        qv_probs = np.random.uniform(0.4, 0.7, len(df))
        res = run_benchmark_comparison(
            df=df,
            qv_probabilities=qv_probs,
            initial_capital=100000.0,
            transaction_cost=0.001,
            slippage=0.0005,
        )
        for s in res.strategies:
            last_val = res.equity_curve[-1][s.name.lower().replace(" & ", "_").replace("/", "_")]
            expected_ret = ((last_val - 100000.0) / 100000.0) * 100.0
            assert s.total_return == pytest.approx(expected_ret, abs=0.05)
