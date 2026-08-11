import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/app-layout";
import { RequireAuth } from "@/components/require-auth";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import OverviewPage from "@/pages/overview";
import TicketsPage from "@/pages/tickets";
import TicketDetailPage from "@/pages/ticket-detail";
import AgentsPage from "@/pages/agents";
import AgentDetailPage from "@/pages/agent-detail";
import GroupsPage from "@/pages/groups";
import GroupDetailPage from "@/pages/group-detail";
import SlaPage from "@/pages/sla";
import PerformancePage from "@/pages/performance";
import ReportsPage from "@/pages/reports";
import AlertsPage from "@/pages/alerts";
import SettingsPage from "@/pages/settings";
import ChannelsPage from "@/pages/channels";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/tickets/:id" element={<TicketDetailPage />} />
        <Route path="/agents" element={<RequireAuth roles={["admin", "team_lead"]}><AgentsPage /></RequireAuth>} />
        <Route path="/agents/:id" element={<AgentDetailPage />} />
        <Route path="/groups" element={<RequireAuth roles={["admin", "team_lead", "project_manager"]}><GroupsPage /></RequireAuth>} />
        <Route path="/groups/:id" element={<GroupDetailPage />} />
        <Route path="/sla" element={<RequireAuth roles={["admin", "team_lead", "project_manager"]}><SlaPage /></RequireAuth>} />
        <Route path="/performance" element={<RequireAuth roles={["admin", "team_lead", "project_manager"]}><PerformancePage /></RequireAuth>} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/settings/channels" element={<ChannelsPage />} />
        <Route path="/settings" element={<RequireAuth roles={["admin"]}><SettingsPage /></RequireAuth>} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
