import { APP_CONFIG } from '../constants/app';

// Input sanitization to prevent XSS
export function sanitizeInput(input: string): string {
  if (!input || typeof input !== 'string') return '';
  
  return input
    .replace(/[<>\"'&]/g, (match) => {
      const escapeMap: Record<string, string> = {
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '&': '&amp;'
      };
      return escapeMap[match];
    })
    .trim()
    .substring(0, 1000); // Prevent excessively long input
}

// SQL injection prevention for identifiers
export function sanitizeIdentifier(input: string): string {
  if (!input || typeof input !== 'string') return '';
  
  // Only allow alphanumeric, hyphens, and underscores
  return input.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 50);
}

// Validate demand title
export function validateTitle(title: string): { valid: boolean; error?: string } {
  if (!title || title.trim().length === 0) {
    return { valid: false, error: 'Title is required' };
  }
  
  if (title.length > APP_CONFIG.MAX_TITLE_LENGTH) {
    return { valid: false, error: `Title must be less than ${APP_CONFIG.MAX_TITLE_LENGTH} characters` };
  }
  
  return { valid: true };
}

// Validate demand description
export function validateDescription(description: string): { valid: boolean; error?: string } {
  if (description && description.length > APP_CONFIG.MAX_DESCRIPTION_LENGTH) {
    return { valid: false, error: `Description must be less than ${APP_CONFIG.MAX_DESCRIPTION_LENGTH} characters` };
  }
  
  return { valid: true };
}

// Validate demand type
export function validateDemandType(type: string): { valid: boolean; error?: string } {
  const validTypes = ['Strategic', 'Operational', 'Support', 'Compliance', 'Innovation'];
  
  if (!type || !validTypes.includes(type)) {
    return { valid: false, error: 'Invalid demand type' };
  }
  
  return { valid: true };
}

// Validate priority
export function validatePriority(priority: string): { valid: boolean; error?: string } {
  const validPriorities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  
  if (!priority || !validPriorities.includes(priority)) {
    return { valid: false, error: 'Invalid priority level' };
  }
  
  return { valid: true };
}

// Validate email format
export function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email) return { valid: true }; // Optional field
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }
  
  return { valid: true };
}

// Comprehensive demand validation
export function validateDemand(demand: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  const titleValidation = validateTitle(demand.title);
  if (!titleValidation.valid) errors.push(titleValidation.error!);
  
  const descriptionValidation = validateDescription(demand.description);
  if (!descriptionValidation.valid) errors.push(descriptionValidation.error!);
  
  const typeValidation = validateDemandType(demand.type);
  if (!typeValidation.valid) errors.push(typeValidation.error!);
  
  const priorityValidation = validatePriority(demand.priority);
  if (!priorityValidation.valid) errors.push(priorityValidation.error!);
  
  return {
    valid: errors.length === 0,
    errors
  };
}