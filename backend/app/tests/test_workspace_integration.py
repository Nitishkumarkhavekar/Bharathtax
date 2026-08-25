"""DB-backed integration tests for the workspace service — focus on OWNERSHIP
and SHARING access control (the security-critical logic)."""
from __future__ import annotations

from datetime import date

from app.services import workspace as ws
from app.models.workspace import MatterShare


def _matter(db, uid, title="M"):
    return ws.create_matter(db, uid, title=title)


# --- ownership ---------------------------------------------------------------
def test_get_matter_is_owner_only(db):
    m = _matter(db, 1)
    assert ws.get_matter(db, m.id, 1) is not None
    assert ws.get_matter(db, m.id, 2) is None            # another user cannot


def test_list_matters_is_per_user(db):
    ws.create_matter(db, 1, title="A")
    ws.create_matter(db, 1, title="B")
    ws.create_matter(db, 2, title="C")
    assert {m.title for m in ws.list_matters(db, 1)} == {"A", "B"}
    assert {m.title for m in ws.list_matters(db, 2)} == {"C"}


def test_note_and_deadline_scoped_to_user(db):
    m = _matter(db, 1)
    n = ws.create_note(db, 1, "secret", matter_id=m.id)
    assert ws.update_note(db, n.id, 2, body="hacked") is None      # not your note
    assert ws.delete_note(db, n.id, 2) is False
    assert ws.update_note(db, n.id, 1, body="ok").body == "ok"

    d = ws.compute_and_store(db, m.id, 1, "order_served", date(2026, 8, 1))[0]
    assert ws.update_deadline(db, d.id, 2, status="done") is None  # not your deadline
    assert ws.update_deadline(db, d.id, 1, status="done").status == "done"


def test_templates_and_watchlists_scoped(db):
    t = ws.create_template(db, 1, name="T", body="b")
    assert ws.list_templates(db, 2) == []
    assert ws.delete_template(db, t.id, 2) is False
    w = ws.create_watchlist(db, 1, label="L", query="q")
    assert ws.list_watchlists(db, 2) == []
    assert ws.delete_watchlist(db, w.id, 2) is False


# --- statutory compute -------------------------------------------------------
def test_compute_creates_deadlines_and_seeds_reminder(db):
    m = _matter(db, 1)
    created = ws.compute_and_store(db, m.id, 1, "order_served", date(2026, 8, 1))
    assert len(created) == 1
    assert created[0].section_ref == "Sec. 249"
    assert created[0].due_date == date(2026, 8, 31)
    rems = ws.list_reminders(db, 1)
    assert len(rems) == 1 and rems[0].deadline_id == created[0].id


def test_compute_blocked_for_non_owner(db):
    m = _matter(db, 1)
    assert ws.compute_and_store(db, m.id, 2, "order_served", date(2026, 8, 1)) == []


def test_workload_summary_next_deadline_and_counts(db):
    m = _matter(db, 1, "case")
    ws.add_manual_deadline(db, m.id, 1, label="near", due_date=date(2026, 9, 4))
    ws.add_manual_deadline(db, m.id, 1, label="old", due_date=date(2026, 8, 30))
    wl = ws.workload(db, 1, today=date(2026, 9, 1))
    s = wl["summary"]
    assert s["total_matters"] == 1 and s["overdue"] == 1 and s["due_7"] == 1
    row = wl["matters"][0]
    assert row["open_count"] == 2 and row["overdue_count"] == 1 and row["urgent_count"] == 1
    assert row["next_due_date"] == "2026-08-30"          # earliest open deadline


def test_calendar_is_per_user(db):
    m = _matter(db, 1)
    ws.compute_and_store(db, m.id, 1, "order_served", date(2026, 8, 1))
    assert len(ws.calendar(db, 1, date(2026, 1, 1), date(2027, 1, 1))) >= 1
    assert ws.calendar(db, 2, date(2026, 1, 1), date(2027, 1, 1)) == []


# --- collaboration / sharing -------------------------------------------------
def test_share_grants_read_not_write(db):
    m = _matter(db, 1, "shared")
    assert ws.readable_matter(db, m.id, 2) is None                 # not shared yet
    assert m.id not in {x.id for x in ws.list_matters(db, 2)}

    db.add(MatterShare(matter_id=m.id, owner_user_id=1, shared_with_user_id=2, permission="view"))
    db.commit()

    assert ws.readable_matter(db, m.id, 2) is not None             # can READ
    assert ws.get_matter(db, m.id, 2) is None                      # cannot WRITE (owner-only)
    assert m.id in {x.id for x in ws.list_matters(db, 2)}          # appears in their list


def test_share_matter_by_email_flow(db, user_factory):
    user_factory(1, email="owner@x.com")
    user_factory(2, email="colleague@x.com")
    m = _matter(db, 1)

    status, share = ws.share_matter(db, m.id, 1, "Colleague@X.com")  # case-insensitive
    assert status == "ok" and share["email"] == "colleague@x.com"

    assert ws.share_matter(db, m.id, 1, "colleague@x.com")[0] == "exists"   # dedup
    assert ws.share_matter(db, m.id, 1, "nobody@x.com")[0] == "no_user"     # unknown
    assert ws.share_matter(db, m.id, 2, "colleague@x.com")[0] == "no_matter"  # non-owner

    assert ws.list_shares(db, m.id, 2) is None                     # non-owner can't list
    rows = ws.list_shares(db, m.id, 1)
    assert len(rows) == 1 and rows[0]["email"] == "colleague@x.com"

    assert ws.unshare(db, rows[0]["id"], 2) is False               # non-owner can't unshare
    assert ws.unshare(db, rows[0]["id"], 1) is True
    assert ws.list_shares(db, m.id, 1) == []
