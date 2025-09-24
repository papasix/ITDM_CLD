import React from 'react';
import { useRBAC } from '../../rbac/context';
import type { Demand } from '../../types';

interface DemandAccessProps {
  demand: Demand;
  action: 'view' | 'edit' | 'delete' | 'approve';
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function DemandAccess({ demand, action, children, fallback }: DemandAccessProps) {
  const rbac = useRBAC();
  
  let hasAccess = false;

  switch (action) {
    case 'view':
      hasAccess = rbac.canAccessDemand(demand);
      break;
    case 'edit':
      hasAccess = rbac.canModifyDemand(demand);
      break;
    case 'delete':
      hasAccess = rbac.canModifyDemand(demand) && rbac.hasPermission('demand.delete');
      break;
    case 'approve':
      hasAccess = rbac.hasPermission('demand.approve') && 
                  (demand.status === 'Submitted' || demand.status === 'Under Review');
      break;
  }

  if (!hasAccess) {
    return fallback ? <>{fallback}</> : null;
  }

  return <>{children}</>;
}