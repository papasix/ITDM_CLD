// Application Constants
export const APP_CONFIG = {
  // Pagination
  DEFAULT_PAGE_SIZE: 10,
  MAX_API_LIMIT: 1000,
  
  // Timeouts
  DELETE_CONFIRMATION_DELAY: 100, // ms
  
  // UI Limits
  MAX_DESCRIPTION_LENGTH: 500,
  MAX_TITLE_LENGTH: 200,
  
  // File Upload
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_FILE_TYPES: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt'],
  
  // API
  DEFAULT_API_TIMEOUT: 30000, // 30 seconds
  
  // Retry Logic
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // ms
} as const;

// User Interface Constants
export const UI_CONFIG = {
  HEADER_HEIGHT: '64px',
  SIDEBAR_WIDTH: '256px',
  MOBILE_BREAKPOINT: 768, // px
} as const;

// Business Rules
export const BUSINESS_RULES = {
  MIN_APPROVAL_STAGES: 1,
  MAX_APPROVAL_STAGES: 10,
  DEFAULT_SLA_DAYS: 5,
} as const;