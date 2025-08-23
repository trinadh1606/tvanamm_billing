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

  // Build once so both summary + pie chart use identical bounds
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
      const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const today = istNow.toISOString().split('T')[0];
      const currentHourStart = `${today}T${istNow.getHours().toString().padStart(2, '0')}:00:00`;

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
