import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { EnhancedBillingInterface } from '@/components/billing/EnhancedBillingInterface';
import { BillHistory } from '@/components/billing/BillHistory';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import logo from '@/assets/logo.png';

export function StoreDashboard() {
  return (
    <DashboardLayout
      title={
        <div className="flex items-center gap-3">
          <img src={logo} alt="Logo" className="w-20 h-20" />
          <span className="text-xl font-semibold text-[rgb(0,100,55)]">STORE BILLING</span>
        </div>
      }
    >
      <Tabs defaultValue="billing" className="w-full">
        <TabsList className="grid w-full grid-cols-2 bg-white h-14 shadow-md rounded-t-lg"> {/* Added shadow and rounded top corners */}
          <TabsTrigger 
            value="billing" 
            className="data-[state=active]:bg-[rgb(0,100,55)] data-[state=active]:text-white h-12 text-lg shadow-sm"
            // Added subtle shadow to inactive tabs
          >
            New Bill
          </TabsTrigger>
          <TabsTrigger 
            value="history" 
            className="data-[state=active]:bg-[rgb(0,100,55)] data-[state=active]:text-white h-12 text-lg shadow-sm"
            // Added subtle shadow to inactive tabs
          >
            Bill History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="billing" className="bg-white rounded-b-lg p-10 shadow-lg"> {/* Stronger shadow for content */}
          <EnhancedBillingInterface />
        </TabsContent>

        <TabsContent value="history" className="bg-white rounded-b-lg p-10 shadow-lg"> {/* Stronger shadow for content */}
          <BillHistory />
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}