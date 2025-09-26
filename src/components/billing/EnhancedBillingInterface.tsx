import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Minus,
  Plus,
  Trash2,
  ShoppingCart,
  CreditCard,
  Banknote,
  Bluetooth,
  BluetoothConnected,
  Search,
  X,
  Settings,
  HelpCircle
} from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/components/ui/tabs';
import { useBluetoothPrinter } from '@/hooks/useBluetoothPrinter';
import { WindowsCompatibilityGuide } from '@/components/bluetooth/WindowsCompatibilityGuide';

interface MenuItem {
  id: number;
  name: string;
  price: number;
  category: string;
}

interface BillItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  menuItemId?: number;
}

// ----- Helpers to handle franchise id variants -----
// Canonical form: "FR-0000" for numeric ids, keep "FR-CENTRAL" and "FR-XXXX" as-is (zero-pad numeric suffix)
const canonicalFrId = (raw?: string) => {
  const id = (raw || '').trim();
  if (!id) return '';
  const up = id.toUpperCase();
  if (up === 'FR-CENTRAL') return 'FR-CENTRAL';
  if (up.startsWith('FR-')) {
    const numPart = up.slice(3);
    if (/^\d+$/.test(numPart)) {
      const n = String(parseInt(numPart, 10));
      return `FR-${n.padStart(4, '0')}`;
    }
    return up;
  }
  if (/^\d+$/.test(id)) {
    const n = String(parseInt(id, 10));
    return `FR-${n.padStart(4, '0')}`;
  }
  return up;
};

// For querying: try canonical ("FR-0002"), the zero-padded numeric ("0002"), and the non-padded numeric ("2")
const idsToTry = (raw?: string) => {
  const canon = canonicalFrId(raw);
  if (!canon) return [];
  if (canon === 'FR-CENTRAL') return [canon];
  const num4 = canon.slice(3); // e.g. "0002"
  const numNoPad = String(parseInt(num4, 10)); // "2"
  return Array.from(new Set([canon, num4, numNoPad]));
};

export function EnhancedBillingInterface() {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [billItems, setBillItems] = useState<BillItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showCompatibilityGuide, setShowCompatibilityGuide] = useState(false);

  const { franchiseId, user } = useAuth();
  const { toast } = useToast();
  const {
    connectedPrinter,
    isConnecting,
    isPrinting,
    connectPrinter,
    disconnectPrinter,
    printReceipt,
    isConnected,
    compatibility,
    fallbackOptions
  } = useBluetoothPrinter();

  useEffect(() => {
    fetchMenuItems();
  }, [franchiseId]);

  const fetchMenuItems = async () => {
    const chosen = (franchiseId || '').trim();
    if (!chosen) return;

    setLoading(true);
    try {
      const tryIds = idsToTry(chosen);
      const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .in('franchise_id', tryIds)
        .order('category', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;

      setMenuItems(data || []);

      if (!data || data.length === 0) {
        toast({
          title: 'No items found',
          description: `Tried IDs: ${tryIds.join(', ')}`
        });
      }
    } catch (e: any) {
      toast({
        title: 'Error',
        description: e.message || 'Failed to load menu items',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const addItemToBill = (menuItem: MenuItem) => {
    const existingItem = billItems.find(item => item.menuItemId === menuItem.id);

    if (existingItem) {
      updateQuantity(existingItem.id, 1);
    } else {
      const newItem: BillItem = {
        id: Date.now().toString(),
        name: menuItem.name,
        price: menuItem.price,
        quantity: 1,
        menuItemId: menuItem.id
      };
      setBillItems([...billItems, newItem]);
    }

    toast({
      title: 'Item Added',
      description: `${menuItem.name} added to cart`
    });
  };

  const updateQuantity = (id: string, change: number) => {
    setBillItems(items =>
      items
        .map(item => {
          if (item.id === id) {
            const newQuantity = Math.max(0, item.quantity + change);
            return newQuantity === 0 ? null : { ...item, quantity: newQuantity };
          }
          return item;
        })
        .filter(Boolean) as BillItem[]
    );
  };

  const removeItem = (id: string) => {
    setBillItems(items => items.filter(item => item.id !== id));
  };

  const total = billItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const generateBill = async (paymentMode: string) => {
    if (billItems.length === 0) {
      toast({
        title: 'Error',
        description: 'Please add items to the bill',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);

    try {
      const { data: billData, error: billError } = await supabase
        .from('bills_generated_billing')
        .insert({
          franchise_id: canonicalFrId(franchiseId), // save canonical form
          mode_payment: paymentMode,
          created_by: user?.id,
          total
        })
        .select()
        .single();

      if (billError) throw billError;

      const billItemsData = billItems.map(item => ({
        bill_id: billData.id,
        menu_item_id: item.menuItemId || 0,
        qty: item.quantity,
        price: item.price,
        franchise_id: canonicalFrId(franchiseId),
        item_name: item.name
      }));

      const { error: itemsError } = await supabase
        .from('bill_items_generated_billing')
        .insert(billItemsData);

      if (itemsError) throw itemsError;

      toast({
        title: 'Success',
        description: `Bill generated successfully with ${paymentMode} payment`
      });

      if (isConnected) {
        const receiptData = {
          items: billItems,
          total,
          paymentMode,
          billNumber: billData.id,
          date: billData.created_at || new Date()
        };
        await printReceipt(receiptData);
      }

      setBillItems([]);
      setPaymentDialogOpen(false);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to generate bill',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = useMemo(() => {
    // If searching, ignore category filter
    if (searchTerm.trim()) {
      return menuItems.filter(item =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // If no search, apply category filter
    if (selectedCategory === 'all') return menuItems;

    return menuItems.filter(
      item =>
        item.category === selectedCategory ||
        (!item.category && selectedCategory === 'Others')
    );
  }, [menuItems, searchTerm, selectedCategory]);

  const groupedMenuItems = useMemo(() => {
    // When searching, put everything in "all"
    if (searchTerm.trim()) {
      return { all: filteredItems };
    }

    // Group by category when not searching
    const groups: Record<string, MenuItem[]> = {};
    filteredItems.forEach(item => {
      const category = item.category || 'Others';
      if (!groups[category]) groups[category] = [];
      groups[category].push(item);
    });

    return groups;
  }, [filteredItems, searchTerm]);

  useEffect(() => {
    if (searchTerm.trim()) {
      setSelectedCategory('all');
    }
  }, [searchTerm]);

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(menuItems.map(item => item.category || 'Others'))).sort()],
    [menuItems]
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 bg-white p-4 min-h-screen">
      <Card className="bg-white border border-gray-200">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between mb-4">
            <CardTitle className="flex items-center gap-2 text-gray-800">
              <ShoppingCart className="h-5 w-5 text-[rgb(0,100,55)]" />
              Menu Items
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant={isConnected ? "default" : "outline"}
                size="sm"
                onClick={isConnected ? disconnectPrinter : connectPrinter}
                disabled={isConnecting}
                className="flex items-center gap-2"
                style={isConnected ? { backgroundColor: 'rgb(0,100,55)', color: 'white' } : {}}
              >
                {isConnected ? (
                  <>
                    <BluetoothConnected className="h-4 w-4" />
                    {connectedPrinter?.name || 'Connected'}
                  </>
                ) : (
                  <>
                    <Bluetooth className="h-4 w-4" />
                    {isConnecting ? 'Connecting...' : 'Connect Printer'}
                  </>
                )}
              </Button>
              <Dialog open={showCompatibilityGuide} onOpenChange={setShowCompatibilityGuide}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Settings className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-white">
                  <DialogHeader>
                    <DialogTitle className="text-gray-800">Printer Setup & Compatibility</DialogTitle>
                  </DialogHeader>
                  {compatibility && (
                    <WindowsCompatibilityGuide 
                      compatibility={compatibility}
                      onClose={() => setShowCompatibilityGuide(false)}
                    />
                  )}
                </DialogContent>
              </Dialog>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Search items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-10 bg-white border-gray-300 focus:border-[rgb(0,100,55)]"
            />
            {searchTerm && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0 text-gray-500 hover:text-gray-700"
                onClick={() => setSearchTerm('')}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={selectedCategory} onValueChange={setSelectedCategory} className="w-full">
            <ScrollArea className="w-full mb-4">
              <TabsList className="inline-flex h-12 items-center justify-center rounded-md bg-gray-100 p-1 text-gray-700 w-max space-x-2">
                {categories.map((category) => (
                  <TabsTrigger 
                    key={category} 
                    value={category} 
                    className="whitespace-nowrap px-4 py-2 text-base font-medium data-[state=active]:bg-[rgb(0,100,55)] data-[state=active]:text-white"
                  >
                    {category === 'all' ? 'All Items' : category}
                  </TabsTrigger>
                ))}
              </TabsList>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
            {(searchTerm.trim() ? ['all'] : categories).map(category => (
              <TabsContent key={category} value={category} className="mt-0">
                <ScrollArea className="h-[500px]">
                  <div className="grid grid-cols-2 gap-3 pr-2">
                    {(searchTerm.trim()
                      ? filteredItems
                      : category === 'all'
                        ? menuItems
                        : groupedMenuItems[category] || []
                    ).map(item => (
                      <Button
                        key={item.id}
                        variant="outline"
                        className="h-20 p-3 flex flex-col items-center justify-center border-gray-300 hover:bg-[rgb(0,100,55)] hover:text-white transition-colors"
                        onClick={() => addItemToBill(item)}
                      >
                        <div className="font-medium text-center text-sm leading-tight mb-1">
                          {item.name}
                        </div>
                        <div className="font-bold text-lg">₹{item.price}</div>
                      </Button>
                    ))}
                  </div>
                  <ScrollBar orientation="vertical" />
                </ScrollArea>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      <Card className="bg-white border border-gray-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-gray-800">Bill Summary</CardTitle>
            {!isConnected && billItems.length > 0 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fallbackOptions?.printToSystemPrinter && fallbackOptions.printToSystemPrinter({
                    items: billItems,
                    total: total,
                    paymentMode: 'N/A',
                    billNumber: 'Preview',
                    date: new Date()
                  })}
                  className="border-gray-300 text-gray-700 hover:bg-gray-100"
                >
                  Print Preview
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCompatibilityGuide(true)}
                  className="border-gray-300 text-gray-700 hover:bg-gray-100"
                >
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          {compatibility && !compatibility.hasWebBluetooth && (
            <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm">
              <div className="text-yellow-800">
                Bluetooth printing not available. Use alternative options below.
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {billItems.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No items added yet</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {billItems.map(item => (
                <div key={item.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                  <div className="flex-1">
                    <div className="font-medium text-gray-800">{item.name}</div>
                    <div className="text-sm text-gray-500">₹{item.price} each</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => updateQuantity(item.id, -1)}
                      className="border-gray-300 text-gray-700 hover:bg-gray-100"
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="min-w-8 text-center text-gray-800">{item.quantity}</span>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => updateQuantity(item.id, 1)}
                      className="border-gray-300 text-gray-700 hover:bg-gray-100"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button 
                      size="sm" 
                      variant="destructive" 
                      onClick={() => removeItem(item.id)}
                      className="bg-red-100 text-red-700 hover:bg-red-200 border-red-200"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="min-w-16 text-right font-medium text-gray-800">
                    ₹{(item.price * item.quantity).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {billItems.length > 0 && (
            <>
              <div className="border-t border-gray-200 pt-4 space-y-4">
                <div className="flex justify-between text-xl font-bold text-gray-800">
                  <span>Total:</span>
                  <span>₹{total.toFixed(2)}</span>
                </div>

                <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
                  <DialogTrigger asChild>
                    <Button 
                      className="w-full"
                      size="lg"
                      disabled={billItems.length === 0}
                      style={{ backgroundColor: 'rgb(0,100,55)', color: 'white' }}
                    >
                      Process Payment
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md bg-white">
                    <DialogHeader>
                      <DialogTitle className="text-gray-800">Confirm & Select Payment Method</DialogTitle>
                    </DialogHeader>

                    <div className="max-h-60 overflow-y-auto border rounded-md p-3 bg-gray-50 space-y-2 mb-4">
                      {billItems.map(item => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <div className="flex-1">
                            <div className="font-medium">{item.name}</div>
                            <div className="text-gray-500">₹{item.price} × {item.quantity}</div>
                          </div>
                          <div className="font-semibold text-gray-800">
                            ₹{(item.price * item.quantity).toFixed(2)}
                          </div>
                        </div>
                      ))}
                      <div className="border-t border-gray-300 pt-2 flex justify-between font-bold text-gray-800">
                        <span>Total:</span>
                        <span>₹{total.toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <Button
                        size="lg"
                        className="h-20 flex flex-col gap-2"
                        onClick={() => generateBill('cash')}
                        disabled={loading}
                        style={{ backgroundColor: 'rgb(0,100,55)', color: 'white' }}
                      >
                        <Banknote className="h-8 w-8" />
                        Cash
                      </Button>
                      <Button
                        size="lg"
                        className="h-20 flex flex-col gap-2"
                        onClick={() => generateBill('upi')}
                        disabled={loading}
                        style={{ backgroundColor: 'rgb(0,100,55)', color: 'white' }}
                      >
                        <CreditCard className="h-8 w-8" />
                        UPI
                      </Button>
                    </div>

                    {loading && (
                      <div className="text-center text-sm text-gray-500 mt-4">
                        Generating bill...
                      </div>
                    )}
                  </DialogContent>
                </Dialog>

                {!isConnected && (
                  <div className="space-y-2 mt-4 pt-4 border-t border-gray-200">
                    <div className="text-sm font-medium text-center text-gray-700">Alternative Options:</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const receiptData = {
                            items: billItems,
                            total: total,
                            paymentMode: 'cash',
                            billNumber: 'Preview',
                            date: new Date()
                          };
                          fallbackOptions?.copyToClipboard && fallbackOptions.copyToClipboard(receiptData);
                        }}
                        className="border-gray-300 text-gray-700 hover:bg-gray-100"
                      >
                        Copy Text
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const receiptData = {
                            items: billItems,
                            total: total,
                            paymentMode: 'cash',
                            billNumber: 'Preview',
                            date: new Date()
                          };
                          fallbackOptions?.generatePDF && fallbackOptions.generatePDF(receiptData);
                        }}
                        className="border-gray-300 text-gray-700 hover:bg-gray-100"
                      >
                        Print PDF
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
