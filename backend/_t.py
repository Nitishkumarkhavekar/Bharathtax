import json, time, re, traceback
R = open("/app/_result.txt", "w", buffering=1)
def out(*a): print(*a, file=R); R.flush()
try:
    from app.core.db import SessionLocal
    from app.models.appeal import AppealCase, AppealDocument, AppealRun, AppealOutput
    from app.models.org import User
    from app.services import appeal_draft as svc
    from sqlalchemy import select
    docs = json.load(open("/app/_raju_docs.json"))
    db = SessionLocal(); u = db.scalar(select(User).limit(1))
    c = AppealCase(owner_user_id=u.id, wing_id=u.wing_id, title="[T]", pan="ALKPR4293F", assessment_year="2017-18", status="new")
    db.add(c); db.commit(); db.refresh(c)
    for d in docs:
        db.add(AppealDocument(case_id=c.id, filename=d["filename"], category=d["category"], minio_key="t", text=d["text"], pages=1))
    r = AppealRun(case_id=c.id, created_by=u.id, status="queued"); db.add(r); db.commit(); db.refresh(r)
    t = time.time(); svc.run_case(r.id); db.refresh(r)
    dr = db.scalar(select(AppealOutput).where(AppealOutput.run_id==r.id, AppealOutput.kind=="draft"))
    comp = db.scalar(select(AppealOutput).where(AppealOutput.run_id==r.id, AppealOutput.kind=="compliance"))
    cc = dr.content if dr else ""
    cj = json.loads(comp.content) if comp else {}
    out("STATUS", r.status, "%.0fs"%(time.time()-t), "chars", len(cc))
    out("compliance.ocr_repaired :", cj.get("ocr_repaired"))
    out("compliance.unreadable   :", cj.get("unreadable"))
    out("no-regression 21,49,429  :", "21,49,429" in cc)
    out("no-regression not-pressed:", "not pressed" in cc.lower() or "infructuous" in cc.lower())
    db.delete(c); db.commit(); db.close()
    out("__DONE__")
except Exception as e:
    out("__ERROR__", repr(e)); out(traceback.format_exc())
