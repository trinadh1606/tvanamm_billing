import { useAuth } from '@/hooks/useAuth';
import { SignIn } from '@/components/auth/SignIn';
import { StoreDashboard } from '@/components/store/StoreDashboard';
import { AdminDashboard } from '@/components/admin/AdminDashboard';
import { CentralDashboard } from '@/components/central/CentralDashboard';

const Index = () => {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-subtle">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <SignIn />;
  }

  switch (role) {
    case 'store':
      return <StoreDashboard />;
    case 'admin':
      return <AdminDashboard />;
    case 'central':
      return <CentralDashboard />;
    default:
      return <SignIn />;
  }
};

export default Index;
