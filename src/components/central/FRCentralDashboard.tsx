import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { IndividualFranchiseAnalytics } from './IndividualFranchiseAnalytics';

interface FRCentralStats {
  todayRevenue: number;
  todayOrders: number;
  currentHourRevenue: number;
  status: 'quiet' | 'normal' | 'busy' | 'very-busy';
  lastActivity: string | null;
}

interface FRCentralTotalStats {
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
}

interface RangeStats {
  revenue: number;
  orders: number;
  avgOrderValue: number;
}

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

// Persisted base for “lifetime” discounts (excludes today)
// You can reset it to 0 in the console: localStorage.setItem('fr-central:discountsBase','0')
const DISCOUNTS_BASE_KEY = 'fr-central:discountsBase';

function getDiscountsBase(): number {
  try {
    const v = localStorage.getItem(DISCOUNTS_BASE_KEY);
    if (v == null) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}
function setDiscountsBase(n: number) {
  try {
    localStorage.setItem(DISCOUNTS_BASE_KEY, String(n || 0));
  } catch {}
}

export function FRCentralDashboard() {
  const [stats, setStats] = useState<FRCentralStats>({
    todayRevenue: 0,
    todayOrders: 0,
    currentHourRevenue: 0,
    status: 'quiet',
    lastActivity: null,
  });

  const [totalStats, setTotalStats] = useState<FRCentralTotalStats>({
    totalRevenue: 0,
    totalOrders: 0,
    avgOrderValue: 0,
  });

  // Discounts
  const [totalDiscounts, setTotalDiscounts] = useState<number>(0);
  const [todaysDiscounts, setTodaysDiscounts] = useState<number>(0);

  // Date range (for the range summary section)
  const [dateFrom, setDateFrom] = useState<string>(''); // YYYY-MM-DD
  const [dateTo, setDateTo] = useState<string>('');     // YYYY-MM-DD
  const [rangeStats, setRangeStats] = useState<RangeStats>({
    revenue: 0,
    orders: 0,
    avgOrderValue: 0,
  });
  const [rangeLoading, setRangeLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('realtime');

  // IST helpers
  const buildISTISO = (dateStr: string, endOfDay = false) => {
    const t = endOfDay ? '23:59:59.999' : '00:00:00.000';
    return new Date(`${dateStr}T${t}+05:30`).toISOString();
  };
  const buildISTHourISO = (dateStr: string, hour: number) => {
    const hh = String(hour).padStart(2, '0');
    return new Date(`${dateStr}T${hh}:00:00.000+05:30`).toISOString();
  };

  const startISO = useMemo(
    () => (dateFrom ? buildISTISO(dateFrom, false) : undefined),
    [dateFrom]
  );
  const endISO = useMemo(
    () => (dateTo ? buildISTISO(dateTo, true) : undefined),
    [dateTo]
  );

  // ---------- Discounts: bill-first, paise-accurate ----------
  // discount(bill) = max(0, sum(items.qty*price) - bill.total) with epsilon
  const computeDiscountsFromBillsPaginated = async (opts: {
    franchiseId: string;
    startUtcIso?: string;
    endUtcIso?: string;
    epsilonPaise?: number; // default ₹1.00
  }) => {
    const PAGE = 1000;
    let from = 0;
    let discountsPaise = 0;
    const eps = typeof opts.epsilonPaise === 'number' ? opts.epsilonPaise : 100;

    while (true) {
      let q = supabase
        .from('bills_generated_billing')
        .select('id,total,created_at,bill_items_generated_billing(qty,price)')
        .eq('franchise_id', opts.franchiseId)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);

      if (opts.startUtcIso) q = q.gte('created_at', opts.startUtcIso);
      if (opts.endUtcIso)   q = q.lte('created_at', opts.endUtcIso);

      const { data, error } = await q as any;
      if (error) throw error;

      const bills = data ?? [];
      if (bills.length === 0) break;

      for (const b of bills) {
        const itemsPaise = (b.bill_items_generated_billing ?? []).reduce((acc: number, it: any) => {
          const qty = Number(it.qty) || 0;
          const price = Number(it.price) || 0;
          return acc + Math.round(qty * price * 100);
        }, 0);

        const totalPaise = Math.round(Number(b.total || 0) * 100);
        const diff = itemsPaise - totalPaise;
        if (diff > eps) discountsPaise += diff;
      }

      if (bills.length < PAGE) break;
      from += PAGE;
    }

    return Math.round(discountsPaise) / 100; // ₹
  };

  useEffect(() => {
    if (localStorage.getItem(DISCOUNTS_BASE_KEY) == null) {
      setDiscountsBase(0);
    }

    fetchFRCentralStats().finally(() => setLoading(false));
    fetchFRCentralTotalStats();

    const channel = supabase
      .channel('fr-central-updates')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bills_generated_billing', filter: 'franchise_id=eq.FR-CENTRAL' },
        () => {
          fetchFRCentralStats();
          fetchFRCentralTotalStats();
          if (startISO && endISO) fetchRangeStats(startISO, endISO);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (startISO && endISO) fetchRangeStats(startISO, endISO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startISO, endISO]);

  const fetchFRCentralStats = async () => {
    try {
      const now = new Date();
      const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const y = istNow.getFullYear();
      const m = String(istNow.getMonth() + 1).padStart(2, '0');
      const d = String(istNow.getDate()).padStart(2, '0');
      const todayStr = `${y}-${m}-${d}`;
      const currentHourStartUtc = buildISTHourISO(todayStr, istNow.getHours());
      const todayStartUtc = buildISTISO(todayStr, false);
      const todayEndUtc = buildISTISO(todayStr, true);

      // Today's bills (IST)
      const { data: todayBills, error } = await supabase
        .from('bills_generated_billing')
        .select('total, created_at')
        .eq('franchise_id', 'FR-CENTRAL')
        .gte('created_at', todayStartUtc)
        .lte('created_at', todayEndUtc)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const todayRevenue = (todayBills ?? []).reduce((s, b) => s + Number(b.total || 0), 0);
      const todayOrders = todayBills?.length || 0;
      const currentHourRevenue = (todayBills ?? [])
        .filter((b) => b.created_at >= currentHourStartUtc)
        .reduce((s, b) => s + Number(b.total || 0), 0);

      // Today's discounts (unchanged)
      const todayDisc = await computeDiscountsFromBillsPaginated({
        franchiseId: 'FR-CENTRAL',
        startUtcIso: todayStartUtc,
        endUtcIso: todayEndUtc,
      });
      setTodaysDiscounts(todayDisc);

      // Total discounts = persisted base + today's
      const base = getDiscountsBase();
      setTotalDiscounts((Number.isFinite(base) ? base : 0) + (Number.isFinite(todayDisc) ? todayDisc : 0));

      let status: FRCentralStats['status'] = 'quiet';
      const currentHourOrders = (todayBills ?? []).filter((b) => b.created_at >= currentHourStartUtc).length;
      if (currentHourOrders >= 10) status = 'very-busy';
      else if (currentHourOrders >= 5) status = 'busy';
      else if (currentHourOrders >= 2) status = 'normal';

      setStats({
        todayRevenue,
        todayOrders,
        currentHourRevenue,
        status,
        lastActivity: todayBills?.[0]?.created_at || null,
      });
    } catch (err) {
      console.error('Error fetching FR-CENTRAL today stats:', err);
    }
  };

  const fetchFRCentralTotalStats = async () => {
    try {
      // ✅ No server aggregate calls (prevents 400 errors)
      // Total revenue (client-side sum)
      const totalRevenue = await clientSideSumTotal('FR-CENTRAL');

      // Total orders (exact count head request is fine)
      const { count, error: countErr } = await supabase
        .from('bills_generated_billing')
        .select('id', { head: true, count: 'exact' })
        .eq('franchise_id', 'FR-CENTRAL');
      if (countErr) throw countErr;

      const totalOrders = count ?? 0;

      setTotalStats({
        totalRevenue: Number.isFinite(totalRevenue) ? totalRevenue : 0,
        totalOrders,
        avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      });

      // NOTE: totalDiscounts is derived in fetchFRCentralStats (base + today).
    } catch (error) {
      console.error('Error fetching total stats:', error);
    }
  };

  // Client-side sum helpers (paginated)
  const clientSideSumTotal = async (franchiseId: string): Promise<number> => {
    let sum = 0;
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from('bills_generated_billing')
        .select('total')
        .eq('franchise_id', franchiseId)
        .order('id', { ascending: true })
        .range(from, to);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const row of data) sum += Number((row as any).total || 0);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return sum;
  };

  const fetchRangeStats = async (startISO: string, endISO: string) => {
    setRangeLoading(true);
    try {
      // ✅ No server aggregate calls here either
      const revenue = await clientSideRangeSum('FR-CENTRAL', startISO, endISO);

      const { count } = await supabase
        .from('bills_generated_billing')
        .select('id', { head: true, count: 'exact' })
        .eq('franchise_id', 'FR-CENTRAL')
        .gte('created_at', startISO)
        .lte('created_at', endISO);

      const orders = count ?? 0;
      setRangeStats({
        revenue: Number.isFinite(revenue) ? revenue : 0,
        orders,
        avgOrderValue: orders > 0 ? revenue / orders : 0,
      });
    } catch (err) {
      console.error('Error fetching range stats:', err);
      setRangeStats({ revenue: 0, orders: 0, avgOrderValue: 0 });
    } finally {
      setRangeLoading(false);
    }
  };

  const clientSideRangeSum = async (franchiseId: string, startISO: string, endISO: string) => {
    let sum = 0;
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from('bills_generated_billing')
        .select('total, created_at')
        .eq('franchise_id', franchiseId)
        .gte('created_at', startISO)
        .lte('created_at', endISO)
        .order('id', { ascending: true })
        .range(from, to);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const row of data) sum += Number((row as any).total || 0);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return sum;
  };

  if (loading) {
    return <div className="text-center py-8">Loading FR-CENTRAL analytics...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Row 1: Total Stats — all four in one line */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-6">
          <p className="text-sm font-medium text-muted-foreground">Total Orders</p>
          <p className="text-2xl font-bold">{totalStats.totalOrders}</p>
        </CardContent></Card>

        <Card><CardContent className="p-6">
          <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
          <p className="text-2xl font-bold">{INR.format(totalStats.totalRevenue || 0)}</p>
        </CardContent></Card>

        <Card><CardContent className="p-6">
          <p className="text-sm font-medium text-muted-foreground">Avg Order Value</p>
          <p className="text-2xl font-bold">{INR.format(totalStats.avgOrderValue || 0)}</p>
        </CardContent></Card>

        {/* Total Discounts (FR-CENTRAL only) */}
        <Card><CardContent className="p-6">
          <p className="text-sm font-medium text-muted-foreground">Total Discounts</p>
          <p className="text-2xl font-bold">{INR.format(totalDiscounts || 0)}</p>
        </CardContent></Card>
      </div>

      {/* Row 2: Today's Stats — all four in one line */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-6">
          <p className="text-sm font-medium text-muted-foreground">Today&apos;s Orders</p>
          <p className="text-2xl font-bold">{stats.todayOrders}</p>
        </CardContent></Card>

        <Card><CardContent className="p-6">
          <p className="text-sm font-medium text-muted-foreground">Today&apos;s Revenue</p>
          <p className="text-2xl font-bold">{INR.format(stats.todayRevenue || 0)}</p>
        </CardContent></Card>

        <Card><CardContent className="p-6">
          <p className="text-sm font-medium text-muted-foreground">Today&apos;s Avg Order</p>
          <p className="text-2xl font-bold">
            {INR.format(stats.todayOrders > 0 ? stats.todayRevenue / stats.todayOrders : 0)}
          </p>
        </CardContent></Card>

        {/* Today’s Discounts (FR-CENTRAL only) */}
        <Card><CardContent className="p-6">
          <p className="text-sm font-medium text-muted-foreground">Today&apos;s Discounts</p>
          <p className="text-2xl font-bold">{INR.format(todaysDiscounts || 0)}</p>
        </CardContent></Card>
      </div>

      {/* Single Date Range + Range Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Filter by Date Range (IST)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col">
              <label className="text-sm text-muted-foreground mb-1">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-2 rounded-md border text-sm"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-sm text-muted-foreground mb-1">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-2 rounded-md border text-sm"
              />
            </div>
            {rangeLoading && <span className="text-sm text-muted-foreground ml-1">Loading…</span>}
          </div>

          {(dateFrom && dateTo) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card><CardContent className="p-6">
                <p className="text-sm font-medium text-muted-foreground">Orders in Range</p>
                <p className="text-2xl font-bold">{rangeStats.orders}</p>
              </CardContent></Card>

              <Card><CardContent className="p-6">
                <p className="text-sm font-medium text-muted-foreground">Revenue in Range</p>
                <p className="text-2xl font-bold">{INR.format(rangeStats.revenue || 0)}</p>
              </CardContent></Card>

              <Card><CardContent className="p-6">
                <p className="text-sm font-medium text-muted-foreground">Avg Order Value (Range)</p>
                <p className="text-2xl font-bold">{INR.format(rangeStats.avgOrderValue || 0)}</p>
              </CardContent></Card>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detailed Analytics Tabs */}
      <Tabs defaultValue="realtime" className="w-full" onValueChange={(v) => setActiveTab(v)}>
        <TabsContent value="realtime">
          <IndividualFranchiseAnalytics franchiseId="FR-CENTRAL" startISO={startISO} endISO={endISO} />
        </TabsContent>
        <TabsContent value="hourly">
          <IndividualFranchiseAnalytics franchiseId="FR-CENTRAL" startISO={startISO} endISO={endISO} />
        </TabsContent>
        <TabsContent value="popular">
          <IndividualFranchiseAnalytics franchiseId="FR-CENTRAL" startISO={startISO} endISO={endISO} />
        </TabsContent>
        <TabsContent value="predictions">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Detailed Performance Insights
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <Card>
                  <CardHeader><CardTitle>Performance Trends</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span>Today vs Yesterday</span>
                        <Badge variant="outline" className="text-success">+15.2%</Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Today vs Same Day Last Week</span>
                        <Badge variant="outline" className="text-success">+8.7%</Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Current Hour vs Same Hour Yesterday</span>
                        <Badge variant="outline" className="text-destructive">-3.1%</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
