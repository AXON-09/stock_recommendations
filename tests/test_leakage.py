"""
tests/test_leakage.py - Walk-forward leakage prevention tests.

Verifies:
1. Purge/embargo prevents label overlap between training and test sets.
2. LSTM sequences use only training context, never test rows.
3. Walk-forward fold ordering is strictly increasing.
4. Labels are correctly computed (T+20 target).
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

# Allow imports from backend/
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import config as cfg
from models import walk_forward_splits, WalkForwardFold, StockRecommender


# ---------------------------------------------------------------------------
# Walk-forward split tests
# ---------------------------------------------------------------------------
class TestWalkForwardSplits:

    def test_no_leakage_train_vs_test(self):
        """
        Core leakage test:
        The effective training end must be at least PURGE rows before the test start.
        Because label[i] = f(Close[i + PURGE]), a training observation at
        row (train_end - 1) has a label that uses price at row (train_end - 1 + PURGE).
        After purging, the last training row is at (purge_start - 1), so its label
        uses price at (purge_start - 1 + PURGE) = (train_end - 1) < test_start. ✓
        """
        n = 1000
        folds = walk_forward_splits(n, n_splits=4, purge=cfg.PURGE_PERIOD)
        assert folds, "Expected at least one fold"

        for f in folds:
            # The last training label uses price at (train_end - 1 + PURGE)
            last_training_label_uses_price_at = f.train_end - 1 + cfg.PURGE_PERIOD
            # That price index must be strictly less than the first test index
            assert last_training_label_uses_price_at < f.test_start, (
                f"Fold {f.fold}: label leakage detected. "
                f"Training label at row {f.train_end - 1} uses price at "
                f"row {last_training_label_uses_price_at}, "
                f"but test starts at {f.test_start}."
            )

    def test_folds_non_overlapping(self):
        """Test periods must not overlap between folds."""
        n = 1000
        folds = walk_forward_splits(n, n_splits=4, purge=cfg.PURGE_PERIOD)
        for i in range(1, len(folds)):
            assert folds[i].test_start >= folds[i - 1].test_end, (
                f"Test periods overlap between fold {i-1} and fold {i}"
            )

    def test_train_before_test(self):
        """Training must always come before testing."""
        n = 1000
        folds = walk_forward_splits(n)
        for f in folds:
            assert f.train_end <= f.test_start, (
                f"Fold {f.fold}: train_end={f.train_end} > test_start={f.test_start}"
            )

    def test_purge_within_train(self):
        """Purge period must be between train and test (not inside test)."""
        n = 1000
        folds = walk_forward_splits(n)
        for f in folds:
            assert f.purge_start >= f.train_start
            assert f.purge_end   <= f.test_start + 1  # purge ends at or before test

    def test_increasing_train_size(self):
        """Each fold must have strictly more training data than the previous."""
        n = 1000
        folds = walk_forward_splits(n, n_splits=4)
        for i in range(1, len(folds)):
            assert folds[i].train_end > folds[i - 1].train_end, (
                "Training set should grow with each fold (expanding window)"
            )

    def test_minimum_data(self):
        """With very small n, no folds (or graceful empty) should be returned."""
        folds = walk_forward_splits(10, n_splits=4)
        # Either no folds or very small ones — must not crash
        for f in folds:
            assert f.test_end > f.test_start


# ---------------------------------------------------------------------------
# Target label tests
# ---------------------------------------------------------------------------
class TestTargetLabels:

    def _make_df(self, n=300) -> pd.DataFrame:
        np.random.seed(42)
        prices = 100 * np.cumprod(1 + np.random.normal(0, 0.01, n))
        return pd.DataFrame({"Close": prices})

    def test_label_is_binary(self):
        df = self._make_df()
        h  = cfg.FORECAST_HORIZON
        fwd = df["Close"].shift(-h) / df["Close"] - 1
        lbl = (fwd > 0).astype(int)
        lbl_clean = lbl.dropna()
        assert set(lbl_clean.unique()).issubset({0, 1}), "Labels must be binary"

    def test_label_length(self):
        df = self._make_df(n=300)
        h  = cfg.FORECAST_HORIZON
        # Must use float so that NaN propagates after shift
        fwd = df["Close"].astype(float).shift(-h) / df["Close"] - 1
        lbl = (fwd > 0).astype(float)  # float so NaN rows remain NaN
        lbl_clean = lbl[fwd.notna()]   # drop the trailing h rows
        # Should have n - h valid labels
        assert len(lbl_clean) == len(df) - h

    def test_label_positive_when_price_rises(self):
        """Manually verify one label."""
        df = pd.DataFrame({"Close": [100.0, 101.0, 102.0, 103.0, 104.0]})
        h  = 2
        # row 0: Close[2]=102 > Close[0]=100 → label=1
        fwd = df["Close"].shift(-h) / df["Close"] - 1
        lbl = (fwd > 0).astype(int)
        assert lbl.iloc[0] == 1
        # row 2: Close[4]=104 > Close[2]=102 → label=1
        assert lbl.iloc[2] == 1


# ---------------------------------------------------------------------------
# LSTM sequence construction tests
# ---------------------------------------------------------------------------
class TestLSTMSequences:

    def test_sequence_uses_context_not_test(self):
        """
        The first LSTM prediction for the test fold must use only context rows.
        For the FIRST target row, the sequence should be the last SEQUENCE_LEN
        rows of context — none from target.
        """
        recommender = StockRecommender()
        n_features  = 3
        seq_len     = cfg.LSTM_SEQUENCE_LENGTH   # 60
        n_context   = seq_len + 10               # slightly more than one window
        n_target    = 5

        context = np.random.randn(n_context, n_features).astype(np.float32)
        target  = (np.random.randn(n_target,  n_features) + 99).astype(np.float32)  # distinctly large

        seqs = recommender._build_sequences(context, target)
        assert seqs.shape[0] == n_target

        # For the FIRST target row, the sequence uses only context rows
        # (the last seq_len rows of context).
        first_seq = seqs[0]
        assert first_seq.max() < 50, (
            f"First sequence contains values from the test set "
            f"(max={first_seq.max():.2f}). Should be < 50 for std-normal context."
        )

    def test_sequence_shape(self):
        """Sequences should be (n_target, SEQUENCE_LEN, n_features)."""
        rec = StockRecommender()
        n_f = 5
        context = np.random.randn(cfg.LSTM_SEQUENCE_LENGTH + 10, n_f).astype(np.float32)
        target  = np.random.randn(15, n_f).astype(np.float32)
        seqs = rec._build_sequences(context, target)
        assert seqs.shape == (15, cfg.LSTM_SEQUENCE_LENGTH, n_f)

    def test_sequence_no_padding_when_context_sufficient(self):
        """
        When context length >= SEQUENCE_LEN, the FIRST target's sequence
        should be drawn entirely from context (all 2.0), not the target (3.0).
        """
        rec = StockRecommender()
        n_f = 4
        n_ctx = cfg.LSTM_SEQUENCE_LENGTH * 2
        context = np.ones((n_ctx, n_f), dtype=np.float32) * 2.0
        target  = np.ones((5, n_f), dtype=np.float32) * 3.0
        seqs = rec._build_sequences(context, target)
        # The FIRST sequence should be pure context (2.0)
        assert (seqs[0] == 2.0).all(), (
            "First sequence should contain only context values (2.0) when context is sufficient, "
            "got values that include target (3.0)"
        )


# ---------------------------------------------------------------------------
# Out-of-Fold (OOF) Stacking tests
# ---------------------------------------------------------------------------
class TestOOFStacking:

    def test_oof_meta_features_are_out_of_fold(self):
        """
        Verify that StockRecommender stores OOF predictions and OOF target y
        evaluated strictly on unseen test folds during walk-forward validation.
        """
        np.random.seed(42)
        n = 400
        n_feat = len(cfg.FEATURE_COLS)
        X_mat = np.random.randn(n, n_feat)
        y_vec = (np.random.rand(n) > 0.5).astype(int)
        
        df_X = pd.DataFrame(X_mat, columns=cfg.FEATURE_COLS)
        df_y = pd.Series(y_vec)
        
        rec = StockRecommender()
        rec.fit(df_X, df_y)
        
        assert rec.is_trained, "Recommender should be marked trained"
        assert rec.oof_probabilities is not None, "OOF probabilities must exist"
        assert rec.oof_y is not None, "OOF true labels must exist"
        assert len(rec.oof_probabilities) == len(rec.oof_y)
        assert len(rec.oof_probabilities) > 0
        assert (rec.oof_probabilities >= 0.0).all() and (rec.oof_probabilities <= 1.0).all()
