import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Ticket,
  Users,
  UsersRound,
  Gauge,
  TrendingUp,
  FileText,
  BellRing,
  Settings,
  Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  roles?: Role[];
}

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/overview", label: "Overview", icon: TrendingUp },
  { to: "/tickets", label: "Tickets", icon: Ticket },
  { to: "/agents", label: "Agents", icon: Users, roles: ["admin", "team_lead"] },
  { to: "/groups", label: "Groups", icon: UsersRound, roles: ["admin", "team_lead", "project_manager"] },
  { to: "/sla", label: "SLA Monitor", icon: Gauge, roles: ["admin", "team_lead", "project_manager"] },
  { to: "/performance", label: "Performance", icon: TrendingUp, roles: ["admin", "team_lead", "project_manager"] },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/alerts", label: "Alert Rules", icon: BellRing },
  { to: "/settings/channels", label: "Channels", icon: Radio },
  { to: "/settings", label: "System Settings", icon: Settings, roles: ["admin"] },
];

export function Sidebar({ role, collapsed }: { role: Role; collapsed: boolean }) {
  const items = NAV.filter((i) => !i.roles || i.roles.includes(role));
  return (
    <aside
      className={cn(
        "hidden md:flex flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-200",
        collapsed ? "w-14" : "w-60"
      )}
    >
      <div className="flex h-14 items-center gap-2 px-4 border-b border-sidebar-border">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
          Z
        </div>
        {!collapsed && <span className="truncate font-semibold">Zammad Monitor</span>}
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/dashboard"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                isActive && "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              )
            }
            title={collapsed ? item.label : undefined}
          >
            <item.icon className="size-4 shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-sidebar-border text-[11px] text-sidebar-foreground/60">
        {!collapsed && <>v0.1.0</>}
      </div>
    </aside>
  );
}
