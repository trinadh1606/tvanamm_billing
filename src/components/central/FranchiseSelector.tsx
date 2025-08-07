import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, Store, Filter } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface FranchiseOption {
  franchise_id: string;
  todayRevenue: number;
  todayOrders: number;
  status: 'active' | 'inactive';
  lastActivity: string | null;
}

interface FranchiseSelectorProps {
  selectedFranchise: string;
  onFranchiseSelect: (franchiseId: string) => void;
  excludeCentral?: boolean;
}

export function FranchiseSelector({ 
  selectedFranchise, 
  onFranchiseSelect, 
  excludeCentral = true 
}: FranchiseSelectorProps) {
  const [franchises, setFranchises] = useState<FranchiseOption[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFranchises();
  }, [excludeCentral]);

  const fetchFranchises = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Build query
      let query = supabase
        .from('bills_generated_billing')
        .select('franchise_id, total, created_at');
      
      if (excludeCentral) {
        query = query.neq('franchise_id', 'FR-CENTRAL');
      }
      
      const { data: bills, error } = await query.gte('created_at', today);

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

      // Get all unique franchise IDs
      let allQuery = supabase
        .from('bills_generated_billing')
        .select('franchise_id');
        
      if (excludeCentral) {
        allQuery = allQuery.neq('franchise_id', 'FR-CENTRAL');
      }
      
      const { data: allFranchiseBills, error: allError } = await allQuery;

      if (allError) throw allError;

      const allFranchiseIds = new Set(
        allFranchiseBills?.map(bill => bill.franchise_id) || []
      );

      // Convert to array format
      const franchisesArray: FranchiseOption[] = Array.from(allFranchiseIds).map(id => {
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
      }).sort((a, b) => {
        // Sort by status first (active first), then by revenue
        if (a.status !== b.status) {
          return a.status === 'active' ? -1 : 1;
        }
        return b.todayRevenue - a.todayRevenue;
      });

      setFranchises(franchisesArray);

    } catch (error) {
      console.error('Error fetching franchises:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredFranchises = franchises.filter(franchise => {
    const matchesSearch = franchise.franchise_id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || franchise.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: 'active' | 'inactive') => {
    return status === 'active' 
      ? 'bg-success text-success-foreground' 
      : 'bg-muted text-muted-foreground';
  };

  if (loading) {
    return <div className="text-center py-4">Loading franchises...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Store className="h-5 w-5" />
          Select Franchise
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search and Filter */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search franchise ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-1">
            <Button
              variant={statusFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter('all')}
            >
              All
            </Button>
            <Button
              variant={statusFilter === 'active' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter('active')}
            >
              Active
            </Button>
            <Button
              variant={statusFilter === 'inactive' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter('inactive')}
            >
              Inactive
            </Button>
          </div>
        </div>

        {/* Franchise List */}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {filteredFranchises.map((franchise) => (
            <div
              key={franchise.franchise_id}
              className={`p-3 rounded-lg border cursor-pointer transition-all hover:bg-muted/50 ${
                selectedFranchise === franchise.franchise_id 
                  ? 'border-primary bg-primary/5' 
                  : 'border-border'
              }`}
              onClick={() => onFranchiseSelect(franchise.franchise_id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{franchise.franchise_id}</span>
                  <Badge className={getStatusColor(franchise.status)}>
                    {franchise.status}
                  </Badge>
                </div>
                <div className="text-right text-sm">
                  <div className="font-medium">₹{franchise.todayRevenue.toFixed(2)}</div>
                  <div className="text-muted-foreground">{franchise.todayOrders} orders</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filteredFranchises.length === 0 && (
          <div className="text-center py-4 text-muted-foreground">
            No franchises found
          </div>
        )}

        {/* Quick Stats */}
        <div className="pt-2 border-t">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total Active:</span>
            <span className="font-medium">
              {franchises.filter(f => f.status === 'active').length}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Combined Revenue:</span>
            <span className="font-medium">
              ₹{franchises.reduce((sum, f) => sum + f.todayRevenue, 0).toFixed(2)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}