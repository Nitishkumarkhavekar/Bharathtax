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

    # minio
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_secure: bool = False
    minio_bucket_raw: str = "taxmedha-raw"
    minio_region: str = "in-local"

    # ml server
    ml_server_url: str = "http://ml-server:8001"
    embedding_model: str = "BAAI/bge-m3"
    embedding_dim: int = 1024
    reranker_model: str = "BAAI/bge-reranker-v2-m3"
    ml_device: str = "cpu"

    # llm (behind LLMClient abstraction)
    llm_backend: str = "mock"  # mock | ollama | vllm | openai
    llm_model_name: str = "qwen2.5:3b-instruct"
    llm_base_url: str = "http://host.docker.internal:11434/v1"
    llm_api_key: str = "not-needed"
    llm_max_tokens: int = 1024
    llm_temperature: float = 0.1

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
