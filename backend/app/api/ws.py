"""
Task 10 — WebSocket streaming.

Clients connect to /api/v1/ws/{token} and receive real-time JSON frames:
  {"type": "signal",  "data": {...}}
  {"type": "order",   "data": {...}}
  {"type": "account", "data": {...}}
  {"type": "ping",    "ts": 1234567890}

The hub broadcasts to all connections for a given user_id so that multiple
browser tabs stay in sync.  Broadcasting is triggered by:
  - New signal events (from signal_engine)
  - Order status changes (from execution engine)
  - 30-second account heartbeat
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jose import JWTError, jwt

from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])

# ── Connection hub ─────────────────────────────────────────────

class _Hub:
    def __init__(self) -> None:
        # user_id → list of active WebSocket connections
        self._connections: dict[str, list[WebSocket]] = {}

    def connect(self, user_id: str, ws: WebSocket) -> None:
        self._connections.setdefault(user_id, []).append(ws)
        logger.debug("WS connect: user=%s total=%d", user_id, len(self._connections[user_id]))

    def disconnect(self, user_id: str, ws: WebSocket) -> None:
        conns = self._connections.get(user_id, [])
        if ws in conns:
            conns.remove(ws)
        if not conns:
            self._connections.pop(user_id, None)
        logger.debug("WS disconnect: user=%s remaining=%d", user_id, len(conns))

    async def broadcast(self, user_id: str, message: dict[str, Any]) -> None:
        payload = json.dumps(message)
        dead: list[WebSocket] = []
        for ws in list(self._connections.get(user_id, [])):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(user_id, ws)

    async def broadcast_all(self, message: dict[str, Any]) -> None:
        for uid in list(self._connections):
            await self.broadcast(uid, message)


hub = _Hub()


def _decode_user_id(token: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


# ── WebSocket endpoint ─────────────────────────────────────────

@router.websocket("/ws/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str):
    user_id = _decode_user_id(token)
    if not user_id:
        await websocket.close(code=4001, reason="Invalid token")
        return

    await websocket.accept()
    hub.connect(user_id, websocket)

    try:
        # Send welcome frame
        await websocket.send_json({"type": "connected", "user_id": user_id})

        # Heartbeat loop — keep connection alive and clients know they're live
        async def _ping():
            import time
            while True:
                await asyncio.sleep(30)
                try:
                    await websocket.send_json({"type": "ping", "ts": int(time.time())})
                except Exception:
                    break

        ping_task = asyncio.create_task(_ping())

        # Main receive loop — clients can send {"type":"subscribe","channels":["signals"]}
        async for raw in websocket.iter_text():
            try:
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except Exception:
                pass

    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(user_id, websocket)
        try:
            ping_task.cancel()
        except Exception:
            pass


# ── Helper for other modules to push events ────────────────────

async def push_signal(user_id: str, signal_data: dict) -> None:
    await hub.broadcast(user_id, {"type": "signal", "data": signal_data})


async def push_order(user_id: str, order_data: dict) -> None:
    await hub.broadcast(user_id, {"type": "order", "data": order_data})


async def push_account(user_id: str, account_data: dict) -> None:
    await hub.broadcast(user_id, {"type": "account", "data": account_data})
