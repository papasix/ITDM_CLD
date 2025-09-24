import { useRBAC } from '../rbac/context';
import { Permission } from '../rbac/types';

export function useSecureAPI() {
  const rbac = useRBAC();

  const secureCall = async <T>(
    apiCall: () => Promise<T>,
    requiredPermission: Permission,
    resourceCheck?: (user: any) => boolean
  ): Promise<T> => {
    if (!rbac.isAuthenticated) {
      throw new Error('Authentication required');
    }

    if (!rbac.hasPermission(requiredPermission)) {
      throw new Error('Insufficient permissions');
    }

    if (resourceCheck && !resourceCheck(rbac)) {
      throw new Error('Access denied to this resource');
    }

    return apiCall();
  };

  return { secureCall };
}