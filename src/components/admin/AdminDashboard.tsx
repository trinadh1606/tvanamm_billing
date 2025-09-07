import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { MenuManager } from '@/components/menu/MenuManager';
import { SalesAnalytics } from '@/components/analytics/SalesAnalytics';
import { PredictiveInsights } from '@/components/analytics/PredictiveInsights';
import { WeeklyPerformanceChart } from '@/components/analytics/WeeklyPerformanceChart';
import { BillHistory } from '@/components/billing/BillHistory';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';

export function AdminDashboard() {
  const { franchiseId } = useAuth();

  return (
    <DashboardLayout 
      title="Franchise Dashboard" 
      description="Franchise Management and Analytics"
    >
      <Tabs defaultValue="analytics" className="w-full">
        {/* Tabs bar with custom green */}
        <TabsList
          className="grid w-full grid-cols-5 rounded-md"
          style={{ backgroundColor: 'rgb(0,100,55)' }}
        >
          <TabsTrigger
            value="analytics"
            className="data-[state=active]:bg-white data-[state=active]:text-[rgb(0,100,55)] text-white"
          >
            Analytics
          </TabsTrigger>
          <TabsTrigger
            value="insights"
            className="data-[state=active]:bg-white data-[state=active]:text-[rgb(0,100,55)] text-white"
          >
            Predictions
          </TabsTrigger>
          <TabsTrigger
            value="menu"
            className="data-[state=active]:bg-white data-[state=active]:text-[rgb(0,100,55)] text-white"
          >
            Menu
          </TabsTrigger>
          <TabsTrigger
            value="bills"
            className="data-[state=active]:bg-white data-[state=active]:text-[rgb(0,100,55)] text-white"
          >
            Bills
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="analytics">
          <SalesAnalytics />
        </TabsContent>
        
        <TabsContent value="insights">
          <PredictiveInsights />
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
