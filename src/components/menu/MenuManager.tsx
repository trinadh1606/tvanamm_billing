import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Plus, Edit, Trash2, Menu, RefreshCw } from 'lucide-react';
import { MasterMenuSync } from './MasterMenuSync';

interface MenuItem {
  id: number;
  name: string;
  price: number;
  category: string;
  franchise_id: string;
}

interface MenuManagerProps {
  isCentral?: boolean;
}

export function MenuManager({ isCentral = false }: MenuManagerProps) {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncingItem, setSyncingItem] = useState<MenuItem | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    price: '',
    category: '',
    franchise_id: '',
  });
  
  const { franchiseId, user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    fetchMenuItems();
  }, [franchiseId, isCentral]);

  const fetchMenuItems = async () => {
    setLoading(true);
    
    try {
      let query = supabase.from('menu_items').select('*');
      
      if (!isCentral && franchiseId) {
        query = query.eq('franchise_id', franchiseId);
      }
      
      const { data, error } = await query.order('category').order('name');
      
      if (error) throw error;
      setMenuItems(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to fetch menu items",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const itemData = {
        name: formData.name,
        price: Number(formData.price),
        category: formData.category,
        franchise_id: isCentral ? formData.franchise_id : franchiseId,
        created_by: user?.id,
      };

      if (editingItem) {
        const { error } = await supabase
          .from('menu_items')
          .update(itemData)
          .eq('id', editingItem.id);
        
        if (error) throw error;
        
        toast({
          title: "Success",
          description: "Menu item updated successfully",
        });
      } else {
        const { error } = await supabase
          .from('menu_items')
          .insert(itemData);
        
        if (error) throw error;
        
        toast({
          title: "Success",
          description: "Menu item added successfully",
        });
      }

      setDialogOpen(false);
      setEditingItem(null);
      setFormData({ name: '', price: '', category: '', franchise_id: '' });
      fetchMenuItems();
      
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save menu item",
        variant: "destructive",
      });
    }
  };

  const handleEdit = (item: MenuItem) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      price: item.price.toString(),
      category: item.category,
      franchise_id: item.franchise_id,
    });
    setDialogOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    
    try {
      const { error } = await supabase
        .from('menu_items')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      toast({
        title: "Success",
        description: "Menu item deleted successfully",
      });
      
      fetchMenuItems();
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to delete menu item",
        variant: "destructive",
      });
    }
  };

  const handleSync = (item: MenuItem) => {
    setSyncingItem(item);
    setSyncDialogOpen(true);
  };

  const groupedItems = menuItems.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, MenuItem[]>);

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center gap-2">
            <Menu className="h-5 w-5" />
            Menu Management
            {isCentral && <span className="text-sm text-muted-foreground">(All Franchises)</span>}
          </CardTitle>
          
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>
            </DialogTrigger>
            
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingItem ? 'Edit Menu Item' : 'Add New Menu Item'}
                </DialogTitle>
              </DialogHeader>
              
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Item Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="price">Price</Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Input
                    id="category"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    placeholder="e.g., Beverages, Snacks, Main Course"
                    required
                  />
                </div>
                
                {isCentral && (
                  <div className="space-y-2">
                    <Label htmlFor="franchise">Franchise ID</Label>
                    <Input
                      id="franchise"
                      value={formData.franchise_id}
                      onChange={(e) => setFormData({ ...formData, franchise_id: e.target.value })}
                      placeholder="Enter franchise ID"
                      required
                    />
                  </div>
                )}
                
                <div className="flex gap-2">
                  <Button type="submit" className="flex-1">
                    {editingItem ? 'Update' : 'Add'} Item
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => {
                      setDialogOpen(false);
                      setEditingItem(null);
                      setFormData({ name: '', price: '', category: '', franchise_id: '' });
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      
      <CardContent>
        {loading ? (
          <div className="text-center py-8">Loading menu items...</div>
        ) : Object.keys(groupedItems).length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No menu items found</div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedItems).map(([category, items]) => (
              <div key={category}>
                <h3 className="text-lg font-semibold mb-3 text-primary">{category}</h3>
                <div className="grid gap-2">
                  {items.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex-1">
                        <div className="font-medium">{item.name}</div>
                        <div className="text-sm text-muted-foreground">
                          ₹{item.price} 
                          {isCentral && ` • ${item.franchise_id}`}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleEdit(item)}>
                          <Edit className="h-3 w-3" />
                        </Button>
                        {isCentral && (
                          <Button size="sm" variant="secondary" onClick={() => handleSync(item)}>
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                        )}
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(item.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Master Menu Sync Dialog */}
      {syncingItem && (
        <MasterMenuSync
          open={syncDialogOpen}
          onOpenChange={setSyncDialogOpen}
          sourceItem={syncingItem}
          onSyncComplete={() => {
            fetchMenuItems();
            setSyncDialogOpen(false);
            setSyncingItem(null);
          }}
        />
      )}
    </Card>
  );
}