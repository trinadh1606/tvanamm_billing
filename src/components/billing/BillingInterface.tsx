import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Plus, Minus, Trash2, Receipt, Calculator } from 'lucide-react';
import logo from '@/assets/t-vanamm-logo.png';

interface BillItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export const BillingInterface = () => {
  const [items, setItems] = useState<BillItem[]>([]);
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [discount, setDiscount] = useState(0);
  const [customerName, setCustomerName] = useState('');

  const addItem = () => {
    if (itemName && itemPrice) {
      const newItem: BillItem = {
        id: Date.now().toString(),
        name: itemName,
        price: parseFloat(itemPrice),
        quantity: 1
      };
      setItems([...items, newItem]);
      setItemName('');
      setItemPrice('');
    }
  };

  const updateQuantity = (id: string, change: number) => {
    setItems(items.map(item => 
      item.id === id 
        ? { ...item, quantity: Math.max(0, item.quantity + change) }
        : item
    ).filter(item => item.quantity > 0));
  };

  const removeItem = (id: string) => {
    setItems(items.filter(item => item.id !== id));
  };

  const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const discountAmount = (subtotal * discount) / 100;
  const total = subtotal - discountAmount;

  return (
    <div className="min-h-screen bg-gradient-subtle p-4">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-4 mb-4">
            <img src={logo} alt="T Vanamm Logo" className="h-16 w-auto" />
            <div>
              <h1 className="text-4xl font-bold text-foreground">T Vanamm</h1>
              <p className="text-lg text-secondary font-medium">POS System</p>
            </div>
          </div>
          <p className="text-muted-foreground">
            Professional billing made simple
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Item Entry */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-primary" />
                Add Items
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="customer">Customer Name</Label>
                <Input
                  id="customer"
                  placeholder="Enter customer name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
              
              <div>
                <Label htmlFor="item-name">Item Name</Label>
                <Input
                  id="item-name"
                  placeholder="Enter item name"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                />
              </div>
              
              <div>
                <Label htmlFor="item-price">Price ($)</Label>
                <Input
                  id="item-price"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={itemPrice}
                  onChange={(e) => setItemPrice(e.target.value)}
                />
              </div>
              
              <Button onClick={addItem} className="w-full" variant="pos">
                <Plus className="h-4 w-4" />
                Add Item
              </Button>
            </CardContent>
          </Card>

          {/* Bill Items */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5 text-secondary" />
                Current Bill
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {items.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    No items added yet
                  </p>
                ) : (
                  items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex-1">
                        <h4 className="font-medium">{item.name}</h4>
                        <p className="text-sm text-muted-foreground">
                          ${item.price.toFixed(2)} each
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => updateQuantity(item.id, -1)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        
                        <Badge variant="secondary" className="min-w-8">
                          {item.quantity}
                        </Badge>
                        
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => updateQuantity(item.id, 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        
                        <Button
                          size="icon"
                          variant="destructive"
                          onClick={() => removeItem(item.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Receipt & Total */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-success" />
                Receipt Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal:</span>
                  <span className="font-medium">${subtotal.toFixed(2)}</span>
                </div>
                
                <div className="flex items-center gap-2">
                  <Label htmlFor="discount" className="text-sm">Discount (%):</Label>
                  <Input
                    id="discount"
                    type="number"
                    min="0"
                    max="100"
                    value={discount}
                    onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                    className="flex-1"
                  />
                </div>
                
                {discount > 0 && (
                  <div className="flex justify-between text-warning">
                    <span>Discount:</span>
                    <span>-${discountAmount.toFixed(2)}</span>
                  </div>
                )}
                
                <Separator />
                
                <div className="flex justify-between text-lg font-bold">
                  <span>Total:</span>
                  <span className="text-primary">${total.toFixed(2)}</span>
                </div>
              </div>
              
              <div className="space-y-2">
                <Button 
                  className="w-full" 
                  variant="success" 
                  size="lg"
                  disabled={items.length === 0}
                >
                  <Receipt className="h-4 w-4" />
                  Generate Receipt
                </Button>
                
                <Button 
                  className="w-full" 
                  variant="secondary" 
                  size="lg"
                  disabled={items.length === 0}
                >
                  Print Receipt
                </Button>
              </div>
              
              {items.length > 0 && (
                <div className="pt-4 text-xs text-muted-foreground">
                  {items.length} item(s) • {items.reduce((sum, item) => sum + item.quantity, 0)} total quantity
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};