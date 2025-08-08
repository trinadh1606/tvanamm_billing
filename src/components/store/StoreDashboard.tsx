import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { EnhancedBillingInterface } from '@/components/billing/EnhancedBillingInterface';
import { SalesAnalytics } from '@/components/analytics/SalesAnalytics';
import { PredictiveInsights } from '@/components/analytics/PredictiveInsights';
import { BillHistory } from '@/components/billing/BillHistory';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import logo from '@/assets/logo.png'; // adjust path if needed

export function StoreDashboard() {
  return (
    <DashboardLayout
      title={
        <div className="flex items-center gap-3">
          <img src={logo} alt="Logo" className="w-20 h-20" />
          <span className="text-xl font-semibold">STORE BILLING</span>
        </div>
      }
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
