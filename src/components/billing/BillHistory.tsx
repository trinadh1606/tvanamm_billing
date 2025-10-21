import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Download,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search
} from 'lucide-react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

interface Bill {
  id: number | string;
  franchise_id: string;
  mode_payment: string | null;
  created_at: string;
  total: number;
  created_by: string;
}

interface BillHistoryProps {
  showAdvanced?: boolean;
  isCentral?: boolean; // parent can force "central view"
}

type SortField = 'created_at' | 'total' | 'franchise_id' | 'id' | 'mode_payment';
type SortDirection = 'asc' | 'desc';

type ShiftState = {
  day: string;      // YYYY-MM-DD (local) when checkout was pressed
  startISO: string; // ISO timestamp when checkout was pressed
};

export function BillHistory({ showAdvanced = false, isCentral = false }: BillHistoryProps) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [filteredBills, setFilteredBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);

  const [grossTotals, setGrossTotals] = useState<Record<string, number>>({});
  const [franchiseList, setFranchiseList] = useState<string[]>([]);
  const [selectedFranchise, setSelectedFranchise] = useState<string>('ALL');
  const [franchiseSearch, setFranchiseSearch] = useState<string>('');

  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);
  const [selectedBillId, setSelectedBillId] = useState<number | string | null>(null);
  const [billItems, setBillItems] = useState<any[]>([]);
  const [itemLoading, setItemLoading] = useState(false);

  // --- Checkout-for-today (per-franchise, no undo same day) ---
  const [shiftStart, setShiftStart] = useState<Date | null>(null);
  const [shiftActive, setShiftActive] = useState<boolean>(false);

  const { franchiseId, role } = useAuth();
  const { toast } = useToast();

  // Role flags
  const isAdmin = (role ?? '').toLowerCase().includes('admin');

  // Central view if parent says so OR the admin is at FR-CENTRAL
  const isCentralView = isCentral || (isAdmin && (franchiseId ?? '').toUpperCase() === 'FR-CENTRAL');

  // Store login = not admin and not central
  const isStoreLogin = !isAdmin && !isCentralView;

  // UI capabilities
  const canSelectFranchise = isCentralView;     // only central gets the franchise dropdown
  const canPickDate = isAdmin || isCentralView; // admin (any) and central get date pickers

  const todayStrLocal = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  // Which franchise to view in the table
  const viewFranchiseId: string | null =
    isCentralView
      ? (selectedFranchise !== 'ALL' ? selectedFranchise : null)
      : (franchiseId ?? null);

  // Franchise used for checkout (same as view)
  const activeFranchiseId: string | null =
    isCentralView ? (selectedFranchise !== 'ALL' ? selectedFranchise : null) : (franchiseId ?? null);

  // Helper: should we enforce franchise filter in nested/item queries?
  const enforceFranchiseFilter = !isCentralView || (isCentralView && selectedFranchise !== 'ALL');

  const shiftKey = (fid: string) => `bill_date_shift_state:${fid}`;

  const loadShiftForFranchise = (fid: string | null) => {
    setShiftStart(null);
    setShiftActive(false);
    if (!fid) return;

    const raw = localStorage.getItem(shiftKey(fid));
    if (!raw) return;

    try {
      const parsed: ShiftState = JSON.parse(raw);
      if (parsed?.day === todayStrLocal() && parsed?.startISO) {
        const d = new Date(parsed.startISO);
        if (!Number.isNaN(d.getTime())) {
          setShiftStart(d);
          setShiftActive(true);
        }
      } else {
        localStorage.removeItem(shiftKey(fid));
      }
    } catch {
      localStorage.removeItem(shiftKey(fid));
    }
  };

  useEffect(() => {
    loadShiftForFranchise(activeFranchiseId);
  }, [activeFranchiseId]);

  // ✅ Start with today's window for everyone
  useEffect(() => {
    const t = new Date();
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    setFromDate(today);
    setToDate(today);
  }, []);

  // Snap STORE users to today/tomorrow depending on checkout state
  useEffect(() => {
    if (isStoreLogin) {
      const t = new Date();
      const base = new Date(t.getFullYear(), t.getMonth(), t.getDate());
      if (shiftActive && shiftStart) {
        const next = new Date(base);
        next.setDate(next.getDate() + 1);
        setFromDate(next);
        setToDate(next);
      } else {
        setFromDate(base);
        setToDate(base);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftActive, shiftStart, isStoreLogin]);

  // Load central franchise list (separate effect so we don’t double-fetch bills)
  useEffect(() => {
    const run = async () => {
      if (!isCentralView) return;
      try {
        await fetchAllFranchises();
      } catch (e) {
        /* toast inside fetchAllFranchises */
      }
    };
    run();
  }, [isCentralView]);

  // ---- Single source of truth for fetching bills ----
  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!fromDate || !toDate) return;
      setLoading(true);
      try {
        await fetchBills(viewFranchiseId ?? undefined, fromDate, toDate);
      } finally {
        if (alive) setLoading(false);
      }
    };
    run();
    return () => { alive = false; };
    // fetch when the viewing scope or dates change
  }, [viewFranchiseId, fromDate, toDate, isCentralView]);

  // Recompute gross totals when bill list changes
  useEffect(() => {
    let alive = true;
    (async () => {
      if (bills.length) {
        await computeGrossTotals(bills);
      } else {
        if (alive) setGrossTotals({});
      }
    })();
    return () => { alive = false; };
  }, [bills, selectedFranchise, isCentralView]);

  useEffect(() => {
    applyFiltersAndSort();
  }, [bills, selectedFranchise, fromDate, toDate, sortField, sortDirection, shiftActive, shiftStart]);

  const startOfDayISO = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.toISOString(); // works with timestamptz columns
  };
  const endOfDayISO = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x.toISOString();
  };

  // ---------- Collect ALL franchises (central only) ----------
  const fetchAllFranchises = async () => {
    try {
      let list: string[] = [];

      const rpcAll = await supabase.rpc('get_all_franchises');
      if (!rpcAll.error && Array.isArray(rpcAll.data) && rpcAll.data.length > 0) {
        list = (rpcAll.data as any[]).map((r) =>
          typeof r === 'string' ? r : (r.id ?? r.franchise_id ?? r.code)
        );
      } else {
        const tryFrTable = await supabase.from('franchises').select('id');
        if (!tryFrTable.error && Array.isArray(tryFrTable.data) && tryFrTable.data.length > 0) {
          list = list.concat((tryFrTable.data as { id: string }[]).map((r) => r.id));
        }
        const fromMenu = await distinctFranchisesFromMenuItems();
        list = list.concat(fromMenu);
        const fromBills = await fallbackDistinctFranchisesFromBills();
        list = list.concat(fromBills);
      }

      list.push('FR-CENTRAL');

      list = Array.from(new Set(list)).filter(Boolean).sort((a, b) => a.localeCompare(b));
      setFranchiseList(list);

      if (list.length === 0) {
        toast({
          title: 'No franchises found',
          description: 'Could not discover franchise IDs from any source.',
          variant: 'destructive',
        });
      }

      if (selectedFranchise !== 'ALL' && !list.includes(selectedFranchise)) {
        setSelectedFranchise('ALL');
      }
    } catch (error) {
      console.error('Error fetching all franchises:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch franchise list',
        variant: 'destructive',
      });
    }
  };

  const distinctFranchisesFromMenuItems = async (): Promise<string[]> => {
    const pageSize = 1000;
    let from = 0;
    const ids = new Set<string>();
    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from('menu_items')
        .select('franchise_id')
        .order('id', { ascending: true })
        .range(from, to);
      if (error) break;
      if (!data || data.length === 0) break;
      for (const row of data as { franchise_id: string | null }[]) {
        if (row.franchise_id) ids.add(row.franchise_id);
      }
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return Array.from(ids);
  };

  const fallbackDistinctFranchisesFromBills = async (): Promise<string[]> => {
    const pageSize = 1000;
    let from = 0;
    const ids = new Set<string>();

    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from('bills_generated_billing')
        .select('franchise_id')
        .order('id', { ascending: true })
        .range(from, to);

      if (error) break;
      if (!data || data.length === 0) break;

      for (const row of data as { franchise_id: string | null }[]) {
        if (row.franchise_id) ids.add(row.franchise_id);
      }

      if (data.length < pageSize) break;
      from += pageSize;
    }

    return Array.from(ids);
  };

  // 🔁 Fetch ALL bills (no hard limit) via pagination
  const fetchBills = async (targetFranchise?: string, from?: Date, to?: Date) => {
    if (from && to && from.getTime() > to.getTime()) {
      toast({
        title: 'Invalid date range',
        description: '“From” date must be earlier than or equal to “To” date.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const pageSize = 1000;
      const hasRange = !!(from && to);
      let allRows: Bill[] = [];
      let fromIdx = 0;

      // ➕ SHIFT-AWARE RANGE: widen the fetch by 1 day before "from" when checkout is active
      const widenForShift = (d: Date) => {
        const x = new Date(d);
        x.setDate(x.getDate() - 1);
        return x;
      };
      const effectiveFrom = (shiftActive && shiftStart && from) ? widenForShift(from) : from;

      const baseQuery = () => {
        let q = supabase.from('bills_generated_billing').select('*');

        if (isCentralView) {
          if (targetFranchise && targetFranchise !== 'ALL') {
            q = q.eq('franchise_id', targetFranchise);
          }
        } else if (franchiseId) {
          q = q.eq('franchise_id', franchiseId);
        }

        if (hasRange && effectiveFrom && to) {
          q = q
            .gte('created_at', startOfDayISO(effectiveFrom))
            .lte('created_at', endOfDayISO(to));
        }

        return q.order('created_at', { ascending: false });
      };

      setBills([]); // avoid showing stale list while paging
      while (true) {
        const toIdx = fromIdx + pageSize - 1;
        const { data, error } = await baseQuery().range(fromIdx, toIdx);
        if (error) throw error;
        const page = (data as Bill[]) ?? [];
        allRows.push(...page);
        if (page.length < pageSize) break;
        fromIdx += pageSize;
      }

      setBills(allRows);
    } catch (error) {
      console.error(error);
      toast({
        title: 'Error',
        description: 'Failed to fetch bills',
        variant: 'destructive',
      });
    }
  };

  // Batch compute gross (pre-discount) totals
  const computeGrossTotals = async (rows: Bill[]) => {
    const ids = rows.map(b => b.id);
    if (ids.length === 0) {
      setGrossTotals({});
      return;
    }

    const chunk = <T,>(arr: T[], size = 500): T[][] => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    const map: Record<string, number> = {};
    ids.forEach(id => { map[String(id)] = 0; });

    for (const batch of chunk(ids, 500)) {
      const batchNum = (batch as (number | string)[])
        .map(v => (typeof v === 'string' && /^\d+$/.test(v)) ? Number(v) : (typeof v === 'number' ? v : NaN))
        .filter((v): v is number => Number.isFinite(v));

      try {
        let q = supabase
          .from('bills_generated_billing')
          .select('id, franchise_id, bill_items_generated_billing ( qty, price )');

        q = batchNum.length > 0
          ? q.in('id', batchNum as number[])
          : q.in('id', batch as any);

        if (enforceFranchiseFilter && viewFranchiseId) {
          q = q.eq('franchise_id', viewFranchiseId);
        }

        const { data, error } = await q;
        if (!error && Array.isArray(data) && data.length > 0) {
          for (const row of data as any[]) {
            const key = String(row.id);
            const items = (row.bill_items_generated_billing ?? []) as Array<{ qty: any; price: any }>;
            const sum = items.reduce((acc, it) => acc + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
            map[key] += sum;
          }
          continue;
        }
      } catch {
        // fallback below
      }

      try {
        let q2 = supabase
          .from('bill_items_generated_billing')
          .select('bill_id, qty, price, bills_generated_billing!inner(franchise_id)');

        q2 = batchNum.length > 0
          ? q2.in('bill_id', batchNum as number[])
          : q2.in('bill_id', batch as any);

        if (enforceFranchiseFilter && viewFranchiseId) {
          q2 = q2.eq('bills_generated_billing.franchise_id', viewFranchiseId);
        }

        let { data: itemsData, error: itemsErr } = await q2;

        if (itemsErr || !itemsData || itemsData.length === 0) {
          const alt = batchNum.length > 0
            ? await supabase.from('bill_items_generated_billing').select('bill_id, qty, price').in('bill_id', batchNum as number[])
            : await supabase.from('bill_items_generated_billing').select('bill_id, qty, price').in('bill_id', batch as any);

          itemsData = alt.error ? [] : (alt.data || []);
        }

        for (const r of (itemsData || []) as any[]) {
          const key = String(r.bill_id);
          const qty = Number(r.qty) || 0;
          const price = Number(r.price) || 0;
          map[key] += qty * price;
        }
      } catch {
        // ignore
      }
    }

    setGrossTotals(map);
  };

  const fetchBillItems = async (billId: number | string) => {
    setItemLoading(true);
    setSelectedBillId(billId);
    try {
      let q = supabase
        .from('bill_items_generated_billing')
        .select('*, bills_generated_billing!inner(franchise_id)');

      const billIdNum =
        typeof billId === 'string' && /^\d+$/.test(billId) ? Number(billId) :
        typeof billId === 'number' ? billId : billId;

      q = typeof billIdNum === 'number'
        ? q.eq('bill_id', billIdNum as number)
        : q.eq('bill_id', billId as any);

      if (enforceFranchiseFilter && viewFranchiseId) {
        q = q.eq('bills_generated_billing.franchise_id', viewFranchiseId);
      }

      let { data, error } = await q;

      if (error || !data || data.length === 0) {
        const alt = await supabase
          .from('bill_items_generated_billing')
          .select('*')
          .eq('bill_id', billIdNum as any);
        if (!alt.error) {
          data = alt.data || [];
        } else {
          throw alt.error;
        }
      }

      setBillItems(data || []);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to fetch bill items',
        variant: 'destructive',
      });
    } finally {
      setItemLoading(false);
    }
  };

  // 🔁 Shift display applies to everyone on this device (admin & central too)
  const getDisplayDate = (iso: string) => {
    const original = new Date(iso);
    if (shiftActive && shiftStart && original >= shiftStart) {
      const shifted = new Date(original);
      shifted.setDate(shifted.getDate() + 1);
      return shifted;
    }
    return original;
  };

  const applyFiltersAndSort = () => {
    let filtered = [...bills];

    if (selectedFranchise !== 'ALL') {
      filtered = filtered.filter((bill) => bill.franchise_id === selectedFranchise);
    }

    if (fromDate) {
      const fromStart = new Date(fromDate);
      fromStart.setHours(0, 0, 0, 0);
      filtered = filtered.filter((bill) => getDisplayDate(bill.created_at) >= fromStart);
    }
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter((bill) => getDisplayDate(bill.created_at) <= end);
    }

    filtered.sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

      if (sortField === 'mode_payment') {
        aVal = (aVal ?? '').toLowerCase();
        bVal = (bVal ?? '').toLowerCase();
      } else if (sortField === 'total') {
        aVal = Number(aVal);
        bVal = Number(bVal);
      } else if (sortField === 'created_at') {
        aVal = getDisplayDate(a.created_at).getTime();
        bVal = getDisplayDate(b.created_at).getTime();
      } else if (sortField === 'id') {
        aVal = Number(aVal);
        bVal = Number(bVal);
      }

      if (aVal === bVal) return 0;
      return sortDirection === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
    });

    setFilteredBills(filtered);
    setCurrentPage(1);
  };

  const exportToExcel = () => {
    if (isCentralView && selectedFranchise === 'ALL') {
      toast({
        title: 'Select a franchise',
        description: 'Please choose a franchise from the dropdown to export its bills only.',
        variant: 'destructive',
      });
      return;
    }

    const exportSource =
      isCentralView && selectedFranchise !== 'ALL'
        ? filteredBills.filter((b) => b.franchise_id === selectedFranchise)
        : filteredBills;

    if (exportSource.length === 0) {
      toast({
        title: 'Nothing to export',
        description: 'No bills match your current filters.',
      });
      return;
    }

    const exportData = exportSource.map((bill) => {
      const d = getDisplayDate(bill.created_at);
      const actual = (grossTotals[String(bill.id)] ?? bill.total);
      return {
        'Bill ID': bill.id,
        'Franchise ID': bill.franchise_id,
        'Payment Mode': (bill.mode_payment ?? '').toUpperCase(),
        'Actual Amount (₹)': Number(actual).toFixed(2),
        'After Discount (₹)': Number(bill.total).toFixed(2),
        'Displayed Date': d.toLocaleDateString(),
        'Displayed Time': d.toLocaleTimeString(),
        'Created By': bill.created_by,
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Bills History');

    let filename = 'bills-history';
    if (isCentralView && selectedFranchise !== 'ALL') filename += `-${selectedFranchise}`;
    if (!isCentralView && franchiseId) filename += `-${franchiseId}`;
    if (fromDate && toDate) {
      filename += `-${format(fromDate, 'yyyy-MM-dd')}_to_${format(toDate, 'yyyy-MM-dd')}`;
    }
    filename += `.xlsx`;

    XLSX.writeFile(workbook, filename);

    toast({
      title: 'Export Successful',
      description: `${exportSource.length} bills exported to Excel`,
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const totalPages = Math.ceil(filteredBills.length / itemsPerPage);
  const currentBills = filteredBills.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const getPaymentBadgeVariant = (mode: string | null) => {
    switch ((mode ?? '').toLowerCase()) {
      case 'cash': return 'default';
      case 'card': return 'secondary';
      case 'upi': return 'outline';
      default: return 'outline';
    }
  };

  // +1 column for "Franchise" when central can see it
  const gridCols = isCentralView ? 'grid grid-cols-1 sm:grid-cols-7' : 'grid grid-cols-1 sm:grid-cols-6';

  const activateShift = () => {
    if (!activeFranchiseId) {
      toast({
        title: 'Select a franchise',
        description: 'Please choose a specific franchise (not "ALL") to activate signout.',
        variant: 'destructive',
      });
    }
    if (!activeFranchiseId || shiftActive) return;

    const now = new Date();
    const state: ShiftState = { day: todayStrLocal(), startISO: now.toISOString() };
    localStorage.setItem(shiftKey(activeFranchiseId), JSON.stringify(state));
    setShiftStart(now);
    setShiftActive(true);

    // Only store users auto-switch to tomorrow after checkout
    if (isStoreLogin) {
      const t = new Date();
      const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate());
      tomorrow.setDate(tomorrow.getDate() + 1);
      setFromDate(tomorrow);
      setToDate(tomorrow);
    }

    toast({
      title: 'Signout for today active',
      description: `New bills for ${activeFranchiseId} from now will be shown under tomorrow's date (today only).`,
    });
    applyFiltersAndSort();
  };

  const emptyMessage = () => {
    if (selectedFranchise !== 'ALL') {
      if (fromDate || toDate) {
        return `No bills for franchise ${selectedFranchise} for the selected date range.`;
      }
      return `No bills for franchise ${selectedFranchise}.`;
    }
    return 'No bills found';
  };

  // Dropdown options (central only)
  const filteredFranchiseOptions = (() => {
    const base = franchiseList.filter(fid => fid && fid !== 'ALL');
    const q = franchiseSearch.trim().toLowerCase();
    let opts = base.filter(fid => !q || fid.toLowerCase().includes(q));
    if (selectedFranchise && selectedFranchise !== 'ALL' && !opts.includes(selectedFranchise)) {
      opts = [selectedFranchise, ...opts];
    }
    return opts;
  })();

  const handleFranchiseSearchGo = () => {
    const term = franchiseSearch.trim();
    if (!term) return;

    const exact = franchiseList.find(f => f.toLowerCase() === term.toLowerCase());
    if (exact) {
      setSelectedFranchise(exact);
      setCurrentPage(1);
      return;
    }

    const matches = franchiseList.filter(f => f.toLowerCase().includes(term.toLowerCase()));
    if (matches.length === 1) {
      setSelectedFranchise(matches[0]);
      setCurrentPage(1);
    } else if (matches.length > 1) {
      toast({
        title: 'Multiple matches found',
        description: 'Refine your search or pick from the dropdown.',
      });
    } else {
      toast({
        title: 'No franchise found',
        description: 'Try a different ID.',
        variant: 'destructive',
      });
    }
  };

  // Date inputs (ADMIN + CENTRAL)
  const dateToInput = (d?: Date) => (d ? format(d, 'yyyy-MM-dd') : '');
  const inputToDate = (v: string) => (v ? new Date(`${v}T00:00:00`) : undefined);
  const handleDateChange = (type: 'from' | 'to', value: string) => {
    const newDate = inputToDate(value);
    if (type === 'from') setFromDate(newDate);
    else setToDate(newDate);
    // No manual fetch here; the fetch effect will run once with the new dates
  };

  const clearDates = async () => {
    const t = new Date();
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());

    if (isStoreLogin) {
      const base = new Date(today);
      if (shiftActive && shiftStart) base.setDate(base.getDate() + 1);
      setFromDate(base);
      setToDate(base);
      return;
    }

    setFromDate(today);
    setToDate(today);
  };

  return (
    <Card className="bg-white">
      <CardHeader className="border-b">
        {/* Banner */}
        <div className="text-xs text-gray-600 mb-2">
          {canPickDate ? (
            <>Showing <b>today&apos;s bills</b>. Pick a date (or range) to view previous days.</>
          ) : (
            <>Showing <b>{(shiftActive && shiftStart) ? "tomorrow’s" : "today’s"}</b> bills (auto-switches after you check out).</>
          )}
        </div>

        {(canSelectFranchise || canPickDate) ? (
          // Admin/Central header
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              {/* Left side: Franchise (central only) + Date range (admin + central) */}
              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                {/* Franchise selector (CENTRAL ONLY) */}
                {canSelectFranchise && (
                  <div className="w-80">
                    <div className="text-xs mb-1" style={{ color: 'rgb(0, 100, 55)' }}>
                      Franchise (A→Z)
                    </div>
                    <Select
                      value={selectedFranchise}
                      onValueChange={(val) => {
                        setSelectedFranchise(val);
                        setCurrentPage(1);
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select franchise" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">ALL</SelectItem>
                        {filteredFranchiseOptions.map((fid) => (
                          <SelectItem key={fid} value={fid}>
                            {fid}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Date range (ADMIN + CENTRAL) */}
                {canPickDate && (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="w-44">
                      <div className="text-xs mb-1" style={{ color: 'rgb(0, 100, 55)' }}>
                        From
                      </div>
                      <Input
                        type="date"
                        value={dateToInput(fromDate)}
                        onChange={(e) => handleDateChange('from', e.target.value)}
                      />
                    </div>
                    <div className="w-44">
                      <div className="text-xs mb-1" style={{ color: 'rgb(0, 100, 55)' }}>
                        To
                      </div>
                      <Input
                        type="date"
                        value={dateToInput(toDate)}
                        onChange={(e) => handleDateChange('to', e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2">
                      {(fromDate || toDate) && (
                        <Button
                          variant="ghost"
                          onClick={clearDates}
                          className="mt-1 sm:mt-0"
                          style={{ color: 'rgb(0, 100, 55)' }}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Right side: Quick franchise search (CENTRAL ONLY) */}
              {canSelectFranchise && (
                <div className="w-full sm:w-[28rem]">
                  <div className="text-xs mb-1" style={{ color: 'rgb(0, 100, 55)' }}>
                    Quick Search (Franchise ID)
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        value={franchiseSearch}
                        onChange={(e) => setFranchiseSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleFranchiseSearchGo();
                        }}
                        placeholder="Type franchise id (e.g., FR-001) and press Enter"
                        className="pl-8"
                      />
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleFranchiseSearchGo}
                      style={{ borderColor: 'rgb(0, 100, 55)', color: 'rgb(0, 100, 55)' }}
                    >
                      Go
                    </Button>
                    {franchiseSearch && (
                      <Button
                        variant="ghost"
                        onClick={() => setFranchiseSearch('')}
                        style={{ color: 'rgb(0, 100, 55)' }}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  <div className="text-xs mt-1 text-gray-500">
                    Showing {filteredFranchiseOptions.length} of {franchiseList.length} franchises
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          // STORE view: Checkout + franchise badge (NO date pickers, NO dropdown)
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="text-[13px] text-gray-600 leading-snug">
                <span className="font-medium" style={{ color: 'rgb(0, 100, 55)' }}>
                  Disclaimer:
                </span>{' '}
                When you click <em>Check out for today</em>, bills created from that moment will be
                shown under the <strong>next date</strong> (today only). This can be used once per day and
                resets automatically tomorrow.
              </div>
              <Button
                onClick={activateShift}
                disabled={shiftActive || !activeFranchiseId}
                className="shrink-0"
                style={{
                  backgroundColor: shiftActive ? 'rgba(0, 100, 55, 0.2)' : 'rgb(0, 100, 55)',
                  color: shiftActive ? 'rgb(0, 100, 55)' : 'white',
                }}
              >
                {shiftActive ? 'Checked out for today' : 'Check out for today'}
              </Button>
            </div>
            <div className="text-xs text-gray-500">
              {(() => {
                if (!activeFranchiseId) return '';
                if (!shiftActive || !shiftStart) return 'You can check out once per day.';
                return `Checked out today at ${shiftStart.toLocaleTimeString()}. Resets automatically tomorrow.`;
              })()}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Franchise:</span>
              <Badge
                variant="outline"
                className="w-fit"
                style={{ backgroundColor: 'rgba(0, 100, 55, 0.1)', borderColor: 'rgb(0, 100, 55)' }}
              >
                {franchiseId}
              </Badge>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="bg-white">
        {loading ? (
          <div className="text-center py-8">Loading bills...</div>
        ) : filteredBills.length === 0 ? (
          <div className="text-center py-10 text-gray-700">
            {emptyMessage()}
          </div>
        ) : (
          <div className="space-y-4">
            {/* HEADER ROW */}
            <div className="overflow-x-auto w-full">
              <div
                className={`${gridCols} gap-4 p-4 bg-gray-50 rounded-lg font-medium min-w-[700px]`}
              >
                <Button
                  variant="ghost"
                  onClick={() => handleSort('id')}
                  className="justify-start h-auto p-0"
                  style={{ color: 'rgb(0, 100, 55)' }}
                >
                  Bill ID <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
                {isCentralView && (
                  <Button
                    variant="ghost"
                    onClick={() => handleSort('franchise_id')}
                    className="justify-start h-auto p-0"
                    style={{ color: 'rgb(0, 100, 55)' }}
                  >
                    Franchise <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => handleSort('mode_payment')}
                  className="justify-start h-auto p-0"
                  style={{ color: 'rgb(0, 100, 55)' }}
                >
                  Payment Mode <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>

                <div className="justify-start h-auto p-0 text-left" style={{ color: 'rgb(0, 100, 55)' }}>
                  Actual Amount
                </div>

                <Button
                  variant="ghost"
                  onClick={() => handleSort('total')}
                  className="justify-start h-auto p-0"
                  style={{ color: 'rgb(0, 100, 55)' }}
                >
                  After Discount <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>

                <Button
                  variant="ghost"
                  onClick={() => handleSort('created_at')}
                  className="justify-start h-auto p-0 sm:col-span-2"
                  style={{ color: 'rgb(0, 100, 55)' }}
                >
                  Date <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              </div>
            </div>

            {/* ROWS */}
            <div className="overflow-x-auto w-full">
              <div className="space-y-2 min-w-[700px]">
                {currentBills.map((bill) => {
                  const displayDate = getDisplayDate(bill.created_at);
                  const actual = grossTotals[String(bill.id)];
                  return (
                    <div
                      key={String(bill.id)}
                      className={`${gridCols} gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors text-sm sm:text-base`}
                    >
                      <div className="break-words min-w-0">
                        <Button
                          variant="link"
                          className="p-0 text-left font-medium underline"
                          style={{ color: 'rgb(0, 100, 55)' }}
                          onClick={() => fetchBillItems(bill.id)}
                        >
                          #{String(bill.id)}
                        </Button>
                      </div>

                      {isCentralView && (
                        <div className="break-words min-w-0">
                          <Badge
                            variant="outline"
                            className="w-fit"
                            style={{
                              backgroundColor: 'rgba(0, 100, 55, 0.1)',
                              borderColor: 'rgb(0, 100, 55)'
                            }}
                          >
                            {bill.franchise_id}
                          </Badge>
                        </div>
                      )}

                      <div className="break-words min-w-0">
                        <Badge
                          variant={getPaymentBadgeVariant(bill.mode_payment)}
                          style={{
                            backgroundColor:
                              (bill.mode_payment ?? '').toLowerCase() === 'cash'
                                ? 'rgb(0, 100, 55)'
                                : undefined,
                            color:
                              (bill.mode_payment ?? '').toLowerCase() === 'cash'
                                ? 'white'
                                : 'rgb(0, 100, 55)'
                          }}
                        >
                          {(bill.mode_payment ?? '').toUpperCase()}
                        </Badge>
                      </div>

                      <div className="font-medium break-words min-w-0" style={{ color: 'rgb(0, 100, 55)' }}>
                        ₹{Number(actual ?? 0).toFixed(2)}
                      </div>

                      <div className="font-bold break-words min-w-0" style={{ color: 'rgb(0, 100, 55)' }}>
                        ₹{Number(bill.total).toFixed(2)}
                      </div>

                      <div className="text-sm text-gray-600 sm:col-span-2 break-words min-w-0">
                        {displayDate.toLocaleDateString()}
                        <br />
                        <span className="text-xs">{displayDate.toLocaleTimeString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* pagination + export */}
            <div className="flex items-center justify-between pt-4">
              <div className="text-sm text-gray-600">
                Showing {(currentPage - 1) * itemsPerPage + 1} -{' '}
                {Math.min(currentPage * itemsPerPage, filteredBills.length)} of{' '}
                {filteredBills.length}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  style={{ borderColor: 'rgb(0, 100, 55)', color: 'rgb(0, 100, 55)' }}
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <span className="text-sm" style={{ color: 'rgb(0, 100, 55)' }}>
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  style={{ borderColor: 'rgb(0, 100, 55)', color: 'rgb(0, 100, 55)' }}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <Button onClick={exportToExcel} style={{ backgroundColor: 'rgb(0, 100, 55)' }}>
                <Download className="h-4 w-4 mr-2" /> Export to Excel
              </Button>
            </div>
          </div>
        )}

        {/* Items modal */}
        {selectedBillId !== null && (
          <div
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bill-items-title"
            aria-describedby="bill-items-desc"
          >
            <div className="bg-white p-6 rounded-lg max-w-lg w-full shadow-lg relative">
              <h2
                className="text-xl font-bold mb-2"
                style={{ color: 'rgb(0, 100, 55)' }}
                id="bill-items-title"
              >
                Items for Bill #{String(selectedBillId)}
              </h2>
              <p id="bill-items-desc" className="sr-only">
                Detailed list of items for the selected bill.
              </p>
              <Button
                className="absolute top-2 right-2"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelectedBillId(null);
                  setBillItems([]);
                }}
                style={{ color: 'rgb(0, 100, 55)' }}
                aria-label="Close items modal"
              >
                Close
              </Button>

              {itemLoading ? (
                <p>Loading items...</p>
              ) : billItems.length === 0 ? (
                <p className="text-gray-600">No items found for this bill.</p>
              ) : (
                <>
                  <ul className="space-y-2 mt-4 max-h-64 overflow-y-auto">
                    {billItems.map((item, index) => (
                      <li key={index} className="border p-2 rounded">
                        <div className="font-medium" style={{ color: 'rgb(0, 100, 55)' }}>
                          {item.item_name}
                        </div>
                        <div className="text-sm text-gray-600">
                          Quantity: {item.qty} | Rate: ₹{item.price} | Total: ₹
                          {(Number(item.qty) * Number(item.price)).toFixed(2)}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div
                    className="mt-4 border-t pt-2 font-semibold text-right"
                    style={{ color: 'rgb(0, 100, 55)' }}
                  >
                    Total Bill Amount: ₹
                    {billItems
                      .reduce((acc, item) => acc + Number(item.qty) * Number(item.price), 0)
                      .toFixed(2)}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
