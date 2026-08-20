from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import dispose_engine
from app.routers import auth, tickets, agents, groups, kpi, alerts, notifications, channels, webhooks, system, settings as settings_router, slas, ws


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    await dispose_engine()


def create_app() -> FastAPI:
    app = FastAPI(title="Zammad Monitor API", version="0.1.0", root_path="/api/v1", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router, prefix="/auth", tags=["auth"])
    app.include_router(tickets.router, prefix="/tickets", tags=["tickets"])
    app.include_router(tickets.history_router, tags=["tickets"])
    app.include_router(agents.router, prefix="/agents", tags=["agents"])
    app.include_router(groups.router, prefix="/groups", tags=["groups"])
    app.include_router(kpi.router, prefix="/kpi", tags=["kpi"])
    app.include_router(alerts.router, prefix="/alert-rules", tags=["alerts"])
    app.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
    app.include_router(channels.router, prefix="/channels", tags=["channels"])
    app.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])
    app.include_router(system.router, prefix="/system", tags=["system"])
    app.include_router(settings_router.router, prefix="/settings", tags=["settings"])
    app.include_router(slas.router, prefix="/slas", tags=["slas"])
    app.include_router(ws.router, tags=["websocket"])

    return app


app = create_app()
