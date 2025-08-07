import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Calendar, Search, Download, CalendarIcon, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
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

type SortField = 'created_at' | 'total' | 'franchise_id' | 'id';
type SortDirection = 'asc' | 'desc';

export function BillHistory({ showAdvanced = false, isCentral = false }: BillHistoryProps) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [filteredBills, setFilteredBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchDate, setSearchDate] = useState('');
  const [searchAmount, setSearchAmount] = useState('');
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
    if (isCentral) {
      fetchFranchiseList();
    }
  }, [franchiseId, role]);

  useEffect(() => {
    applyFiltersAndSort();
  }, [bills, searchDate, searchAmount, selectedFranchise, fromDate, toDate, sortField, sortDirection]);

  const fetchFranchiseList = async () => {
    try {
      const { data, error } = await supabase
        .from('bills_generated_billing')
        .select('franchise_id')
        .order('franchise_id');

      if (error) throw error;
      
      const uniqueFranchises = Array.from(new Set(data?.map(item => item.franchise_id) || []));
      setFranchiseList(uniqueFranchises);
    } catch (error: any) {
      console.error('Error fetching franchise list:', error);
    }
  };

  const fetchBills = async () => {
    setLoading(true);
    
    try {
      let query = supabase.from('bills_generated_billing').select('*');
      
      if (!isCentral && franchiseId) {
        query = query.eq('franchise_id', franchiseId);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false }).limit(1000);
      
      if (error) throw error;
      setBills(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to fetch bills",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const applyFiltersAndSort = () => {
    let filtered = [...bills];
    
    // Apply filters
    if (searchDate) {
      filtered = filtered.filter(bill => 
        bill.created_at.includes(searchDate)
      );
    }
    
    if (searchAmount) {
      filtered = filtered.filter(bill => 
        bill.total.toString().includes(searchAmount)
      );
    }
    
    if (selectedFranchise && selectedFranchise !== 'ALL') {
      filtered = filtered.filter(bill => 
        bill.franchise_id === selectedFranchise
      );
    }
    
    if (fromDate) {
      const fromDateStr = fromDate.toISOString().split('T')[0];
      filtered = filtered.filter(bill => 
        bill.created_at >= fromDateStr
      );
    }
    
    if (toDate) {
      const toDateStr = toDate.toISOString().split('T')[0];
      filtered = filtered.filter(bill => 
        bill.created_at <= toDateStr + 'T23:59:59'
      );
    }
    
    // Apply sorting
    filtered.sort((a, b) => {
      let aValue: any = a[sortField];
      let bValue: any = b[sortField];
      
      if (sortField === 'total') {
        aValue = Number(aValue);
        bValue = Number(bValue);
      }
      
      if (sortField === 'created_at') {
        aValue = new Date(aValue).getTime();
        bValue = new Date(bValue).getTime();
      }
      
      if (sortDirection === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });
    
    setFilteredBills(filtered);
    setCurrentPage(1);
  };

  const exportToExcel = () => {
    const exportData = filteredBills.map(bill => ({
      'Bill ID': bill.id,
      'Franchise ID': bill.franchise_id,
      'Payment Mode': bill.mode_payment,
      'Total Amount (₹)': Number(bill.total).toFixed(2),
      'Created Date': new Date(bill.created_at).toLocaleDateString(),
      'Created Time': new Date(bill.created_at).toLocaleTimeString(),
      'Created By': bill.created_by
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Bills History');
    
    let filename = 'bills-history';
    if (selectedFranchise && selectedFranchise !== 'ALL') filename += `-${selectedFranchise}`;
    if (fromDate && toDate) {
      filename += `-${format(fromDate, 'yyyy-MM-dd')}-to-${format(toDate, 'yyyy-MM-dd')}`;
    }
    filename += `-${new Date().toISOString().split('T')[0]}.xlsx`;
    
    XLSX.writeFile(workbook, filename);
    
    toast({
      title: "Export Successful",
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
    setSearchDate('');
    setSearchAmount('');
    setSelectedFranchise('ALL');
    setFromDate(undefined);
    setToDate(undefined);
    setSortField('created_at');
    setSortDirection('desc');
  };

  // Pagination
  const totalPages = Math.ceil(filteredBills.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentBills = filteredBills.slice(startIndex, endIndex);

  const getPaymentBadgeVariant = (mode: string) => {
    switch (mode) {
      case 'cash': return 'default';
      case 'card': return 'secondary';
      case 'upi': return 'outline';
      default: return 'outline';
    }
  };

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
                    {franchiseList.map(franchise => (
                      <SelectItem key={franchise} value={franchise}>{franchise}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              
              <Input
                placeholder="Search by amount"
                value={searchAmount}
                onChange={(e) => setSearchAmount(e.target.value)}
              />
              
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("justify-start text-left font-normal", !fromDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {fromDate ? format(fromDate, "PPP") : "From Date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={fromDate}
                    onSelect={setFromDate}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("justify-start text-left font-normal", !toDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, "PPP") : "To Date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={toDate}
                    onSelect={setToDate}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
            
            <div className="flex gap-2">
              <Button onClick={exportToExcel} variant="outline">
                <Download className="h-4 w-4 mr-2" />
                Export Excel ({filteredBills.length} bills)
              </Button>
              <Button onClick={clearFilters} variant="outline">
                Clear Filters
              </Button>
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
            {/* Table Header with Sorting */}
            <div className="grid grid-cols-6 gap-4 p-4 bg-muted/50 rounded-lg font-medium">
              <Button 
                variant="ghost" 
                onClick={() => handleSort('id')}
                className="justify-start h-auto p-0 font-medium"
              >
                Bill ID <ArrowUpDown className="ml-1 h-3 w-3" />
              </Button>
              {isCentral && (
                <Button 
                  variant="ghost" 
                  onClick={() => handleSort('franchise_id')}
                  className="justify-start h-auto p-0 font-medium"
                >
                  Franchise <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              )}
              <span className={isCentral ? "" : "col-span-2"}>Payment Mode</span>
              <Button 
                variant="ghost" 
                onClick={() => handleSort('total')}
                className="justify-start h-auto p-0 font-medium"
              >
                Amount <ArrowUpDown className="ml-1 h-3 w-3" />
              </Button>
              <Button 
                variant="ghost" 
                onClick={() => handleSort('created_at')}
                className="justify-start h-auto p-0 font-medium"
              >
                Date <ArrowUpDown className="ml-1 h-3 w-3" />
              </Button>
            </div>
            
            {/* Table Rows */}
            <div className="space-y-2">
              {currentBills.map(bill => (
                <div key={bill.id} className="grid grid-cols-6 gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="font-medium">#{bill.id}</div>
                  {isCentral && (
                    <Badge variant="outline" className="w-fit">{bill.franchise_id}</Badge>
                  )}
                  <div className={isCentral ? "" : "col-span-2"}>
                    <Badge variant={getPaymentBadgeVariant(bill.mode_payment)}>
                      {bill.mode_payment?.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="font-bold">₹{Number(bill.total).toFixed(2)}</div>
                  <div className="text-sm text-muted-foreground">
                    {new Date(bill.created_at).toLocaleDateString()}<br />
                    <span className="text-xs">{new Date(bill.created_at).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4">
                <div className="text-sm text-muted-foreground">
                  Showing {startIndex + 1}-{Math.min(endIndex, filteredBills.length)} of {filteredBills.length} bills
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <span className="text-sm">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
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