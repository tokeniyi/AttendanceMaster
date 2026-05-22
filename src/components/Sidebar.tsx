"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  Users, 
  Upload, 
  History, 
  Settings,
  LogOut
} from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Members", href: "/members", icon: Users },
  { name: "New Attendance", href: "/attendance/new", icon: Upload },
  { name: "History", href: "/attendance/history", icon: History },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-screen w-64 flex-col bg-card border-r border-border">
      <div className="flex flex-col px-6 py-8">
        <span className="text-xl font-bold tracking-tight text-primary">
          ATTENDANCE<span className="text-muted-foreground">MASTER</span>
        </span>
        <div className="mt-2 flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary border border-primary/20">
            v1.1.0
          </span>
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500 border border-emerald-500/20">
            SMART OCR
          </span>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        <div className="px-3 mb-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Main Menu</div>
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "group flex items-center rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-wider transition-all",
                isActive
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon
                className={cn(
                  "mr-3 h-4 w-4 flex-shrink-0",
                  isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-accent-foreground"
                )}
              />
              {item.name}
            </Link>
          );
        })}

        <div className="mt-8 px-3 mb-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Recent Workspaces</div>
        <div className="space-y-1">
          <Link href="#" className="group flex items-center rounded-xl px-3 py-2 text-[10px] font-bold text-muted-foreground hover:bg-accent transition-all">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-3" />
            <span className="truncate">Main Stage Rehearsal</span>
          </Link>
          <Link href="#" className="group flex items-center rounded-xl px-3 py-2 text-[10px] font-bold text-muted-foreground hover:bg-accent transition-all">
            <div className="h-1.5 w-1.5 rounded-full bg-amber-500 mr-3" />
            <span className="truncate">Backstage Workshop</span>
          </Link>
        </div>
      </nav>
      <div className="border-t border-border p-4">
        <button className="group flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
          <LogOut className="mr-3 h-5 w-5 text-muted-foreground group-hover:text-accent-foreground" />
          Logout
        </button>
      </div>
    </div>
  );
}
