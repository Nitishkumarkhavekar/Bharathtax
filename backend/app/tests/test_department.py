"""Canonical department taxonomy (Phase 0)."""
import json

from app.core import department as dept


def test_wings_have_required_fields_and_unique_keys():
    keys = [w["key"] for w in dept.WINGS]
    assert len(keys) == len(set(keys)), "wing keys must be unique"
    required = {"key", "label", "group", "standpoint", "sections", "activities",
                "tools", "template_groups", "calc_tabs", "deadlines"}
    for w in dept.WINGS:
        assert required <= set(w), f"{w['key']} missing fields: {required - set(w)}"
        assert w["activities"], f"{w['key']} has no activities"


def test_superset_of_the_original_nine_profiles():
    original = {"officer", "cita", "drp", "tp", "investigation", "ici", "recovery", "tds", "ca"}
    assert original <= set(dept.WING_KEYS), "taxonomy must keep the existing profile keys"
    # and add the wings the flat model was missing
    assert {"central", "exemptions", "inttax", "audit", "hq"} <= set(dept.WING_KEYS)


def test_designation_tiers_resolve():
    assert dept.designation_tier("ito") == dept.TIER_FIELD
    assert dept.designation_tier("jcit") == dept.TIER_RANGE
    assert dept.designation_tier("addl_cit") == dept.TIER_RANGE
    assert dept.designation_tier("pr_cit") == dept.TIER_COMMISSIONER
    assert dept.designation_tier("pr_ccit") == dept.TIER_APEX
    assert dept.designation_tier("ta") == dept.TIER_MINISTERIAL
    assert dept.designation_tier("ao3") == dept.TIER_MINISTERIAL   # Administrative Officer, not Assessing
    assert dept.designation_tier("nope") is None


def test_every_designation_tier_is_valid():
    for d in dept.DESIGNATIONS:
        assert d["tier"] in dept.TIERS


def test_approver_for_search_and_revision():
    assert set(dept.approver_for("153D")) == {"jcit", "addl_cit"}
    assert set(dept.approver_for("263")) == {"pr_cit", "cit"}
    assert dept.approver_for("144A") == ["jcit", "addl_cit"] or set(dept.approver_for("144A")) == {"jcit", "addl_cit"}
    assert dept.approver_for("999") is None                      # unmapped section


def test_approver_for_151_is_ay_dependent():
    # within 3 years -> Pr.CIT/CIT ; beyond 3 -> Pr.CCIT/CCIT
    assert set(dept.approver_for("151", years_elapsed=2)) == {"pr_cit", "cit"}
    assert set(dept.approver_for("151", years_elapsed=5)) == {"pr_ccit", "ccit"}
    # timing unknown -> union of both, so the UI can still offer options
    assert set(dept.approver_for("151")) == {"pr_cit", "cit", "pr_ccit", "ccit"}
    # tolerate a leading "s"/whitespace/case
    assert dept.approver_for(" S153D ") is not None


def test_taxonomy_is_json_serialisable_and_complete():
    tx = dept.taxonomy()
    s = json.dumps(tx)                      # must not raise
    assert {"tiers", "wings", "designations", "approvals"} <= set(tx)
    assert len(json.loads(s)["wings"]) == len(dept.WINGS)
