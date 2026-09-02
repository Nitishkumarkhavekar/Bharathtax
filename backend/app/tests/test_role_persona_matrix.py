"""Role × dept matrix — the LLM-persona and reviewer-routing surfaces.

Complements test_role_dept_matrix.py (templates/taxonomy) by sweeping the two
other places a response genuinely diverges by role: the chat-persona preamble
(personalization.build_context + profiles.wing_standpoint/role_standpoint) and
the draft-review reviewer list (draft_review.list_reviewers). Uses the SQLite
`db` + `user_factory` fixtures — no HTTP, no seats, no rate limit.
"""
import pytest

from app.core import department as dept
from app.core import profiles
from app.services import personalization, draft_review
from app.models.org import User


WINGS = dept.WING_KEYS
DESIGS = dept.DESIGNATION_KEYS


# --------------------------------------------------------------------------- #
# 1. Standpoints resolve for every wing / designation without crashing
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("wing", WINGS + ["all", "custom", None])
def test_wing_standpoint_and_label_resolve(wing):
    wings = ["recovery", "tds"] if wing == "custom" else None
    stand = profiles.wing_standpoint(wing, wings)
    assert isinstance(stand, str)                 # never None → never a template hole
    label = profiles.wing_label(wing, wings)
    assert label is None or isinstance(label, str)


@pytest.mark.parametrize("desig", DESIGS + [None, "Joint CIT", "garbage-role"])
def test_role_standpoint_and_tier_resolve(desig):
    line = profiles.role_standpoint(desig)
    assert isinstance(line, str)                   # empty string is fine, None is not
    tier = profiles.role_tier(desig)
    assert tier in ("", "field", "range", "commissioner")


# --------------------------------------------------------------------------- #
# 2. The chat-persona preamble is coherent for every (wing × designation)
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("wing", ["officer", "cita", "investigation", "tds", "recovery", "hq", "ca"])
@pytest.mark.parametrize("desig", ["ito", "inspector", "ta", "notice_server", "jcit", "pr_cit", None])
def test_persona_preamble_names_the_role(db, user_factory, wing, desig):
    u: User = user_factory(1, email="o@x.in", full_name="Test Officer")
    u.workspace_profile = wing
    u.designation = desig
    db.commit()

    ctx = personalization.build_context(db, u, "How do I frame this addition?")
    assert isinstance(ctx, str) and ctx.strip(), f"empty preamble for {wing}/{desig}"
    assert "Role:" in ctx, f"no Role line for {wing}/{desig}"
    # A real designation must surface by its taxonomy label; a wing-only officer
    # must still get a meaningful role line from the wing label.
    if desig:
        assert dept.DESIGNATIONS_BY_KEY[desig]["label"].split(" (")[0][:6] in ctx or desig in ctx.lower() \
            or profiles.role_standpoint(desig) == ""  # ministerial roles may add no seniority line
    else:
        assert profiles.wing_label(wing, None) or wing == "hq"


# --------------------------------------------------------------------------- #
# 3. Reviewer routing — seniors surface first, drafter excluded, same wing only
# --------------------------------------------------------------------------- #
def _mk(db, uid, wing_id, designation, office_id=None, name=None, active=True):
    u = User(id=uid, username=f"u{uid}", email=f"u{uid}@x.in",
             full_name=name or f"User {uid}", password_hash="x",
             wing_id=wing_id, office_id=office_id, designation=designation,
             is_active=active)
    db.add(u); db.commit(); return u


def test_list_reviewers_orders_seniors_first_same_wing_only(db):
    me = _mk(db, 1, wing_id=1, designation="ito", office_id=10)
    _mk(db, 2, wing_id=1, designation="jcit", office_id=10)         # senior, same office
    _mk(db, 3, wing_id=1, designation="ita", office_id=99)          # junior, other office
    _mk(db, 4, wing_id=1, designation="pr_cit", office_id=99)       # senior, other office
    _mk(db, 5, wing_id=2, designation="cit", office_id=10)          # OTHER WING — must be excluded
    _mk(db, 6, wing_id=1, designation="ito", office_id=10, active=False)  # inactive — excluded

    revs = draft_review.list_reviewers(db, me)
    ids = [r["id"] for r in revs]

    assert 1 not in ids, "drafter must be excluded"
    assert 5 not in ids, "other-wing user must be excluded"
    assert 6 not in ids, "inactive user must be excluded"
    assert set(ids) == {2, 3, 4}
    # same-office senior (2) leads; the annotations are correct
    assert revs[0]["id"] == 2
    by = {r["id"]: r for r in revs}
    assert by[2]["is_senior"] and by[2]["same_office"]
    assert by[4]["is_senior"] and not by[4]["same_office"]
    assert by[3]["tier"] in ("", "field")   # unknown/junior designation


def test_every_designation_annotates_a_reviewer_tier(db):
    """No designation, ministerial included, makes list_reviewers blow up or
    yield a bad tier."""
    me = _mk(db, 1, wing_id=7, designation="ito")
    uid = 100
    for d in DESIGS:
        _mk(db, uid, wing_id=7, designation=d); uid += 1
    revs = draft_review.list_reviewers(db, me)
    assert len(revs) == len(DESIGS)
    for r in revs:
        assert r["tier"] in ("", "field", "range", "commissioner")
        assert isinstance(r["is_senior"], bool)
