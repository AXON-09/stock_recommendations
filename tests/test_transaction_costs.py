"""
test_transaction_costs.py - Tests for Transaction Costs and Slippage in QuantView AI.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backtest import simulate_strategy


@pytest.fixture
def oscillating_prices():
    """Generates synthetic prices with multiple trend reversals."""
    dates = pd.date_range("2024-01-01", periods=100, freq="B")
    # Alternating prices
    p = 100.0 + 10.0 * np.sin(np.linspace(0, 4 * np.pi, 100))
    return pd.Series(p, index=dates)


class TestTransactionCostsAndSlippage:
    def test_zero_costs_produce_higher_return_than_with_costs(self, oscillating_prices):
        """Active trading with transaction costs must yield lower net equity than frictionless."""
        prices = oscillating_prices
        # Toggle signal every 10 days
        signals = pd.Series([1 if (i // 10) % 2 == 0 else 0 for i in range(len(prices))], index=prices.index)

        m_zero, eq_zero, _ = simulate_strategy(
            prices=prices, signals=signals, initial_capital=100000.0,
            transaction_cost=0.0, slippage=0.0,
        )
        m_cost, eq_cost, _ = simulate_strategy(
            prices=prices, signals=signals, initial_capital=100000.0,
            transaction_cost=0.002, slippage=0.001,
        )

        assert m_cost.trades == m_zero.trades
        assert m_cost.trades > 0
        assert eq_cost.iloc[-1] < eq_zero.iloc[-1]
        assert m_cost.total_return < m_zero.total_return

    def test_no_trade_charges_no_costs(self, oscillating_prices):
        """Holding cash without trading should incur zero cost and zero return."""
        prices = oscillating_prices
        signals = pd.Series(0, index=prices.index)

        m, eq, _ = simulate_strategy(
            prices=prices, signals=signals, initial_capital=100000.0,
            transaction_cost=0.01, slippage=0.01,
        )
        assert m.trades == 0
        assert eq.iloc[-1] == 100000.0
        assert m.total_return == 0.0

    def test_slippage_affects_execution_price(self):
        """Buy execution price must be higher by (1+slippage); sell lower by (1-slippage)."""
        dates = pd.date_range("2024-01-01", periods=3, freq="B")
        prices = pd.Series([100.0, 105.0, 110.0], index=dates)
        # Buy on day 0, Sell on day 1, Cash on day 2
        signals = pd.Series([1, 0, 0], index=dates)

        slippage = 0.01  # 1%
        m, eq, trade_ret = simulate_strategy(
            prices=prices, signals=signals, initial_capital=10000.0,
            transaction_cost=0.0, slippage=slippage,
        )
        # Entry price: 100 * 1.01 = 101.0
        # Exit price: 105 * 0.99 = 103.95
        # Expected trade return: (103.95 - 101.0) / 101.0 = ~0.029207 (2.92%)
        assert len(trade_ret) == 1
        expected_trade_ret = (105.0 * 0.99 - 100.0 * 1.01) / (100.0 * 1.01)
        assert trade_ret[0] == pytest.approx(expected_trade_ret, abs=1e-5)

    def test_buy_and_hold_pays_minimal_trades(self, oscillating_prices):
        """Buy & Hold should only execute 1 trade (initial purchase)."""
        prices = oscillating_prices
        signals = pd.Series(1, index=prices.index)
        m, eq, _ = simulate_strategy(
            prices=prices, signals=signals, initial_capital=100000.0,
            transaction_cost=0.001, slippage=0.0005, is_buy_and_hold=True,
        )
        assert m.trades == 1
