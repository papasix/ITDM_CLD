import { Role, Permission, RolePermissions } from './types';

export const ROLE_PERMISSIONS: RolePermissions[] = [
  {
    role: 'Demand Requestor',
    permissions: [
      'demand.create',
      'demand.read',
      'demand.update', // Only own demands
    ]
  },
  {
    role: 'BU Head',
    permissions: [
      'demand.read',
      'demand.approve',
      'demand.reject',
      'reports.view'
    ],
    inherits: ['Demand Requestor']
  },
  {
    role: 'ITPMO',
    permissions: [
      'demand.read',
      'demand.approve',
      'demand.reject',
      'demand.assign',
      'reports.view',
      'reports.export'
    ],
    inherits: ['BU Head']
  },
  {
    role: 'DBR',
    permissions: [
      'demand.read',
      'demand.approve',
      'demand.reject',
      'reports.view',
      'reports.export'
    ],
    inherits: ['ITPMO']
  },
  {
    role: 'Admin',
    permissions: [
      'demand.create',
      'demand.read',
      'demand.update',
      'demand.delete',
      'demand.approve',
      'demand.reject',
      'demand.assign',
      'reports.view',
      'reports.export',
      'admin.users',
      'admin.system'
    ]
  }
];

export function getRolePermissions(role: Role): Permission[] {
  const roleConfig = ROLE_PERMISSIONS.find(r => r.role === role);
  if (!roleConfig) return [];

  let permissions = [...roleConfig.permissions];
  
  // Handle inheritance
  if (roleConfig.inherits) {
    for (const inheritedRole of roleConfig.inherits) {
      permissions = [...permissions, ...getRolePermissions(inheritedRole)];
    }
  }

  return [...new Set(permissions)]; // Remove duplicates
}

export function hasPermission(userRoles: Role[], permission: Permission): boolean {
  return userRoles.some(role => {
    const rolePermissions = getRolePermissions(role);
    return rolePermissions.includes(permission);
  });
}

export function hasAnyPermission(userRoles: Role[], permissions: Permission[]): boolean {
  return permissions.some(permission => hasPermission(userRoles, permission));
}

export function hasAllPermissions(userRoles: Role[], permissions: Permission[]): boolean {
  return permissions.every(permission => hasPermission(userRoles, permission));
}