import React, { createContext, useContext, ReactNode } from 'react';

interface FRCentralContextType {
  franchiseId: string;
}

const FRCentralContext = createContext<FRCentralContextType>({
  franchiseId: 'FR-CENTRAL'
});

interface FRCentralAnalyticsProviderProps {
  children: ReactNode;
}

export function FRCentralAnalyticsProvider({ children }: FRCentralAnalyticsProviderProps) {
  return (
    <FRCentralContext.Provider value={{ franchiseId: 'FR-CENTRAL' }}>
      {children}
    </FRCentralContext.Provider>
  );
}

export function useFRCentralAuth() {
  const context = useContext(FRCentralContext);
  return context;
}

// Override useAuth hook for FR-CENTRAL components
export function useAuth() {
  return {
    franchiseId: 'FR-CENTRAL',
    user: null,
    role: 'central',
    loading: false
  };
}