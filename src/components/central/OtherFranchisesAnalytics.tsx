import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FranchiseSelector } from './FranchiseSelector';
import { IndividualFranchiseAnalytics } from './IndividualFranchiseAnalytics';
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
  const [franchises, setFranchises] = useState<FranchiseInfo[]>([]);
  const [selectedFranchise, setSelectedFranchise] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOtherFranchises();
  }, []);

  const fetchOtherFranchises = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Get all bills from non-central franchises
      const { data: bills, error } = await supabase
        .from('bills_generated_billing')
        .select('franchise_id, total, created_at')
        .neq('franchise_id', 'FR-CENTRAL')
        .gte('created_at', today)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Group by franchise
      const franchiseMap = new Map<string, {
        revenue: number;
        orders: number;
        lastActivity: string | null;
      }>();

      bills?.forEach(bill => {
        const current = franchiseMap.get(bill.franchise_id) || {
          revenue: 0,
          orders: 0,
          lastActivity: null
        };
        
        franchiseMap.set(bill.franchise_id, {
          revenue: current.revenue + Number(bill.total),
          orders: current.orders + 1,
          lastActivity: current.lastActivity || bill.created_at
        });
      });

      // Get all unique franchise IDs (including those with no activity today)
      const { data: allFranchiseBills, error: allError } = await supabase
        .from('bills_generated_billing')
        .select('franchise_id')
        .neq('franchise_id', 'FR-CENTRAL');

      if (allError) throw allError;

      const allFranchiseIds = new Set(
        allFranchiseBills?.map(bill => bill.franchise_id) || []
      );

      // Convert to array format
      const franchisesArray: FranchiseInfo[] = Array.from(allFranchiseIds).map(id => {
        const data = franchiseMap.get(id) || {
          revenue: 0,
          orders: 0,
          lastActivity: null
        };

        return {
          franchise_id: id,
          todayRevenue: data.revenue,
          todayOrders: data.orders,
          lastActivity: data.lastActivity,
          status: (data.orders > 0 ? 'active' : 'inactive') as 'active' | 'inactive'
        };
      }).sort((a, b) => b.todayRevenue - a.todayRevenue);

      setFranchises(franchisesArray);
      
      // Auto-select first franchise if none selected
      if (!selectedFranchise && franchisesArray.length > 0) {
        setSelectedFranchise(franchisesArray[0].franchise_id);
      }

    } catch (error) {
      console.error('Error fetching other franchises:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredFranchises = franchises.filter(franchise =>
    franchise.franchise_id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusColor = (status: 'active' | 'inactive') => {
    return status === 'active' 
      ? 'bg-success text-success-foreground' 
      : 'bg-muted text-muted-foreground';
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
            Other Franchises Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search franchise ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {filteredFranchises.length} franchises
              </span>
            </div>
          </div>

          {/* Overview Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-success" />
                  <span className="text-sm font-medium">Total Revenue</span>
                </div>
                <p className="text-xl font-bold">
                  ₹{filteredFranchises.reduce((sum, f) => sum + f.todayRevenue, 0).toFixed(2)}
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
                  {filteredFranchises.reduce((sum, f) => sum + f.todayOrders, 0)}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Store className="h-4 w-4 text-warning" />
                  <span className="text-sm font-medium">Active Franchises</span>
                </div>
                <p className="text-xl font-bold">
                  {filteredFranchises.filter(f => f.status === 'active').length}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Franchise List */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredFranchises.map((franchise) => (
              <Card 
                key={franchise.franchise_id}
                className={`cursor-pointer transition-all hover:shadow-md ${
                  selectedFranchise === franchise.franchise_id 
                    ? 'border-2 border-primary/50 bg-primary/5' 
                    : ''
                }`}
                onClick={() => setSelectedFranchise(franchise.franchise_id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold">{franchise.franchise_id}</h3>
                    <Badge className={getStatusColor(franchise.status)}>
                      {franchise.status}
                    </Badge>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Revenue:</span>
                      <span className="font-medium">₹{franchise.todayRevenue.toFixed(2)}</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Orders:</span>
                      <span className="font-medium">{franchise.todayOrders}</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Last Activity:</span>
                      <span className="text-xs">{formatTimeAgo(franchise.lastActivity)}</span>
                    </div>
                  </div>
                  
                  {selectedFranchise === franchise.franchise_id && (
                    <Button size="sm" className="w-full mt-3">
                      View Details
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredFranchises.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No franchises found matching "{searchTerm}"
            </div>
          )}
        </CardContent>
      </Card>

      {/* Selected Franchise Analytics */}
      {selectedFranchise && (
        <IndividualFranchiseAnalytics franchiseId={selectedFranchise} />
      )}
    </div>
  );
}