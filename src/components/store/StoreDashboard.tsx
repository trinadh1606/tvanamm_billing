import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { EnhancedBillingInterface } from '@/components/billing/EnhancedBillingInterface';
import { SalesAnalytics } from '@/components/analytics/SalesAnalytics';
import { PredictiveInsights } from '@/components/analytics/PredictiveInsights';
import { BillHistory } from '@/components/billing/BillHistory';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function StoreDashboard() {
  return (
    <DashboardLayout 
      title="Store POS System" 
      description="Point of Sale and Analytics"
    >
      <Tabs defaultValue="billing" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="billing">New Bill</TabsTrigger>
          <TabsTrigger value="history">Bill History</TabsTrigger>
        </TabsList>
        
        <TabsContent value="billing">
          <EnhancedBillingInterface />
        </TabsContent>
        
        <TabsContent value="history">
          <BillHistory />
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}