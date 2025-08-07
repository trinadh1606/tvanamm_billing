import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, Store, Users, TrendingUp, Activity } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface FranchiseInfo {
  franchise_id: string;
  todayRevenue: number;
  todayOrders: number;
  lastActivity: string | null;
  status: 'active' | 'inactive';
}

export function OtherFranchisesAnalytics() {
  const [franchise, setFranchise] = useState<FranchiseInfo | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchFranchiseData = async (franchiseId: string) => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];

      // Fetch bills generated for the given franchise
      const { data: bills, error } = await supabase
        .from('bills_generated_billing')
        .select('franchise_id, total, created_at')
        .eq('franchise_id', franchiseId)  // Fetch bills for the entered franchise
        .gte('created_at', today)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Calculate the revenue and orders for today
      const revenue = bills?.reduce((sum, bill) => sum + Number(bill.total), 0) || 0;
      const orders = bills?.length || 0;
      const lastActivity = bills?.[0]?.created_at || null;

      const status = orders > 0 ? 'active' : 'inactive';

      setFranchise({
        franchise_id: franchiseId,
        todayRevenue: revenue,
        todayOrders: orders,
        lastActivity,
        status
      });
    } catch (error) {
      console.error('Error fetching franchise data:', error);
      setFranchise(null);
    } finally {
      setLoading(false);
    }
  };

  const formatTimeAgo = (dateString: string | null) => {
    if (!dateString) return 'No activity today';
    
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (diffHours > 0) {
      return `${diffHours}h ${diffMins}m ago`;
    }
    return `${diffMins}m ago`;
  };

  const getStatusColor = (status: 'active' | 'inactive') => {
    return status === 'active' 
      ? 'bg-success text-success-foreground' 
      : 'bg-muted text-muted-foreground';
  };

  const handleSearchClick = () => {
    if (searchTerm) {
      const franchiseId = `FR-${searchTerm}`; // Prepend "FR-" to the entered number
      fetchFranchiseData(franchiseId);  // Fetch franchise details when button is clicked
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading franchise analytics...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            Franchise Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Enter franchise ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button
              onClick={handleSearchClick}
              disabled={!searchTerm}
              className="ml-4"
            >
              Get Details
            </Button>
          </div>

          {/* Franchise Details */}
          {franchise ? (
            <div className="space-y-4">
              {/* Franchise Overview */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <Card className="bg-muted/50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-success" />
                      <span className="text-sm font-medium">Total Revenue</span>
                    </div>
                    <p className="text-xl font-bold">
                      ₹{franchise.todayRevenue.toFixed(2)}
                    </p>
                  </CardContent>
                </Card>

                <Card className="bg-muted/50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Total Orders</span>
                    </div>
                    <p className="text-xl font-bold">
                      {franchise.todayOrders}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Franchise Info */}
              <div className="space-y-3">
                <h3 className="text-lg font-medium">Franchise Info</h3>
                <div className="flex justify-between">
                  <span className="text-sm">Franchise ID:</span>
                  <span className="font-medium">{franchise.franchise_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Status:</span>
                  <Badge className={getStatusColor(franchise.status)}>
                    {franchise.status}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Last Activity:</span>
                  <span className="text-xs">{formatTimeAgo(franchise.lastActivity)}</span>
                </div>
              </div>

              <Button size="sm" className="mt-3 w-full">View Detailed Analytics</Button>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              No data found for franchise ID "{searchTerm}"
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
