import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import logo from '@/assets/logo.png';

export function SignIn() {
  const [storeData, setStoreData] = useState({ franchiseId: '', password: '' });
  const [adminData, setAdminData] = useState({ franchiseId: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const { toast } = useToast();

  const handleStoreLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    // Normalize franchise ID input (ensure fr- prefix, convert to lowercase)
    let normalizedId = storeData.franchiseId.toLowerCase().trim();
    if (!normalizedId.startsWith('fr-')) {
      normalizedId = `fr-${normalizedId}`;
    }
    
    // Construct email with normalized franchise ID (keeping fr- prefix)
    const email = `store.${normalizedId}@yourdomain.com`;
    console.log('Store Login - Attempting login with email:', email);
    console.log('Store Login - Original input:', storeData.franchiseId);
    console.log('Store Login - Normalized ID:', normalizedId);
    
    const { error } = await signIn(email, storeData.password);
    
    if (error) {
      console.error('Store login error:', error);
      toast({
        title: "Login Failed", 
        description: error.message || "Invalid credentials. Please check your franchise ID and password.",
        variant: "destructive",
      });
    }
    setLoading(false);
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    // Normalize franchise ID input (ensure fr- prefix, convert to lowercase)
    let normalizedId = adminData.franchiseId.toLowerCase().trim();
    if (!normalizedId.startsWith('fr-')) {
      normalizedId = `fr-${normalizedId}`;
    }
    
    // Split email to get username and domain parts
    const [username, domain] = adminData.email.split('@');
    // Construct email with "fr-" prefix to match database format
    const email = `${username}+${normalizedId}@${domain}`;
    console.log('Admin Login - Attempting login with email:', email);
    console.log('Admin Login - Original franchise ID input:', adminData.franchiseId);
    console.log('Admin Login - Normalized ID:', normalizedId);
    
    const { error } = await signIn(email, adminData.password);
    
    if (error) {
      console.error('Admin login error:', error);
      toast({
        title: "Login Failed",
        description: error.message || "Invalid credentials. Please check your email, franchise ID and password.",
        variant: "destructive",
      });
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-subtle">
      <Card className="w-full max-w-md shadow-card">
<CardHeader className="text-center flex flex-col items-center gap-2">
  <img src={logo} alt="Logo" width={120} height={120} />
  <CardTitle className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
    T VANAMM
  </CardTitle>
  <CardDescription />
</CardHeader>

        <CardContent>
          <Tabs defaultValue="store" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="store">Store Login</TabsTrigger>
              <TabsTrigger value="admin">Admin Login</TabsTrigger>
            </TabsList>
            
            <TabsContent value="store">
              <form onSubmit={handleStoreLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="store-franchise">Franchise ID</Label>
                  <Input
                    id="store-franchise"
                    placeholder="Enter franchise ID"
                    value={storeData.franchiseId}
                    onChange={(e) => setStoreData({ ...storeData, franchiseId: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="store-password">Password</Label>
                  <Input
                    id="store-password"
                    type="password"
                    placeholder="Enter password"
                    value={storeData.password}
                    onChange={(e) => setStoreData({ ...storeData, password: e.target.value })}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign In to Store'}
                </Button>
              </form>
            </TabsContent>
            
            <TabsContent value="admin">
              <form onSubmit={handleAdminLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="admin-franchise">Franchise ID</Label>
                  <Input
                    id="admin-franchise"
                    placeholder="Enter franchise ID"
                    value={adminData.franchiseId}
                    onChange={(e) => setAdminData({ ...adminData, franchiseId: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-email">Email</Label>
                  <Input
                    id="admin-email"
                    type="email"
                    placeholder="Enter your email"
                    value={adminData.email}
                    onChange={(e) => setAdminData({ ...adminData, email: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-password">Password</Label>
                  <Input
                    id="admin-password"
                    type="password"
                    placeholder="Enter password"
                    value={adminData.password}
                    onChange={(e) => setAdminData({ ...adminData, password: e.target.value })}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign In to Admin'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}