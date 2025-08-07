import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Line, ComposedChart } from 'recharts';
import { Clock, TrendingUp, TrendingDown } from 'lucide-react';

interface HourlyData {
  hour: string;
  revenue: number;
  orders: number;
  displayHour: string;
  isPeakHour: boolean;
  isCurrentHour: boolean;
}

interface PeakHour {
  hour: number;
  revenue: number;
  orders: number;
}

export function HourlySalesChart() {
  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);
  const [peakHours, setPeakHours] = useState<PeakHour[]>([]);
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState<string[]>([]);
  
  const { franchiseId } = useAuth();

  useEffect(() => {
    fetchHourlyData();
  }, [franchiseId]);

  const fetchHourlyData = async () => {
    if (!franchiseId) return;
    
    setLoading(true);
    
    try {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const currentHour = now.getHours();
      
      // Get today's bills
      const { data: bills, error } = await supabase
        .from('bills_generated_billing')
        .select('total, created_at')
        .eq('franchise_id', franchiseId)
        .gte('created_at', today)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Group bills by hour
      const hourlyMap = new Map<number, { revenue: number; orders: number }>();
      
      // Initialize all hours with 0
      for (let hour = 0; hour < 24; hour++) {
        hourlyMap.set(hour, { revenue: 0, orders: 0 });
      }

      // Populate with actual data
      bills?.forEach(bill => {
        const billHour = new Date(bill.created_at).getHours();
        const current = hourlyMap.get(billHour) || { revenue: 0, orders: 0 };
        hourlyMap.set(billHour, {
          revenue: current.revenue + Number(bill.total),
          orders: current.orders + 1,
        });
      });

      // Convert to array format for chart
      const chartData: HourlyData[] = Array.from(hourlyMap.entries()).map(([hour, data]) => ({
        hour: hour.toString().padStart(2, '0'),
        revenue: data.revenue,
        orders: data.orders,
        displayHour: `${hour.toString().padStart(2, '0')}:00`,
        isPeakHour: false, // Will be set below
        isCurrentHour: hour === currentHour,
      }));

      // Find peak hours (top 3 by revenue)
      const peakHoursList = Array.from(hourlyMap.entries())
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 3)
        .map(([hour, data]) => ({ hour, ...data }));

      // Mark peak hours in chart data
      const peakHourNumbers = new Set(peakHoursList.map(p => p.hour));
      chartData.forEach(item => {
        item.isPeakHour = peakHourNumbers.has(parseInt(item.hour));
      });

      // Generate insights
      const totalRevenue = chartData.reduce((sum, item) => sum + item.revenue, 0);
      const totalOrders = chartData.reduce((sum, item) => sum + item.orders, 0);
      const currentHourData = chartData.find(item => item.isCurrentHour);
      
      const newInsights: string[] = [];
      
      if (peakHoursList.length > 0) {
        const topPeakHour = peakHoursList[0];
        newInsights.push(`Peak hour: ${topPeakHour.hour}:00 with ₹${topPeakHour.revenue.toFixed(2)} revenue`);
      }
      
      if (currentHourData && currentHourData.revenue > 0) {
        const avgHourlyRevenue = totalRevenue / 24;
        if (currentHourData.revenue > avgHourlyRevenue * 1.5) {
          newInsights.push(`Current hour is performing 50% above average!`);
        } else if (currentHourData.revenue < avgHourlyRevenue * 0.5) {
          newInsights.push(`Current hour is below average - consider promotions`);
        }
      }
      
      if (totalOrders > 20) {
        newInsights.push(`Great day! ${totalOrders} orders completed so far`);
      }

      setHourlyData(chartData);
      setPeakHours(peakHoursList);
      setInsights(newInsights);
      
    } catch (error: any) {
      console.error('Error fetching hourly data:', error);
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
  };

  if (loading) {
    return <div className="text-center py-8">Loading hourly analytics...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Peak Hours Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {peakHours.map((peak, index) => (
          <Card key={peak.hour} className={index === 0 ? 'border-2 border-primary/20' : ''}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {index === 0 ? 'Top Peak Hour' : `Peak Hour #${index + 1}`}
                  </p>
                  <p className="text-lg font-bold">{peak.hour}:00 - {peak.hour + 1}:00</p>
                  <p className="text-sm text-muted-foreground">{peak.orders} orders</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-primary">₹{peak.revenue.toFixed(2)}</p>
                  {index === 0 && <Badge variant="default">Best</Badge>}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Hourly Sales Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Today's Hourly Sales
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={hourlyData}>
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
                <Line
                  type="monotone"
                  dataKey="orders"
                  stroke="hsl(var(--success))"
                  strokeWidth={2}
                  dot={{ fill: "hsl(var(--success))", strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, stroke: "hsl(var(--success))", strokeWidth: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Insights */}
      {insights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Hourly Insights
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {insights.map((insight, index) => (
                <div key={index} className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                  <div className="w-2 h-2 bg-primary rounded-full"></div>
                  <span className="text-sm">{insight}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}