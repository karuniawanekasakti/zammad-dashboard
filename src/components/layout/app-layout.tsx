import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { useAuth } from "@/stores/auth";

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const user = useAuth((s) => s.user);
  if (!user) return null;
  return (
    <div className="flex h-screen overflow-hidden bg-muted/40">
      <Sidebar role={user.role} collapsed={collapsed} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onToggleSidebar={() => setCollapsed((c) => !c)} />
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-[1600px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
