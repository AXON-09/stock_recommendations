"""
test_shap.py - Tests for SHAP Model Explainability in QuantView AI.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

import config as cfg
from models import StockRecommender, ExplanationResult, FEATURE_DISPLAY_NAMES


@pytest.fixture
def dummy_dataset():
    """Synthetic dataset with 14 features matching QuantView feature columns."""
    np.random.seed(42)
    n_samples = 150
    data = {col: np.random.randn(n_samples) for col in cfg.FEATURE_COLS}
    X = pd.DataFrame(data)
    # Target: 1 if positive return, else 0
    y = pd.Series(np.random.randint(0, 2, n_samples), index=X.index)
    return X, y


class TestSHAPExplainability:
    def test_explain_untrained_model(self):
        """Untrained model should return available=False with a clear reason."""
        rec = StockRecommender()
        x_sample = pd.DataFrame([np.zeros(len(cfg.FEATURE_COLS))], columns=cfg.FEATURE_COLS)
        exp = rec.explain(x_sample)
        assert isinstance(exp, ExplanationResult)
        assert exp.available is False
        assert "not trained" in exp.reason.lower()

    def test_explain_trained_model_structure(self, dummy_dataset):
        """Trained model should generate valid SHAP explanation with sorted contributors."""
        X, y = dummy_dataset
        rec = StockRecommender()
        rec.fit(X, y)

        x_point = X.iloc[[-1]]
        exp = rec.explain(x_point)

        assert isinstance(exp, ExplanationResult)
        assert exp.available is True
        assert exp.base_value is not None
        assert exp.model_output is not None
        assert isinstance(exp.top_positive_features, list)
        assert isinstance(exp.top_negative_features, list)

        # Check positive features are sorted descending
        pos_vals = [f["shap_value"] for f in exp.top_positive_features]
        assert pos_vals == sorted(pos_vals, reverse=True)
        for f in exp.top_positive_features:
            assert f["shap_value"] > 0
            assert f["feature"] in cfg.FEATURE_COLS
            assert f["display_name"] == FEATURE_DISPLAY_NAMES[f["feature"]]

        # Check negative features are sorted ascending (most negative first)
        neg_vals = [f["shap_value"] for f in exp.top_negative_features]
        assert neg_vals == sorted(neg_vals)
        for f in exp.top_negative_features:
            assert f["shap_value"] < 0
            assert f["feature"] in cfg.FEATURE_COLS
            assert f["display_name"] == FEATURE_DISPLAY_NAMES[f["feature"]]

    def test_feature_mapping_preserves_raw_values(self, dummy_dataset):
        """SHAP mapping must preserve the actual unscaled feature values."""
        X, y = dummy_dataset
        rec = StockRecommender()
        rec.fit(X, y)

        x_point = X.iloc[[-1]]
        exp = rec.explain(x_point)

        all_items = exp.top_positive_features + exp.top_negative_features
        for item in all_items:
            col = item["feature"]
            expected_raw = float(x_point.iloc[0][col])
            assert item["value"] == pytest.approx(expected_raw, abs=1e-4)

    def test_explain_handles_invalid_input_gracefully(self, dummy_dataset):
        """Missing columns or invalid shape should fail gracefully without crashing."""
        X, y = dummy_dataset
        rec = StockRecommender()
        rec.fit(X, y)

        # Passing mismatched DataFrame
        bad_df = pd.DataFrame({"dummy": [1.0, 2.0]})
        exp = rec.explain(bad_df)
        assert exp.available is False
        assert exp.reason is not None
