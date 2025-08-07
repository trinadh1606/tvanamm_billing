import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { MenuManager } from '@/components/menu/MenuManager';
import { SalesAnalytics } from '@/components/analytics/SalesAnalytics';
import { PredictiveInsights } from '@/components/analytics/PredictiveInsights';
import { WeeklyPerformanceChart } from '@/components/analytics/WeeklyPerformanceChart';
import { BillHistory } from '@/components/billing/BillHistory';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function AdminDashboard() {
  return (
    <DashboardLayout 
      title="Franchise Dashboard" 
      description="Franchise Management and Analytics"
    >
      <Tabs defaultValue="analytics" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="insights">AI Insights</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="menu">Menu</TabsTrigger>
          <TabsTrigger value="bills">Bills</TabsTrigger>
        </TabsList>
        
        <TabsContent value="analytics">
          <SalesAnalytics />
        </TabsContent>
        
        <TabsContent value="insights">
          <PredictiveInsights />
        </TabsContent>
        
        <TabsContent value="weekly">
          <WeeklyPerformanceChart />
        </TabsContent>
        
        <TabsContent value="menu">
          <MenuManager />
        </TabsContent>
        
        <TabsContent value="bills">
          <BillHistory showAdvanced />
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}