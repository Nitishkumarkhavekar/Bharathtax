#!/bin/bash
# BharathTax model watchdog.
#
# Restarts the GPU-box model backends if they stop responding, so a crashed
# ml-server / vLLM / RAG-API self-heals instead of turning into an outage.
#
# SAFETY: only ever touches BharathTax's own containers/services. It never
# touches the translation project (kasturi/indictrans/ControlMT/gemma/sarvam),
# and it refuses to (re)start a GPU model when there isn't enough free VRAM —
# so if the GPU is busy (e.g. a training job), it logs and skips rather than
# fighting for memory.
set -uo pipefail

LOG=/var/log/model-watchdog.log
ML_CONTAINER=bharathtax-ml-ml-server-1
LLM_CONTAINER=bharathtax-llm-llm-1
RAG_SERVICE=bharattax-api

ts()  { date -u '+%FT%TZ'; }
log() { echo "$(ts) $*" >> "$LOG"; }

free_gpu() { nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' '; }

# healthy() URL -> 0 if the endpoint answers with an expected status
healthy() {
  local code
  code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null)
  [[ "$code" == "200" || "$code" == "401" ]]
}

# --- ml-server (bge-m3 embeddings + reranker) :8001 -------------------------
if ! healthy http://127.0.0.1:8001/health; then
  st=$(docker inspect -f '{{.State.Status}}' "$ML_CONTAINER" 2>/dev/null || echo missing)
  fg=$(free_gpu); fg=${fg:-0}
  if [[ "$fg" -ge 3000 ]]; then
    log "ml-server DOWN (state=$st, freeGPU=${fg}MiB) -> restarting"
    docker start "$ML_CONTAINER" >>"$LOG" 2>&1 || docker restart "$ML_CONTAINER" >>"$LOG" 2>&1
  else
    log "ml-server DOWN (state=$st) but freeGPU=${fg}MiB < 3000 -> SKIP (GPU busy)"
  fi
fi

# --- vLLM llama :8002 -------------------------------------------------------
if ! healthy http://127.0.0.1:8002/v1/models; then
  st=$(docker inspect -f '{{.State.Status}}' "$LLM_CONTAINER" 2>/dev/null || echo missing)
  fg=$(free_gpu); fg=${fg:-0}
  if [[ "$fg" -ge 6000 ]]; then
    log "vLLM DOWN (state=$st, freeGPU=${fg}MiB) -> restarting"
    docker start "$LLM_CONTAINER" >>"$LOG" 2>&1 || docker restart "$LLM_CONTAINER" >>"$LOG" 2>&1
  else
    log "vLLM DOWN (state=$st) but freeGPU=${fg}MiB < 6000 -> SKIP (GPU busy)"
  fi
fi

# --- RAG API :8080 (systemd; process needs no GPU, depends on ml-server) -----
if ! healthy http://127.0.0.1:8080/health; then
  log "rag-api DOWN -> restarting $RAG_SERVICE"
  systemctl restart "$RAG_SERVICE" >>"$LOG" 2>&1
fi

exit 0
