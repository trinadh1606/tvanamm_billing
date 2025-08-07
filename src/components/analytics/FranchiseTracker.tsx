import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { 
  Building2, 
  Activity, 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Clock,
  Search,
  AlertCircle,
  CheckCircle2,
  Zap
} from 'lucide-react';

interface FranchiseData {
  franchise_id: string;
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  todayRevenue: number;
  todayOrders: number;
  lastActivity: string;
  isActiveToday: boolean;
  recentOrderTime: string;
  status: 'very-active' | 'active' | 'slow' | 'inactive';
  growth: number;
}

export function FranchiseTracker() {
  const [franchises, setFranchises] = useState<FranchiseData[]>([]);
  const [filteredFranchises, setFilteredFranchises] = useState<FranchiseData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'revenue' | 'orders' | 'activity'>('revenue');
  const { toast } = useToast();

  useEffect(() => {
    fetchFranchiseData();
    
    // Set up real-time subscription
    const channel = supabase
      .channel('franchise-tracker')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bills_generated_billing'
        },
        () => {
          fetchFranchiseData();
        }
      )
      .subscribe();

    const interval = setInterval(fetchFranchiseData, 30000); // Refresh every 30 seconds

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const filtered = franchises.filter(franchise =>
      franchise.franchise_id.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'revenue':
          return b.todayRevenue - a.todayRevenue;
        case 'orders':
          return b.todayOrders - a.todayOrders;
        case 'activity':
          return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
        default:
          return 0;
      }
    });
    
    setFilteredFranchises(sorted);
  }, [franchises, searchTerm, sortBy]);

  const fetchFranchiseData = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Fetch all bills
      const { data: bills, error } = await supabase
        .from('bills_generated_billing')
        .select('franchise_id, total, created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (bills) {
        processFranchiseData(bills, today, yesterday);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to fetch franchise data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const processFranchiseData = (bills: any[], today: string, yesterday: string) => {
    const franchiseMap = new Map<string, {
      totalRevenue: number;
      totalOrders: number;
      todayRevenue: number;
      todayOrders: number;
      yesterdayRevenue: number;
      yesterdayOrders: number;
      lastActivity: string;
      recentOrderTime: string;
    }>();

    bills.forEach(bill => {
      const franchiseId = bill.franchise_id;
      const revenue = Number(bill.total);
      const billDate = bill.created_at.split('T')[0];
      
      const current = franchiseMap.get(franchiseId) || {
        totalRevenue: 0,
        totalOrders: 0,
        todayRevenue: 0,
        todayOrders: 0,
        yesterdayRevenue: 0,
        yesterdayOrders: 0,
        lastActivity: bill.created_at,
        recentOrderTime: bill.created_at
      };

      // Total stats
      current.totalRevenue += revenue;
      current.totalOrders += 1;

      // Today's stats
      if (billDate === today) {
        current.todayRevenue += revenue;
        current.todayOrders += 1;
        if (new Date(bill.created_at) > new Date(current.recentOrderTime)) {
          current.recentOrderTime = bill.created_at;
        }
      }

      // Yesterday's stats
      if (billDate === yesterday) {
        current.yesterdayRevenue += revenue;
        current.yesterdayOrders += 1;
      }

      // Last activity
      if (new Date(bill.created_at) > new Date(current.lastActivity)) {
        current.lastActivity = bill.created_at;
      }

      franchiseMap.set(franchiseId, current);
    });

    const franchiseArray: FranchiseData[] = Array.from(franchiseMap.entries()).map(
      ([franchise_id, data]) => {
        const now = new Date();
        const lastActivityDate = new Date(data.lastActivity);
        const minutesSinceLastActivity = (now.getTime() - lastActivityDate.getTime()) / (1000 * 60);
        const isActiveToday = data.todayOrders > 0;
        
        // Calculate growth
        const growth = data.yesterdayRevenue > 0 
          ? ((data.todayRevenue - data.yesterdayRevenue) / data.yesterdayRevenue) * 100 
          : data.todayRevenue > 0 ? 100 : 0;

        // Determine status
        let status: 'very-active' | 'active' | 'slow' | 'inactive';
        if (minutesSinceLastActivity < 30) {
          status = 'very-active';
        } else if (minutesSinceLastActivity < 120) {
          status = 'active';
        } else if (isActiveToday) {
          status = 'slow';
        } else {
          status = 'inactive';
        }

        return {
          franchise_id,
          totalRevenue: data.totalRevenue,
          totalOrders: data.totalOrders,
          avgOrderValue: data.totalOrders > 0 ? data.totalRevenue / data.totalOrders : 0,
          todayRevenue: data.todayRevenue,
          todayOrders: data.todayOrders,
          lastActivity: data.lastActivity,
          isActiveToday,
          recentOrderTime: data.recentOrderTime,
          status,
          growth
        };
      }
    ).sort((a, b) => b.todayRevenue - a.todayRevenue);

    setFranchises(franchiseArray);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'very-active':
        return <Zap className="h-4 w-4 text-green-500" />;
      case 'active':
        return <CheckCircle2 className="h-4 w-4 text-blue-500" />;
      case 'slow':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'inactive':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Activity className="h-4 w-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'very-active':
        return 'bg-green-500';
      case 'active':
        return 'bg-blue-500';
      case 'slow':
        return 'bg-yellow-500';
      case 'inactive':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
    return `${Math.floor(diffMinutes / 1440)}d ago`;
  };

  if (loading) {
    return <div className="text-center py-8">Loading franchise tracker...</div>;
  }

  const activeCount = franchises.filter(f => f.status === 'very-active' || f.status === 'active').length;
  const totalTodayRevenue = franchises.reduce((sum, f) => sum + f.todayRevenue, 0);
  const totalTodayOrders = franchises.reduce((sum, f) => sum + f.todayOrders, 0);

  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Franchises</p>
                <p className="text-2xl font-bold">{franchises.length}</p>
              </div>
              <div className="p-2 rounded-lg bg-primary">
                <Building2 className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Now</p>
                <p className="text-2xl font-bold">{activeCount}</p>
                <p className="text-xs text-muted-foreground">
                  {((activeCount / franchises.length) * 100).toFixed(0)}% active
                </p>
              </div>
              <div className="p-2 rounded-lg bg-green-500">
                <Activity className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Today's Revenue</p>
                <p className="text-2xl font-bold">₹{totalTodayRevenue.toFixed(0)}</p>
              </div>
              <div className="p-2 rounded-lg bg-success">
                <DollarSign className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Today's Orders</p>
                <p className="text-2xl font-bold">{totalTodayOrders}</p>
              </div>
              <div className="p-2 rounded-lg bg-secondary">
                <TrendingUp className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search franchises..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-xs"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant={sortBy === 'revenue' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSortBy('revenue')}
          >
            Revenue
          </Button>
          <Button
            variant={sortBy === 'orders' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSortBy('orders')}
          >
            Orders
          </Button>
          <Button
            variant={sortBy === 'activity' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSortBy('activity')}
          >
            Activity
          </Button>
        </div>
      </div>

      {/* Franchise List */}
      <div className="grid gap-4">
        {filteredFranchises.map((franchise) => (
          <Card key={franchise.franchise_id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${getStatusColor(franchise.status)}`} />
                    {getStatusIcon(franchise.status)}
                  </div>
                  <div>
                    <div className="font-medium text-lg">{franchise.franchise_id}</div>
                    <div className="text-sm text-muted-foreground">
                      Last active: {formatTimeAgo(franchise.lastActivity)}
                    </div>
                    {franchise.isActiveToday && (
                      <div className="text-xs text-muted-foreground">
                        Recent order: {formatTimeAgo(franchise.recentOrderTime)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <div className="text-sm text-muted-foreground">Today</div>
                    <div className="font-bold">₹{franchise.todayRevenue.toFixed(0)}</div>
                    <div className="text-xs text-muted-foreground">{franchise.todayOrders} orders</div>
                  </div>

                  <div className="text-center">
                    <div className="text-sm text-muted-foreground">Total</div>
                    <div className="font-bold">₹{franchise.totalRevenue.toFixed(0)}</div>
                    <div className="text-xs text-muted-foreground">₹{franchise.avgOrderValue.toFixed(0)} avg</div>
                  </div>

                  <div className="text-center">
                    <div className="text-sm text-muted-foreground">Growth</div>
                    <div className={`font-bold flex items-center gap-1 ${franchise.growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {franchise.growth >= 0 ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : (
                        <TrendingDown className="h-3 w-3" />
                      )}
                      {Math.abs(franchise.growth).toFixed(1)}%
                    </div>
                  </div>

                  <Badge variant={franchise.status === 'very-active' || franchise.status === 'active' ? 'default' : 'secondary'}>
                    {franchise.status.replace('-', ' ')}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}