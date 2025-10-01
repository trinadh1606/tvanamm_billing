import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Calendar, Download, ArrowUpDown, ChevronLeft, ChevronRight, LogOut, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';

// NEW: shadcn select (for aligned, “crazy” styled dropdown)
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

interface Bill {
  id: number;
  franchise_id: string;
  mode_payment: string | null;
  created_at: string;
  total: number;
  created_by: string;
}

interface BillHistoryProps {
  showAdvanced?: boolean;
  isCentral?: boolean;
}

type SortField = 'created_at' | 'total' | 'franchise_id' | 'id' | 'mode_payment';
type SortDirection = 'asc' | 'desc';

type ShiftState = {
  day: string;      // YYYY-MM-DD of activation (local)
  startISO: string; // ISO timestamp when shift started
};

export function BillHistory({ showAdvanced = false, isCentral = false }: BillHistoryProps) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [filteredBills, setFilteredBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);

  // 🔁 Now this list is “ALL franchises”, not just those with bills
  const [franchiseList, setFranchiseList] = useState<string[]>([]);
  const [selectedFranchise, setSelectedFranchise] = useState<string>('ALL');

  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);
  const [selectedBillId, setSelectedBillId] = useState<number | null>(null);
  const [billItems, setBillItems] = useState<any[]>([]);
  const [itemLoading, setItemLoading] = useState(false);

  // --- Signout-for-today (per-franchise, no undo same day) ---
  const [shiftStart, setShiftStart] = useState<Date | null>(null);
  const [shiftActive, setShiftActive] = useState<boolean>(false);
  const shiftDays = 1;

  const { franchiseId, role } = useAuth();
  const { toast } = useToast();

  const todayStrLocal = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const activeFranchiseId: string | null = isCentral
    ? (selectedFranchise !== 'ALL' ? selectedFranchise : null)
    : (franchiseId ?? null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFranchiseId]);

  useEffect(() => {
    fetchBills();
    if (isCentral) fetchAllFranchises(); // ⬅️ replaced fetchFranchiseList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [franchiseId, role]);

  useEffect(() => {
    applyFiltersAndSort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, selectedFranchise, fromDate, toDate, sortField, sortDirection, shiftActive, shiftStart]);

  const toInputValue = (d?: Date) =>
    d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '';

  const startOfDayISO = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.toISOString();
  };
  const endOfDayISO = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x.toISOString();
  };

  // ---------- Collect ALL franchises (multiple sources, widest net) ----------
  const fetchAllFranchises = async () => {
    try {
      let list: string[] = [];

      // 1) Preferred RPC if you have a central catalog
      const rpcAll = await supabase.rpc('get_all_franchises');
      if (!rpcAll.error && Array.isArray(rpcAll.data) && rpcAll.data.length > 0) {
        list = (rpcAll.data as any[]).map((r) => typeof r === 'string' ? r : (r.id ?? r.franchise_id ?? r.code));
      } else {
        // 2) Try a dedicated 'franchises' table if present
        const tryFrTable = await supabase.from('franchises').select('id');
        if (!tryFrTable.error && Array.isArray(tryFrTable.data) && tryFrTable.data.length > 0) {
          list = list.concat((tryFrTable.data as { id: string }[]).map((r) => r.id));
        }

        // 3) Distinct from menu_items (covers franchises with items but no bills yet)
        const fromMenu = await distinctFranchisesFromMenuItems();
        list = list.concat(fromMenu);

        // 4) Distinct from bills (your existing fallback)
        const fromBills = await fallbackDistinctFranchisesFromBills();
        list = list.concat(fromBills);
      }

      // Always include FR-CENTRAL if your org uses it
      list.push('FR-CENTRAL');

      list = Array.from(new Set(list)).filter(Boolean).sort();
      setFranchiseList(list);

      if (list.length === 0) {
        toast({
          title: 'No franchises found',
          description: 'Could not discover franchise IDs from any source.',
          variant: 'destructive',
        });
      }

      // keep selection valid
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

  // Distinct franchises via menu_items
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

  // Fallback distinct collector from bills (subject to RLS)
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

  const fetchBills = async (targetFranchise?: string, from?: Date, to?: Date) => {
    setLoading(true);
    try {
      let query = supabase.from('bills_generated_billing').select('*');

      if (isCentral) {
        if (targetFranchise && targetFranchise !== 'ALL') {
          query = query.eq('franchise_id', targetFranchise);
        }
      } else if (franchiseId) {
        query = query.eq('franchise_id', franchiseId);
      }

      if (from && to) {
        query = query
          .gte('created_at', startOfDayISO(from))
          .lte('created_at', endOfDayISO(to));
      }

      const { data, error } = await query.order('created_at', { ascending: false }).limit(1000);
      if (error) throw error;
      setBills((data as Bill[]) || []);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to fetch bills',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchBillItems = async (billId: number) => {
    setItemLoading(true);
    setSelectedBillId(billId);
    try {
      const { data, error } = await supabase
        .from('bill_items_generated_billing')
        .select('*')
        .eq('bill_id', billId);

      if (error) throw error;
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

  // Display date (shift if active today and bill is after shiftStart)
  const getDisplayDate = (iso: string) => {
    const original = new Date(iso);
    if (shiftActive && shiftStart && original >= shiftStart) {
      const shifted = new Date(original);
      shifted.setDate(shifted.getDate() + shiftDays);
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
      }

      if (aVal === bVal) return 0;
      return sortDirection === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
    });

    setFilteredBills(filtered);
    setCurrentPage(1);
  };

  const exportToExcel = () => {
    if (isCentral && selectedFranchise === 'ALL') {
      toast({
        title: 'Select a franchise',
        description: 'Please choose a franchise from the dropdown to export its bills only.',
        variant: 'destructive',
      });
      return;
    }

    const exportSource =
      isCentral && selectedFranchise !== 'ALL'
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
      return {
        'Bill ID': bill.id,
        'Franchise ID': bill.franchise_id,
        'Payment Mode': (bill.mode_payment ?? '').toUpperCase(),
        'Total Amount (₹)': Number(bill.total).toFixed(2),
        'Displayed Date': d.toLocaleDateString(),
        'Displayed Time': d.toLocaleTimeString(),
        'Created By': bill.created_by,
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Bills History');

    let filename = 'bills-history';
    if (isCentral && selectedFranchise !== 'ALL') filename += `-${selectedFranchise}`;
    if (!isCentral && franchiseId) filename += `-${franchiseId}`;
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

  const gridCols = isCentral ? 'grid grid-cols-1 sm:grid-cols-6' : 'grid grid-cols-1 sm:grid-cols-5';

  // Activate (no undo same day), scoped to active franchise
  const activateShift = () => {
    if (!activeFranchiseId) {
      toast({
        title: 'Select a franchise',
        description: 'Please choose a specific franchise (not “ALL”) to activate signout.',
        variant: 'destructive',
      });
      return;
    }
    if (shiftActive) return;
    const now = new Date();
    const state: ShiftState = { day: todayStrLocal(), startISO: now.toISOString() };
    localStorage.setItem(shiftKey(activeFranchiseId), JSON.stringify(state));
    setShiftStart(now);
    setShiftActive(true);
    toast({
      title: 'Signout for today active',
      description: `New bills for ${activeFranchiseId} from now will be shown under tomorrow’s date in this view (for today only).`,
    });
    applyFiltersAndSort();
  };

  // Helper: message for empty state
  const emptyMessage = () => {
    if (selectedFranchise !== 'ALL') {
      if (fromDate || toDate) {
        return `No bills for franchise ${selectedFranchise} for the selected date range.`;
      }
      return `No bills for franchise ${selectedFranchise}.`;
    }
    return 'No bills found';
  };

  return (
    <Card className="bg-white">
      {/* Signout for today (per franchise) */}
      <div className="px-6 pt-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium mb-1" style={{ color: 'rgb(0, 100, 55)' }}>
              Signout for today
            </div>
            <div className="text-xs text-gray-600">
              Pressing this button will result in the new bills from now being shown under tomorrow’s date for the selected franchise. This lasts until midnight.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {shiftActive && shiftStart ? (
              <Badge
                variant="outline"
                className="mr-1"
                style={{ backgroundColor: 'rgba(0, 100, 55, 0.08)', borderColor: 'rgb(0, 100, 55)', color: 'rgb(0, 100, 55)' }}
              >
                {activeFranchiseId ? `${activeFranchiseId}: ` : ''}Active since {shiftStart.toLocaleTimeString()}
              </Badge>
            ) : null}
            <Button
              onClick={activateShift}
              style={{ backgroundColor: 'rgb(0, 100, 55)' }}
              disabled={!activeFranchiseId || shiftActive}
              title={
                !activeFranchiseId
                  ? 'Select a specific franchise to activate'
                  : (shiftActive ? 'Already active for today' : 'Shift future bills to tomorrow (display only)')
              }
            >
              <LogOut className="h-4 w-4 mr-2" /> Signout for today
            </Button>
          </div>
        </div>
      </div>

      <CardHeader className="border-b">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" style={{ color: 'rgb(0, 100, 55)' }} />
            <span style={{ color: 'rgb(0, 100, 55)' }}>Bill History</span>
            {isCentral && (
              <Badge
                variant="outline"
                style={{ backgroundColor: 'rgba(0, 100, 55, 0.1)', borderColor: 'rgb(0, 100, 55)' }}
              >
                All Franchises
              </Badge>
            )}
          </CardTitle>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col">
              <label className="text-xs text-gray-600 mb-1">From</label>
              <input
                type="date"
                value={toInputValue(fromDate)}
                onChange={(e) => setFromDate(e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined)}
                className="px-3 py-2 rounded-md border text-sm"
                style={{ borderColor: 'rgba(0, 100, 55, 0.3)', color: 'rgb(0, 100, 55)' }}
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-gray-600 mb-1">To</label>
              <input
                type="date"
                value={toInputValue(toDate)}
                onChange={(e) => setToDate(e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined)}
                className="px-3 py-2 rounded-md border text-sm"
                style={{ borderColor: 'rgba(0, 100, 55, 0.3)', color: 'rgb(0, 100, 55)' }}
              />
            </div>

            {isCentral && (
              <Button
                onClick={() => fetchBills(selectedFranchise, fromDate, toDate)}
                className="ml-1"
                style={{ backgroundColor: 'rgb(0, 100, 55)' }}
                disabled={loading}
              >
                Get Bills
              </Button>
            )}

            {(fromDate || toDate) && (
              <Button
                variant="outline"
                onClick={() => {
                  setFromDate(undefined);
                  setToDate(undefined);
                }}
                className="ml-1"
                style={{ borderColor: 'rgb(0, 100, 55)', color: 'rgb(0, 100, 55)' }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="bg-white">
        {isCentral && (
          <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row sm:items-center gap-3 mb-4 w-full">
            <div className="w-full sm:w-[360px]">
              <label className="text-sm font-medium block mb-1" style={{ color: 'rgb(0, 100, 55)' }}>
                Franchise
              </label>

              {/* CRAZY, aligned, accessible dropdown */}
              <div className="relative">
                <div className="pointer-events-none absolute inset-0 rounded-xl blur-sm bg-gradient-to-r from-emerald-500 via-lime-400 to-emerald-600 opacity-40" />
                <div className="relative rounded-xl border bg-white/90 backdrop-blur-sm">
                  <div className="absolute left-2 top-1/2 -translate-y-1/2">
                    <Building2 className="h-4 w-4 opacity-70" style={{ color: 'rgb(0, 100, 55)' }} />
                  </div>
                  <Select
                    value={selectedFranchise}
                    onValueChange={(val) => {
                      setSelectedFranchise(val);
                      // auto-fetch on change (keeps button as optional manual refresh)
                      fetchBills(val, fromDate, toDate);
                    }}
                  >
                    <SelectTrigger
                      className="pl-8 pr-10 py-2 h-10 w-full rounded-xl border-0 ring-2 ring-emerald-600/40 focus:ring-4 focus:ring-emerald-600/90 transition-all text-sm"
                      style={{ color: 'rgb(0, 100, 55)' }}
                    >
                      <SelectValue placeholder="Select a franchise" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl shadow-lg">
                      <SelectItem value="ALL">ALL</SelectItem>
                      {franchiseList.map((fid) => (
                        <SelectItem key={fid} value={fid}>
                          {fid}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="flex-1" />

            <Button
              onClick={() => fetchBills(selectedFranchise, fromDate, toDate)}
              disabled={loading}
              className="ml-1"
              style={{ backgroundColor: 'rgb(0, 100, 55)' }}
            >
              Get Bills
            </Button>
          </div>
        )}

        {loading ? (
          <div className="text-center py-8">Loading bills...</div>
        ) : filteredBills.length === 0 ? (
          <div className="text-center py-10 text-gray-700">
            {emptyMessage()}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto w-full">
              <div className={`${gridCols} gap-4 p-4 bg-gray-50 rounded-lg font-medium min-w-[600px]`}>
                <Button variant="ghost" onClick={() => handleSort('id')} className="justify-start h-auto p-0" style={{ color: 'rgb(0, 100, 55)' }}>
                  Bill ID <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
                {isCentral && (
                  <Button variant="ghost" onClick={() => handleSort('franchise_id')} className="justify-start h-auto p-0" style={{ color: 'rgb(0, 100, 55)' }}>
                    Franchise <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                )}
                <Button variant="ghost" onClick={() => handleSort('mode_payment')} className="justify-start h-auto p-0" style={{ color: 'rgb(0, 100, 55)' }}>
                  Payment Mode <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
                <Button variant="ghost" onClick={() => handleSort('total')} className="justify-start h-auto p-0" style={{ color: 'rgb(0, 100, 55)' }}>
                  Amount <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
                <Button variant="ghost" onClick={() => handleSort('created_at')} className="justify-start h-auto p-0 sm:col-span-2" style={{ color: 'rgb(0, 100, 55)' }}>
                  Date <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto w-full">
              <div className="space-y-2 min-w-[600px]">
                {currentBills.map((bill) => {
                  const displayDate = getDisplayDate(bill.created_at);
                  return (
                    <div key={bill.id} className={`${gridCols} gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors text-sm sm:text-base`}>
                      <div className="break-words min-w-0">
                        <Button
                          variant="link"
                          className="p-0 text-left font-medium underline"
                          style={{ color: 'rgb(0, 100, 55)' }}
                          onClick={() => fetchBillItems(bill.id)}
                        >
                          #{bill.id}
                        </Button>
                      </div>
                      {isCentral && (
                        <div className="break-words min-w-0">
                          <Badge variant="outline" className="w-fit" style={{ backgroundColor: 'rgba(0, 100, 55, 0.1)', borderColor: 'rgb(0, 100, 55)' }}>
                            {bill.franchise_id}
                          </Badge>
                        </div>
                      )}
                      <div className="break-words min-w-0">
                        <Badge
                          variant={getPaymentBadgeVariant(bill.mode_payment)}
                          style={{
                            backgroundColor: (bill.mode_payment ?? '').toLowerCase() === 'cash' ? 'rgb(0, 100, 55)' : undefined,
                            color: (bill.mode_payment ?? '').toLowerCase() === 'cash' ? 'white' : 'rgb(0, 100, 55)',
                          }}
                        >
                          {(bill.mode_payment ?? '').toUpperCase()}
                        </Badge>
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

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4">
                <div className="text-sm text-gray-600">
                  Showing {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, filteredBills.length)} of {filteredBills.length}
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
            )}

            <div className="flex justify-end pt-4">
              <Button onClick={exportToExcel} style={{ backgroundColor: 'rgb(0, 100, 55)' }}>
                <Download className="h-4 w-4 mr-2" /> Export to Excel
              </Button>
            </div>
          </div>
        )}

        {selectedBillId !== null && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-lg max-w-lg w-full shadow-lg relative">
              <h2 className="text-xl font-bold mb-2" style={{ color: 'rgb(0, 100, 55)' }}>
                Items for Bill #{selectedBillId}
              </h2>
              <Button
                className="absolute top-2 right-2"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelectedBillId(null);
                  setBillItems([]);
                }}
                style={{ color: 'rgb(0, 100, 55)' }}
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
                          Quantity: {item.qty} | Rate: ₹{item.price} | Total: ₹{(item.qty * item.price).toFixed(2)}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 border-t pt-2 font-semibold text-right" style={{ color: 'rgb(0, 100, 55)' }}>
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
