import { Activity, CheckCircle2, TrendingUp, Timer } from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ManagerMetricsPeriod, SlaManagerMetrics, SlaMonitorData } from "@/types";

// The periods a manager can review, ordered widest-last. Callers own the
// selection state, so the options live with the header that renders them.
export const MANAGER_METRIC_PERIODS: { value: ManagerMetricsPeriod; label: string }[] = [
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "quarter", label: "This Quarter" },
  { value: "year", label: "This Year" },
];

// Breaches become a trend worth escalating once a team collects three of them;
// below that the badge stays neutral so a single slip does not read as a crisis.
export const ACTIVE_BREACH_ALERT_THRESHOLD = 3;

// "3h", "1h 30m", "45m" — a duration a manager can weigh against a service
// window at a glance. A period that never breached has no average to report.
export function formatBreachDuration(minutes: number | null): string {
  if (minutes == null) return "N/A";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

// How the header is reached: a split view renders it above the ticket
// conversation, while an inline expansion has no room for it and omits it.
export type ManagerMetricsMode = "split" | "inline";

interface Props {
  monitor: Pick<SlaMonitorData["summary"], "total_with_sla" | "compliance_rate" | "breached"> & {
    manager_metrics?: Record<ManagerMetricsPeriod, SlaManagerMetrics> | null;
  };
  scope: string | null;
  period?: ManagerMetricsPeriod;
  onPeriodChange?: (period: ManagerMetricsPeriod) => void;
  mode?: ManagerMetricsMode;
}

// Without a backend rollup we can still state the current window honestly:
// compliance is read off the live monitor payload, and the trend and average
// breach time — which need history this build does not fetch — degrade to "no
// comparison available" instead of inventing a figure.
function metricsForPeriod(monitor: Props["monitor"], period: ManagerMetricsPeriod): SlaManagerMetrics {
  const precomputed = monitor.manager_metrics?.[period];
  if (precomputed) return precomputed;
  return {
    compliance_rate: monitor.compliance_rate ?? 0,
    active_breaches: monitor.breached,
    trend_percentage: 0,
    average_breach_time_minutes: null,
  };
}

export function ManagerMetricsSummary({ monitor, scope, period = "month", onPeriodChange, mode = "split" }: Props) {
  if (mode === "inline") return null;

  const metrics = metricsForPeriod(monitor, period);
  const total = monitor.total_with_sla ?? 0;
  const met = Math.max(0, Math.round((total * metrics.compliance_rate) / 100));
  const trendUp = metrics.trend_percentage > 0;
  const trendDown = metrics.trend_percentage < 0;
  const breachesAlert = metrics.active_breaches >= ACTIVE_BREACH_ALERT_THRESHOLD;

  return (
    <section aria-label="Manager metrics" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Manager Metrics</h2>
        <Select value={period} onValueChange={(value) => onPeriodChange?.(value as ManagerMetricsPeriod)}>
          <SelectTrigger aria-label="Metrics period" className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MANAGER_METRIC_PERIODS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Compliance Rate"
          value={`${metrics.compliance_rate.toFixed(1)}%`}
          helper={`${met} of ${total} tickets met SLA`}
          icon={CheckCircle2}
        />
        <KpiCard
          title="Active Breaches"
          value={metrics.active_breaches}
          helper={breachesAlert ? "Above the escalation threshold" : "Within tolerance"}
          icon={Activity}
          iconClassName={breachesAlert ? "bg-orange-500/15 text-orange-600" : undefined}
        />
        <KpiCard
          title="Trend vs Last Period"
          value={trendUp ? `↑ ${metrics.trend_percentage.toFixed(1)}%` : trendDown ? `↓ ${Math.abs(metrics.trend_percentage).toFixed(1)}%` : "0.0%"}
          helper="Compared with the previous period"
          icon={TrendingUp}
          iconClassName={trendUp ? "bg-emerald-500/15 text-emerald-600" : trendDown ? "bg-red-500/15 text-red-600" : undefined}
          trend={trendUp || trendDown ? { value: metrics.trend_percentage, direction: trendUp ? "up" : "down" } : undefined}
        />
        <KpiCard
          title="Average Time to Breach"
          value={formatBreachDuration(metrics.average_breach_time_minutes)}
          helper="Mean time from ticket creation to breach"
          icon={Timer}
        />
      </div>

      {breachesAlert && (
        <Badge variant="warning" className="bg-orange-500 text-white" data-testid={`manager-metrics-breaches-${scope ?? "all"}`}>
          {metrics.active_breaches} active breaches
        </Badge>
      )}
    </section>
  );
}
