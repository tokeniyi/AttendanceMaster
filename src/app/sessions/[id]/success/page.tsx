"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  CheckCircle2, 
  Download, 
  Share2, 
  FileText, 
  ArrowRight,
  ExternalLink,
  Table as TableIcon,
  ChevronLeft,
  Calendar,
  Layers,
  Database
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Session, MatchResult } from "@/types";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { exportAttendanceCSV } from "@/services/csvService";
import Papa from 'papaparse';

export default function SessionSuccessPage() {
  const { id } = useParams();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadSession() {
      const { data } = await supabase.from('sessions').select('*').eq('id', id).single();
      if (data) setSession(data);
      setIsLoading(false);
    }
    loadSession();
  }, [id]);

  const handleDownload = () => {
    if (!session?.final_table) return;
    
    // Create a "Clean" data export
    // We determine the max number of columns in any row
    const maxCols = Math.max(...session.final_table.map(r => r.columns?.length || 1));
    
    // Map columns to their own fields
    const exportData = session.final_table.map(row => {
      const cols = row.columns || [row.ocrName];
      const rowData: any = {};
      
      // Use Column A, B, C... as keys to ensure PapaParse separates them
      cols.forEach((val, i) => {
        const key = String.fromCharCode(65 + i); // A, B, C...
        rowData[key] = val;
      });
      
      return rowData;
    });
    
    // Explicitly unparse with headers disabled to keep it clean
    const csv = Papa.unparse(exportData, { header: false });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `clean_attendance_${new Date().toISOString().split('T')[0]}.csv`);
    link.click();
  };

  if (isLoading) return <div className="flex items-center justify-center h-screen bg-background text-sm animate-pulse">Generating Report...</div>;

  const finalTable = session?.final_table || [];

  return (
    <div className="max-w-6xl mx-auto space-y-12 py-12 px-6">
      {/* Premium Success Header */}
      <div className="flex flex-col items-center text-center space-y-6">
        <div className="h-20 w-20 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center animate-in zoom-in duration-500">
          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
        </div>
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">Session Finalized</h1>
          <p className="text-muted-foreground text-lg">Your data has been structured, verified, and saved to organizational memory.</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* LEFT: Export & Actions */}
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-3xl p-8 shadow-xl space-y-8">
            <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Productivity Options</h3>
            
            <div className="space-y-3">
              <button 
                onClick={handleDownload}
                className="w-full flex items-center justify-between p-4 rounded-2xl bg-primary text-primary-foreground hover:scale-[1.02] transition-all group"
              >
                <div className="flex items-center gap-3">
                  <Download className="h-5 w-5" />
                  <span className="font-bold text-sm">Download CSV/Excel</span>
                </div>
                <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </button>

              <button 
                className="w-full flex items-center justify-between p-4 rounded-2xl border border-border bg-card hover:bg-accent transition-all group opacity-80 hover:opacity-100"
                onClick={() => alert("Connecting to Google Sheets API...")}
              >
                <div className="flex items-center gap-3">
                  <ExternalLink className="h-5 w-5 text-emerald-500" />
                  <span className="font-bold text-sm">Sync to Google Sheets</span>
                </div>
                <ArrowRight className="h-4 w-4" />
              </button>

              <button 
                className="w-full flex items-center justify-between p-4 rounded-2xl border border-border bg-card hover:bg-accent transition-all group opacity-80 hover:opacity-100"
                onClick={() => window.print()}
              >
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-blue-500" />
                  <span className="font-bold text-sm">Generate PDF Report</span>
                </div>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="pt-6 border-t border-border space-y-4">
              <div className="flex items-center justify-between text-xs font-bold text-muted-foreground uppercase tracking-widest">
                <span>Session Metadata</span>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>{session?.session_date}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  <span>{finalTable.length} Structured Rows</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <span>Stored in Main Memory</span>
                </div>
              </div>
            </div>
          </div>

          {/* NEW: Analytics Insights */}
          <div className="bg-card border border-border rounded-3xl p-8 shadow-xl space-y-6">
            <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Analytics Intelligence</h3>
            
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Data Quality Index</span>
                  <span className="text-xs font-black text-primary">{Math.round((finalTable.filter(r => (r.ocrConfidence || 0) > 80).length / finalTable.length) * 100)}%</span>
                </div>
                <div className="h-1.5 w-full bg-primary/10 rounded-full overflow-hidden">
                  <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${(finalTable.filter(r => (r.ocrConfidence || 0) > 80).length / finalTable.length) * 100}%` }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-accent/30 border border-border text-center">
                  <div className="text-xl font-black">{finalTable.filter(r => r.status === 'correction' || r.rawOverride).length}</div>
                  <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mt-1">Manual Edits</div>
                </div>
                <div className="p-4 rounded-2xl bg-accent/30 border border-border text-center">
                  <div className="text-xl font-black text-rose-500">{finalTable.filter(r => r.status === 'flagged').length}</div>
                  <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mt-1">Flagged</div>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-accent/30 border border-border space-y-3">
                <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Structural Distribution</span>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span>Headers</span>
                    <span>{finalTable.filter(r => r.isHeader).length}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span>Identified Records</span>
                    <span>{finalTable.filter(r => !r.isHeader && r.suggestedMember).length}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span>Unknown Entities</span>
                    <span>{finalTable.filter(r => !r.isHeader && !r.suggestedMember).length}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Link 
            href="/attendance/history" 
            className="flex items-center justify-center gap-2 text-sm font-bold text-muted-foreground hover:text-primary transition-colors"
          >
            <ChevronLeft className="h-4 w-4" /> Return to Organizational Memory
          </Link>
        </div>

        {/* RIGHT: Data Preview */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card border border-border rounded-3xl overflow-hidden shadow-xl">
            <div className="h-12 border-b border-border bg-muted/30 px-6 flex items-center gap-3">
              <TableIcon className="h-4 w-4 text-primary" />
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Final Table Output</span>
            </div>
            
            <div className="overflow-auto max-h-[600px]">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-background border-b border-border">
                  <tr className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">
                    <th className="p-4">#</th>
                    <th className="p-4">Structured Columns</th>
                    <th className="p-4">Identity Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {finalTable.map((row, idx) => (
                    <tr 
                      key={idx} 
                      className={cn(
                        "transition-colors hover:bg-accent/10",
                        row.isHeader ? "bg-muted/40 font-black" : ""
                      )}
                    >
                      <td className="p-4 font-mono text-[10px] text-muted-foreground">{idx + 1}</td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-2">
                          {(row.columns || [row.ocrName]).map((col, cIdx) => (
                            <span 
                              key={cIdx} 
                              className={cn(
                                "px-2 py-1 rounded-md border",
                                row.isHeader ? "bg-primary/10 border-primary/20 text-[9px] uppercase tracking-widest font-black" : "bg-card border-border text-[11px] font-mono"
                              )}
                            >
                              {col}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-4">
                        {!row.isHeader && (
                          <span className="text-[11px] font-bold text-primary">{row.suggestedMember?.full_name || "Unmapped"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
