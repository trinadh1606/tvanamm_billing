import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Calendar,
  Download,
  CalendarIcon,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';

interface Bill {
  id: number;
  franchise_id: string;
  mode_payment: string;
  created_at: string;
  total: number;
  created_by: string;
}

interface BillHistoryProps {
  showAdvanced?: boolean;
  isCentral?: boolean;
}

type SortField = 'created_at' | 'total' | 'franchise_id' | 'id' | 'mode_payment';
type SortDirection = 'asc' | 'desc';

export function BillHistory({ showAdvanced = false, isCentral = false }: BillHistoryProps) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [filteredBills, setFilteredBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFranchise, setSelectedFranchise] = useState<string>('ALL');
  const [franchiseList, setFranchiseList] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState<Date>();
  const [toDate, setToDate] = useState<Date>();
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);
  const [selectedBillId, setSelectedBillId] = useState<number | null>(null);
  const [billItems, setBillItems] = useState<any[]>([]);
  const [itemLoading, setItemLoading] = useState(false);

  const { franchiseId, role } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    fetchBills();
    if (isCentral) fetchFranchiseList();
  }, [franchiseId, role]);

  useEffect(() => {
    applyFiltersAndSort();
  }, [bills, selectedFranchise, fromDate, toDate, sortField, sortDirection]);

  const fetchFranchiseList = async () => {
    try {
      const { data, error } = await supabase
        .from('bills_generated_billing')
        .select('franchise_id')
        .order('franchise_id');

      if (error) throw error;

      const unique = Array.from(new Set(data?.map((item) => item.franchise_id)));
      setFranchiseList(unique);
    } catch (error) {
      console.error('Error fetching franchise list:', error);
    }
  };

  const fetchBills = async () => {
    setLoading(true);
    try {
      let query = supabase.from('bills_generated_billing').select('*');
      if (!isCentral && franchiseId) query = query.eq('franchise_id', franchiseId);

      const { data, error } = await query.order('created_at', { ascending: false }).limit(1000);
      if (error) throw error;
      setBills(data || []);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to fetch bills',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchBillItems = async (billId: number) => {
    setItemLoading(true);
    setSelectedBillId(billId);
    try {
      const { data, error } = await supabase
        .from('bill_items_generated_billing')
        .select('*')
        .eq('bill_id', billId);

      if (error) throw error;
      setBillItems(data || []);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to fetch bill items',
        variant: 'destructive',
      });
    } finally {
      setItemLoading(false);
    }
  };

  const applyFiltersAndSort = () => {
    let filtered = [...bills];

    if (selectedFranchise !== 'ALL') {
      filtered = filtered.filter((bill) => bill.franchise_id === selectedFranchise);
    }

    if (fromDate) {
      const fromStr = fromDate.toISOString();
      filtered = filtered.filter((bill) => bill.created_at >= fromStr);
    }

    if (toDate) {
      const toStr = new Date(toDate);
      toStr.setHours(23, 59, 59, 999);
      filtered = filtered.filter((bill) => new Date(bill.created_at) <= toStr);
    }

    filtered.sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

      if (sortField === 'mode_payment') {
        aVal = aVal?.toLowerCase();
        bVal = bVal?.toLowerCase();
      } else if (sortField === 'total') {
        aVal = Number(aVal);
        bVal = Number(bVal);
      } else if (sortField === 'created_at') {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
      }

      if (aVal === bVal) return 0;
      return sortDirection === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
    });

    setFilteredBills(filtered);
    setCurrentPage(1);
  };

  const exportToExcel = () => {
    const exportData = filteredBills.map((bill) => ({
      'Bill ID': bill.id,
      'Franchise ID': bill.franchise_id,
      'Payment Mode': bill.mode_payment.toUpperCase(),
      'Total Amount (₹)': Number(bill.total).toFixed(2),
      'Created Date': new Date(bill.created_at).toLocaleDateString(),
      'Created Time': new Date(bill.created_at).toLocaleTimeString(),
      'Created By': bill.created_by,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Bills History');

    let filename = 'bills-history';
    if (selectedFranchise !== 'ALL') filename += `-${selectedFranchise}`;
    if (fromDate && toDate) {
      filename += `-${format(fromDate, 'yyyy-MM-dd')}_to_${format(toDate, 'yyyy-MM-dd')}`;
    }
    filename += `.xlsx`;

    XLSX.writeFile(workbook, filename);

    toast({
      title: 'Export Successful',
      description: `${filteredBills.length} bills exported to Excel`,
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const totalPages = Math.ceil(filteredBills.length / itemsPerPage);
  const currentBills = filteredBills.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const getPaymentBadgeVariant = (mode: string) => {
    switch (mode?.toLowerCase()) {
      case 'cash': return 'default';
      case 'card': return 'secondary';
      case 'upi': return 'outline';
      default: return 'outline';
    }
  };

  const gridCols = isCentral ? 'grid grid-cols-1 sm:grid-cols-6' : 'grid grid-cols-1 sm:grid-cols-5';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Bill History
          {isCentral && <Badge variant="outline">All Franchises</Badge>}
        </CardTitle>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="text-center py-8">Loading bills...</div>
        ) : filteredBills.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No bills found</div>
        ) : (
          <div className="space-y-4">
            <div className={`${gridCols} gap-4 p-4 bg-muted/50 rounded-lg font-medium`}>
              <Button variant="ghost" onClick={() => handleSort('id')} className="justify-start h-auto p-0">
                Bill ID <ArrowUpDown className="ml-1 h-3 w-3" />
              </Button>
              {isCentral && (
                <Button variant="ghost" onClick={() => handleSort('franchise_id')} className="justify-start h-auto p-0">
                  Franchise <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              )}
              <Button variant="ghost" onClick={() => handleSort('mode_payment')} className="justify-start h-auto p-0">
                Payment Mode <ArrowUpDown className="ml-1 h-3 w-3" />
              </Button>
              <Button variant="ghost" onClick={() => handleSort('total')} className="justify-start h-auto p-0">
                Amount <ArrowUpDown className="ml-1 h-3 w-3" />
              </Button>
              <Button variant="ghost" onClick={() => handleSort('created_at')} className="justify-start h-auto p-0 sm:col-span-2">
                Date <ArrowUpDown className="ml-1 h-3 w-3" />
              </Button>
            </div>

            <div className="space-y-2">
              {currentBills.map((bill) => (
                <div key={bill.id} className={`${gridCols} gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors text-sm sm:text-base`}>
                  <div className="break-words min-w-0">
                    <Button
                      variant="link"
                      className="p-0 text-left font-medium text-primary underline"
                      onClick={() => fetchBillItems(bill.id)}
                    >
                      #{bill.id}
                    </Button>
                  </div>
                  {isCentral && (
                    <div className="break-words min-w-0">
                      <Badge variant="outline" className="w-fit">{bill.franchise_id}</Badge>
                    </div>
                  )}
                  <div className="break-words min-w-0">
                    <Badge variant={getPaymentBadgeVariant(bill.mode_payment)}>{bill.mode_payment?.toUpperCase()}</Badge>
                  </div>
                  <div className="font-bold break-words min-w-0">₹{Number(bill.total).toFixed(2)}</div>
                  <div className="text-sm text-muted-foreground sm:col-span-2 break-words min-w-0">
                    {new Date(bill.created_at).toLocaleDateString()}<br />
                    <span className="text-xs">{new Date(bill.created_at).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4">
                <div className="text-sm text-muted-foreground">
                  Showing {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, filteredBills.length)} of {filteredBills.length}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setCurrentPage(currentPage - 1)} disabled={currentPage === 1}>
                    <ChevronLeft className="h-4 w-4" /> Previous
                  </Button>
                  <span className="text-sm">Page {currentPage} of {totalPages}</span>
                  <Button variant="outline" size="sm" onClick={() => setCurrentPage(currentPage + 1)} disabled={currentPage === totalPages}>
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {selectedBillId !== null && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-lg max-w-lg w-full shadow-lg relative">
              <h2 className="text-xl font-bold mb-2">Items for Bill #{selectedBillId}</h2>
              <Button
                className="absolute top-2 right-2"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelectedBillId(null);
                  setBillItems([]);
                }}
              >
                Close
              </Button>

              {itemLoading ? (
                <p>Loading items...</p>
              ) : billItems.length === 0 ? (
                <p className="text-muted-foreground">No items found for this bill.</p>
              ) : (
                <>
                  <ul className="space-y-2 mt-4 max-h-64 overflow-y-auto">
                    {billItems.map((item, index) => (
                      <li key={index} className="border p-2 rounded">
                        <div className="font-medium">{item.item_name}</div>
                        <div className="text-sm text-muted-foreground">
                          Quantity: {item.qty} | Rate: ₹{item.price} | Total: ₹{(item.qty * item.price).toFixed(2)}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 border-t pt-2 font-semibold text-right">
                    Total Bill Amount: ₹{billItems.reduce((acc, item) => acc + Number(item.qty) * Number(item.price), 0).toFixed(2)}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
