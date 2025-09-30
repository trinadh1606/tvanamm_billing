import { useState, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

interface PrinterDevice {
  device: BluetoothDevice;
  server?: BluetoothRemoteGATTServer;
  service?: BluetoothRemoteGATTService;
  characteristic?: BluetoothRemoteGATTCharacteristic;
}

interface SystemCompatibility {
  hasWebBluetooth: boolean;
  isHttps: boolean;
  isWindows: boolean;
  windowsVersion?: string;
  browserInfo: {
    name: string;
    version: string;
    isSupported: boolean;
  };
  recommendations: string[];
}

interface PrintFallbackOptions {
  generatePDF: (billData: any) => void;
  copyToClipboard: (billData: any) => void;
  printToSystemPrinter: (billData: any) => void;
  emailReceipt: (billData: any) => void;
}

export function useBluetoothPrinter() {
  const [connectedPrinter, setConnectedPrinter] = useState<PrinterDevice | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [compatibility, setCompatibility] = useState<SystemCompatibility | null>(null);
  const { toast } = useToast();

  // System compatibility detection
  const detectSystemCompatibility = useCallback((): SystemCompatibility => {
    const hasWebBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    
    // Detect Windows
    const userAgent = navigator.userAgent || '';
    const isWindows = userAgent.includes('Windows');
    let windowsVersion = '';
    
    if (isWindows) {
      if (userAgent.includes('Windows NT 10.0')) {
        windowsVersion = userAgent.includes('22000') ? 'Windows 11' : 'Windows 10';
      } else if (userAgent.includes('Windows NT 6.3')) {
        windowsVersion = 'Windows 8.1';
      } else if (userAgent.includes('Windows NT 6.1')) {
        windowsVersion = 'Windows 7';
      }
    }

    // Browser detection
    let browserName = 'Unknown';
    let browserVersion = '';
    let isSupported = false;

    if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
      browserName = 'Chrome';
      const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
      browserVersion = chromeMatch ? chromeMatch[1] : '';
      isSupported = parseInt(browserVersion) >= 56;
    } else if (userAgent.includes('Edg')) {
      browserName = 'Microsoft Edge';
      const edgeMatch = userAgent.match(/Edg\/(\d+)/);
      browserVersion = edgeMatch ? edgeMatch[1] : '';
      isSupported = parseInt(browserVersion) >= 79;
    } else if (userAgent.includes('Firefox')) {
      browserName = 'Firefox';
      isSupported = false; // Firefox doesn't support Web Bluetooth
    } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
      browserName = 'Safari';
      isSupported = false; // Safari doesn't support Web Bluetooth
    }

    const recommendations: string[] = [];
    
    if (!isHttps) {
      recommendations.push('Switch to HTTPS (Web Bluetooth requires secure connection)');
    }
    if (!isSupported) {
      recommendations.push('Use Chrome 56+ or Microsoft Edge 79+ for Bluetooth support');
    }
    if (isWindows && windowsVersion && !windowsVersion.includes('10') && !windowsVersion.includes('11')) {
      recommendations.push('Upgrade to Windows 10 or 11 for better Bluetooth support');
    }
    if (isWindows) {
      recommendations.push('Ensure Bluetooth is enabled in Windows Settings');
      recommendations.push('Install EPOS printer drivers from manufacturer');
      recommendations.push('Allow Bluetooth access in browser settings');
    }

    return {
      hasWebBluetooth,
      isHttps,
      isWindows,
      windowsVersion,
      browserInfo: {
        name: browserName,
        version: browserVersion,
        isSupported
      },
      recommendations
    };
  }, []);

  // Initialize compatibility check
  useEffect(() => {
    const compat = detectSystemCompatibility();
    setCompatibility(compat);
    
    // Log compatibility info for debugging
    console.log('System Compatibility:', compat);
  }, [detectSystemCompatibility]);

  const connectPrinter = useCallback(async () => {
    // Enhanced compatibility check
    if (!compatibility) {
      toast({
        title: "System Check in Progress",
        description: "Please wait while we check system compatibility",
        variant: "destructive",
      });
      return;
    }

    // Comprehensive error handling with Windows-specific messages
    if (!compatibility.hasWebBluetooth) {
      const message = compatibility.isWindows 
        ? `Web Bluetooth not supported in ${compatibility.browserInfo.name}. Please use Chrome 56+ or Microsoft Edge 79+`
        : "Your browser doesn't support Web Bluetooth API";
      
      toast({
        title: "Bluetooth Not Supported",
        description: message,
        variant: "destructive",
      });
      return;
    }

    if (!compatibility.isHttps) {
      toast({
        title: "HTTPS Required",
        description: "Web Bluetooth requires HTTPS connection. Please access via https://",
        variant: "destructive",
      });
      return;
    }

    if (!compatibility.browserInfo.isSupported) {
      const message = compatibility.isWindows
        ? `${compatibility.browserInfo.name} ${compatibility.browserInfo.version} doesn't support Web Bluetooth. Please update to Chrome 56+ or Edge 79+`
        : "Please use a supported browser (Chrome or Edge)";
      
      toast({
        title: "Browser Not Supported",
        description: message,
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
      
      let errorMessage = "Failed to connect to printer";
      let troubleshootingTips = "";
      
      if (error instanceof Error) {
        if (error.message.includes('User cancelled')) {
          errorMessage = "Connection cancelled by user";
        } else if (error.message.includes('Bluetooth adapter not available')) {
          errorMessage = compatibility?.isWindows 
            ? "Bluetooth not available. Check Windows Bluetooth settings"
            : "Bluetooth adapter not available";
          troubleshootingTips = compatibility?.isWindows 
            ? "Go to Settings > Devices > Bluetooth & other devices and ensure Bluetooth is ON"
            : "";
        } else if (error.message.includes('GATT operation failed')) {
          errorMessage = "Printer connection failed";
          troubleshootingTips = compatibility?.isWindows
            ? "Try: 1) Install EPOS drivers 2) Restart browser 3) Reset Bluetooth"
            : "";
        }
      }
      
      toast({
        title: "Connection Failed",
        description: `${errorMessage}${troubleshootingTips ? `. ${troubleshootingTips}` : ''}`,
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  }, [toast, compatibility]);

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

  // ---------- ESC/POS helpers ----------
  const ESC = '\x1B';
  const GS  = '\x1D';
  const INIT = ESC + '@';
  const ALIGN_LEFT   = ESC + 'a' + '\x00';
  const ALIGN_CENTER = ESC + 'a' + '\x01';
  const ALIGN_RIGHT  = ESC + 'a' + '\x02';
  const BOLD_ON  = ESC + 'E' + '\x01';
  const BOLD_OFF = ESC + 'E' + '\x00';
  const PAPER_CUT = GS + 'V' + '\x00'; // Full cut (common variant)
  const NEWLINE = '\n';
  const COLS = 32; // typical 58mm printer character width

  // Helper function to pad text for alignment
  const padText = (text: string, width: number, align: 'left' | 'right' = 'left') => {
    const str = (text ?? '').toString();
    if (str.length >= width) return str.substring(0, width);
    const padding = ' '.repeat(width - str.length);
    return align === 'left' ? str + padding : padding + str;
  };

  // Enhanced amount formatting with debugging
  const formatAmount = (price: any, quantity: any) => {
    const numPrice = parseFloat(String(price)) || 0;
    const numQty = parseInt(String(quantity)) || 0;
    const total = numPrice * numQty;
    console.log(`Format Amount Debug - Price: ${price} (${typeof price}) -> ${numPrice}, Qty: ${quantity} (${typeof quantity}) -> ${numQty}, Total: ${total}`);
    return total.toFixed(2);
  };

  // ESC/POS receipt formatter (used for Bluetooth printing)
  const formatReceiptEscPos = (billData: any) => {
    const {
      items = [],
      total = 0,
      paymentMode = '',
      billNumber = '',
      date = Date.now()
    } = billData ?? {};

    // Debug log to check data
    console.log('Receipt Data:', { items, total, paymentMode, billNumber });
    (items || []).forEach((item: any, index: number) => {
      console.log(`Item ${index}:`, { 
        name: item?.name, 
        price: item?.price, 
        quantity: item?.quantity,
        priceType: typeof item?.price,
        quantityType: typeof item?.quantity
      });
    });

    let receipt = INIT;
    receipt += ALIGN_CENTER + BOLD_ON + 'T VANAMM' + BOLD_OFF + NEWLINE;
    receipt += ALIGN_LEFT + `Date: ${new Date(date).toLocaleString()}` + NEWLINE;
    receipt += ALIGN_LEFT + `Payment: ${paymentMode.toString().toUpperCase()}` + NEWLINE;
    receipt += ALIGN_LEFT + '-'.repeat(COLS) + NEWLINE;
    receipt += ALIGN_LEFT + BOLD_ON + 'ITEM                QTY   AMOUNT' + BOLD_OFF + NEWLINE;
    receipt += ALIGN_LEFT + '-'.repeat(COLS) + NEWLINE;

    items.forEach((item: any) => {
      const itemTotal = formatAmount(item?.price, item?.quantity);
      const itemName = padText(item?.name ?? '', 16);
      const qty = padText(String(item?.quantity ?? 0), 3, 'right');
      const amount = padText(`Rs${itemTotal}`, 7, 'right');
      console.log(`Receipt Line: "${itemName} ${qty}  ${amount}"`);
      receipt += ALIGN_LEFT + `${itemName} ${qty}  ${amount}` + NEWLINE;
    });

    const totalFormatted = (parseFloat(String(total)) || 0).toFixed(2);
    console.log(`Total formatted: ${totalFormatted} from ${total} (${typeof total})`);

    receipt += ALIGN_LEFT + '-'.repeat(COLS) + NEWLINE;
    receipt += ALIGN_LEFT + BOLD_ON + `TOTAL:              Rs${totalFormatted}` + BOLD_OFF + NEWLINE;
    receipt += ALIGN_LEFT + '-'.repeat(COLS) + NEWLINE;
    receipt += ALIGN_CENTER + 'Thank you for your visit!' + NEWLINE;
    receipt += NEWLINE; // One line feed only
    receipt += PAPER_CUT; // Full cut command
    // NOTE: removed DLE EOT 1 (status query) that was mislabeled as "clear buffer"

    console.log('Final ESC/POS receipt string length:', receipt.length);
    return receipt;
  };

  // Plain-text receipt formatter (used for PDF/system/email fallbacks)
  const formatReceiptPlain = (billData: any) => {
    const {
      items = [],
      total = 0,
      paymentMode = '',
      billNumber = '',
      date = Date.now()
    } = billData ?? {};

    const lines: string[] = [];
    lines.push('T VANAMM');
    lines.push(`Date: ${new Date(date).toLocaleString()}`);
    lines.push(`Payment: ${paymentMode.toString().toUpperCase()}`);
    lines.push('-'.repeat(COLS));
    lines.push('ITEM                QTY   AMOUNT');
    lines.push('-'.repeat(COLS));
    for (const it of items) {
      const name = padText(it?.name ?? '', 16);
      const qty  = padText(String(it?.quantity ?? 0), 3, 'right');
      const amt  = formatAmount(it?.price, it?.quantity);
      const amount = padText(`Rs${amt}`, 7, 'right');
      lines.push(`${name} ${qty}  ${amount}`);
    }
    const totalNum = (parseFloat(String(total)) || 0).toFixed(2);
    lines.push('-'.repeat(COLS));
    lines.push(`TOTAL:              Rs${totalNum}`);
    lines.push('-'.repeat(COLS));
    lines.push('Thank you for your visit!');
    return lines.join('\n');
  };

  // Fallback printing methods
  const fallbackOptions: PrintFallbackOptions = {
    generatePDF: (billData: any) => {
      const receiptText = formatReceiptPlain(billData);
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head><title>Receipt</title></head>
            <body style="font-family: monospace; white-space: pre-line; padding: 20px;">
              ${receiptText.replace(/\n/g, '<br>')}
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
      }
    },
    
    copyToClipboard: (billData: any) => {
      const receiptText = formatReceiptPlain(billData);
      navigator.clipboard.writeText(receiptText).then(() => {
        toast({
          title: "Receipt Copied",
          description: "Receipt text copied to clipboard",
        });
      }).catch(() => {
        toast({
          title: "Copy Failed",
          description: "Could not copy receipt to clipboard",
          variant: "destructive",
        });
      });
    },
    
    printToSystemPrinter: (billData: any) => {
      const receiptText = formatReceiptPlain(billData);
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Receipt</title>
              <style>
                body { font-family: 'Courier New', monospace; font-size: 12px; }
                @media print { body { margin: 0; } }
              </style>
            </head>
            <body>
              <pre>${receiptText}</pre>
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
        printWindow.close();
      }
    },
    
    emailReceipt: (billData: any) => {
      const receiptText = formatReceiptPlain(billData);
      const subject = `Receipt - Bill #${(billData?.billNumber ?? '').toString()}`;
      const body = encodeURIComponent(receiptText);
      window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${body}`);
    }
  };

  const printReceipt = useCallback(async (billData: any) => {
    if (!connectedPrinter?.characteristic) {
      // Offer fallback options when no Bluetooth printer
      const message = compatibility?.isWindows 
        ? "No Bluetooth printer connected. Use alternative printing methods below."
        : "Please connect a Bluetooth printer first";
        
      toast({
        title: "No Printer Connected",
        description: message,
        variant: "destructive",
      });
      return false;
    }

    setIsPrinting(true);
    try {
      const receiptText = formatReceiptEscPos(billData);
      const encoder = new TextEncoder();
      const data = encoder.encode(receiptText);

      // Prefer writeWithoutResponse when supported (TS-safe feature detection)
      type MaybeWriter = {
        properties?: { writeWithoutResponse?: boolean }; // some browsers expose this
        writeValueWithoutResponse?: (data: BufferSource) => Promise<void>;
        writeValue: (data: BufferSource) => Promise<void>;
      };
      const ch = connectedPrinter.characteristic as unknown as MaybeWriter;

      const canWriteWithoutResponse =
        !!ch.properties?.writeWithoutResponse ||
        typeof ch.writeValueWithoutResponse === 'function';

      const write = canWriteWithoutResponse && ch.writeValueWithoutResponse
        ? (chunk: BufferSource) => ch.writeValueWithoutResponse!(chunk)
        : (chunk: BufferSource) => ch.writeValue(chunk);
      
      // Send data in chunks to improve stability (BLE payload ~20 bytes)
      const chunkSize = 20;
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        await write(chunk);
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
    isConnected: !!connectedPrinter?.characteristic,
    compatibility,
    fallbackOptions
  };
}
