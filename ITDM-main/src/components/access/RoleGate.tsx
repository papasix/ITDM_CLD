import React from 'react';
import { useRBAC } from '../../rbac/context';
import { Role } from '../../rbac/types';

interface RoleGateProps {
  roles: Role | Role[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
  showFallback?: boolean;
}

export function RoleGate({ roles, children, fallback, showFallback = false }: RoleGateProps) {
  const { roles: userRoles } = useRBAC();
  
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  const hasAccess = userRoles.some(role => allowedRoles.includes(role));

  if (!hasAccess) {
    if (showFallback && fallback) {
      return <>{fallback}</>;
    }
    return null;
  }

  return <>{children}</>;
}