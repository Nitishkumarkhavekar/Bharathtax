"""Platform-wide personalization: the persistent officer profile + custom
instructions + cross-chat memory must reach the LIVE chat prompt (agent /
multi-agent), not just the legacy fallback."""
from app.services import personalization as pers
from app.services import agent, multi_agent
from app.services import assessment_draft, appeal_draft
from app.core import profiles as wing


def _officer(db, user_factory):
    u = user_factory(1)
    u.charge = "Ward 28(1), Delhi"
    u.designation = "Assessing Officer"
    db.commit()
    return u


def test_build_context_carries_profile_instructions_and_memory(db, user_factory):
    u = _officer(db, user_factory)
    pers.update_settings(db, u.id, custom_instructions="Always cite the section.",
                         about_me="I handle high-pitched scrutiny cases.",
                         style={"concise": True})
    pers.add_memory(db, u.id, "Working the ABC Traders group for AY 2021-22.")
    ctx = pers.build_context(db, u, "what is the limitation for AY 2021-22?")
    assert "Ward 28(1), Delhi" in ctx           # charge/posting
    assert "Assessing Officer" in ctx           # designation
    assert "Always cite the section." in ctx    # custom instructions
    assert "high-pitched scrutiny" in ctx       # about_me
    assert "ABC Traders" in ctx                 # cross-chat memory


def test_persona_system_appends_to_base_prompt(db, user_factory):
    u = _officer(db, user_factory)
    pers.update_settings(db, u.id, custom_instructions="Be brief.")
    base = agent._dated(agent._SYSTEM)
    got = agent._persona_system(db, u.id, "any question")
    assert got.startswith(base)                 # base prompt preserved
    assert len(got) > len(base)                 # persona appended
    assert "Ward 28(1), Delhi" in got


def test_multi_agent_persona_ctx_matches(db, user_factory):
    u = _officer(db, user_factory)
    pers.update_settings(db, u.id, about_me="TP specialist.")
    ctx = multi_agent._persona_ctx(db, u.id, "benchmarking question")
    assert "TP specialist." in ctx


def test_memory_off_suppresses_memory(db, user_factory):
    u = _officer(db, user_factory)
    pers.update_settings(db, u.id, memory_enabled=False)
    pers.add_memory(db, u.id, "Secret working note.")
    ctx = pers.build_context(db, u, "anything")
    assert "Secret working note." not in ctx


def test_remember_if_requested_captures_fact(db, user_factory):
    u = _officer(db, user_factory)
    m = pers.remember_if_requested(db, u, "remember that I prefer short findings")
    assert m is not None and "short findings" in m.content
    # It's now a durable memory, retrievable in build_context.
    assert "short findings" in pers.build_context(db, u, "draft a finding")


# ---- Phase 2: personalization reaches the DRAFTING engines -------------------
def test_drafting_persona_carries_charge_and_instructions(db, user_factory):
    u = _officer(db, user_factory)
    pers.update_settings(db, u.id, custom_instructions="Number every paragraph.",
                         style={"concise": True})
    p = pers.drafting_persona(db, u)
    assert "Ward 28(1), Delhi" in p            # jurisdiction on the letterhead
    assert "Assessing Officer" in p            # designation
    assert "Number every paragraph." in p      # drafting instruction
    assert "concise" in p                      # house style


def test_drafting_persona_excludes_cross_matter_memory(db, user_factory):
    """An order must rest only on THIS case's record — the officer's other
    matters must never bleed into a draft."""
    u = _officer(db, user_factory)
    pers.add_memory(db, u.id, "Working the ABC Traders group for AY 2021-22.")
    p = pers.drafting_persona(db, u)
    assert "ABC Traders" not in p              # memory is NOT in the drafting persona
    # …but it IS in the chat context, proving the two assemblers differ.
    assert "ABC Traders" in pers.build_context(db, u, "abc traders")


def test_drafting_persona_empty_without_profile(db, user_factory):
    u = user_factory(2)                        # no designation, charge or settings
    assert pers.drafting_persona(db, u) == ""


def test_persona_is_additive_default_is_unchanged():
    """persona="" must reproduce the base system prompt byte-for-byte, so
    drafting is identical when no personalization is set (zero-regression)."""
    assert assessment_draft._sys("") == assessment_draft.ASSESSMENT_SYSTEM
    assert appeal_draft._sys("") == appeal_draft.OFFICER_SYSTEM
    a = assessment_draft._sys("PERSONA-LINE")
    assert a.startswith("PERSONA-LINE") and a.endswith(assessment_draft.ASSESSMENT_SYSTEM)
    b = appeal_draft._sys("PERSONA-LINE")
    assert b.startswith("PERSONA-LINE") and b.endswith(appeal_draft.OFFICER_SYSTEM)


# ---- Wing-aware chat persona (per-function standpoint) -----------------------
def test_wing_helpers_map_key_to_label_and_standpoint():
    assert wing.wing_label("tp") == "Transfer Pricing (TPO)"
    assert "arm's-length" in wing.wing_standpoint("tp")
    assert "assessee" in wing.wing_standpoint("ca")          # CA argues the other side
    # custom → first recognised chosen wing wins
    assert wing.wing_label("custom", ["nonsense", "recovery"]) == "Recovery / TRO"
    assert wing.wing_standpoint("all") == "" and wing.wing_standpoint(None) == ""


def test_build_context_uses_wing_when_designation_blank(db, user_factory):
    u = user_factory(7)                     # no designation set
    u.workspace_profile = "tp"
    db.commit()
    ctx = pers.build_context(db, u, "which method for benchmarking?")
    assert "Transfer Pricing" in ctx        # wing label fills the blank designation
    assert "arm's-length" in ctx            # standpoint injected
    # A CA user is framed on the assessee's side, not the department's.
    u.workspace_profile = "ca"
    db.commit()
    assert "assessee" in pers.build_context(db, u, "reply to a 142(1)")
