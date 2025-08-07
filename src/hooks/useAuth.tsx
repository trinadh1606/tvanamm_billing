import { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type UserRole = 'store' | 'admin' | 'central';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: UserRole | null;
  franchiseId: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [franchiseId, setFranchiseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const detectRoleFromEmail = (email: string): { role: UserRole; franchiseId: string } => {
    console.log('Detecting role from email:', email);
    
    if (email.startsWith('store.')) {
      const franchise = email.split('.')[1].split('@')[0].toUpperCase(); // Convert to uppercase to match database
      console.log('Detected store account with franchise ID:', franchise);
      return { role: 'store', franchiseId: franchise };
    }
    
    if (email.toLowerCase().includes('+fr-central')) {
      console.log('Detected FR-CENTRAL account');
      return { role: 'central', franchiseId: 'FR-CENTRAL' }; // Use uppercase to match database
    }
    
    if (email.includes('+')) {
      const franchise = email.split('+')[1].split('@')[0].toUpperCase(); // Convert to uppercase to match database
      console.log('Detected admin account with franchise ID:', franchise);
      return { role: 'admin', franchiseId: franchise };
    }
    
    console.log('Could not detect role from email, defaulting to store');
    return { role: 'store', franchiseId: 'unknown' };
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('Auth state change:', event, session);
        
        // Handle session expiry or invalid refresh token
        if (event === 'TOKEN_REFRESHED' && !session) {
          console.log('Token refresh failed, clearing session');
          setSession(null);
          setUser(null);
          setRole(null);
          setFranchiseId(null);
          setLoading(false);
          return;
        }
        
        if (event === 'SIGNED_OUT' || !session) {
          console.log('User signed out or no session');
          setSession(null);
          setUser(null);
          setRole(null);
          setFranchiseId(null);
          setLoading(false);
          return;
        }
        
        // Valid session
        setSession(session);
        setUser(session.user);
        
        if (session.user?.email) {
          const { role: userRole, franchiseId: userFranchiseId } = detectRoleFromEmail(session.user.email);
          setRole(userRole);
          setFranchiseId(userFranchiseId);
        } else {
          setRole(null);
          setFranchiseId(null);
        }
        setLoading(false);
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.error('Session error:', error);
        // Clear any invalid session
        setSession(null);
        setUser(null);
        setRole(null);
        setFranchiseId(null);
        setLoading(false);
        return;
      }
      
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user?.email) {
        const { role: userRole, franchiseId: userFranchiseId } = detectRoleFromEmail(session.user.email);
        setRole(userRole);
        setFranchiseId(userFranchiseId);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error && error.message !== 'Session not found') {
        console.error('Sign out error:', error);
      }
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      // Always clear local state regardless of server response
      setSession(null);
      setUser(null);
      setRole(null);
      setFranchiseId(null);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      role,
      franchiseId,
      loading,
      signIn,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}