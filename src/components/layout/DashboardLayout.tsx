import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header - White with Green Text */}
      <header className="border-b shadow-sm bg-white text-[rgb(0,100,55)]">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">{title}</h1>
            {description && (
              <p className="text-sm opacity-80">{description}</p>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            <Card className="px-4 py-2 border text-[rgb(0,100,55)] bg-white">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-[rgb(0,100,55)]" />
                <div className="text-sm">
                  <div className="font-medium">{getRoleDisplay()}</div>
                  <div className="text-gray-500">{franchiseId}</div>
                </div>
              </div>
            </Card>
            
            <Button
              size="sm"
              variant="destructive"
              onClick={signOut}
            >
              <LogOut className="h-20 w-20 mr-3" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}