import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell, LogOut, Menu, Moon, Sun, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";
import { RoleBadge } from "@/components/status-badges";
import { useTheme } from "@/components/theme-provider";
import { useAuth } from "@/stores/auth";
import { api } from "@/lib/api";
import { NotificationsDrawer } from "./notifications-drawer";

interface Props {
  onToggleSidebar: () => void;
}

export function Header({ onToggleSidebar }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const nav = useNavigate();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  const {
    data: notifications,
    isLoading: notificationsLoading,
    isError: notificationsError,
    refetch: refetchNotifications,
  } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.listNotifications(),
    refetchInterval: 30_000,
  });
  // The badge is a claim about unread count: only compute it once the query
  // has actually resolved. While pending or failed we show a local status
  // dot instead of silently implying "0 unread".
  const notificationsResolved = !notificationsLoading && !notificationsError && !!notifications;
  const unread = notificationsResolved
    ? notifications!.filter((n) => n.status !== "read").length
    : 0;

  // Simulated WS connection status (always connected in mock)
  const wsOnline = true;

  const fullName = user ? `${user.firstname} ${user.lastname}` : "";

  return (
    <header className="h-14 shrink-0 border-b bg-background/80 backdrop-blur sticky top-0 z-30">
      <div className="flex h-full items-center gap-3 px-4">
        <Button variant="ghost" size="icon" onClick={onToggleSidebar} aria-label="Toggle sidebar">
          <Menu className="size-4" />
        </Button>
        <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground">
          {wsOnline ? (
            <>
              <Wifi className="size-3.5 text-emerald-500" />
              <span>Live</span>
            </>
          ) : (
            <>
              <WifiOff className="size-3.5 text-muted-foreground" />
              <span>Offline</span>
            </>
          )}
        </div>
        <div className="flex-1" />

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          {resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="relative"
          onClick={() => setDrawerOpen(true)}
          aria-label="Notifications"
        >
          <Bell className="size-4" />
          {notificationsResolved ? (
            unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground flex items-center justify-center">
                {unread > 9 ? "9+" : unread}
              </span>
            )
          ) : notificationsError ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                refetchNotifications();
              }}
              title="Couldn't load notifications — retry"
              aria-label="Couldn't load notifications, retry"
              className="absolute -top-0.5 -right-0.5 size-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-[10px] font-bold leading-none"
            >
              !
            </button>
          ) : (
            <span
              className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-muted-foreground/60 animate-pulse"
              title="Loading notifications"
              aria-label="Loading notifications"
              role="status"
            />
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 px-2 h-9">
              {user && <UserAvatar user={user} size="sm" />}
              <div className="hidden sm:flex flex-col items-start leading-tight">
                <span className="text-xs font-medium">{fullName}</span>
                {user && <RoleBadge role={user.role} className="text-[10px] py-0 px-1" />}
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span>{fullName}</span>
                <span className="text-xs text-muted-foreground">{user?.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings/channels">My channels</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}>
              Toggle theme
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                logout();
                nav("/login");
              }}
              className="text-destructive"
            >
              <LogOut className="size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <NotificationsDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </header>
  );
}
