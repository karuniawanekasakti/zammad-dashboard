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
import { appVersion, logoUrl } from "@/lib/version";
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
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-sidebar-border">
        <img src={logoUrl} alt="MTI" className="h-9 w-9 shrink-0 rounded-lg object-contain bg-white shadow-sm ring-1 ring-black/10" />
        {!collapsed && (
          <div className="flex flex-col leading-tight">
            <span className="text-[15px] font-bold tracking-tight">MTI</span>
            <span className="text-[11px] font-medium uppercase tracking-widest text-sidebar-foreground/60">
              Ticketing Dashboard
            </span>
          </div>
        )}
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
        {!collapsed && <>{appVersion}</>}
      </div>
    </aside>
  );
}
