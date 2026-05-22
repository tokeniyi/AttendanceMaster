"use client";

import { useEffect, useState } from "react";
import { 
  Users, 
  Calendar, 
  CheckCircle2, 
  Upload,
  ArrowRight,
  Database
} from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { formatDistanceToNow } from "date-fns";
import { Session } from "@/types";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const [stats, setStats] = useState({
    members: 0,
    totalAttendance: 0,
    recentSessions: 0
  });
  const [isLoading, setIsLoading] = useState(true);
  const [recentSessions, setRecentSessions] = useState<Session[]>([]);

  useEffect(() => {
    async function fetchStats() {
      const { count: memberCount } = await supabase
        .from('members')
        .select('*', { count: 'exact', head: true });
        
      const { count: attendanceCount } = await supabase
        .from('attendance')
        .select('*', { count: 'exact', head: true });

      const { count: sessionCount } = await supabase
        .from('sessions')
        .select('*', { count: 'exact', head: true });

      setStats({
        members: memberCount || 0,
        totalAttendance: attendanceCount || 0,
        recentSessions: sessionCount || 0
      });
      const { data: sessionData } = await supabase
        .from('sessions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      setRecentSessions(sessionData || []);
      setIsLoading(false);
    }
    fetchStats();
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-2">Welcome back to Attendance Master.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="rounded-full bg-primary/10 p-3">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Members</p>
              {isLoading ? <div className="h-8 w-16 bg-white/5 animate-pulse rounded mt-1" /> : <h3 className="text-2xl font-bold">{stats.members}</h3>}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="rounded-full bg-emerald-500/10 p-3">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Attendance Logs</p>
              {isLoading ? <div className="h-8 w-16 bg-white/5 animate-pulse rounded mt-1" /> : <h3 className="text-2xl font-bold">{stats.totalAttendance}</h3>}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="rounded-full bg-blue-500/10 p-3">
              <Calendar className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Recent Sessions</p>
              {isLoading ? <div className="h-8 w-16 bg-white/5 animate-pulse rounded mt-1" /> : <h3 className="text-2xl font-bold">{stats.recentSessions}</h3>}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="rounded-full bg-amber-500/10 p-3">
              <CheckCircle2 className="h-6 w-6 text-amber-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Smart Match Accuracy</p>
              <h3 className="text-2xl font-bold">94.2%</h3>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 rounded-xl border border-border bg-card p-6 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" /> Active Workspaces
            </h2>
            <Link href="/attendance/history" className="text-sm text-primary hover:underline">View All</Link>
          </div>
          <div className="space-y-4">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between p-4 rounded-xl border border-border animate-pulse">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-lg bg-white/5" />
                    <div className="space-y-2">
                      <div className="h-4 w-32 bg-white/5 rounded" />
                      <div className="h-3 w-24 bg-white/5 rounded" />
                    </div>
                  </div>
                  <div className="h-8 w-8 rounded-full bg-white/5" />
                </div>
              ))
            ) : recentSessions.length > 0 ? (
              recentSessions.map((session) => (
                <Link 
                  key={session.id}
                  href={`/sessions/${session.id}`}
                  className="flex items-center justify-between p-4 rounded-xl border border-border hover:bg-accent/50 transition-colors group"
                >
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "h-10 w-10 rounded-lg flex items-center justify-center transition-colors",
                      session.status === 'approved' ? "bg-emerald-500/10 text-emerald-500" : "bg-primary/10 text-primary"
                    )}>
                      <Database className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm line-clamp-1">{session.event_name}</h4>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                        {session.status} • {formatDistanceToNow(new Date(session.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </Link>
              ))
            ) : (
              <p className="text-center py-8 text-sm text-muted-foreground italic">
                No active workspaces. Start by uploading an attendance sheet.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <Link 
              href="/attendance/new"
              className="flex items-center justify-between p-4 rounded-lg border border-primary/20 bg-primary/[0.02] hover:bg-primary/[0.05] transition-colors group"
            >
              <div className="flex items-center gap-3">
                <Upload className="h-4 w-4 text-primary" />
                <span className="font-medium">Ingest Data</span>
              </div>
              <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link 
              href="/members"
              className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-accent transition-colors"
            >
              <div className="flex items-center gap-3">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span>Manage Roster</span>
              </div>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
