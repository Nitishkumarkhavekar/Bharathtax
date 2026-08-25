"""Tests for the built-in template library (app.services.template_library)."""
from app.services import template_library as lib


def test_every_template_has_required_fields():
    for t in lib.library():
        assert t["id"] and t["name"] and t["body"], t
        assert t["side"] in ("officer", "assessee"), t
        assert t["category"] in ("notice", "order", "appeal", "other"), t


def test_every_template_is_grouped_no_other():
    # Guards against adding a template without a topic group (which would fall
    # into the catch-all "Other" bucket in the UI).
    groups = {t["group"] for t in lib.library()}
    assert "Other" not in groups, "a template is missing a _GROUPS mapping"


def test_template_ids_are_unique():
    ids = [t["id"] for t in lib.library()]
    assert len(ids) == len(set(ids))
