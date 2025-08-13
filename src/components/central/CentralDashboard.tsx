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
import { Download, Key, UserPlus, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';

export function CentralDashboard() {
  const [isRegisterDialogOpen, setIsRegisterDialogOpen] = useState(false);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    name: '',
    email: '',
    franchiseId: '',
    password: ''
  });
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [franchiseId, setFranchiseId] = useState('');
  const [showPassword, setShowPassword] = useState({
    oldPassword: false,
    newPassword: false,
    confirmPassword: false
  });
  const { toast } = useToast();

  const handleRegister = async () => {
    if (!registerForm.name || !registerForm.email || !registerForm.franchiseId || !registerForm.password) {
      toast({ title: "Error", description: "Please fill all fields", variant: "destructive" });
      return;
    }

    if (registerForm.password.length < 8) {
      toast({ title: "Error", description: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }

    try {
      // 1. Normalize and format Franchise ID
      const numericPart = registerForm.franchiseId.replace(/[^0-9]/g, ''); // Extract digits only
      const formattedFranchiseId = `FR-${numericPart.padStart(3, '0')}`; // Always like FR-001
      const aliasFranchiseId = `fr-${numericPart.padStart(3, '0')}`; // for alias in email

      // 2. Generate emails
      const storeEmail = `store.${aliasFranchiseId}@yourdomain.com`;
      const emailParts = registerForm.email.split('@');
      const userEmailWithAlias = `${emailParts[0]}+${aliasFranchiseId}@${emailParts[1]}`;

      // 3. Create store account in Supabase Auth
      const { data: storeData, error: storeError } = await supabase.auth.signUp({
        email: storeEmail,
        password: registerForm.password,
      });
      if (storeError || !storeData.user) {
        toast({
          title: "Error",
          description: `Store account error: ${storeError?.message || "Unknown error"}`,
          variant: "destructive",
        });
        return;
      }

      const storeUserId = storeData.user.id;

      // 4. Create main user account in Supabase Auth
      const { data: userData, error: userError } = await supabase.auth.signUp({
        email: userEmailWithAlias,
        password: registerForm.password,
      });
      if (userError || !userData.user) {
        // Rollback store account
        await supabase.auth.admin.deleteUser(storeUserId);
        toast({
          title: "Error",
          description: userError?.message || "Failed to register user",
          variant: "destructive",
        });
        return;
      }

      const mainUserId = userData.user.id;

      // 5. Insert profile record with ORIGINAL email
      const { error: insertError } = await supabase.from('profiles').insert([{
        id: mainUserId,
        name: registerForm.name,
        email: registerForm.email, // Original email, not alias
        franchise_id: formattedFranchiseId, // Always FR-001 format
      }]);

      if (insertError) {
        // Rollback both accounts if profile insert fails
        await supabase.auth.admin.deleteUser(storeUserId);
        await supabase.auth.admin.deleteUser(mainUserId);
        toast({ title: "Error", description: insertError.message, variant: "destructive" });
        return;
      }

      // ✅ Success
      toast({ title: "Success", description: `User and store accounts created for ${formattedFranchiseId}` });

      // Reset form & close dialog
      setIsRegisterDialogOpen(false);
      setRegisterForm({ name: "", email: "", franchiseId: "", password: "" });
    } catch (error) {
      console.error("Unexpected Error during registration:", error);
      toast({ title: "Error", description: "Failed to register user", variant: "destructive" });
    }
  };

  const handlePasswordChange = async () => {
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "New passwords don't match", variant: "destructive" });
      return;
    }

    if (newPassword.length < 8) {
      toast({ title: "Error", description: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }

    try {
      const result = await supabase.auth.updateUser({ password: newPassword });
      if (result.error) {
        toast({ title: "Error", description: result.error.message, variant: "destructive" });
        return;
      }

      toast({ title: "Success", description: "Password changed successfully" });
      setIsPasswordDialogOpen(false);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setFranchiseId('');
    } catch (error) {
      toast({ title: "Error", description: "Failed to change password", variant: "destructive" });
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
      <Tabs defaultValue="overview" className="w-full px-2 sm:px-4 py-4">
        <TabsList className="flex flex-wrap sm:grid sm:grid-cols-5 gap-1 w-full" style={{ backgroundColor: themeColorLight }}>
          <TabsTrigger value="overview" className="data-[state=active]:bg-white data-[state=active]:text-[rgb(0,100,55)]">Overview</TabsTrigger>
          <TabsTrigger value="weekly" className="data-[state=active]:bg-white data-[state=active]:text-[rgb(0,100,55)]">Analysis</TabsTrigger>
          <TabsTrigger value="menu" className="data-[state=active]:bg-white data-[state=active]:text-[rgb(0,100,55)]">Master Menu</TabsTrigger>
          <TabsTrigger value="bills" className="data-[state=active]:bg-white data-[state=active]:text-[rgb(0,100,55)]">All Bills</TabsTrigger>
          <TabsTrigger value="settings" className="data-[state=active]:bg-white data-[state=active]:text-[rgb(0,100,55)]">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <FRCentralDashboard />
        </TabsContent>
        <TabsContent value="weekly">
          <WeeklyPerformanceChart isCentral userFranchiseId={''} />
        </TabsContent>
        <TabsContent value="menu">
          <MenuManager isCentral />
        </TabsContent>
        <TabsContent value="bills">
          <BillHistory showAdvanced isCentral />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          {[{
            icon: UserPlus,
            title: "Register",
            description: "Create a new user account",
            content: "Register new franchise managers or system administrators.",
            buttonLabel: "Register User",
            onClick: () => setIsRegisterDialogOpen(true)
          }, {
            icon: Key,
            title: "Change Password",
            description: "Update your account password",
            content: "Ensure your account is secure by regularly updating your password.",
            buttonLabel: "Change Password",
            onClick: () => setIsPasswordDialogOpen(true)
          }, {
            icon: Download,
            title: "Download Manual",
            description: "Get the complete system documentation",
            content: "Download the latest version of the system manual for reference.",
            buttonLabel: "Download PDF",
            variant: "outline",
            iconComponent: <Download className="mr-2 h-4 w-4" style={{ color: themeColor }} />
          }].map(({ icon: Icon, title, description, content, buttonLabel, onClick, variant = "default", iconComponent }, i) => (
            <Card key={i} className="border-[rgb(0,100,55)] p-4 sm:p-6">
              <CardHeader className="flex flex-row items-center space-x-4">
                <Icon className="w-8 h-8" style={{ color: themeColor }} />
                <div>
                  <CardTitle style={{ color: themeColor }}>{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{content}</p>
              </CardContent>
              <CardFooter>
                <Button
                  variant={variant}
                  style={variant === "outline" ? { borderColor: themeColor, color: themeColor } : { backgroundColor: themeColor }}
                  className="hover:bg-[rgb(0,80,40)] w-full sm:w-auto"
                  onClick={onClick}
                >
                  {iconComponent}{buttonLabel}
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
            {["name", "email", "franchiseId", "password"].map((field) => (
              <div key={field} className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                <Label htmlFor={field} className="text-right capitalize sm:col-span-1">{field === 'franchiseId' ? 'Franchise ID' : field}</Label>
                <Input
                  id={field}
                  type={field === 'password' || field === 'email' ? field : 'text'}
                  value={registerForm[field as keyof typeof registerForm]}
                  onChange={(e) => setRegisterForm({ ...registerForm, [field]: e.target.value })}
                  className="sm:col-span-3"
                  style={{ borderColor: themeColorLight }}
                />
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row justify-end gap-2">
            <Button variant="outline" onClick={() => setIsRegisterDialogOpen(false)} style={{ borderColor: themeColor, color: themeColor }} className="hover:bg-[rgba(0,100,55,0.1)] w-full sm:w-auto">Cancel</Button>
            <Button onClick={handleRegister} style={{ backgroundColor: themeColor }} className="hover:bg-[rgb(0,80,40)] w-full sm:w-auto">Register</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
        <DialogContent className="w-full sm:max-w-md" style={{ borderColor: themeColor }}>
          <DialogHeader>
            <DialogTitle style={{ color: themeColor }}>Change Password</DialogTitle>
            <DialogDescription>Enter your franchise ID and password details below.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {/* Franchise ID Field */}
            <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
              <Label htmlFor="franchiseId" className="text-right sm:col-span-1">Franchise ID</Label>
              <Input
                id="franchiseId"
                type="text"
                placeholder="Enter your franchise ID here"
                value={franchiseId}
                onChange={(e) => setFranchiseId(e.target.value)}
                className="sm:col-span-3"
                style={{ borderColor: themeColorLight }}
              />
            </div>
            
            {/* Password Fields */}
            {[
              { 
                id: 'oldPassword', 
                label: 'Current Password', 
                value: oldPassword, 
                set: setOldPassword,
                placeholder: 'Enter your current password here',
                show: showPassword.oldPassword,
                toggle: () => setShowPassword({...showPassword, oldPassword: !showPassword.oldPassword})
              },
              { 
                id: 'newPassword', 
                label: 'New Password', 
                value: newPassword, 
                set: setNewPassword,
                placeholder: 'Create your new password here (min 8 characters)',
                show: showPassword.newPassword,
                toggle: () => setShowPassword({...showPassword, newPassword: !showPassword.newPassword})
              },
              { 
                id: 'confirmPassword', 
                label: 'Confirm Password', 
                value: confirmPassword, 
                set: setConfirmPassword,
                placeholder: 'Re-enter your new password here',
                show: showPassword.confirmPassword,
                toggle: () => setShowPassword({...showPassword, confirmPassword: !showPassword.confirmPassword})
              }
            ].map(({ id, label, value, set, placeholder, show, toggle }) => (
              <div key={id} className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                <Label htmlFor={id} className="text-right sm:col-span-1">{label}</Label>
                <div className="relative sm:col-span-3">
                  <Input
                    id={id}
                    type={show ? 'text' : 'password'}
                    value={value}
                    placeholder={placeholder}
                    onChange={(e) => set(e.target.value)}
                    className="pr-10"
                    style={{ borderColor: themeColorLight }}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    onClick={toggle}
                  >
                    {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
            ))}
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
              Change Password
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}