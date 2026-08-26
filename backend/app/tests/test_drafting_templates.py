"""Wing-tailored drafting templates: every officer can reach every template,
but their own function's templates are ranked to the top."""
from app.services import drafting


def _kinds(profile=None, wings=None):
    return [t["kind"] for t in drafting.list_templates(profile, wings)]


def test_all_templates_reachable_for_every_profile():
    full = set(drafting.TEMPLATES.keys())
    for prof in ["officer", "recovery", "tp", "tds", "investigation", "ici", "cita", "ca", "all", None]:
        assert set(_kinds(prof)) == full, f"{prof} lost a template"


def test_recovery_sees_its_templates_first():
    top3 = _kinds("recovery")[:3]
    assert set(top3) == {"notice_226_3", "notice_221", "order_220_6"}


def test_officer_leads_with_ao_and_universal():
    # An AO's own + the universal notices rank above other wings' templates.
    ordered = _kinds("officer")
    officer_and_universal = {"notice_143_2", "order_154", "notice_142_1", "show_cause"}
    lead = set(ordered[:len(officer_and_universal)])
    assert lead == officer_and_universal
    # A recovery-only template ranks after them.
    assert ordered.index("notice_226_3") > max(ordered.index(k) for k in officer_and_universal)


def test_tpo_and_cita_and_ca_have_a_dedicated_template():
    assert _kinds("tp")[0] == "show_cause_92ca"
    assert _kinds("cita")[0] == "notice_250"
    assert _kinds("ca")[0] == "reply_notice"


def test_custom_profile_unions_chosen_wings():
    top = _kinds("custom", ["recovery", "tds"])[:4]
    assert "notice_226_3" in top and "notice_201" in top


def test_no_profile_is_natural_order():
    assert _kinds(None)[0] == "notice_142_1"      # first defined, unranked
