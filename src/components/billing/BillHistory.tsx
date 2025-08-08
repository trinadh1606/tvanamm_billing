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
  Search,
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

// ... (imports remain unchanged)

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

  const clearFilters = () => {
    setSelectedFranchise('ALL');
    setFromDate(undefined);
    setToDate(undefined);
    setSortField('created_at');
    setSortDirection('desc');
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

  const gridCols = isCentral ? 'grid-cols-6' : 'grid-cols-5';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Bill History
          {isCentral && <Badge variant="outline">All Franchises</Badge>}
        </CardTitle>

        {showAdvanced && (
          <div className="space-y-4 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {isCentral && (
                <Select value={selectedFranchise} onValueChange={setSelectedFranchise}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select Franchise" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Franchises</SelectItem>
                    {franchiseList.map((franchise) => (
                      <SelectItem key={franchise} value={franchise}>
                        {franchise}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("justify-start text-left font-normal", !fromDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {fromDate ? format(fromDate, 'PPP') : 'From Date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <CalendarComponent mode="single" selected={fromDate} onSelect={setFromDate} />
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("justify-start text-left font-normal", !toDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, 'PPP') : 'To Date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <CalendarComponent mode="single" selected={toDate} onSelect={setToDate} />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex gap-2">
              <Button onClick={exportToExcel} variant="outline">
                <Download className="h-4 w-4 mr-2" />
                Export Excel ({filteredBills.length})
              </Button>
              <Button onClick={clearFilters} variant="outline">Clear Filters</Button>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="text-center py-8">Loading bills...</div>
        ) : filteredBills.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No bills found</div>
        ) : (
          <div className="space-y-4">
            <div className={`grid ${gridCols} gap-4 p-4 bg-muted/50 rounded-lg font-medium`}>
              <Button variant="ghost" onClick={() => handleSort('id')} className="justify-start h-auto p-0">
                Bill ID 
                <ArrowUpDown className="ml-1 h-3 w-3" />
              </Button>
              {isCentral && (
                <Button variant="ghost" onClick={() => handleSort('franchise_id')} className="justify-start h-auto p-0">
                  Franchise
                  <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              )}
              <Button variant="ghost" onClick={() => handleSort('mode_payment')} className="justify-start h-auto p-0">
                Payment Mode
                <ArrowUpDown className="ml-1 h-3 w-3" />
              </Button>
              <Button variant="ghost" onClick={() => handleSort('total')} className="justify-start h-auto p-0">
                Amount
                <ArrowUpDown className="ml-1 h-3 w-3" />
              </Button>
              <Button variant="ghost" onClick={() => handleSort('created_at')} className="justify-start h-auto p-0 col-span-2">
                Date
                <ArrowUpDown className="ml-1 h-3 w-3" />
              </Button>
            </div>

            <div className="space-y-2">
              {currentBills.map((bill) => (
                <div key={bill.id} className={`grid ${gridCols} gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors`}>
                  <div className="font-medium">#{bill.id}</div>
                  {isCentral && (
                    <Badge variant="outline" className="w-fit">{bill.franchise_id}</Badge>
                  )}
                  <div>
                    <Badge variant={getPaymentBadgeVariant(bill.mode_payment)}>{bill.mode_payment?.toUpperCase()}</Badge>
                  </div>
                  <div className="font-bold">₹{Number(bill.total).toFixed(2)}</div>
                  <div className="text-sm text-muted-foreground col-span-2">
                    {new Date(bill.created_at).toLocaleDateString()}
                    <br />
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
      </CardContent>
    </Card>
  );
}
