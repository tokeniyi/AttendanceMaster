"use client";

import { useState, useEffect } from "react";
import { 
  Users, 
  UserPlus, 
  FileUp, 
  Search,
  Trash2,
  MoreVertical
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Member } from "@/types";
import { parseMemberCSV } from "@/services/csvService";

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    fetchMembers();
  }, []);

  async function fetchMembers() {
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .order('full_name', { ascending: true });
    
    if (data) setMembers(data);
  }

  async function handleCSVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const data = await parseMemberCSV(file);
      // Map data and insert to Supabase
      const { error } = await supabase.from('members').insert(data);
      if (!error) fetchMembers();
    } catch (err) {
      console.error(err);
    } finally {
      setIsUploading(false);
    }
  }

  const filteredMembers = members.filter(m => 
    m.full_name.toLowerCase().includes(search.toLowerCase()) ||
    m.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Members</h1>
          <p className="text-muted-foreground">Manage your university theatre group roster.</p>
        </div>
        <div className="flex gap-3">
          <label className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors">
            <FileUp className="mr-2 h-4 w-4" />
            Import CSV
            <input 
              type="file" 
              className="hidden" 
              accept=".csv" 
              onChange={handleCSVUpload}
              disabled={isUploading}
            />
          </label>
          <button className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90">
            <UserPlus className="mr-2 h-4 w-4" />
            Add Member
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input 
          type="text"
          placeholder="Search members..."
          className="w-full rounded-md border border-input bg-background pl-10 pr-4 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left p-4 font-medium">Name</th>
              <th className="text-left p-4 font-medium">Department</th>
              <th className="text-left p-4 font-medium">Email</th>
              <th className="text-right p-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredMembers.map((member) => (
              <tr key={member.id} className="hover:bg-accent/50 transition-colors group">
                <td className="p-4 font-medium">{member.full_name}</td>
                <td className="p-4 text-muted-foreground">{member.department || "-"}</td>
                <td className="p-4 text-muted-foreground">{member.email || "-"}</td>
                <td className="p-4 text-right">
                  <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="p-2 hover:text-destructive transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button className="p-2 hover:text-primary transition-colors">
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredMembers.length === 0 && (
              <tr>
                <td colSpan={4} className="p-12 text-center text-muted-foreground">
                  No members found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
