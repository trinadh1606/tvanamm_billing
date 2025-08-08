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
import { Download, Key, UserPlus } from 'lucide-react';
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
      const { data, error } = await supabase.auth.signUp({
        email: registerForm.email,
        password: registerForm.password,
      });

      const user = data?.user;
      if (error || !user) {
        toast({ title: "Error", description: error?.message || "Failed to register user", variant: "destructive" });
        return;
      }

      const formattedFranchiseId = `FR-${registerForm.franchiseId.replace(/^FR-/, '')}`;

      const { error: insertError } = await supabase.from('profiles').insert([{
        id: user.id,
        name: registerForm.name,
        email: registerForm.email,
        franchise_id: formattedFranchiseId,
      }]);

      if (insertError) {
        toast({ title: "Error", description: insertError.message, variant: "destructive" });
        return;
      }

      toast({ title: "Success", description: "New user created" });

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
            <DialogDescription>Enter your current password and set a new one.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {[{ id: 'oldPassword', label: 'Current Password', value: oldPassword, set: setOldPassword },
              { id: 'newPassword', label: 'New Password', value: newPassword, set: setNewPassword },
              { id: 'confirmPassword', label: 'Confirm Password', value: confirmPassword, set: setConfirmPassword }]
              .map(({ id, label, value, set }) => (
                <div key={id} className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                  <Label htmlFor={id} className="text-right sm:col-span-1">{label}</Label>
                  <Input
                    id={id}
                    type="password"
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    className="sm:col-span-3"
                    style={{ borderColor: themeColorLight }}
                  />
                </div>
              ))}
          </div>
          <div className="flex flex-col sm:flex-row justify-end gap-2">
            <Button variant="outline" onClick={() => setIsPasswordDialogOpen(false)} style={{ borderColor: themeColor, color: themeColor }} className="hover:bg-[rgba(0,100,55,0.1)] w-full sm:w-auto">Cancel</Button>
            <Button onClick={handlePasswordChange} style={{ backgroundColor: themeColor }} className="hover:bg-[rgb(0,80,40)] w-full sm:w-auto">Change Password</Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
