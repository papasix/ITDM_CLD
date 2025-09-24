import React from 'react';
import { useRBAC } from '../../rbac/context';
import { Permission } from '../../rbac/types';

interface RequirePermissionProps {
  permission: Permission | Permission[];
  mode?: 'any' | 'all'; // For multiple permissions
  children: React.ReactNode;
  fallback?: React.ReactNode;
  showFallback?: boolean;
}

export function RequirePermission({ 
  permission, 
  mode = 'any', 
  children, 
  fallback, 
  showFallback = false 
}: RequirePermissionProps) {
  const rbac = useRBAC();
  
  const hasAccess = Array.isArray(permission)
    ? mode === 'all' 
      ? rbac.hasAllPermissions(permission)
      : rbac.hasAnyPermission(permission)
    : rbac.hasPermission(permission);

  if (!hasAccess) {
    if (showFallback && fallback) {
      return <>{fallback}</>;
    }
    return null;
  }

  return <>{children}</>;
}