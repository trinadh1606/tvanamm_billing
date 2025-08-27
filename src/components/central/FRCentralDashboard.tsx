import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, AlertTriangle } from 'lucide-react';
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

  // Single date range (controls range summary + sales distribution)
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

  // ---------- Data retention (for alert) ----------
  const [retentionDays, setRetentionDays] = useState<number | null>(null);

  // Count rows that would actually be deleted at the next purge
  const [billsToDeleteCount, setBillsToDeleteCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Try DB setting first (optional)
        const { data, error } = await supabase
          .from('system_settings')
          .select('value')
          .eq('key', 'retention_days')
          .maybeSingle();

        if (!error && data?.value && !Number.isNaN(parseInt(data.value, 10))) {
          setRetentionDays(parseInt(data.value, 10));
          return;
        }
      } catch {
        /* ignore and fallback to env/default */
      }

      // Env or default — DEFAULT TO 45 (not 90)
      const fromEnvRaw = (import.meta as any)?.env?.VITE_DATA_RETENTION_DAYS ?? '';
      const fromEnv = parseInt(fromEnvRaw, 10);
      setRetentionDays(Number.isFinite(fromEnv) ? fromEnv : 45);
    })();
  }, []);

  // ---------- Accurate purge schedule (IST semantics) ----------
  const PURGE_HOUR_IST =
    Number.isFinite(parseInt((import.meta as any)?.env?.VITE_PURGE_HOUR_IST ?? '', 10))
      ? parseInt((import.meta as any)?.env?.VITE_PURGE_HOUR_IST, 10)
      : 2; // set this to your actual cron hour (0-23)

  // "Now" in IST as a Date
  const nowIST = useMemo(
    () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })),
    []
  );

  // Next purge Date in IST at PURGE_HOUR_IST
  const nextPurgeIST = useMemo(() => {
    const d = new Date(nowIST);
    d.setHours(PURGE_HOUR_IST, 0, 0, 0);
    if (nowIST.getTime() >= d.getTime()) {
      d.setDate(d.getDate() + 1); // already passed today's purge time → use tomorrow
    }
    return d;
  }, [nowIST, PURGE_HOUR_IST]);

  // Cutoff instant applied at next purge (delete rows with created_at < cutoff)
  const cutoffAtNextRunIST = useMemo(() => {
    if (!retentionDays || retentionDays <= 0) return null;
    const c = new Date(nextPurgeIST);
    c.setDate(c.getDate() - (retentionDays as number));
    return c;
  }, [nextPurgeIST, retentionDays]);

  // Human-friendly labels
  const formatISTFull = (d: Date) =>
    new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);

  const formatISTDay = (d: Date) =>
    new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(d);

  // The calendar "bill day" affected at the next purge (IST day label)
  const affectedBillDayIST = useMemo(() => {
    if (!cutoffAtNextRunIST) return null;
    return formatISTDay(cutoffAtNextRunIST);
  }, [cutoffAtNextRunIST]);

  // --- Query the DB to know if *any* rows will be deleted (so we can say "No data yet" if zero) ---
  useEffect(() => {
    const run = async () => {
      if (!cutoffAtNextRunIST) {
        setBillsToDeleteCount(null);
        return;
      }
      setCountLoading(true);
      setCountError(null);
      try {
        // Convert the IST wall-clock cutoff to the UTC instant Postgres stores in timestamptz
        const cutoffISO = cutoffAtNextRunIST.toISOString();

        // Count across ALL franchises (global purge). To scope to a franchise, add .eq('franchise_id','FR-CENTRAL')
        const { count, error } = await supabase
          .from('bills_generated_billing')
          .select('id', { head: true, count: 'exact' })
          .lt('created_at', cutoffISO);

        if (error) throw error;
        setBillsToDeleteCount(count ?? 0);
      } catch (e: any) {
        console.error('count error', e);
        setCountError(e?.message || 'Failed to check eligibility');
        setBillsToDeleteCount(null);
      } finally {
        setCountLoading(false);
      }
    };
    run();
  }, [cutoffAtNextRunIST]);

  // ---------- helpers for the rest ----------
  const buildISTISO = (dateStr: string, endOfDay = false) => {
    const t = endOfDay ? '23:59:59.999' : '00:00:00.000';
    return new Date(`${dateStr}T${t}+05:30`).toISOString();
  };

  const startISO = useMemo(
    () => (dateFrom ? buildISTISO(dateFrom, false) : undefined),
    [dateFrom]
  );
  const endISO = useMemo(
    () => (dateTo ? buildISTISO(dateTo, true) : undefined),
    [dateTo]
  );

  useEffect(() => {
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

  // Auto-refresh range stats whenever the date range changes
  useEffect(() => {
    if (startISO && endISO) fetchRangeStats(startISO, endISO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startISO, endISO]);

  const fetchFRCentralStats = async () => {
    try {
      const now = new Date();
      const istNowLocal = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const today = istNowLocal.toISOString().split('T')[0];
      const currentHourStart = `${today}T${istNowLocal.getHours().toString().padStart(2, '0')}:00:00`;

      const { data: todayBills, error } = await supabase
        .from('bills_generated_billing')
        .select('total, created_at')
        .eq('franchise_id', 'FR-CENTRAL')
        .gte('created_at', today + 'T00:00:00')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const todayRevenue = (todayBills ?? []).reduce((s, b) => s + Number(b.total || 0), 0);
      const todayOrders = todayBills?.length || 0;
      const currentHourRevenue = (todayBills ?? [])
        .filter((b) => b.created_at >= currentHourStart)
        .reduce((s, b) => s + Number(b.total || 0), 0);

      let status: FRCentralStats['status'] = 'quiet';
      const currentHourOrders = (todayBills ?? []).filter((b) => b.created_at >= currentHourStart).length;
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
      let totalRevenue = 0;

      const agg1 = await supabase
        .from('bills_generated_billing')
        .select('sum_total:sum(total)')
        .eq('franchise_id', 'FR-CENTRAL')
        .maybeSingle();

      if (agg1.data?.sum_total != null) {
        totalRevenue = Number(agg1.data.sum_total);
      } else {
        const agg2 = await supabase
          .from('bills_generated_billing')
          .select('sum_total:sum(total)')
          .eq('franchise_id', 'FR-CENTRAL');

        if (Array.isArray(agg2.data) && agg2.data[0]?.sum_total != null) {
          totalRevenue = Number(agg2.data[0].sum_total);
        } else {
          totalRevenue = await clientSideSumTotal('FR-CENTRAL');
        }
      }

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
    } catch (error) {
      console.error('Error fetching total stats:', error);
    }
  };

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

  // Robust range stats with a client-side fallback sum
  const fetchRangeStats = async (startISO: string, endISO: string) => {
    setRangeLoading(true);
    try {
      let revenue = 0;

      // Try aggregate (single row)
      const sumTry1 = await supabase
        .from('bills_generated_billing')
        .select('sum_total:sum(total)')
        .eq('franchise_id', 'FR-CENTRAL')
        .gte('created_at', startISO)
        .lte('created_at', endISO)
        .maybeSingle();

      if (sumTry1.data?.sum_total != null) {
        revenue = Number(sumTry1.data.sum_total);
      } else {
        // Try aggregate (array row)
        const sumTry2 = await supabase
          .from('bills_generated_billing')
          .select('sum_total:sum(total)')
          .eq('franchise_id', 'FR-CENTRAL')
          .gte('created_at', startISO)
          .lte('created_at', endISO);

        if (Array.isArray(sumTry2.data) && sumTry2.data[0]?.sum_total != null) {
          revenue = Number(sumTry2.data[0].sum_total);
        } else {
          // Final fallback: client-side paginated sum in the range
          revenue = await clientSideRangeSum('FR-CENTRAL', startISO, endISO);
        }
      }

      // Exact order count in the range
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

  // Client-side range sum fallback
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
      {/* Row 1: Total Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
      </div>

      {/* Row 2: Today's Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
      </div>

      {/* ---- Data Deletion Alert (minimal + accurate) ---- */}
      {retentionDays && retentionDays > 0 && cutoffAtNextRunIST && (
        <Card className="border border-red-500 bg-red-50">
          <CardHeader className="flex flex-row items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-700 mt-0.5" />
            <div className="flex-1">
              <CardTitle className="text-base text-red-800">Data deletion warning</CardTitle>

              {/* Window */}
              <p className="text-sm text-red-800 mt-1">
                Retention window: <span className="font-medium">{retentionDays} days</span> • Daily purge time:&nbsp;
                <span className="font-medium">{String(PURGE_HOUR_IST).padStart(2, '0')}:00 IST</span>
              </p>

              {/* Which day + when */}
              <p className="text-sm text-red-800 mt-1">
                {countLoading ? (
                  <>Checking…</>
                ) : countError ? (
                  <>Could not verify eligible rows. Next purge at <span className="font-medium">{formatISTFull(nextPurgeIST)} (IST)</span>.</>
                ) : billsToDeleteCount === 0 ? (
                  <>
                    No data eligible for deletion yet. Next purge at&nbsp;
                    <span className="font-medium">{formatISTFull(nextPurgeIST)} (IST)</span>.
                  </>
                ) : (
                  <>
                    At <span className="font-medium">{formatISTFull(nextPurgeIST)} (IST)</span>, the system will purge
                    rows with <code>created_at &lt; {formatISTFull(cutoffAtNextRunIST)}</code>.&nbsp;
                    Affected (IST calendar day): <span className="font-medium">{affectedBillDayIST}</span>.
                  </>
                )}
              </p>

              {/* Note */}
              <p className="text-xs text-red-900/80 mt-2">
                Note: If you&rsquo;ve already backed up your data, please ignore this message.
              </p>
            </div>
          </CardHeader>
        </Card>
      )}

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
                {/* ... your placeholder insights ... */}
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
