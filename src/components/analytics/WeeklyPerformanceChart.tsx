import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Calendar, Download, TrendingUp, Building2, ChevronDown, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';
import 'react-datepicker/dist/react-datepicker.css';
import DatePicker from 'react-datepicker';

interface DayData {
  day: string;            // short weekday (e.g., Mon)
  date: string;           // YYYY-MM-DD (IST)
  revenue: number;
  orders: number;
  avgOrderValue: number;
  dayOfWeek: string;      // long weekday (e.g., Monday)
  labelShort: string;     // Mon (dd/MM/yyyy)
  labelLong: string;      // Monday, 12 February 2025
}

interface WeeklyPerformanceProps {
  userFranchiseId: string;
  isCentral: boolean;
}

type BillRow = {
  id: number;
  total: number | string | null;
  created_at: string;
  franchise_id: string;
};

// ---- Shift state persisted by "Bill History" ----
type ShiftState = {
  day: string;      // YYYY-MM-DD local day of activation
  startISO: string; // ISO timestamp when shift began (UTC ISO string)
};

export function WeeklyPerformanceChart({ userFranchiseId, isCentral }: WeeklyPerformanceProps) {
  const [weeklyData, setWeeklyData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFranchise, setSelectedFranchise] = useState<string>(isCentral ? '' : userFranchiseId);
  const [searchInput, setSearchInput] = useState<string>(isCentral ? '' : displayFromId(userFranchiseId));
  const [franchiseList, setFranchiseList] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<Date | null>(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const [endDate, setEndDate] = useState<Date | null>(new Date());
  const [totalOrders, setTotalOrders] = useState<number>(0);
  const { toast } = useToast();

  // ------- ID normalization / display helpers -------
  function toFranchiseId(input: string): string {
    const trimmed = input.trim().toUpperCase();
    // Allow CENTRAL alias
    if (trimmed === 'CENTRAL') return 'FR-CENTRAL';
    // If user typed full ID already, normalize zero padding
    const fullMatch = trimmed.match(/^FR-(\d+)$/i);
    if (fullMatch) return `FR-${fullMatch[1].padStart(4, '0')}`;
    // If user typed just digits, convert to FR-####
    if (/^\d+$/.test(trimmed)) return `FR-${trimmed.padStart(4, '0')}`;
    // Otherwise, return as-is (allows non-standard IDs too)
    return trimmed;
  }

  function displayFromId(id: string): string {
    if (!id) return '';
    if (id.toUpperCase() === 'FR-CENTRAL') return 'CENTRAL';
    const m = id.match(/^FR-(\d+)$/i);
    return m ? m[1] : id;
  }

  function displayLabel(id: string): string {
    // For dropdown labels
    if (id.toUpperCase() === 'FR-CENTRAL') return 'CENTRAL';
    return id;
  }

  // ------- IST helpers -------
  const ymdIST = (d: Date) =>
    d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD

  const buildISTStartISO = (d: Date) => {
    const ymd = ymdIST(d);
    return new Date(`${ymd}T00:00:00+05:30`).toISOString(); // inclusive start
  };
  const buildISTEndISO = (d: Date) => {
    const ymd = ymdIST(d);
    return new Date(`${ymd}T23:59:59.999+05:30`).toISOString(); // inclusive end-of-day
  };

  const istWeekdayLong = (ymd: string) =>
    new Date(`${ymd}T12:00:00+05:30`).toLocaleDateString('en-GB', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
    });

  const istWeekdayShort = (ymd: string) =>
    new Date(`${ymd}T12:00:00+05:30`).toLocaleDateString('en-GB', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
    });

  const labelShortFor = (ymd: string) => {
    const [Y, M, D] = ymd.split('-');
    const pretty = `${D}/${M}/${Y}`;
    return `${istWeekdayShort(ymd)} (${pretty})`;
  };

  const labelLongFor = (ymd: string) =>
    new Date(`${ymd}T12:00:00+05:30`).toLocaleDateString('en-GB', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

  // For grouping bills by IST date
  const dateKeyFromTimestampIST = (ts: string) =>
    new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD

  // ---------- Shift helpers (reuse the same keys as Bill History) ----------
  const todayStrLocal = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const shiftKey = (fid: string) => `bill_date_shift_state:${fid}`;

  // Reads shift start for a specific franchise if the shift is active *today*; otherwise null.
  const getShiftStartForFranchise = (fid: string | null): Date | null => {
    if (!fid) return null;
    const raw = localStorage.getItem(shiftKey(fid));
    if (!raw) return null;
    try {
      const parsed: ShiftState = JSON.parse(raw);
      if (parsed?.day === todayStrLocal() && parsed?.startISO) {
        const d = new Date(parsed.startISO);
        if (!Number.isNaN(d.getTime())) return d;
      } else {
        return null;
      }
    } catch {
      return null;
    }
    return null;
  };

  useEffect(() => {
    if (isCentral) fetchFranchiseList();
    fetchWeeklyData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCentral]);

  useEffect(() => {
    fetchWeeklyData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFranchise, startDate, endDate]);

  // ---- Distinct from menu_items (captures franchises with items but no bills) ----
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

  // --- Franchise list loading with multiple fallbacks (includes franchises with no bills) ---
  const fetchFranchiseList = async () => {
    try {
      let list: string[] = [];

      // Prefer RPC that returns ALL franchises (create as SECURITY DEFINER server-side)
      const rpcAll = await supabase.rpc('get_all_franchises');
      if (!rpcAll.error && Array.isArray(rpcAll.data) && rpcAll.data.length > 0) {
        list = (rpcAll.data as any[]).map((r) =>
          typeof r === 'string' ? r : (r.id ?? r.franchise_id ?? r.code)
        );
      } else {
        const fromFranchises = await supabase.from('franchises').select('id').order('id');
        if (!fromFranchises.error && fromFranchises.data && fromFranchises.data.length > 0) {
          list = list.concat((fromFranchises.data as { id: string }[]).map((r) => r.id));
        }
        const fromMenu = await distinctFranchisesFromMenuItems();
        list = list.concat(fromMenu);
        const fromBills = await fallbackDistinctFranchisesFromBills();
        list = list.concat(fromBills);
      }

      // Ensure FR-CENTRAL is present if you use it
      list.push('FR-CENTRAL');

      list = Array.from(new Set(list)).filter(Boolean).sort();
      setFranchiseList(list);

      // Ensure selectedFranchise is valid for the new list
      if (list.length > 0 && selectedFranchise && !list.includes(selectedFranchise)) {
        setSelectedFranchise('');
        setSearchInput('');
      }

      if (isCentral && list.length <= 1) {
        toast({
          title: 'Limited franchise list',
          description:
            'Only a single franchise is visible. If you expect more, check your RLS policies or expose a central-safe source (table/RPC).',
        });
      }
    } catch (error: any) {
      console.error('Error fetching franchise list:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch franchise list',
        variant: 'destructive',
      });
    }
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

      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const row of data as { franchise_id: string | null }[]) {
        if (row.franchise_id) ids.add(row.franchise_id);
      }

      if (data.length < pageSize) break;
      from += pageSize;
    }

    return Array.from(ids);
  };

  // ---- Paginate to bypass Supabase's 1k row cap ----
  const fetchBillsPaged = async (startISO: string, endISO: string): Promise<BillRow[]> => {
    const pageSize = 1000;
    let from = 0;
    const all: BillRow[] = [];

    while (true) {
      const to = from + pageSize - 1;
      let q = supabase
        .from('bills_generated_billing')
        .select('id, total, created_at, franchise_id')
        .gte('created_at', startISO)
        .lte('created_at', endISO)
        .order('id', { ascending: true })
        .range(from, to);

      if (!isCentral) {
        q = q.eq('franchise_id', userFranchiseId);
      } else if (selectedFranchise) {
        q = q.eq('franchise_id', selectedFranchise);
      }

      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) break;

      all.push(...(data as BillRow[]));
      if (data.length < pageSize) break;
      from += pageSize;
    }

    return all;
  };

  const fetchWeeklyData = async () => {
    setLoading(true);
    try {
      if (!startDate || !endDate) throw new Error('Please select both start and end dates');

      // Normalize and ensure start <= end
      let s = startDate;
      let e = endDate;
      if (s > e) [s, e] = [e, s];

      // Build IST-inclusive bounds
      const startISO = buildISTStartISO(s);
      const endISO = buildISTEndISO(e);

      // Fetch *all* bills in the range (with pagination)
      const bills = await fetchBillsPaged(startISO, endISO);

      // PREP: shift start cache so we don't touch localStorage in a hot loop too many times
      const shiftCache = new Map<string, Date | null>();
      const getShiftFor = (fid: string) => {
        if (!shiftCache.has(fid)) {
          shiftCache.set(fid, getShiftStartForFranchise(fid));
        }
        return shiftCache.get(fid) ?? null;
      };

      // Seed day map for each IST date in range
      const dayMap = new Map<string, DayData>();

      const startYMD = ymdIST(s);
      const endYMD = ymdIST(e);

      const addDaysYMD = (ymd: string, days: number) => {
        const d = new Date(`${ymd}T12:00:00+05:30`);
        d.setDate(d.getDate() + days);
        return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      };

      let cur = startYMD;
      while (true) {
        dayMap.set(cur, {
          day: istWeekdayShort(cur),
          date: cur,
          revenue: 0,
          orders: 0,
          avgOrderValue: 0,
          dayOfWeek: istWeekdayLong(cur),
          labelShort: labelShortFor(cur),
          labelLong: labelLongFor(cur),
        });
        if (cur === endYMD) break;
        cur = addDaysYMD(cur, 1);
      }

      // Aggregate bills per IST day, applying signout shift per franchise if active
      for (const bill of bills) {
        let created = new Date(bill.created_at);
        const shiftStart = getShiftFor(bill.franchise_id);
        if (shiftStart && created >= shiftStart) {
          const shifted = new Date(created);
          shifted.setDate(shifted.getDate() + 1);
          created = shifted;
        }

        const key = dateKeyFromTimestampIST(created.toISOString());
        const row = dayMap.get(key);
        if (!row) continue;

        row.revenue += Number(bill.total) || 0;
        row.orders += 1;
        row.avgOrderValue = row.orders > 0 ? row.revenue / row.orders : 0;
        dayMap.set(key, row);
      }

      const filled = Array.from(dayMap.values()).sort(
        (a, b) =>
          new Date(`${a.date}T00:00:00+05:30`).getTime() -
          new Date(`${b.date}T00:00:00+05:30`).getTime()
      );

      setWeeklyData(filled);
      setTotalOrders(bills.length);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to fetch weekly performance data',
        variant: 'destructive',
      });
      console.error('Error fetching weekly data:', error);
      setWeeklyData([]);
      setTotalOrders(0);
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = () => {
    if (weeklyData.length === 0) {
      toast({ title: 'No Data', description: 'There is no data to export', variant: 'destructive' });
      return;
    }

    const exportData = weeklyData.map((day) => ({
      Day: day.dayOfWeek,
      'Date (IST)': day.date,
      'Revenue (₹)': day.revenue.toFixed(2),
      Orders: day.orders,
      'Avg Order Value (₹)': day.avgOrderValue.toFixed(2),
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Weekly Performance');

    const filename = `weekly-performance-${selectedFranchise || 'all'}-${
      new Date().toISOString().split('T')[0]
    }.xlsx`;
    XLSX.writeFile(workbook, filename);

    toast({ title: 'Export Successful', description: 'Weekly performance data exported to Excel' });
  };

  const totalWeekRevenue = weeklyData.reduce((sum, day) => sum + day.revenue, 0);
  const avgWeeklyOrderValue = totalOrders > 0 ? totalWeekRevenue / totalOrders : 0;

  if (loading) return <div className="text-center py-8">Loading weekly performance...</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              <CardTitle>Weekly Performance</CardTitle>
            </div>
            <div className="flex items-center gap-4">
              {isCentral && (
                <>
                  {/* Search bar to type numeric code or "CENTRAL" (press Enter to fetch) */}
                  <div className="relative w-48 sm:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-700 opacity-70" />
                    <input
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const id = toFranchiseId(searchInput);
                          setSelectedFranchise(id);
                          setSearchInput(displayFromId(id)); // keep numeric/CENTRAL view
                        }
                      }}
                      placeholder='Enter code (e.g., 0005) or "CENTRAL"…'
                      className="w-full rounded-xl border-0 ring-2 ring-emerald-600/40 focus:ring-4 focus:ring-emerald-600/90 pl-9 pr-3 py-2 h-10 text-sm bg-white/90 backdrop-blur-sm"
                    />
                  </div>

                  {/* Dropdown (values are full IDs; labels show CENTRAL for FR-CENTRAL) */}
                  <div className="relative flex-1 max-w-md">
                    <div className="pointer-events-none absolute inset-0 rounded-xl blur-sm bg-gradient-to-r from-emerald-500 via-lime-400 to-emerald-600 opacity-40" />
                    <div className="relative rounded-xl border bg-white/90 backdrop-blur-sm">
                      {/* Left icon */}
                      <div className="absolute left-2 top-1/2 -translate-y-1/2">
                        <Building2 className="h-4 w-4 opacity-70 text-emerald-700" />
                      </div>
                      {/* Right custom arrow */}
                      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                        <ChevronDown className="h-4 w-4 opacity-70 text-emerald-700" />
                      </div>
                      <select
                        value={selectedFranchise}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedFranchise(val);
                          setSearchInput(displayFromId(val)); // show just digits or CENTRAL in input
                        }}
                        className="appearance-none pl-8 pr-10 py-2 h-10 w-full rounded-xl border-0 ring-2 ring-emerald-600/40 focus:ring-4 focus:ring-emerald-600/90 transition-all text-sm bg-transparent"
                      >
                        <option value="">All Franchises</option>
                        {franchiseList.map((franchise) => (
                          <option key={franchise} value={franchise}>
                            {displayLabel(franchise)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </>
              )}
              <Button onClick={exportToExcel} variant="outline" disabled={weeklyData.length === 0}>
                <Download className="h-4 w-4 mr-2" />
                Export Excel
              </Button>
            </div>
          </div>
        </CardHeader>

        {/* Empty-state banner when a specific franchise has no data */}
        {isCentral && selectedFranchise && weeklyData.length === 0 && (
          <div className="mx-6 -mt-2 mb-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-amber-800">
            No data available for franchise <span className="font-semibold">{selectedFranchise}</span> in the selected date range.
          </div>
        )}

        <CardContent>
          <div className="mb-6 flex flex-wrap gap-4">
            <div>
              <span className="block text-sm font-medium mb-1">Start Date</span>
              <DatePicker
                selected={startDate}
                onChange={(date: Date | null) => setStartDate(date)}
                selectsStart
                startDate={startDate}
                endDate={endDate}
                dateFormat="dd/MM/yyyy"
                className="border p-2 rounded-md w-full"
                placeholderText="Select start date"
              />
            </div>
            <div>
              <span className="block text-sm font-medium mb-1">End Date</span>
              <DatePicker
                selected={endDate}
                onChange={(date: Date | null) => setEndDate(date)}
                selectsEnd
                startDate={startDate}
                endDate={endDate}
                minDate={startDate || undefined}
                dateFormat="dd/MM/yyyy"
                className="border p-2 rounded-md w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold">₹{totalWeekRevenue.toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">Total Orders</p>
                <p className="text-2xl font-bold">{totalOrders}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">Avg Order Value</p>
                <p className="text-2xl font-bold">₹{(totalOrders > 0 ? totalWeekRevenue / totalOrders : 0).toFixed(2)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Daily Revenue Trend */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Daily Revenue Trend
              </h3>
            </div>
            <div className="overflow-x-auto pb-2">
              <div style={{ minWidth: `${weeklyData.length * 60}px` }}>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weeklyData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="labelShort" tick={{ fontSize: 12 }} />
                      <YAxis />
                      <Tooltip
                        formatter={(value: number) => [`₹${value.toFixed(2)}`, 'Revenue']}
                        labelFormatter={(label) => String(label)}
                      />
                      <Line
                        type="monotone"
                        dataKey="revenue"
                        stroke="hsl(var(--primary))"
                        strokeWidth={3}
                        dot={{ r: 6, strokeWidth: 2, fill: 'hsl(var(--primary))' }}
                        activeDot={{ r: 8 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

          {/* Daily Orders */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Daily Orders Count</h3>
            </div>
            <div className="overflow-x-auto pb-2">
              <div style={{ minWidth: `${weeklyData.length * 60}px` }}>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weeklyData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="labelShort" tick={{ fontSize: 12 }} />
                      <YAxis />
                      <Tooltip
                        formatter={(value: number) => [value, 'Orders']}
                        labelFormatter={(label) => String(label)}
                      />
                      <Bar dataKey="orders" fill="hsl(var(--secondary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
