'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { ChartContainer } from '@/components/ui/chart';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from 'recharts';
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

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const formatHour = (hour: number): string => {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
};

function getDayBoundsISO(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return { startISO: start.toISOString(), nextISO: next.toISOString() };
}

export function HourlySalesChart() {
  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);
  const [peakHours, setPeakHours] = useState<PeakHour[]>([]);
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState<string[]>([]);
  const [showRevenue, setShowRevenue] = useState(true);
  const [showOrders, setShowOrders] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { franchiseId } = useAuth();

  useEffect(() => {
    fetchHourlyData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [franchiseId]);

  const fetchHourlyData = async () => {
    if (!franchiseId) return;
    setLoading(true);
    setError(null);

    try {
      const now = new Date();
      const currentHour = now.getHours();
      const { startISO, nextISO } = getDayBoundsISO(now);

      const { data: bills, error } = await supabase
        .from('bills_generated_billing')
        .select('total, created_at')
        .eq('franchise_id', franchiseId)
        .gte('created_at', startISO)
        .lt('created_at', nextISO)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const byHour = new Map<number, { revenue: number; orders: number }>();
      for (let h = 0; h < 24; h++) byHour.set(h, { revenue: 0, orders: 0 });

      bills?.forEach((b: { total: number | string; created_at: string }) => {
        const h = new Date(b.created_at).getHours();
        const cur = byHour.get(h)!;
        byHour.set(h, {
          revenue: cur.revenue + Number(b.total ?? 0),
          orders: cur.orders + 1,
        });
      });

      const chartData: HourlyData[] = Array.from(byHour.entries()).map(([hour, data]) => ({
        hour: hour.toString().padStart(2, '0'),
        revenue: data.revenue,
        orders: data.orders,
        displayHour: formatHour(hour),
        isPeakHour: false,
        isCurrentHour: hour === currentHour,
      }));

      const peakHoursList: PeakHour[] = Array.from(byHour.entries())
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 3)
        .map(([hour, data]) => ({ hour, revenue: data.revenue, orders: data.orders }));

      const peakSet = new Set(peakHoursList.map(p => p.hour));
      chartData.forEach(d => (d.isPeakHour = peakSet.has(parseInt(d.hour))));

      const totalRevenue = chartData.reduce((s, d) => s + d.revenue, 0);
      const totalOrders = chartData.reduce((s, d) => s + d.orders, 0);
      const currentHourData = chartData.find(d => d.isCurrentHour);
      const avgHourlyRevenue = totalRevenue / 24;

      const newInsights: string[] = [];
      if (peakHoursList.length && peakHoursList[0].revenue > 0) {
        const top = peakHoursList[0];
        newInsights.push(`Peak hour: ${formatHour(top.hour)} with ${inr.format(top.revenue)} revenue`);
      }
      if (currentHourData && currentHourData.revenue > 0) {
        if (currentHourData.revenue > avgHourlyRevenue * 1.5) {
          newInsights.push(`Current hour is performing 50%+ above average`);
        } else if (currentHourData.revenue < avgHourlyRevenue * 0.5) {
          newInsights.push(`Current hour is below average — consider a quick promo`);
        }
      }
      if (totalOrders > 20) newInsights.push(`Great day! ${totalOrders} orders so far`);

      setHourlyData(chartData);
      setPeakHours(peakHoursList);
      setInsights(newInsights);
    } catch (e: any) {
      console.error(e);
      setError(e.message ?? 'Failed to load hourly analytics');
    } finally {
      setLoading(false);
    }
  };

  const avgRevenue = useMemo(
    () => (hourlyData.length ? hourlyData.reduce((s, d) => s + d.revenue, 0) / 24 : 0),
    [hourlyData]
  );

  const chartConfig = {
    revenue: { label: 'Revenue', color: 'hsl(var(--primary))' },
    orders: { label: 'Orders', color: 'hsl(var(--success))' },
  };

  if (loading) {
    return <div className="text-center py-8 text-sm text-muted-foreground">Loading hourly analytics…</div>;
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Couldn't load analytics</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{error}</CardContent>
      </Card>
    );
  }

  const hasData = hourlyData.some(d => d.revenue > 0 || d.orders > 0);

  // Increased spacing between columns
  const PX_PER_HOUR = 80; // Reduced from 240 to allow more natural spacing
  const minInnerWidth = Math.max(1200, hourlyData.length * PX_PER_HOUR);

  return (
    <div className="space-y-6">
      {/* Peak Hours + Quick Insights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {peakHours.map((p, idx) => (
          <Card key={p.hour}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                {idx === 0 ? <TrendingUp className="h-4 w-4 text-emerald-600" /> : <TrendingDown className="h-4 w-4 text-muted-foreground" />}
                Peak #{idx + 1}: {formatHour(p.hour)}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-sm">
              <div>
                <div className="text-muted-foreground">Revenue</div>
                <div className="font-medium">{inr.format(p.revenue)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Orders</div>
                <div className="font-medium">{p.orders}</div>
              </div>
              <Badge variant="outline">Hour {p.hour.toString().padStart(2, '0')}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Series:</span>
        <Button
          size="sm"
          variant={showRevenue ? 'default' : 'outline'}
          onClick={() => setShowRevenue(v => !v)}
        >
          ₹ Revenue
        </Button>
        <Button
          size="sm"
          variant={showOrders ? 'default' : 'outline'}
          onClick={() => setShowOrders(v => !v)}
        >
          Orders
        </Button>
        <Badge variant="secondary" className="ml-auto">
          Avg revenue: {inr.format(Math.round(avgRevenue))}
        </Badge>
      </div>

      {/* Chart with improved spacing */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Today's Hourly Sales
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasData ? (
            <div className="text-sm text-muted-foreground py-8">No bills for today yet.</div>
          ) : (
            <div className="overflow-x-auto pb-2">
              <div style={{ minWidth: minInnerWidth }}>
                <ChartContainer config={chartConfig} className="h-[520px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={hourlyData}
                      margin={{ left: 24, right: 40, top: 18, bottom: 60 }} // Increased bottom margin
                    >
                      <defs>
                        <pattern id="stripe" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                          <rect width="3" height="6" fill="hsl(var(--primary))" />
                        </pattern>
                        <linearGradient id="currentHourGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="1" />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.6" />
                        </linearGradient>
                      </defs>

                      <CartesianGrid strokeDasharray="3 3" vertical={false} />

                      {/* X-axis with better spacing */}
                      <XAxis
                        dataKey="displayHour"
                        stroke="hsl(var(--muted-foreground))"
                        tick={{ fontSize: 12 }}
                        tickMargin={20} // Reduced tick margin
                        tickLine={false}
                        axisLine={false}
                        interval={0}
                        height={60}
                        angle={-45} // Angle labels to prevent overlapping
                        textAnchor="end"
                        padding={{ left: 20, right: 20 }}
                      />

                      {/* Y-axes */}
                      <YAxis
                        yAxisId="left"
                        width={92}
                        stroke="hsl(var(--muted-foreground))"
                        tick={{ fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => inr.format(Math.round(v))}
                        hide={!showRevenue}
                      />
                      <YAxis
                        yAxisId="right"
                        width={70}
                        orientation="right"
                        stroke="hsl(var(--muted-foreground))"
                        tick={{ fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                        hide={!showOrders}
                      />

                      {showRevenue && avgRevenue > 0 && (
                        <ReferenceLine
                          yAxisId="left"
                          y={avgRevenue}
                          stroke="hsl(var(--muted-foreground))"
                          strokeDasharray="4 4"
                          label={{
                            value: `Avg ${inr.format(Math.round(avgRevenue))}`,
                            position: 'right',
                            fontSize: 11,
                            fill: 'hsl(var(--muted-foreground))',
                          }}
                        />
                      )}

                      <Tooltip
                        contentStyle={{
                          borderRadius: 8,
                          border: '1px solid hsl(var(--border))',
                          background: 'hsl(var(--popover))',
                        }}
                        formatter={(value: any, name: string) => {
                          if (name === 'revenue') return [inr.format(Math.round(value)), 'Revenue'];
                          if (name === 'orders') return [value, 'Orders'];
                          return [value, name];
                        }}
                        labelFormatter={(label: any) => `Hour: ${label}`}
                      />
                      <Legend />

                      {showRevenue && (
                        <Bar
                          yAxisId="left"
                          dataKey="revenue"
                          name="revenue"
                          radius={[6, 6, 0, 0]}
                          barSize={32} // Increased bar size for better visibility
                        >
                          {hourlyData.map((d, i) => {
                            const fill = d.isCurrentHour
                              ? 'url(#currentHourGrad)'
                              : d.isPeakHour
                              ? 'url(#stripe)'
                              : 'hsl(var(--primary))';
                            return <Cell key={i} fill={fill} opacity={d.isPeakHour || d.isCurrentHour ? 1 : 0.9} />;
                          })}
                        </Bar>
                      )}

                      {showOrders && (
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="orders"
                          name="orders"
                          stroke="hsl(var(--success))"
                          strokeWidth={2}
                          dot={{ fill: 'hsl(var(--success))', strokeWidth: 2, r: 3 }}
                          activeDot={{ r: 6, stroke: 'hsl(var(--success))', strokeWidth: 2 }}
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {insights.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {insights.map((i, idx) => (
            <Badge key={idx} variant="secondary">{i}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}