"""Tests for the AIS/26AS reconciliation engine (app.services.reconcile)."""
from __future__ import annotations

from app.services import reconcile as rec


def test_matched_mismatch_and_only():
    a = [{"key": "TAN1", "name": "ACME", "amount": 1000},
         {"key": "TAN2", "name": "BETA", "amount": 500},
         {"key": "TAN3", "name": "GAMMA", "amount": 300}]
    b = [{"key": "tan1", "name": "Acme", "amount": 1000},   # matches TAN1 (case/space-insensitive)
         {"key": "TAN2", "amount": 450},                    # mismatch (500 vs 450)
         {"key": "TAN4", "name": "DELTA", "amount": 200}]   # only in B
    r = rec.reconcile(a, b)
    s = r["summary"]
    assert s["matched_count"] == 1
    assert s["mismatch_count"] == 1
    assert s["only_a_count"] == 1
    assert s["only_b_count"] == 1
    assert r["amount_mismatch"][0]["diff"] == 50


def test_aggregates_by_key():
    a = [{"key": "T", "amount": 100}, {"key": "T", "amount": 50}]
    b = [{"key": "T", "amount": 150}]
    r = rec.reconcile(a, b)
    assert r["summary"]["matched_count"] == 1
    assert r["matched"][0]["amount_a"] == 150


def test_tolerance():
    a = [{"key": "X", "amount": 1000}]
    b = [{"key": "X", "amount": 1000.5}]
    assert rec.reconcile(a, b, tolerance=1.0)["summary"]["matched_count"] == 1
    assert rec.reconcile(a, b, tolerance=0.1)["summary"]["mismatch_count"] == 1
