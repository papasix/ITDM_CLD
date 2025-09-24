import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { useAADUser } from '../hooks/useAADUser';
import { UserContext, Role, Permission } from './types';
import { hasPermission, hasAnyPermission, hasAllPermissions } from './permissions';

interface RBACContextType extends UserContext {
  hasPermission: (permission: Permission) => boolean;
  hasAnyPermission: (permissions: Permission[]) => boolean;
  hasAllPermissions: (permissions: Permission[]) => boolean;
  canAccessDemand: (demand: any) => boolean;
  canModifyDemand: (demand: any) => boolean;
}

const RBACContext = createContext<RBACContextType | null>(null);

// Map AAD roles to application roles - customize based on your AAD setup
function mapAADRolesToAppRoles(aadUser: any): Role[] {
  const roles: Role[] = [];
  
  // Example mapping - adjust based on your AAD role configuration
  if (aadUser?.roles?.includes('DemandRequestor') || !aadUser?.roles?.length) {
    roles.push('Demand Requestor');
  }
  if (aadUser?.roles?.includes('BUHead')) {
    roles.push('BU Head');
  }
  if (aadUser?.roles?.includes('ITPMO')) {
    roles.push('ITPMO');
  }
  if (aadUser?.roles?.includes('DBR')) {
    roles.push('DBR');
  }
  if (aadUser?.roles?.includes('Admin')) {
    roles.push('Admin');
  }

  // Fallback: if no roles mapped, assign default role
  return roles.length > 0 ? roles : ['Demand Requestor'];
}

export function RBACProvider({ children }: { children: ReactNode }) {
  const aadUser = useAADUser();
  
  const userContext = useMemo<RBACContextType>(() => {
    const roles = aadUser.isAuthenticated ? mapAADRolesToAppRoles(aadUser) : [];
    
    const context: RBACContextType = {
      id: aadUser.email || 'anonymous',
      name: aadUser.name || 'Unknown User',
      email: aadUser.email || '',
      roles,
      isAuthenticated: aadUser.isAuthenticated,
      hasPermission: (permission: Permission) => hasPermission(roles, permission),
      hasAnyPermission: (permissions: Permission[]) => hasAnyPermission(roles, permissions),
      hasAllPermissions: (permissions: Permission[]) => hasAllPermissions(roles, permissions),
      canAccessDemand: (demand: any) => {
        // Admin can access all
        if (hasPermission(roles, 'admin.system')) return true;
        
        // Users can access their own demands
        if (demand.requestor === context.name || demand.requestor === context.email) return true;
        
        // Approvers can access demands in their approval queue
        if (hasPermission(roles, 'demand.approve')) return true;
        
        return false;
      },
      canModifyDemand: (demand: any) => {
        // Admin can modify all
        if (hasPermission(roles, 'admin.system')) return true;
        
        // Users can modify their own draft demands
        if ((demand.requestor === context.name || demand.requestor === context.email) && 
            demand.status === 'Draft') {
          return hasPermission(roles, 'demand.update');
        }
        
        return false;
      }
    };

    return context;
  }, [aadUser]);

  return (
    <RBACContext.Provider value={userContext}>
      {children}
    </RBACContext.Provider>
  );
}

export function useRBAC(): RBACContextType {
  const context = useContext(RBACContext);
  if (!context) {
    throw new Error('useRBAC must be used within RBACProvider');
  }
  return context;
}