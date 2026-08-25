"""Tests for workspace-profile validation (app.core.profiles)."""
from app.core import profiles as p


def test_nine_functions_present():
    assert len(p.WORKSPACE_PROFILES) == 9
    keys = {x["key"] for x in p.WORKSPACE_PROFILES}
    assert keys == {"officer", "cita", "drp", "tp", "investigation", "ici", "recovery", "tds", "ca"}
    for x in p.WORKSPACE_PROFILES:
        assert x["key"] and x["label"]


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
