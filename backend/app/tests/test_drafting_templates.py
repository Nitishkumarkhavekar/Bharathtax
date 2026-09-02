"""Wing-tailored drafting templates: every officer can reach every template,
but their own function's templates are ranked to the top."""
from app.services import drafting


def _kinds(profile=None, wings=None, designation=None):
    return [t["kind"] for t in drafting.list_templates(profile, wings, designation)]


def test_all_templates_reachable_for_every_profile():
    full = set(drafting.TEMPLATES.keys())
    for prof in ["officer", "recovery", "tp", "tds", "investigation", "ici", "cita", "ca", "all", None]:
        assert set(_kinds(prof)) == full, f"{prof} lost a template"
    # a ministerial designation must still see the whole library, too
    assert set(_kinds("officer", None, "ta")) == full


def test_ministerial_designation_leads_with_its_own_templates():
    # A Tax Assistant leads with the penalty-note + demand-sheet.
    ta_top = _kinds("officer", None, "ta")[:2]
    assert set(ta_top) == {"penalty_default_note", "demand_computation_note"}
    # An Inspector leads with the field/survey desk.
    insp_top = set(_kinds("investigation", None, "inspector")[:3])
    assert insp_top == {"survey_report_133a", "remand_report", "recovery_field_report"}
    # A Notice Server leads with the service endorsements.
    ns_top = set(_kinds(None, None, "notice_server")[:3])
    assert ns_top == {"proof_of_service", "affixture_endorsement", "refusal_endorsement"}


def test_role_templates_dont_crowd_a_plain_officer():
    # With no designation, an Inspector-only template must NOT rank at the top
    # for an ordinary AO — it sits below the officer's own + universal set.
    ordered = _kinds("officer")
    own_or_universal = {
        k for k, t in drafting.TEMPLATES.items()
        if t.get("designations") is None and
        ((t.get("wings") is None) or ("officer" in (t.get("wings") or [])))
    }
    last_lead = max(ordered.index(k) for k in own_or_universal)
    assert ordered.index("survey_report_133a") > last_lead


def test_every_ministerial_template_is_grouped():
    role_kinds = [k for k, t in drafting.TEMPLATES.items() if t.get("designations")]
    assert role_kinds, "expected ministerial/role templates to exist"
    for k in role_kinds:
        assert drafting._TEMPLATE_GROUP.get(k, "Other") != "Other", f"{k} ungrouped"


def test_recovery_sees_its_templates_first():
    top3 = _kinds("recovery")[:3]
    assert set(top3) == {"notice_226_3", "notice_221", "order_220_6"}


def test_officer_leads_with_ao_and_universal():
    # Every officer-wing + universal template ranks above any purely-other-wing
    # template — computed dynamically so it survives new templates being added.
    ordered = _kinds("officer")
    own_or_universal = {
        k for k, t in drafting.TEMPLATES.items()
        if t.get("designations") is None   # role templates are designation-scoped, not universal
        and ((t.get("wings") is None) or ("officer" in (t.get("wings") or [])))
    }
    last_lead = max(ordered.index(k) for k in own_or_universal)
    # A template belonging ONLY to another wing must rank after all of them.
    assert ordered.index("notice_226_3") > last_lead   # recovery-only
    assert ordered.index("show_cause_92ca") > last_lead  # tp-only


def test_tpo_and_cita_and_ca_have_a_dedicated_template():
    assert _kinds("tp")[0] == "show_cause_92ca"
    assert _kinds("cita")[0] == "notice_250"
    assert _kinds("ca")[0] == "reply_notice"


def test_custom_profile_unions_chosen_wings():
    top = _kinds("custom", ["recovery", "tds"])[:4]
    assert "notice_226_3" in top and "notice_201" in top


def test_no_profile_is_natural_order():
    assert _kinds(None)[0] == "notice_142_1"      # first defined, unranked


def test_supervisory_approval_templates_exist_in_officer_wing():
    officer = set(_kinds("officer"))
    assert {"approval_153D", "sanction_151"} <= officer
    # They're AO-wing, so they rank in the officer's own group, not last.
    ordered = _kinds("officer")
    assert ordered.index("approval_153D") < ordered.index("notice_226_3")  # before recovery's
