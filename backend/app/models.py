from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Any
from pydantic import BaseModel


class Role(str, Enum):
    admin = "admin"
    team_lead = "team_lead"
    project_manager = "project_manager"
    agent = "agent"


class TicketState(str, Enum):
    new = "new"
    open = "open"
    pending = "pending"
    closed = "closed"
    merged = "merged"


class TicketPriority(str, Enum):
    low = "low"
    normal = "normal"
    high = "high"
    very_high = "very high"
    unknown = "unknown"


class SlaStatus(str, Enum):
    safe = "safe"
    warning = "warning"
    critical = "critical"
    breached = "breached"
    no_sla = "no_sla"


# --- Auth ---
class LoginRequest(BaseModel):
    login: str
    password: str


class TokenResponse(BaseModel):
    token: str
    user: UserOut


class UserOut(BaseModel):
    id: str
    zammad_id: int
    email: str
    firstname: str
    lastname: str
    login: str
    role: Role
    group_ids: list[str]
    is_active: bool


# --- Tickets ---
class TicketOut(BaseModel):
    id: str
    zammad_id: int
    number: str
    title: str
    state: TicketState
    priority: TicketPriority
    priority_id: str = ""
    state_id: str = ""
    severity: str | None = None
    severity_label: str | None = None
    ticket_category: str | None = None
    ticket_category_label: str | None = None
    group_id: str
    group_name: str
    owner_id: str | None
    owner_name: str | None
    customer_name: str
    tags: list[str]
    sla_status: SlaStatus
    escalation_at: datetime | None = None
    first_response_at: datetime | None = None
    first_response_escalation_at: datetime | None = None
    first_response_in_min: int | None = None
    first_response_diff_in_min: int | None = None
    close_at: datetime | None = None
    close_escalation_at: datetime | None = None
    close_in_min: int | None = None
    close_diff_in_min: int | None = None
    update_escalation_at: datetime | None = None
    update_diff_in_min: int | None = None
    first_response_remaining_secs: int | None
    first_response_breached: bool
    close_breached: bool
    reopen_count: int
    first_reply_time_secs: int | None
    resolution_time_secs: int | None
    zammad_created_at: datetime
    zammad_updated_at: datetime
    closed_at: datetime | None = None


class TicketArticleOut(BaseModel):
    id: str
    ticket_id: str
    author_name: str
    author_role: str
    type: str
    internal: bool
    body: str
    created_at: datetime


class TicketHistoryOut(BaseModel):
    id: str
    ticket_id: str
    attribute: str | None = None
    value_from: str | None = None
    value_to: str | None = None
    created_at: datetime


class TicketListResponse(BaseModel):
    success: bool = True
    data: list[TicketOut]
    meta: dict[str, Any] = {}


# --- KPI ---
class KpiSummary(BaseModel):
    total_open_tickets: int = 0
    total_closed_today: int = 0
    agents_online: int = 0
    total_agents: int = 0
    sla_breach_rate: float = 0.0
    avg_resolution_secs: int = 0
    avg_first_reply_secs: int = 0
    reopen_rate: float = 0.0
    new_today: int = 0
    at_risk: int = 0


class TrendPoint(BaseModel):
    date: str
    value: float


# --- Groups ---
class GroupOut(BaseModel):
    id: str
    name: str
    note: str | None = None
    active: bool = True
    agent_count: int = 0


class GroupStat(BaseModel):
    group: GroupOut
    open_tickets: int = 0
    new_today: int = 0
    closed_today: int = 0
    sla_breach_rate: float = 0.0
    avg_first_reply_secs: int = 0
    avg_resolution_secs: int = 0
    trend: list[TrendPoint] = []


# --- Agents ---
class AgentStat(BaseModel):
    agent: UserOut
    open_tickets: int = 0
    at_risk: int = 0
    breached: int = 0
    avg_first_reply_secs: int = 0
    avg_resolution_secs: int = 0
    sla_breach_rate: float = 0.0
    reopen_rate: float = 0.0
    closed_this_week: int = 0


# --- Alerts ---
class AlertRuleIn(BaseModel):
    name: str
    scope_type: str = "global"
    scope_id: str | None = None
    condition_type: str
    condition_params: dict[str, Any] = {}
    channels: list[str] = ["in_app"]
    is_active: bool = True
    cooldown_mins: int = 30


class AlertRuleOut(AlertRuleIn):
    id: str
    scope_label: str = ""
    created_at: datetime


# --- Notifications ---
class NotificationOut(BaseModel):
    id: str
    rule_name: str
    ticket_id: str | None
    ticket_number: str | None
    channel: str
    status: str
    message: str
    created_at: datetime
    read_at: datetime | None = None


# --- Channels ---
class ChannelConfigOut(BaseModel):
    id: str
    channel_type: str
    label: str
    config: dict[str, str]
    is_active: bool
    verified_at: datetime | None = None


# --- WebSocket ---
class WsMessage(BaseModel):
    type: str
    payload: dict[str, Any] = {}
    timestamp: datetime
    room: str = ""


# --- Generic ---
class ApiResponse(BaseModel):
    success: bool = True
    data: Any = None
    error: dict[str, Any] | None = None
    meta: dict[str, Any] = {}


# Rebuild forward refs
TokenResponse.model_rebuild()
