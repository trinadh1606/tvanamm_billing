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
  day: string;
  date: string;
  revenue: number;
  orders: number;
  avgOrderValue: number;
  dayOfWeek: string;
}

interface WeeklyPerformanceProps {
  userFranchiseId: string;
  isCentral: boolean;
}

export function WeeklyPerformanceChart({ userFranchiseId, isCentral }: WeeklyPerformanceProps) {
  const [weeklyData, setWeeklyData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFranchise, setSelectedFranchise] = useState<string>(isCentral ? '' : userFranchiseId);
  const [franchiseList, setFranchiseList] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<Date | null>(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const [endDate, setEndDate] = useState<Date | null>(new Date());
  const [totalOrders, setTotalOrders] = useState<number>(0);
  const { toast } = useToast();

  useEffect(() => {
    if (isCentral) fetchFranchiseList();
    fetchWeeklyData();
  }, [isCentral]);

  useEffect(() => {
    fetchWeeklyData();
  }, [selectedFranchise, startDate, endDate]);

  const fetchFranchiseList = async () => {
    try {
      const { data, error } = await supabase
        .from('bills_generated_billing')
        .select('franchise_id')
        .order('franchise_id');
      if (error) throw error;
      const uniqueFranchises = Array.from(new Set(data?.map(item => item.franchise_id) || []));
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

  const fetchWeeklyData = async () => {
    setLoading(true);
    try {
      if (!startDate || !endDate) throw new Error("Please select both start and end dates");

      let queryStartDate = new Date(startDate);
      let queryEndDate = new Date(endDate);
      if (queryStartDate > queryEndDate) [queryStartDate, queryEndDate] = [queryEndDate, queryStartDate];

      queryEndDate.setHours(23, 59, 59, 999);

      // Fetch bills data
      let query = supabase
        .from('bills_generated_billing')
        .select('total, created_at, franchise_id')
        .gte('created_at', queryStartDate.toISOString())
        .lte('created_at', queryEndDate.toISOString());

      if (!isCentral) {
        query = query.eq('franchise_id', userFranchiseId);
      } else if (selectedFranchise) {
        query = query.eq('franchise_id', selectedFranchise);
      }

      const { data: bills, error } = await query;
      if (error) throw error;

      // Fetch total orders accurately
      let countQuery = supabase
        .from('bills_generated_billing')
        .select('id', { head: true, count: 'exact' })
        .gte('created_at', queryStartDate.toISOString())
        .lte('created_at', queryEndDate.toISOString());

      if (!isCentral) {
        countQuery = countQuery.eq('franchise_id', userFranchiseId);
      } else if (selectedFranchise) {
        countQuery = countQuery.eq('franchise_id', selectedFranchise);
      }

      const { count, error: countError } = await countQuery;
      if (countError) throw countError;
      setTotalOrders(count || 0);

      const dailyDataMap = new Map<string, DayData>();
      const currentDate = new Date(queryStartDate);

      while (currentDate <= queryEndDate) {
        const dateKey = currentDate.toISOString().split('T')[0];
        dailyDataMap.set(dateKey, {
          day: currentDate.toLocaleDateString('en-GB', { weekday: 'short' }),
          date: dateKey,
          revenue: 0,
          orders: 0,
          avgOrderValue: 0,
          dayOfWeek: currentDate.toLocaleDateString('en-GB', { weekday: 'long' }),
        });
        currentDate.setDate(currentDate.getDate() + 1);
      }

      bills?.forEach(bill => {
        const billDate = new Date(bill.created_at);
        const dateKey = billDate.toISOString().split('T')[0];

        const dayData = dailyDataMap.get(dateKey)!;
        dayData.revenue += Number(bill.total) || 0;
        dayData.orders += 1;
        dayData.avgOrderValue = dayData.orders > 0 ? dayData.revenue / dayData.orders : 0;

        dailyDataMap.set(dateKey, dayData);
      });

      const filledWeekData = Array.from(dailyDataMap.values()).sort((a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      setWeeklyData(filledWeekData);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to fetch weekly performance data",
        variant: "destructive",
      });
      console.error('Error fetching weekly data:', error);
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
      'Date': day.date,
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

          {/* Charts remain unchanged */}
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
                      <XAxis
                        dataKey="date"
                        tickFormatter={(value) => {
                          const date = new Date(value);
                          return `${date.toLocaleDateString('en-GB', { weekday: 'short' })} (${value.split('-').reverse().join('/')})`;
                        }}
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis />
                      <Tooltip
                        formatter={(value: number) => [`₹${value.toFixed(2)}`, 'Revenue']}
                        labelFormatter={(value) => {
                          const date = new Date(value);
                          return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                        }}
                      />
                      <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 6, strokeWidth: 2, fill: 'hsl(var(--primary))' }} activeDot={{ r: 8 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

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
                      <XAxis
                        dataKey="date"
                        tickFormatter={(value) => {
                          const date = new Date(value);
                          return `${date.toLocaleDateString('en-GB', { weekday: 'short' })} (${value.split('-').reverse().join('/')})`;
                        }}
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis />
                      <Tooltip
                        formatter={(value: number) => [value, 'Orders']}
                        labelFormatter={(value) => {
                          const date = new Date(value);
                          return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                        }}
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
