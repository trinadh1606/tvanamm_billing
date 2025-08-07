import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Calendar, Download, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';

interface DayData {
  day: string;
  date: string;
  revenue: number;
  orders: number;
  avgOrderValue: number;
  dayOfWeek: string;
}

interface WeeklyPerformanceProps {
  franchiseId?: string;
  isCentral?: boolean;
}

export function WeeklyPerformanceChart({ franchiseId, isCentral = false }: WeeklyPerformanceProps) {
  const [weeklyData, setWeeklyData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFranchise, setSelectedFranchise] = useState<string>(franchiseId || 'FR-CENTRAL');
  const [franchiseList, setFranchiseList] = useState<string[]>([]);
  
  const { toast } = useToast();

  useEffect(() => {
    if (isCentral) {
      fetchFranchiseList();
    }
    fetchWeeklyData();
  }, [selectedFranchise]);

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
    }
  };

  const fetchWeeklyData = async () => {
    setLoading(true);
    
    try {
      // Get last 7 days of data
      const istNow = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
      const weekData: DayData[] = [];
      
      for (let i = 6; i >= 0; i--) {
        const date = new Date(istNow);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const nextDateStr = new Date(date.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        let query = supabase
          .from('bills_generated_billing')
          .select('total')
          .gte('created_at', dateStr + 'T00:00:00')
          .lt('created_at', nextDateStr + 'T00:00:00');

        if (!isCentral && selectedFranchise) {
          query = query.eq('franchise_id', selectedFranchise);
        } else if (isCentral && selectedFranchise !== 'ALL') {
          query = query.eq('franchise_id', selectedFranchise);
        }

        const { data: dayBills, error } = await query;
        
        if (error) throw error;

        const revenue = dayBills?.reduce((sum, bill) => sum + Number(bill.total), 0) || 0;
        const orders = dayBills?.length || 0;
        const avgOrderValue = orders > 0 ? revenue / orders : 0;

        weekData.push({
          day: date.toLocaleDateString('en-US', { weekday: 'short' }),
          date: dateStr,
          revenue,
          orders,
          avgOrderValue,
          dayOfWeek: date.toLocaleDateString('en-US', { weekday: 'long' }),
        });
      }

      console.log('Weekly Data:', weekData);
      setWeeklyData(weekData);
      
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to fetch weekly performance data",
        variant: "destructive",
      });
      console.error('Error fetching weekly data:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = () => {
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
    
    const filename = `weekly-performance-${selectedFranchise}-${new Date().toISOString().split('T')[0]}.xlsx`;
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
              <CardTitle>Weekly Performance (Last 7 Days)</CardTitle>
            </div>
            <div className="flex items-center gap-4">
              {isCentral && (
                <Select value={selectedFranchise} onValueChange={setSelectedFranchise}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Select Franchise" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Franchises</SelectItem>
                    {franchiseList.map(franchise => (
                      <SelectItem key={franchise} value={franchise}>{franchise}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button onClick={exportToExcel} variant="outline">
                <Download className="h-4 w-4 mr-2" />
                Export Excel
              </Button>
            </div>
          </div>
        </CardHeader>
        
        <CardContent>
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
                  <p className="text-2xl font-bold">{bestDay?.dayOfWeek || 'N/A'}</p>
                  <p className="text-xs text-muted-foreground">₹{bestDay?.revenue?.toFixed(2) || '0.00'}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Revenue Trend Chart */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Daily Revenue Trend
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip 
                  formatter={(value: number) => [`₹${value.toFixed(2)}`, 'Revenue']}
                  labelFormatter={(label) => `Day: ${label}`}
                />
                <Line 
                  type="monotone" 
                  dataKey="revenue" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={3}
                  dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2, r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Orders Count Chart */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Daily Orders Count</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip 
                  formatter={(value: number) => [value, 'Orders']}
                  labelFormatter={(label) => `Day: ${label}`}
                />
                <Bar 
                  dataKey="orders" 
                  fill="hsl(var(--secondary))"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}