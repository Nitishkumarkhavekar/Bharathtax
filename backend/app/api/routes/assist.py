"""Authoring helpers shared by the Ask Bot and Documents input boxes.
Currently: "Improve prompt" — refine a rough query into a professional one."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import Principal, get_principal
from app.schemas import ImprovePromptRequest, ImprovePromptResponse
from app.services import prompt_refine

router = APIRouter(prefix="/assist", tags=["assist"])


@router.post("/improve-prompt", response_model=ImprovePromptResponse)
def improve_prompt(body: ImprovePromptRequest,
                   _: Principal = Depends(get_principal)) -> ImprovePromptResponse:
    improved = prompt_refine.refine(body.text, context=body.context or "ask")
    return ImprovePromptResponse(original=body.text, improved=improved,
                                 changed=improved.strip() != (body.text or "").strip())
