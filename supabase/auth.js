// NEW FOLDER/SUPABASE/auth.js
import { supabase } from './supabaseClient';  // Correct path to supabaseClient.js

// Function to update the password
export const updatePassword = async (newPassword) => {
  try {
    const user = supabase.auth.user();  // Get the current logged-in user

    if (!user) {
      throw new Error("No user is logged in");
    }

    // Call Supabase to update the user's password
    const { error } = await supabase.auth.updateUser({
      password: newPassword,  // Set the new password
    });

    if (error) {
      throw new Error(error.message);
    }

    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
};
