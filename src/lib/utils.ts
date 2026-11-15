import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatConfidence(score: number): string {
  if (!Number.isFinite(score)) return '0%';
  const pct = Math.round(Math.min(1, Math.max(0, score)) * 100);
  return `${pct}%`;
}

export function getStatusColor(status: string) {
  switch (status) {
    case 'exact': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
    case 'approved': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
    case 'correction': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
    case 'fuzzy': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
    case 'flagged': return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
    default: return 'text-slate-500 bg-slate-500/10 border-slate-500/20';
  }
}
