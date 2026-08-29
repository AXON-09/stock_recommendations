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
    p = 100.0 + 10.0 * np.sin(np.linspace(0, 4 * np.pi, 100))
    return pd.Series(p, index=dates)


class TestTransactionCostsAndSlippage:
    def test_zero_costs_produce_higher_return_than_with_costs(self, oscillating_prices):
        """Active trading with transaction costs must yield lower net equity than frictionless."""
        prices = oscillating_prices
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

    def test_exact_fee_and_slippage_math(self):
        """Verify exact mathematical deduction of trade notional, slippage, and fees."""
        dates = pd.date_range("2024-01-01", periods=3, freq="B")
        df = pd.DataFrame({
            "Open": [100.0, 100.0, 110.0],
            "Close": [100.0, 105.0, 115.0],
        }, index=dates)
        # Signal is 1 at Close[0] -> buys at Open[1] = 100.0
        signals = pd.Series([1, 0, 0], index=dates)

        cap = 10000.0
        cost = 0.001    # 0.10% fee
        slip = 0.0005   # 0.05% slippage

        m, eq, trade_ret = simulate_strategy(
            prices=df["Close"], signals=signals, open_prices=df["Open"],
            initial_capital=cap, transaction_cost=cost, slippage=slip,
        )

        # Day 1 Entry at Open[1]:
        # exec_price = 100.0 * (1 + 0.0005) = 100.05
        # trade_val = 10000.0 / (1 + 0.001) = 9990.00999
        # shares = 9990.00999 / 100.05 = 99.850175
        # fee = 9990.00999 * 0.001 = 9.99001
        # cash = 0.0
        # equity at Close[1] = 99.850175 * 105.0 = 10484.268
        expected_shares = (cap / (1.0 + cost)) / (100.0 * (1.0 + slip))
        expected_eq1 = expected_shares * 105.0
        assert eq.iloc[1] == pytest.approx(expected_eq1, abs=1e-2)

        # Day 2 Exit at Open[2] = 110.0:
        # exec_price = 110.0 * (1 - 0.0005) = 109.945
        # gross = 99.850175 * 109.945 = 10978.027
        # fee = gross * 0.001 = 10.978
        # net cash = 10967.049
        expected_exit_p = 110.0 * (1.0 - slip)
        expected_gross = expected_shares * expected_exit_p
        expected_net_cash = expected_gross * (1.0 - cost)
        assert eq.iloc[2] == pytest.approx(expected_net_cash, abs=1e-2)

    def test_cost_sensitivity_monotonic_decrease(self, oscillating_prices):
        """Higher transaction costs must strictly decrease final return for actively trading strategies."""
        prices = oscillating_prices
        signals = pd.Series([1 if (i // 5) % 2 == 0 else 0 for i in range(len(prices))], index=prices.index)

        costs = [0.0, 0.0005, 0.001, 0.002]
        returns = []
        for c in costs:
            m, _, _ = simulate_strategy(
                prices=prices, signals=signals, initial_capital=100000.0,
                transaction_cost=c, slippage=0.0005,
            )
            returns.append(m.total_return)

        # Returns should be strictly descending
        assert returns[0] > returns[1] > returns[2] > returns[3]
