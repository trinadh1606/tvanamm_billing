import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Building2, CheckCircle, AlertCircle, Copy, Search } from 'lucide-react';

interface MenuItem {
  id: number;
  name: string;
  price: number;
  category: string;
  franchise_id: string;
}

interface MasterMenuSyncProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceItem: MenuItem;
  onSyncComplete: () => void;
  loggedInFranchiseId: string;
}

export function MasterMenuSync({ open, onOpenChange, sourceItem, onSyncComplete, loggedInFranchiseId }: MasterMenuSyncProps) {
  const [syncMode, setSyncMode] = useState<'all' | 'selected'>('all');
  const [availableFranchises, setAvailableFranchises] = useState<string[]>([]);
  const [selectedFranchises, setSelectedFranchises] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<{success: string[], failed: string[]}>({success: [], failed: []});
  const [searchFranchiseId, setSearchFranchiseId] = useState('');
  const [searchedMenuItems, setSearchedMenuItems] = useState<MenuItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchAvailableFranchises();
      setSyncResults({success: [], failed: []});
    }
  }, [open]);

  const fetchAvailableFranchises = async () => {
    try {
      const { data, error } = await supabase
        .from('bills_generated_billing')
        .select('franchise_id')
        .neq('franchise_id', loggedInFranchiseId);

      if (error) throw error;

      const uniqueFranchises = [...new Set(data?.map(b => b.franchise_id) || [])];
      setAvailableFranchises(uniqueFranchises);
      setSelectedFranchises(uniqueFranchises);
    } catch (error) {
      console.error('Error fetching franchises:', error);
    }
  };

  const fetchMenuItemsForFranchise = async (franchiseId: string) => {
    try {
      const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .eq('franchise_id', franchiseId);

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Error fetching menu items:', error);
      return [];
    }
  };

  const handleSearch = async () => {
    if (!searchFranchiseId) {
      toast({
        title: "Error",
        description: "Please enter a franchise ID",
        variant: "destructive",
      });
      return;
    }

    setSearchLoading(true);
    try {
      const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .eq('franchise_id', searchFranchiseId);

      if (error) throw error;

      setSearchedMenuItems(data || []);
      toast({
        title: "Success",
        description: `Found ${data?.length || 0} menu items for franchise ${searchFranchiseId}`,
      });
    } catch (error) {
      console.error('Error searching menu items:', error);
      toast({
        title: "Error",
        description: "Failed to fetch menu items",
        variant: "destructive",
      });
      setSearchedMenuItems([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    const targetFranchises = syncMode === 'all' ? availableFranchises : selectedFranchises;
    const results = {success: [] as string[], failed: [] as string[]};

    for (const franchiseId of targetFranchises) {
      if (franchiseId !== loggedInFranchiseId) {
        console.log(`Skipping sync for franchise ${franchiseId} as it's not the logged-in franchise`);
        continue;
      }

      try {
        const menuItems = await fetchMenuItemsForFranchise(franchiseId);

        if (menuItems.length === 0) {
          console.log(`No menu items found for franchise ${franchiseId}`);
          continue;
        }

        const { data: existingItem } = await supabase
          .from('menu_items')
          .select('id')
          .eq('franchise_id', franchiseId)
          .eq('name', sourceItem.name)
          .single();

        const itemData = {
          name: sourceItem.name,
          price: sourceItem.price,
          category: sourceItem.category,
          franchise_id: franchiseId,
          created_by: 'central-sync'
        };

        if (existingItem) {
          const { error } = await supabase
            .from('menu_items')
            .update(itemData)
            .eq('id', existingItem.id);

          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('menu_items')
            .insert(itemData);

          if (error) throw error;
        }

        results.success.push(franchiseId);
      } catch (error) {
        console.error(`Failed to sync to ${franchiseId}:`, error);
        results.failed.push(franchiseId);
      }
    }

    setSyncResults(results);
    setSyncing(false);

    if (results.success.length > 0) {
      toast({
        title: "Sync Complete",
        description: `Successfully synced to ${results.success.length} franchise(s)`,
      });
      onSyncComplete();
    }

    if (results.failed.length > 0) {
      toast({
        title: "Partial Sync Failure",
        description: `Failed to sync to ${results.failed.length} franchise(s)`,
        variant: "destructive",
      });
    }
  };

  const toggleFranchiseSelection = (franchiseId: string) => {
    setSelectedFranchises(prev => 
      prev.includes(franchiseId) 
        ? prev.filter(id => id !== franchiseId)
        : [...prev, franchiseId]
    );
  };

  return null;
}