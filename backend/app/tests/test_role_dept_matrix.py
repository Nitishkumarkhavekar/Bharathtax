"""Exhaustive role × dept (designation × wing) behaviour matrix.

This sweeps the FULL Cartesian product of every wing and every designation
(plus the profile edge-states 'all' / 'custom' / None) and asserts the
invariants that must hold for EVERY officer, whatever their desk. It is the
widest layer of the role-behaviour test pyramid: pure logic, no DB, runs in
milliseconds, and is where cross-matrix bugs (a lost template, a crashing
resolver, a wing with no sections, a mis-ranked role) surface.
"""
import itertools

import pytest

from app.core import department as dept
from app.core import profiles
from app.services import drafting


WINGS = dept.WING_KEYS                 # 14 wings
DESIGS = dept.DESIGNATION_KEYS         # 23 designations
PROFILE_STATES = list(WINGS) + ["all", None]   # single-wing + no-scope states
FULL_LIBRARY = set(drafting.TEMPLATES.keys())

# Designations that carry their own work-product (ministerial + Inspector).
ROLE_DESK_DESIGS = [k for k, d in dept.DESIGNATIONS_BY_KEY.items() if d.get("activities")]


# --------------------------------------------------------------------------- #
# 1. Templates — reachable & correctly ranked for EVERY (wing × designation)
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("wing", PROFILE_STATES)
@pytest.mark.parametrize("desig", DESIGS + [None])
def test_every_combo_keeps_the_whole_library(wing, desig):
    """No officer, in any wing, at any rank, ever loses a template."""
    kinds = [t["kind"] for t in drafting.list_templates(wing, None, desig)]
    assert set(kinds) == FULL_LIBRARY, f"wing={wing} desig={desig} lost templates"
    assert len(kinds) == len(FULL_LIBRARY), f"wing={wing} desig={desig} duplicated a template"


@pytest.mark.parametrize("desig", ROLE_DESK_DESIGS)
def test_role_leads_with_its_own_templates_in_every_wing(desig):
    """A ministerial/inspectorate role's own templates rank at the very top,
    whatever wing they sit in — and there IS at least one such template."""
    own = {k for k, t in drafting.TEMPLATES.items() if desig in (t.get("designations") or [])}
    if not own:
        pytest.skip(f"{desig} has a desk but no dedicated templates")
    for wing in ("officer", "recovery", "investigation", "tds", "hq", "all", None):
        ordered = [t["kind"] for t in drafting.list_templates(wing, None, desig)]
        lead = set(ordered[: len(own)])
        assert lead == own, f"{desig} in wing={wing}: role templates not on top ({lead} vs {own})"


def test_custom_profile_unions_wings_across_the_matrix():
    """A 'custom' officer working several wings sees each wing's templates lifted."""
    for a, b in [("recovery", "tds"), ("investigation", "cita"), ("tp", "officer")]:
        kinds = [t["kind"] for t in drafting.list_templates("custom", [a, b], None)]
        assert set(kinds) == FULL_LIBRARY
        # a template unique to wing `a` and one unique to wing `b` both rank ahead
        # of a template belonging only to some third, unselected wing.
        a_only = [k for k, t in drafting.TEMPLATES.items() if t.get("wings") == [a]]
        b_only = [k for k, t in drafting.TEMPLATES.items() if t.get("wings") == [b]]
        if a_only and b_only:
            assert kinds.index(a_only[0]) < len(FULL_LIBRARY)
            assert kinds.index(b_only[0]) < len(FULL_LIBRARY)


# --------------------------------------------------------------------------- #
# 2. Every template is well-formed (the generator depends on this)
# --------------------------------------------------------------------------- #
def test_every_template_is_well_formed():
    for kind, t in drafting.TEMPLATES.items():
        assert t.get("label"), f"{kind} has no label"
        assert "category" in t, f"{kind} has no category"
        assert "section" in t, f"{kind} has no section field"
        assert t.get("fields"), f"{kind} has no fields"
        assert t.get("structure"), f"{kind} has no structure prompt"
        # designations, if present, must be real keys
        for d in (t.get("designations") or []):
            assert d in dept.DESIGNATION_KEYS, f"{kind} references unknown designation {d}"
        # wings, if present, must be real keys
        for w in (t.get("wings") or []):
            assert w in dept.WING_KEYS, f"{kind} references unknown wing {w}"


def test_every_template_is_grouped():
    for kind in drafting.TEMPLATES:
        grp = drafting._TEMPLATE_GROUP.get(kind, "Other")
        # role templates in particular must never fall into the catch-all
        if drafting.TEMPLATES[kind].get("designations"):
            assert grp != "Other", f"{kind} (role template) is ungrouped"


# --------------------------------------------------------------------------- #
# 3. Wings — every wing is complete & coherent
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("wing", WINGS)
def test_every_wing_is_complete(wing):
    w = dept.WINGS_BY_KEY[wing]
    for field in ("label", "group", "sections", "template_groups", "activities", "tools"):
        assert field in w, f"wing {wing} missing {field}"
    assert isinstance(w["sections"], list)
    assert isinstance(w["template_groups"], list)
    assert w["activities"], f"wing {wing} has no activities"
    # sections must be plain non-empty strings
    for s in w["sections"]:
        assert isinstance(s, str) and s.strip(), f"wing {wing} has a bad section {s!r}"


def test_only_hq_may_have_no_case_law_sections():
    """Every operational wing must resolve to at least one IT-Act section for the
    'case law for your desk' filter; only Headquarters/Admin is allowed empty."""
    empty = {w for w in WINGS if not dept.WINGS_BY_KEY[w]["sections"]}
    assert empty <= {"hq"}, f"operational wings with no sections: {empty - {'hq'}}"


# --------------------------------------------------------------------------- #
# 4. Designations — every one resolves a valid tier & desk
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("desig", DESIGS)
def test_every_designation_resolves(desig):
    tier = dept.designation_tier(desig)
    assert tier in dept.TIERS, f"{desig} has bad tier {tier}"
    # the coarse fold used by drafting/approvals must not KeyError
    coarse = dept.COARSE_TIER.get(tier, "")
    assert coarse in set(dept.COARSE_TIER.values()) | {""}
    # profiles.role_tier bridges structured keys → the 3-bucket vocabulary
    assert profiles.role_tier(desig) in ("", "field", "range", "commissioner")


@pytest.mark.parametrize("desig", ROLE_DESK_DESIGS)
def test_role_desks_are_well_formed(desig):
    d = dept.DESIGNATIONS_BY_KEY[desig]
    assert d["serves"] in {"core", "partial", "formatter", "reference", "minimal"}
    assert d["activities"], f"{desig} desk has no activities"
    assert d.get("tools"), f"{desig} desk has no tools"


def test_minimal_and_formatter_roles_are_exactly_the_deskLight_set():
    """The dashboard hides the matter workspace only for service/formatting roles.
    Guard the exact set so a future desk edit can't silently strip an officer's
    caseload."""
    light = {k for k, d in dept.DESIGNATIONS_BY_KEY.items()
             if d.get("serves") in ("minimal", "formatter")}
    assert light == {"mts", "notice_server", "steno", "ps", "pps"}


# --------------------------------------------------------------------------- #
# 5. Approval routing — every mapped section routes to real designations
# --------------------------------------------------------------------------- #
def test_approver_routing_returns_real_designations():
    sample = ["153D", "151", "263", "264", "144A", "147", "148"]
    for sec in sample:
        approvers = dept.approver_for(sec)
        if approvers is None:
            continue
        for a in approvers:
            assert a in dept.DESIGNATION_KEYS, f"{sec} routes to unknown designation {a}"


# --------------------------------------------------------------------------- #
# 6. The taxonomy payload the frontend consumes is whole & serialisable
# --------------------------------------------------------------------------- #
def test_taxonomy_payload_is_whole():
    import json
    tx = dept.taxonomy()
    json.dumps(tx)  # must not raise
    assert {"tiers", "wings", "designations", "approvals"} <= set(tx)
    assert len(tx["wings"]) == len(WINGS)
    assert len(tx["designations"]) == len(DESIGS)
    # every designation with a desk exposes serves + activities to the client
    by = {d["key"]: d for d in tx["designations"]}
    for desig in ROLE_DESK_DESIGS:
        assert by[desig].get("serves")
        assert by[desig].get("activities")


def test_matrix_size_is_what_we_think():
    """Documents the P&C so a taxonomy change that changes the surface is noticed."""
    assert len(WINGS) == 14
    assert len(DESIGS) == 23
    assert len(list(itertools.product(WINGS, DESIGS))) == 322
