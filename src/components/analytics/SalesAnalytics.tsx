import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { TrendingUp, DollarSign, ShoppingBag, Calendar } from 'lucide-react';
import { RealTimeAnalytics } from './RealTimeAnalytics';
import { HourlySalesChart } from './HourlySalesChart';
import { PopularItemsLive } from './PopularItemsLive';
import { PredictiveInsights } from './PredictiveInsights';

interface SalesData {
  totalRevenue: number;
  totalBills: number;
  averageOrderValue: number;
  todayRevenue: number;
}

export function SalesAnalytics() {
  const [salesData, setSalesData] = useState<SalesData>({
    totalRevenue: 0,
    totalBills: 0,
    averageOrderValue: 0,
    todayRevenue: 0,
  });
  const [loading, setLoading] = useState(true);
  
  const { franchiseId } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    fetchSalesData();
  }, [franchiseId]);

  const fetchSalesData = async () => {
    if (!franchiseId) return;
    
    setLoading(true);
    
    try {
      // Get all bills for this franchise
      const { data: bills, error } = await supabase
        .from('bills_generated_billing')
        .select('total, created_at')
        .eq('franchise_id', franchiseId);
      
      if (error) throw error;

      const totalRevenue = bills?.reduce((sum, bill) => sum + Number(bill.total), 0) || 0;
      const totalBills = bills?.length || 0;
      const averageOrderValue = totalBills > 0 ? totalRevenue / totalBills : 0;
      
      // Calculate today's revenue
      const today = new Date().toISOString().split('T')[0];
      const todayRevenue = bills?.filter(bill => 
        bill.created_at.startsWith(today)
      ).reduce((sum, bill) => sum + Number(bill.total), 0) || 0;

      setSalesData({
        totalRevenue,
        totalBills,
        averageOrderValue,
        todayRevenue,
      });
      
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to fetch sales data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const StatCard = ({ 
    title, 
    value, 
    icon: Icon, 
    color 
  }: { 
    title: string; 
    value: string; 
    icon: any; 
    color: string; 
  }) => (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
          <div className={`p-2 rounded-lg ${color}`}>
            <Icon className="h-6 w-6 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (loading) {
    return <div className="text-center py-8">Loading analytics...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Quick Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Revenue"
          value={`₹${salesData.totalRevenue.toFixed(2)}`}
          icon={DollarSign}
          color="bg-success"
        />
        <StatCard
          title="Total Bills"
          value={salesData.totalBills.toString()}
          icon={ShoppingBag}
          color="bg-primary"
        />
        <StatCard
          title="Average Order Value"
          value={`₹${salesData.averageOrderValue.toFixed(2)}`}
          icon={TrendingUp}
          color="bg-secondary"
        />
        <StatCard
          title="Today's Revenue"
          value={`₹${salesData.todayRevenue.toFixed(2)}`}
          icon={Calendar}
          color="bg-warning"
        />
      </div>

      {/* Advanced Analytics Tabs */}
      <Tabs defaultValue="realtime" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="realtime">Real-Time</TabsTrigger>
          <TabsTrigger value="hourly">Hourly Trends</TabsTrigger>
          <TabsTrigger value="items">Popular Items</TabsTrigger>
        </TabsList>
        
        <TabsContent value="realtime" className="mt-6">
          <RealTimeAnalytics />
        </TabsContent>
        
        <TabsContent value="hourly" className="mt-6">
          <HourlySalesChart />
        </TabsContent>
        
        <TabsContent value="items" className="mt-6">
          <PopularItemsLive />
        </TabsContent>
        
        <TabsContent value="predictions" className="mt-6">
          <PredictiveInsights />
        </TabsContent>
      </Tabs>
    </div>
  );
}