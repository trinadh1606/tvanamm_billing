import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { Store, Clock, TrendingUp, Zap, Activity, Star, Target } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

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

  useEffect(() => {
    if (franchiseId) {
      fetchFranchiseAnalytics();
    }
  }, [franchiseId]);

  const fetchFranchiseAnalytics = async () => {
    setLoading(true);
    
    try {
      // Get current IST date for accurate filtering
      const now = new Date();
      const istNow = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
      const today = istNow.toISOString().split('T')[0];
      const currentHour = istNow.getHours();

      console.log(`Fetching ${franchiseId} analytics for IST date: ${today}, current IST hour: ${currentHour}`);

      // Get today's bills for this franchise with IST timezone
      const { data: todayBills, error: billsError } = await supabase
        .from('bills_generated_billing')
        .select('total, created_at')
        .eq('franchise_id', franchiseId)
        .gte('created_at', `${today}T00:00:00`)
        .lt('created_at', `${today}T23:59:59`)
        .order('created_at', { ascending: false });

      if (billsError) {
        console.error('Bills fetch error:', billsError);
        throw billsError;
      }

      console.log(`Found ${todayBills?.length || 0} bills for ${franchiseId} today`);

      // Get today's items for this franchise by joining with bills table
      const { data: todayItems, error: itemsError } = await supabase
        .from('bill_items_generated_billing')
        .select(`
          item_name, 
          qty, 
          price,
          bill_id,
          bills_generated_billing!inner(created_at)
        `)
        .eq('franchise_id', franchiseId)
        .gte('bills_generated_billing.created_at', `${today}T00:00:00`)
        .lt('bills_generated_billing.created_at', `${today}T23:59:59`);

      if (itemsError) throw itemsError;

      // Calculate basic stats
      const todayRevenue = todayBills?.reduce((sum, bill) => sum + Number(bill.total), 0) || 0;
      const todayOrders = todayBills?.length || 0;
      const averageOrderValue = todayOrders > 0 ? todayRevenue / todayOrders : 0;

      // Calculate hourly data
      const hourlyMap = new Map<number, { revenue: number; orders: number }>();
      
      // Initialize all hours with 0
      for (let hour = 0; hour < 24; hour++) {
        hourlyMap.set(hour, { revenue: 0, orders: 0 });
      }

      // Populate with actual data using IST timezone
      todayBills?.forEach(bill => {
        // Convert UTC time to IST for proper hourly grouping
        const utcDate = new Date(bill.created_at);
        const istDate = new Date(utcDate.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
        const billHour = istDate.getHours();
        const current = hourlyMap.get(billHour) || { revenue: 0, orders: 0 };
        hourlyMap.set(billHour, {
          revenue: current.revenue + Number(bill.total),
          orders: current.orders + 1,
        });
      });

      // Find peak hour
      const peakHour = Array.from(hourlyMap.entries())
        .sort((a, b) => b[1].orders - a[1].orders)[0]?.[0] || 0;

      // Determine status based on current hour activity
      const currentHourOrders = hourlyMap.get(currentHour)?.orders || 0;
      let status: FranchiseStats['status'] = 'quiet';
      if (currentHourOrders >= 10) {
        status = 'very-busy';
      } else if (currentHourOrders >= 5) {
        status = 'busy';
      } else if (currentHourOrders >= 2) {
        status = 'normal';
      }

      // Convert hourly data to chart format
      const chartData: HourlyData[] = Array.from(hourlyMap.entries()).map(([hour, data]) => ({
        hour: hour.toString().padStart(2, '0'),
        revenue: data.revenue,
        orders: data.orders,
        displayHour: `${hour.toString().padStart(2, '0')}:00`,
      }));

      // Calculate popular items
      const itemMap = new Map<string, { quantity: number; revenue: number }>();
      todayItems?.forEach(item => {
        const current = itemMap.get(item.item_name) || { quantity: 0, revenue: 0 };
        itemMap.set(item.item_name, {
          quantity: current.quantity + item.qty,
          revenue: current.revenue + (item.qty * Number(item.price)),
        });
      });

      const totalItemQuantity = Array.from(itemMap.values()).reduce((sum, item) => sum + item.quantity, 0);

      const itemsArray: PopularItem[] = Array.from(itemMap.entries())
        .map(([name, data]) => ({
          item_name: name,
          quantity: data.quantity,
          revenue: data.revenue,
          percentage: totalItemQuantity > 0 ? (data.quantity / totalItemQuantity) * 100 : 0,
        }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10);

      setStats({
        todayRevenue,
        todayOrders,
        averageOrderValue,
        peakHour,
        status,
        lastActivity: todayBills?.[0]?.created_at || null,
      });

      setHourlyData(chartData);
      setPopularItems(itemsArray);

    } catch (error) {
      console.error('Error fetching franchise analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: FranchiseStats['status']) => {
    switch (status) {
      case 'very-busy': return 'bg-destructive text-destructive-foreground';
      case 'busy': return 'bg-warning text-warning-foreground';
      case 'normal': return 'bg-success text-success-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusMessage = (status: FranchiseStats['status']) => {
    switch (status) {
      case 'very-busy': return 'VERY BUSY! 🔥';
      case 'busy': return 'Busy Period 📈';
      case 'normal': return 'Normal Activity';
      default: return 'Quiet Period';
    }
  };

  const formatTimeAgo = (dateString: string | null) => {
    if (!dateString) return 'No activity today';
    
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (diffHours > 0) {
      return `${diffHours}h ${diffMins}m ago`;
    }
    return `${diffMins}m ago`;
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

  const pieColors = [
    'hsl(var(--primary))',
    'hsl(var(--success))',
    'hsl(var(--warning))',
    'hsl(var(--secondary))',
    'hsl(var(--destructive))',
  ];

  if (loading) {
    return <div className="text-center py-8">Loading {franchiseId} analytics...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Franchise Header */}
      <Card className="border-2 border-primary/20">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-secondary/10">
                <Store className="h-8 w-8 text-secondary" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">{franchiseId} Analytics</h2>
                <p className="text-muted-foreground">
                  Individual franchise performance • Last activity: {formatTimeAgo(stats.lastActivity)}
                </p>
              </div>
            </div>
            <Badge className={getStatusColor(stats.status)}>
              {getStatusMessage(stats.status)}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Today's Revenue</p>
                <p className="text-2xl font-bold">₹{stats.todayRevenue.toFixed(2)}</p>
              </div>
              <TrendingUp className="h-6 w-6 text-success" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Today's Orders</p>
                <p className="text-2xl font-bold">{stats.todayOrders}</p>
              </div>
              <Activity className="h-6 w-6 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg Order Value</p>
                <p className="text-2xl font-bold">₹{stats.averageOrderValue.toFixed(2)}</p>
              </div>
              <Target className="h-6 w-6 text-warning" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Peak Hour</p>
                <p className="text-2xl font-bold">{stats.peakHour}:00</p>
              </div>
              <Clock className="h-6 w-6 text-secondary" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Analytics */}
      <Tabs defaultValue="hourly" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="hourly">Hourly Performance</TabsTrigger>
          <TabsTrigger value="items">Popular Items</TabsTrigger>
        </TabsList>
        
        <TabsContent value="hourly">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Today's Hourly Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyData}>
                    <XAxis 
                      dataKey="displayHour" 
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis 
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `₹${value}`}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="revenue"
                      fill="hsl(var(--primary))"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="items">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Popular Items Bar Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Star className="h-5 w-5" />
                  Top Items by Quantity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={popularItems} layout="horizontal">
                      <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis 
                        type="category" 
                        dataKey="item_name" 
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={10}
                        width={80}
                        tickFormatter={(value) => value.length > 12 ? value.substring(0, 12) + '...' : value}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar
                        dataKey="quantity"
                        fill="hsl(var(--secondary))"
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Items Pie Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Sales Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={popularItems.slice(0, 5)}
                        dataKey="revenue"
                        nameKey="item_name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ item_name, percentage }) => `${item_name} ${percentage.toFixed(1)}%`}
                        labelLine={false}
                      >
                        {popularItems.slice(0, 5).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={pieColors[index % pieColors.length]} />
                        ))}
                      </Pie>
                      <ChartTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Items List */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Detailed Item Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {popularItems.map((item, index) => (
                  <div key={item.item_name} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-secondary/10 rounded-full flex items-center justify-center">
                        <span className="text-sm font-bold text-secondary">#{index + 1}</span>
                      </div>
                      <div>
                        <span className="font-medium">{item.item_name}</span>
                        <div className="text-xs text-muted-foreground">
                          {item.percentage.toFixed(1)}% of total sales
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">{item.quantity} sold</div>
                      <div className="text-sm text-muted-foreground">₹{item.revenue.toFixed(2)}</div>
                    </div>
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