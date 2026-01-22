const { prisma } = require('../db');

async function getUserPermissions(userId) {
  if (!userId) return { permissions: [], organizationIds: [], isSuperAdmin: false };
  
  const user = await prisma.users.findUnique({
    where: { id: userId }
  });
  
  if (!user) return { permissions: [], organizationIds: [], isSuperAdmin: false };
  
  if (user.is_super_admin) {
    return { permissions: ['*'], organizationIds: ['*'], isSuperAdmin: true };
  }
  
  let permissions = [];
  if (user.profile_id) {
    const profile = await prisma.profiles.findUnique({
      where: { id: user.profile_id }
    });
    if (profile && profile.permissions) {
      permissions = Array.isArray(profile.permissions) ? profile.permissions : [];
    }
  }
  
  const userOrgs = await prisma.user_organizations.findMany({
    where: { user_id: userId }
  });
  const organizationIds = userOrgs.map(uo => uo.organization_id);
  
  return { permissions, organizationIds, isSuperAdmin: false };
}

function hasPermission(userPermissions, requiredPermission) {
  if (!userPermissions || !userPermissions.permissions) return false;
  if (userPermissions.isSuperAdmin) return true;
  return userPermissions.permissions.includes(requiredPermission);
}

function canViewAllOrganizations(userPermissions) {
  return hasPermission(userPermissions, 'organizations:view:all');
}

function requirePermission(permission) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    
    const userId = String(req.user.claims?.sub || req.user.id);
    const userPerms = await getUserPermissions(userId);
    req.userPermissions = userPerms;
    
    if (!hasPermission(userPerms, permission)) {
      return res.status(403).json({ error: 'No tiene permiso para realizar esta acción' });
    }
    
    next();
  };
}

async function loadUserPermissions(req, res, next) {
  if (req.user) {
    const userId = String(req.user.claims?.sub || req.user.id);
    req.userPermissions = await getUserPermissions(userId);
  } else {
    req.userPermissions = { permissions: [], organizationIds: [], isSuperAdmin: false };
  }
  next();
}

async function getAccessibleOrganizationIds(userPermissions) {
  if (!userPermissions) return [];
  if (userPermissions.isSuperAdmin || canViewAllOrganizations(userPermissions)) {
    return null;
  }
  return userPermissions.organizationIds || [];
}

async function getAccessibleVenueIds(userPermissions) {
  const orgIds = await getAccessibleOrganizationIds(userPermissions);
  if (orgIds === null) return null;
  if (orgIds.length === 0) return [];
  
  const venues = await prisma.venues.findMany({
    where: { organization: { in: orgIds } },
    select: { id: true }
  });
  return venues.map(v => v.id);
}

module.exports = {
  getUserPermissions,
  hasPermission,
  canViewAllOrganizations,
  requirePermission,
  loadUserPermissions,
  getAccessibleOrganizationIds,
  getAccessibleVenueIds
};
