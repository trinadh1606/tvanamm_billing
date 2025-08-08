import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Calendar, Download, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";

interface DayData {
  day: string;
  date: string;
  revenue: number;
  orders: number;
  avgOrderValue: number;
  dayOfWeek: string;
}

interface WeeklyPerformanceProps {
  userFranchiseId: string; // Required prop - the franchise ID of the logged-in user
  isCentral: boolean;     // Required prop - whether the user has central access
}

export function WeeklyPerformanceChart({ userFranchiseId, isCentral }: WeeklyPerformanceProps) {
  const [weeklyData, setWeeklyData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFranchise, setSelectedFranchise] = useState<string>(isCentral ? '' : userFranchiseId);
  const [franchiseList, setFranchiseList] = useState<string[]>([]); 
  const [startDate, setStartDate] = useState<Date | null>(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const [endDate, setEndDate] = useState<Date | null>(new Date());
  const { toast } = useToast();

  useEffect(() => {
    if (isCentral) {
      fetchFranchiseList();
    }
    fetchWeeklyData();
  }, [isCentral]);

  useEffect(() => {
    // Refetch data when franchise selection or dates change
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
      if (!startDate || !endDate) {
        throw new Error("Please select both start and end dates");
      }

      let queryStartDate = new Date(startDate);
      let queryEndDate = new Date(endDate);

      // Ensure start date is before end date
      if (queryStartDate > queryEndDate) {
        [queryStartDate, queryEndDate] = [queryEndDate, queryStartDate];
      }

      // Query all data for the date range at once
      let query = supabase
        .from('bills_generated_billing')
        .select('total, created_at, franchise_id')
        .gte('created_at', queryStartDate.toISOString())
        .lte('created_at', queryEndDate.toISOString());

      // Always filter by franchise ID for non-central users
      if (!isCentral) {
        query = query.eq('franchise_id', userFranchiseId);
      } 
      // For central users, only filter if a specific franchise is selected
      else if (selectedFranchise) {
        query = query.eq('franchise_id', selectedFranchise);
      }

      const { data: bills, error } = await query;

      if (error) throw error;

      // Process all bills and group by day
      const dailyDataMap = new Map<string, DayData>();

      // Initialize all dates in range with zero values
      const currentDate = new Date(queryStartDate);
      while (currentDate <= queryEndDate) {
        const dateKey = formatDate(currentDate);
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

      // Process each bill and add to the corresponding day
      bills?.forEach(bill => {
        const billDate = new Date(bill.created_at);
        const dateKey = formatDate(billDate);
        
        const dayData = dailyDataMap.get(dateKey) || {
          day: billDate.toLocaleDateString('en-GB', { weekday: 'short' }),
          date: dateKey,
          revenue: 0,
          orders: 0,
          avgOrderValue: 0,
          dayOfWeek: billDate.toLocaleDateString('en-GB', { weekday: 'long' }),
        };

        dayData.revenue += Number(bill.total) || 0;
        dayData.orders += 1;
        dayData.avgOrderValue = dayData.orders > 0 ? dayData.revenue / dayData.orders : 0;
        
        dailyDataMap.set(dateKey, dayData);
      });

      // Convert map to array and sort by date
      const filledWeekData = Array.from(dailyDataMap.values()).sort((a, b) => {
        return new Date(a.date.split('/').reverse().join('-')).getTime() - 
               new Date(b.date.split('/').reverse().join('-')).getTime();
      });

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

  const formatDate = (date: Date): string => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const exportToExcel = () => {
    if (weeklyData.length === 0) {
      toast({
        title: "No Data",
        description: "There is no data to export",
        variant: "destructive",
      });
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

    toast({
      title: "Export Successful",
      description: "Weekly performance data exported to Excel",
    });
  };

  const totalWeekRevenue = weeklyData.reduce((sum, day) => sum + day.revenue, 0);
  const totalWeekOrders = weeklyData.reduce((sum, day) => sum + day.orders, 0);
  const avgWeeklyOrderValue = totalWeekOrders > 0 ? totalWeekRevenue / totalWeekOrders : 0;
  const bestDay = weeklyData.reduce((best, day) => day.revenue > best.revenue ? day : best, weeklyData[0] || { revenue: 0, dayOfWeek: 'N/A' });

  const handleGetDetails = () => {
    fetchWeeklyData();
  };

  if (loading) {
    return <div className="text-center py-8">Loading weekly performance...</div>;
  }

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
                      <option key={franchise} value={franchise}>
                        {franchise}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <Button onClick={handleGetDetails} variant="outline">
                Get Data
              </Button>
              <Button onClick={exportToExcel} variant="outline" disabled={weeklyData.length === 0}>
                <Download className="h-4 w-4 mr-2" />
                Export Excel
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {/* Date Pickers */}
          <div className="mb-6">
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <span className="block text-sm font-medium mb-1">Start Date</span>
                <DatePicker
                  selected={startDate}
                  onChange={(date) => setStartDate(date)}
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
                  onChange={(date) => setEndDate(date)}
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
          </div>

          {/* Weekly Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Total Revenue</p>
                  <p className="text-2xl font-bold">₹{totalWeekRevenue.toFixed(2)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Total Orders</p>
                  <p className="text-2xl font-bold">{totalWeekOrders}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Avg Order Value</p>
                  <p className="text-2xl font-bold">₹{avgWeeklyOrderValue.toFixed(2)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Best Day</p>
                  <p className="text-2xl font-bold">{bestDay.dayOfWeek}</p>
                  <p className="text-sm">₹{bestDay.revenue.toFixed(2)}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Scrollable Daily Revenue Trend */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Daily Revenue Trend
              </h3>
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <span>Swipe right to left</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </div>
            </div>
            <div className="relative">
              <div className="overflow-x-auto pb-2">
                <div style={{ minWidth: `${weeklyData.length * 60}px` }}>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={weeklyData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis 
                          dataKey="date"
                          tick={{ fontSize: 12 }}
                          tickFormatter={(value) => {
                            const date = new Date(value.split('/').reverse().join('-'));
                            return `${date.toLocaleDateString('en-GB', { weekday: 'short' })} (${value})`;
                          }}
                        />
                        <YAxis />
                        <Tooltip 
                          formatter={(value: number) => [`₹${value.toFixed(2)}`, 'Revenue']}
                          labelFormatter={(value) => {
                            const date = new Date(value.split('/').reverse().join('-'));
                            return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                          }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="revenue" 
                          stroke="hsl(var(--primary))" 
                          strokeWidth={3}
                          dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2, r: 6 }}
                          activeDot={{ r: 8 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-2 bg-gray-100 rounded-full">
                <div className="h-2 bg-gray-300 rounded-full" style={{ width: '100%' }}></div>
              </div>
            </div>
          </div>

          {/* Scrollable Orders Count Chart */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Daily Orders Count</h3>
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <span>Swipe right to left</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </div>
            </div>
            <div className="relative">
              <div className="overflow-x-auto pb-2">
                <div style={{ minWidth: `${weeklyData.length * 60}px` }}>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={weeklyData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis 
                          dataKey="date"
                          tick={{ fontSize: 12 }}
                          tickFormatter={(value) => {
                            const date = new Date(value.split('/').reverse().join('-'));
                            return `${date.toLocaleDateString('en-GB', { weekday: 'short' })} (${value})`;
                          }}
                        />
                        <YAxis />
                        <Tooltip 
                          formatter={(value: number) => [value, 'Orders']}
                          labelFormatter={(value) => {
                            const date = new Date(value.split('/').reverse().join('-'));
                            return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                          }}
                        />
                        <Bar 
                          dataKey="orders" 
                          fill="hsl(var(--secondary))"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-2 bg-gray-100 rounded-full">
                <div className="h-2 bg-gray-300 rounded-full" style={{ width: '100%' }}></div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}