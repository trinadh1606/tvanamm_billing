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

export function PredictiveInsights() {
  const [insights, setInsights] = useState<BusinessInsight[]>([]);
  const [loading, setLoading] = useState(true);
  
  const { franchiseId } = useAuth();

  useEffect(() => {
    generateInsights();
  }, [franchiseId]);

  const generateInsights = async () => {
    if (!franchiseId) return;
    
    setLoading(true);
    
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Get today's data
      const { data: todayBills, error: todayError } = await supabase
        .from('bills_generated_billing')
        .select('total, created_at')
        .eq('franchise_id', franchiseId)
        .gte('created_at', today);

      if (todayError) throw todayError;

      // Get popular items data
      const { data: itemsData, error: itemsError } = await supabase
        .from('bill_items_generated_billing')
        .select(`
          item_name, 
          qty,
          price,
          bills_generated_billing!inner(created_at)
        `)
        .eq('franchise_id', franchiseId)
        .gte('bills_generated_billing.created_at', today);

      if (itemsError) throw itemsError;

      // Generate AI insights
      const newInsights = generateBusinessInsights(todayBills || [], itemsData || []);
      setInsights(newInsights);
      
    } catch (error: any) {
      console.error('Error generating insights:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateBusinessInsights = (todayBills: any[], itemsData: any[]): BusinessInsight[] => {
    const insights: BusinessInsight[] = [];
    
    // Calculate today's revenue and order count
    const todayRevenue = todayBills.reduce((sum, bill) => sum + Number(bill.total), 0);
    const todayOrders = todayBills.length;
    
    // Get top-selling item
    const itemMap = new Map<string, { qty: number, revenue: number }>();
    itemsData.forEach(item => {
      const existing = itemMap.get(item.item_name) || { qty: 0, revenue: 0 };
      itemMap.set(item.item_name, {
        qty: existing.qty + item.qty,
        revenue: existing.revenue + (item.qty * item.price)
      });
    });
    
    const topItem = Array.from(itemMap.entries())
      .sort((a, b) => b[1].qty - a[1].qty)[0];
    
    // Generate optimization recommendations
    insights.push({
      title: "Peak Hour Strategy",
      content: topItem 
        ? `Your bestselling item today is ${topItem[0]} with ${topItem[1].qty} units sold. Consider pre-preparing during busy hours.`
        : "Monitor your peak hours and pre-prepare popular items to reduce wait times.",
      type: "optimization",
      icon: "💡",
      color: "success"
    });
    
    insights.push({
      title: "Inventory Alert", 
      content: topItem
        ? `${topItem[0]} is in high demand today. Consider restocking to avoid shortages.`
        : "Keep track of fast-moving items and maintain adequate stock levels.",
      type: "optimization",
      icon: "⚡",
      color: "warning"
    });
    
    // Generate growth opportunities
    const avgOrderValue = todayOrders > 0 ? todayRevenue / todayOrders : 0;
    
    insights.push({
      title: "Revenue Growth",
      content: todayOrders > 0 
        ? `Today's average order value is ₹${avgOrderValue.toFixed(2)}. Focus on upselling to increase this metric.`
        : "Start taking orders to track your performance and identify growth opportunities.",
      type: "growth", 
      icon: "📈",
      color: "primary"
    });
    
    insights.push({
      title: "Customer Retention",
      content: todayOrders > 5
        ? "With multiple orders today, consider implementing a loyalty program to encourage repeat customers."
        : "Build customer relationships early to establish a loyal customer base.",
      type: "growth",
      icon: "🎯", 
      color: "secondary"
    });
    
    return insights;
  };

  if (loading) {
    return <div className="text-center py-8">Generating AI insights...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5" />
          AI-Powered Business Insights
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