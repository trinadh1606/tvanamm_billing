import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Lightbulb } from 'lucide-react';

interface BusinessInsight {
  title: string;
  content: string;
  type: 'optimization' | 'growth';
  icon: string;
  color: string;
}

interface ItemTrend {
  item_name: string;
  slope: number;
  intercept: number;
  rSquared: number;
  totalSold: number;
  totalRevenue: number;
  predictedTomorrow: number;
  predictedNext7Total: number;
  predictedNext7Revenue: number;
}

type BillRow = { id: number; created_at: string };
type ItemRow = { item_name: string; qty: number; price: number; bill_id: number };

export function PredictiveInsights() {
  const [insights, setInsights] = useState<BusinessInsight[]>([]);
  const [itemTrends, setItemTrends] = useState<ItemTrend[]>([]);
  const [loading, setLoading] = useState(true);

  const { franchiseId } = useAuth();

  useEffect(() => {
    generateInsights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [franchiseId]);

  const generateInsights = async () => {
    if (!franchiseId) return;
    setLoading(true);
    try {
      // 1) Get all bills for this franchise (we'll use bills.created_at as the time for each item)
      const { data: bills, error: billsErr } = await supabase
        .from('bills_generated_billing')
        .select('id, created_at')
        .eq('franchise_id', franchiseId)
        .order('created_at', { ascending: true });

      if (billsErr) throw billsErr;

      const billList: BillRow[] = bills ?? [];
      if (billList.length === 0) {
        setItemTrends([]);
        setInsights([]);
        setLoading(false);
        return;
      }

      const billIdToCreatedAt = new Map<number, string>(
        billList.map((b) => [b.id, b.created_at])
      );
      const billIds = billList.map((b) => b.id);

      // 2) Fetch items for those bill ids (chunk to avoid IN(...) limits)
      const CHUNK = 1000;
      const allItems: ItemRow[] = [];
      for (let i = 0; i < billIds.length; i += CHUNK) {
        const slice = billIds.slice(i, i + CHUNK);
        const { data: items, error: itemsErr } = await supabase
          .from('bill_items_generated_billing')
          .select('item_name, qty, price, bill_id')
          .in('bill_id', slice);

        if (itemsErr) throw itemsErr;
        if (items?.length) allItems.push(...(items as ItemRow[]));
      }

      // 3) Attach created_at from the parent bill (no need for created_at on items)
      const itemsData = allItems
        .map((it) => {
          const createdAt = billIdToCreatedAt.get(it.bill_id);
          if (!createdAt) return null; // skip if unmatched (shouldn't happen if data is consistent)
          return {
            item_name: it.item_name,
            qty: Number(it.qty) || 0,
            price: Number(it.price) || 0,
            created_at: createdAt,
          };
        })
        .filter(Boolean) as { item_name: string; qty: number; price: number; created_at: string }[];

      const trends = analyzeItemTrends(itemsData);
      setItemTrends(trends);

      const newInsights = generateBusinessInsights(trends);
      setInsights(newInsights);
    } catch (error: any) {
      console.error('Error generating insights:', error);
      setItemTrends([]);
      setInsights([]);
    } finally {
      setLoading(false);
    }
  };

  // Linear regression (with safety guards)
  const linearRegression = (x: number[], y: number[]) => {
    const n = x.length;
    if (n === 0) return { slope: 0, intercept: 0, rSquared: 0 };

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += x[i];
      sumY += y[i];
      sumXY += x[i] * y[i];
      sumXX += x[i] * x[i];
    }

    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) {
      const meanY = sumY / n;
      return { slope: 0, intercept: meanY, rSquared: 0 };
    }

    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    let ssTot = 0, ssRes = 0;
    const meanY = sumY / n;
    for (let i = 0; i < n; i++) {
      const fit = slope * x[i] + intercept;
      ssTot += Math.pow(y[i] - meanY, 2);
      ssRes += Math.pow(y[i] - fit, 2);
    }
    const rSquared = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
    return { slope, intercept, rSquared };
  };

  const analyzeItemTrends = (
    items: { item_name: string; qty: number; price: number; created_at: string }[]
  ): ItemTrend[] => {
    const itemMap = new Map<string, { day: number; qty: number; revenue: number }[]>();

    items.forEach((item) => {
      if (!item.created_at) return; // safety
      const date = new Date(item.created_at);
      const day = Math.floor(date.getTime() / (1000 * 60 * 60 * 24)); // daily bucket
      if (!itemMap.has(item.item_name)) itemMap.set(item.item_name, []);
      itemMap.get(item.item_name)!.push({
        day,
        qty: Number(item.qty) || 0,
        revenue: (Number(item.qty) || 0) * (Number(item.price) || 0),
      });
    });

    const trends: ItemTrend[] = [];

    itemMap.forEach((dailyData, item_name) => {
      const dayMap = new Map<number, { qty: number; revenue: number }>();
      dailyData.forEach((data) => {
        if (!dayMap.has(data.day)) dayMap.set(data.day, { qty: 0, revenue: 0 });
        const existing = dayMap.get(data.day)!;
        dayMap.set(data.day, {
          qty: existing.qty + data.qty,
          revenue: existing.revenue + data.revenue,
        });
      });

      const days = Array.from(dayMap.keys()).sort((a, b) => a - b);
      const quantities = days.map((d) => dayMap.get(d)!.qty);

      if (days.length >= 5) {
        const x = days.map((_d, i) => i); // 0..n-1
        const y = quantities;

        const { slope, intercept, rSquared } = linearRegression(x, y);

        const totalSold = quantities.reduce((sum, q) => sum + q, 0);
        const totalRevenue = days.reduce((sum, d) => sum + dayMap.get(d)!.revenue, 0);
        const avgPrice = totalSold > 0 ? totalRevenue / totalSold : 0;

        const n = x.length;
        const predict = (t: number) => Math.max(0, slope * t + intercept);
        const predictedTomorrow = predict(n);
        const predictedNext7Total = Array.from({ length: 7 }, (_, h) => predict(n + h)).reduce(
          (a, b) => a + b,
          0
        );
        const predictedNext7Revenue = predictedNext7Total * avgPrice;

        trends.push({
          item_name,
          slope,
          intercept,
          rSquared,
          totalSold,
          totalRevenue,
          predictedTomorrow,
          predictedNext7Total,
          predictedNext7Revenue,
        });
      }
    });

    return trends.sort((a, b) => b.slope - a.slope);
  };

  const generateBusinessInsights = (trends: ItemTrend[]): BusinessInsight[] => {
    const insights: BusinessInsight[] = [];

    const topTrending = trends.filter((t) => t.slope > 0 && t.rSquared > 0.5).slice(0, 3);
    const decliningItems = trends.filter((t) => t.slope < -0.5 && t.rSquared > 0.5).slice(0, 3);

    if (topTrending.length > 0) {
      insights.push({
        title: 'Selling Fast',
        content: `Sales are increasing for: ${topTrending
          .map((t) => t.item_name)
          .join(', ')}. Stock up and highlight these on your menu and offers.`,
        type: 'optimization',
        icon: '🔥',
        color: 'success',
      });
    }

    if (decliningItems.length > 0) {
      insights.push({
        title: 'Falling Sales',
        content: `Sales are decreasing for: ${decliningItems
          .map((t) => t.item_name)
          .join(', ')}. Try limited-time deals, combos, or consider replacing them.`,
        type: 'optimization',
        icon: '📉',
        color: 'warning',
      });
    }

    const highValueItems = [...trends].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 3);

    if (highValueItems.length > 0) {
      insights.push({
        title: 'Top Revenue Items',
        content: `These bring in the most money: ${highValueItems
          .map((t) => `${t.item_name} (₹${t.totalRevenue.toFixed(0)})`)
          .join(', ')}. Keep them easy to find and well stocked.`,
        type: 'growth',
        icon: '💰',
        color: 'primary',
      });
    }

    insights.push({
      title: 'Keep Tuning Your Menu',
      content: 'Review trends regularly and adjust prices, bundles, and visibility to boost profit.',
      type: 'growth',
      icon: '📊',
      color: 'secondary',
    });

    return insights;
  };

  const inr = (n: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(n);

  if (loading) {
    return <div className="text-center py-8">Analyzing your sales to date…</div>;
  }

  const predictedLeaders = [...itemTrends]
    .sort((a, b) => b.predictedNext7Total - a.predictedNext7Total)
    .slice(0, 8);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5" />
          AI-Powered Menu Insights
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Insights */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <h4 className="font-semibold text-sm">Suggestions to Improve Sales</h4>
            <div className="space-y-2">
              {insights
                .filter((i) => i.type === 'optimization')
                .map((insight, index) => (
                  <div key={index} className="p-3 bg-success/10 rounded-lg border border-success/20">
                    <p className="text-sm font-medium">
                      {insight.icon} {insight.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{insight.content}</p>
                  </div>
                ))}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-semibold text-sm">Ways to Grow Revenue</h4>
            <div className="space-y-2">
              {insights
                .filter((i) => i.type === 'growth')
                .map((insight, index) => (
                  <div key={index} className="p-3 bg-primary/10 rounded-lg border border-primary/20">
                    <p className="text-sm font-medium">
                      {insight.icon} {insight.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{insight.content}</p>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Forecasts Table */}
        <div className="mt-6">
          <h4 className="font-semibold text-sm mb-2">Forecasts for the Next 7 Days</h4>
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Item</th>
                  <th className="text-right px-3 py-2 font-medium">Trend Confidence (R²)</th>
                  <th className="text-right px-3 py-2 font-medium">Tomorrow (units)</th>
                  <th className="text-right px-3 py-2 font-medium">Next 7 days (units)</th>
                  <th className="text-right px-3 py-2 font-medium">Estimated revenue (next 7 days)</th>
                </tr>
              </thead>
              <tbody>
                {predictedLeaders.map((t) => (
                  <tr key={t.item_name} className="border-t">
                    <td className="px-3 py-2">{t.item_name}</td>
                    <td className="px-3 py-2 text-right">{t.rSquared.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{Math.round(t.predictedTomorrow)}</td>
                    <td className="px-3 py-2 text-right">{Math.round(t.predictedNext7Total)}</td>
                    <td className="px-3 py-2 text-right">{inr(t.predictedNext7Revenue)}</td>
                  </tr>
                ))}
                {predictedLeaders.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                      Not enough data to make forecasts yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Forecasts are based on all your available sales data up to today. 
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default PredictiveInsights;
