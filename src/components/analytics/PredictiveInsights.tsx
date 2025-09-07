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

// Row shape when joining items -> bills for created_at
type ItemJoinRow = {
  item_name: string | null;
  qty: number | null;
  price: number | null;
  bills_generated_billing: { created_at: string } | null;
};

// Tunable thresholds so you can surface suggestions earlier
const MIN_DAYS_FOR_TREND = 3;      // was 5
const MIN_R2_CONFIDENCE = 0.2;     // was 0.5
const DECLINE_SLOPE = -0.2;        // was -0.5

export function PredictiveInsights() {
  const [insights, setInsights] = useState<BusinessInsight[]>([]);
  const [itemTrends, setItemTrends] = useState<ItemTrend[]>([]);
  const [loading, setLoading] = useState(true);

  const { franchiseId } = useAuth();

  useEffect(() => {
    if (!franchiseId) return;
    generateInsights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [franchiseId]);

  // Build an IST day key like "YYYY-MM-DD" from an ISO timestamp
  const istDayKey = (iso: string) => {
    const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const generateInsights = async () => {
    setLoading(true);
    try {
      // ---- PAGE THROUGH ALL ITEMS, JOIN BILLS FOR created_at, FILTER BY FRANCHISE ON BILLS ----
      const PAGE = 1000;
      let from = 0;
      const allRows: ItemJoinRow[] = [];

      while (true) {
        // Join items -> bills to get created_at and franchise filter; no IN(...) needed
        let q = supabase
          .from('bill_items_generated_billing')
          .select(
            `
              item_name,
              qty,
              price,
              bills_generated_billing!inner(created_at, franchise_id)
            `,
            { head: false }
          )
          .eq('bills_generated_billing.franchise_id', franchiseId)
          // order by the joined table's created_at so pagination is deterministic
          .order('created_at', {
            referencedTable: 'bills_generated_billing',
            ascending: true,
          })
          .range(from, from + PAGE - 1);

        const { data, error } = await q;
        if (error) throw error;

        const batch = (data ?? []) as unknown as ItemJoinRow[];
        allRows.push(...batch);

        if (!batch || batch.length < PAGE) break;
        from += PAGE;
      }

      if (allRows.length === 0) {
        setItemTrends([]);
        setInsights([
          {
            title: 'No sales data yet',
            content: 'Start generating bills to unlock AI insights for your menu.',
            type: 'growth',
            icon: '🗂️',
            color: 'secondary',
          },
        ]);
        setLoading(false);
        return;
      }

      // ---- STRUCTURE DATA WITH IST-DAY BUCKETS ----
      // Normalize rows and keep only those with valid join info
      const normalized = allRows
        .map((r) => {
          const created_at = r.bills_generated_billing?.created_at;
          if (!created_at || !r.item_name) return null;
          return {
            item_name: r.item_name,
            qty: Number(r.qty ?? 0),
            price: Number(r.price ?? 0),
            created_at,
          };
        })
        .filter(Boolean) as { item_name: string; qty: number; price: number; created_at: string }[];

      const trends = analyzeItemTrends(normalized, istDayKey);
      setItemTrends(trends);

      const newInsights = generateBusinessInsights(trends);
      setInsights(newInsights);
    } catch (error) {
      console.error('PredictiveInsights error:', error);
      setItemTrends([]);
      setInsights([
        {
          title: 'Could not load insights',
          content: 'Please refresh the page. If the issue persists, check your Supabase RLS policies.',
          type: 'optimization',
          icon: '⚠️',
          color: 'warning',
        },
      ]);
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

  // Make trends using IST day buckets
  const analyzeItemTrends = (
    items: { item_name: string; qty: number; price: number; created_at: string }[],
    dayKeyFn: (iso: string) => string
  ): ItemTrend[] => {
    // item -> dayKey -> { qty: number; revenue: number }
    const bucket = new Map<string, Map<string, { qty: number; revenue: number }>>();

    items.forEach((it) => {
      const key = dayKeyFn(it.created_at);
      if (!bucket.has(it.item_name)) bucket.set(it.item_name, new Map());
      const dayMap = bucket.get(it.item_name)!;
      const prev = dayMap.get(key) || { qty: 0, revenue: 0 };
      dayMap.set(key, {
        qty: prev.qty + (Number(it.qty) || 0),
        revenue: prev.revenue + (Number(it.qty) || 0) * (Number(it.price) || 0),
      });
    });

    const trends: ItemTrend[] = [];

    for (const [item_name, dayMap] of bucket.entries()) {
      // Sort days chronologically
      const days = Array.from(dayMap.keys()).sort();
      if (days.length < MIN_DAYS_FOR_TREND) continue; // need enough points for a line

      const quantities = days.map((d) => dayMap.get(d)!.qty);
      const revenues = days.map((d) => dayMap.get(d)!.revenue);

      // Create x = 0..n-1 for regression on the ordered days
      const x = days.map((_d, i) => i);
      const y = quantities;
      const { slope, intercept, rSquared } = linearRegression(x, y);

      const totalSold = quantities.reduce((s, q) => s + q, 0);
      const totalRevenue = revenues.reduce((s, r) => s + r, 0);
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

    // Sort by upward trend
    return trends.sort((a, b) => b.slope - a.slope);
  };

  const generateBusinessInsights = (trends: ItemTrend[]): BusinessInsight[] => {
    const insights: BusinessInsight[] = [];

    const topTrending = trends
      .filter((t) => t.slope > 0 && t.rSquared >= MIN_R2_CONFIDENCE)
      .slice(0, 3);

    const decliningItems = trends
      .filter((t) => t.slope <= DECLINE_SLOPE && t.rSquared >= MIN_R2_CONFIDENCE)
      .slice(0, 3);

    if (topTrending.length > 0) {
      insights.push({
        title: 'Selling Fast',
        content: `Sales are increasing for: ${topTrending.map((t) => t.item_name).join(', ')}. Stock up and highlight these on your menu and offers.`,
        type: 'optimization',
        icon: '🔥',
        color: 'success',
      });
    }

    if (decliningItems.length > 0) {
      insights.push({
        title: 'Falling Sales',
        content: `Sales are decreasing for: ${decliningItems.map((t) => t.item_name).join(', ')}. Try limited-time deals, combos, or consider replacing them.`,
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

    // Fallback if nothing met thresholds — ensures the section shows something helpful
    if (insights.length === 0) {
      insights.push(
        {
          title: 'Build Early Momentum',
          content:
            'Not enough consistent daily data yet for confident trends. Try featuring best-sellers on your home screen and run a small bundle offer.',
          type: 'growth',
          icon: '🚀',
          color: 'secondary',
        },
        {
          title: 'Nudge Low-visibility Items',
          content:
            'Rotate low-selling items to the top of categories, add photos, and test ₹10–₹20 price adjustments.',
          type: 'optimization',
          icon: '🛠️',
          color: 'success',
        }
      );
    }

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
