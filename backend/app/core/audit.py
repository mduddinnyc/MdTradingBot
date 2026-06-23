import uuid
from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import AuditLog


async def log(
    db: AsyncSession,
    action: str,
    outcome: str,
    actor_type: str = "user",
    user_id: uuid.UUID | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    metadata: dict[str, Any] | None = None,
    request: Request | None = None,
) -> None:
    ip = None
    ua = None
    if request:
        forwarded = request.headers.get("X-Forwarded-For")
        ip = forwarded.split(",")[0].strip() if forwarded else request.client.host if request.client else None
        ua = request.headers.get("User-Agent")

    entry = AuditLog(
        user_id=user_id,
        actor_type=actor_type,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id else None,
        ip_address=ip,
        user_agent=ua,
        metadata_=metadata or {},
        outcome=outcome,
    )
    db.add(entry)
    # Caller commits via get_db context manager
