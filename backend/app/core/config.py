"""Central settings. Every URL, model name, secret, and path comes from the
environment (coding standard: nothing hardcoded). Import `settings` everywhere."""
from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # general
    app_env: str = "dev"
    app_name: str = "BharathTax"
    log_level: str = "INFO"

    # postgres
    postgres_host: str = "postgres"
    postgres_port: int = 5432
    postgres_db: str = "taxmedha"
    postgres_user: str = "taxmedha"
    postgres_password: str = "change-me"

    # redis / celery
    redis_url: str = "redis://redis:6379/0"

    # minio (kept for legacy compatibility with older read paths; not used
    # for new writes now that R2 is the sole object store).
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_secure: bool = False
    minio_bucket_raw: str = "taxmedha-raw"
    minio_region: str = "in-local"

    # Cloudflare R2 — durable object store. When `r2_account_id` is set,
    # every put/get in services/storage.py routes here and MinIO is untouched.
    # See services/storage.py for the switching logic.
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_endpoint: str = ""           # `<account_id>.r2.cloudflarestorage.com`
    r2_bucket_raw: str = ""
    r2_region: str = "auto"
    r2_signed_url_ttl_seconds: int = 24 * 3600

    # ml server
    ml_server_url: str = "http://ml-server:8001"
    embedding_model: str = "BAAI/bge-m3"
    embedding_dim: int = 1024
    reranker_model: str = "BAAI/bge-reranker-v2-m3"
    ml_device: str = "cpu"

    # llm (behind LLMClient abstraction)
    llm_backend: str = "mock"  # mock | ollama | vllm | openai
    llm_model_name: str = "qwen2.5:3b-instruct"
    llm_fallback_model_name: str = ""   # optional ungrounded model for basic Q&A when primary refuses
    llm_base_url: str = "http://host.docker.internal:11434/v1"
    llm_api_key: str = "not-needed"
    llm_max_tokens: int = 1024
    llm_temperature: float = 0.1

    # batch digest generation (case-law headnotes) — points at the high-throughput
    # GPU vLLM (Llama-3.1-8B) by default; override via env for a different endpoint.
    digest_llm_url: str = "http://139.84.144.69:8002/v1"
    digest_llm_model: str = "llama-3.1-8b-instruct"

    # retrieval
    retrieval_dense_k: int = 20
    retrieval_sparse_k: int = 20
    retrieval_rerank_k: int = 8
    retrieval_min_score: float = 0.30

    # auth / licensing
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480
    seat_lease_heartbeat_seconds: int = 120

    # ingestion
    sources_config: str = "/app/config/sources.yaml"
    manual_drop_dir: str = "/data/manual"
    crawl_cache_dir: str = "/data/cache"
    crawl_rate_limit_seconds: int = 3
    crawl_user_agent: str = "BharathTax-Ingest/0.1"
    incremental_update_cron: str = "0 2 * * *"

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
