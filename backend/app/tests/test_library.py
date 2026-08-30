"""My Library service — save / list / delete, idempotency and ownership.

DB-backed via the in-memory SQLite fixture (see conftest). Exercises the CRUD
and the invariants that matter: a source can't be double-saved, users can't
touch each other's items, and un-save works by id and by source ref.
"""
import pytest

from app.services import library as lib


@pytest.fixture
def two_users(user_factory):
    return user_factory(1, email="ao@x.com"), user_factory(2, email="ca@x.com")


def test_save_and_list_scoped_to_user(db, two_users):
    lib.save_item(db, 1, kind="answer", title="§68 test", content="held...", sections=["68"])
    lib.save_item(db, 2, kind="ruling", title="Beta", content="digest", ref_id="corpus:9")

    u1 = lib.list_items(db, 1)
    u2 = lib.list_items(db, 2)
    assert [i.title for i in u1] == ["§68 test"]
    assert [i.title for i in u2] == ["Beta"]
    # a user never sees another user's items
    assert all(i.user_id == 1 for i in u1)


def test_save_is_idempotent_on_ref(db, two_users):
    a = lib.save_item(db, 1, kind="ruling", title="Alpha", content="d1", ref_id="corpus:5")
    b = lib.save_item(db, 1, kind="ruling", title="Alpha (again)", content="d2", ref_id="corpus:5")
    assert a.id == b.id                      # same row returned, not a duplicate
    assert len(lib.list_items(db, 1)) == 1
    # the first save's content is kept (re-save is a no-op, not an overwrite)
    assert lib.list_items(db, 1)[0].content == "d1"


def test_same_ref_different_users_are_distinct(db, two_users):
    lib.save_item(db, 1, kind="ruling", title="Alpha", content="d", ref_id="corpus:5")
    lib.save_item(db, 2, kind="ruling", title="Alpha", content="d", ref_id="corpus:5")
    assert len(lib.list_items(db, 1)) == 1
    assert len(lib.list_items(db, 2)) == 1   # uniqueness is per-user


def test_null_ref_items_are_not_deduped(db, two_users):
    lib.save_item(db, 1, kind="note", title="n1", content="a")
    lib.save_item(db, 1, kind="note", title="n2", content="b")
    assert len(lib.list_items(db, 1)) == 2   # NULL ref_id → many allowed


def test_list_filter_by_kind(db, two_users):
    lib.save_item(db, 1, kind="answer", title="ans", content="a")
    lib.save_item(db, 1, kind="ruling", title="rul", content="r", ref_id="corpus:1")
    assert {i.kind for i in lib.list_items(db, 1, kind="ruling")} == {"ruling"}
    assert len(lib.list_items(db, 1, kind="answer")) == 1


def test_unknown_kind_coerced_to_note(db, two_users):
    it = lib.save_item(db, 1, kind="bogus", title="x", content="y")
    assert it.kind == "note"


def test_delete_by_id_is_ownership_scoped(db, two_users):
    it = lib.save_item(db, 1, kind="answer", title="mine", content="a")
    # user 2 can't delete user 1's item
    assert lib.delete_item(db, it.id, 2) is False
    assert len(lib.list_items(db, 1)) == 1
    # owner can
    assert lib.delete_item(db, it.id, 1) is True
    assert lib.list_items(db, 1) == []


def test_delete_by_ref_toggles_off(db, two_users):
    lib.save_item(db, 1, kind="ruling", title="Alpha", content="d", ref_id="corpus:5")
    assert lib.saved_refs(db, 1, kind="ruling") == ["corpus:5"]
    assert lib.delete_by_ref(db, 1, kind="ruling", ref_id="corpus:5") is True
    assert lib.saved_refs(db, 1, kind="ruling") == []
    # un-saving something not saved is a harmless no-op (idempotent toggle)
    assert lib.delete_by_ref(db, 1, kind="ruling", ref_id="corpus:5") is False


def test_saved_refs_only_returns_non_null(db, two_users):
    lib.save_item(db, 1, kind="note", title="free note", content="a")          # no ref
    lib.save_item(db, 1, kind="ruling", title="Alpha", content="d", ref_id="corpus:5")
    assert lib.saved_refs(db, 1) == ["corpus:5"]


def test_item_out_shape(db, two_users):
    it = lib.save_item(db, 1, kind="ruling", title="Alpha", content="d",
                       source_url="http://x/5", sections=["68", "115BBE"], ref_id="corpus:5")
    out = lib.item_out(it)
    assert out["kind"] == "ruling" and out["ref_id"] == "corpus:5"
    assert out["sections"] == ["68", "115BBE"]
    assert set(out) == {"id", "kind", "title", "content", "source_url",
                        "sections", "ref_id", "created_at"}
