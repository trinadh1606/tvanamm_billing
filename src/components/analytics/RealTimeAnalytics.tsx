import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Activity, TrendingUp, DollarSign, Clock, Zap, AlertCircle } from 'lucide-react';

interface LiveStats {
  currentHourRevenue: number;
  currentHourOrders: number;
  todayRevenue: number;
  todayOrders: number;
  averageOrderValue: number;
  storeStatus: 'quiet' | 'normal' | 'busy' | 'very-busy';
  statusMessage: string;
  lastOrderTime: string | null;
}

interface RecentActivity {
  id: number;
  total: number;
  created_at: string;
  items_count: number;
}

export function RealTimeAnalytics() {
  const [liveStats, setLiveStats] = useState<LiveStats>({
    currentHourRevenue: 0,
    currentHourOrders: 0,
    todayRevenue: 0,
    todayOrders: 0,
    averageOrderValue: 0,
    storeStatus: 'quiet',
    statusMessage: 'Store is quiet',
    lastOrderTime: null,
  });
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  
  const { franchiseId } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    fetchLiveData();
    
    // Set up real-time subscription
    const channel = supabase
      .channel('bills-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bills_generated_billing',
          filter: `franchise_id=eq.${franchiseId}`
        },
        (payload) => {
          console.log('New bill received:', payload);
          fetchLiveData();
          toast({
            title: "New Sale! 🎉",
            description: `₹${Number(payload.new.total).toFixed(2)} - Just now`,
          });
        }
      )
      .subscribe();

    // Refresh data every 30 seconds
    const interval = setInterval(fetchLiveData, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [franchiseId]);

  const fetchLiveData = async () => {
    if (!franchiseId) return;
    
    try {
      const now = new Date();
      const currentHour = now.getHours();
      
      // Use proper IST timezone conversion
      const istNow = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
      const today = istNow.toISOString().split('T')[0];
      const currentHourStart = `${today}T${istNow.getHours().toString().padStart(2, '0')}:00:00`;
      
      console.log('Analytics Debug:', { now: now.toISOString(), istNow: istNow.toISOString(), today, currentHourStart, franchiseId });
      
      // Get today's bills with proper timezone handling
      const { data: todayBills, error: todayError } = await supabase
        .from('bills_generated_billing')
        .select('total, created_at')
        .eq('franchise_id', franchiseId)
        .gte('created_at', today + 'T00:00:00')
        .order('created_at', { ascending: false });

      if (todayError) throw todayError;

      // Get current hour bills
      const currentHourBills = todayBills?.filter(bill => 
        bill.created_at >= currentHourStart
      ) || [];

      // Get recent activity (last 10 orders)
      const { data: recentBills, error: recentError } = await supabase
        .from('bills_generated_billing')
        .select(`
          id,
          total,
          created_at,
          bill_items_generated_billing!inner(id)
        `)
        .eq('franchise_id', franchiseId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (recentError) throw recentError;

      // Calculate stats
      const todayRevenue = todayBills?.reduce((sum, bill) => sum + Number(bill.total), 0) || 0;
      const todayOrders = todayBills?.length || 0;
      const currentHourRevenue = currentHourBills.reduce((sum, bill) => sum + Number(bill.total), 0);
      const currentHourOrders = currentHourBills.length;
      const averageOrderValue = todayOrders > 0 ? todayRevenue / todayOrders : 0;

      // Determine store status based on current hour activity
      let storeStatus: LiveStats['storeStatus'] = 'quiet';
      let statusMessage = 'Store is quiet';
      
      if (currentHourOrders >= 10) {
        storeStatus = 'very-busy';
        statusMessage = 'Store is VERY BUSY! 🔥';
      } else if (currentHourOrders >= 5) {
        storeStatus = 'busy';
        statusMessage = 'Store is busy 📈';
      } else if (currentHourOrders >= 2) {
        storeStatus = 'normal';
        statusMessage = 'Store is moderately active';
      }

      const lastOrderTime = todayBills?.[0]?.created_at || null;

      setLiveStats({
        currentHourRevenue,
        currentHourOrders,
        todayRevenue,
        todayOrders,
        averageOrderValue,
        storeStatus,
        statusMessage,
        lastOrderTime,
      });

      // Format recent activity
      const formattedActivity = recentBills?.map(bill => ({
        id: bill.id,
        total: Number(bill.total),
        created_at: bill.created_at,
        items_count: bill.bill_items_generated_billing?.length || 0,
      })) || [];

      setRecentActivity(formattedActivity);
      
    } catch (error: any) {
      console.error('Error fetching live data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: LiveStats['storeStatus']) => {
    switch (status) {
      case 'very-busy': return 'bg-destructive text-destructive-foreground';
      case 'busy': return 'bg-warning text-warning-foreground';
      case 'normal': return 'bg-success text-success-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getTimeSinceLastOrder = () => {
    if (!liveStats.lastOrderTime) return 'No orders today';
    
    const now = new Date();
    const lastOrder = new Date(liveStats.lastOrderTime);
    const diffMs = now.getTime() - lastOrder.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    return `${diffHours}h ${diffMins % 60}m ago`;
  };

  if (loading) {
    return <div className="text-center py-8">Loading real-time data...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Live Status Banner */}
      <Card className="border-2 border-primary/20">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <Activity className="h-8 w-8 text-primary" />
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-success rounded-full animate-pulse"></div>
              </div>
              <div>
                <h3 className="text-xl font-bold">{liveStats.statusMessage}</h3>
                <p className="text-muted-foreground">Last order: {getTimeSinceLastOrder()}</p>
              </div>
            </div>
            <Badge className={getStatusColor(liveStats.storeStatus)}>
              LIVE
            </Badge>
          </div>
        </CardContent>
      </Card>


      {/* Recent Activity Feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Live Activity Feed
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No recent activity</div>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((activity, index) => (
                <div key={activity.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                    <div>
                      <span className="font-medium">Order #{activity.id}</span>
                      <span className="text-muted-foreground ml-2">
                        {activity.items_count} items
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">₹{activity.total.toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(activity.created_at).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}