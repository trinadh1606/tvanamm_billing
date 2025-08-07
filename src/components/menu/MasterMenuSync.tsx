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
import { RefreshCw, Building2, CheckCircle, AlertCircle, Copy } from 'lucide-react';

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
}

export function MasterMenuSync({ open, onOpenChange, sourceItem, onSyncComplete }: MasterMenuSyncProps) {
  const [syncMode, setSyncMode] = useState<'all' | 'selected'>('all');
  const [availableFranchises, setAvailableFranchises] = useState<string[]>([]);
  const [selectedFranchises, setSelectedFranchises] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<{success: string[], failed: string[]}>({success: [], failed: []});
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
        .neq('franchise_id', sourceItem.franchise_id);

      if (error) throw error;

      const uniqueFranchises = [...new Set(data?.map(b => b.franchise_id) || [])];
      setAvailableFranchises(uniqueFranchises);
      setSelectedFranchises(uniqueFranchises);
    } catch (error) {
      console.error('Error fetching franchises:', error);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    const targetFranchises = syncMode === 'all' ? availableFranchises : selectedFranchises;
    const results = {success: [] as string[], failed: [] as string[]};

    for (const franchiseId of targetFranchises) {
      try {
        // Check if item already exists
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
          // Update existing item
          const { error } = await supabase
            .from('menu_items')
            .update(itemData)
            .eq('id', existingItem.id);

          if (error) throw error;
        } else {
          // Insert new item
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Master Menu Synchronization
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Source Item Display */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Source Item from {sourceItem.franchise_id}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">{sourceItem.name}</h3>
                  <p className="text-sm text-muted-foreground">{sourceItem.category}</p>
                </div>
                <Badge variant="outline">₹{sourceItem.price}</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Sync Mode Selection */}
          <div className="space-y-4">
            <Label className="text-base font-medium">Synchronization Options</Label>
            
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="sync-all"
                  checked={syncMode === 'all'}
                  onCheckedChange={() => setSyncMode('all')}
                />
                <Label htmlFor="sync-all">Apply to All Franchises ({availableFranchises.length} franchises)</Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="sync-selected"
                  checked={syncMode === 'selected'}
                  onCheckedChange={() => setSyncMode('selected')}
                />
                <Label htmlFor="sync-selected">Apply to Selected Franchises</Label>
              </div>
            </div>
          </div>

          {/* Franchise Selection */}
          {syncMode === 'selected' && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Select Target Franchises</Label>
              <div className="max-h-40 overflow-y-auto border rounded-lg p-3 space-y-2">
                {availableFranchises.map(franchiseId => (
                  <div key={franchiseId} className="flex items-center space-x-2">
                    <Checkbox
                      id={franchiseId}
                      checked={selectedFranchises.includes(franchiseId)}
                      onCheckedChange={() => toggleFranchiseSelection(franchiseId)}
                    />
                    <Label htmlFor={franchiseId} className="flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      {franchiseId}
                    </Label>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedFranchises.length} of {availableFranchises.length} franchises selected
              </p>
            </div>
          )}

          {/* Sync Results */}
          {(syncResults.success.length > 0 || syncResults.failed.length > 0) && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Sync Results</Label>
              
              {syncResults.success.length > 0 && (
                <div className="p-3 bg-success/10 border border-success/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-4 w-4 text-success" />
                    <span className="text-sm font-medium text-success">Successfully Synced</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {syncResults.success.map(franchiseId => (
                      <Badge key={franchiseId} variant="outline" className="text-success">
                        {franchiseId}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {syncResults.failed.length > 0 && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    <span className="text-sm font-medium text-destructive">Failed to Sync</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {syncResults.failed.map(franchiseId => (
                      <Badge key={franchiseId} variant="outline" className="text-destructive">
                        {franchiseId}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button 
              onClick={handleSync} 
              disabled={syncing || (syncMode === 'selected' && selectedFranchises.length === 0)}
              className="flex-1"
            >
              {syncing ? (
                <>
                  <Copy className="h-4 w-4 mr-2 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Sync to {syncMode === 'all' ? availableFranchises.length : selectedFranchises.length} Franchise(s)
                </>
              )}
            </Button>
            
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}