from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    zammad_base_url: str = "https://support.example.com"
    zammad_api_token: str = ""
    zammad_webhook_secret: str = "changeme"
    redis_url: str = "redis://redis:6379/0"
    database_url: str = "postgresql+asyncpg://postgres:postgres@db:5432/zammad_dashboard"
    jwt_secret_key: str = "changeme-256bit-secret"
    jwt_expiry_hours: int = 8
    cors_origins: list[str] = ["http://localhost:5173"]

    class Config:
        env_file = Path(__file__).resolve().parents[2] / ".env"
        extra = "ignore"


settings = Settings()
