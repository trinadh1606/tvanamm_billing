import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

interface PrinterDevice {
  device: BluetoothDevice;
  server?: BluetoothRemoteGATTServer;
  service?: BluetoothRemoteGATTService;
  characteristic?: BluetoothRemoteGATTCharacteristic;
}

export function useBluetoothPrinter() {
  const [connectedPrinter, setConnectedPrinter] = useState<PrinterDevice | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const { toast } = useToast();

  const connectPrinter = useCallback(async () => {
    if (!navigator.bluetooth) {
      toast({
        title: "Bluetooth Not Supported",
        description: "Your browser doesn't support Web Bluetooth API",
        variant: "destructive",
      });
      return;
    }

    setIsConnecting(true);
    try {
      // Request EPOS printer device
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'TM-' },
          { namePrefix: 'EPSON' },
          { services: ['000018f0-0000-1000-8000-00805f9b34fb'] }
        ],
        optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb']
      });

      device.addEventListener('gattserverdisconnected', () => {
        console.log('Printer disconnected');
        setConnectedPrinter(null);
        toast({
          title: "Printer Disconnected",
          description: "Bluetooth printer connection lost",
          variant: "destructive",
        });
      });

      const server = await device.gatt?.connect();
      if (!server) throw new Error('Failed to connect to GATT server');

      const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
      const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');

      setConnectedPrinter({
        device,
        server,
        service,
        characteristic
      });

      toast({
        title: "Printer Connected",
        description: `Connected to ${device.name}`,
      });
    } catch (error) {
      console.error('Failed to connect printer:', error);
      toast({
        title: "Connection Failed",
        description: "Failed to connect to printer",
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  }, [toast]);

  const disconnectPrinter = useCallback(async () => {
    if (connectedPrinter?.server) {
      connectedPrinter.server.disconnect();
      setConnectedPrinter(null);
      toast({
        title: "Printer Disconnected",
        description: "Bluetooth printer disconnected",
      });
    }
  }, [connectedPrinter, toast]);

  const formatReceipt = (billData: any) => {
    const { items, total, paymentMode, billNumber, date } = billData;
    
    // Debug log to check data
    console.log('Receipt Data:', { items, total, paymentMode });
    items.forEach((item: any, index: number) => {
      console.log(`Item ${index}:`, { 
        name: item.name, 
        price: item.price, 
        quantity: item.quantity,
        priceType: typeof item.price,
        quantityType: typeof item.quantity
      });
    });
    
    // ESC/POS commands for EPOS printers
    const ESC = '\x1B';
    const GS = '\x1D';
    const INIT = ESC + '@';
    const CENTER = ESC + 'a1';
    const LEFT = ESC + 'a0';
    const BOLD_ON = ESC + 'E1';
    const BOLD_OFF = ESC + 'E0';
    
    // Proper EPOS termination commands
    const PAPER_CUT = GS + 'V' + '\x00';  // Full cut command for EPOS
    const BUFFER_CLEAR = '\x10' + '\x04' + '\x01';  // Clear buffer
    const NEWLINE = '\n';
    
    // Helper function to pad text for alignment
    const padText = (text: string, width: number, align: 'left' | 'right' = 'left') => {
      if (text.length >= width) return text.substring(0, width);
      const padding = ' '.repeat(width - text.length);
      return align === 'left' ? text + padding : padding + text;
    };
    
    // Enhanced amount formatting with debugging
    const formatAmount = (price: any, quantity: any) => {
      // Force conversion to numbers and handle edge cases
      const numPrice = parseFloat(String(price)) || 0;
      const numQty = parseInt(String(quantity)) || 0;
      const total = numPrice * numQty;
      console.log(`Format Amount Debug - Price: ${price} (${typeof price}) -> ${numPrice}, Qty: ${quantity} (${typeof quantity}) -> ${numQty}, Total: ${total}`);
      return total.toFixed(2);
    };
    
    let receipt = INIT;
    receipt += CENTER + BOLD_ON + 'T VANAMM' + BOLD_OFF + NEWLINE;
    receipt += LEFT + `Date: ${new Date(date).toLocaleString()}` + NEWLINE;
    receipt += LEFT + `Payment: ${paymentMode.toUpperCase()}` + NEWLINE;
    receipt += LEFT + '--------------------------------' + NEWLINE;
    receipt += LEFT + BOLD_ON + 'ITEM                QTY   AMOUNT' + BOLD_OFF + NEWLINE;
    receipt += LEFT + '--------------------------------' + NEWLINE;
    
    items.forEach((item: any) => {
      const itemTotal = formatAmount(item.price, item.quantity);
      const itemName = padText(item.name, 16);
      const qty = padText(String(item.quantity), 3, 'right');
      const amount = padText(`Rs${itemTotal}`, 7, 'right');
      
      console.log(`Receipt Line: "${itemName} ${qty}  ${amount}"`);
      receipt += LEFT + `${itemName} ${qty}  ${amount}` + NEWLINE;
    });
    
    const totalFormatted = (parseFloat(String(total)) || 0).toFixed(2);
    console.log(`Total formatted: ${totalFormatted} from ${total} (${typeof total})`);
    
    receipt += LEFT + '--------------------------------' + NEWLINE;
    receipt += LEFT + BOLD_ON + `TOTAL:              Rs${totalFormatted}` + BOLD_OFF + NEWLINE;
    receipt += LEFT + '--------------------------------' + NEWLINE;
    receipt += CENTER + 'Thank you for your visit!' + NEWLINE;
    receipt += NEWLINE; // One line feed only
    receipt += PAPER_CUT; // Full cut command
    receipt += BUFFER_CLEAR; // Clear printer buffer to stop rolling
    
    console.log('Final receipt string length:', receipt.length);
    return receipt;
  };

  const printReceipt = useCallback(async (billData: any) => {
    if (!connectedPrinter?.characteristic) {
      toast({
        title: "No Printer Connected",
        description: "Please connect a Bluetooth printer first",
        variant: "destructive",
      });
      return false;
    }

    setIsPrinting(true);
    try {
      const receiptText = formatReceipt(billData);
      const encoder = new TextEncoder();
      const data = encoder.encode(receiptText);
      
      // Send data in chunks to improve stability
      const chunkSize = 20;
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        await connectedPrinter.characteristic.writeValue(chunk);
        // Small delay between chunks for stability
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Wait a moment before confirming success
      await new Promise(resolve => setTimeout(resolve, 500));
      
      toast({
        title: "Receipt Printed",
        description: "Receipt sent to printer successfully",
      });
      return true;
    } catch (error) {
      console.error('Print error:', error);
      toast({
        title: "Print Failed",
        description: "Failed to print receipt",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsPrinting(false);
    }
  }, [connectedPrinter, toast]);

  return {
    connectedPrinter: connectedPrinter?.device || null,
    isConnecting,
    isPrinting,
    connectPrinter,
    disconnectPrinter,
    printReceipt,
    isConnected: !!connectedPrinter?.characteristic
  };
}