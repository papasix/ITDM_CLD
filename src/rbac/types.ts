export type Permission = 
  | 'demand.create'
  | 'demand.read'
  | 'demand.update'
  | 'demand.delete'
  | 'demand.approve'
  | 'demand.reject'
  | 'demand.assign'
  | 'reports.view'
  | 'reports.export'
  | 'admin.users'
  | 'admin.system';

export type Role = 'Demand Requestor' | 'BU Head' | 'ITPMO' | 'DBR' | 'Admin';

export interface RolePermissions {
  role: Role;
  permissions: Permission[];
  inherits?: Role[];
}

export interface UserContext {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  department?: string;
  isAuthenticated: boolean;
}