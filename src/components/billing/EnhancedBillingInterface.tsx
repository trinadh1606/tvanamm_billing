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

const idsToTry = (raw?: string) => {
  const canon = canonicalFrId(raw);
  if (!canon) return [];
  if (canon === 'FR-CENTRAL') return [canon];
  const num4 = canon.slice(3);
  const numNoPad = String(parseInt(num4, 10));
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

  // NEW: discount state
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>('amount');
  const [discountInput, setDiscountInput] = useState<string>(''); // user entry

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

  // CHANGED: name this 'subtotal' (pre-discount)
  const subtotal = useMemo(
    () => billItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [billItems]
  );

  // NEW: computed discount & payable
  const discountAmount = useMemo(() => {
    const raw = parseFloat(discountInput);
    const val = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    if (discountMode === 'amount') {
      return Math.min(val, subtotal);
    }
    // percent
    const pct = Math.min(100, val);
    return Math.min((pct / 100) * subtotal, subtotal);
  }, [discountInput, discountMode, subtotal]);

  const payableTotal = useMemo(
    () => Number(Math.max(0, subtotal - discountAmount).toFixed(2)),
    [subtotal, discountAmount]
  );

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
      // Use final payable total for the bill
      const { data: billData, error: billError } = await supabase
        .from('bills_generated_billing')
        .insert({
          franchise_id: canonicalFrId(franchiseId),
          mode_payment: paymentMode,
          created_by: user?.id,
          total: payableTotal // <-- after discount
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
          total: payableTotal, // print discounted total
          paymentMode,
          billNumber: billData.id,
          date: billData.created_at || new Date(),
          meta: {
            subtotal,
            discountAmount,
            discountMode,
            discountValue: discountInput
          }
        };
        await printReceipt(receiptData);
      }

      setBillItems([]);
      setPaymentDialogOpen(false);
      setDiscountInput('');
      setDiscountMode('amount');
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
    if (searchTerm.trim()) {
      return menuItems.filter(item =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    if (selectedCategory === 'all') return menuItems;
    return menuItems.filter(
      item =>
        item.category === selectedCategory ||
        (!item.category && selectedCategory === 'Others')
    );
  }, [menuItems, searchTerm, selectedCategory]);

  const groupedMenuItems = useMemo(() => {
    if (searchTerm.trim()) return { all: filteredItems };
    const groups: Record<string, MenuItem[]> = {};
    filteredItems.forEach(item => {
      const category = item.category || 'Others';
      if (!groups[category]) groups[category] = [];
      groups[category].push(item);
    });
    return groups;
  }, [filteredItems, searchTerm]);

  useEffect(() => {
    if (searchTerm.trim()) setSelectedCategory('all');
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
                    total: subtotal,
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
                {/* Keep summary outside popup as before (pre-discount) */}
                <div className="flex justify-between text-xl font-bold text-gray-800">
                  <span>Total:</span>
                  <span>₹{subtotal.toFixed(2)}</span>
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

                    {/* Items list */}
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
                    </div>

                    {/* NEW: Discount controls */}
                    <div className="space-y-2 mb-4">
                      <div className="text-sm font-medium text-gray-800">Discount</div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant={discountMode === 'amount' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setDiscountMode('amount')}
                          style={discountMode === 'amount' ? { backgroundColor: 'rgb(0,100,55)', color: 'white' } : {}}
                        >
                          ₹ Amount
                        </Button>
                        <Button
                          type="button"
                          variant={discountMode === 'percent' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setDiscountMode('percent')}
                          style={discountMode === 'percent' ? { backgroundColor: 'rgb(0,100,55)', color: 'white' } : {}}
                        >
                          % Percent
                        </Button>
                      </div>

                      {/* Aligned inputs */}
                      <div className="relative flex items-center">
                        {discountMode === 'amount' ? (
                          <>
                            {/* LEFT PREFIX: ₹ */}
                            <div className="pointer-events-none absolute left-0 inset-y-0 flex items-center pl-3 h-10">
                              <span className="text-gray-500 text-sm leading-none align-middle">₹</span>
                            </div>
                            <Input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="0.01"
                              placeholder="0.00"
                              value={discountInput}
                              onChange={(e) => setDiscountInput(e.target.value)}
                              className="h-10 pl-8 pr-3 text-sm leading-none"
                            />
                            <div className="text-xs text-gray-500 mt-1 pl-1">
                              Max ₹{subtotal.toFixed(2)}
                            </div>
                          </>
                        ) : (
                          <>
                            <Input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              max={100}
                              step="0.01"
                              placeholder="0"
                              value={discountInput}
                              onChange={(e) => setDiscountInput(e.target.value)}
                              className="h-10 pr-8 pl-8 text-sm leading-none ml-2"
                            />
                            {/* RIGHT SUFFIX: % */}
                            <div className="pointer-events-none absolute right-0 inset-y-0 flex items-center pr-3 h-10">
                              <span className="text-gray-500 text-sm leading-none align-middle"></span>
                            </div>
                            <div className="text-xs text-gray-500 mt-1 pl-1 ml-2">
                            Max 100%
                            </div>
                          </>
                        )}
                      </div>

                      {/* Summary with discount */}
                      <div className="mt-2 border rounded-md p-3 bg-gray-50 space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Subtotal</span>
                          <span className="font-medium text-gray-800">₹{subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">
                            Discount{discountMode === 'percent' && discountInput ? ` (${parseFloat(discountInput) || 0}%)` : ''}
                          </span>
                          <span className="font-medium text-rose-600">- ₹{discountAmount.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between pt-1 border-t">
                          <span className="font-semibold text-gray-800">Total Payable</span>
                          <span className="font-semibold text-gray-900">₹{payableTotal.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Payment buttons */}
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
                            total: subtotal,
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
                            total: subtotal,
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
