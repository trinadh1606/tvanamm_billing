import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Star, TrendingUp, Coffee, Award } from 'lucide-react';

interface PopularItem {
  item_name: string;
  total_quantity: number;
  total_revenue: number;
  percentage: number;
  growth: number;
  category?: string;
}

interface CategoryData {
  category: string;
  revenue: number;
  items: number;
  color: string;
  percentage: number;
}

export function PopularItemsLive() {
  const [popularItems, setPopularItems] = useState<PopularItem[]>([]);
  const [categoryData, setCategoryData] = useState<CategoryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState<string[]>([]);
  
  const { franchiseId } = useAuth();

  useEffect(() => {
    fetchPopularItems();

    // Set up real-time subscription for new orders
    const channel = supabase
      .channel('items-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bill_items_generated_billing',
          filter: `franchise_id=eq.${franchiseId}`
        },
        () => {
          console.log('New item sold, refreshing popular items...');
          fetchPopularItems();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [franchiseId]);

  const fetchPopularItems = async () => {
    if (!franchiseId) return;
    
    setLoading(true);
    
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Get today's bill items with menu details - join with bills for date filtering
      const { data: todayItems, error: todayError } = await supabase
        .from('bill_items_generated_billing')
        .select(`
          item_name,
          qty,
          price,
          menu_item_id,
          menu_items!inner(category),
          bills_generated_billing!inner(created_at)
        `)
        .eq('franchise_id', franchiseId)
        .gte('bills_generated_billing.created_at', today);

      if (todayError) throw todayError;

      // Get yesterday's data for growth comparison
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      const { data: yesterdayItems, error: yesterdayError } = await supabase
        .from('bill_items_generated_billing')
        .select(`
          item_name, 
          qty,
          bills_generated_billing!inner(created_at)
        `)
        .eq('franchise_id', franchiseId)
        .gte('bills_generated_billing.created_at', yesterdayStr)
        .lt('bills_generated_billing.created_at', today);

      if (yesterdayError) throw yesterdayError;

      // Process today's data
      const itemMap = new Map<string, { 
        quantity: number; 
        revenue: number; 
        category: string; 
      }>();

      todayItems?.forEach(item => {
        const current = itemMap.get(item.item_name) || { 
          quantity: 0, 
          revenue: 0, 
          category: item.menu_items?.category || 'Other' 
        };
        itemMap.set(item.item_name, {
          quantity: current.quantity + item.qty,
          revenue: current.revenue + (item.qty * Number(item.price)),
          category: current.category,
        });
      });

      // Process yesterday's data for growth comparison
      const yesterdayMap = new Map<string, number>();
      yesterdayItems?.forEach(item => {
        const current = yesterdayMap.get(item.item_name) || 0;
        yesterdayMap.set(item.item_name, current + item.qty);
      });

      // Calculate total for percentages
      const totalQuantity = Array.from(itemMap.values()).reduce((sum, item) => sum + item.quantity, 0);
      const totalRevenue = Array.from(itemMap.values()).reduce((sum, item) => sum + item.revenue, 0);

      // Convert to array and calculate percentages and growth
      const itemsArray: PopularItem[] = Array.from(itemMap.entries())
        .map(([name, data]) => {
          const yesterdayQty = yesterdayMap.get(name) || 0;
          const growth = yesterdayQty > 0 ? ((data.quantity - yesterdayQty) / yesterdayQty) * 100 : 0;
          
          return {
            item_name: name,
            total_quantity: data.quantity,
            total_revenue: data.revenue,
            percentage: totalQuantity > 0 ? (data.quantity / totalQuantity) * 100 : 0,
            growth,
            category: data.category,
          };
        })
        .sort((a, b) => b.total_quantity - a.total_quantity)
        .slice(0, 10);

      // Calculate category data
      const categoryMap = new Map<string, { revenue: number; items: number }>();
      const colors = [
        'hsl(var(--primary))',
        'hsl(var(--success))',
        'hsl(var(--warning))',
        'hsl(var(--secondary))',
        'hsl(var(--destructive))',
      ];

      itemsArray.forEach(item => {
        const current = categoryMap.get(item.category || 'Other') || { revenue: 0, items: 0 };
        categoryMap.set(item.category || 'Other', {
          revenue: current.revenue + item.total_revenue,
          items: current.items + 1,
        });
      });

      const categoriesArray: CategoryData[] = Array.from(categoryMap.entries())
        .map(([category, data], index) => ({
          category,
          revenue: data.revenue,
          items: data.items,
          color: colors[index % colors.length],
          percentage: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue);

      // Generate insights
      const newInsights: string[] = [];
      
      if (itemsArray.length > 0) {
        const topItem = itemsArray[0];
        newInsights.push(`🏆 "${topItem.item_name}" is your bestseller with ${topItem.total_quantity} sold today`);
        
        if (topItem.growth > 20) {
          newInsights.push(`📈 "${topItem.item_name}" sales are up ${topItem.growth.toFixed(1)}% from yesterday!`);
        }
      }

      const fastMovingItems = itemsArray.filter(item => item.growth > 50);
      if (fastMovingItems.length > 0) {
        newInsights.push(`🚀 ${fastMovingItems.length} items showing strong growth today`);
      }

      if (categoriesArray.length > 0) {
        const topCategory = categoriesArray[0];
        newInsights.push(`💡 "${topCategory.category}" category leads with ₹${topCategory.revenue.toFixed(2)} revenue`);
      }

      setPopularItems(itemsArray);
      setCategoryData(categoriesArray);
      setInsights(newInsights);
      
    } catch (error: any) {
      console.error('Error fetching popular items:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading popular items...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coffee className="h-5 w-5" />
              Sales by Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    dataKey="revenue"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    innerRadius={60}
                    paddingAngle={5}
                    label={({ percentage }) => `${percentage.toFixed(1)}%`}
                    labelLine={false}
                  >
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <ChartTooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Items List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Detailed Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Category Legend */}
          <div className="flex flex-wrap gap-3 mb-4">
            {categoryData.map((category) => (
              <div key={category.category} className="flex items-center gap-2">
                <div 
                  className="w-4 h-4 rounded-full" 
                  style={{ backgroundColor: category.color }}
                />
                <span className="text-sm">
                  {category.category} ({category.percentage.toFixed(1)}%)
                </span>
              </div>
            ))}
          </div>
          
          {/* Items List */}
          <div className="space-y-3">
            {popularItems.map((item, index) => {
              const category = categoryData.find(c => c.category === item.category) || categoryData[0];
              const categoryColor = category?.color || 'hsl(var(--primary))';
              
              return (
                <div key={item.item_name} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                      <span className="text-sm font-bold text-primary">#{index + 1}</span>
                    </div>
                    <div>
                      <span className="font-medium">{item.item_name}</span>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <div 
                          className="w-2 h-2 rounded-full" 
                          style={{ backgroundColor: categoryColor }}
                        />
                        {item.category} • {item.percentage.toFixed(1)}% of sales
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">{item.total_quantity} sold</div>
                    <div className="text-xs text-muted-foreground">
                    </div>
                    {item.growth !== 0 && (
                      <Badge 
                        variant="outline" 
                        className={item.growth > 0 ? 'text-success' : 'text-destructive'}
                      >
                        {item.growth > 0 ? '+' : ''}{item.growth.toFixed(1)}%
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}