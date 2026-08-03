import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuth } from "@/stores/auth";

const schema = z.object({
  login: z.string().min(1, "Required"),
  password: z.string().min(1, "Required"),
});
type FormValues = z.infer<typeof schema>;

const PRESETS: { label: string; login: string }[] = [
  { label: "Admin", login: "admin" },
  { label: "Team Lead", login: "alice.smith" },
  { label: "Project Manager", login: "grace.evans" },
  { label: "Agent", login: "iris.taylor0" },
];

export default function LoginPage() {
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const setToken = useAuth((s) => s.setToken);
  const nav = useNavigate();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { login: "admin", password: "password" },
  });

  if (user) return <Navigate to="/dashboard" replace />;

  const onSubmit = async (values: FormValues) => {
    try {
      const u = await api.login(values.login, values.password);
      setUser(u);
      setToken(`mock-jwt-${u.id}`);
      toast.success(`Welcome, ${u.firstname}!`);
      nav("/dashboard");
    } catch (err) {
      toast.error((err as Error).message || "Login failed");
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-muted/40">
      <div className="hidden lg:flex flex-col justify-between p-10 bg-sidebar text-sidebar-foreground relative overflow-hidden">
        <div className="flex items-center gap-2 relative z-10">
          <div className="size-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center font-bold">
            Z
          </div>
          <span className="font-semibold">Zammad Monitor</span>
        </div>
        <div className="relative z-10 space-y-4 max-w-md">
          <h2 className="text-3xl font-bold leading-tight">Real-time helpdesk intelligence.</h2>
          <p className="text-sidebar-foreground/70">
            Monitor SLA compliance, agent performance, and ticket trends across your Zammad instance —
            without modifying your installation.
          </p>
          <ul className="space-y-2 text-sm text-sidebar-foreground/80">
            <li>• Role-aware dashboards for Admin, TL, PM & Agents</li>
            <li>• Multi-channel alerts (Email, Slack, Telegram, …)</li>
            <li>• 30-day rolling KPI snapshots</li>
            <li>• On-demand PDF & Excel exports</li>
          </ul>
        </div>
        <div className="text-xs text-sidebar-foreground/50 relative z-10">
          v0.1.0 · On-premise build
        </div>
        <div className="absolute -right-32 -bottom-32 size-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -left-20 -top-20 size-80 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>Use your Zammad credentials. Proxy-authenticated.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <Label htmlFor="login">Username or Email</Label>
                <Input id="login" autoComplete="username" {...form.register("login")} />
                {form.formState.errors.login && (
                  <p className="text-xs text-destructive">{form.formState.errors.login.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" autoComplete="current-password" {...form.register("password")} />
                {form.formState.errors.password && (
                  <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
                Sign in
              </Button>
            </form>

            <div className="mt-6 pt-4 border-t">
              <p className="text-xs text-muted-foreground mb-2">Demo: click a role to prefill</p>
              <div className="grid grid-cols-2 gap-2">
                {PRESETS.map((p) => (
                  <Button
                    key={p.login}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      form.setValue("login", p.login);
                      form.setValue("password", "password");
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
