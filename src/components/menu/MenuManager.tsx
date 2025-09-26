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
import { Plus, Edit, Trash2, Menu, RefreshCw, Search } from 'lucide-react';
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

const CENTRAL_ID = 'FR-CENTRAL';

// Helper: format labels like "1111" -> "FR-1111", keep "FR-0001" and "FR-CENTRAL" as-is
const formatFranchiseLabel = (raw: string) => {
  const id = (raw || '').trim();
  if (!id) return '';
  const up = id.toUpperCase();
  if (up === CENTRAL_ID) return CENTRAL_ID;
  if (up.startsWith('FR-')) return up;
  if (/^\d+$/.test(id)) return `FR-${id.padStart(4, '0')}`;
  return `FR-${up}`;
};

// Build possible variants for a typed ID (e.g., "0002" -> ["0002","2","0002","FR-0002"])
// NOTE: intentionally NOT including "FR-2" variant.
const buildFranchiseIdVariants = (raw: string) => {
  const id = (raw || '').trim();
  if (!id) return [] as string[];
  const up = id.toUpperCase();
  const out = new Set<string>();

  if (up === CENTRAL_ID) return [CENTRAL_ID];

  if (up.startsWith('FR-')) {
    const digits = up.slice(3);
    const noPad = digits.replace(/^0+/, '') || '0';
    const padded4 = digits.padStart(4, '0');
    out.add(up);         // FR-0002 (as-typed)
    out.add(digits);     // 0002
    out.add(noPad);      // 2
    out.add(padded4);    // 0002 (normalized width)
    // intentionally not adding FR-2
  } else {
    const noPad = id.replace(/^0+/, '') || '0';
    const padded4 = id.padStart(4, '0');
    out.add(id);                        // as typed (e.g., "0002")
    out.add(noPad);                     // "2"
    out.add(padded4);                   // "0002"
    out.add(`FR-${id.toUpperCase()}`);  // "FR-0002" if typed "0002"
    out.add(`FR-${padded4}`);           // "FR-0002"
    // intentionally not adding FR-2
  }
  return Array.from(out);
};

// Resolve to the exact franchise_id string present in DB if possible
const resolveFranchiseIdForQuery = (input: string, existingIds: string[]) => {
  const variants = buildFranchiseIdVariants(input).map(v => v.toUpperCase());
  const found = existingIds.find(dbId => variants.includes((dbId || '').toUpperCase()));
  return found || input.trim();
};

export function MenuManager({ isCentral = false }: MenuManagerProps) {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<MenuItem[]>([]);
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
  const [selectedFranchiseId, setSelectedFranchiseId] = useState('');
  const [availableFranchises, setAvailableFranchises] = useState<string[]>([]);
  const [fetchingFranchises, setFetchingFranchises] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Clone UI state
  const [cloneTargetFranchiseId, setCloneTargetFranchiseId] = useState('');
  const [cloning, setCloning] = useState(false);

  // Manual Franchise ID to fetch
  const [manualFranchiseId, setManualFranchiseId] = useState('');

  const { franchiseId, user } = useAuth();
  const { toast } = useToast();

  // Initial load
  useEffect(() => {
    if (isCentral) {
      fetchAvailableFranchises();
      setMenuItems([]);
      setFilteredItems([]);
      setLoading(false);
    } else if (franchiseId) {
      fetchMenuItems(franchiseId);
    }
  }, [franchiseId, isCentral]);

  // Search filter
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredItems(menuItems);
    } else {
      const q = searchQuery.toLowerCase();
      setFilteredItems(
        menuItems.filter(i =>
          i.name.toLowerCase().includes(q) ||
          i.category.toLowerCase().includes(q) ||
          i.price.toString().includes(q)
        )
      );
    }
  }, [searchQuery, menuItems]);

  const fetchMenuItems = async (targetFranchiseId?: string) => {
    setLoading(true);
    setMenuItems([]);
    setFilteredItems([]);
    try {
      let idToUse = '';
      if (isCentral) {
        idToUse = (targetFranchiseId || selectedFranchiseId || '').trim();
        if (!idToUse) {
          setLoading(false);
          return;
        }
      } else {
        if (!franchiseId) throw new Error('Franchise ID not available');
        idToUse = franchiseId;
      }

      const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .eq('franchise_id', idToUse)
        .order('category', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;

      setMenuItems(data || []);
      setFilteredItems(data || []);
    } catch (error: any) {
      console.error('fetchMenuItems error:', error);
      toast({ title: 'Error', description: 'Failed to fetch menu items', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableFranchises = async () => {
    setFetchingFranchises(true);
    try {
      const { data, error } = await supabase
        .from('menu_items')
        .select('franchise_id')
        .order('franchise_id', { ascending: true });

      if (error) throw error;

      const map = new Map<string, string>();
      (data ?? []).forEach((row: any) => {
        const raw = (row?.franchise_id ?? '') as string;
        const cleaned = raw.trim();
        if (!cleaned) return;
        const key = cleaned.toUpperCase();
        if (!map.has(key)) map.set(key, cleaned);
      });
      setAvailableFranchises(Array.from(map.values()));
    } catch (error) {
      console.error('Error fetching franchises:', error);
      toast({ title: 'Error', description: 'Failed to fetch available franchises', variant: 'destructive' });
    } finally {
      setFetchingFranchises(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const itemData = {
        name: formData.name.trim(),
        price: Number(formData.price),
        category: formData.category.trim(),
        franchise_id: isCentral ? (formData.franchise_id || selectedFranchiseId).trim() : franchiseId,
        created_by: user?.id,
      };
      if (!itemData.franchise_id) throw new Error('Franchise ID is required');

      if (editingItem) {
        const { error } = await supabase.from('menu_items').update(itemData).eq('id', editingItem.id);
        if (error) throw error;
        toast({ title: 'Success', description: 'Menu item updated successfully' });
      } else {
        const { error } = await supabase.from('menu_items').insert(itemData);
        if (error) throw error;
        toast({ title: 'Success', description: 'Menu item added successfully' });
      }

      setDialogOpen(false);
      setEditingItem(null);
      setFormData({ name: '', price: '', category: '', franchise_id: '' });

      if (isCentral) {
        if (selectedFranchiseId) fetchMenuItems(selectedFranchiseId);
      } else if (franchiseId) {
        fetchMenuItems(franchiseId);
      }
    } catch (error: any) {
      console.error('handleSubmit error:', error);
      toast({ title: 'Error', description: error.message || 'Failed to save menu item', variant: 'destructive' });
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
      const { error } = await supabase.from('menu_items').delete().eq('id', id);
      if (error) throw error;
      toast({ title: 'Success', description: 'Menu item deleted successfully' });
      if (isCentral) {
        if (selectedFranchiseId) fetchMenuItems(selectedFranchiseId);
      } else if (franchiseId) {
        fetchMenuItems(franchiseId);
      }
    } catch (error: any) {
      console.error('handleDelete error:', error);
      toast({ title: 'Error', description: 'Failed to delete menu item', variant: 'destructive' });
    }
  };

  const handleSync = (item: MenuItem) => {
    setSyncingItem(item);
    setSyncDialogOpen(true);
  };

  const handleFetchByFranchise = () => {
    const typed = manualFranchiseId.trim();
    const chosen = (selectedFranchiseId || '').trim();
    const rawId = typed || chosen;

    if (!rawId) {
      toast({ title: 'Error', description: 'Please select or enter a franchise ID', variant: 'destructive' });
      return;
    }

    // Resolve to an ID that exists in DB if possible
    const resolved = resolveFranchiseIdForQuery(rawId, availableFranchises);

    // Update selection (so the header tag shows the exact ID being queried)
    setSelectedFranchiseId(resolved);

    // Fetch
    fetchMenuItems(resolved);
  };

  // Clone all items from FR-CENTRAL into the entered franchise, skipping existing ones
  const handleCloneCentral = async () => {
    const target = cloneTargetFranchiseId.trim();
    if (!target) {
      toast({ title: 'Error', description: 'Enter a target Franchise ID', variant: 'destructive' });
      return;
    }
    if (!user?.id) {
      toast({ title: 'Error', description: 'User not found. Please log in again.', variant: 'destructive' });
      return;
    }
    setCloning(true);
    try {
      const { data: centralItems, error: fetchCentralErr } = await supabase
        .from('menu_items')
        .select('name, price, category')
        .eq('franchise_id', CENTRAL_ID);
      if (fetchCentralErr) throw fetchCentralErr;

      if (!centralItems || centralItems.length === 0) {
        toast({ title: 'Nothing to clone', description: `No items found in ${CENTRAL_ID}.` });
        return;
      }

      const { data: targetItems, error: fetchTargetErr } = await supabase
        .from('menu_items')
        .select('name, category')
        .eq('franchise_id', target);
      if (fetchTargetErr) throw fetchTargetErr;

      const existingKeys = new Set((targetItems ?? []).map(t => `${t.name}|||${t.category}`));

      const rowsToInsert = (centralItems ?? [])
        .filter(ci => !existingKeys.has(`${ci.name}|||${ci.category}`))
        .map(ci => ({
          name: ci.name,
          price: Number(ci.price),
          category: ci.category,
          franchise_id: target,
          created_by: user.id,
        }));

      if (rowsToInsert.length === 0) {
        toast({ title: 'Up to date', description: `No new items to add for ${target}.` });
        return;
      }

      const { error: insertErr } = await supabase.from('menu_items').insert(rowsToInsert);
      if (insertErr) throw insertErr;

      toast({ title: 'Cloned', description: `Added ${rowsToInsert.length} new item(s) to ${target}.` });

      if (isCentral) {
        setSelectedFranchiseId(target);
        await fetchMenuItems(target);
      } else if (franchiseId === target) {
        await fetchMenuItems(target);
      }

      setCloneTargetFranchiseId('');
    } catch (error: any) {
      console.error('handleCloneCentral error:', error);
      toast({ title: 'Error', description: error.message || 'Failed to clone menu', variant: 'destructive' });
    } finally {
      setCloning(false);
    }
  };

  const visibleItems = isCentral ? filteredItems : filteredItems.filter(i => i.franchise_id === franchiseId);
  const groupedItems = visibleItems.reduce((acc, item) => {
    (acc[item.category] ||= []).push(item);
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

          {/* Keep Add Item in header only for non-central users */}
          {!isCentral && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Item
                </Button>
              </DialogTrigger>

              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingItem ? 'Edit Menu Item' : 'Add New Menu Item'}</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Item Name</Label>
                    <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="price">Price</Label>
                    <Input id="price" type="number" step="0.01" value={formData.price} onChange={(e) => setFormData({ ...formData, price: e.target.value })} required />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Input id="category" value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} placeholder="e.g., Beverages, Snacks, Main Course" required />
                  </div>

                  {isCentral && (
                    <div className="space-y-2">
                      <Label htmlFor="franchise">Franchise ID</Label>
                      <Input id="franchise" value={formData.franchise_id || selectedFranchiseId} onChange={(e) => setFormData({ ...formData, franchise_id: e.target.value })} placeholder="Enter franchise ID" />
                      <p className="text-xs text-muted-foreground">Defaults to the selected franchise if left blank.</p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button type="submit" className="flex-1">{editingItem ? 'Update' : 'Add'} Item</Button>
                    <Button type="button" variant="outline" onClick={() => { setDialogOpen(false); setEditingItem(null); setFormData({ name: '', price: '', category: '', franchise_id: '' }); }}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {/* Clone Central Menu (UI + functionality) — same line at md+ */}
        {isCentral && (
          <div className="mb-6 p-4 border rounded-lg bg-white" style={{ borderColor: 'rgb(0,100,55)' }}>
            <h4 className="text-base font-semibold mb-3" style={{ color: 'rgb(0,100,55)' }}>
              Clone Central Menu
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div>
                <Label className="sr-only">Source</Label>
                <Input value={CENTRAL_ID} readOnly className="h-10 bg-white" />
              </div>
              <div>
                <Label htmlFor="cloneTarget" className="sr-only">Target Franchise ID</Label>
                <Input
                  id="cloneTarget"
                  placeholder="Target Franchise ID (e.g., FR-0002)"
                  value={cloneTargetFranchiseId}
                  onChange={(e) => setCloneTargetFranchiseId(e.target.value)}
                  className="h-10"
                />
              </div>
              <div>
                <Button
                  type="button"
                  onClick={handleCloneCentral}
                  disabled={!cloneTargetFranchiseId.trim() || cloning || !user?.id}
                  className="h-10 w-full md:w-auto px-4 text-white"
                  style={{ backgroundColor: 'rgb(0,100,55)' }}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${cloning ? 'animate-spin' : ''}`} />
                  {cloning ? 'Cloning...' : 'Clone Menu'}
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground mt-2">Clones all items from the central master menu into the target franchise.</p>
          </div>
        )}

        {/* Search Bar — below the clone section */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search menu items..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {isCentral && (
          <div className="mb-4 flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            {/* Dropdown */}
            <div className="flex-1 space-y-2 w-full">
              <Label className="text-sm font-medium">Select Franchise</Label>
              <Select value={selectedFranchiseId} onValueChange={(val) => setSelectedFranchiseId(val.trim())} disabled={fetchingFranchises}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={fetchingFranchises ? 'Loading franchises...' : 'Select a franchise'} />
                </SelectTrigger>
                <SelectContent>
                  {availableFranchises.map(frId => (
                    <SelectItem key={frId} value={frId}>
                      {formatFranchiseLabel(frId)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Manual Franchise ID input (left of Get Menu) */}
            <div className="w-full sm:w-64 space-y-2">
              <Label className="text-sm font-medium" htmlFor="manualFranchiseId">Enter Franchise ID</Label>
              <Input
                id="manualFranchiseId"
                placeholder="e.g., 0002 or FR-0002"
                value={manualFranchiseId}
                onChange={(e) => setManualFranchiseId(e.target.value)}
                className="h-10"
              />
            </div>

            {/* Get Menu button */}
            <Button
              onClick={handleFetchByFranchise}
              disabled={(!selectedFranchiseId && !manualFranchiseId) || loading}
              className="w-full sm:w-auto h-10"
              style={{ backgroundColor: 'rgb(0,100,55)', color: 'white' }}
            >
              <Search className="h-4 w-4 mr-2" />
              Get Menu
            </Button>

            {/* Add Item button placed BESIDE Get Menu for central users */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  className="w-full sm:w-auto h-10"
                  style={{ backgroundColor: 'rgb(0,100,55)', color: 'white' }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Item
                </Button>
              </DialogTrigger>

              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingItem ? 'Edit Menu Item' : 'Add New Menu Item'}</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Item Name</Label>
                    <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="price">Price</Label>
                    <Input id="price" type="number" step="0.01" value={formData.price} onChange={(e) => setFormData({ ...formData, price: e.target.value })} required />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Input id="category" value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} placeholder="e.g., Beverages, Snacks, Main Course" required />
                  </div>

                  {isCentral && (
                    <div className="space-y-2">
                      <Label htmlFor="franchise">Franchise ID</Label>
                      <Input id="franchise" value={formData.franchise_id || selectedFranchiseId} onChange={(e) => setFormData({ ...formData, franchise_id: e.target.value })} placeholder="Enter franchise ID" />
                      <p className="text-xs text-muted-foreground">Defaults to the selected franchise if left blank.</p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button type="submit" className="flex-1">{editingItem ? 'Update' : 'Add'} Item</Button>
                    <Button type="button" variant="outline" onClick={() => { setDialogOpen(false); setEditingItem(null); setFormData({ name: '', price: '', category: '', franchise_id: '' }); }}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {loading ? (
          <div className="text-center py-8">Loading menu items...</div>
        ) : Object.keys(groupedItems).length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {isCentral && !selectedFranchiseId
              ? 'Select a franchise and click "Get Menu"'
              : searchQuery.trim() !== ''
                ? 'No menu items match your search'
                : isCentral
                  ? `No menu items found for franchise ${selectedFranchiseId || '(none selected)'}`
                  : 'No menu items found'}
          </div>
        ) : (
          <div className="space-y-6">
            {isCentral && selectedFranchiseId && (
              <>
                <div className="text-sm text-muted-foreground">
                  Showing menu for franchise: <span className="font-medium">{selectedFranchiseId}</span>
                  {searchQuery.trim() !== '' && <span> • Filtered by search</span>}
                </div>
                <div className="text-sm text-muted-foreground">
                  Total items: <span className="font-medium">{menuItems.length}</span>
                </div>
              </>
            )}
            {Object.entries(groupedItems).map(([category, items]) => (
              <div key={category}>
                <h3 className="text-lg font-semibold mb-3" style={{ color: 'rgb(0,100,55)' }}>
                  {category}
                </h3>
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
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleSync(item)}
                            className="text-white"
                            style={{ backgroundColor: 'rgb(0,100,55)' }}
                          >
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

      {syncingItem && (
        <MasterMenuSync
          open={syncDialogOpen}
          onOpenChange={setSyncDialogOpen}
          sourceItem={syncingItem}
          onSyncComplete={() => {
            if (isCentral) {
              if (selectedFranchiseId) fetchMenuItems(selectedFranchiseId);
            } else if (franchiseId) {
              fetchMenuItems(franchiseId);
            }
            setSyncDialogOpen(false);
            setSyncingItem(null);
          }}
          loggedInFranchiseId={franchiseId || ''}
        />
      )}
    </Card>
  );
}
