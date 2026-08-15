"use client";

import { useState, useEffect, useRef, useMemo, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  CheckCircle2, ChevronLeft, Maximize2, Minimize2, Zap, UserCheck,
  Check, ChevronDown, Flag, Table as TableIcon, Layout, Eye,
  FileSpreadsheet, Merge, Trash2, Undo2, Redo2, MousePointer2, Info,
  Layers, CheckSquare, Download, Copy
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Session, Member, MatchResult } from "@/types";
import { cn } from "@/lib/utils";
import { COLUMN_TYPE_CONFIG, type ColumnType } from "@/lib/semanticAnalyzer";

const CellInput = ({ initialValue, onChange, isHeader }: { initialValue: string, onChange: (val: string) => void, isHeader?: boolean }) => {
  const [val, setVal] = useState(initialValue);
  useEffect(() => { setVal(initialValue); }, [initialValue]);
  
  return (
    <input
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={() => { if (val !== initialValue) onChange(val); }}
      onClick={e => e.stopPropagation()}
      className={cn(
        "w-full bg-transparent outline-none font-mono text-[10px] px-2 py-1 rounded",
        "focus:bg-white/10 focus:ring-1 ring-primary/40 transition-all",
        isHeader ? "font-black text-primary" : "text-white/80"
      )}
    />
  );
};

export default function SessionWorkspace() {
  const { id } = useParams();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tableData, setTableData] = useState<MatchResult[]>([]);
  const [history, setHistory] = useState<MatchResult[][]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [isLoading, setIsLoading] = useState(true);
  const [focusedRowIdx, setFocusedRowIdx] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [numCols, setNumCols] = useState(1);
  const [showDebug, setShowDebug] = useState(false);
  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const imagePanelRef = useRef<HTMLDivElement>(null);

  // Infer column types from header row data
  const colSchemas = useMemo(() => {
    const headerRow = tableData.find(r => r.isHeader);
    return Array.from({ length: numCols }, (_, i) => {
      const label = headerRow?.columns?.[i] ?? `Col ${i + 1}`;
      const samples = tableData.filter(r => !r.isHeader).map(r => r.columns?.[i] ?? '').filter(Boolean);
      const lowerLabel = label.toLowerCase();
      let type: ColumnType = 'unknown';
      if (/sr\.?|no\.?|#|serial/i.test(lowerLabel)) type = 'serial';
      else if (/name/i.test(lowerLabel)) type = 'name';
      else if (/designation|role/i.test(lowerLabel)) type = 'designation';
      else if (/%|percent/i.test(lowerLabel)) type = 'percentage';
      else if (/total|working|days|balance|absent|present|lwp|ott/i.test(lowerLabel)) type = 'numeric';
      else if (/status/i.test(lowerLabel)) type = 'status';
      else if (samples.length > 0 && samples.filter(s => /^\d+$/.test(s.trim())).length / samples.length > 0.7) type = 'numeric';
      else if (samples.length > 0) type = 'text';
      return { label, type, colIndex: i };
    });
  }, [tableData, numCols]);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      const [sRes, mRes] = await Promise.all([
        supabase.from('sessions').select('*').eq('id', id).single(),
        supabase.from('members').select('*'),
      ]);
      if (sRes.data) {
        setSession(sRes.data);
        if (sRes.data.image_url) {
          const { data: signed } = await supabase.storage.from('attendance-scans').createSignedUrl(sRes.data.image_url, 300);
          if (signed?.signedUrl) setSourceImageUrl(signed.signedUrl);
        }
        const data: MatchResult[] = sRes.data.suggested_table || [];
        setTableData(data);
        setHistory([data]);
        setHistoryIdx(0);
        if (data.length > 0) setFocusedRowIdx(0);
        // Infer max column count from data
        const max = data.reduce((m, r) => Math.max(m, r.columns?.length ?? 1), 1);
        setNumCols(max);
      }
      if (mRes.data) setMembers(mRes.data);
      setIsLoading(false);
    }
    load();
  }, [id]);

  // Visual sync: pan to focused row
  useEffect(() => {
    if (focusedRowIdx === null || !tableData[focusedRowIdx]?.bbox || !imagePanelRef.current) return;
    const bbox = tableData[focusedRowIdx].bbox!;
    const panel = imagePanelRef.current;
    panel.scrollTo({
      left: Math.max(0, (bbox.x0 + bbox.x1) / 2 * zoom - panel.clientWidth / 2),
      top: Math.max(0, (bbox.y0 + bbox.y1) / 2 * zoom - panel.clientHeight / 2),
      behavior: 'smooth',
    });
  }, [focusedRowIdx, zoom]);

  // Keyboard navigation
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowDown') setFocusedRowIdx(p => Math.min((p ?? 0) + 1, tableData.length - 1));
      if (e.key === 'ArrowUp') setFocusedRowIdx(p => Math.max((p ?? 0) - 1, 0));
      if (e.key === 'Enter' && focusedRowIdx !== null) approveRow(focusedRowIdx);
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') undo();
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') redo();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [focusedRowIdx, tableData, historyIdx]);

  const pushHistory = (newData: MatchResult[]) => {
    startTransition(() => {
      setTableData(newData);
      const newHistory = history.slice(0, historyIdx + 1);
      newHistory.push(newData);
      setHistory(newHistory);
      setHistoryIdx(newHistory.length - 1);
      const max = newData.reduce((m, r) => Math.max(m, r.columns?.length ?? 1), 1);
      setNumCols(max);
    });
  };

  const undo = () => { if (historyIdx > 0) { startTransition(() => { setTableData(history[historyIdx - 1]); setHistoryIdx(h => h - 1); }); } };
  const redo = () => { if (historyIdx < history.length - 1) { startTransition(() => { setTableData(history[historyIdx + 1]); setHistoryIdx(h => h + 1); }); } };

  const editCell = (rowIdx: number, colIdx: number, value: string) => {
    const nd = tableData.map((r, i) => {
      if (i !== rowIdx) return r;
      const cols = [...(r.columns ?? [r.ocrName])];
      cols[colIdx] = value;
      return { ...r, columns: cols, status: 'correction' as const };
    });
    pushHistory(nd);
  };

  const assignMember = (rowIdx: number, memberId: string) => {
    const member = members.find(m => m.id === memberId) ?? null;
    const nd = tableData.map((r, i) => i !== rowIdx ? r : { ...r, suggestedMember: member, status: memberId ? 'correction' as const : 'none' as const });
    pushHistory(nd);
  };

  const approveRow = (idx: number) => {
    const nd = tableData.map((r, i) => i !== idx ? r : { ...r, status: 'approved' as const });
    pushHistory(nd);
    setFocusedRowIdx(i => (i !== null && i < tableData.length - 1) ? i + 1 : i);
  };

  const flagRow = (idx: number) => {
    const nd = tableData.map((r, i) => i !== idx ? r : { ...r, status: 'flagged' as const });
    pushHistory(nd);
  };

  const toggleHeader = (idx: number) => {
    const nd = tableData.map((r, i) => i !== idx ? r : { ...r, isHeader: !r.isHeader });
    pushHistory(nd);
  };

  const deleteRow = (idx: number) => {
    pushHistory(tableData.filter((_, i) => i !== idx));
    setFocusedRowIdx(null);
  };

  const mergeRowUp = (idx: number) => {
    if (idx === 0) return;
    const nd = [...tableData];
    const merged = { ...nd[idx - 1], columns: [...(nd[idx - 1].columns ?? []), ...(nd[idx].columns ?? [])] };
    nd[idx - 1] = merged;
    nd.splice(idx, 1);
    pushHistory(nd);
    setFocusedRowIdx(idx - 1);
  };

  const exportToCSV = () => {
    if (tableData.length === 0) return;
    
    let csvContent = "";
    const headers = tableData.find(r => r.isHeader)?.columns || [];
    if (headers.length > 0) csvContent += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',') + "\n";

    tableData.filter(r => !r.isHeader && (r as any).region !== 'title' && (r as any).region !== 'footer').forEach(row => {
      if (row.columns) csvContent += row.columns.map(c => `"${(c || '').replace(/"/g, '""')}"`).join(',') + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${session?.event_name || 'attendance'}_export.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyToSheets = () => {
    if (tableData.length === 0) return;
    let tsvContent = "";
    const headers = tableData.find(r => r.isHeader)?.columns || [];
    if (headers.length > 0) tsvContent += headers.join('\t') + "\n";
    tableData.filter(r => !r.isHeader && (r as any).region !== 'title' && (r as any).region !== 'footer').forEach(row => {
      if (row.columns) tsvContent += row.columns.join('\t') + "\n";
    });
    navigator.clipboard.writeText(tsvContent);
    alert("Copied to clipboard in Google Sheets format!");
  };

  const [isSaving, setIsSaving] = useState(false);

  const saveState = async (status: Session['status'] = 'refining') => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      if (status === 'approved') {
        const { error } = await supabase.rpc('approve_session', { p_session_id: id, p_rows: tableData });
        if (error) throw error;
        router.push(`/sessions/${id}/success`);
        return;
      }
      const { error } = await supabase.from('sessions').update({ suggested_table: tableData, status, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    } catch (error) {
      console.error('Unable to save session:', error);
      alert(error instanceof Error ? error.message : 'Unable to save session.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return (
    <div className="flex flex-col items-center justify-center h-screen bg-[#050505] text-white gap-4">
      <div className="relative h-16 w-16">
        <div className="absolute inset-0 border-4 border-white/5 rounded-full" />
        <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground animate-pulse">Loading Workspace…</p>
    </div>
  );

  const focusedRow = focusedRowIdx !== null ? tableData[focusedRowIdx] : null;
  const approvedCount = tableData.filter(r => r.status === 'approved').length;
  const progressPct = tableData.length > 0 ? (approvedCount / tableData.length) * 100 : 0;

  return (
    <div className="flex flex-col h-screen bg-[#080808] text-white overflow-hidden">
      {/* Header */}
      <header className="h-14 border-b border-white/5 bg-black/60 backdrop-blur-2xl flex items-center justify-between px-6 z-50 shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 hover:bg-white/5 rounded-lg text-muted-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-3">
            <div className="h-7 w-7 rounded bg-primary/10 border border-primary/20 flex items-center justify-center">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-[11px] font-black uppercase tracking-widest">{session?.event_name}</h1>
              <p className="text-[8px] text-muted-foreground uppercase tracking-widest">Human-in-the-Loop Workspace · {tableData.length} rows</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
            <button onClick={undo} disabled={historyIdx <= 0} className="p-1.5 hover:bg-white/10 rounded disabled:opacity-30 transition-all" title="Undo (Ctrl+Z)"><Undo2 className="h-3.5 w-3.5" /></button>
            <button onClick={redo} disabled={historyIdx >= history.length - 1} className="p-1.5 hover:bg-white/10 rounded disabled:opacity-30 transition-all" title="Redo (Ctrl+Y)"><Redo2 className="h-3.5 w-3.5" /></button>
          </div>
          <div className="flex items-center gap-1 bg-white/5 p-1 rounded-lg border border-white/10 mr-2">
            <button onClick={exportToCSV} className="px-3 py-1.5 flex items-center gap-2 hover:bg-white/10 rounded transition-all text-[10px] font-bold uppercase tracking-widest text-emerald-400" title="Download CSV">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <div className="w-[1px] h-4 bg-white/10 mx-1" />
            <button onClick={copyToSheets} className="px-3 py-1.5 flex items-center gap-2 hover:bg-white/10 rounded transition-all text-[10px] font-bold uppercase tracking-widest text-blue-400" title="Copy for Google Sheets (Paste directly)">
              <Copy className="h-3.5 w-3.5" /> Sheets Sync
            </button>
          </div>
          <button onClick={() => saveState('approved')} disabled={isSaving} className="h-9 bg-primary text-primary-foreground px-5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-primary/20">
            Finalize & Approve
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* ── PANEL 1: Source Image ── */}
        <div className="w-[36%] border-r border-white/5 bg-[#050505] flex flex-col relative overflow-hidden group shrink-0">
          <div className="h-8 border-b border-white/5 px-4 flex items-center gap-2 shrink-0">
            <Eye className="h-3 w-3 text-primary" />
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground">Source Document</span>
            <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => setZoom(z => Math.min(z + 0.2, 4))} className="p-1 hover:bg-white/10 rounded text-muted-foreground"><Maximize2 className="h-3 w-3" /></button>
              <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.5))} className="p-1 hover:bg-white/10 rounded text-muted-foreground"><Minimize2 className="h-3 w-3" /></button>
              <button onClick={() => setZoom(1)} className="px-2 h-5 hover:bg-white/10 rounded text-[8px] font-mono text-muted-foreground">1×</button>
            </div>
          </div>

          <div ref={imagePanelRef} className="flex-1 overflow-auto scrollbar-hide p-8">
            <div className="relative inline-block transition-transform duration-500 ease-out origin-top-left" style={{ transform: `scale(${zoom})` }}>
              {sourceImageUrl && (
                <img src={sourceImageUrl} alt="Source" className="max-w-none shadow-2xl border border-white/10 rounded-sm" />
              )}
              {/* Debug overlay: show all region bboxes when debug mode active */}
              {showDebug && tableData.map((row, idx) => row.bbox && (
                <div
                  key={`dbg-${idx}`}
                  className="absolute border rounded-[2px] pointer-events-none z-20"
                  style={{
                    left: row.bbox.x0, top: row.bbox.y0,
                    width: row.bbox.x1 - row.bbox.x0,
                    height: row.bbox.y1 - row.bbox.y0,
                    borderColor:
                      (row as any).region === 'header' ? 'rgba(59,130,246,0.7)' :
                      (row as any).region === 'title' ? 'rgba(167,139,250,0.7)' :
                      (row as any).region === 'footer' ? 'rgba(251,191,36,0.7)' :
                      (row as any).region === 'metadata' ? 'rgba(148,163,184,0.5)' :
                      'rgba(34,197,94,0.4)',
                    background:
                      (row as any).region === 'header' ? 'rgba(59,130,246,0.05)' :
                      (row as any).region === 'title' ? 'rgba(167,139,250,0.05)' :
                      (row as any).region === 'data' ? 'rgba(34,197,94,0.03)' : 'transparent',
                  }}
                />
              ))}
              {tableData.map((row, idx) => row.bbox && (
                <div
                  key={idx}
                  onClick={() => setFocusedRowIdx(idx)}
                  className={cn(
                    "absolute border-2 rounded-[2px] cursor-pointer transition-all duration-200",
                    focusedRowIdx === idx
                      ? "border-primary z-10"
                      : "border-transparent hover:border-primary/30"
                  )}
                  style={{
                    left: row.bbox.x0, top: row.bbox.y0,
                    width: row.bbox.x1 - row.bbox.x0,
                    height: row.bbox.y1 - row.bbox.y0,
                    background: focusedRowIdx === idx ? 'rgba(var(--primary), 0.15)' : 'transparent',
                    boxShadow: focusedRowIdx === idx ? '0 0 0 9999px rgba(0,0,0,0.55)' : 'none',
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ── PANEL 2: Spreadsheet Grid ── */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-8 border-b border-white/5 bg-black/20 px-4 flex items-center gap-3 shrink-0">
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground">Data Matrix</span>
            <div className="h-3 w-[1px] bg-white/10" />
            <span className="text-[9px] text-primary font-bold">{numCols} cols · {tableData.length} rows</span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => {
                  const nd = tableData.map(r => r.region === 'data' ? { ...r, status: 'approved' as const } : r);
                  pushHistory(nd);
                }}
                className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded text-[8px] font-black uppercase text-emerald-400 hover:bg-emerald-500/20 transition-all"
              >
                <CheckSquare className="h-3 w-3" /> Approve All Data
              </button>
              <button
                onClick={() => setShowDebug(d => !d)}
                className={cn("flex items-center gap-1.5 px-2 py-1 rounded border text-[8px] font-black uppercase transition-all",
                  showDebug ? "bg-primary/20 border-primary/40 text-primary" : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10")}
              >
                <Layers className="h-3 w-3" /> Debug
              </button>
              <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-[9px] font-mono text-muted-foreground">{approvedCount}/{tableData.length}</span>
            </div>
          </div>

          <div className="flex-1 overflow-auto custom-scrollbar">
            <table className="w-full text-[11px] border-collapse" style={{ tableLayout: 'fixed' }}>
              {/* Dynamic column headers */}
              <colgroup>
                <col style={{ width: 40 }} />
                {Array.from({ length: numCols }).map((_, i) => (
                  <col key={i} style={{ width: `${Math.max(80, Math.floor(100 / numCols))}px` }} />
                ))}
                <col style={{ width: 160 }} />
                <col style={{ width: 36 }} />
              </colgroup>
              <thead className="sticky top-0 bg-[#0a0a0a]/95 backdrop-blur z-30 border-b border-white/10">
                {/* Semantic column type row */}
                <tr className="h-6 border-b border-white/5">
                  <th className="border-r border-white/5" />
                  {colSchemas.map((schema, i) => {
                    const cfg = COLUMN_TYPE_CONFIG[schema.type];
                    return (
                      <th key={i} className="px-2 text-left border-r border-white/5">
                        <span className={cn("inline-block px-1.5 py-0.5 rounded text-[7px] font-black uppercase border", cfg.color)}>
                          {cfg.label}
                        </span>
                      </th>
                    );
                  })}
                  <th className="border-r border-white/5" />
                  <th />
                </tr>
                {/* Column label row */}
                <tr className="h-8 text-[9px] font-black text-muted-foreground uppercase tracking-widest">
                  <th className="border-r border-white/5 text-center">#</th>
                  {colSchemas.map((schema, i) => (
                    <th key={i} className="px-3 text-left border-r border-white/5 truncate" title={schema.label}>
                      {schema.label.length > 12 ? schema.label.slice(0, 12) + '…' : schema.label}
                    </th>
                  ))}
                  <th className="px-3 text-left border-r border-white/5">Member</th>
                  <th className="text-center">●</th>
                </tr>
              </thead>
              <tbody>
                {tableData.map((row, rIdx) => {
                  const cells = row.columns ?? [row.ocrName];
                  // Pad to numCols
                  const padded = Array.from({ length: numCols }, (_, i) => cells[i] ?? '');
                  const isFocused = focusedRowIdx === rIdx;
                  return (
                    <tr
                      key={rIdx}
                      onClick={() => setFocusedRowIdx(rIdx)}
                      className={cn(
                        "border-b border-white/[0.04] cursor-pointer transition-colors relative",
                        isFocused ? "bg-primary/[0.06]" : "hover:bg-white/[0.02]",
                        row.isHeader ? "bg-white/[0.04]" : "",
                        (row as any).region === 'title' || (row as any).region === 'metadata' ? "bg-violet-500/5" : "",
                        (row as any).region === 'footer' ? "bg-amber-500/5" : "",
                        row.status === 'approved' ? "opacity-55" : "",
                        row.status === 'flagged' ? "border-l-2 border-rose-500" : ""
                      )}
                    >
                      <td className="text-center border-r border-white/5 py-2 font-mono text-muted-foreground text-[9px] relative">
                        {isFocused && <div className="absolute left-0 top-0 w-0.5 h-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.5)]" />}
                        {rIdx + 1}
                      </td>
                      {padded.map((cellVal, cIdx) => {
                        const isSuppressed = showDebug && row.emptyCells?.[cIdx];
                        return (
                          <td 
                            key={cIdx} 
                            className={cn(
                              "border-r border-white/[0.04] py-1 px-1 transition-all",
                              isSuppressed && "bg-rose-500/10 border-rose-500/20 relative overflow-hidden"
                            )}
                          >
                            {isSuppressed && <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGcgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTAgMjBMMjAgMCIvPjwvZz48L3N2Zz4=')] opacity-50" />}
                            <CellInput
                              initialValue={cellVal}
                            onChange={val => editCell(rIdx, cIdx, val)}
                            isHeader={row.isHeader}
                          />
                        </td>
                        );
                      })}
                      <td className="px-3 border-r border-white/5 py-1">
                        {!row.isHeader && (
                          <div className="flex items-center gap-1.5">
                            <UserCheck className={cn("h-3 w-3 shrink-0", row.suggestedMember ? "text-emerald-500" : "text-white/20")} />
                            <span className={cn("text-[9px] font-bold truncate", row.suggestedMember ? "text-emerald-400" : "text-white/30 italic")}>
                              {row.suggestedMember?.full_name ?? "Unassigned"}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="text-center py-1">
                        <div className={cn(
                          "w-2 h-2 rounded-full mx-auto",
                          row.status === 'approved' ? "bg-emerald-500 shadow-[0_0_6px_#10b981]" :
                          row.status === 'flagged' ? "bg-rose-500" : "bg-white/10"
                        )} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── PANEL 3: Row Controls ── */}
        <div className="w-[260px] border-l border-white/5 bg-black/50 flex flex-col p-5 overflow-y-auto shrink-0">
          {focusedRow ? (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-200">
              <div>
                <h2 className="text-[9px] font-black uppercase tracking-[0.25em] text-muted-foreground mb-3">Row Intelligence</h2>
                {/* Confidence scores */}
                <div className="space-y-2 p-3 rounded-xl bg-white/[0.03] border border-white/5">
                  {[
                    { label: 'OCR Confidence', val: focusedRow.confidence ?? 0 },
                    { label: 'Row Alignment', val: focusedRow.structuralConfidence?.row ?? 0 },
                    { label: 'Column Stability', val: focusedRow.structuralConfidence?.column ?? 0 },
                  ].map(({ label, val }) => (
                    <div key={label}>
                      <div className="flex justify-between text-[8px] font-bold uppercase mb-1">
                        <span className="text-muted-foreground">{label}</span>
                        <span className={val > 70 ? "text-emerald-400" : "text-amber-400"}>{Math.round(val)}%</span>
                      </div>
                      <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                        <div className={cn("h-full transition-all", val > 70 ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${val}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* AI Explanation */}
                {(focusedRow as any).explanation && (
                  <div className="mt-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Zap className="h-2.5 w-2.5 text-primary" />
                      <span className="text-[7px] font-black uppercase tracking-widest text-primary">AI Reasoning</span>
                    </div>
                    <p className="text-[9px] text-muted-foreground leading-relaxed">
                      {(focusedRow as any).explanation}
                    </p>
                    {(focusedRow as any).region && (
                      <div className={cn(
                        "mt-2 inline-block px-2 py-0.5 rounded text-[7px] font-black uppercase border",
                        (focusedRow as any).region === 'header' ? 'text-blue-400 bg-blue-400/10 border-blue-400/20' :
                        (focusedRow as any).region === 'title' ? 'text-violet-400 bg-violet-400/10 border-violet-400/20' :
                        (focusedRow as any).region === 'footer' ? 'text-amber-400 bg-amber-400/10 border-amber-400/20' :
                        (focusedRow as any).region === 'metadata' ? 'text-slate-400 bg-slate-400/10 border-slate-400/20' :
                        'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
                      )}>
                        {(focusedRow as any).region}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Classification */}
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground block mb-2">Row Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {[{ label: 'Header', val: true, icon: TableIcon }, { label: 'Data', val: false, icon: Layout }].map(({ label, val, icon: Icon }) => (
                    <button key={label} onClick={() => { if (focusedRow.isHeader !== val) toggleHeader(focusedRowIdx!); }}
                      className={cn("h-9 rounded-lg border text-[9px] font-black uppercase flex items-center justify-center gap-1.5 transition-all",
                        focusedRow.isHeader === val ? "bg-primary border-primary text-primary-foreground" : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10")}>
                      <Icon className="h-3 w-3" />{label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Member assignment */}
              {!focusedRow.isHeader && (
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground block mb-2">Assign Member</label>
                  <div className="relative">
                    <select
                      className="w-full h-10 bg-white/5 border border-white/10 rounded-lg px-3 text-[10px] font-bold appearance-none outline-none focus:ring-2 ring-primary/20"
                      value={focusedRow.suggestedMember?.id ?? ''}
                      onChange={e => assignMember(focusedRowIdx!, e.target.value)}
                      onClick={e => e.stopPropagation()}
                    >
                      <option value="">No match</option>
                      {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              )}

              {/* Structural ops */}
              <div className="space-y-2">
                <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground block">Structure</label>
                <button onClick={() => mergeRowUp(focusedRowIdx!)} className="w-full h-9 bg-white/5 border border-white/10 rounded-lg text-[9px] font-black uppercase flex items-center justify-center gap-2 hover:bg-white/10 transition-all">
                  <Merge className="h-3 w-3" /> Merge with Above
                </button>
                <button onClick={() => deleteRow(focusedRowIdx!)} className="w-full h-9 border border-rose-500/20 text-rose-500/70 rounded-lg text-[9px] font-black uppercase flex items-center justify-center gap-2 hover:bg-rose-500/10 transition-all">
                  <Trash2 className="h-3 w-3" /> Delete Row
                </button>
              </div>

              {/* Approve / Flag */}
              <div className="space-y-2 pt-2 border-t border-white/5">
                <button onClick={() => approveRow(focusedRowIdx!)} disabled={focusedRow.status === 'approved'}
                  className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:grayscale text-white rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-900/30">
                  <Check className="h-4 w-4" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Verify & Next</span>
                </button>
                <button onClick={() => flagRow(focusedRowIdx!)}
                  className={cn("w-full h-10 rounded-xl border text-[9px] font-black uppercase flex items-center justify-center gap-2 transition-all",
                    focusedRow.status === 'flagged' ? "bg-rose-500 border-rose-500 text-white" : "border-white/10 text-muted-foreground hover:bg-white/5")}>
                  <Flag className="h-3.5 w-3.5" /> Flag for Review
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center opacity-20 gap-4">
              <MousePointer2 className="h-10 w-10" />
              <p className="text-[9px] font-black uppercase tracking-[0.2em]">Select a row to begin</p>
              <p className="text-[8px] text-muted-foreground">Use ↑ ↓ arrows · Enter to approve</p>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 10px; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
