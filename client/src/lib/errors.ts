/**
 * Safely extract an error message from any value.
 * Handles Error objects, strings, objects with error/message fields, and undefined/null.
 * 
 * @param e - The error value (can be anything)
 * @param fallback - Default message if no error message can be extracted
 * @returns A safe, non-empty error message string
 */
export function getErrorMessage(e: unknown, fallback = 'Unknown error'): string {
  // Handle null/undefined
  if (e == null) {
    return fallback;
  }
  
  // Handle Error instances
  if (e instanceof Error) {
    return e.message || fallback;
  }
  
  // Handle strings
  if (typeof e === 'string') {
    return e || fallback;
  }
  
  // Handle objects with error/message fields
  if (typeof e === 'object') {
    const obj = e as any;
    
    // Try multiple common error field names
    const errorMsg = obj.error || obj.message || obj.detail || obj.errorMessage;
    
    if (typeof errorMsg === 'string' && errorMsg) {
      return errorMsg;
    }
    
    // Handle arrays (rare but possible)
    if (Array.isArray(e) && e.length > 0) {
      return getErrorMessage(e[0], fallback);
    }
  }
  
  // Last resort: stringify it
  try {
    const str = String(e);
    return str !== '[object Object]' ? str : fallback;
  } catch {
    return fallback;
  }
}
