from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    APP_NAME: str = "TradingPlatform"
    APP_ENV: str = "development"
    FRONTEND_URL: str = "http://localhost:3000"

    TOTP_ISSUER: str = "TradingPlatform"

    # Notifications (all optional — omit to disable that channel)
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    NOTIFY_EMAIL: str | None = None
    SLACK_WEBHOOK_URL: str | None = None


settings = Settings()
