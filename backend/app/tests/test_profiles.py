"""Tests for workspace-profile validation (app.core.profiles)."""
from app.core import profiles as p


def test_functions_sourced_from_taxonomy():
    # Sourced from the canonical department taxonomy (14 wings) — a superset of
    # the original nine, each with key + label + group.
    keys = {x["key"] for x in p.WORKSPACE_PROFILES}
    assert {"officer", "cita", "drp", "tp", "investigation", "ici", "recovery", "tds", "ca"} <= keys
    assert {"central", "exemptions", "inttax", "audit", "hq"} <= keys
    for x in p.WORKSPACE_PROFILES:
        assert x["key"] and x["label"] and x["group"]


def test_is_valid_profile_accepts_functions_meta_and_none():
    assert p.is_valid_profile("officer")
    assert p.is_valid_profile("tp")
    assert p.is_valid_profile("all")        # meta: show everything
    assert p.is_valid_profile("custom")     # meta: pick several
    assert p.is_valid_profile(None)         # not chosen yet
    assert not p.is_valid_profile("junk")
    assert not p.is_valid_profile("officer2")


def test_valid_wings():
    assert p.valid_wings(None)              # no custom selection
    assert p.valid_wings([])                # empty is fine
    assert p.valid_wings(["officer", "tp", "recovery"])
    assert not p.valid_wings(["officer", "all"])    # meta keys aren't functions
    assert not p.valid_wings(["officer", "nope"])
