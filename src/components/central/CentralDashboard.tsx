import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { FRCentralDashboard } from './FRCentralDashboard';
import { MenuManager } from '@/components/menu/MenuManager';
import { BillHistory } from '@/components/billing/BillHistory';
import logo from '@/assets/logo.png';
import { WeeklyPerformanceChart } from '@/components/analytics/WeeklyPerformanceChart';

import {
  Tabs, TabsContent, TabsList, TabsTrigger
} from '@/components/ui/tabs';
import {
  Card, CardHeader, CardTitle, CardDescription,
  CardContent, CardFooter
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Key, UserPlus, Clock, Users } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';

// ---------------- helpers ----------------
function normalizeFranchiseIdFlexible(input: string) {
  let raw = String(input || '').trim();
  raw = raw.replace(/^\s*FR[-_\s]?/i, ''); // remove leading FR- (case-insensitive)
  const alnum = raw.replace(/[^A-Za-z0-9]/g, '');
  if (!alnum) return null;

  const isDigitsOnly = /^[0-9]+$/.test(alnum);
  const core = isDigitsOnly ? alnum.padStart(3, '0') : alnum.toUpperCase();

  const formatted = `FR-${core}`; // how it's stored in profiles.franchise_id
  const alias = isDigitsOnly ? `fr-${alnum.padStart(3, '0')}` : `fr-${alnum.toLowerCase()}`;

  return { formatted, alias, isDigitsOnly, raw: alnum };
}

// Simple phone validator: allows +, spaces, hyphens; requires 7–15 digits total
function isValidPhone(p: string) {
  const digits = (p || '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

// Frontend store email domain (optional, for registration).
// Keep in sync with server STORE_EMAIL_DOMAIN; server also falls back to wildcard.
const STORE_EMAIL_DOMAIN: string =
  (import.meta as any)?.env?.VITE_STORE_EMAIL_DOMAIN || 'yourdomain.com';

// ---- Tabs routing helpers ----
const ALL_TABS = ['overview', 'weekly', 'menu', 'bills', 'stock', 'settings'] as const;
type TabKey = typeof ALL_TABS[number];
function coerceTab(tabParam: string | null): TabKey {
  const t = (tabParam || '').toLowerCase();
  return (ALL_TABS as readonly string[]).includes(t) ? (t as TabKey) : 'overview';
}

// ---------------- component ----------------
export function CentralDashboard() {
  const [isRegisterDialogOpen, setIsRegisterDialogOpen] = useState(false);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);

  // Success dialog state
  const [isSuccessDialogOpen, setIsSuccessDialogOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const [registerForm, setRegisterForm] = useState({
    name: '',
    email: '',
    franchiseId: '',
    password: '',
    phone: '',
    address: ''
  });
  const [franchiseId, setFranchiseId] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const { toast } = useToast();
  const navigate = useNavigate();

  // ---- tab state <-> URL sync ----
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>(coerceTab(searchParams.get('tab')));

  // Keep tab state in sync if URL changes (e.g., browser back/forward)
  useEffect(() => {
    const urlTab = coerceTab(searchParams.get('tab'));
    if (urlTab !== activeTab) setActiveTab(urlTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleTabChange = (val: string) => {
    const next = coerceTab(val);
    setActiveTab(next);
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: false });
  };

  // -------------------
  // REGISTER NEW USER (stay on same page, show popup)
  // -------------------
  const handleRegister = async () => {
    if (
      !registerForm.name ||
      !registerForm.email ||
      !registerForm.franchiseId ||
      !registerForm.password ||
      !registerForm.phone ||
      !registerForm.address
    ) {
      toast({ title: "Error", description: "Please fill all fields", variant: "destructive" });
      return;
    }

    if (registerForm.password.length < 8) {
      toast({ title: "Error", description: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }

    if (!isValidPhone(registerForm.phone)) {
      toast({ title: "Error", description: "Please enter a valid phone number (7–15 digits)", variant: "destructive" });
      return;
    }

    const norm = normalizeFranchiseIdFlexible(registerForm.franchiseId);
    if (!norm) {
      toast({ title: "Error", description: "Franchise ID must contain letters or digits", variant: "destructive" });
      return;
    }
    const { formatted, alias } = norm;

    try {
      // 1) Snapshot the current (central admin) session
      const { data: { session: centralSession } } = await supabase.auth.getSession();
      if (!centralSession?.access_token || !centralSession?.refresh_token) {
        toast({ title: "Error", description: "Please sign in as central admin.", variant: "destructive" });
        return;
      }

      // 2) Derive emails
      const storeEmail = `store.${alias}@${STORE_EMAIL_DOMAIN}`;
      const emailParts = registerForm.email.split('@');
      if (emailParts.length !== 2 || !emailParts[0] || !emailParts[1]) {
        toast({ title: "Error", description: "Please enter a valid email for the main user", variant: "destructive" });
        return;
      }
      const userEmailWithAlias = `${emailParts[0]}+${alias}@${emailParts[1]}`;

      // 3) Create STORE account (this may switch the session internally)
      const { data: storeData, error: storeError } = await supabase.auth.signUp({
        email: storeEmail,
        password: registerForm.password,
      });
      if (storeError || !storeData.user) {
        toast({ title: "Error", description: `Store account error: ${storeError?.message || "Unknown"}`, variant: "destructive" });
        // try restore admin session if it changed
        await supabase.auth.setSession({
          access_token: centralSession.access_token,
          refresh_token: centralSession.refresh_token,
        });
        return;
      }

      // 4) Create MAIN user (likely switches the client session again)
      const { data: userData, error: userError } = await supabase.auth.signUp({
        email: userEmailWithAlias,
        password: registerForm.password,
      });
      if (userError || !userData.user) {
        // NOTE: Cannot delete the store user from client; requires service role on backend.
        toast({ title: "Error", description: userError?.message || "Failed to register user", variant: "destructive" });
        // restore admin session
        await supabase.auth.setSession({
          access_token: centralSession.access_token,
          refresh_token: centralSession.refresh_token,
        });
        return;
      }
      const mainUserId = userData.user.id;

      // 5) Insert profile for the main user (stores FR-<...>) with phone & address
      const { error: insertError } = await supabase.from('profiles').insert([{
        id: mainUserId,
        name: registerForm.name,
        email: registerForm.email, // original email (no +alias)
        franchise_id: formatted,
        phone: registerForm.phone,
        address: registerForm.address
      }]);
      if (insertError) {
        toast({ title: "Error", description: insertError.message, variant: "destructive" });
        // restore admin session
        await supabase.auth.setSession({
          access_token: centralSession.access_token,
          refresh_token: centralSession.refresh_token,
        });
        return;
      }

      // 6) Restore the central admin session to prevent any redirects/guards
      await supabase.auth.setSession({
        access_token: centralSession.access_token,
        refresh_token: centralSession.refresh_token,
      });

      // 7) Close the form and show success popup (no navigation)
      setIsRegisterDialogOpen(false);
      setRegisterForm({ name: "", email: "", franchiseId: "", password: "", phone: "", address: "" });
      setSuccessMessage(`User and store accounts created successfully for ${formatted}.`);
      setIsSuccessDialogOpen(true);

    } catch (error) {
      console.error("Registration error:", error);
      toast({ title: "Error", description: "Failed to register user", variant: "destructive" });
    }
  };

  // -------------------
  // PASSWORD CHANGE (calls your Express API with JWT)
  // -------------------
  const handlePasswordChange = async () => {
    if (!franchiseId || !newPassword) {
      toast({
        title: "Error",
        description: "Please provide Franchise ID and New Password",
        variant: "destructive"
      });
      return;
    }

    if (newPassword.length < 8) {
      toast({
        title: "Error",
        description: "Password must be at least 8 characters",
        variant: "destructive"
      });
      return;
    }

    const norm = normalizeFranchiseIdFlexible(franchiseId);
    if (!norm) {
      toast({ title: "Error", description: "Franchise ID must contain letters or digits", variant: "destructive" });
      return;
    }
    const normalizedFrId = norm.formatted;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast({
          title: "Error",
          description: "Please sign in as central admin.",
          variant: "destructive",
        });
        return;
      }

      const response = await fetch('/api/admin/update-passwords', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          franchiseId: normalizedFrId,
          newPassword: newPassword
        })
      });

      const ct = response.headers.get('content-type') || '';
      const isJson = ct.includes('application/json');
      const payload = isJson ? await response.json() : await response.text();

      if (!response.ok) {
        const message =
          (typeof payload === 'object' && (payload?.error || payload?.message)) ||
          (typeof payload === 'string' && payload) ||
          `HTTP ${response.status}`;
        throw new Error(message);
      }

      toast({
        title: "Success",
        description: (typeof payload === 'object' && payload?.message) || `Passwords updated for ${normalizedFrId}`
      });
      setIsPasswordDialogOpen(false);
      setFranchiseId('');
      setNewPassword('');

    } catch (error: any) {
      console.error('Password change error:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to change passwords",
        variant: "destructive"
      });
    }
  };

  const themeColor = 'rgb(0, 100, 55)';
  const themeColorLight = 'rgba(0, 100, 55, 0.1)';

  const titleWithLogo = (
    <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 text-center sm:text-left">
      <img src={logo} alt="Logo" className="w-20 h-20" />
      <span className="text-xl font-bold">CENTRAL DASHBOARD</span>
    </div>
  );

  return (
    <DashboardLayout title={titleWithLogo}>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full px-2 sm:px-4 py-4">
        {/* Tabs */}
        <TabsList
          className="grid grid-cols-2 sm:grid-cols-6 w-full gap-1.5 items-stretch h-auto min-h[40px] sm:min-h-[44px]"
          style={{ backgroundColor: themeColorLight }}
        >
          {[
            { value: 'overview', label: 'Overview' },
            { value: 'weekly', label: 'Analysis' },
            { value: 'menu', label: 'Master Menu' },
            { value: 'bills', label: 'All Bills' },
            { value: 'stock', label: 'Stock Management' },
            { value: 'settings', label: 'Settings' },
          ].map(({ value, label }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="w-full h-10 sm:h-11 justify-center rounded-md text-sm sm:text-base data-[state=active]:bg-white data-[state=active]:text-[rgb(0,100,55)] py-2 px-1 flex items-center transition-all duration-200 hover:bg-white/50"
            >
              <span className="text-center whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4"><FRCentralDashboard /></TabsContent>
        <TabsContent value="weekly" className="mt-4"><WeeklyPerformanceChart isCentral userFranchiseId={''} /></TabsContent>
        <TabsContent value="menu" className="mt-4"><MenuManager isCentral /></TabsContent>
        <TabsContent value="bills" className="mt-4"><BillHistory showAdvanced isCentral /></TabsContent>

        {/* Stock Management tab content (coming soon placeholder) */}
        <TabsContent value="stock" className="mt-4">
          <Card className="border-[rgb(0,100,55)] p-6">
            <CardHeader className="flex items-center gap-3">
              <Clock className="w-6 h-6" style={{ color: themeColor }} />
              <div>
                <CardTitle style={{ color: themeColor }}>Stock Management</CardTitle>
                <CardDescription>Coming soon</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                We’re building a streamlined stock/inventory module with purchase tracking,
                low-stock alerts, and reports. Stay tuned!
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SETTINGS – includes PROFILES section (Registered Users) */}
        <TabsContent value="settings" className="mt-4 space-y-4">
          {[
            {
              icon: UserPlus,
              title: "Register",
              description: "Create a new user account",
              content: "Register new franchise managers or system administrators.",
              buttonLabel: "Register User",
              onClick: () => setIsRegisterDialogOpen(true)
            },
            {
              icon: Key,
              title: "Change Password",
              description: "Update your account password",
              content: "Ensure your account is secure by regularly updating your password.",
              buttonLabel: "Change Password",
              onClick: () => setIsPasswordDialogOpen(true)
            },
            // ---- Profiles section (Registered Users) ----
            {
              icon: Users,
              title: "Profiles",
              description: "Browse and edit all franchise profiles",
              content: "Open a full page with search, inline edit, delete, and CSV export.",
              buttonLabel: "Open Profiles",
              onClick: () => navigate('/registered-users')
            },
            {
              icon: Download,
              title: "Download Manual",
              description: "Get the complete system documentation",
              content: "Download the latest version of the system manual for reference.",
              buttonLabel: "Download PDF",
              variant: "outline" as const,
              onClick: () => { /* wire your manual download here */ },
            }
          ].map(({ icon: Icon, title, description, content, buttonLabel, onClick, variant = "default" as const }, i) => (
            <Card key={i} className="border-[rgb(0,100,55)] p-4 sm:p-6">
              <CardHeader className="flex flex-row items-center space-x-4">
                <Icon className="w-8 h-8" style={{ color: themeColor }} />
                <div>
                  <CardTitle style={{ color: themeColor }}>{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </div>
              </CardHeader>
              <CardContent><p className="text-sm text-muted-foreground">{content}</p></CardContent>
              <CardFooter>
                <Button
                  variant={variant}
                  style={variant === "outline" ? { borderColor: themeColor, color: themeColor } : { backgroundColor: themeColor }}
                  className="hover:bg-[rgb(0,80,40)] w-full sm:w-auto"
                  onClick={onClick}
                >
                  {buttonLabel}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {/* Register Dialog */}
      <Dialog open={isRegisterDialogOpen} onOpenChange={setIsRegisterDialogOpen}>
        <DialogContent className="w-full sm:max-w-md" style={{ borderColor: themeColor }}>
          <DialogHeader>
            <DialogTitle style={{ color: themeColor }}>Register New User</DialogTitle>
            <DialogDescription>Fill in the details to create a new user account.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {/* Name */}
            <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
              <Label htmlFor="name" className="text-right sm:col-span-1">Name</Label>
              <Input
                id="name"
                type="text"
                value={registerForm.name}
                onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                placeholder="Manager full name"
                className="sm:col-span-3"
                style={{ borderColor: themeColorLight }}
              />
            </div>

            {/* Email */}
            <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
              <Label htmlFor="email" className="text-right sm:col-span-1">Email</Label>
              <Input
                id="email"
                type="email"
                value={registerForm.email}
                onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
                placeholder="main.user@example.com"
                className="sm:col-span-3"
                style={{ borderColor: themeColorLight }}
              />
            </div>

            {/* Franchise ID */}
            <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
              <Label htmlFor="franchiseId" className="text-right sm:col-span-1">Franchise ID</Label>
              <Input
                id="franchiseId"
                type="text"
                value={registerForm.franchiseId}
                onChange={(e) => setRegisterForm({ ...registerForm, franchiseId: e.target.value })}
                placeholder="e.g., 003, 4545, AB12, FR-xyz"
                className="sm:col-span-3"
                style={{ borderColor: themeColorLight }}
              />
            </div>

            {/* Phone */}
            <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
              <Label htmlFor="phone" className="text-right sm:col-span-1">Phone</Label>
              <Input
                id="phone"
                type="tel"
                value={registerForm.phone}
                onChange={(e) => setRegisterForm({ ...registerForm, phone: e.target.value })}
                placeholder="+91 98765 43210"
                className="sm:col-span-3"
                style={{ borderColor: themeColorLight }}
              />
            </div>

            {/* Address */}
            <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
              <Label htmlFor="address" className="text-right sm:col-span-1">Address</Label>
              <Input
                id="address"
                type="text"
                value={registerForm.address}
                onChange={(e) => setRegisterForm({ ...registerForm, address: e.target.value })}
                placeholder="Building, Street, City, PIN"
                className="sm:col-span-3"
                style={{ borderColor: themeColorLight }}
              />
            </div>

            {/* Password */}
            <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
              <Label htmlFor="password" className="text-right sm:col-span-1">Password</Label>
              <Input
                id="password"
                type="password"
                value={registerForm.password}
                onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                placeholder="Min 8 characters"
                className="sm:col-span-3"
                style={{ borderColor: themeColorLight }}
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setIsRegisterDialogOpen(false)}
              style={{ borderColor: themeColor, color: themeColor }}
              className="hover:bg-[rgba(0,100,55,0.1)] w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRegister}
              style={{ backgroundColor: themeColor }}
              className="hover:bg-[rgb(0,80,40)] w-full sm:w-auto"
            >
              Register
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
        <DialogContent className="w-full sm:max-w-md" style={{ borderColor: themeColor }}>
          <DialogHeader>
            <DialogTitle style={{ color: themeColor }}>Change Password</DialogTitle>
            <DialogDescription>Enter franchise ID and new password</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
              <Label htmlFor="franchiseId" className="text-right sm:col-span-1">Franchise ID</Label>
              <Input
                id="franchiseId"
                type="text"
                value={franchiseId}
                onChange={(e) => setFranchiseId(e.target.value)}
                placeholder="e.g., 003, 4545, AB12, FR-xyz"
                className="sm:col-span-3"
                style={{ borderColor: themeColorLight }}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
              <Label htmlFor="newPassword" className="text-right sm:col-span-1">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                className="sm:col-span-3"
                style={{ borderColor: themeColorLight }}
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setIsPasswordDialogOpen(false)}
              style={{ borderColor: themeColor, color: themeColor }}
              className="hover:bg-[rgba(0,100,55,0.1)] w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handlePasswordChange}
              style={{ backgroundColor: themeColor }}
              className="hover:bg-[rgb(0,80,40)] w-full sm:w-auto"
            >
              Save Password
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Success Dialog (no redirect; appears after successful registration) */}
      <Dialog open={isSuccessDialogOpen} onOpenChange={setIsSuccessDialogOpen}>
        <DialogContent className="w-full sm:max-w-md" style={{ borderColor: themeColor }}>
          <DialogHeader>
            <DialogTitle style={{ color: themeColor }}>User Registered</DialogTitle>
            <DialogDescription>
              {successMessage || "The user was created successfully."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button
              onClick={() => setIsSuccessDialogOpen(false)}
              style={{ backgroundColor: themeColor }}
              className="hover:bg-[rgb(0,80,40)]"
            >
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

