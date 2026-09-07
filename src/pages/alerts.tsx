import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AlertChannel, AlertCondition, AlertRule, AlertScope } from "@/types";

const CONDITIONS: { value: AlertCondition; label: string }[] = [
  { value: "sla_breach", label: "SLA breach" },
  { value: "sla_approaching", label: "SLA approaching" },
  { value: "ticket_open_too_long", label: "Open too long" },
  { value: "high_agent_workload", label: "High agent workload" },
  { value: "ticket_reopened", label: "Ticket reopened" },
  { value: "no_activity", label: "No activity" },
];
const CHANNELS: { value: AlertChannel; label: string }[] = [
  { value: "in_app", label: "In-app" },
  { value: "email", label: "Email" },
  { value: "slack", label: "Slack" },
  { value: "teams", label: "Teams" },
  { value: "telegram", label: "Telegram" },
  { value: "whatsapp", label: "WhatsApp" },
];

interface FormState {
  id?: string;
  name: string;
  scope_type: AlertScope;
  condition_type: AlertCondition;
  channels: AlertChannel[];
  cooldown_mins: number;
  is_active: boolean;
}

const emptyForm: FormState = {
  name: "",
  scope_type: "global",
  condition_type: "sla_breach",
  channels: ["in_app", "email"],
  cooldown_mins: 15,
  is_active: true,
};

export default function AlertsPage() {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ["alert-rules"], queryFn: () => api.listAlertRules() });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  const upsert = useMutation({
    mutationFn: (r: FormState) =>
      api.upsertAlertRule({
        id: r.id,
        name: r.name,
        scope_type: r.scope_type,
        scope_id: null,
        scope_label: r.scope_type === "global" ? "All groups" : "—",
        condition_type: r.condition_type,
        condition_params: {},
        channels: r.channels,
        is_active: r.is_active,
        cooldown_mins: r.cooldown_mins,
      }),
    onSuccess: () => {
      toast.success("Alert rule saved");
      qc.invalidateQueries({ queryKey: ["alert-rules"] });
      setOpen(false);
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api.deleteAlertRule(id),
    onSuccess: () => {
      toast.success("Rule deleted");
      qc.invalidateQueries({ queryKey: ["alert-rules"] });
    },
  });

  const edit = (rule: AlertRule) => {
    setForm({
      id: rule.id,
      name: rule.name,
      scope_type: rule.scope_type,
      condition_type: rule.condition_type,
      channels: rule.channels,
      cooldown_mins: rule.cooldown_mins,
      is_active: rule.is_active,
    });
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Alert Rules"
        description="Configure triggers and delivery channels."
        action={
          <Button
            onClick={() => {
              setForm(emptyForm);
              setOpen(true);
            }}
          >
            <Plus className="size-4" />
            New rule
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Channels</TableHead>
                <TableHead>Cooldown</TableHead>
                <TableHead className="text-center">Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rules.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                    No alert rules yet. Create your first one.
                  </TableCell>
                </TableRow>
              )}
              {(rules.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium flex items-center gap-2">
                    <Bell className="size-3.5 text-muted-foreground" />
                    {r.name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{CONDITIONS.find((c) => c.value === r.condition_type)?.label}</Badge>
                  </TableCell>
                  <TableCell className="capitalize text-sm">{r.scope_type.replace("_", " ")}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {r.channels.map((c) => (
                        <Badge key={c} variant="muted" className="capitalize">
                          {c.replace("_", " ")}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{r.cooldown_mins}m</TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={r.is_active}
                      onCheckedChange={(v) => upsert.mutate({
                        id: r.id,
                        name: r.name,
                        scope_type: r.scope_type,
                        condition_type: r.condition_type,
                        channels: r.channels,
                        cooldown_mins: r.cooldown_mins,
                        is_active: v,
                      })}
                    />
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="icon" variant="ghost" onClick={() => edit(r)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => del.mutate(r.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit alert rule" : "New alert rule"}</DialogTitle>
            <DialogDescription>Trigger actions when conditions match.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="High priority breach alert" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Condition</Label>
                <Select value={form.condition_type} onValueChange={(v) => setForm({ ...form, condition_type: v as AlertCondition })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONDITIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Scope</Label>
                <Select value={form.scope_type} onValueChange={(v) => setForm({ ...form, scope_type: v as AlertScope })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">Global</SelectItem>
                    <SelectItem value="group">Group</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Channels</Label>
              <div className="grid grid-cols-2 gap-2">
                {CHANNELS.map((c) => {
                  const checked = form.channels.includes(c.value);
                  return (
                    <label key={c.value} className="flex items-center gap-2 text-sm border rounded-md p-2 cursor-pointer hover:bg-muted/40">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) =>
                          setForm({
                            ...form,
                            channels: v
                              ? [...form.channels, c.value]
                              : form.channels.filter((x) => x !== c.value),
                          })
                        }
                      />
                      {c.label}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Cooldown (minutes)</Label>
                <Input
                  type="number"
                  value={form.cooldown_mins}
                  onChange={(e) => setForm({ ...form, cooldown_mins: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Active</Label>
                <div className="flex items-center h-9">
                  <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => upsert.mutate(form)} disabled={!form.name || form.channels.length === 0}>
              Save rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
