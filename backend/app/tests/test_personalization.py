"""Platform-wide personalization: the persistent officer profile + custom
instructions + cross-chat memory must reach the LIVE chat prompt (agent /
multi-agent), not just the legacy fallback."""
from app.services import personalization as pers
from app.services import agent, multi_agent


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
