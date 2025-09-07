"use client";

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { Coffee, Award } from 'lucide-react';

interface PopularItem {
  item_name: string;
  total_quantity: number;
  total_revenue: number; // adjusted to match bills
  percentage: number;
  growth: number;
  category?: string;
}
interface CategoryData {
  category: string;
  revenue: number; // adjusted to match bills
  items: number;
  color: string;
  percentage: number;
}
interface AllItem {
  item_name: string;
  total_quantity: number;
  total_revenue: number; // adjusted to match bills
  category: string;
}

type ItemRow = {
  item_name: string | null;
  qty: number | null;
  price: number | null;
  bill_id: number | null;
  menu_items: { category: string | null } | null;
  bills_generated_billing: { created_at: string; total: number | null } | null;
};

const PAGE = 1000;

const toISOStart = (dStr: string) => new Date(`${dStr}T00:00:00`).toISOString();
const nextDayISO = (dStr: string) => {
  const d = new Date(`${dStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
};

export function PopularItemsLive() {
  const [popularItems, setPopularItems] = useState<PopularItem[]>([]);
  const [categoryData, setCategoryData] = useState<CategoryData[]>([]);
  const [allItems, setAllItems] = useState<AllItem[]>([]);
  const [grandTotalBills, setGrandTotalBills] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const { franchiseId } = useAuth();

  useEffect(() => {
    if (!franchiseId) return;
    fetchData();

    const channel = supabase
      .channel('items-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bill_items_generated_billing',
          filter: `franchise_id=eq.${franchiseId}`,
        },
        () => fetchData({ start: startDate || undefined, end: endDate || undefined })
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [franchiseId]);

  // ---------- Paging helpers ----------
  const pageThroughBills = async (opts: {
    franchiseId: string;
    startISO?: string;
    endISO?: string;
  }) => {
    let from = 0;
    const all: { id: number; total: number; created_at: string }[] = [];

    while (true) {
      let q = supabase
        .from('bills_generated_billing')
        .select('id,total,created_at')
        .eq('franchise_id', opts.franchiseId)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE - 1);

      if (opts.startISO) q = q.gte('created_at', opts.startISO);
      if (opts.endISO) q = q.lt('created_at', opts.endISO);

      const { data, error } = await q;
      if (error) throw error;

      const batch = (data ?? []) as any[];
      all.push(
        ...batch.map((b) => ({
          id: Number(b.id),
          total: Number(b.total ?? 0),
          created_at: b.created_at as string,
        }))
      );

      if (!batch || batch.length < PAGE) break;
      from += PAGE;
    }

    return all;
  };

  const pageThroughItems = async (opts: {
    franchiseId: string;
    startISO?: string;
    endISO?: string;
  }) => {
    let from = 0;
    const all: ItemRow[] = [];

    while (true) {
      let q = supabase
        .from('bill_items_generated_billing')
        .select(
          `
          item_name,
          qty,
          price,
          bill_id,
          menu_items!inner(category),
          bills_generated_billing!inner(created_at,total)
        `
        )
        .eq('franchise_id', opts.franchiseId)
        .order('created_at', { referencedTable: 'bills_generated_billing', ascending: true })
        .range(from, from + PAGE - 1);

      if (opts.startISO) q = q.gte('bills_generated_billing.created_at', opts.startISO);
      if (opts.endISO) q = q.lt('bills_generated_billing.created_at', opts.endISO);

      const { data, error } = await q;
      if (error) throw error;

      const batch = (data ?? []) as unknown as ItemRow[];
      all.push(...batch);

      if (!batch || batch.length < PAGE) break;
      from += PAGE;
    }

    return all;
  };

  // ---------- Paise-accurate per-bill allocation ----------
  type BillItemTmp = {
    item_name: string;
    qty: number;
    price: number;
    category: string;
    rawPaise: number; // qty*price in paise
  };

  const allocateBillPaiseExactly = (
    billTotalPaise: number,
    items: BillItemTmp[],
  ): { name: string; qty: number; category: string; adjustedPaise: number }[] => {
    const rawSum = items.reduce((s, it) => s + it.rawPaise, 0);

    // If rawSum is zero (weird edge), just return zeros
    if (rawSum <= 0) {
      return items.map((it) => ({
        name: it.item_name,
        qty: it.qty,
        category: it.category,
        adjustedPaise: 0,
      }));
    }

    const factor = billTotalPaise / rawSum;

    // First pass: floor allocations & track remainders
    const floored: { idx: number; base: number; remainder: number }[] = items.map((it, idx) => {
      const exact = it.rawPaise * factor;
      const base = Math.floor(exact);
      const remainder = exact - base; // fractional paise
      return { idx, base, remainder };
    });

    const baseSum = floored.reduce((s, f) => s + f.base, 0);
    let remaining = billTotalPaise - baseSum; // number of paise to distribute

    // Distribute remaining paise by largest remainder
    floored.sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < floored.length && remaining > 0; i++) {
      floored[i].base += 1;
      remaining -= 1;
    }

    // Map back
    floored.sort((a, b) => a.idx - b.idx);
    return floored.map((f) => ({
      name: items[f.idx].item_name,
      qty: items[f.idx].qty,
      category: items[f.idx].category,
      adjustedPaise: f.base,
    }));
  };

  const fetchData = async (range?: { start?: string; end?: string }) => {
    if (!franchiseId) return;
    setLoading(true);

    try {
      // ---------- Range bounds ----------
      const startISO = range?.start ? toISOStart(range.start) : undefined;
      const endISO = range?.end ? nextDayISO(range.end) : undefined;

      // ---------- Grand total (bills) with pagination ----------
      const bills = await pageThroughBills({ franchiseId, startISO, endISO });
      const billTotalsMap = new Map<number, number>();
      const grandTotal = bills.reduce((s, b) => {
        billTotalsMap.set(b.id, b.total);
        return s + b.total;
      }, 0);
      setGrandTotalBills(grandTotal);

      // ---------- Today vs Yesterday (quick popular, raw revenue) ----------
      const todayStr = new Date().toISOString().split('T')[0];
      const y = new Date(); y.setDate(y.getDate() - 1);
      const yStr = y.toISOString().split('T')[0];

      const { data: todayItems, error: todayErr } = await supabase
        .from('bill_items_generated_billing')
        .select(`
          item_name,
          qty,
          price,
          menu_item_id,
          menu_items!inner(category),
          bills_generated_billing!inner(created_at)
        `)
        .eq('franchise_id', franchiseId)
        .gte('bills_generated_billing.created_at', todayStr);
      if (todayErr) throw todayErr;

      const { data: yesterdayItems, error: yesterdayErr } = await supabase
        .from('bill_items_generated_billing')
        .select(`
          item_name,
          qty,
          bills_generated_billing!inner(created_at)
        `)
        .eq('franchise_id', franchiseId)
        .gte('bills_generated_billing.created_at', yStr)
        .lt('bills_generated_billing.created_at', todayStr);
      if (yesterdayErr) throw yesterdayErr;

      const todayMap = new Map<string, { quantity: number; revenue: number; category: string }>();
      (todayItems || []).forEach((row: any) => {
        const prev =
          todayMap.get(row.item_name) || {
            quantity: 0,
            revenue: 0,
            category: row?.menu_items?.category || 'Other',
          };
        todayMap.set(row.item_name, {
          quantity: prev.quantity + (row?.qty ?? 0),
          revenue: prev.revenue + (row?.qty ?? 0) * Number(row?.price ?? 0),
          category: prev.category,
        });
      });
      const yesterdayMap = new Map<string, number>();
      (yesterdayItems || []).forEach((row: any) => {
        const prev = yesterdayMap.get(row.item_name) || 0;
        yesterdayMap.set(row.item_name, prev + (row?.qty ?? 0));
      });
      const totalQtyToday = Array.from(todayMap.values()).reduce((s, v) => s + v.quantity, 0);
      const itemsArray: PopularItem[] = Array.from(todayMap.entries())
        .map(([name, data]) => {
          const yq = yesterdayMap.get(name) || 0;
          const growth = yq > 0 ? ((data.quantity - yq) / yq) * 100 : 0;
          return {
            item_name: name,
            total_quantity: data.quantity,
            total_revenue: data.revenue, // raw here (quick section)
            percentage: totalQtyToday > 0 ? (data.quantity / totalQtyToday) * 100 : 0,
            growth,
            category: data.category,
          };
        })
        .sort((a, b) => b.total_quantity - a.total_quantity)
        .slice(0, 10);
      setPopularItems(itemsArray);

      // ---------- Range / All-time: page items, allocate paise per bill to match bills sum ----------
      const rows = await pageThroughItems({ franchiseId, startISO, endISO });

      // Build per-bill buckets of item lines (in paise)
      const perBill = new Map<number, BillItemTmp[]>();
      for (const r of rows) {
        const billId = (r.bill_id ?? -1) as number;
        const name = r.item_name ?? 'Unknown';
        const qty = Number(r.qty ?? 0);
        const price = Number(r.price ?? 0);
        const category = r.menu_items?.category || 'Other';

        // qty * price -> paise (integer)
        const rawPaise = Math.round(qty * price * 100);

        if (!perBill.has(billId)) perBill.set(billId, []);
        perBill.get(billId)!.push({ item_name: name, qty, price, category, rawPaise });
      }

      // Accumulate adjusted totals across all bills
      const itemAgg = new Map<string, { qty: number; paise: number; category: string }>();

      for (const [billId, items] of perBill.entries()) {
        const billTotal = billTotalsMap.get(billId) ?? Number(rows.find(r => (r.bill_id ?? -1) === billId)?.bills_generated_billing?.total ?? 0);
        const billTotalPaise = Math.round(billTotal * 100);
        const adjusted = allocateBillPaiseExactly(billTotalPaise, items);

        for (const a of adjusted) {
          const prev = itemAgg.get(a.name) || { qty: 0, paise: 0, category: a.category };
          itemAgg.set(a.name, {
            qty: prev.qty + a.qty,
            paise: prev.paise + a.adjustedPaise,
            category: prev.category,
          });
        }
      }

      // Flatten to items (in rupees)
      const allItemsArr: AllItem[] = Array.from(itemAgg.entries())
        .map(([name, v]) => ({
          item_name: name,
          total_quantity: v.qty,
          total_revenue: v.paise / 100,
          category: v.category,
        }))
        .sort((a, b) => b.total_revenue - a.total_revenue);
      setAllItems(allItemsArr);

      // categories (adjusted, guaranteed to match bill sum)
      const totalAdjustedRevenue = allItemsArr.reduce((s, v) => s + v.total_revenue, 0);
      const rawCategories = Array.from(
        allItemsArr.reduce((m, item) => {
          const c = m.get(item.category) || { revenue: 0, items: 0 };
          c.revenue += item.total_revenue;
          c.items += 1;
          m.set(item.category, c);
          return m;
        }, new Map<string, { revenue: number; items: number }>())
      );

      const colors = [
        'hsl(var(--primary))',
        'hsl(var(--success))',
        'hsl(var(--warning))',
        'hsl(var(--secondary))',
        'hsl(var(--destructive))',
        'hsl(var(--muted-foreground))',
      ];

      const cats: CategoryData[] = rawCategories
        .map(([category, v], idx) => ({
          category,
          revenue: v.revenue,
          items: v.items,
          color: colors[idx % colors.length],
          percentage: totalAdjustedRevenue > 0 ? (v.revenue / totalAdjustedRevenue) * 100 : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue);
      setCategoryData(cats);
    } catch (e) {
      console.error('Error fetching items:', e);
      setPopularItems([]);
      setAllItems([]);
      setCategoryData([]);
      setGrandTotalBills(0);
    } finally {
      setLoading(false);
    }
  };

  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    categoryData.forEach((c) => map.set(c.category, c.color));
    return map;
  }, [categoryData]);

  // quick picks
  const today = () => {
    const d = new Date();
    const s = d.toISOString().split('T')[0];
    setStartDate(s); setEndDate(s);
    fetchData({ start: s, end: s });
  };
  const yesterday = () => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    const s = d.toISOString().split('T')[0];
    setStartDate(s); setEndDate(s);
    fetchData({ start: s, end: s });
  };
  const last7 = () => {
    const end = new Date();
    const start = new Date(); start.setDate(start.getDate() - 6);
    const s = start.toISOString().split('T')[0];
    const e = end.toISOString().split('T')[0];
    setStartDate(s); setEndDate(e);
    fetchData({ start: s, end: e });
  };
  const thisMonth = () => {
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth(), 1);
    const s = start.toISOString().split('T')[0];
    const e = end.toISOString().split('T')[0];
    setStartDate(s); setEndDate(e);
    fetchData({ start: s, end: e });
  };
  const clearRange = () => {
    setStartDate(''); setEndDate('');
    fetchData();
  };

  if (loading) return <div className="text-center py-8">Loading popular items...</div>;

  return (
    <div className="space-y-6">
      {/* Date Range Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Filter by Date</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">From</div>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[180px]" />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">To</div>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[180px]" />
            </div>
            <Button
              onClick={() => fetchData({ start: startDate || undefined, end: endDate || undefined })}
              disabled={!startDate && !endDate}
            >
              Apply
            </Button>
            <div className="flex flex-wrap gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={today}>Today</Button>
              <Button variant="outline" size="sm" onClick={yesterday}>Yesterday</Button>
              <Button variant="outline" size="sm" onClick={last7}>Last 7 days</Button>
              <Button variant="outline" size="sm" onClick={thisMonth}>This month</Button>
              <Button variant="ghost" size="sm" onClick={clearRange}>All time</Button>
            </div>
          </div>
          {(startDate || endDate) && (
            <div className="mt-3 text-sm text-muted-foreground">
              Showing results {startDate ? `from ${startDate}` : 'from start'} {endDate ? `to ${endDate}` : 'to now'}
            </div>
          )}
          {!startDate && !endDate && (
            <div className="mt-3 text-sm">
              <span className="font-medium">Grand Total (Bills): </span>
              ₹{grandTotalBills.toFixed(2)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pie + side summary table */}
      <Card className="max-w-5xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 justify-center">
            <Coffee className="h-5 w-5" />
            Sales by Category {startDate || endDate ? '(Selected Range)' : '(All Time)'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
            <div className="md:col-span-2 h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    dataKey="revenue"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    outerRadius={120}
                    innerRadius={78}
                    paddingAngle={3}
                    labelLine={false}
                  >
                    {categoryData.map((entry, i) => (
                      <Cell key={`cell-${i}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      const total = categoryData.reduce((s, c) => s + c.revenue, 0);
                      const pct = total ? ((Number(value) / total) * 100).toFixed(1) : '0.0';
                      return [`₹${Number(value).toFixed(2)} • ${pct}%`, name];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="md:col-span-1">
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left p-2 font-medium">Category</th>
                      <th className="text-right p-2 font-medium">Revenue</th>
                      <th className="text-right p-2 font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryData.map((c) => (
                      <tr key={c.category} className="border-t">
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                            {c.category}
                          </div>
                        </td>
                        <td className="p-2 text-right">₹{c.revenue.toFixed(2)}</td>
                        <td className="p-2 text-right">{c.percentage.toFixed(1)}%</td>
                      </tr>
                    ))}
                    {categoryData.length === 0 && (
                      <tr>
                        <td className="p-3 text-center text-muted-foreground" colSpan={3}>
                          No data for this range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Items Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5" />
            {startDate || endDate ? 'Items (Selected Range)' : 'All Items (All Time)'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left p-3 font-medium">Item</th>
                  <th className="text-left p-3 font-medium">Category</th>
                  <th className="text-right p-3 font-medium">Total Sold</th>
                  <th className="text-right p-3 font-medium">Revenue (₹)</th>
                </tr>
              </thead>
              <tbody>
                {allItems.map((item) => {
                  const color = colorMap.get(item.category) || 'hsl(var(--primary))';
                  return (
                    <tr key={item.item_name} className="border-t">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          <span className="font-medium">{item.item_name}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" style={{ borderColor: color, color }}>
                          {item.category}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">{item.total_quantity}</td>
                      <td className="p-3 text-right">₹{item.total_revenue.toFixed(2)}</td>
                    </tr>
                  );
                })}
                {allItems.length === 0 && (
                  <tr>
                    <td className="p-4 text-center text-muted-foreground" colSpan={4}>
                      No items found for this range.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30">
                  <td className="p-3 font-semibold">Totals</td>
                  <td className="p-3"></td>
                  <td className="p-3 text-right font-semibold">
                    {allItems.reduce((s, v) => s + v.total_quantity, 0)}
                  </td>
                  <td className="p-3 text-right font-semibold">
                    ₹{allItems.reduce((s, v) => s + v.total_revenue, 0).toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            <strong>Grand Total (Bills):</strong> ₹{grandTotalBills.toFixed(2)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
