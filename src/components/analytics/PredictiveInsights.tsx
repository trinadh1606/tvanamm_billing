import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Lightbulb } from 'lucide-react';

interface BusinessInsight {
  title: string;
  content: string;
  type: 'optimization' | 'growth';
  icon: string;
  color: string;
}

interface ItemTrend {
  item_name: string;
  slope: number;
  intercept: number;
  rSquared: number;
  totalSold: number;
  totalRevenue: number;
}

export function PredictiveInsights() {
  const [insights, setInsights] = useState<BusinessInsight[]>([]);
  const [itemTrends, setItemTrends] = useState<ItemTrend[]>([]);
  const [loading, setLoading] = useState(true);
  
  const { franchiseId } = useAuth();

  useEffect(() => {
    generateInsights();
  }, [franchiseId]);

  const generateInsights = async () => {
    if (!franchiseId) return;
    
    setLoading(true);
    
    try {
      // Get last 30 days of item data
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { data: itemsData, error } = await supabase
        .from('bill_items_generated_billing')
        .select(`
          item_name, 
          qty,
          price,
          created_at,
          bills_generated_billing!inner(franchise_id)
        `)
        .eq('bills_generated_billing.franchise_id', franchiseId)
        .gte('created_at', thirtyDaysAgo.toISOString());

      if (error) throw error;

      // Process data for linear regression
      const trends = analyzeItemTrends(itemsData || []);
      setItemTrends(trends);
      
      // Generate AI insights based on trends
      const newInsights = generateBusinessInsights(trends);
      setInsights(newInsights);
      
    } catch (error: any) {
      console.error('Error generating insights:', error);
    } finally {
      setLoading(false);
    }
  };

  // Linear regression implementation
  const linearRegression = (x: number[], y: number[]) => {
    const n = x.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    
    for (let i = 0; i < n; i++) {
      sumX += x[i];
      sumY += y[i];
      sumXY += x[i] * y[i];
      sumXX += x[i] * x[i];
    }
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // Calculate R-squared
    let ssTot = 0, ssRes = 0;
    const meanY = sumY / n;
    
    for (let i = 0; i < n; i++) {
      const fit = slope * x[i] + intercept;
      ssTot += Math.pow(y[i] - meanY, 2);
      ssRes += Math.pow(y[i] - fit, 2);
    }
    
    const rSquared = 1 - (ssRes / ssTot);
    
    return { slope, intercept, rSquared };
  };

  const analyzeItemTrends = (items: any[]): ItemTrend[] => {
    // Group items by name and day
    const itemMap = new Map<string, {day: number, qty: number, revenue: number}[]>();
    
    items.forEach(item => {
      const date = new Date(item.created_at);
      // Use day of year as x value (simplified approach)
      const day = Math.floor(date.getTime() / (1000 * 60 * 60 * 24));
      
      if (!itemMap.has(item.item_name)) {
        itemMap.set(item.item_name, []);
      }
      
      itemMap.get(item.item_name)?.push({
        day,
        qty: item.qty,
        revenue: item.qty * item.price
      });
    });
    
    // Calculate trends for each item
    const trends: ItemTrend[] = [];
    
    itemMap.forEach((dailyData, item_name) => {
      // Aggregate by day
      const dayMap = new Map<number, {qty: number, revenue: number}>();
      
      dailyData.forEach(data => {
        if (!dayMap.has(data.day)) {
          dayMap.set(data.day, { qty: 0, revenue: 0 });
        }
        const existing = dayMap.get(data.day)!;
        dayMap.set(data.day, {
          qty: existing.qty + data.qty,
          revenue: existing.revenue + data.revenue
        });
      });
      
      // Prepare data for regression
      const days = Array.from(dayMap.keys()).sort();
      const quantities = days.map(day => dayMap.get(day)!.qty);
      
      // Only analyze items with enough data points
      if (days.length >= 5) {
        const x = days.map((day, i) => i); // Use sequence numbers as x values
        const y = quantities;
        
        const { slope, intercept, rSquared } = linearRegression(x, y);
        
        const totalSold = quantities.reduce((sum, q) => sum + q, 0);
        const totalRevenue = days.reduce((sum, day) => sum + dayMap.get(day)!.revenue, 0);
        
        trends.push({
          item_name,
          slope,
          intercept,
          rSquared,
          totalSold,
          totalRevenue
        });
      }
    });
    
    // Sort by strongest positive trend
    return trends.sort((a, b) => b.slope - a.slope);
  };

  const generateBusinessInsights = (trends: ItemTrend[]): BusinessInsight[] => {
    const insights: BusinessInsight[] = [];
    
    // Get top trending items
    const topTrending = trends.filter(t => t.slope > 0 && t.rSquared > 0.5).slice(0, 3);
    const decliningItems = trends.filter(t => t.slope < -0.5 && t.rSquared > 0.5).slice(0, 3);
    
    // Generate optimization recommendations
    if (topTrending.length > 0) {
      insights.push({
        title: "Hot Selling Items",
        content: `These items are trending up: ${topTrending.map(t => t.item_name).join(', ')}. Consider increasing stock and promoting them.`,
        type: "optimization",
        icon: "🔥",
        color: "success"
      });
    }
    
    if (decliningItems.length > 0) {
      insights.push({
        title: "Declining Items",
        content: `These items are losing popularity: ${decliningItems.map(t => t.item_name).join(', ')}. Consider promotions or replacements.`,
        type: "optimization",
        icon: "📉",
        color: "warning"
      });
    }
    
    // Generate growth opportunities
    const highValueItems = [...trends]
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 3);
    
    if (highValueItems.length > 0) {
      insights.push({
        title: "High Value Items",
        content: `Your most profitable items: ${highValueItems.map(t => `${t.item_name} (₹${t.totalRevenue.toFixed(2)})`).join(', ')}. Focus on these for maximum revenue.`,
        type: "growth",
        icon: "💰",
        color: "primary"
      });
    }
    
    // General recommendations
    insights.push({
      title: "Menu Optimization",
      content: "Analyze trends weekly to adjust your menu for maximum profitability.",
      type: "growth",
      icon: "📊",
      color: "secondary"
    });
    
    return insights;
  };

  if (loading) {
    return <div className="text-center py-8">Analyzing item trends...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5" />
          AI-Powered Menu Insights
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <h4 className="font-semibold text-sm">Optimization Recommendations</h4>
            <div className="space-y-2">
              {insights.filter(insight => insight.type === 'optimization').map((insight, index) => (
                <div key={index} className="p-3 bg-success/10 rounded-lg border border-success/20">
                  <p className="text-sm font-medium">{insight.icon} {insight.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {insight.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
          
          <div className="space-y-3">
            <h4 className="font-semibold text-sm">Growth Opportunities</h4>
            <div className="space-y-2">
              {insights.filter(insight => insight.type === 'growth').map((insight, index) => (
                <div key={index} className="p-3 bg-primary/10 rounded-lg border border-primary/20">
                  <p className="text-sm font-medium">{insight.icon} {insight.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {insight.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}