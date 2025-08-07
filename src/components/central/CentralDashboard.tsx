import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { FRCentralDashboard } from './FRCentralDashboard';
import { OtherFranchisesAnalytics } from './OtherFranchisesAnalytics';
import { FranchiseTracker } from '@/components/analytics/FranchiseTracker';
import { MenuManager } from '@/components/menu/MenuManager';
import { BillHistory } from '@/components/billing/BillHistory';
import { WeeklyPerformanceChart } from '@/components/analytics/WeeklyPerformanceChart';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function CentralDashboard() {
  return (
    <DashboardLayout 
      title="Central Dashboard" 
      description="Multi-Franchise Overview and System Management"
    >
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="franchises">Franchises</TabsTrigger>
          <TabsTrigger value="menu">Master Menu</TabsTrigger>
          <TabsTrigger value="bills">All Bills</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview">
          <FRCentralDashboard />
        </TabsContent>
        
        <TabsContent value="analytics">
          <OtherFranchisesAnalytics />
        </TabsContent>
        
        <TabsContent value="weekly">
          <WeeklyPerformanceChart isCentral />
        </TabsContent>
        
        <TabsContent value="franchises">
          <FranchiseTracker />
        </TabsContent>
        
        <TabsContent value="menu">
          <MenuManager isCentral />
        </TabsContent>
        
        <TabsContent value="bills">
          <BillHistory showAdvanced isCentral />
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}