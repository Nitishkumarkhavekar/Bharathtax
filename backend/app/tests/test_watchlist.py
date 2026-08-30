"""Ruling watchlist — the "fresh law for you" feed.

Covers the pure logic (section-field parsing, wing fallback, resolved wing) and
the ruling-matching filter/dedup/fresh rules with a stubbed DB, so none of this
needs a live Postgres.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services import watchlist as w


# ---- section-field parsing ------------------------------------------------
def test_sections_from_field_drops_subsections_and_reads_chains():
    assert w._sections_from_field("143(3)/147/144") == ["143", "147", "144"]
    assert w._sections_from_field("40(a)(ia)") == ["40"]
    assert w._sections_from_field("271(1)(c)") == ["271"]
    assert w._sections_from_field("Sec. 249") == ["249"]
    assert w._sections_from_field("80-IB") == ["80IB"]
    assert w._sections_from_field(None) == []
    assert w._sections_from_field("") == []


# ---- resolved wing / fallback --------------------------------------------
def test_resolved_wing_prefers_profile_then_custom():
    assert w.resolved_wing(SimpleNamespace(workspace_profile="officer", workspace_wings=None)) == "officer"
    assert w.resolved_wing(SimpleNamespace(workspace_profile="custom", workspace_wings=["tds", "cita"])) == "tds"
    # 'all' / unknown / none -> no wing default
    assert w.resolved_wing(SimpleNamespace(workspace_profile="all", workspace_wings=None)) is None
    assert w.resolved_wing(SimpleNamespace(workspace_profile=None, workspace_wings=None)) is None


def test_every_wing_has_default_sections():
    from app.core.profiles import WORKSPACE_PROFILE_KEYS
    assert set(w.WING_DEFAULT_SECTIONS) == WORKSPACE_PROFILE_KEYS


# ---- ruling matching (stubbed DB) ----------------------------------------
class _StubScalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def __iter__(self):
        return iter(self._rows)


class _StubDB:
    """Returns a fixed judgment set for the fresh_ruling_alerts query; the
    query object itself is ignored (we're testing the post-filter, not SQL)."""
    def __init__(self, rows):
        self._rows = rows

    def scalars(self, _query):
        return _StubScalars(self._rows)


def _doc(id, title, digest, sections, days_ago):
    return SimpleNamespace(
        id=id, title=title, digest=digest, source_url=f"http://x/{id}",
        sections_cited=sections, published_date=None,
        fetched_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
    )


def test_fresh_alerts_filters_dedups_and_flags_fresh():
    rows = [
        _doc(1, "ACIT vs Alpha", "Held: addition u/s 68 sustained", ["68", "115BBE"], 2),
        _doc(2, "ACIT vs Alpha", "duplicate title, newer copy", ["68"], 1),   # dup title -> dropped
        _doc(3, "PCIT vs Beta", "PROCEDURAL", ["68"], 3),                     # sentinel -> dropped
        _doc(4, "CIT vs Gamma", None, ["68"], 3),                            # no digest -> dropped
        _doc(5, "DCIT vs Delta", "Held: 271AAC penalty upheld", ["271AAC"], 90),  # matches, but stale
    ]
    got = w.fresh_ruling_alerts(_StubDB(rows), ["68", "271AAC"], limit=6)
    ids = [g["id"] for g in got]
    assert ids == [1, 5]                      # 2 (dup),3 (sentinel),4 (no digest) gone
    assert got[0]["matched"] == ["68"]        # only the watched section, 115BBE excluded
    assert got[0]["fresh"] is True            # 2 days -> fresh
    assert got[1]["fresh"] is False           # 90 days -> not fresh


def test_fresh_alerts_empty_when_no_sections():
    assert w.fresh_ruling_alerts(_StubDB([]), []) == []


# ---- infer_user_sections against a real (SQLite) session -----------------
def _mk_user(db, user_factory, uid=1, profile="officer"):
    u = user_factory(uid, email=f"u{uid}@x.com")
    u.workspace_profile = profile
    db.commit()
    return u


def test_infer_from_footprint_weights_and_ranks(db, user_factory):
    from app.models.chat import ChatMessage
    from app.models.assessment import AssessmentCase
    from app.models.workspace import Deadline
    from app.services import library as lib

    u = _mk_user(db, user_factory)
    # chat questions (weight 1 each)
    db.add(ChatMessage(chat_id=1, user_id=u.id, role="user", content="What about section 68 additions?"))
    db.add(ChatMessage(chat_id=1, user_id=u.id, role="user", content="Explain u/s 68 creditworthiness"))
    # an assistant turn must NOT contribute
    db.add(ChatMessage(chat_id=1, user_id=u.id, role="assistant", content="Under section 271AAC the penalty..."))
    # a drafted case (weight 3)
    db.add(AssessmentCase(slug="s1", owner_user_id=u.id, wing_id=1, title="X", section="147"))
    # a docket deadline (weight 2)
    from datetime import date
    db.add(Deadline(matter_id=1, user_id=u.id, label="d", section_ref="Sec. 148A", due_date=date(2026, 1, 1)))
    db.commit()
    # a saved ruling (weight 2)
    lib.save_item(db, u.id, kind="ruling", title="R", content="d", sections=["68"], ref_id="corpus:1")

    res = w.infer_user_sections(db, u)
    assert res["source"] == "usage"
    secs = res["sections"]
    # 68 appears in 2 chats (2) + saved ruling (2) = 4 -> top
    assert secs[0] == "68"
    # every discovered section is present
    assert {"68", "147", "148A"}.issubset(set(secs))
    # the assistant-only 271AAC must NOT be inferred (we only read role='user')
    assert "271AAC" not in secs


def test_infer_falls_back_to_wing_when_no_footprint(db, user_factory):
    u = _mk_user(db, user_factory, profile="tds")
    res = w.infer_user_sections(db, u)
    assert res["source"] == "function"
    assert res["sections"] == w.WING_DEFAULT_SECTIONS["tds"][:12]


def test_infer_none_when_no_footprint_and_no_wing(db, user_factory):
    u = _mk_user(db, user_factory, profile="all")   # meta-profile -> no default
    res = w.infer_user_sections(db, u)
    assert res["source"] == "none"
    assert res["sections"] == []


def test_infer_is_user_scoped(db, user_factory):
    from app.models.chat import ChatMessage
    u1 = _mk_user(db, user_factory, uid=1)
    u2 = _mk_user(db, user_factory, uid=2)
    db.add(ChatMessage(chat_id=1, user_id=u1.id, role="user", content="section 92CA arm's length"))
    db.commit()
    # u2 has no footprint -> falls back to wing, never sees u1's 92CA
    res2 = w.infer_user_sections(db, u2)
    assert "92CA" not in res2["sections"]
