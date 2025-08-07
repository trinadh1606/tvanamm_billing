import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Building2, TrendingUp, DollarSign, BarChart3 } from 'lucide-react';

interface FranchiseData {
  franchise_id: string;
  totalRevenue: number;
  totalBills: number;
  averageOrderValue: number;
}

export function MultiFranchiseAnalytics() {
  const [franchiseData, setFranchiseData] = useState<FranchiseData[]>([]);
  const [loading, setLoading] = useState(true);
  
  const { toast } = useToast();

  useEffect(() => {
    fetchMultiFranchiseData();
  }, []);

  const fetchMultiFranchiseData = async () => {
    setLoading(true);
    
    try {
      const { data: bills, error } = await supabase
        .from('bills_generated_billing')
        .select('franchise_id, total');
      
      if (error) throw error;

      // Group by franchise and calculate metrics
      const franchiseMap = new Map<string, { revenue: number; count: number }>();
      
      bills?.forEach(bill => {
        const current = franchiseMap.get(bill.franchise_id) || { revenue: 0, count: 0 };
        franchiseMap.set(bill.franchise_id, {
          revenue: current.revenue + Number(bill.total),
          count: current.count + 1,
        });
      });

      const franchiseDataArray: FranchiseData[] = Array.from(franchiseMap.entries()).map(
        ([franchise_id, data]) => ({
          franchise_id,
          totalRevenue: data.revenue,
          totalBills: data.count,
          averageOrderValue: data.count > 0 ? data.revenue / data.count : 0,
        })
      ).sort((a, b) => b.totalRevenue - a.totalRevenue);

      setFranchiseData(franchiseDataArray);
      
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to fetch multi-franchise data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const totalSystemRevenue = franchiseData.reduce((sum, franchise) => sum + franchise.totalRevenue, 0);
  const totalSystemBills = franchiseData.reduce((sum, franchise) => sum + franchise.totalBills, 0);

  if (loading) {
    return <div className="text-center py-8">Loading multi-franchise analytics...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Individual Franchise Cards */}
      {franchiseData.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">No franchise data available</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {franchiseData.map((franchise, index) => (
            <Card key={franchise.franchise_id} className="relative">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{franchise.franchise_id}</CardTitle>
                  <Badge variant={index === 0 ? "default" : "outline"}>
                    #{index + 1}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Revenue */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
                    <p className="text-2xl font-bold">₹{franchise.totalRevenue.toFixed(2)}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-success">
                    <DollarSign className="h-5 w-5 text-white" />
                  </div>
                </div>

                {/* Bills Count */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Bills</p>
                    <p className="text-xl font-semibold">{franchise.totalBills}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-primary">
                    <BarChart3 className="h-5 w-5 text-white" />
                  </div>
                </div>

                {/* Average Order Value */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Avg Order Value</p>
                    <p className="text-xl font-semibold">₹{franchise.averageOrderValue.toFixed(2)}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-secondary">
                    <TrendingUp className="h-5 w-5 text-white" />
                  </div>
                </div>

                {/* Status Indicator */}
                <div className="pt-2 border-t">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-success animate-pulse"></div>
                      <span className="text-sm font-medium text-success">Active</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>System Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <p>Advanced cross-franchise analytics coming soon...</p>
            <p className="text-sm mt-2">Will include comparative analysis, growth trends, and performance predictions</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}