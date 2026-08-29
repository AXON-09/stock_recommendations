"""
models.py - ML Model Layer

Architecture
============
1. XGBoost (tabular)
     Input : point-in-time feature vector (ATR, ADX, RSI, MACD, BB, momentum,
             volume ratio, price vs SMA50/200, SMA200 slope, regime code).
     Output: P(positive 20-day return).

2. LSTM (sequential, optional — requires PyTorch)
     Input : 60-day sliding window of the same features.
     Output: P(positive 20-day return).
     When PyTorch is unavailable, lstm_prob is returned as None — NOT as 0.5.
     The ensemble falls back to XGBoost-only mode.

3. Logistic Regression stacking layer
     Input : [xgb_prob, lstm_prob]  (or [xgb_prob] in XGBoost-only mode)
     Output: final calibrated probability.

     The stacking layer is trained on out-of-fold (OOF) predictions from a
     walk-forward procedure with a PURGE/EMBARGO period to prevent look-ahead
     bias.  The logistic coefficients show how much each base model contributes
     to the final prediction — they are NOT percentage weights.

4. Confidence score
     A composite of up to five normalised components (see CONF_WEIGHT_* in config.py).
     When LSTM is unavailable, the model_agreement component is excluded and
     the remaining four weights are renormalised to sum to 1.0.

FORECASTING HORIZON
===================
All predictions target ~20 trading days (~1 calendar month) forward.

CALIBRATION NOTE
================
The stacking layer is logistic regression applied to OOF probabilities.
This provides partial calibration but is NOT a guaranteed probability.
Brier Score and ROC-AUC are computed on OOF predictions and reported.

VALUATION NOTE
==============
P/E ratio is NOT included in ML features (see engine.py).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier
import warnings

warnings.filterwarnings("ignore")

# PyTorch is optional — Python 3.14 wheels do not yet exist.
try:
    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader, TensorDataset
    try:
        torch.set_num_threads(2)
    except Exception:
        pass
    TORCH_AVAILABLE = True
except ImportError:
    logging.warning(
        "PyTorch not found. LSTM disabled; using XGBoost-only ensemble. "
        "Install torch when a compatible wheel becomes available."
    )
    TORCH_AVAILABLE = False
    torch = None   # type: ignore
    nn    = None   # type: ignore

import config as cfg
from engine import AssetFeatures

log = logging.getLogger(__name__)

# Convenience aliases
SEQUENCE_LEN = cfg.LSTM_SEQUENCE_LENGTH
FEATURE_COLS = cfg.FEATURE_COLS


# ---------------------------------------------------------------------------
# LSTM architecture (conditional on PyTorch availability)
# ---------------------------------------------------------------------------
if TORCH_AVAILABLE:
    class LSTMNet(nn.Module):
        """
        Fast, lightweight LSTM for sequential price-pattern recognition on CPU.

        Input  : (batch, seq_len, n_features)
        Output : (batch, 1) — probability of positive T+20 return (sigmoid)
        """

        def __init__(
            self,
            n_features: int,
            hidden: int = 32,
            layers: int = 1,
            dropout: float = 0.20,
        ):
            super().__init__()
            self.lstm = nn.LSTM(
                input_size=n_features,
                hidden_size=hidden,
                num_layers=layers,
                batch_first=True,
            )
            self.drop = nn.Dropout(dropout)
            self.fc   = nn.Linear(hidden, 1)
            self.sig  = nn.Sigmoid()

        def forward(self, x: "torch.Tensor") -> "torch.Tensor":
            out, _ = self.lstm(x)
            return self.sig(self.fc(self.drop(out[:, -1, :])))

else:
    LSTMNet = None  # type: ignore



# ---------------------------------------------------------------------------
# Walk-forward splitter with purge/embargo
# ---------------------------------------------------------------------------
@dataclass
class WalkForwardFold:
    """Metadata for one walk-forward fold."""
    fold:        int
    train_start: int   # inclusive row index
    train_end:   int   # exclusive
    purge_start: int   # inclusive (rows removed from training tail)
    purge_end:   int   # exclusive
    test_start:  int   # inclusive
    test_end:    int   # exclusive


def walk_forward_splits(
    n: int,
    n_splits: int = cfg.WALK_FORWARD_SPLITS,
    purge: int     = cfg.PURGE_PERIOD,
) -> list[WalkForwardFold]:
    """
    Generate expanding walk-forward folds with a purge/embargo period.

    Structure of each fold
    ----------------------
    [0 .. train_end)   TRAIN
    [train_end - purge .. train_end)  removed from training (labels overlap test)
    [train_end .. test_end)  TEST

    Because label[t] uses Close[t+FORECAST_HORIZON], training observations
    whose label depends on prices inside the test window must be excluded.
    Removing the last `purge` (= FORECAST_HORIZON = 20) rows of the training
    set guarantees no leakage.

    Guarantee
    ---------
    For every fold f:
        fold.train_end - fold.purge_period <= fold.test_start
    i.e. no training label uses a price from inside the test window.
    """
    step = n // (n_splits + 1)
    folds: list[WalkForwardFold] = []
    for i in range(n_splits):
        train_end  = step * (i + 2)
        test_start = train_end
        test_end   = min(train_end + step, n)
        if test_end - test_start < cfg.FORECAST_HORIZON + 5:
            continue
        # purge_start: last `purge` rows of training are dropped
        purge_start = max(0, train_end - purge)
        folds.append(
            WalkForwardFold(
                fold=i,
                train_start=0,
                train_end=purge_start,       # effective training end (purged)
                purge_start=purge_start,
                purge_end=train_end,
                test_start=test_start,
                test_end=test_end,
            )
        )
    return folds


# ---------------------------------------------------------------------------
# Result dataclasses
# ---------------------------------------------------------------------------
@dataclass
class ConfidenceComponents:
    """Individual normalised components of the confidence score (each 0-1)."""
    probability_strength: float          # distance from the 0.5 decision boundary
    volatility:           float          # inverse volatility penalty
    data_quality:         float          # fraction of expected indicators available
    regime_clarity:       float          # strength of the detected regime
    model_agreement:      Optional[float]  # XGB vs LSTM agreement; None when LSTM unavailable


@dataclass
class LSTMResult:
    """LSTM prediction result, including availability status."""
    available:   bool
    probability: Optional[float]   # None when unavailable
    reason:      Optional[str]     # e.g. "PyTorch unavailable"


@dataclass
class ExplanationResult:
    """SHAP-based feature-level contributions to XGBoost prediction."""
    available: bool
    base_value: Optional[float] = None
    model_output: Optional[float] = None
    top_positive_features: List[Dict[str, Any]] = field(default_factory=list)
    top_negative_features: List[Dict[str, Any]] = field(default_factory=list)
    reason: Optional[str] = None



FEATURE_DISPLAY_NAMES: Dict[str, str] = {
    "rsi": "RSI (14-Day)",
    "adx": "ADX Trend Strength",
    "adx_pos": "+DI Directional Index",
    "adx_neg": "-DI Directional Index",
    "macd_diff": "MACD Histogram",
    "bb_pct": "Bollinger %B Position",
    "momentum_20d": "20-Day Return Momentum",
    "rolling_std_20": "20-Day Rolling Volatility",
    "volume_ratio": "Volume vs 20-Day Avg",
    "price_vs_sma50": "Price vs SMA 50",
    "price_vs_sma200": "Price vs SMA 200",
    "sma200_slope": "SMA 200 Slope",
    "atr_pct": "ATR Volatility %",
    "regime_code": "Market Regime Code",
}


@dataclass
class PredictionResult:
    xgb_prob:           float
    lstm_result:        LSTMResult
    ensemble_prob:      float
    recommendation:     str              # "Buy" | "Sell" | "Hold"
    confidence:         float            # 0-100
    confidence_label:   str             # "High" | "Medium" | "Low"
    confidence_components: ConfidenceComponents
    signal_breakdown:   Dict[str, str]
    regime:             str
    backtest_metrics:   Dict[str, Any] = field(default_factory=dict)
    horizon_days:       int = cfg.FORECAST_HORIZON
    explanation:        Optional[ExplanationResult] = None



# ---------------------------------------------------------------------------
# Signal helpers (rule-based — do not depend on ML)
# ---------------------------------------------------------------------------
def _rsi_signal(f: AssetFeatures) -> str:
    if f.rsi < f.rsi_adj_buy_threshold:  return "bullish"
    if f.rsi > f.rsi_adj_sell_threshold: return "bearish"
    return "neutral"


def _trend_signal(f: AssetFeatures) -> str:
    """
    Three-vote trend classification.

    Votes (each 0 or 1):
      price > SMA50, price > SMA200, SMA200 sloping up

    bull_votes ranges over {0, 1, 2, 3}. Unanimous agreement is required
    for a directional call; a split vote (1 or 2) means the three trend
    conditions disagree with each other, which is genuinely a "neutral /
    mixed trend" reading rather than a weak bullish or bearish one:
      3/3 → bullish   (price above both SMAs, and SMA200 rising)
      0/3 → bearish   (price below both SMAs, and SMA200 falling)
      1-2 → neutral   (conditions disagree — no clear trend)

    NOTE: a previous version used `bull_votes >= 2 -> bullish` and
    `bull_votes <= 1 -> bearish`, which are exhaustive over {0,1,2,3} and
    left "neutral" unreachable. This version fixes that.
    """
    bull_votes = int(f.price_vs_sma50 > 0) + int(f.price_vs_sma200 > 0) + int(f.sma200_slope > 0)
    if bull_votes == 3: return "bullish"
    if bull_votes == 0: return "bearish"
    return "neutral"


def _momentum_signal(f: AssetFeatures) -> str:
    if f.momentum_20d_normalized >  0.5: return "bullish"
    if f.momentum_20d_normalized < -0.5: return "bearish"
    return "neutral"


def _volume_signal(f: AssetFeatures) -> str:
    if f.volume_ratio > 1.5: return "elevated"
    if f.volume_ratio < 0.7: return "low"
    return "normal"


def _valuation_signal(f: AssetFeatures) -> str:
    """
    Rule-based only (NOT an ML feature — see engine.py docstring).
    Compares asset P/E to market-aware sector/peer P/E.
    """
    if f.market.is_etf:     return "not_applicable"
    if f.pe_relative is None: return "unavailable"
    if f.pe_relative < -0.15: return "undervalued"
    if f.pe_relative >  0.15: return "overvalued"
    return "fair"


def _macd_signal(f: AssetFeatures) -> str:
    if f.macd_diff > 0: return "bullish"
    if f.macd_diff < 0: return "bearish"
    return "neutral"


# ---------------------------------------------------------------------------
# Main recommender
# ---------------------------------------------------------------------------
class StockRecommender:
    """
    Full ML recommendation pipeline.

    fit()    — walk-forward training with purge/embargo.
    predict()— generates recommendation + calibrated confidence.
    """

    def __init__(self) -> None:
        self.xgb_model:   Optional[XGBClassifier]     = None
        self.lstm_model:  Optional[Any]                = None   # LSTMNet | None
        self.calibrator:  Optional[LogisticRegression] = None
        self.xgb_scaler:  StandardScaler               = StandardScaler()
        self.lstm_scaler: StandardScaler               = StandardScaler()
        self.is_trained:  bool                         = False
        self.backtest_metrics: Dict[str, Any]          = {}
        self.trained_at: Optional[datetime]            = None
        self.data_through: Optional[str]               = None

    # -----------------------------------------------------------------------
    def _build_sequences(
        self,
        context: np.ndarray,
        target:  np.ndarray,
    ) -> np.ndarray:
        """
        Build sliding-window sequences of length SEQUENCE_LEN.

        Parameters
        ----------
        context : rows that may be used as lookback history (training data
                  from before the window, or training data itself).
        target  : rows for which we want predictions.

        Returns
        -------
        seqs : shape (len(target), SEQUENCE_LEN, n_features)

        Each sequence seq[i] = rows  [start_idx .. start_idx + SEQUENCE_LEN)
        where start_idx is chosen so the last element of the window is the
        row immediately before target[i].  If context is long enough no
        artificial padding is needed.
        """
        full  = np.concatenate([context, target], axis=0)
        n_ctx = len(context)
        n_tgt = len(target)
        seqs  = []
        for i in range(n_tgt):
            end_idx   = n_ctx + i        # index in `full` of row before target[i]
            start_idx = end_idx - SEQUENCE_LEN
            if start_idx < 0:
                # Not enough context — pad with zeros at the front
                pad   = np.zeros((-start_idx, full.shape[1]), dtype=np.float32)
                chunk = full[: end_idx]
                seqs.append(np.concatenate([pad, chunk], axis=0))
            else:
                seqs.append(full[start_idx: end_idx])
        return np.array(seqs, dtype=np.float32)

    # -----------------------------------------------------------------------
    def _train_lstm_on(
        self,
        X_arr: np.ndarray,
        y_arr: np.ndarray,
        epochs: int = cfg.LSTM_EPOCHS_FULL,
    ) -> Optional[Any]:
        """Train LSTMNet; returns None if PyTorch is unavailable."""
        if not TORCH_AVAILABLE or LSTMNet is None:
            return None

        # Build sequences using only training data (no look-ahead)
        dummy_ctx = np.zeros((SEQUENCE_LEN, X_arr.shape[1]), dtype=np.float32)
        ctx  = np.concatenate([dummy_ctx, X_arr], axis=0)
        seqs = self._build_sequences(ctx[:-len(X_arr)], X_arr)
        labels = y_arr.astype(np.float32)
        if len(seqs) == 0:
            return None

        model     = LSTMNet(n_features=X_arr.shape[1])
        optimizer = torch.optim.Adam(model.parameters(), lr=2e-3, weight_decay=1e-5)
        criterion = nn.BCELoss()
        ds     = TensorDataset(
            torch.tensor(seqs,   dtype=torch.float32),
            torch.tensor(labels, dtype=torch.float32).unsqueeze(1),
        )
        loader = DataLoader(ds, batch_size=64, shuffle=True)
        model.train()
        for _ in range(epochs):
            for xb, yb in loader:
                optimizer.zero_grad()
                loss = criterion(model(xb), yb)
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
        return model

    # -----------------------------------------------------------------------
    def _lstm_predict_fold(
        self,
        lstm_model: Any,
        sc_lstm: StandardScaler,
        X_tr_raw: np.ndarray,
        X_te_raw: np.ndarray,
    ) -> np.ndarray:
        """
        Generate LSTM probabilities for test fold using training data as context.

        The last SEQUENCE_LEN rows of the (scaled) training set are used as
        the historical context window for the first test sequence.  No test
        data is used to construct any training sequence.
        """
        X_tr_sc = sc_lstm.transform(X_tr_raw)
        X_te_sc = sc_lstm.transform(X_te_raw)
        # Use the tail of training as context
        context = X_tr_sc[-SEQUENCE_LEN:] if len(X_tr_sc) >= SEQUENCE_LEN else X_tr_sc
        seqs    = self._build_sequences(context, X_te_sc)
        lstm_model.eval()
        with torch.no_grad():
            probs = lstm_model(
                torch.tensor(seqs, dtype=torch.float32)
            ).numpy().squeeze()
        return np.atleast_1d(probs)

    # -----------------------------------------------------------------------
    def fit(self, X: pd.DataFrame, y: pd.Series) -> None:
        """
        Walk-forward training with purge/embargo to prevent label leakage.

        Steps
        -----
        1. Generate walk-forward folds (see walk_forward_splits docstring).
        2. For each fold:
           a. Train XGBoost on purged training rows.
           b. Train LSTM on purged training rows (if PyTorch available).
           c. Generate OOF predictions on the test rows.
        3. Train Logistic Regression stacking layer on all OOF predictions.
           If LSTM is unavailable, stacking is XGBoost-only (1 input feature).
        4. Compute classification metrics on OOF predictions.
        5. Retrain XGBoost + LSTM on ALL data (full model).
        """
        X_arr = X.values.astype(np.float32)
        y_arr = y.values.astype(np.float32)
        n     = len(X_arr)

        folds = walk_forward_splits(n)
        if not folds:
            raise ValueError("Not enough data to create walk-forward folds.")

        oof_xgb:  list[np.ndarray] = []
        oof_lstm: list[np.ndarray] = []
        oof_y:    list[np.ndarray] = []
        lstm_available_in_fold     = False

        for fold in folds:
            X_tr = X_arr[fold.train_start: fold.train_end]
            y_tr = y_arr[fold.train_start: fold.train_end]
            X_te = X_arr[fold.test_start:  fold.test_end]
            y_te = y_arr[fold.test_start:  fold.test_end]

            if len(X_tr) < 50 or len(X_te) < 5:
                log.warning("Fold %d skipped (too few rows).", fold.fold)
                continue

            log.debug(
                "Fold %d: train [%d:%d] purge [%d:%d] test [%d:%d]",
                fold.fold,
                fold.train_start, fold.train_end,
                fold.purge_start, fold.purge_end,
                fold.test_start,  fold.test_end,
            )

            # ── XGBoost ────────────────────────────────────────────────────
            sc_xgb = StandardScaler().fit(X_tr)
            xgb    = XGBClassifier(
                n_estimators=cfg.XGB_ESTIMATORS_FOLD,
                max_depth=4,
                learning_rate=0.05,
                subsample=0.8,
                colsample_bytree=0.8,
                eval_metric="logloss",
                verbosity=0,
                random_state=42,
            )
            xgb.fit(sc_xgb.transform(X_tr), y_tr)
            xgb_p = xgb.predict_proba(sc_xgb.transform(X_te))[:, 1]
            oof_xgb.append(xgb_p)

            # ── LSTM ────────────────────────────────────────────────────────
            if TORCH_AVAILABLE:
                sc_lstm   = StandardScaler().fit(X_tr)
                lstm_fold = self._train_lstm_on(
                    sc_lstm.transform(X_tr), y_tr, epochs=cfg.LSTM_EPOCHS_FOLD
                )
                if lstm_fold is not None:
                    # Line 496
                    lstm_p = self._lstm_predict_fold(lstm_fold, sc_lstm, X_tr, X_te)
                    lstm_available_in_fold = True
                else:
                    lstm_p = None
            else:
                lstm_p = None

            if lstm_p is not None:
                lstm_p = lstm_p[: len(xgb_p)]  # length guard
                oof_lstm.append(lstm_p)
            oof_y.append(y_te)

        all_xgb = np.concatenate(oof_xgb)
        all_y   = np.concatenate(oof_y).astype(int)

        # ── Stacking / calibration layer ─────────────────────────────────────
        # Use only XGBoost when LSTM was unavailable, to avoid fake 0.5 inputs.
        lstm_used_in_stacking = TORCH_AVAILABLE and lstm_available_in_fold and len(oof_lstm) > 0

        if lstm_used_in_stacking:
            all_lstm  = np.concatenate(oof_lstm)
            oof_stack = np.stack([all_xgb, all_lstm], axis=1)
        else:
            all_lstm  = None
            oof_stack = all_xgb.reshape(-1, 1)   # XGBoost-only

        self.calibrator = LogisticRegression(random_state=42, max_iter=500)
        self.calibrator.fit(oof_stack, all_y)

        ens_prob = self.calibrator.predict_proba(oof_stack)[:, 1]
        ens_pred = (ens_prob >= 0.50).astype(int)


        # Guard against all-same labels (prevents AUC error)
        try:
            roc_auc = float(roc_auc_score(all_y, ens_prob))
        except ValueError:
            roc_auc = float("nan")

        brier = float(brier_score_loss(all_y, ens_prob))
        acc   = float(accuracy_score(all_y, ens_pred))
        prec  = float(precision_score(all_y, ens_pred, zero_division=0))
        rec   = float(recall_score(all_y, ens_pred, zero_division=0))
        f1    = float(f1_score(all_y, ens_pred, zero_division=0))
        cm    = confusion_matrix(all_y, ens_pred).tolist()

        n_pos = int(all_y.sum())

        # Stacking coefficients — interpret carefully: logistic regression coefs.
        coef = self.calibrator.coef_[0]
        xgb_coef  = round(float(coef[0]), 4)
        lstm_coef = round(float(coef[1]), 4) if lstm_used_in_stacking else None

        self.backtest_metrics = {
            # Classification performance
            "accuracy":              round(acc,    4),
            "precision":             round(prec,   4),
            "recall":                round(rec,    4),
            "f1":                    round(f1,     4),
            "roc_auc":               round(roc_auc, 4) if np.isfinite(roc_auc) else None,
            "brier_score":           round(brier,  4),
            "confusion_matrix":      cm,
            # Stacking coefficients (logistic regression, NOT percentage weights)
            "xgb_coefficient":       xgb_coef,
            "lstm_coefficient":      lstm_coef,    # None when LSTM unavailable
            "stacking_intercept":    round(float(self.calibrator.intercept_[0]), 4),
            # OOF metadata
            "oof_samples":           int(len(all_y)),
            "oof_positive_samples":  n_pos,
            "forecast_horizon_days": cfg.FORECAST_HORIZON,
            "purge_period_days":     cfg.PURGE_PERIOD,
            # Availability flags
            "lstm_available":        TORCH_AVAILABLE,
            "lstm_used_in_stacking": lstm_used_in_stacking,
        }

        # ── Full-data retrain ───────────────────────────────────────────────
        self.xgb_scaler.fit(X_arr)
        self.xgb_model = XGBClassifier(
            n_estimators=cfg.XGB_ESTIMATORS_FULL,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            eval_metric="logloss",
            verbosity=0,
            random_state=42,
        )
        self.xgb_model.fit(self.xgb_scaler.transform(X_arr), y_arr)

        self.lstm_scaler.fit(X_arr)
        if TORCH_AVAILABLE:
            self.lstm_model = self._train_lstm_on(
                self.lstm_scaler.transform(X_arr), y_arr, epochs=cfg.LSTM_EPOCHS_FULL
            )
        else:
            self.lstm_model = None

        self._lstm_used_in_stacking = lstm_used_in_stacking
        self.is_trained  = True
        self.trained_at  = datetime.now(timezone.utc)

    # -----------------------------------------------------------------------
    def predict(
        self,
        x_point:      pd.DataFrame,
        x_seq_scaled: Optional[np.ndarray],
        features:     AssetFeatures,
    ) -> PredictionResult:
        """
        Generate a recommendation for the current feature snapshot.

        Parameters
        ----------
        x_point      : single-row DataFrame of current features (for XGBoost).
        x_seq_scaled : (SEQUENCE_LEN, n_features) float32 array for LSTM,
                       using *training* data as the lookback context.
                       Pass None to use XGBoost-only.
        features     : AssetFeatures snapshot (for signal helpers + confidence).
        """
        if not self.is_trained:
            raise RuntimeError("StockRecommender must be trained before calling predict().")

        # ── XGBoost ──────────────────────────────────────────────────────────
        xgb_p = float(
            self.xgb_model.predict_proba(self.xgb_scaler.transform(x_point))[0][1]
        )

        # ── LSTM ─────────────────────────────────────────────────────────────
        lstm_result: LSTMResult
        if (
            TORCH_AVAILABLE
            and self.lstm_model is not None
            and x_seq_scaled is not None
            and len(x_seq_scaled) == SEQUENCE_LEN
        ):
            self.lstm_model.eval()
            seq = torch.tensor(x_seq_scaled[np.newaxis], dtype=torch.float32)
            with torch.no_grad():
                lstm_p_val = float(self.lstm_model(seq).item())
            lstm_result = LSTMResult(available=True, probability=lstm_p_val, reason=None)
        else:
            reason = "PyTorch unavailable" if not TORCH_AVAILABLE else "Insufficient sequence data"
            lstm_result = LSTMResult(available=False, probability=None, reason=reason)

        # ── Stacking ensemble ────────────────────────────────────────────────
        lstm_used = getattr(self, "_lstm_used_in_stacking", False)
        if lstm_used and lstm_result.probability is not None and self.calibrator is not None:
            ens_in = np.array([[xgb_p, lstm_result.probability]])
        else:
            # XGBoost-only stacking
            ens_in = np.array([[xgb_p]])
        if self.calibrator is not None:
            ens_p = float(self.calibrator.predict_proba(ens_in)[0][1])
        else:
            ens_p = xgb_p   # fallback: use XGBoost directly

        # ── Regime shrinkage ─────────────────────────────────────────────────
        # Formula: p_adj = 0.5 + (p_raw - 0.5) * CHOPPY_SHRINK_FACTOR
        if features.regime == "choppy":
            ens_p = 0.5 + (ens_p - 0.5) * cfg.CHOPPY_SHRINK_FACTOR

        # ── Decision ─────────────────────────────────────────────────────────
        if   ens_p >= cfg.BUY_THRESHOLD:  recommendation = "Buy"
        elif ens_p <= cfg.SELL_THRESHOLD: recommendation = "Sell"
        else:                             recommendation = "Hold"

        # ── Confidence components (each normalised to [0, 1]) ─────────────────
        # 1. Probability distance from the 0.5 boundary → [0, 1]
        prob_strength = float(abs(ens_p - 0.5) * 2.0)

        # 2. Volatility: lower ATR% → higher confidence
        vol_raw  = features.atr_pct
        vol_comp = float(
            np.clip(
                1.0 - (vol_raw - cfg.CONF_ATR_LOW) / (cfg.CONF_ATR_HIGH - cfg.CONF_ATR_LOW),
                0.0, 1.0,
            )
        )

        # 3. Data quality: fraction of expected indicators present
        data_comp = float(np.clip(features.data_completeness, 0.0, 1.0))

        # 4. Regime clarity [0, 1] already from detect_regime()
        regime_comp = float(np.clip(features.regime_strength, 0.0, 1.0))

        # 5. Model agreement — only when LSTM is genuinely available
        if lstm_result.probability is not None:
            agree_comp: Optional[float] = float(1.0 - abs(xgb_p - lstm_result.probability))
        else:
            agree_comp = None  # Do NOT fabricate agreement score

        # Compute weighted confidence:
        # If LSTM unavailable, exclude agreement and renormalise remaining weights.
        if agree_comp is not None:
            raw = (
                prob_strength * cfg.CONF_WEIGHT_BOUNDARY    +
                vol_comp      * cfg.CONF_WEIGHT_VOLATILITY   +
                data_comp     * cfg.CONF_WEIGHT_DATA_QUALITY +
                regime_comp   * cfg.CONF_WEIGHT_REGIME       +
                agree_comp    * cfg.CONF_WEIGHT_AGREEMENT
            )
        else:
            # Renormalise the four available components
            total_w = (
                cfg.CONF_WEIGHT_BOUNDARY +
                cfg.CONF_WEIGHT_VOLATILITY +
                cfg.CONF_WEIGHT_DATA_QUALITY +
                cfg.CONF_WEIGHT_REGIME
            )
            raw = (
                prob_strength * (cfg.CONF_WEIGHT_BOUNDARY    / total_w) +
                vol_comp      * (cfg.CONF_WEIGHT_VOLATILITY   / total_w) +
                data_comp     * (cfg.CONF_WEIGHT_DATA_QUALITY / total_w) +
                regime_comp   * (cfg.CONF_WEIGHT_REGIME       / total_w)
            )

        confidence = round(float(np.clip(raw * 100, 5.0, 95.0)), 1)

        if   confidence >= 65: conf_label = "High"
        elif confidence >= 40: conf_label = "Medium"
        else:                  conf_label = "Low"

        comps = ConfidenceComponents(
            probability_strength=round(prob_strength, 3),
            volatility=round(vol_comp,    3),
            data_quality=round(data_comp, 3),
            regime_clarity=round(regime_comp, 3),
            model_agreement=round(agree_comp, 3) if agree_comp is not None else None,
        )

        signals = {
            "rsi":       _rsi_signal(features),
            "trend":     _trend_signal(features),
            "macd":      _macd_signal(features),
            "momentum":  _momentum_signal(features),
            "volume":    _volume_signal(features),
            "valuation": _valuation_signal(features),
        }

        # ── SHAP Explainability ───────────────────────────────────────────────
        explanation = self.explain(x_point=x_point, features=features)

        return PredictionResult(
            xgb_prob=round(xgb_p,  4),
            lstm_result=lstm_result,
            ensemble_prob=round(ens_p, 4),
            recommendation=recommendation,
            confidence=confidence,
            confidence_label=conf_label,
            confidence_components=comps,
            signal_breakdown=signals,
            regime=features.regime,
            backtest_metrics=self.backtest_metrics,
            explanation=explanation,
        )

    # -----------------------------------------------------------------------
    def explain(
        self,
        x_point: pd.DataFrame,
        features: Optional[AssetFeatures] = None,
        top_n: int = cfg.SHAP_TOP_N,
    ) -> ExplanationResult:
        """
        Generate SHAP-based feature-level contributions to the XGBoost prediction.

        Uses shap.TreeExplainer on the exact scaled feature vector used for prediction.
        Maps contributions back to the 14 raw unscaled feature values.
        """
        if not self.is_trained or self.xgb_model is None:
            return ExplanationResult(
                available=False,
                reason="Model is not trained yet.",
            )

        try:
            import shap

            x_scaled = self.xgb_scaler.transform(x_point)
            explainer = shap.TreeExplainer(self.xgb_model)
            shap_obj = explainer(x_scaled)

            # Handle 1D, 2D, or 3D output shapes across shap versions
            vals = shap_obj.values
            if len(vals.shape) == 3:
                # Binary classification (samples, features, classes) -> positive class (index 1)
                s_arr = vals[0, :, 1]
            elif len(vals.shape) == 2:
                # (samples, features)
                s_arr = vals[0, :]
            else:
                s_arr = vals

            base_val = float(shap_obj.base_values[0]) if hasattr(shap_obj, "base_values") else 0.5
            if isinstance(base_val, (np.ndarray, list)):
                base_val = float(base_val[-1])

            model_out = float(self.xgb_model.predict_proba(x_scaled)[0][1])

            pos_items: List[Dict[str, Any]] = []
            neg_items: List[Dict[str, Any]] = []

            feature_cols = list(x_point.columns)
            for i, col in enumerate(feature_cols):
                s_val = float(s_arr[i])
                raw_v = float(x_point.iloc[0][col])
                d_name = FEATURE_DISPLAY_NAMES.get(col, col.replace("_", " ").title())
                item = {
                    "feature": col,
                    "display_name": d_name,
                    "value": round(raw_v, 4),
                    "shap_value": round(s_val, 4),
                }
                if s_val > 0:
                    pos_items.append(item)
                elif s_val < 0:
                    neg_items.append(item)

            # Sort positive features descending, negative features ascending
            pos_items.sort(key=lambda x: x["shap_value"], reverse=True)
            neg_items.sort(key=lambda x: x["shap_value"])

            return ExplanationResult(
                available=True,
                base_value=round(base_val, 4),
                model_output=round(model_out, 4),
                top_positive_features=pos_items[:top_n],
                top_negative_features=neg_items[:top_n],
                reason=None,
            )

        except Exception as exc:
            log.warning("SHAP calculation failed: %s", exc)
            return ExplanationResult(
                available=False,
                reason=f"SHAP explanation unavailable: {exc}",
            )

