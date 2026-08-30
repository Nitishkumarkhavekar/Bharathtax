"""Draft review & approval workflow — the senior-sanction chain.

DB-backed (SQLite fixture). Covers the state machine, the owner-OR-reviewer
access gates, the edit rules, reviewer listing, and the audit trail.
"""
import pytest

from app.models.drafting import DraftDocument
from app.models.draft_review import DraftReview
from app.services import draft_review as rv


def _draft(db, owner_id, status="draft"):
    d = DraftDocument(user_id=owner_id, wing_id=1, kind="notice_142_1",
                      title="§142(1) — Alpha", inputs={}, content="body", status=status)
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


@pytest.fixture
def people(db, user_factory):
    junior = user_factory(1, email="ito@x.com", full_name="ITO Junior")
    senior = user_factory(2, email="jcit@x.com", full_name="JCIT Senior")
    senior.designation = "Joint CIT"
    other = user_factory(3, email="other@x.com", full_name="Other Officer")
    db.commit()
    return junior, senior, other


# --- reviewer listing -------------------------------------------------------
def test_list_reviewers_excludes_self_and_flags_seniors(db, people):
    junior, senior, other = people
    revs = rv.list_reviewers(db, junior)
    ids = [r["id"] for r in revs]
    assert junior.id not in ids               # never yourself
    assert set(ids) == {senior.id, other.id}
    snr = next(r for r in revs if r["id"] == senior.id)
    assert snr["is_senior"] is True and snr["tier"] == "range"
    # seniors sort ahead of field officers
    assert revs[0]["id"] == senior.id


# --- the happy path ---------------------------------------------------------
def test_send_then_approve_flow(db, people):
    junior, senior, other = people
    d = _draft(db, junior.id)

    assert rv.send_for_review(db, d, junior, senior.id, "pls approve") == "ok"
    db.refresh(d)
    assert d.status == "in_review" and d.reviewer_user_id == senior.id
    # a pending review row + a covering note captured
    review = db.query(DraftReview).filter_by(draft_id=d.id).one()
    assert review.status == "pending" and review.request_note == "pls approve"

    # reviewer sees it in their inbox; junior does not
    assert [x.id for x in rv.inbox(db, senior.id)] == [d.id]
    assert rv.inbox_count(db, senior.id) == 1
    assert rv.inbox(db, junior.id) == []

    # reviewer approves with remarks
    assert rv.approve(db, d, senior, "Approved — issue it.") == "ok"
    db.refresh(d)
    assert d.status == "approved"
    review = db.query(DraftReview).filter_by(draft_id=d.id).one()
    assert review.status == "approved" and review.review_remarks == "Approved — issue it."
    assert review.resolved_at is not None
    assert rv.inbox_count(db, senior.id) == 0


def test_return_then_resend(db, people):
    junior, senior, _ = people
    d = _draft(db, junior.id)
    rv.send_for_review(db, d, junior, senior.id, "")
    assert rv.return_draft(db, d, senior, "Fix the AY.") == "ok"
    db.refresh(d)
    assert d.status == "returned"
    # owner can edit a returned draft, then send again -> a second review cycle
    assert rv.can_edit(d, junior.id) is True
    assert rv.send_for_review(db, d, junior, senior.id, "fixed") == "ok"
    assert db.query(DraftReview).filter_by(draft_id=d.id).count() == 2


# --- access + edit gates ----------------------------------------------------
def test_access_gate_owner_reviewer_stranger(db, people):
    junior, senior, other = people
    d = _draft(db, junior.id)
    rv.send_for_review(db, d, junior, senior.id, "")
    # owner + reviewer can view; a stranger cannot
    assert rv.reviewable_draft(db, d.id, junior.id) is not None
    assert rv.reviewable_draft(db, d.id, senior.id) is not None
    assert rv.reviewable_draft(db, d.id, other.id) is None


def test_edit_rules_by_state(db, people):
    junior, senior, _ = people
    d = _draft(db, junior.id)
    # before review: owner edits, would-be reviewer doesn't
    assert rv.can_edit(d, junior.id) is True
    assert rv.can_edit(d, senior.id) is False
    # in review: reviewer edits, owner is locked out
    rv.send_for_review(db, d, junior, senior.id, "")
    db.refresh(d)
    assert rv.can_edit(d, senior.id) is True
    assert rv.can_edit(d, junior.id) is False


# --- guard rails ------------------------------------------------------------
def test_cannot_send_someone_elses_or_twice(db, people):
    junior, senior, other = people
    d = _draft(db, junior.id)
    assert rv.send_for_review(db, d, other, senior.id, "") == "not_owner"
    assert rv.send_for_review(db, d, junior, senior.id, "") == "ok"
    assert rv.send_for_review(db, d, junior, other.id, "") == "already"


def test_only_assigned_reviewer_resolves(db, people):
    junior, senior, other = people
    d = _draft(db, junior.id)
    rv.send_for_review(db, d, junior, senior.id, "")
    assert rv.approve(db, d, other, "") == "not_reviewer"   # not the assigned reviewer
    assert d.status == "in_review"


def test_reviewer_must_be_active_same_wing(db, people, user_factory):
    junior, senior, _ = people
    d = _draft(db, junior.id)
    # a user in a different wing is not a valid reviewer
    outsider = user_factory(9, email="out@x.com")
    outsider.wing_id = 2
    db.commit()
    assert rv.send_for_review(db, d, junior, outsider.id, "") == "no_reviewer"


def test_history_trail(db, people):
    junior, senior, _ = people
    d = _draft(db, junior.id)
    rv.send_for_review(db, d, junior, senior.id, "please review")
    rv.approve(db, d, senior, "ok")
    hist = rv.history(db, d.id)
    assert len(hist) == 1
    assert hist[0]["status"] == "approved"
    assert hist[0]["drafter"] == "ITO Junior" and hist[0]["reviewer"] == "JCIT Senior"
    assert hist[0]["request_note"] == "please review" and hist[0]["review_remarks"] == "ok"
