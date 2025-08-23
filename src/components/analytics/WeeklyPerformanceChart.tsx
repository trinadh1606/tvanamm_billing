import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Calendar, Download, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';
import "react-datepicker/dist/react-datepicker.css";
import DatePicker from 'react-datepicker';

interface DayData {
  day: string;            // short weekday (e.g., Mon)
  date: string;           // YYYY-MM-DD (IST)
  revenue: number;
  orders: number;
  avgOrderValue: number;
  dayOfWeek: string;      // long weekday (e.g., Monday)
  labelShort: string;     // Mon (dd/MM/yyyy)
  labelLong: string;      // Monday, 12 February 2025
}

interface WeeklyPerformanceProps {
  userFranchiseId: string;
  isCentral: boolean;
}

type BillRow = {
  id: number;
  total: number | string | null;
  created_at: string;
  franchise_id: string;
};

export function WeeklyPerformanceChart({ userFranchiseId, isCentral }: WeeklyPerformanceProps) {
  const [weeklyData, setWeeklyData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFranchise, setSelectedFranchise] = useState<string>(isCentral ? '' : userFranchiseId);
  const [franchiseList, setFranchiseList] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<Date | null>(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const [endDate, setEndDate] = useState<Date | null>(new Date());
  const [totalOrders, setTotalOrders] = useState<number>(0);
  const { toast } = useToast();

  // ------- IST helpers -------
  const ymdIST = (d: Date) =>
    d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD

  const buildISTStartISO = (d: Date) => {
    const ymd = ymdIST(d);
    return new Date(`${ymd}T00:00:00+05:30`).toISOString(); // inclusive start
  };
  const buildISTEndISO = (d: Date) => {
    const ymd = ymdIST(d);
    return new Date(`${ymd}T23:59:59.999+05:30`).toISOString(); // inclusive end-of-day
  };

  const istWeekdayLong = (ymd: string) =>
    new Date(`${ymd}T12:00:00+05:30`).toLocaleDateString('en-GB', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
    });

  const istWeekdayShort = (ymd: string) =>
    new Date(`${ymd}T12:00:00+05:30`).toLocaleDateString('en-GB', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
    });

  const labelShortFor = (ymd: string) => {
    const [Y, M, D] = ymd.split('-');
    const pretty = `${D}/${M}/${Y}`;
    return `${istWeekdayShort(ymd)} (${pretty})`;
  };

  const labelLongFor = (ymd: string) =>
    new Date(`${ymd}T12:00:00+05:30`).toLocaleDateString('en-GB', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

  // For grouping bills by IST date
  const dateKeyFromTimestampIST = (ts: string) =>
    new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD

  useEffect(() => {
    if (isCentral) fetchFranchiseList();
    fetchWeeklyData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCentral]);

  useEffect(() => {
    fetchWeeklyData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFranchise, startDate, endDate]);

  const fetchFranchiseList = async () => {
    try {
      const { data, error } = await supabase
        .from('bills_generated_billing')
        .select('franchise_id')
        .order('franchise_id');
      if (error) throw error;
      const uniqueFranchises = Array.from(new Set(data?.map(item => item.franchise_id) || [])).filter(Boolean);
      setFranchiseList(uniqueFranchises);
    } catch (error: any) {
      console.error('Error fetching franchise list:', error);
      toast({
        title: "Error",
        description: "Failed to fetch franchise list",
        variant: "destructive",
      });
    }
  };

  // ---- NEW: paginate to bypass Supabase's 1k row cap ----
  const fetchBillsPaged = async (startISO: string, endISO: string): Promise<BillRow[]> => {
    const pageSize = 1000;
    let from = 0;
    const all: BillRow[] = [];

    while (true) {
      const to = from + pageSize - 1;
      let q = supabase
        .from('bills_generated_billing')
        .select('id, total, created_at, franchise_id')
        .gte('created_at', startISO)
        .lte('created_at', endISO)
        .order('id', { ascending: true })
        .range(from, to);

      if (!isCentral) {
        q = q.eq('franchise_id', userFranchiseId);
      } else if (selectedFranchise) {
        q = q.eq('franchise_id', selectedFranchise);
      }

      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) break;

      all.push(...(data as BillRow[]));
      if (data.length < pageSize) break;
      from += pageSize;
    }

    return all;
  };

  const fetchWeeklyData = async () => {
    setLoading(true);
    try {
      if (!startDate || !endDate) throw new Error("Please select both start and end dates");

      // Normalize and ensure start <= end
      let s = startDate;
      let e = endDate;
      if (s > e) [s, e] = [e, s];

      // Build IST-inclusive bounds
      const startISO = buildISTStartISO(s);
      const endISO = buildISTEndISO(e);

      // Fetch *all* bills in the range (with pagination)
      const bills = await fetchBillsPaged(startISO, endISO);

      // Seed day map for each IST date in range
      const dayMap = new Map<string, DayData>();

      const startYMD = ymdIST(s);
      const endYMD = ymdIST(e);

      // utility to add days to YMD (in IST)
      const addDaysYMD = (ymd: string, days: number) => {
        const d = new Date(`${ymd}T12:00:00+05:30`);
        d.setDate(d.getDate() + days);
        return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      };

      let cur = startYMD;
      while (true) {
        dayMap.set(cur, {
          day: istWeekdayShort(cur),
          date: cur,
          revenue: 0,
          orders: 0,
          avgOrderValue: 0,
          dayOfWeek: istWeekdayLong(cur),
          labelShort: labelShortFor(cur),
          labelLong: labelLongFor(cur),
        });
        if (cur === endYMD) break;
        cur = addDaysYMD(cur, 1);
      }

      // Aggregate bills per IST day
      for (const bill of bills) {
        const key = dateKeyFromTimestampIST(bill.created_at);
        const row = dayMap.get(key);
        if (!row) continue; // out of seeded range (shouldn't happen)
        row.revenue += Number(bill.total) || 0;
        row.orders += 1;
        row.avgOrderValue = row.orders > 0 ? row.revenue / row.orders : 0;
        dayMap.set(key, row);
      }

      const filled = Array.from(dayMap.values()).sort(
        (a, b) => new Date(`${a.date}T00:00:00+05:30`).getTime() - new Date(`${b.date}T00:00:00+05:30`).getTime()
      );

      setWeeklyData(filled);
      // Keep totals in sync with exactly what we show
      setTotalOrders(bills.length);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to fetch weekly performance data",
        variant: "destructive",
      });
      console.error('Error fetching weekly data:', error);
      setWeeklyData([]);
      setTotalOrders(0);
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = () => {
    if (weeklyData.length === 0) {
      toast({ title: "No Data", description: "There is no data to export", variant: "destructive" });
      return;
    }

    const exportData = weeklyData.map(day => ({
      'Day': day.dayOfWeek,
      'Date (IST)': day.date,
      'Revenue (₹)': day.revenue.toFixed(2),
      'Orders': day.orders,
      'Avg Order Value (₹)': day.avgOrderValue.toFixed(2)
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Weekly Performance');

    const filename = `weekly-performance-${selectedFranchise || 'all'}-${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, filename);

    toast({ title: "Export Successful", description: "Weekly performance data exported to Excel" });
  };

  const totalWeekRevenue = weeklyData.reduce((sum, day) => sum + day.revenue, 0);
  const avgWeeklyOrderValue = totalOrders > 0 ? totalWeekRevenue / totalOrders : 0;

  const handleGetDetails = () => fetchWeeklyData();

  if (loading) return <div className="text-center py-8">Loading weekly performance...</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              <CardTitle>Weekly Performance</CardTitle>
            </div>
            <div className="flex items-center gap-4">
              {isCentral && (
                <div className="relative flex-1 max-w-md">
                  <select
                    value={selectedFranchise}
                    onChange={(e) => setSelectedFranchise(e.target.value)}
                    className="border p-2 rounded-md w-full"
                  >
                    <option value="">All Franchises</option>
                    {franchiseList.map(franchise => (
                      <option key={franchise} value={franchise}>{franchise}</option>
                    ))}
                  </select>
                </div>
              )}
              <Button onClick={handleGetDetails} variant="outline">Get Data</Button>
              <Button onClick={exportToExcel} variant="outline" disabled={weeklyData.length === 0}>
                <Download className="h-4 w-4 mr-2" />
                Export Excel
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="mb-6 flex flex-wrap gap-4">
            <div>
              <span className="block text-sm font-medium mb-1">Start Date</span>
              <DatePicker
                selected={startDate}
                onChange={(date: Date | null) => setStartDate(date)}
                selectsStart
                startDate={startDate}
                endDate={endDate}
                dateFormat="dd/MM/yyyy"
                className="border p-2 rounded-md w-full"
                placeholderText="Select start date"
              />
            </div>
            <div>
              <span className="block text-sm font-medium mb-1">End Date</span>
              <DatePicker
                selected={endDate}
                onChange={(date: Date | null) => setEndDate(date)}
                selectsEnd
                startDate={startDate}
                endDate={endDate}
                minDate={startDate}
                dateFormat="dd/MM/yyyy"
                className="border p-2 rounded-md w-full"
                placeholderText="Select end date"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold">₹{totalWeekRevenue.toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">Total Orders</p>
                <p className="text-2xl font-bold">{totalOrders}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">Avg Order Value</p>
                <p className="text-2xl font-bold">₹{avgWeeklyOrderValue.toFixed(2)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Daily Revenue Trend */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Daily Revenue Trend
              </h3>
            </div>
            <div className="overflow-x-auto pb-2">
              <div style={{ minWidth: `${weeklyData.length * 60}px` }}>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weeklyData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="labelShort" tick={{ fontSize: 12 }} />
                      <YAxis />
                      <Tooltip
                        formatter={(value: number) => [`₹${value.toFixed(2)}`, 'Revenue']}
                        labelFormatter={(label) => String(label)}
                      />
                      <Line
                        type="monotone"
                        dataKey="revenue"
                        stroke="hsl(var(--primary))"
                        strokeWidth={3}
                        dot={{ r: 6, strokeWidth: 2, fill: 'hsl(var(--primary))' }}
                        activeDot={{ r: 8 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

          {/* Daily Orders */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Daily Orders Count</h3>
            </div>
            <div className="overflow-x-auto pb-2">
              <div style={{ minWidth: `${weeklyData.length * 60}px` }}>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weeklyData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="labelShort" tick={{ fontSize: 12 }} />
                      <YAxis />
                      <Tooltip
                        formatter={(value: number) => [value, 'Orders']}
                        labelFormatter={(label) => String(label)}
                      />
                      <Bar dataKey="orders" fill="hsl(var(--secondary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
