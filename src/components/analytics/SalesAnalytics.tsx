import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { TrendingUp, ShoppingBag, Calendar, IndianRupee } from 'lucide-react';
import { RealTimeAnalytics } from './RealTimeAnalytics';
import { HourlySalesChart } from './HourlySalesChart';
import { PopularItemsLive } from './PopularItemsLive';
import { PredictiveInsights } from './PredictiveInsights';

interface SalesData {
  totalRevenue: number;
  totalBills: number;
  averageOrderValue: number;
  todayRevenue: number;

  // NEW
  totalDiscounts: number;
  todaysBills: number;
  todaysAverageOrderValue: number;
  todaysDiscounts: number;
}

export function SalesAnalytics() {
  const [salesData, setSalesData] = useState<SalesData>({
    totalRevenue: 0,
    totalBills: 0,
    averageOrderValue: 0,
    todayRevenue: 0,

    totalDiscounts: 0,
    todaysBills: 0,
    todaysAverageOrderValue: 0,
    todaysDiscounts: 0,
  });
  const [loading, setLoading] = useState(true);

  const { franchiseId } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!franchiseId) return;
    fetchSalesData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [franchiseId]);

  // Compute "today" in IST and convert to UTC ISO strings for filtering in Postgres
  const getIstDayBoundsUtc = () => {
    const now = new Date();
    const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const y = istNow.getFullYear();
    const m = String(istNow.getMonth() + 1).padStart(2, '0');
    const d = String(istNow.getDate()).padStart(2, '0');
    const startIst = new Date(`${y}-${m}-${d}T00:00:00+05:30`);
    const endIst = new Date(`${y}-${m}-${d}T23:59:59.999+05:30`);
    return { startUtcIso: startIst.toISOString(), endUtcIso: endIst.toISOString() };
  };

  // IMPORTANT: PostgREST default limit = 1000. Sum with pagination to avoid truncation.
  const sumTotalsPaginated = async (filters: {
    franchiseId: string;
    startUtcIso?: string;
    endUtcIso?: string;
  }) => {
    const PAGE = 1000;
    let from = 0;
    let grand = 0;

    while (true) {
      let q = supabase
        .from('bills_generated_billing')
        .select('total', { head: false })
        .eq('franchise_id', filters.franchiseId)
        .range(from, from + PAGE - 1);

      if (filters.startUtcIso) q = q.gte('created_at', filters.startUtcIso);
      if (filters.endUtcIso) q = q.lte('created_at', filters.endUtcIso);

      const { data, error } = await q;
      if (error) throw error;

      const chunkSum = (data ?? []).reduce(
        (s: number, row: { total: any }) => s + Number(row.total ?? 0),
        0
      );
      grand += chunkSum;

      if (!data || data.length < PAGE) break; // last page
      from += PAGE;
    }

    return grand;
  };

  // NEW: sum of qty*price across bill items (pre-discount "Actual" amount), paginated
  const sumItemsAmountPaginated = async (filters: {
    franchiseId: string;
    startUtcIso?: string;
    endUtcIso?: string;
  }) => {
    const PAGE = 1000;
    let from = 0;
    let grand = 0;

    while (true) {
      let q = supabase
        .from('bill_items_generated_billing')
        .select('qty, price, bills_generated_billing!inner(created_at)')
        .eq('franchise_id', filters.franchiseId)
        .range(from, from + PAGE - 1);

      if (filters.startUtcIso) q = q.gte('bills_generated_billing.created_at', filters.startUtcIso);
      if (filters.endUtcIso) q = q.lte('bills_generated_billing.created_at', filters.endUtcIso);

      const { data, error } = await q;
      if (error) throw error;

      const chunkSum = (data ?? []).reduce(
        (s: number, r: any) => s + (Number(r.qty) || 0) * (Number(r.price) || 0),
        0
      );
      grand += chunkSum;

      if (!data || data.length < PAGE) break;
      from += PAGE;
    }

    return grand;
  };

  const fetchSalesData = async () => {
    setLoading(true);
    try {
      // ---- TOTAL BILLS (server-side count; accurate regardless of row limit) ----
      const { count: totalBills, error: countErr } = await supabase
        .from('bills_generated_billing')
        .select('*', { count: 'exact', head: true })
        .eq('franchise_id', franchiseId);

      if (countErr) throw countErr;

      // ---- TOTAL REVENUE (sum with pagination to bypass 1000-row default) ----
      const totalRevenue = await sumTotalsPaginated({ franchiseId });

      // ---- TOTAL "ACTUAL" amount (sum of qty*price across items) ----
      const totalActual = await sumItemsAmountPaginated({ franchiseId });

      const averageOrderValue =
        (totalBills ?? 0) > 0 ? totalRevenue / Number(totalBills) : 0;

      const totalDiscounts = Math.max(0, totalActual - totalRevenue);

      // ---- TODAY (IST) ----
      const { startUtcIso, endUtcIso } = getIstDayBoundsUtc();

      // Today revenue
      const todayRevenue = await sumTotalsPaginated({
        franchiseId,
        startUtcIso,
        endUtcIso,
      });

      // Today bills count
      const { count: todaysBills, error: todayCountErr } = await supabase
        .from('bills_generated_billing')
        .select('*', { count: 'exact', head: true })
        .eq('franchise_id', franchiseId)
        .gte('created_at', startUtcIso)
        .lte('created_at', endUtcIso);
      if (todayCountErr) throw todayCountErr;

      // Today "Actual" amount
      const todayActual = await sumItemsAmountPaginated({
        franchiseId,
        startUtcIso,
        endUtcIso,
      });

      const todaysAverageOrderValue =
        (todaysBills ?? 0) > 0 ? todayRevenue / Number(todaysBills) : 0;

      const todaysDiscounts = Math.max(0, todayActual - todayRevenue);

      setSalesData({
        totalRevenue,
        totalBills: Number(totalBills ?? 0),
        averageOrderValue,
        todayRevenue,

        totalDiscounts,
        todaysBills: Number(todaysBills ?? 0),
        todaysAverageOrderValue,
        todaysDiscounts,
      });
    } catch (error: any) {
      console.error('SalesAnalytics fetch error:', error);
      toast({
        title: 'Error',
        description: error?.message || 'Failed to fetch sales data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const StatCard = ({
    title,
    value,
    icon: Icon,
    color = 'rgb(0,100,55)',
  }: {
    title: string;
    value: string;
    icon: React.ComponentType<{ className?: string }>;
    color?: string;
  }) => (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
          <div className="p-2 rounded-lg" style={{ backgroundColor: color }} aria-hidden="true">
            <Icon className="h-6 w-6 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (loading) return <div className="text-center py-8">Loading analytics...</div>;

  return (
    <div className="space-y-6">
      {/* Quick Stats Overview (TOTALS) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Revenue" value={`₹${salesData.totalRevenue.toFixed(2)}`} icon={IndianRupee} />
        <StatCard title="Total Bills" value={salesData.totalBills.toString()} icon={ShoppingBag} />
        <StatCard title="Average Order Value" value={`₹${salesData.averageOrderValue.toFixed(2)}`} icon={TrendingUp} />
        {/* NEW: Total Discounts */}
        <StatCard title="Total Discounts" value={`₹${salesData.totalDiscounts.toFixed(2)}`} icon={IndianRupee} />
      </div>

      {/* Today's Stats (SECOND ROW) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Today's Revenue" value={`₹${salesData.todayRevenue.toFixed(2)}`} icon={Calendar} />
        <StatCard title="Today's Bills" value={salesData.todaysBills.toString()} icon={ShoppingBag} />
        <StatCard title="Today's Avg Order Value" value={`₹${salesData.todaysAverageOrderValue.toFixed(2)}`} icon={TrendingUp} />
        <StatCard title="Today's Discounts" value={`₹${salesData.todaysDiscounts.toFixed(2)}`} icon={Calendar} />
      </div>

      {/* Advanced Analytics Tabs */}
      <Tabs defaultValue="realtime" className="w-full">
        <TabsList className="grid w-full grid-cols-4 rounded-md" style={{ backgroundColor: 'rgb(0,100,55)' }}>
          <TabsTrigger value="realtime" className="text-white data-[state=active]:bg-white data-[state=active]:text-[rgb(0,100,55)] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[rgb(0,100,55)]">
            Real-Time
          </TabsTrigger>
          <TabsTrigger value="hourly" className="text-white data-[state=active]:bg-white data-[state=active]:text-[rgb(0,100,55)] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[rgb(0,100,55)]">
            Hourly Trends
          </TabsTrigger>
          <TabsTrigger value="items" className="text-white data-[state=active]:bg-white data-[state=active]:text-[rgb(0,100,55)] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[rgb(0,100,55)]">
            Popular Items
          </TabsTrigger>

        </TabsList>

        <TabsContent value="realtime" className="mt-6">
          <RealTimeAnalytics />
        </TabsContent>
        <TabsContent value="hourly" className="mt-6">
          <HourlySalesChart />
        </TabsContent>
        <TabsContent value="items" className="mt-6">
          <PopularItemsLive />
        </TabsContent>
        <TabsContent value="predictions" className="mt-6">
          <PredictiveInsights />
        </TabsContent>
      </Tabs>
    </div>
  );
}
