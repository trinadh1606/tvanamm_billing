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

      // Helper function to convert 24-hour to 12-hour format with AM/PM
      const formatHour = (hour: number): string => {
        if (hour === 0) return '12:00 AM';
        if (hour === 12) return '12:00 PM';
        if (hour < 12) return `${hour}:00 AM`;
        return `${hour - 12}:00 PM`;
      };

      // Convert to array format for chart
      const chartData: HourlyData[] = Array.from(hourlyMap.entries()).map(([hour, data]) => ({
        hour: hour.toString().padStart(2, '0'),
        revenue: data.revenue,
        orders: data.orders,
        displayHour: formatHour(hour),
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
        const formattedHour = topPeakHour.hour === 0 ? '12:00 AM' : 
                             topPeakHour.hour === 12 ? '12:00 PM' :
                             topPeakHour.hour < 12 ? `${topPeakHour.hour}:00 AM` : 
                             `${topPeakHour.hour - 12}:00 PM`;
        newInsights.push(`Peak hour: ${formattedHour} with ₹${topPeakHour.revenue.toFixed(2)} revenue`);
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
        {/* Your peak hours summary content here */}
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
          <div className="overflow-x-auto">
            <div className="min-w-[800px]"> {/* Set a minimum width to ensure scrolling */}
              <ChartContainer config={chartConfig} className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={hourlyData} margin={{ right: 20 }}>
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
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}