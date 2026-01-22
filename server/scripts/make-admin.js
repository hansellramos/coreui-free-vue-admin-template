const { prisma } = require('../db.js');

const APP_ADMIN_SECRET = process.env.APP_ADMIN_SECRET;

if (!APP_ADMIN_SECRET) {
  console.error('Error: APP_ADMIN_SECRET environment variable is not set.');
  console.error('Set this secret before running this command.');
  process.exit(1);
}

const args = process.argv.slice(2);
const providedSecret = args[0];
const email = args[1];

if (!providedSecret || !email) {
  console.error('Usage: npm run make-admin <secret> <email>');
  console.error('Example: npm run make-admin mysecret user@example.com');
  process.exit(1);
}

if (providedSecret !== APP_ADMIN_SECRET) {
  console.error('Error: Invalid secret provided.');
  process.exit(1);
}

async function makeAdmin() {
  const user = await prisma.users.findFirst({
    where: { email: email }
  });

  if (!user) {
    console.error(`Error: User with email "${email}" not found.`);
    console.error('The user must have logged in at least once.');
    process.exit(1);
  }

  if (user.is_super_admin) {
    console.log(`User "${email}" is already a super admin.`);
    process.exit(0);
  }

  await prisma.users.update({
    where: { id: user.id },
    data: { is_super_admin: true }
  });

  console.log(`Success! User "${email}" is now a super admin.`);
}

makeAdmin()
  .catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
