import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { ChartTooltip } from '@/components/ui/chart';
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface IndividualFranchiseAnalyticsProps {
  franchiseId: string;
  /** Optional UTC ISO bounds (inclusive). When provided, filters sales distribution to this range. */
  startISO?: string;
  endISO?: string;
}

interface PopularItem {
  item_name: string;
  qty: number;
  price: number;   // fetched from menu_items
  revenue: number; // menu price * qty
  color: string;   // base HSL color
}

type RawRow = {
  item_name: string;
  qty: number | string | null;
  menu_item_id: number | null;
};

// ---- tiny helpers just for styling the chart colors (do not affect data) ----
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const parseHsl = (hsl: string) => {
  const m = hsl.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/i);
  if (!m) return { h: 0, s: 70, l: 50 };
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
};
const toHsl = ({ h, s, l }: { h: number; s: number; l: number }) =>
  `hsl(${Math.round(h)}, ${clamp(Math.round(s), 0, 100)}%, ${clamp(Math.round(l), 0, 100)}%)`;
const shiftHsl = (base: string, dS = 0, dL = 0) => {
  const { h, s, l } = parseHsl(base);
  return toHsl({ h, s: s + dS, l: l + dL });
};

/** Build a palette of guaranteed-unique colors.
 *  - For <= 360 slices: evenly-spaced unique hues at fixed S/L.
 *  - For > 360: repeat the hue wheel but change S/L tiers to keep colors distinct.
 */
function buildUniquePalette(count: number): string[] {
  const result: string[] = [];
  if (count <= 0) return result;

  const satTiers = [68, 60, 76];   // vary saturation if >360
  const lightTiers = [55, 48, 62]; // vary lightness if >360

  let remaining = count;
  let tier = 0;

  while (remaining > 0) {
    const batch = Math.min(remaining, 360);
    for (let i = 0; i < batch; i++) {
      const hue = Math.round((i * 360) / batch) % 360; // evenly spaced, unique integers
      const s = satTiers[tier % satTiers.length];
      const l = lightTiers[tier % lightTiers.length];
      result.push(`hsl(${hue}, ${s}%, ${l}%)`);
    }
    remaining -= batch;
    tier++;
  }

  return result.slice(0, count);
}

export function IndividualFranchiseAnalytics({
  franchiseId,
  startISO,
  endISO,
}: IndividualFranchiseAnalyticsProps) {
  const [popularItems, setPopularItems] = useState<PopularItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!franchiseId) return;
    fetchFranchiseItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [franchiseId, startISO, endISO]);

  /** Chunk helper for .in() queries */
  const chunk = <T,>(arr: T[], size = 1000): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  /** Get bill IDs (bills_generated_billing) in date range for the franchise */
  const fetchBillIds = async (
    fid: string,
    start?: string,
    end?: string
  ): Promise<number[]> => {
    const pageSize = 1000;
    let from = 0;
    const ids: number[] = [];

    while (true) {
      const to = from + pageSize - 1;

      let q = supabase
        .from('bills_generated_billing')
        .select('id')
        .eq('franchise_id', fid)
        .order('id', { ascending: true })
        .range(from, to);

      if (start) q = q.gte('created_at', start);
      if (end) q = q.lte('created_at', end);

      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) break;

      ids.push(...data.map((r: { id: number }) => r.id));
      if (data.length < pageSize) break;
      from += pageSize;
    }

    return ids;
  };

  /** Fetch all item rows for a set of bill IDs */
  const fetchItemsByBillIds = async (billIds: number[]): Promise<RawRow[]> => {
    if (billIds.length === 0) return [];
    const batches = chunk(billIds, 1000);
    const all: RawRow[] = [];
    for (const batch of batches) {
      const { data, error } = await supabase
        .from('bill_items_generated_billing')
        .select('item_name, qty, menu_item_id')
        .in('bill_id', batch);

      if (error) throw error;
      all.push(...((data as RawRow[]) ?? []));
    }
    return all;
  };

  // Fetch all menu items for the franchise (price map)
  const fetchMenuPrices = async (fid: string): Promise<Record<number, number>> => {
    const { data, error } = await supabase
      .from('menu_items')
      .select('id, price')
      .eq('franchise_id', fid);

    if (error) throw error;

    const priceMap: Record<number, number> = {};
    (data || []).forEach((item: any) => {
      priceMap[item.id] = Number(item.price) || 0;
    });
    return priceMap;
  };

  const fetchFranchiseItems = async () => {
    setLoading(true);
    try {
      // 1) Get bill ids for the (optional) range
      const billIds = await fetchBillIds(franchiseId, startISO, endISO);

      // 2) Fetch items for those bills
      const rows = await fetchItemsByBillIds(billIds);

      // 3) Get price map
      const menuPriceMap = await fetchMenuPrices(franchiseId);

      if (!rows || rows.length === 0) {
        setPopularItems([]);
        return;
      }

      const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

      const aggregated = rows.reduce(
        (acc: Record<string, { qty: number; revenue: number; menuPrice: number }>, raw) => {
          const name = norm(String(raw.item_name || ''));
          if (!name) return acc;

          const qty = Number(raw.qty) || 0;
          const menuPrice = raw.menu_item_id ? (menuPriceMap[raw.menu_item_id] || 0) : 0;

          if (!acc[name]) {
            acc[name] = { qty: 0, revenue: 0, menuPrice };
          }

          acc[name].qty += qty;
          acc[name].revenue += qty * menuPrice;
          acc[name].menuPrice = menuPrice;

          return acc;
        },
        {}
      );

      // Sort by quantity desc
      const entries = Object.entries(aggregated).sort((a, b) => b[1].qty - a[1].qty);

      // Build a guaranteed-unique palette and assign in order
      const palette = buildUniquePalette(entries.length);

      const itemsArray: PopularItem[] = entries.map(([item_name, data], index) => ({
        item_name,
        qty: data.qty,
        price: data.menuPrice,
        revenue: data.revenue,
        color: palette[index],
      }));

      setPopularItems(itemsArray);
    } catch (error) {
      console.error('Error fetching franchise items:', error);
      setPopularItems([]);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="text-center py-8">Loading analytics...</div>;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="items" className="w-full">
        <TabsContent value="items">
          <div className="flex flex-col items-center gap-6">
            {/* Pie Chart */}
            <Card className="w-full max-w-2xl">
              <CardHeader>
                <CardTitle className="flex items-center justify-center gap-2">
                  <Zap className="h-5 w-5" />
                  Sales Distribution{startISO && endISO ? ' (Filtered)' : ''}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {popularItems.length > 0 ? (
                  <div className="relative">
                    {/* neon bloom behind the chart */}
                    <div className="pointer-events-none absolute inset-6 rounded-3xl blur-2xl bg-[conic-gradient(at_top_right,_#a78bfa33,_#22d3ee33,_#34d39933,_#f472b633,_#a78bfa33)]" />
                    <div className="relative flex justify-center items-center h-[420px] rounded-2xl border border-emerald-300/30 bg-white/80 backdrop-blur">
                      <ResponsiveContainer width="60%" height="100%">
                        <PieChart
                          style={{
                            filter:
                              'drop-shadow(0 2px 6px rgba(16,185,129,.35)) drop-shadow(0 0 14px rgba(99,102,241,.28))',
                          }}
                        >
                          {/* gradient fills per-slice based on the item.base color */}
                          <defs>
                            {popularItems.map((entry, i) => {
                              const id = `grad-${franchiseId}-${i}`;
                              const c0 = shiftHsl(entry.color, +20, +14); // brighter
                              const c1 = entry.color;                     // base
                              const c2 = shiftHsl(entry.color, -5, -18);  // darker tail
                              return (
                                <linearGradient id={id} key={id} x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor={c0} />
                                  <stop offset="55%" stopColor={c1} />
                                  <stop offset="100%" stopColor={c2} />
                                </linearGradient>
                              );
                            })}
                          </defs>

                          <Pie
                            data={popularItems}
                            dataKey="revenue"
                            nameKey="item_name"
                            cx="50%"
                            cy="50%"
                            outerRadius={125}
                            innerRadius={62}
                            paddingAngle={2.5}
                            label={false}
                            isAnimationActive
                          >
                            {popularItems.map((entry, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={`url(#grad-${franchiseId}-${index})`}
                                stroke={shiftHsl(entry.color, +10, -10)}
                                strokeWidth={2}
                              />
                            ))}
                          </Pie>

                          <ChartTooltip
                            formatter={(value, name, props) => [
                              `₹${Number(value).toLocaleString('en-IN')}`,
                              `${name} (${props?.payload?.qty ?? 0} sold)`,
                            ]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ) : (
                  <p className="text-center text-gray-500 py-8">
                    {startISO && endISO ? 'No data for the selected range.' : 'No data available.'}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Table */}
            <Card className="w-full max-w-3xl">
              <CardHeader>
                <CardTitle>Item Details{startISO && endISO ? ' (Filtered)' : ''}</CardTitle>
              </CardHeader>
              <CardContent>
                {popularItems.length > 0 ? (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="p-2">Color</th>
                        <th className="p-2">Item Name</th>
                        <th className="p-2">Price (₹)</th>
                        <th className="p-2">Quantity Sold</th>
                        <th className="p-2">Revenue (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {popularItems.map((item, i) => {
                        const c0 = shiftHsl(item.color, +20, +14);
                        const c2 = shiftHsl(item.color, -5, -18);
                        return (
                          <tr key={item.item_name} className="border-b border-gray-100">
                            <td className="p-2">
                              <div
                                className="w-4 h-4 rounded-full"
                                style={{
                                  background: `linear-gradient(135deg, ${c0}, ${item.color}, ${c2})`,
                                  boxShadow: `0 0 8px ${c0.replace('hsl', 'hsla').replace(')', ',.5)')}`,
                                }}
                                title={`Slice ${i + 1}`}
                              />
                            </td>
                            <td className="p-2">{item.item_name}</td>
                            <td className="p-2">₹{Number(item.price).toLocaleString('en-IN')}</td>
                            <td className="p-2">{Number(item.qty).toLocaleString('en-IN')}</td>
                            <td className="p-2">₹{Number(item.revenue).toLocaleString('en-IN')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-center text-gray-500 py-4">
                    {startISO && endISO ? 'No items found for the selected dates.' : 'No items found.'}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}