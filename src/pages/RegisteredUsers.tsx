import { useEffect, useMemo, useRef, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Download, Save, Search, Undo2, Loader2, ArrowLeft, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

type Profile = {
  id: string;
  name: string | null;
  email: string | null;
  franchise_id: string | null;
  phone: string | null;
  address: string | null;
};

function normalizeFranchiseIdFlexible(input: string) {
  let raw = String(input || '').trim();
  raw = raw.replace(/^\s*FR[-_\s]?/i, '');
  const alnum = raw.replace(/[^A-Za-z0-9]/g, '');
  if (!alnum) return null;
  const isDigitsOnly = /^[0-9]+$/.test(alnum);
  const core = isDigitsOnly ? alnum.padStart(3, '0') : alnum.toUpperCase();
  const formatted = `FR-${core}`;
  const alias = isDigitsOnly ? `fr-${alnum.padStart(3, '0')}` : `fr-${alnum.toLowerCase()}`;
  return { formatted, alias, isDigitsOnly, raw: alnum };
}

function isValidPhone(p: string) {
  const digits = (p || '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export default function RegisteredUsers() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [original, setOriginal] = useState<Record<string, Profile>>({});
  const [edited, setEdited] = useState<Record<string, Partial<Profile>>>({});
  const [search, setSearch] = useState('');
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Fetch profiles
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('franchise_id', { ascending: true })
        .returns<Profile[]>();

      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      } else if (mounted) {
        setProfiles(data ?? []);
        const map: Record<string, Profile> = {};
        (data ?? []).forEach(p => { map[p.id] = { ...p }; });
        setOriginal(map);
      }
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [toast]);

  // Live changes (insert/update/delete)
  useEffect(() => {
    const channel = supabase
      .channel('profiles-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
        setProfiles(prev => {
          const copy = [...prev];
          if (payload.eventType === 'INSERT') {
            const row = payload.new as Profile;
            if (!copy.find(r => r.id === row.id)) copy.push(row);
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as Profile;
            const ix = copy.findIndex(r => r.id === row.id);
            if (ix !== -1) copy[ix] = row;
          } else if (payload.eventType === 'DELETE') {
            const row = payload.old as Profile;
            return copy.filter(r => r.id !== row.id);
          }
          copy.sort((a, b) => (a.franchise_id || '').localeCompare(b.franchise_id || ''));
          return copy;
        });
      });
    channel.subscribe();
    channelRef.current = channel;
    return () => { channel.unsubscribe(); };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(p => {
      const s = [
        p.name, p.email, p.franchise_id, p.phone, p.address, p.id
      ].map(v => (v || '').toString().toLowerCase()).join(' ');
      return s.includes(q);
    });
  }, [profiles, search]);

  function setField(id: string, field: keyof Profile, value: string) {
    setEdited(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    setProfiles(prev => prev.map(p => p.id === id ? { ...p, [field]: value } as Profile : p));
  }

  function hasChanges(id: string) {
    const e = edited[id];
    return !!e && Object.keys(e).length > 0;
  }

  function revertRow(id: string) {
    const baseline = original[id];
    if (!baseline) return;
    setProfiles(prev => prev.map(p => p.id === id ? { ...baseline } : p));
    setEdited(prev => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  }

  // Save a single row with optimistic merge of all edited fields
  async function saveRow(id: string) {
    const row = profiles.find(p => p.id === id);
    if (!row) return;

    // Validate & normalize
    const updates: Partial<Profile> = {};
    if (!row.franchise_id) {
      toast({ title: 'Validation', description: 'Franchise ID is required', variant: 'destructive' });
      return;
    }
    const norm = normalizeFranchiseIdFlexible(row.franchise_id);
    if (!norm) {
      toast({ title: 'Validation', description: 'Franchise ID must contain letters or digits', variant: 'destructive' });
      return;
    }
    updates.franchise_id = norm.formatted;

    if (row.phone && !isValidPhone(row.phone)) {
      toast({ title: 'Validation', description: 'Phone must be 7–15 digits (you can include +, spaces, -)', variant: 'destructive' });
      return;
    }

    // Trim strings
    updates.name = row.name ? row.name.trim() : null;
    updates.email = row.email ? row.email.trim() : null;
    updates.phone = row.phone ? row.phone.trim() : null;
    updates.address = row.address ? row.address.trim() : null;

    setSavingIds(prev => new Set([...prev, id]));

    // Perform update WITHOUT select to avoid 406 under RLS
    const { error: updateError } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', id);

    setSavingIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    if (updateError) {
      revertRow(id);
      const msg = /row-level security|RLS|permission/i.test(updateError.message)
        ? 'Update blocked by Row Level Security. Ensure your central admin policy allows updating any profile.'
        : (updateError.message.includes('unique') ? 'Franchise ID must be unique' : updateError.message);
      toast({ title: 'Save failed', description: msg, variant: 'destructive' });
      return;
    }

    // Optimistically merge ALL updates into the current row so UI shows your changes
    const mergedRow: Profile = { ...(row as Profile), ...(updates as Profile) };
    setProfiles(prev => prev.map(p => p.id === id ? mergedRow : p));
    setOriginal(prev => ({ ...prev, [id]: mergedRow }));
    setEdited(prev => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });

    // Try to refetch authoritative row (only if SELECT allowed)
    const { data: refreshed, error: selectError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle<Profile>();

    if (!selectError && refreshed) {
      setProfiles(prev => prev.map(p => p.id === id ? refreshed : p));
      setOriginal(prev => ({ ...prev, [id]: refreshed }));
      toast({ title: 'Saved', description: `Profile ${refreshed.franchise_id} updated` });
      return;
    }

    // If SELECT blocked, keep optimistic state and inform user
    if (selectError && /row-level security|RLS|permission/i.test(selectError.message)) {
      toast({
        title: 'Saved (limited visibility)',
        description: 'Row updated, but RLS prevents reading it back. Consider adding a SELECT policy for the central admin.',
      });
      return;
    }

    // Unexpected select error: keep optimistic but notify
    if (selectError) {
      toast({ title: 'Saved (unconfirmed read)', description: selectError.message, variant: 'destructive' });
      return;
    }

    // No error but no data — still keep optimistic state
    toast({ title: 'Saved', description: `Profile ${mergedRow.franchise_id} updated` });
  }

  async function deleteRow(id: string) {
    const row = profiles.find(p => p.id === id);
    const label = row?.franchise_id || row?.email || id;
    if (!row) return;
    const ok = window.confirm(
      `Delete profile ${label}?\n\nThis removes the row from public.profiles only. The auth user remains.\n(You can wire a server-side admin endpoint to delete from auth.users if desired.)`
    );
    if (!ok) return;

    setDeletingIds(prev => new Set([...prev, id]));
    const { error } = await supabase.from('profiles').delete().eq('id', id);
    setDeletingIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    if (error) {
      const msg = /row-level security|RLS|permission/i.test(error.message)
        ? 'Delete blocked by Row Level Security. Ensure your central admin policy allows deleting any profile.'
        : error.message;
      toast({ title: 'Delete failed', description: msg, variant: 'destructive' });
      return;
    }
    // Remove optimistically (realtime will also update)
    setProfiles(prev => prev.filter(p => p.id !== id));
    setEdited(prev => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
    setOriginal(prev => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
    toast({ title: 'Deleted', description: `Profile ${label} removed from profiles.` });
  }

  async function saveAll() {
    const ids = Object.keys(edited);
    if (!ids.length) {
      toast({ title: 'Nothing to save', description: 'No rows have changes.' });
      return;
    }
    for (const id of ids) {
      // sequential saves keep toasts readable and avoid unique races
      // eslint-disable-next-line no-await-in-loop
      await saveRow(id);
    }
  }

  function exportCSV() {
    const rows = filtered;
    const header = ['id','name','email','franchise_id','phone','address'];
    const csv = [
      header.join(','),
      ...rows.map(r => header.map(h => {
        const v = (r as any)[h] ?? '';
        const s = String(v).replace(/"/g, '""');
        return `"${s}"`;
      }).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'profiles.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function clearSearch() {
    setSearch('');
  }

  return (
    <DashboardLayout title={<span className="font-bold">Registered Users</span>}>
      {/* Back button OUTSIDE the card, top-left */}
      <div className="flex justify-start mb-2">
        <Button
          variant="outline"
          onClick={() => navigate(-1)}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>

      <Card className="border-[rgb(0,100,55)]">
        <CardHeader className="flex flex-col gap-3">
          {/* Title + actions row */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle style={{ color: 'rgb(0,100,55)' }}>Profiles</CardTitle>
              <CardDescription>Edit any cell; changes are saved to the database.</CardDescription>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="outline" onClick={exportCSV}>
                <Download className="h-4 w-4 mr-2" /> Export CSV
              </Button>
              <Button onClick={saveAll} style={{ backgroundColor: 'rgb(0,100,55)' }} className="hover:bg-[rgb(0,80,40)]">
                <Save className="h-4 w-4 mr-2" /> Save All
              </Button>
            </div>
          </div>

          {/* Search bar BELOW the heading/description */}
          <div className="relative w-full max-w-xl">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 opacity-60" />
            <Input
              className="pl-8"
              placeholder="Search: franchise id, name, email, phone, address…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 opacity-70 hover:opacity-100"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </CardHeader>

        <CardContent className="overflow-auto">
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading profiles…
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-3">Franchise ID</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Phone</th>
                  <th className="py-2 pr-3">Address</th>
                  {/* Wider actions column to avoid wrapping */}
                  <th className="py-2 pr-3 w-[360px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No profiles match your search.</td></tr>
                )}
                {filtered.map(row => {
                  const dirty = hasChanges(row.id);
                  const saving = savingIds.has(row.id);
                  const deleting = deletingIds.has(row.id);
                  return (
                    <tr key={row.id} className="border-b last:border-0">
                      {/* Franchise ID */}
                      <td className="py-2 pr-3 min-w-[160px]">
                        <Input
                          value={row.franchise_id || ''}
                          onChange={(e) => setField(row.id, 'franchise_id', e.target.value)}
                          className="h-9"
                        />
                      </td>
                      {/* Name */}
                      <td className="py-2 pr-3 min-w-[160px]">
                        <Input
                          value={row.name || ''}
                          onChange={(e) => setField(row.id, 'name', e.target.value)}
                          className="h-9"
                        />
                      </td>
                      {/* Email */}
                      <td className="py-2 pr-3 min-w-[200px]">
                        <Input
                          type="email"
                          value={row.email || ''}
                          onChange={(e) => setField(row.id, 'email', e.target.value)}
                          className="h-9"
                        />
                      </td>
                      {/* Phone */}
                      <td className="py-2 pr-3 min-w-[160px]">
                        <Input
                          value={row.phone || ''}
                          onChange={(e) => setField(row.id, 'phone', e.target.value)}
                          className="h-9"
                          placeholder="+91 98765 43210"
                        />
                      </td>
                      {/* Address */}
                      <td className="py-2 pr-3 min-w-[220px]">
                        <Input
                          value={row.address || ''}
                          onChange={(e) => setField(row.id, 'address', e.target.value)}
                          className="h-9"
                          placeholder="Building, Street, City, PIN"
                        />
                      </td>

                      <td className="py-2 pr-3">
                        {/* Single line of actions */}
                        <div className="flex items-center gap-2 whitespace-nowrap flex-nowrap">
                          <Button
                            size="sm"
                            disabled={!dirty || saving || deleting}
                            onClick={() => saveRow(row.id)}
                            style={{ backgroundColor: 'rgb(0,100,55)' }}
                            className="hover:bg-[rgb(0,80,40)]"
                          >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!dirty || saving || deleting}
                            onClick={() => revertRow(row.id)}
                          >
                            <Undo2 className="h-4 w-4 mr-2" />
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={saving || deleting}
                            onClick={() => deleteRow(row.id)}
                            className="text-red-600 border-red-600 hover:bg-red-50"
                          >
                            {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                            Delete
                          </Button>
                        </div>
                        {dirty && <div className="text-xs text-amber-600 mt-1">Unsaved changes</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span>Tip: Franchise IDs auto-normalize to <code>FR-XXX</code> on save. Unique constraint is enforced.</span>
          <span>Deleting here removes the row from <code>public.profiles</code> only. The corresponding <code>auth.users</code> account is not deleted.</span>
        </CardFooter>
      </Card>
    </DashboardLayout>
  );
}
