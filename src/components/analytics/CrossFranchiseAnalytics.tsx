import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { BarChart3, Clock, TrendingUp, Star, Activity, DollarSign } from 'lucide-react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface HourlyData {
  hour: number;
  revenue: number;
  orders: number;
  franchiseCount: number;
}

interface FranchisePerformance {
  franchise_id: string;
  revenue: number;
  orders: number;
  avgOrderValue: number;
  lastActivity: string;
}

interface TopItem {
  item_name: string;
  totalQty: number;
  totalRevenue: number;
  franchiseCount: number;
}

const COLORS = ['hsl(var(--primary))', 'hsl(var(--secondary))', 'hsl(var(--accent))', 'hsl(var(--muted))'];

export function CrossFranchiseAnalytics() {
  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);
  const [topPerformers, setTopPerformers] = useState<FranchisePerformance[]>([]);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalOrders, setTotalOrders] = useState(0);
  const [activeFranchises, setActiveFranchises] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    fetchAnalyticsData();
    
    // Set up real-time subscription
    const channel = supabase
      .channel('cross-franchise-analytics')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bills_generated_billing'
        },
        () => {
          fetchAnalyticsData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchAnalyticsData = async () => {
    try {
      // Fetch today's bills with items
      const { data: bills, error: billsError } = await supabase
        .from('bills_generated_billing')
        .select(`
          id,
          franchise_id,
          total,
          created_at,
          bill_items_generated_billing (
            item_name,
            qty,
            price
          )
        `)
        .gte('created_at', new Date().toISOString().split('T')[0]);

      if (billsError) throw billsError;

      if (bills) {
        processAnalyticsData(bills);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to fetch analytics data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const processAnalyticsData = (bills: any[]) => {
    // Process hourly data
    const hourlyMap = new Map<number, { revenue: number; orders: number; franchises: Set<string> }>();
    
    // Process franchise performance
    const franchiseMap = new Map<string, { revenue: number; orders: number; lastActivity: string }>();
    
    // Process top items
    const itemMap = new Map<string, { qty: number; revenue: number; franchises: Set<string> }>();

    let totalRev = 0;
    let totalOrd = 0;
    const uniqueFranchises = new Set<string>();

    bills.forEach(bill => {
      const hour = new Date(bill.created_at).getHours();
      const revenue = Number(bill.total);
      const franchiseId = bill.franchise_id;

      totalRev += revenue;
      totalOrd += 1;
      uniqueFranchises.add(franchiseId);

      // Hourly data
      const hourData = hourlyMap.get(hour) || { revenue: 0, orders: 0, franchises: new Set() };
      hourData.revenue += revenue;
      hourData.orders += 1;
      hourData.franchises.add(franchiseId);
      hourlyMap.set(hour, hourData);

      // Franchise performance
      const franchiseData = franchiseMap.get(franchiseId) || { revenue: 0, orders: 0, lastActivity: bill.created_at };
      franchiseData.revenue += revenue;
      franchiseData.orders += 1;
      if (new Date(bill.created_at) > new Date(franchiseData.lastActivity)) {
        franchiseData.lastActivity = bill.created_at;
      }
      franchiseMap.set(franchiseId, franchiseData);

      // Process items
      bill.bill_items_generated_billing?.forEach((item: any) => {
        const itemData = itemMap.get(item.item_name) || { qty: 0, revenue: 0, franchises: new Set() };
        itemData.qty += item.qty;
        itemData.revenue += item.qty * Number(item.price);
        itemData.franchises.add(franchiseId);
        itemMap.set(item.item_name, itemData);
      });
    });

    // Convert to arrays
    const hourlyArray = Array.from({ length: 24 }, (_, i) => {
      const data = hourlyMap.get(i) || { revenue: 0, orders: 0, franchises: new Set() };
      return {
        hour: i,
        revenue: data.revenue,
        orders: data.orders,
        franchiseCount: data.franchises.size
      };
    });

    const performanceArray = Array.from(franchiseMap.entries())
      .map(([franchise_id, data]) => ({
        franchise_id,
        revenue: data.revenue,
        orders: data.orders,
        avgOrderValue: data.orders > 0 ? data.revenue / data.orders : 0,
        lastActivity: data.lastActivity
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const itemsArray = Array.from(itemMap.entries())
      .map(([item_name, data]) => ({
        item_name,
        totalQty: data.qty,
        totalRevenue: data.revenue,
        franchiseCount: data.franchises.size
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 10);

    setHourlyData(hourlyArray);
    setTopPerformers(performanceArray);
    setTopItems(itemsArray);
    setTotalRevenue(totalRev);
    setTotalOrders(totalOrd);
    setActiveFranchises(uniqueFranchises.size);
  };

  const currentHour = new Date().getHours();
  const peakHour = hourlyData.reduce((max, curr) => curr.revenue > max.revenue ? curr : max, { hour: 0, revenue: 0 });

  if (loading) {
    return <div className="text-center py-8">Loading cross-franchise analytics...</div>;
  }

  return (
    <div className="space-y-6">
      {/* System Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Today's Revenue</p>
                <p className="text-2xl font-bold">₹{totalRevenue.toFixed(2)}</p>
              </div>
              <div className="p-2 rounded-lg bg-primary">
                <DollarSign className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Orders</p>
                <p className="text-2xl font-bold">{totalOrders}</p>
              </div>
              <div className="p-2 rounded-lg bg-secondary">
                <BarChart3 className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Franchises</p>
                <p className="text-2xl font-bold">{activeFranchises}</p>
              </div>
              <div className="p-2 rounded-lg bg-accent">
                <Activity className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Peak Hour</p>
                <p className="text-2xl font-bold">{peakHour.hour}:00</p>
                <p className="text-xs text-muted-foreground">₹{peakHour.revenue.toFixed(0)}</p>
              </div>
              <div className="p-2 rounded-lg bg-orange-500">
                <Clock className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="hourly" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="hourly">Hourly Sales</TabsTrigger>
          <TabsTrigger value="performance">Top Performers</TabsTrigger>
          <TabsTrigger value="items">Popular Items</TabsTrigger>
        </TabsList>

        <TabsContent value="hourly">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                System-Wide Hourly Sales
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="hour" 
                      tickFormatter={(hour) => `${hour}:00`}
                    />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip 
                      formatter={(value, name) => [
                        name === 'revenue' ? `₹${value}` : value,
                        name === 'revenue' ? 'Revenue' : name === 'orders' ? 'Orders' : 'Active Franchises'
                      ]}
                      labelFormatter={(hour) => `${hour}:00`}
                    />
                    <Bar 
                      yAxisId="left"
                      dataKey="revenue" 
                      fill="hsl(var(--primary))" 
                      name="revenue"
                      fillOpacity={currentHour === hourlyData.find(d => d.hour === currentHour)?.hour ? 1 : 0.7}
                    />
                    <Line 
                      yAxisId="right"
                      type="monotone" 
                      dataKey="orders" 
                      stroke="hsl(var(--secondary))" 
                      strokeWidth={2}
                      name="orders"
                    />
                    <Line 
                      yAxisId="right"
                      type="monotone" 
                      dataKey="franchiseCount" 
                      stroke="hsl(var(--accent))" 
                      strokeWidth={2}
                      name="franchiseCount"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Top Performing Franchises
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {topPerformers.map((franchise, index) => (
                  <div key={franchise.franchise_id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <Badge variant={index === 0 ? "default" : "outline"}>
                        #{index + 1}
                      </Badge>
                      <div>
                        <div className="font-medium">{franchise.franchise_id}</div>
                        <div className="text-sm text-muted-foreground">
                          {franchise.orders} orders • ₹{franchise.avgOrderValue.toFixed(2)} avg
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Last active: {new Date(franchise.lastActivity).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-lg">₹{franchise.revenue.toFixed(2)}</div>
                      <div className="text-sm text-success">
                        {totalRevenue > 0 ? ((franchise.revenue / totalRevenue) * 100).toFixed(1) : 0}% of total
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="items">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="h-5 w-5" />
                System-Wide Popular Items
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {topItems.map((item, index) => (
                  <div key={item.item_name} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <Badge variant={index < 3 ? "default" : "outline"}>
                        #{index + 1}
                      </Badge>
                      <div>
                        <div className="font-medium">{item.item_name}</div>
                        <div className="text-sm text-muted-foreground">
                          Sold in {item.franchiseCount} franchise{item.franchiseCount !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-lg">{item.totalQty} units</div>
                      <div className="text-sm text-success">₹{item.totalRevenue.toFixed(2)}</div>
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