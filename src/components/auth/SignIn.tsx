import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import logo from '@/assets/logo.png';
import { Eye, EyeOff } from 'lucide-react';

export function SignIn() {
  const [storeData, setStoreData] = useState({ franchiseId: '', password: '' });
  const [adminData, setAdminData] = useState({ franchiseId: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showStorePassword, setShowStorePassword] = useState(false);
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const { signIn } = useAuth();
  const { toast } = useToast();

  const handleStoreLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    let normalizedId = storeData.franchiseId.toLowerCase().trim();
    if (!normalizedId.startsWith('fr-')) {
      normalizedId = `fr-${normalizedId}`;
    }
    
    const email = `store.${normalizedId}@yourdomain.com`;
    
    const { error } = await signIn(email, storeData.password);
    
    if (error) {
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
    
    let normalizedId = adminData.franchiseId.toLowerCase().trim();
    if (!normalizedId.startsWith('fr-')) {
      normalizedId = `fr-${normalizedId}`;
    }
    
    const [username, domain] = adminData.email.split('@');
    const email = `${username}+${normalizedId}@${domain}`;
    
    const { error } = await signIn(email, adminData.password);
    
    if (error) {
      toast({
        title: "Login Failed",
        description: error.message || "Invalid credentials. Please check your email, franchise ID and password.",
        variant: "destructive",
      });
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <Card className="w-full max-w-md shadow-sm border border-gray-200">
        <CardHeader className="text-center flex flex-col items-center gap-2">
          <img src={logo} alt="Logo" width={150} height={150} />
          <CardTitle className="text-2xl font-bold" style={{ color: 'rgb(0, 100, 55)' }}>
            T VANAMM
          </CardTitle>
          <CardDescription />
        </CardHeader>

        <CardContent>
          <Tabs defaultValue="store" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-white">
              <TabsTrigger 
                value="store" 
                className="data-[state=active]:bg-[rgb(0,100,55)] data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-[rgb(0,100,55)]"
              >
                Store Login
              </TabsTrigger>
              <TabsTrigger 
                value="admin" 
                className="data-[state=active]:bg-[rgb(0,100,55)] data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-[rgb(0,100,55)]"
              >
                Admin Login
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="store">
              <form onSubmit={handleStoreLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="store-franchise" className="text-gray-700">Franchise ID</Label>
                  <Input
                    id="store-franchise"
                    placeholder="Enter franchise ID"
                    value={storeData.franchiseId}
                    onChange={(e) => setStoreData({ ...storeData, franchiseId: e.target.value })}
                    required
                    className="border-gray-300 focus:border-[rgb(0,100,55)] focus:ring-[rgb(0,100,55)]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="store-password" className="text-gray-700">Password</Label>
                  <div className="relative">
                    <Input
                      id="store-password"
                      type={showStorePassword ? "text" : "password"}
                      placeholder="Enter password"
                      value={storeData.password}
                      onChange={(e) => setStoreData({ ...storeData, password: e.target.value })}
                      required
                      className="border-gray-300 focus:border-[rgb(0,100,55)] focus:ring-[rgb(0,100,55)] pr-10"
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                      onClick={() => setShowStorePassword(!showStorePassword)}
                    >
                      {showStorePassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
                <Button 
                  type="submit" 
                  className="w-full bg-[rgb(0,100,55)] hover:bg-[rgb(0,80,45)] text-white shadow-md hover:shadow-lg transition-shadow" 
                  disabled={loading}
                >
                  {loading ? 'Signing in...' : 'Sign In to Store'}
                </Button>
              </form>
            </TabsContent>
            
            <TabsContent value="admin">
              <form onSubmit={handleAdminLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="admin-franchise" className="text-gray-700">Franchise ID</Label>
                  <Input
                    id="admin-franchise"
                    placeholder="Enter franchise ID"
                    value={adminData.franchiseId}
                    onChange={(e) => setAdminData({ ...adminData, franchiseId: e.target.value })}
                    required
                    className="border-gray-300 focus:border-[rgb(0,100,55)] focus:ring-[rgb(0,100,55)]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-email" className="text-gray-700">Email</Label>
                  <Input
                    id="admin-email"
                    type="email"
                    placeholder="Enter your email"
                    value={adminData.email}
                    onChange={(e) => setAdminData({ ...adminData, email: e.target.value })}
                    required
                    className="border-gray-300 focus:border-[rgb(0,100,55)] focus:ring-[rgb(0,100,55)]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-password" className="text-gray-700">Password</Label>
                  <div className="relative">
                    <Input
                      id="admin-password"
                      type={showAdminPassword ? "text" : "password"}
                      placeholder="Enter password"
                      value={adminData.password}
                      onChange={(e) => setAdminData({ ...adminData, password: e.target.value })}
                      required
                      className="border-gray-300 focus:border-[rgb(0,100,55)] focus:ring-[rgb(0,100,55)] pr-10"
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                      onClick={() => setShowAdminPassword(!showAdminPassword)}
                    >
                      {showAdminPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
                <Button 
                  type="submit" 
                  className="w-full bg-[rgb(0,100,55)] hover:bg-[rgb(0,80,45)] text-white shadow-md hover:shadow-lg transition-shadow" 
                  disabled={loading}
                >
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