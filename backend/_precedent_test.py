"""One-off: compare OLD vs NEW (precedent-aware) per-ground drafting on a real
case, WITHOUT touching live drafts. Run inside the api container:
    docker exec bharathtax-web-api-1 python /app/_precedent_test.py
"""
import sys
from sqlalchemy import select, desc
from app.core.db import SessionLocal
from app.models.appeal import AppealCase, AppealRun, AppealOutput
from app.services import appeal_draft as ad

MAX_GROUNDS = int(sys.argv[1]) if len(sys.argv) > 1 else 2


def main():
    db = SessionLocal()
    # newest run that produced findings
    run = db.scalar(
        select(AppealRun).where(AppealRun.status == "done").order_by(desc(AppealRun.id))
    )
    if not run:
        print("no done run found"); return
    case = db.get(AppealCase, run.case_id)
    findings = list(db.scalars(
        select(AppealOutput).where(
            AppealOutput.run_id == run.id, AppealOutput.kind == "finding"
        ).order_by(AppealOutput.seq)
    ))
    print(f"CASE #{case.id} '{case.title}'  run={run.id}  documents={len(case.documents)}  "
          f"findings={len(findings)}\n" + "=" * 100)

    for f in findings[:MAX_GROUNDS]:
        issue = {"issue": f.label or ""}
        q = issue["issue"]
        print(f"\n\n########## GROUND: {q}\n")

        # what precedent do we now retrieve?
        docs_text = ad._issue_doc_context(case, q)
        prec_text, prec_cites = ad._precedent(db, f"{q}. {ad._trim(docs_text, 600)}")
        print(f"--- RETRIEVED PRECEDENTS ({len(prec_cites)}) ---")
        print(prec_text[:1600] or "(none)")

        print("\n--- OLD FINDING (stored, statute-only) [tail] ---")
        print((f.content or "")[-900:])

        print("\n--- NEW FINDING (precedent-aware) [tail] ---")
        new_block, _ = ad.draft_issue(db, case, issue)
        print((new_block or "")[-900:])
        print("\n" + "=" * 100)

    db.close()


if __name__ == "__main__":
    main()
