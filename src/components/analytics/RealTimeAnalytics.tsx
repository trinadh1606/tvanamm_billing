import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Activity, TrendingUp, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface LiveStats {
  currentHourRevenue: number;
  currentHourOrders: number;
  todayRevenue: number;
  todayOrders: number;
  averageOrderValue: number;
  storeStatus: 'quiet' | 'normal' | 'busy' | 'very-busy';
  statusMessage: string;
  lastOrderTime: string | null;
}

interface RecentActivity {
  id: number;
  total: number;         // After Discount (net)
  created_at: string;
  items_count: number;
  actual_total: number;  // Actual Amount (pre-discount sum of items)
}

type BillItemRow = {
  item_name: string;
  qty: number;
  price: number;
};

export function RealTimeAnalytics() {
  const [liveStats, setLiveStats] = useState<LiveStats>({
    currentHourRevenue: 0,
    currentHourOrders: 0,
    todayRevenue: 0,
    todayOrders: 0,
    averageOrderValue: 0,
    storeStatus: 'quiet',
    statusMessage: 'Store is quiet',
    lastOrderTime: null,
  });
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  // Items modal state
  const [itemsModalOpen, setItemsModalOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [orderItems, setOrderItems] = useState<BillItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  const { franchiseId } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    fetchLiveData();
    const channel = supabase
      .channel('bills-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bills_generated_billing',
          filter: `franchise_id=eq.${franchiseId}`,
        },
        (payload) => {
          fetchLiveData();
          toast({
            title: 'New Sale! 🎉',
            description: `₹${Number(payload.new.total).toFixed(2)} - Just now`,
          });
        }
      )
      .subscribe();

    const interval = setInterval(fetchLiveData, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [franchiseId]);

  const fetchLiveData = async () => {
    if (!franchiseId) return;

    try {
      const istNow = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
      );
      const today = istNow.toISOString().split('T')[0];
      const currentHourStart = `${today}T${istNow
        .getHours()
        .toString()
        .padStart(2, '0')}:00:00`;

      const { data: todayBills } = await supabase
        .from('bills_generated_billing')
        .select('total, created_at')
        .eq('franchise_id', franchiseId)
        .gte('created_at', today + 'T00:00:00')
        .order('created_at', { ascending: false });

      const currentHourBills =
        todayBills?.filter((bill) => bill.created_at >= currentHourStart) || [];

      // Pull last 10 bills and include their items (qty, price) so we can compute Actual Amount
      const { data: recentBills } = await supabase
        .from('bills_generated_billing')
        .select(
          `
          id,
          total,
          created_at,
          bill_items_generated_billing!inner(id, qty, price)
        `
        )
        .eq('franchise_id', franchiseId)
        .order('created_at', { ascending: false })
        .limit(10);

      const todayRevenue =
        todayBills?.reduce((sum, bill) => sum + Number(bill.total), 0) || 0;
      const todayOrders = todayBills?.length || 0;
      const currentHourRevenue = currentHourBills.reduce(
        (sum, bill) => sum + Number(bill.total),
        0
      );
      const currentHourOrders = currentHourBills.length;
      const averageOrderValue =
        todayOrders > 0 ? todayRevenue / todayOrders : 0;

      let statusMessage = 'Store is quiet';
      if (currentHourOrders >= 10) {
        statusMessage = 'Store is VERY BUSY! 🔥';
      } else if (currentHourOrders >= 5) {
        statusMessage = 'Store is busy 📈';
      } else if (currentHourOrders >= 2) {
        statusMessage = 'Store is moderately active';
      }

      const lastOrderTime = todayBills?.[0]?.created_at || null;

      setLiveStats({
        currentHourRevenue,
        currentHourOrders,
        todayRevenue,
        todayOrders,
        averageOrderValue,
        storeStatus: 'normal',
        statusMessage,
        lastOrderTime,
      });

      const formattedActivity: RecentActivity[] =
        (recentBills || []).map((bill: any) => {
          const items = bill.bill_items_generated_billing || [];
          const actual = items.reduce(
            (sum: number, it: any) => sum + (Number(it.qty) || 0) * (Number(it.price) || 0),
            0
          );
          return {
            id: bill.id,
            total: Number(bill.total),             // After Discount (net)
            created_at: bill.created_at,
            items_count: items.length,
            actual_total: actual,                  // Actual Amount (pre-discount)
          };
        });

      setRecentActivity(formattedActivity);
    } finally {
      setLoading(false);
    }
  };

  // fetch items for a given order (bill) and open modal
  const openItemsForOrder = async (orderId: number) => {
    setSelectedOrderId(orderId);
    setItemsModalOpen(true);
    setItemsLoading(true);
    try {
      const { data, error } = await supabase
        .from('bill_items_generated_billing')
        .select('item_name, qty, price')
        .eq('bill_id', orderId)
        .order('id', { ascending: true });

      if (error) throw error;

      const rows: BillItemRow[] =
        (data || []).map((r: any) => ({
          item_name: String(r.item_name ?? ''),
          qty: Number(r.qty) || 0,
          price: Number(r.price) || 0,
        })) ?? [];

      setOrderItems(rows);
    } catch (e: any) {
      toast({
        title: 'Error',
        description: e.message || 'Failed to load order items',
        variant: 'destructive',
      });
      setOrderItems([]);
    } finally {
      setItemsLoading(false);
    }
  };

  const getTimeSinceLastOrder = () => {
    if (!liveStats.lastOrderTime) return 'No orders today';
    const now = new Date();
    const lastOrder = new Date(liveStats.lastOrderTime);
    const diffMs = now.getTime() - lastOrder.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    return `${diffHours}h ${diffMins % 60}m ago`;
  };

  const orderItemsTotal = orderItems.reduce(
    (sum, it) => sum + it.qty * it.price,
    0
  );

  const selectedOrderNetTotal = useMemo(() => {
    const row = recentActivity.find((a) => a.id === selectedOrderId);
    return row?.total ?? null;
  }, [selectedOrderId, recentActivity]);

  if (loading) {
    return <div className="text-center py-8">Loading real-time data...</div>;
  }

  const money = (n: number) => `₹${Number(n).toFixed(2)}`;

  return (
    <div className="space-y-6">
      {/* Live Status Banner */}
      <Card style={{ borderColor: 'rgb(0,100,55)', borderWidth: 2 }}>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <Activity className="h-8 w-8" style={{ color: 'rgb(0,100,55)' }} />
                <div
                  className="absolute -top-1 -right-1 w-3 h-3 rounded-full animate-pulse"
                  style={{ backgroundColor: 'rgb(0,100,55)' }}
                ></div>
              </div>
              <div>
                <h3 className="text-xl font-bold">{liveStats.statusMessage}</h3>
                <p className="text-muted-foreground">
                  Last order: {getTimeSinceLastOrder()}
                </p>
              </div>
            </div>
            <Badge
              style={{
                backgroundColor: 'rgb(0,100,55)',
                color: 'white',
              }}
            >
              LIVE
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity Feed */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" style={{ color: 'rgb(0,100,55)' }} />
            Live Activity Feed
          </CardTitle>

          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" style={{ color: 'rgb(0,100,55)' }} />
            <Badge
              style={{
                backgroundColor: 'rgb(0,100,55)',
                color: 'white',
              }}
            >
              Total Orders Today:{' '}
              <span className="ml-1 font-semibold">{liveStats.todayOrders}</span>
            </Badge>
          </div>
        </CardHeader>

        <CardContent>
          {recentActivity.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No recent activity
            </div>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-center justify-between p-3 rounded-lg"
                  style={{ backgroundColor: 'rgba(0,100,55,0.1)' }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: 'rgb(0,100,55)' }}
                    ></div>
                    <div>
                      {/* Clickable Order ID */}
                      <button
                        type="button"
                        onClick={() => openItemsForOrder(activity.id)}
                        className="font-medium underline text-left"
                        style={{ color: 'rgb(0,100,55)' }}
                        title="View items"
                      >
                        Order #{activity.id}
                      </button>
                      <span className="text-muted-foreground ml-2">
                        {activity.items_count} items
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-gray-600">Actual &nbsp;/&nbsp; After Discount</div>
                    <div className="font-semibold">
                      <span>{money(activity.actual_total)}</span>
                      <span className="mx-2">→</span>
                      <span className="font-bold">{money(activity.total)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {new Date(activity.created_at).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Items Modal */}
      <Dialog open={itemsModalOpen} onOpenChange={setItemsModalOpen}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle className="text-gray-800">
              {selectedOrderId ? `Items for Order #${selectedOrderId}` : 'Items'}
            </DialogTitle>
          </DialogHeader>

          {itemsLoading ? (
            <div className="py-4 text-sm text-gray-600">Loading items…</div>
          ) : orderItems.length === 0 ? (
            <div className="py-4 text-sm text-gray-600">No items found for this order.</div>
          ) : (
            <>
              <ul className="space-y-2 max-h-72 overflow-y-auto">
                {orderItems.map((it, idx) => (
                  <li key={idx} className="border p-2 rounded">
                    <div className="font-medium" style={{ color: 'rgb(0,100,55)' }}>
                      {it.item_name}
                    </div>
                    <div className="text-sm text-gray-600">
                      Qty: {it.qty} | Rate: ₹{it.price} | Total: ₹{(it.qty * it.price).toFixed(2)}
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-4 border-t pt-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold" style={{ color: 'rgb(0,100,55)' }}>
                    Actual &nbsp;/&nbsp; After Discount
                  </span>
                  <span className="font-semibold" style={{ color: 'rgb(0,100,55)' }}>
                    {money(orderItemsTotal)} <span className="mx-2">→</span>{' '}
                    {selectedOrderNetTotal !== null ? money(selectedOrderNetTotal) : '—'}
                  </span>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
