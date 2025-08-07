import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Building2, Clock, TrendingUp, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

// Import analytics components but they'll be modified to show FR-CENTRAL data specifically
import { IndividualFranchiseAnalytics } from './IndividualFranchiseAnalytics';

interface FRCentralStats {
  todayRevenue: number;
  todayOrders: number;
  currentHourRevenue: number;
  status: 'quiet' | 'normal' | 'busy' | 'very-busy';
  lastActivity: string | null;
}

export function FRCentralDashboard() {
  const [stats, setStats] = useState<FRCentralStats>({
    todayRevenue: 0,
    todayOrders: 0,
    currentHourRevenue: 0,
    status: 'quiet',
    lastActivity: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFRCentralStats();
    
    // Set up real-time subscription for FR-CENTRAL only
    const channel = supabase
      .channel('fr-central-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bills_generated_billing',
          filter: 'franchise_id=eq.FR-CENTRAL'
        },
        () => {
          fetchFRCentralStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchFRCentralStats = async () => {
    try {
      const now = new Date();
      
      // Use proper IST timezone conversion  
      const istNow = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
      const today = istNow.toISOString().split('T')[0];
      const currentHour = istNow.getHours();
      const currentHourStart = `${today}T${istNow.getHours().toString().padStart(2, '0')}:00:00`;

      console.log('FR-CENTRAL Debug:', { now: now.toISOString(), istNow: istNow.toISOString(), today, currentHourStart });

      // Get today's bills for FR-CENTRAL only with proper timezone handling
      const { data: todayBills, error } = await supabase
        .from('bills_generated_billing')
        .select('total, created_at')
        .eq('franchise_id', 'FR-CENTRAL')
        .gte('created_at', today + 'T00:00:00')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const todayRevenue = todayBills?.reduce((sum, bill) => sum + Number(bill.total), 0) || 0;
      const todayOrders = todayBills?.length || 0;
      
      const currentHourBills = todayBills?.filter(bill => 
        bill.created_at >= currentHourStart
      ) || [];
      const currentHourRevenue = currentHourBills.reduce((sum, bill) => sum + Number(bill.total), 0);

      // Determine status based on current hour activity
      let status: FRCentralStats['status'] = 'quiet';
      if (currentHourBills.length >= 10) {
        status = 'very-busy';
      } else if (currentHourBills.length >= 5) {
        status = 'busy';
      } else if (currentHourBills.length >= 2) {
        status = 'normal';
      }

      setStats({
        todayRevenue,
        todayOrders,
        currentHourRevenue,
        status,
        lastActivity: todayBills?.[0]?.created_at || null,
      });

    } catch (error) {
      console.error('Error fetching FR-CENTRAL stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: FRCentralStats['status']) => {
    switch (status) {
      case 'very-busy': return 'bg-destructive text-destructive-foreground';
      case 'busy': return 'bg-warning text-warning-foreground';
      case 'normal': return 'bg-success text-success-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusMessage = (status: FRCentralStats['status']) => {
    switch (status) {
      case 'very-busy': return 'VERY BUSY! 🔥';
      case 'busy': return 'Busy Period 📈';
      case 'normal': return 'Normal Activity';
      default: return 'Quiet Period';
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading FR-CENTRAL analytics...</div>;
  }

  return (
    <div className="space-y-6">

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Today's Revenue</p>
                <p className="text-2xl font-bold">₹{stats.todayRevenue.toFixed(2)}</p>
              </div>
              <TrendingUp className="h-6 w-6 text-success" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Today's Orders</p>
                <p className="text-2xl font-bold">{stats.todayOrders}</p>
              </div>
              <Clock className="h-6 w-6 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg Order Value</p>
                <p className="text-2xl font-bold">
                  ₹{stats.todayOrders > 0 ? (stats.todayRevenue / stats.todayOrders).toFixed(2) : '0.00'}
                </p>
              </div>
              <Building2 className="h-6 w-6 text-secondary" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Analytics Tabs */}
      <Tabs defaultValue="realtime" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="realtime">Real-time</TabsTrigger>
          <TabsTrigger value="hourly">Hourly Analysis</TabsTrigger>
          <TabsTrigger value="popular">Popular Items</TabsTrigger>
          <TabsTrigger value="predictions">AI Insights</TabsTrigger>
        </TabsList>
        
        <TabsContent value="realtime">
          <IndividualFranchiseAnalytics franchiseId="FR-CENTRAL" />
        </TabsContent>
        
        <TabsContent value="hourly">
          <IndividualFranchiseAnalytics franchiseId="FR-CENTRAL" />
        </TabsContent>
        
        <TabsContent value="popular">
          <IndividualFranchiseAnalytics franchiseId="FR-CENTRAL" />
        </TabsContent>
        
        <TabsContent value="predictions">
          <IndividualFranchiseAnalytics franchiseId="FR-CENTRAL" />
        </TabsContent>
      </Tabs>
    </div>
  );
}