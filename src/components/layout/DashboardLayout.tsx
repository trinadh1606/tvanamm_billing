import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { LogOut, User } from 'lucide-react';

interface DashboardLayoutProps {
  children: ReactNode;
  title: string;
  description?: string;
}

export function DashboardLayout({ children, title, description }: DashboardLayoutProps) {
  const { user, role, franchiseId, signOut } = useAuth();

  const getRoleDisplay = () => {
    switch (role) {
      case 'store': return 'Store User';
      case 'admin': return 'Franchise Admin';
      case 'central': return 'Central Admin';
      default: return 'User';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-subtle">
      <header className="bg-card shadow-soft border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
            {description && (
              <p className="text-muted-foreground text-sm">{description}</p>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            <Card className="px-4 py-2">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <div className="text-sm">
                  <div className="font-medium">{getRoleDisplay()}</div>
                  <div className="text-muted-foreground">{franchiseId}</div>
                </div>
              </div>
            </Card>
            
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}