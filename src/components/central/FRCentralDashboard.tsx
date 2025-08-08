import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Building2, Clock, TrendingUp, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
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
  const [activeTab, setActiveTab] = useState('realtime');

  useEffect(() => {
    fetchFRCentralStats();
    
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
      const istNow = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
      const today = istNow.toISOString().split('T')[0];
      const currentHourStart = `${today}T${istNow.getHours().toString().padStart(2, '0')}:00:00`;

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
<Tabs defaultValue="realtime" className="w-full" onValueChange={(value) => setActiveTab(value)}>

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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Detailed Performance Insights
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Performance Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm font-medium text-muted-foreground">Peak Hour</div>
                      <div className="text-2xl font-bold">2:00 PM</div>
                      <div className="text-xs text-muted-foreground">Highest sales volume</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm font-medium text-muted-foreground">Best Seller</div>
                      <div className="text-2xl font-bold">Chicken Biryani</div>
                      <div className="text-xs text-muted-foreground">45 orders today</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm font-medium text-muted-foreground">Upsell Potential</div>
                      <div className="text-2xl font-bold">₹1,250</div>
                      <div className="text-xs text-muted-foreground">Estimated additional revenue</div>
                    </CardContent>
                  </Card>
                </div>

                {/* AI Recommendations */}
                <Card>
                  <CardHeader>
                    <CardTitle>AI Recommendations</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="p-4 bg-muted/50 rounded-lg">
                        <h4 className="font-medium">Staff Allocation</h4>
                        <p className="text-sm text-muted-foreground">
                          Based on current trends, recommend adding 1 more staff member between 1-3 PM.
                        </p>
                      </div>
                      <div className="p-4 bg-muted/50 rounded-lg">
                        <h4 className="font-medium">Inventory Suggestion</h4>
                        <p className="text-sm text-muted-foreground">
                          Increase chicken biryani prep by 20% for dinner service.
                        </p>
                      </div>
                      <div className="p-4 bg-muted/50 rounded-lg">
                        <h4 className="font-medium">Promotion Opportunity</h4>
                        <p className="text-sm text-muted-foreground">
                          Bundle naan with curries could increase average order value by ₹75.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Performance Trends */}
                <Card>
                  <CardHeader>
                    <CardTitle>Performance Trends</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span>Today vs Yesterday</span>
                        <Badge variant="outline" className="text-success">
                          +15.2%
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Today vs Same Day Last Week</span>
                        <Badge variant="outline" className="text-success">
                          +8.7%
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Current Hour vs Same Hour Yesterday</span>
                        <Badge variant="outline" className="text-destructive">
                          -3.1%
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}