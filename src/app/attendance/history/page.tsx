"use client";

import { useState, useEffect } from "react";
import { 
  History as HistoryIcon, 
  Search, 
  Filter, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  MoreVertical,
  ArrowUpRight,
  Database,
  Image as ImageIcon,
  Trash2,
  Loader2
} from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Session } from "@/types";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchSessions();
  }, []);

  async function fetchSessions() {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (data) setSessions(data);
    setIsLoading(false);
  }

  async function deleteSession(id: string, e: React.MouseEvent) {
    e.preventDefault(); // prevent navigation
    if (!confirm('Are you sure you want to delete this session?')) return;
    
    // Optimistic UI
    setSessions(s => s.filter(x => x.id !== id));
    await supabase.from('sessions').delete().eq('id', id);
  }

  const getStatusBadge = (status: Session['status']) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-500 border border-emerald-500/20">
            <CheckCircle2 className="h-3 w-3" /> Approved
          </span>
        );
      case 'refining':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-500 border border-blue-500/20">
            <Clock className="h-3 w-3" /> In Review
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-500 border border-amber-500/20">
            <AlertCircle className="h-3 w-3" /> Pending
          </span>
        );
    }
  };

  const filteredSessions = sessions.filter(s => 
    s.event_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Organizational Memory</h1>
          <p className="text-muted-foreground mt-1">Revisit, audit, and manage historical attendance sessions.</p>
        </div>
        <Link 
          href="/attendance/new"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
        >
          New Session
        </Link>
      </div>

      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input 
            type="text"
            placeholder="Search sessions..."
            className="w-full rounded-lg border border-border bg-card pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent transition-colors">
          <Filter className="h-4 w-4" /> Filter
        </button>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading && Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-5 h-48 animate-pulse">
            <div className="flex justify-between items-start mb-4">
              <div className="h-12 w-12 rounded-xl bg-white/5" />
              <div className="h-6 w-20 rounded-full bg-white/5" />
            </div>
            <div className="h-6 w-3/4 rounded bg-white/5 mb-3" />
            <div className="h-4 w-1/2 rounded bg-white/5" />
          </div>
        ))}

        {!isLoading && filteredSessions.map((session) => (
          <Link 
            key={session.id}
            href={`/sessions/${session.id}`}
            className="group relative flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:shadow-md hover:border-primary/50"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="rounded-xl bg-primary/5 p-3 group-hover:bg-primary/10 transition-colors">
                <Database className="h-6 w-6 text-primary" />
              </div>
              <div className="flex items-center gap-2">
                {getStatusBadge(session.status)}
                <button 
                  onClick={(e) => deleteSession(session.id, e)}
                  className="p-1.5 rounded-full hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500 transition-colors z-10"
                  title="Delete Session"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            
            <div className="flex-1">
              <h3 className="text-lg font-bold group-hover:text-primary transition-colors line-clamp-1">
                {session.event_name}
              </h3>
              <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4" /> {format(new Date(session.created_at), 'MMM dd, yyyy')}
                </span>
                <span className="flex items-center gap-1.5">
                  <ImageIcon className="h-4 w-4" /> {session.suggested_table?.length || 0} rows
                </span>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {session.status === 'approved' ? 'Completed' : 'Continue Approval'}
              </span>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
            </div>
          </Link>
        ))}

        {filteredSessions.length === 0 && !isLoading && (
          <div className="col-span-full py-20 text-center rounded-2xl border-2 border-dashed border-border">
            <HistoryIcon className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">No sessions found</h3>
            <p className="text-muted-foreground">Start by uploading an attendance sheet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
