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
    # order_served fans out to the CIT(A) appeal window and the 264 revision window.
    cita = next(d for d in created if d.kind == "appeal_cita")
    assert cita.section_ref == "Sec. 249"
    assert cita.due_date == date(2026, 8, 31)
    # A reminder is seeded for every auto deadline created.
    rems = ws.list_reminders(db, 1)
    assert len(rems) == len(created)
    assert any(r.deadline_id == cita.id for r in rems)


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


def test_demand_crud_scoped_and_interest(db):
    from datetime import date
    m = _matter(db, 1)
    d = ws.create_demand(db, m.id, 1, amount=1_000_000, paid=200_000,
                         default_date=date(2024, 1, 1), section="156")
    assert d is not None
    # A non-owner cannot create a demand on someone else's matter.
    assert ws.create_demand(db, m.id, 2, amount=5000) is None
    # 220(2) interest to date on the outstanding balance.
    out = ws.demand_with_interest(d, today=date(2024, 7, 1))
    assert out["outstanding"] == 800_000
    assert out["interest_220_2"] == 48_000     # 800000 × 1% × 6
    assert out["total_due"] == 848_000
    # Non-owner cannot update or delete.
    assert ws.update_demand(db, d.id, 2, status="paid") is None
    assert ws.delete_demand(db, d.id, 2) is False
    # Owner can, and a paid demand accrues no interest.
    # Portfolio view surfaces the demand while it is outstanding.
    ws.update_demand(db, d.id, 1, status="outstanding")
    wl = ws.workload(db, 1)
    row = next(r for r in wl["matters"] if r["id"] == m.id)
    assert row["demand_due"] > 0
    ws.update_demand(db, d.id, 1, status="paid")
    assert ws.demand_with_interest(db.get(type(d), d.id), today=date(2024, 7, 1))["interest_220_2"] == 0
    # A 'reduced' demand still has a payable balance → 220(2) keeps accruing.
    d2 = ws.create_demand(db, m.id, 1, amount=500_000, default_date=date(2024, 1, 1), status="reduced")
    assert ws.demand_with_interest(d2, today=date(2024, 7, 1))["interest_220_2"] == 30_000
    assert ws.delete_demand(db, d.id, 1) is True
