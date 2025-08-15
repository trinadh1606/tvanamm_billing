// project/src/types/supabase.ts
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string | null;
          email: string;
          franchise_id: string;
        };
        Insert: {
          id: string;
          name?: string | null;
          email: string;
          franchise_id: string;
        };
        Update: {
          id?: string;
          name?: string | null;
          email?: string;
          franchise_id?: string;
        };
      };
    };
  };
};