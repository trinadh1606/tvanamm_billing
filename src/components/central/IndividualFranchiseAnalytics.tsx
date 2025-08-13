import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Store, Clock, TrendingUp, Zap, Activity, Target, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { DateRange } from 'react-day-picker';
import { addDays, format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';

interface IndividualFranchiseAnalyticsProps {
  franchiseId: string;
}

interface FranchiseStats {
  todayRevenue: number;
  todayOrders: number;
  averageOrderValue: number;
  peakHour: number;
  status: 'quiet' | 'normal' | 'busy' | 'very-busy';
  lastActivity: string | null;
}

interface HourlyData {
  hour: string;
  revenue: number;
  orders: number;
  displayHour: string;
}

interface PopularItem {
  item_name: string;
  quantity: number;
  revenue: number;
  percentage: number;
  color?: string;
}

export function IndividualFranchiseAnalytics({ franchiseId }: IndividualFranchiseAnalyticsProps) {
  const [stats, setStats] = useState<FranchiseStats>({
    todayRevenue: 0,
    todayOrders: 0,
    averageOrderValue: 0,
    peakHour: 0,
    status: 'quiet',
    lastActivity: null,
  });
  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);
  const [popularItems, setPopularItems] = useState<PopularItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(),
    to: addDays(new Date(), 0),
  });

  const pieColors = [
    'hsl(var(--primary))',
    'hsl(var(--success))',
    'hsl(var(--warning))',
    'hsl(var(--secondary))',
    'hsl(var(--destructive))',
    '#8884d8',
    '#82ca9d',
    '#ffc658',
    '#ff8042',
    '#a4de6c',
  ];

  useEffect(() => {
    if (franchiseId) {
      fetchFranchiseAnalytics();
    }
  }, [franchiseId, dateRange]);

  const fetchFranchiseAnalytics = async () => {
    setLoading(true);

    try {
      const now = new Date();
      const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const today = istNow.toISOString().split('T')[0];
      const currentHour = istNow.getHours();

      const fromDate = dateRange?.from ?
        new Date(dateRange.from.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })) :
        new Date(today);
      const toDate = dateRange?.to ?
        new Date(dateRange.to.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })) :
        new Date(today);

      const fromDateStr = fromDate.toISOString().split('T')[0];
      const toDateStr = toDate.toISOString().split('T')[0];

      // Fetch bills data
      const { data: bills, error: billsError } = await supabase
        .from('bills_generated_billing')
        .select('total, created_at')
        .eq('franchise_id', franchiseId)
        .gte('created_at', `${fromDateStr}T00:00:00`)
        .lte('created_at', `${toDateStr}T23:59:59`)
        .order('created_at', { ascending: false });

      if (billsError) throw billsError;

      // Fetch ALL items for the franchise in date range
      const { data: items, error: itemsError } = await supabase
        .from('bill_items_generated_billing')
        .select(`
          item_name, 
          qty, 
          price,
          bill_id,
          bills_generated_billing!inner(created_at)
        `)
        .eq('franchise_id', franchiseId)
        .gte('bills_generated_billing.created_at', `${fromDateStr}T00:00:00`)
        .lte('bills_generated_billing.created_at', `${toDateStr}T23:59:59`);

      if (itemsError) throw itemsError;

      // Calculate basic stats
      const todayRevenue = bills?.reduce((sum, bill) => sum + Number(bill.total), 0) || 0;
      const todayOrders = bills?.length || 0;
      const averageOrderValue = todayOrders > 0 ? todayRevenue / todayOrders : 0;

      // Process hourly data
      const hourlyMap = new Map<number, { revenue: number; orders: number }>();
      for (let hour = 0; hour < 24; hour++) {
        hourlyMap.set(hour, { revenue: 0, orders: 0 });
      }

      if (!dateRange?.to || dateRange.from?.toDateString() === dateRange.to?.toDateString()) {
        bills?.forEach(bill => {
          const utcDate = new Date(bill.created_at);
          const istDate = new Date(utcDate.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
          const billHour = istDate.getHours();
          const current = hourlyMap.get(billHour) || { revenue: 0, orders: 0 };
          hourlyMap.set(billHour, {
            revenue: current.revenue + Number(bill.total),
            orders: current.orders + 1,
          });
        });
      }

      const peakHour = Array.from(hourlyMap.entries())
        .sort((a, b) => b[1].orders - a[1].orders)[0]?.[0] || 0;

      let status: FranchiseStats['status'] = 'quiet';
      if (fromDateStr === today && toDateStr === today) {
        const currentHourOrders = hourlyMap.get(currentHour)?.orders || 0;
        if (currentHourOrders >= 10) status = 'very-busy';
        else if (currentHourOrders >= 5) status = 'busy';
        else if (currentHourOrders >= 2) status = 'normal';
      }

      const chartData: HourlyData[] = Array.from(hourlyMap.entries()).map(([hour, data]) => ({
        hour: hour.toString().padStart(2, '0'),
        revenue: data.revenue,
        orders: data.orders,
        displayHour: `${hour.toString().padStart(2, '0')}:00`,
      }));

      // Process ALL items (no limit)
      const itemMap = new Map<string, { quantity: number; revenue: number }>();
      items?.forEach(item => {
        const current = itemMap.get(item.item_name) || { quantity: 0, revenue: 0 };
        itemMap.set(item.item_name, {
          quantity: current.quantity + item.qty,
          revenue: current.revenue + (item.qty * Number(item.price)),
        });
      });

      const totalItemRevenue = Array.from(itemMap.values()).reduce((sum, item) => sum + item.revenue, 0);

      const itemsArray: PopularItem[] = Array.from(itemMap.entries())
        .map(([name, data], index) => ({
          item_name: name,
          quantity: data.quantity,
          revenue: data.revenue,
          percentage: totalItemRevenue > 0 ? (data.revenue / totalItemRevenue) * 100 : 0,
          color: pieColors[index % pieColors.length],
        }))
        .sort((a, b) => b.revenue - a.revenue); // Sort by revenue descending

      setStats({
        todayRevenue,
        todayOrders,
        averageOrderValue,
        peakHour,
        status,
        lastActivity: bills?.[0]?.created_at || null,
      });

      setHourlyData(chartData);
      setPopularItems(itemsArray);

    } catch (error) {
      console.error('Error fetching franchise analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const chartConfig = {
    revenue: {
      label: "Revenue",
      color: "hsl(var(--primary))",
    },
    orders: {
      label: "Orders",
      color: "hsl(var(--success))",
    },
    quantity: {
      label: "Quantity",
      color: "hsl(var(--secondary))",
    },
  };

  if (loading) {
    return <div className="text-center py-8">Loading {franchiseId} analytics...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Date Range</p>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="date"
                      variant={"outline"}
                      className="w-full justify-start text-left font-normal"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRange?.from ? (
                        dateRange.to ? (
                          <>
                            {format(dateRange.from, "LLL dd, y")} -{" "}
                            {format(dateRange.to, "LLL dd, y")}
                          </>
                        ) : (
                          format(dateRange.from, "LLL dd, y")
                        )
                      ) : (
                        <span>Pick a date</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <CalendarComponent
                      initialFocus
                      mode="range"
                      defaultMonth={dateRange?.from}
                      selected={dateRange}
                      onSelect={setDateRange}
                      numberOfMonths={2}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <Calendar className="h-6 w-6 text-info" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="items" className="w-full">
        <TabsContent value="items">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Sales Distribution (All Items)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={popularItems}
                        dataKey="revenue"
                        nameKey="item_name"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        innerRadius={30}
                        paddingAngle={2}
                        label={({ name, percent }) => 
                          percent > 0.05 ? `${name}: ${(percent * 100).toFixed(1)}%` : ''}
                      >
                        {popularItems.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={entry.color || pieColors[index % pieColors.length]} 
                          />
                        ))}
                      </Pie>
                      <ChartTooltip 
                        formatter={(value, name, props) => [
                          `₹${value.toLocaleString()}`, 
                          `${name} (${props.payload.quantity} sold)`
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Detailed Item Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {popularItems.map((item, index) => (
                  <div key={item.item_name} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                      <div>
                        <span className="font-medium">{item.item_name}</span>
                        <div className="text-xs text-muted-foreground">
                          {item.percentage.toFixed(1)}% of total sales (₹{item.revenue.toLocaleString()})
                        </div>
                      </div>
                    </div>
                    <div className="text-right font-bold">{item.quantity} sold</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}