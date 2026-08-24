"use client";

import { useState, useEffect, useRef } from "react";
import { Upload, Database, ArrowRight, Zap, FileImage, CheckCircle2 } from "lucide-react";
import { performOCR } from "@/OCR/ocrService";
import { matchMembers } from "@/matching/matchEngine";
import { supabase } from "@/lib/supabase";
import { Member, Correction } from "@/types";
import { validateUpload } from "@/lib/uploadValidation";

export default function NewAttendancePage() {
  const [image, setImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState("Initializing…");
  const [progressPct, setProgressPct] = useState(0);
  const [members, setMembers] = useState<Member[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [eventName, setEventName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function loadData() {
      const { data: m } = await supabase.from('members').select('*');
      const { data: c } = await supabase.from('corrections').select('*');
      if (m) setMembers(m);
      if (c) setCorrections(c);
    }
    loadData();
  }, []);

  const processFile = async (file: File) => {
    if (!file) return;
    validateUpload(file);
    setIsProcessing(true);
    setProgressPct(0);
    setProgressMsg("Reading document…");
    let objectUrl: string | undefined;

    try {
      // 0. Use object URL for instant preview (zero lag)
      objectUrl = URL.createObjectURL(file);
      setImage(objectUrl);

      // 1. Run OCR with live progress
      const extractedLines = await performOCR(file, (msg, pct) => {
        setProgressMsg(msg);
        setProgressPct(pct);
      });

      if (extractedLines.length === 0) {
        alert("No text detected. Please try a clearer, higher-resolution image.");
        setIsProcessing(false);
        return;
      }

      setProgressMsg("Matching members…");
      setProgressPct(95);

      // 2. Match members
      const matchedResults = matchMembers(
        extractedLines.map(l => l.text),
        members,
        corrections
      );

      const finalResults = matchedResults.map((res, i) => ({
        ...res,
        columns: extractedLines[i]?.columns,
        emptyCells: extractedLines[i]?.emptyCells,
        ocrConfidence: extractedLines[i]?.confidence,
        structuralConfidence: extractedLines[i]?.structuralConfidence,
        isHeader: extractedLines[i]?.isHeader,
        bbox: extractedLines[i]?.bbox,
        rowIndex: extractedLines[i]?.rowIndex,
      }));

      setProgressMsg("Saving session…");
      setProgressPct(98);

      // 2.5 Store only a private Storage object key, never image bytes in database rows.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Your session has expired. Please sign in again.");
      const filePath = `${user.id}/${crypto.randomUUID()}.jpg`;
      const compressedImage = await new Promise<Blob>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;
          const max = 1600;
          if (width > max || height > max) {
            const scale = max / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject(new Error("Unable to process image."));
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Unable to encode image.")), "image/jpeg", 0.75);
        };
        img.onerror = () => reject(new Error("Unable to read image."));
        img.src = objectUrl!;
      });
      const { error: uploadError } = await supabase.storage.from("attendance-scans").upload(filePath, compressedImage, { contentType: "image/jpeg", upsert: false });
      if (uploadError) throw uploadError;

      // 3. Create session
      const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .insert({
          event_name: eventName || `Attendance — ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`,
          raw_ocr_data: extractedLines,
          suggested_table: finalResults,
          status: 'pending',
          owner_id: user.id,
          image_url: filePath,
        })
        .select()
        .single();

      if (session) {
        setProgressMsg("Opening workspace…");
        setProgressPct(100);
        window.location.href = `/sessions/${session.id}`;
      } else {
        console.error("Session error:", JSON.stringify(sessionError));
        alert(`Session creation failed: ${sessionError?.message || "Unknown error"}`);
        setIsProcessing(false);
      }
    } catch (err: any) {
      console.error("Processing error:", err);
      alert(`Error: ${err.message || "Something went wrong during processing."}`);
      setIsProcessing(false);
    } finally {
      if (typeof objectUrl !== "undefined") URL.revokeObjectURL(objectUrl);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) processFile(file);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-10 py-12 px-4">
      {/* Hero */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-black uppercase tracking-widest">
          <Zap className="h-3 w-3" /> Table-First AI Extraction
        </div>
        <h1 className="text-4xl font-bold tracking-tight">Data Ingestion Hub</h1>
        <p className="text-muted-foreground text-base max-w-md mx-auto leading-relaxed">
          Upload your attendance register. The AI detects the grid, reads each cell independently, and builds a clean editable spreadsheet.
        </p>
      </div>

      {/* Upload Card */}
      <div className="bg-card border border-border rounded-3xl p-8 shadow-xl space-y-8 relative overflow-hidden">
        {/* Session name */}
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Session Name</label>
          <input
            type="text"
            placeholder="e.g., Q3 Attendance — Main Hall"
            className="w-full bg-accent/30 border border-border rounded-xl px-4 py-3 text-sm focus:ring-2 ring-primary/20 outline-none transition-all"
            value={eventName}
            onChange={e => setEventName(e.target.value)}
            disabled={isProcessing}
          />
        </div>

        {/* Drop Zone */}
        <div
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => !isProcessing && inputRef.current?.click()}
          className={`
            border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all
            ${dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-primary/[0.01]'}
            ${isProcessing ? 'cursor-not-allowed' : ''}
          `}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept="image/*"
            onChange={handleFileChange}
            disabled={isProcessing}
          />

          {isProcessing ? (
            <div className="space-y-6">
              {/* Progress Spinner */}
              <div className="relative mx-auto w-16 h-16">
                <div className="h-16 w-16 border-4 border-primary/10 rounded-full" />
                <div className="h-16 w-16 border-4 border-primary border-t-transparent rounded-full animate-spin absolute top-0 shadow-lg shadow-primary/20" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[9px] font-black text-primary">{progressPct}%</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="max-w-xs mx-auto space-y-2">
                <div className="h-1.5 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-500 ease-out rounded-full"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="text-[11px] font-bold text-muted-foreground animate-pulse">{progressMsg}</p>
              </div>

              {/* Image preview */}
              {image && (
                <div className="mx-auto max-w-xs rounded-xl overflow-hidden border border-border opacity-60">
                  <img src={image} alt="Preview" className="w-full object-contain max-h-40" />
                </div>
              )}
            </div>
          ) : image ? (
            <div className="flex flex-col items-center gap-4">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <p className="text-sm font-bold text-emerald-500">Image loaded — starting analysis…</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-full bg-primary/5 border border-primary/10 p-6 w-24 h-24 mx-auto flex items-center justify-center">
                <FileImage className="h-10 w-10 text-primary" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold">Drop your register here</h3>
                <p className="text-sm text-muted-foreground">PNG, JPG, JPEG — screenshots, scans, photos all supported</p>
              </div>
              <div className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20 hover:scale-[1.02] transition-all">
                <Upload className="h-4 w-4" /> Browse Files
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pipeline steps */}
      <div className="grid sm:grid-cols-3 gap-4">
        {[
          { icon: Database, color: "blue", title: "1. Grid Detection", desc: "AI identifies table boundaries, row separators, and column gutters before OCR starts." },
          { icon: Zap, color: "amber", title: "2. Cell-by-Cell OCR", desc: "Each cell is extracted individually and read at 3× scale for maximum accuracy." },
          { icon: ArrowRight, color: "emerald", title: "3. Human Verification", desc: "You approve, correct, and finalize the structured table in an Excel-like workspace." },
        ].map(({ icon: Icon, color, title, desc }) => (
          <div key={title} className="p-5 rounded-2xl border border-border bg-card/50 space-y-3">
            <div className={`h-8 w-8 rounded-lg bg-${color}-500/10 flex items-center justify-center`}>
              <Icon className={`h-4 w-4 text-${color}-500`} />
            </div>
            <h4 className="text-xs font-black uppercase tracking-wide">{title}</h4>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
