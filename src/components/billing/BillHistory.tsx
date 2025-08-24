import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Calendar, Download, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';

interface Bill {
  id: number;
  franchise_id: string;
  mode_payment: string | null;
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
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
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
    fetchBills(); // initial load
    if (isCentral) fetchFranchiseList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [franchiseId, role]);

  useEffect(() => {
    applyFiltersAndSort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, selectedFranchise, fromDate, toDate, sortField, sortDirection]);

  const toInputValue = (d?: Date) =>
    d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '';

  const startOfDayISO = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.toISOString();
  };
  const endOfDayISO = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x.toISOString();
  };

  const fetchFranchiseList = async () => {
    try {
      const { data, error } = await supabase
        .from('bills_generated_billing')
        .select('franchise_id')
        .order('franchise_id');

      if (error) throw error;

      const unique = Array.from(new Set(data?.map((item) => item.franchise_id))).filter(Boolean) as string[];
      setFranchiseList(unique);
    } catch (error) {
      console.error('Error fetching franchise list:', error);
    }
  };

  // accept optional targetFranchise and optional date range to fetch from DB
  const fetchBills = async (targetFranchise?: string, from?: Date, to?: Date) => {
    setLoading(true);
    try {
      let query = supabase.from('bills_generated_billing').select('*');

      // franchise filter
      if (isCentral) {
        if (targetFranchise && targetFranchise !== 'ALL') {
          query = query.eq('franchise_id', targetFranchise);
        }
      } else if (franchiseId) {
        query = query.eq('franchise_id', franchiseId);
      }

      // date range filter (server-side) if both provided
      if (from && to) {
        query = query
          .gte('created_at', startOfDayISO(from))
          .lte('created_at', endOfDayISO(to));
      }

      const { data, error } = await query.order('created_at', { ascending: false }).limit(1000);
      if (error) throw error;
      setBills((data as Bill[]) || []);
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
      filtered = filtered.filter((bill) => new Date(bill.created_at) >= new Date(fromDate.setHours(0, 0, 0, 0)));
    }

    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter((bill) => new Date(bill.created_at) <= end);
    }

    filtered.sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

      if (sortField === 'mode_payment') {
        aVal = (aVal ?? '').toLowerCase();
        bVal = (bVal ?? '').toLowerCase();
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

  // EXPORT ONLY THE SELECTED FRANCHISE (when central)
  const exportToExcel = () => {
    if (isCentral && selectedFranchise === 'ALL') {
      toast({
        title: 'Select a franchise',
        description: 'Please choose a franchise from the dropdown to export its bills only.',
        variant: 'destructive',
      });
      return;
    }

    const exportSource =
      isCentral && selectedFranchise !== 'ALL'
        ? filteredBills.filter((b) => b.franchise_id === selectedFranchise)
        : filteredBills;

    if (exportSource.length === 0) {
      toast({
        title: 'Nothing to export',
        description: 'No bills match your current filters.',
      });
      return;
    }

    const exportData = exportSource.map((bill) => ({
      'Bill ID': bill.id,
      'Franchise ID': bill.franchise_id,
      'Payment Mode': (bill.mode_payment ?? '').toUpperCase(),
      'Total Amount (₹)': Number(bill.total).toFixed(2),
      'Created Date': new Date(bill.created_at).toLocaleDateString(),
      'Created Time': new Date(bill.created_at).toLocaleTimeString(),
      'Created By': bill.created_by,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Bills History');

    let filename = 'bills-history';
    if (isCentral && selectedFranchise !== 'ALL') filename += `-${selectedFranchise}`;
    if (!isCentral && franchiseId) filename += `-${franchiseId}`;
    if (fromDate && toDate) {
      filename += `-${format(fromDate, 'yyyy-MM-dd')}_to_${format(toDate, 'yyyy-MM-dd')}`;
    }
    filename += `.xlsx`;

    XLSX.writeFile(workbook, filename);

    toast({
      title: 'Export Successful',
      description: `${exportSource.length} bills exported to Excel`,
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

  const getPaymentBadgeVariant = (mode: string | null) => {
    switch ((mode ?? '').toLowerCase()) {
      case 'cash': return 'default';
      case 'card': return 'secondary';
      case 'upi': return 'outline';
      default: return 'outline';
    }
  };

  const gridCols = isCentral ? 'grid grid-cols-1 sm:grid-cols-6' : 'grid grid-cols-1 sm:grid-cols-5';

  return (
    <Card className="bg-white">
      <CardHeader className="border-b">
        {/* Heading + Date Range on the right */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" style={{ color: 'rgb(0, 100, 55)' }} />
            <span style={{ color: 'rgb(0, 100, 55)' }}>Bill History</span>
            {isCentral && (
              <Badge
                variant="outline"
                style={{ backgroundColor: 'rgba(0, 100, 55, 0.1)', borderColor: 'rgb(0, 100, 55)' }}
              >
                All Franchises
              </Badge>
            )}
          </CardTitle>

          {/* Date pickers beside the heading */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col">
              <label className="text-xs text-gray-600 mb-1">From</label>
              <input
                type="date"
                value={toInputValue(fromDate)}
                onChange={(e) => setFromDate(e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined)}
                className="px-3 py-2 rounded-md border text-sm"
                style={{ borderColor: 'rgba(0, 100, 55, 0.3)', color: 'rgb(0, 100, 55)' }}
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-gray-600 mb-1">To</label>
              <input
                type="date"
                value={toInputValue(toDate)}
                onChange={(e) => setToDate(e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined)}
                className="px-3 py-2 rounded-md border text-sm"
                style={{ borderColor: 'rgba(0, 100, 55, 0.3)', color: 'rgb(0, 100, 55)' }}
              />
            </div>

            {/* Server-side fetch for this range (central mode) */}
            {isCentral && (
              <Button
                onClick={() => fetchBills(selectedFranchise, fromDate, toDate)}
                className="ml-1"
                style={{ backgroundColor: 'rgb(0, 100, 55)' }}
                disabled={loading}
              >
                Get Bills
              </Button>
            )}

            {/* Quick clear */}
            {(fromDate || toDate) && (
              <Button
                variant="outline"
                onClick={() => {
                  setFromDate(undefined);
                  setToDate(undefined);
                }}
                className="ml-1"
                style={{ borderColor: 'rgb(0, 100, 55)', color: 'rgb(0, 100, 55)' }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="bg-white">
        {/* FILTER BAR: Franchise selector + Get Bills */}
        {isCentral && (
          <div className="mt-6 sm:mt-8 flex flex-wrap items-center gap-3 mb-4">
            <label className="text-sm font-medium" style={{ color: 'rgb(0, 100, 55)' }}>
              Franchise
            </label>
            <select
              value={selectedFranchise}
              onChange={(e) => setSelectedFranchise(e.target.value)}
              className="px-3 py-2 rounded-md border text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: 'rgba(0, 100, 55, 0.3)', color: 'rgb(0, 100, 55)' }}
            >
              <option value="ALL">ALL</option>
              {franchiseList.map((fid) => (
                <option key={fid} value={fid}>
                  {fid}
                </option>
              ))}
            </select>

            <Button
              onClick={() => fetchBills(selectedFranchise, fromDate, toDate)}
              disabled={loading}
              className="ml-1"
              style={{ backgroundColor: 'rgb(0, 100, 55)' }}
            >
              Get Bills
            </Button>
          </div>
        )}

        {loading ? (
          <div className="text-center py-8">Loading bills...</div>
        ) : filteredBills.length === 0 ? (
          <div className="text-center py-8 text-gray-600">No bills found</div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto w-full">
              <div className={`${gridCols} gap-4 p-4 bg-gray-50 rounded-lg font-medium min-w-[600px]`}>
                <Button
                  variant="ghost"
                  onClick={() => handleSort('id')}
                  className="justify-start h-auto p-0"
                  style={{ color: 'rgb(0, 100, 55)' }}
                >
                  Bill ID <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
                {isCentral && (
                  <Button
                    variant="ghost"
                    onClick={() => handleSort('franchise_id')}
                    className="justify-start h-auto p-0"
                    style={{ color: 'rgb(0, 100, 55)' }}
                  >
                    Franchise <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => handleSort('mode_payment')}
                  className="justify-start h-auto p-0"
                  style={{ color: 'rgb(0, 100, 55)' }}
                >
                  Payment Mode <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => handleSort('total')}
                  className="justify-start h-auto p-0"
                  style={{ color: 'rgb(0, 100, 55)' }}
                >
                  Amount <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => handleSort('created_at')}
                  className="justify-start h-auto p-0 sm:col-span-2"
                  style={{ color: 'rgb(0, 100, 55)' }}
                >
                  Date <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto w-full">
              <div className="space-y-2 min-w-[600px]">
                {currentBills.map((bill) => (
                  <div
                    key={bill.id}
                    className={`${gridCols} gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors text-sm sm:text-base`}
                  >
                    <div className="break-words min-w-0">
                      <Button
                        variant="link"
                        className="p-0 text-left font-medium underline"
                        style={{ color: 'rgb(0, 100, 55)' }}
                        onClick={() => fetchBillItems(bill.id)}
                      >
                        #{bill.id}
                      </Button>
                    </div>
                    {isCentral && (
                      <div className="break-words min-w-0">
                        <Badge
                          variant="outline"
                          className="w-fit"
                          style={{ backgroundColor: 'rgba(0, 100, 55, 0.1)', borderColor: 'rgb(0, 100, 55)' }}
                        >
                          {bill.franchise_id}
                        </Badge>
                      </div>
                    )}
                    <div className="break-words min-w-0">
                      <Badge
                        variant={getPaymentBadgeVariant(bill.mode_payment)}
                        style={{
                          backgroundColor: (bill.mode_payment ?? '').toLowerCase() === 'cash' ? 'rgb(0, 100, 55)' : undefined,
                          color: (bill.mode_payment ?? '').toLowerCase() === 'cash' ? 'white' : 'rgb(0, 100, 55)',
                        }}
                      >
                        {(bill.mode_payment ?? '').toUpperCase()}
                      </Badge>
                    </div>
                    <div className="font-bold break-words min-w-0" style={{ color: 'rgb(0, 100, 55)' }}>
                      ₹{Number(bill.total).toFixed(2)}
                    </div>
                    <div className="text-sm text-gray-600 sm:col-span-2 break-words min-w-0">
                      {new Date(bill.created_at).toLocaleDateString()}
                      <br />
                      <span className="text-xs">{new Date(bill.created_at).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4">
                <div className="text-sm text-gray-600">
                  Showing {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, filteredBills.length)} of {filteredBills.length}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    style={{ borderColor: 'rgb(0, 100, 55)', color: 'rgb(0, 100, 55)' }}
                  >
                    <ChevronLeft className="h-4 w-4" /> Previous
                  </Button>
                  <span className="text-sm" style={{ color: 'rgb(0, 100, 55)' }}>
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    style={{ borderColor: 'rgb(0, 100, 55)', color: 'rgb(0, 100, 55)' }}
                  >
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-4">
              <Button onClick={exportToExcel} style={{ backgroundColor: 'rgb(0, 100, 55)' }}>
                <Download className="h-4 w-4 mr-2" /> Export to Excel
              </Button>
            </div>
          </div>
        )}

        {selectedBillId !== null && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-lg max-w-lg w-full shadow-lg relative">
              <h2 className="text-xl font-bold mb-2" style={{ color: 'rgb(0, 100, 55)' }}>
                Items for Bill #{selectedBillId}
              </h2>
              <Button
                className="absolute top-2 right-2"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelectedBillId(null);
                  setBillItems([]);
                }}
                style={{ color: 'rgb(0, 100, 55)' }}
              >
                Close
              </Button>

              {itemLoading ? (
                <p>Loading items...</p>
              ) : billItems.length === 0 ? (
                <p className="text-gray-600">No items found for this bill.</p>
              ) : (
                <>
                  <ul className="space-y-2 mt-4 max-h-64 overflow-y-auto">
                    {billItems.map((item, index) => (
                      <li key={index} className="border p-2 rounded">
                        <div className="font-medium" style={{ color: 'rgb(0, 100, 55)' }}>
                          {item.item_name}
                        </div>
                        <div className="text-sm text-gray-600">
                          Quantity: {item.qty} | Rate: ₹{item.price} | Total: ₹{(item.qty * item.price).toFixed(2)}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 border-t pt-2 font-semibold text-right" style={{ color: 'rgb(0, 100, 55)' }}>
                    Total Bill Amount: ₹
                    {billItems
                      .reduce((acc, item) => acc + Number(item.qty) * Number(item.price), 0)
                      .toFixed(2)}
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
