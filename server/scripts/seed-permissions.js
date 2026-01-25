const { prisma } = require('../db.js');

const permissions = [
  { code: 'organizations:view', name: 'Ver organizaciones asignadas', description: 'Permite ver solo las organizaciones asignadas al usuario' },
  { code: 'organizations:view:all', name: 'Ver todas las organizaciones', description: 'Permite ver todas las organizaciones del sistema' },
  { code: 'organizations:create', name: 'Crear organizaciones', description: 'Permite crear nuevas organizaciones' },
  { code: 'organizations:edit', name: 'Editar organizaciones', description: 'Permite editar organizaciones' },
  { code: 'organizations:delete', name: 'Eliminar organizaciones', description: 'Permite eliminar organizaciones' },
  { code: 'venues:view', name: 'Ver venues', description: 'Permite ver venues de organizaciones asignadas' },
  { code: 'venues:create', name: 'Crear venues', description: 'Permite crear nuevos venues' },
  { code: 'venues:edit', name: 'Editar venues', description: 'Permite editar venues' },
  { code: 'venues:delete', name: 'Eliminar venues', description: 'Permite eliminar venues' },
  { code: 'accommodations:view', name: 'Ver reservas', description: 'Permite ver reservas de organizaciones asignadas' },
  { code: 'accommodations:create', name: 'Crear reservas', description: 'Permite crear nuevas reservas' },
  { code: 'accommodations:edit', name: 'Editar reservas', description: 'Permite editar reservas' },
  { code: 'accommodations:delete', name: 'Eliminar reservas', description: 'Permite eliminar reservas' },
  { code: 'payments:view', name: 'Ver pagos', description: 'Permite ver pagos de organizaciones asignadas' },
  { code: 'payments:create', name: 'Crear pagos', description: 'Permite crear nuevos pagos' },
  { code: 'payments:edit', name: 'Editar pagos', description: 'Permite editar pagos' },
  { code: 'payments:delete', name: 'Eliminar pagos', description: 'Permite eliminar pagos' },
  { code: 'payments:verify', name: 'Verificar pagos', description: 'Permite verificar pagos' },
  { code: 'deposits:view', name: 'Ver depósitos', description: 'Permite ver depósitos de organizaciones asignadas' },
  { code: 'deposits:create', name: 'Crear depósitos', description: 'Permite crear nuevos depósitos' },
  { code: 'deposits:edit', name: 'Editar depósitos', description: 'Permite editar depósitos' },
  { code: 'deposits:delete', name: 'Eliminar depósitos', description: 'Permite eliminar depósitos' },
  { code: 'contacts:view', name: 'Ver contactos', description: 'Permite ver contactos de organizaciones asignadas' },
  { code: 'contacts:create', name: 'Crear contactos', description: 'Permite crear nuevos contactos' },
  { code: 'contacts:edit', name: 'Editar contactos', description: 'Permite editar contactos' },
  { code: 'contacts:delete', name: 'Eliminar contactos', description: 'Permite eliminar contactos' },
  { code: 'users:view', name: 'Ver usuarios', description: 'Permite ver usuarios' },
  { code: 'users:edit', name: 'Editar usuarios', description: 'Permite editar usuarios' },
  { code: 'users:lock', name: 'Bloquear usuarios', description: 'Permite bloquear/desbloquear usuarios' },
  { code: 'profiles:view', name: 'Ver perfiles', description: 'Permite ver perfiles' },
  { code: 'profiles:create', name: 'Crear perfiles', description: 'Permite crear nuevos perfiles' },
  { code: 'profiles:edit', name: 'Editar perfiles', description: 'Permite editar perfiles' },
  { code: 'profiles:delete', name: 'Eliminar perfiles', description: 'Permite eliminar perfiles' },
];

const profiles = [
  {
    code: 'organization:view',
    name: 'Visualizador de Organización',
    description: 'Solo puede ver datos de las organizaciones asignadas',
    permissions: [
      'organizations:view',
      'venues:view',
      'accommodations:view',
      'payments:view',
      'deposits:view',
      'contacts:view'
    ],
    is_system: true
  },
  {
    code: 'organization:admin',
    name: 'Administrador de Organización',
    description: 'Puede administrar todo dentro de sus organizaciones asignadas',
    permissions: [
      'organizations:view',
      'venues:view', 'venues:create', 'venues:edit', 'venues:delete',
      'accommodations:view', 'accommodations:create', 'accommodations:edit', 'accommodations:delete',
      'payments:view', 'payments:create', 'payments:edit', 'payments:delete', 'payments:verify',
      'deposits:view', 'deposits:create', 'deposits:edit', 'deposits:delete',
      'contacts:view', 'contacts:create', 'contacts:edit', 'contacts:delete'
    ],
    is_system: true
  }
];

async function seed() {
  console.log('Seeding permissions...');
  
  for (const perm of permissions) {
    await prisma.permissions.upsert({
      where: { code: perm.code },
      update: { name: perm.name, description: perm.description },
      create: perm
    });
  }
  console.log(`Created/updated ${permissions.length} permissions`);
  
  console.log('Seeding profiles...');
  
  for (const profile of profiles) {
    await prisma.profiles.upsert({
      where: { code: profile.code },
      update: { 
        name: profile.name, 
        description: profile.description, 
        permissions: profile.permissions,
        is_system: profile.is_system
      },
      create: profile
    });
  }
  console.log(`Created/updated ${profiles.length} profiles`);
  
  const defaultProfile = await prisma.profiles.findUnique({ where: { code: 'organization:view' } });
  if (defaultProfile) {
    const usersWithoutProfile = await prisma.users.updateMany({
      where: { profile_id: null },
      data: { profile_id: defaultProfile.id }
    });
    console.log(`Assigned default profile to ${usersWithoutProfile.count} users`);
  }
  
  console.log('Seed completed!');
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
