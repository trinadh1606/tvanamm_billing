import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, AlertTriangle, ExternalLink, Printer, Bluetooth, Globe } from "lucide-react";

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

interface WindowsCompatibilityGuideProps {
  compatibility: SystemCompatibility;
  onClose?: () => void;
}

export function WindowsCompatibilityGuide({ compatibility, onClose }: WindowsCompatibilityGuideProps) {
  const getStatusIcon = (condition: boolean) => {
    return condition ? (
      <CheckCircle2 className="h-5 w-5 text-green-500" />
    ) : (
      <XCircle className="h-5 w-5 text-red-500" />
    );
  };

  const getStatusBadge = (condition: boolean, label: string) => {
    return (
      <Badge variant={condition ? "default" : "destructive"} className="ml-2">
        {condition ? "✓" : "✗"} {label}
      </Badge>
    );
  };

  const isFullyCompatible = compatibility.hasWebBluetooth && 
                           compatibility.isHttps && 
                           compatibility.browserInfo.isSupported;

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bluetooth className="h-5 w-5" />
          Windows Bluetooth Compatibility
        </CardTitle>
        <CardDescription>
          System compatibility check for Bluetooth printing
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* System Overview */}
        <Alert variant={isFullyCompatible ? "default" : "destructive"}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {isFullyCompatible ? "System Compatible" : "Compatibility Issues Detected"}
          </AlertTitle>
          <AlertDescription>
            {isFullyCompatible 
              ? "Your system supports Bluetooth printing. You can connect EPOS printers directly."
              : "Some requirements are not met. Please follow the recommendations below."
            }
          </AlertDescription>
        </Alert>

        {/* System Information */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <h4 className="font-semibold flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Browser & Connection
            </h4>
            
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span>Web Bluetooth Support</span>
                {getStatusIcon(compatibility.hasWebBluetooth)}
              </div>
              
              <div className="flex items-center justify-between">
                <span>HTTPS Connection</span>
                {getStatusIcon(compatibility.isHttps)}
              </div>
              
              <div className="flex items-center justify-between">
                <span>Browser Compatible</span>
                {getStatusIcon(compatibility.browserInfo.isSupported)}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-semibold">System Details</h4>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Operating System:</span>
                <br />
                {compatibility.isWindows ? compatibility.windowsVersion || "Windows" : "Not Windows"}
                {getStatusBadge(compatibility.isWindows, "Windows")}
              </div>
              
              <div>
                <span className="text-muted-foreground">Browser:</span>
                <br />
                {compatibility.browserInfo.name} {compatibility.browserInfo.version}
                {getStatusBadge(compatibility.browserInfo.isSupported, "Supported")}
              </div>
            </div>
          </div>
        </div>

        {/* Recommendations */}
        {compatibility.recommendations.length > 0 && (
          <div className="space-y-3">
            <h4 className="font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Setup Requirements
            </h4>
            <div className="space-y-2">
              {compatibility.recommendations.map((rec, index) => (
                <div key={index} className="flex items-start gap-2 text-sm">
                  <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0" />
                  <span>{rec}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Windows-Specific Instructions */}
        {compatibility.isWindows && (
          <div className="space-y-3">
            <h4 className="font-semibold">Windows Setup Steps</h4>
            <div className="space-y-3">
              <div className="rounded-lg border p-3 space-y-2">
                <div className="font-medium">1. Enable Bluetooth</div>
                <div className="text-sm text-muted-foreground">
                  Go to Settings → Devices → Bluetooth & other devices
                  <br />
                  Make sure Bluetooth is turned ON
                </div>
              </div>

              <div className="rounded-lg border p-3 space-y-2">
                <div className="font-medium">2. Install EPOS Drivers</div>
                <div className="text-sm text-muted-foreground">
                  Download and install official EPOS printer drivers from Epson
                </div>
                <Button size="sm" variant="outline" asChild>
                  <a 
                    href="https://download.epson-biz.com/modules/pos/index.php?page=soft" 
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Download Drivers
                  </a>
                </Button>
              </div>

              <div className="rounded-lg border p-3 space-y-2">
                <div className="font-medium">3. Browser Settings</div>
                <div className="text-sm text-muted-foreground">
                  Allow Bluetooth access when prompted by Chrome/Edge
                  <br />
                  Ensure you're using HTTPS (secure connection)
                </div>
              </div>

              <div className="rounded-lg border p-3 space-y-2">
                <div className="font-medium">4. Pair Your Printer</div>
                <div className="text-sm text-muted-foreground">
                  Put your EPOS printer in pairing mode
                  <br />
                  Add it via Windows Bluetooth settings first
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Alternative Options */}
        <div className="space-y-3">
          <h4 className="font-semibold flex items-center gap-2">
            <Printer className="h-4 w-4" />
            Alternative Printing Options
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Button variant="outline" size="sm">
              Print to System Printer
            </Button>
            <Button variant="outline" size="sm">
              Copy Receipt Text
            </Button>
            <Button variant="outline" size="sm">
              Generate PDF
            </Button>
            <Button variant="outline" size="sm">
              Email Receipt
            </Button>
          </div>
        </div>

        {onClose && (
          <div className="flex justify-end pt-4">
            <Button onClick={onClose} variant="outline">
              Close Guide
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}