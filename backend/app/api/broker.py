import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.core.audit import log as audit_log
from app.core.deps import CurrentUser, DB
from app.core.encryption import encrypt_secret, decrypt_secret
from app.models.broker import BrokerConnection
from app.schemas.auth import MessageResponse
from app.schemas.broker import AccountResponse, BrokerConnectRequest, BrokerConnectionResponse
from app.services.broker_adapter import get_adapter

router = APIRouter(prefix="/broker", tags=["broker"])


def _owned_or_404(conn: BrokerConnection | None, user_id: uuid.UUID) -> BrokerConnection:
    if not conn or conn.user_id != user_id:
        raise HTTPException(status_code=404, detail="Connection not found")
    return conn


# ── Connect ────────────────────────────────────────────────────

_DEFAULT_DISPLAY = {
    "alpaca":     lambda paper: "Alpaca Paper" if paper else "Alpaca Live",
    "ibkr":       lambda paper: "IBKR Paper" if paper else "IBKR Live",
    "tastytrade": lambda paper: "tastytrade",
    "webull":     lambda paper: "Webull Paper" if paper else "Webull Live",
    "tradier":    lambda paper: "Tradier Sandbox" if paper else "Tradier Live",
}


MAX_CONNECTIONS_PER_USER = 10


@router.post("/connect", response_model=BrokerConnectionResponse, status_code=status.HTTP_201_CREATED)
async def connect_broker(body: BrokerConnectRequest, request: Request, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(BrokerConnection).where(
            BrokerConnection.user_id == current_user.id,
            BrokerConnection.is_active == True,
        )
    )
    if len(result.scalars().all()) >= MAX_CONNECTIONS_PER_USER:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum of {MAX_CONNECTIONS_PER_USER} connected apps reached. Disconnect one before adding another.",
        )

    adapter = get_adapter(body.broker_name)
    account_id = adapter.validate_and_get_account_id(body.api_key, body.api_secret, body.is_paper)

    default_name = _DEFAULT_DISPLAY.get(body.broker_name, lambda p: body.broker_name)(body.is_paper)
    conn = BrokerConnection(
        user_id=current_user.id,
        broker_name=body.broker_name,
        display_name=body.display_name or default_name,
        api_key_enc=encrypt_secret(body.api_key),
        api_secret_enc=encrypt_secret(body.api_secret),
        account_id=account_id,
        is_paper=body.is_paper,
        permissions={"read": True, "trade": True},
        last_sync_at=datetime.now(timezone.utc),
    )
    db.add(conn)
    await db.flush()

    await audit_log(
        db, action="BROKER_CONNECT", outcome="success",
        user_id=current_user.id, resource_type="broker_connection",
        resource_id=conn.id, metadata={"broker": body.broker_name, "paper": body.is_paper},
        request=request,
    )
    return conn


# ── List connections ───────────────────────────────────────────

@router.get("/connections", response_model=list[BrokerConnectionResponse])
async def list_connections(current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(BrokerConnection).where(
            BrokerConnection.user_id == current_user.id,
            BrokerConnection.is_active == True,
        )
    )
    return result.scalars().all()


# ── Disconnect ─────────────────────────────────────────────────

@router.delete("/connections/{connection_id}", response_model=MessageResponse)
async def disconnect_broker(
    connection_id: uuid.UUID, request: Request, current_user: CurrentUser, db: DB
):
    result = await db.execute(
        select(BrokerConnection).where(BrokerConnection.id == connection_id)
    )
    conn = _owned_or_404(result.scalar_one_or_none(), current_user.id)
    conn.is_active = False

    await audit_log(
        db, action="BROKER_DISCONNECT", outcome="success",
        user_id=current_user.id, resource_type="broker_connection",
        resource_id=connection_id, request=request,
    )
    return MessageResponse(message="Disconnected")


# ── Account info ───────────────────────────────────────────────

@router.get("/connections/{connection_id}/account", response_model=AccountResponse)
async def get_account(connection_id: uuid.UUID, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(BrokerConnection).where(BrokerConnection.id == connection_id)
    )
    conn = _owned_or_404(result.scalar_one_or_none(), current_user.id)
    return get_adapter(conn.broker_name).get_account(conn)


# ── Positions ──────────────────────────────────────────────────

@router.get("/connections/{connection_id}/positions")
async def get_positions(connection_id: uuid.UUID, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(BrokerConnection).where(BrokerConnection.id == connection_id)
    )
    conn = _owned_or_404(result.scalar_one_or_none(), current_user.id)
    return get_adapter(conn.broker_name).get_positions(conn)


# ── Orders ─────────────────────────────────────────────────────

@router.get("/connections/{connection_id}/orders")
async def get_orders(
    connection_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    order_status: str = "all",
    limit: int = 50,
):
    result = await db.execute(
        select(BrokerConnection).where(BrokerConnection.id == connection_id)
    )
    conn = _owned_or_404(result.scalar_one_or_none(), current_user.id)
    return get_adapter(conn.broker_name).get_orders(conn, status=order_status, limit=limit)


# ── OHLCV bars (for charts) ────────────────────────────────────

@router.get("/connections/{connection_id}/bars/{symbol}")
async def get_bars(
    connection_id: uuid.UUID,
    symbol: str,
    current_user: CurrentUser,
    db: DB,
    timeframe: str = "1Hour",
    limit: int = 100,
):
    result = await db.execute(
        select(BrokerConnection).where(BrokerConnection.id == connection_id)
    )
    conn = _owned_or_404(result.scalar_one_or_none(), current_user.id)
    return get_adapter(conn.broker_name).get_bars(conn, symbol.upper(), timeframe, limit)


# ── Latest quote ───────────────────────────────────────────────

@router.get("/connections/{connection_id}/quote/{symbol}")
async def get_quote(
    connection_id: uuid.UUID,
    symbol: str,
    current_user: CurrentUser,
    db: DB,
):
    result = await db.execute(
        select(BrokerConnection).where(BrokerConnection.id == connection_id)
    )
    conn = _owned_or_404(result.scalar_one_or_none(), current_user.id)
    return get_adapter(conn.broker_name).get_latest_quote(conn, symbol.upper())


# ── Options chain (Task 7) ─────────────────────────────────────

@router.get("/connections/{connection_id}/options/{symbol}")
async def get_options_chain(
    connection_id: uuid.UUID,
    symbol: str,
    current_user: CurrentUser,
    db: DB,
    expiration: str | None = None,
):
    result = await db.execute(
        select(BrokerConnection).where(BrokerConnection.id == connection_id)
    )
    conn = _owned_or_404(result.scalar_one_or_none(), current_user.id)
    adapter = get_adapter(conn.broker_name)
    if not hasattr(adapter, "get_options_chain"):
        raise HTTPException(status_code=501, detail=f"{conn.broker_name} does not support options chain")
    return adapter.get_options_chain(conn, symbol.upper(), expiration=expiration)


@router.get("/connections/{connection_id}/options/{symbol}/expirations")
async def get_option_expirations(
    connection_id: uuid.UUID,
    symbol: str,
    current_user: CurrentUser,
    db: DB,
):
    result = await db.execute(
        select(BrokerConnection).where(BrokerConnection.id == connection_id)
    )
    conn = _owned_or_404(result.scalar_one_or_none(), current_user.id)
    adapter = get_adapter(conn.broker_name)
    if not hasattr(adapter, "list_option_expirations"):
        raise HTTPException(status_code=501, detail=f"{conn.broker_name} does not support options chain")
    return adapter.list_option_expirations(conn, symbol.upper())
