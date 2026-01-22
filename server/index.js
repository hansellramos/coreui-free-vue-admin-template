const express = require('express');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');
const { randomUUID } = require('crypto');
const { prisma } = require('./db');
const { setupAuth, isAuthenticated } = require('./auth/replitAuth');
const { loadUserPermissions, hasPermission, getAccessibleOrganizationIds, getAccessibleVenueIds, requirePermission } = require('./auth/permissions');

const app = express();
const PORT = process.env.PORT || 3000;

const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';

const objectStorageClient = new Storage({
  credentials: {
    audience: 'replit',
    subject_token_type: 'access_token',
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: 'external_account',
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: 'json',
        subject_token_field_name: 'access_token',
      },
    },
    universe_domain: 'googleapis.com',
  },
  projectId: '',
});

async function getUploadURL() {
  const privateObjectDir = process.env.PRIVATE_OBJECT_DIR || '';
  if (!privateObjectDir) {
    throw new Error('PRIVATE_OBJECT_DIR not set');
  }
  
  const objectId = randomUUID();
  const fullPath = `${privateObjectDir}/receipts/${objectId}`;
  
  const pathParts = fullPath.startsWith('/') ? fullPath.slice(1).split('/') : fullPath.split('/');
  const bucketName = pathParts[0];
  const objectName = pathParts.slice(1).join('/');
  
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method: 'PUT',
      expires_at: new Date(Date.now() + 900 * 1000).toISOString(),
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to sign object URL: ${response.status}`);
  }
  
  const { signed_url } = await response.json();
  return { uploadURL: signed_url, objectPath: `/objects/receipts/${objectId}` };
}

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());

async function startServer() {
  await setupAuth(app);
  
  app.use(loadUserPermissions);

  // Upload endpoints for receipts
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  
  app.post('/api/uploads/request-url', isAuthenticated, async (req, res) => {
    try {
      const { contentType, size } = req.body;
      
      if (!contentType || !ALLOWED_IMAGE_TYPES.includes(contentType)) {
        return res.status(400).json({ error: 'Solo se permiten imágenes (JPEG, PNG, GIF, WebP)' });
      }
      
      if (size && size > MAX_FILE_SIZE) {
        return res.status(400).json({ error: 'El archivo no puede superar 10MB' });
      }
      
      const result = await getUploadURL();
      res.json(result);
    } catch (error) {
      console.error('Error generating upload URL:', error);
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  });

  // Serve objects - public for venues/plans, authenticated for receipts
  app.get('/objects/:type/:id', async (req, res, next) => {
    const { type } = req.params;
    // Allow public access for venue and plan images
    if (type === 'venues' || type === 'plans') {
      return next();
    }
    // Require authentication for receipts and other types
    return isAuthenticated(req, res, next);
  }, async (req, res) => {
    try {
      const objectPath = `${req.params.type}/${req.params.id}`;
      const privateObjectDir = process.env.PRIVATE_OBJECT_DIR || '';
      const fullPath = `${privateObjectDir}/${objectPath}`;
      
      const pathParts = fullPath.startsWith('/') ? fullPath.slice(1).split('/') : fullPath.split('/');
      const bucketName = pathParts[0];
      const objectName = pathParts.slice(1).join('/');
      
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);
      
      const [exists] = await file.exists();
      if (!exists) {
        return res.status(404).json({ error: 'Object not found' });
      }
      
      const [metadata] = await file.getMetadata();
      const isPublicType = ['venues', 'plans'].includes(req.params.type);
      res.set({
        'Content-Type': metadata.contentType || 'application/octet-stream',
        'Cache-Control': isPublicType ? 'public, max-age=31536000' : 'private, max-age=3600',
      });
      
      file.createReadStream().pipe(res);
    } catch (error) {
      console.error('Error serving object:', error);
      res.status(500).json({ error: 'Failed to serve object' });
    }
  });

  app.get('/api/organizations', async (req, res) => {
    try {
      const viewAll = req.query.viewAll === 'true';
      let whereClause = {};
      
      if (req.user) {
        const userId = String(req.user.claims?.sub);
        const currentUser = await prisma.users.findUnique({ where: { id: userId } });
        
        if (viewAll && currentUser?.is_super_admin) {
          // Super admin with viewAll=true: show all organizations
          whereClause = {};
        } else if (currentUser?.is_super_admin) {
          // Super admin with viewAll=false: show only assigned organizations
          const userOrgs = await prisma.user_organizations.findMany({
            where: { user_id: userId }
          });
          const orgIds = userOrgs.map(uo => uo.organization_id);
          whereClause = orgIds.length > 0 ? { id: { in: orgIds } } : { id: { in: ['none'] } };
        } else {
          // Non-super admin: use permission-based access
          const accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
          whereClause = accessibleOrgIds !== null ? { id: { in: accessibleOrgIds } } : {};
        }
      } else {
        // No user: show nothing
        whereClause = { id: { in: ['none'] } };
      }
      
      const organizations = await prisma.organizations.findMany({
        where: whereClause,
        orderBy: { name: 'asc' }
      });
      res.json(organizations);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/organizations/:id', async (req, res) => {
    try {
      const organization = await prisma.organizations.findUnique({
        where: { id: req.params.id }
      });
      res.json(organization);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/organizations', isAuthenticated, async (req, res) => {
    try {
      const organization = await prisma.organizations.create({
        data: req.body
      });
      res.json(organization);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/organizations/:id', isAuthenticated, async (req, res) => {
    try {
      const organization = await prisma.organizations.update({
        where: { id: req.params.id },
        data: req.body
      });
      res.json(organization);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/organizations/:id', isAuthenticated, async (req, res) => {
    try {
      await prisma.organizations.delete({
        where: { id: req.params.id }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/venues', async (req, res) => {
    try {
      const viewAll = req.query.viewAll === 'true';
      let whereClause = {};
      
      if (req.user) {
        const userId = String(req.user.claims?.sub);
        const currentUser = await prisma.users.findUnique({ where: { id: userId } });
        
        if (viewAll && currentUser?.is_super_admin) {
          // Super admin with viewAll=true: show all venues
          whereClause = {};
        } else if (currentUser?.is_super_admin) {
          // Super admin with viewAll=false: show venues from assigned organizations only
          const userOrgs = await prisma.user_organizations.findMany({
            where: { user_id: userId }
          });
          const orgIds = userOrgs.map(uo => uo.organization_id);
          whereClause = orgIds.length > 0 ? { organization: { in: orgIds } } : { organization: { in: ['none'] } };
        } else {
          // Non-super admin: use permission-based access
          const accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
          whereClause = accessibleOrgIds !== null ? { organization: { in: accessibleOrgIds } } : {};
        }
      } else {
        whereClause = { organization: { in: ['none'] } };
      }
      
      const venues = await prisma.venues.findMany({
        where: whereClause,
        orderBy: { name: 'asc' }
      });
      res.json(venues);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/venues/:id', async (req, res) => {
    try {
      const venue = await prisma.venues.findUnique({
        where: { id: req.params.id }
      });
      res.json(venue);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/venues', isAuthenticated, async (req, res) => {
    try {
      const venue = await prisma.venues.create({
        data: req.body
      });
      res.json(venue);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/venues/:id', isAuthenticated, async (req, res) => {
    try {
      const venue = await prisma.venues.update({
        where: { id: req.params.id },
        data: req.body
      });
      res.json(venue);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/venues/:id', isAuthenticated, async (req, res) => {
    try {
      await prisma.venues.delete({
        where: { id: req.params.id }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/contacts', async (req, res) => {
    try {
      const viewAll = req.query.viewAll === 'true';
      let accessibleOrgIds = null;
      
      if (req.user) {
        const userId = String(req.user.claims?.sub);
        const currentUser = await prisma.users.findUnique({ where: { id: userId } });
        
        if (viewAll && currentUser?.is_super_admin) {
          // Super admin with viewAll=true: show all contacts
          accessibleOrgIds = null;
        } else if (currentUser?.is_super_admin) {
          // Super admin with viewAll=false: show contacts from assigned organizations only
          const userOrgs = await prisma.user_organizations.findMany({
            where: { user_id: userId }
          });
          accessibleOrgIds = userOrgs.map(uo => uo.organization_id);
        } else {
          // Non-super admin: use permission-based access
          accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
        }
      } else {
        accessibleOrgIds = [];
      }
      
      let contacts;
      if (accessibleOrgIds !== null) {
        if (accessibleOrgIds.length === 0) {
          contacts = [];
        } else {
          const contactOrgs = await prisma.contact_organization.findMany({
            where: { organization: { in: accessibleOrgIds } },
            select: { contact: true }
          });
          const contactIds = [...new Set(contactOrgs.map(co => co.contact))];
          contacts = contactIds.length > 0 
            ? await prisma.contacts.findMany({
                where: { id: { in: contactIds } },
                orderBy: { fullname: 'asc' }
              })
            : [];
        }
      } else {
        contacts = await prisma.contacts.findMany({
          orderBy: { fullname: 'asc' }
        });
      }
      
      res.json(contacts);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/contacts/:id', async (req, res) => {
    try {
      const contact = await prisma.contacts.findUnique({
        where: { id: req.params.id }
      });
      res.json(contact);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/contacts', isAuthenticated, async (req, res) => {
    try {
      const { organizationId, ...contactData } = req.body;
      const contact = await prisma.contacts.create({
        data: contactData
      });
      
      if (organizationId) {
        await prisma.contact_organization.create({
          data: {
            contact: contact.id,
            organization: organizationId,
            type: 'customer'
          }
        });
      }
      
      res.json(contact);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/contacts/:id', isAuthenticated, async (req, res) => {
    try {
      const contact = await prisma.contacts.update({
        where: { id: req.params.id },
        data: req.body
      });
      res.json(contact);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/contacts/:id', isAuthenticated, async (req, res) => {
    try {
      await prisma.contacts.delete({
        where: { id: req.params.id }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/accommodations', async (req, res) => {
    try {
      const { from_date, venue_ids, viewAll } = req.query;
      const viewAllFlag = viewAll === 'true';
      
      let accessibleVenueIds = null;
      
      if (req.user) {
        const userId = String(req.user.claims?.sub);
        const currentUser = await prisma.users.findUnique({ where: { id: userId } });
        
        if (viewAllFlag && currentUser?.is_super_admin) {
          // Super admin with viewAll=true: show all accommodations
          accessibleVenueIds = null;
        } else if (currentUser?.is_super_admin) {
          // Super admin with viewAll=false: show accommodations from venues in assigned organizations
          const userOrgs = await prisma.user_organizations.findMany({
            where: { user_id: userId }
          });
          const orgIds = userOrgs.map(uo => uo.organization_id);
          if (orgIds.length > 0) {
            const venues = await prisma.venues.findMany({
              where: { organization: { in: orgIds } },
              select: { id: true }
            });
            accessibleVenueIds = venues.map(v => v.id);
          } else {
            accessibleVenueIds = [];
          }
        } else {
          // Non-super admin: use permission-based access
          accessibleVenueIds = await getAccessibleVenueIds(req.userPermissions);
        }
      } else {
        accessibleVenueIds = [];
      }
      
      const whereClause = {};
      
      if (from_date) {
        whereClause.date = { gte: new Date(from_date) };
      }
      
      // Handle case where user has no accessible venues - return empty result early
      if (accessibleVenueIds !== null && accessibleVenueIds.length === 0) {
        return res.json([]);
      }
      
      if (venue_ids) {
        const ids = venue_ids.split(',');
        if (accessibleVenueIds !== null) {
          const filteredIds = ids.filter(id => accessibleVenueIds.includes(id));
          if (filteredIds.length === 0) {
            return res.json([]);
          }
          whereClause.venue = { in: filteredIds };
        } else {
          whereClause.venue = { in: ids };
        }
      } else if (accessibleVenueIds !== null) {
        whereClause.venue = { in: accessibleVenueIds };
      }
      
      const accommodations = await prisma.accommodations.findMany({
        where: whereClause,
        orderBy: { date: 'asc' }
      });
      
      // Get unique venue and customer IDs
      const venueIds = [...new Set(accommodations.filter(a => a.venue).map(a => a.venue))];
      const customerIds = [...new Set(accommodations.filter(a => a.customer).map(a => a.customer))];
      
      // Fetch venues with their organizations
      const venues = venueIds.length > 0 ? await prisma.venues.findMany({
        where: { id: { in: venueIds } }
      }) : [];
      
      // Fetch organizations for venues
      const orgIds = [...new Set(venues.filter(v => v.organization).map(v => v.organization))];
      const organizations = orgIds.length > 0 ? await prisma.organizations.findMany({
        where: { id: { in: orgIds } }
      }) : [];
      const orgsMap = {};
      organizations.forEach(o => { orgsMap[o.id] = o; });
      
      // Build venues map with organization data
      const venuesMap = {};
      venues.forEach(v => { 
        venuesMap[v.id] = {
          ...v,
          organization_data: v.organization ? orgsMap[v.organization] : null
        };
      });
      
      // Fetch customers (contacts) with their user data
      const customers = customerIds.length > 0 ? await prisma.contacts.findMany({
        where: { id: { in: customerIds } }
      }) : [];
      const userIds = customers.filter(c => c.user).map(c => c.user);
      const users = userIds.length > 0 ? await prisma.users.findMany({
        where: { id: { in: userIds } }
      }) : [];
      const usersMap = {};
      users.forEach(u => { usersMap[u.id] = u; });
      
      const customersMap = {};
      customers.forEach(c => { 
        customersMap[c.id] = {
          ...c,
          user_data: c.user ? usersMap[c.user] : null
        };
      });
      
      // Enrich accommodations with related data
      const enriched = accommodations.map(a => ({
        ...a,
        venue_data: a.venue ? venuesMap[a.venue] : null,
        customer_data: a.customer ? customersMap[a.customer] : null
      }));
      
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/accommodations/:id', async (req, res) => {
    try {
      if (req.params.id === 'new') {
        return res.status(400).json({ error: 'Invalid ID' });
      }
      const accommodation = await prisma.accommodations.findUnique({
        where: { id: req.params.id }
      });
      if (!accommodation) {
        return res.status(404).json({ error: 'Accommodation not found' });
      }
      
      // Fetch venue with organization
      let venue_data = null;
      if (accommodation.venue) {
        const venue = await prisma.venues.findUnique({ where: { id: accommodation.venue } });
        if (venue) {
          let organization_data = null;
          if (venue.organization) {
            organization_data = await prisma.organizations.findUnique({ where: { id: venue.organization } });
          }
          venue_data = { ...venue, organization_data };
        }
      }
      
      // Fetch customer with user
      let customer_data = null;
      if (accommodation.customer) {
        const customer = await prisma.contacts.findUnique({ where: { id: accommodation.customer } });
        if (customer) {
          let user_data = null;
          if (customer.user) {
            user_data = await prisma.users.findUnique({ where: { id: customer.user } });
          }
          customer_data = { ...customer, user_data };
        }
      }
      
      res.json({ ...accommodation, venue_data, customer_data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/accommodations', isAuthenticated, async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.date && typeof data.date === 'string' && !data.date.includes('T')) {
        data.date = new Date(data.date + 'T00:00:00.000Z');
      }
      if (data.time && typeof data.time === 'string' && !data.time.includes('T')) {
        data.time = new Date('1970-01-01T' + data.time + ':00.000Z');
      }
      if (data.customer === '') {
        data.customer = null;
      }
      const accommodation = await prisma.accommodations.create({ data });
      res.json(accommodation);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/accommodations/:id', isAuthenticated, async (req, res) => {
    try {
      const { venue, date, time, duration, customer, adults, children } = req.body;
      const data = { venue, duration, adults, children };
      
      if (date && typeof date === 'string' && !date.includes('T')) {
        data.date = new Date(date + 'T00:00:00.000Z');
      } else if (date) {
        data.date = new Date(date);
      }
      
      if (time && typeof time === 'string' && !time.includes('T')) {
        data.time = new Date('1970-01-01T' + time + ':00.000Z');
      } else if (time) {
        data.time = new Date(time);
      }
      
      data.customer = customer === '' ? null : customer;
      
      const accommodation = await prisma.accommodations.update({
        where: { id: req.params.id },
        data
      });
      res.json(accommodation);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/accommodations/:id', isAuthenticated, async (req, res) => {
    try {
      await prisma.accommodations.delete({
        where: { id: req.params.id }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Payments CRUD
  app.get('/api/payments', async (req, res) => {
    try {
      const { accommodation_id, viewAll } = req.query;
      const viewAllFlag = viewAll === 'true';
      
      let accessibleVenueIds = null;
      
      if (req.user) {
        const userId = String(req.user.claims?.sub);
        const currentUser = await prisma.users.findUnique({ where: { id: userId } });
        
        if (viewAllFlag && currentUser?.is_super_admin) {
          // Super admin with viewAll=true: show all payments
          accessibleVenueIds = null;
        } else if (currentUser?.is_super_admin) {
          // Super admin with viewAll=false: show payments from accommodations in assigned organizations
          const userOrgs = await prisma.user_organizations.findMany({
            where: { user_id: userId }
          });
          const orgIds = userOrgs.map(uo => uo.organization_id);
          if (orgIds.length > 0) {
            const venues = await prisma.venues.findMany({
              where: { organization: { in: orgIds } },
              select: { id: true }
            });
            accessibleVenueIds = venues.map(v => v.id);
          } else {
            accessibleVenueIds = [];
          }
        } else {
          // Non-super admin: use permission-based access
          accessibleVenueIds = await getAccessibleVenueIds(req.userPermissions);
        }
      } else {
        accessibleVenueIds = [];
      }
      
      let accessibleAccommodationIds = null;
      if (accessibleVenueIds !== null) {
        if (accessibleVenueIds.length === 0) {
          accessibleAccommodationIds = [];
        } else {
          const accs = await prisma.accommodations.findMany({
            where: { venue: { in: accessibleVenueIds } },
            select: { id: true }
          });
          accessibleAccommodationIds = accs.map(a => a.id);
        }
      }
      
      // Handle case where user has no accessible accommodations - return empty result early
      if (accessibleAccommodationIds !== null && accessibleAccommodationIds.length === 0) {
        return res.json([]);
      }
      
      let where = {};
      if (accommodation_id) {
        if (accessibleAccommodationIds !== null && !accessibleAccommodationIds.includes(accommodation_id)) {
          return res.json([]);
        }
        where.accommodation = accommodation_id;
      } else if (accessibleAccommodationIds !== null) {
        where.accommodation = { in: accessibleAccommodationIds };
      }
      
      const payments = await prisma.payments.findMany({
        where,
        orderBy: { created_at: 'desc' }
      });
      
      // Enrich with user data
      const verifierIds = [...new Set(payments.filter(p => p.verified_by).map(p => p.verified_by))];
      const creatorIds = [...new Set(payments.filter(p => p.created_by).map(p => p.created_by))];
      const allUserIds = [...new Set([...verifierIds, ...creatorIds])];
      
      const users = allUserIds.length > 0 ? await prisma.users.findMany({
        where: { id: { in: allUserIds } }
      }) : [];
      const usersMap = {};
      users.forEach(u => { usersMap[u.id] = u; });
      
      // Enrich with accommodation data
      const accIds = [...new Set(payments.filter(p => p.accommodation).map(p => p.accommodation))];
      const accommodations = accIds.length > 0 ? await prisma.accommodations.findMany({
        where: { id: { in: accIds } }
      }) : [];
      const accMap = {};
      accommodations.forEach(a => { accMap[a.id] = a; });
      
      const enriched = payments.map(p => ({
        ...p,
        verified_by_user: p.verified_by ? usersMap[p.verified_by] : null,
        created_by_user: p.created_by ? usersMap[p.created_by] : null,
        accommodation_data: p.accommodation ? accMap[p.accommodation] : null
      }));
      
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/payments/:id', async (req, res) => {
    try {
      const payment = await prisma.payments.findUnique({
        where: { id: req.params.id }
      });
      if (!payment) {
        return res.status(404).json({ error: 'Payment not found' });
      }
      res.json(payment);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/payments', isAuthenticated, async (req, res) => {
    try {
      // Look up the user by their Replit ID (which is the primary key in users table)
      const replitId = String(req.user?.claims?.sub);
      const dbUser = await prisma.users.findUnique({
        where: { id: replitId }
      });
      const userId = dbUser?.id || null;
      
      const { type, accommodation, amount, payment_method, payment_date, reference, notes, receipt_url } = req.body;
      const data = {
        type: type || null,
        accommodation: accommodation || null,
        amount: amount ? parseFloat(amount) : null,
        payment_method: payment_method || null,
        reference: reference || null,
        notes: notes || null,
        receipt_url: receipt_url || null,
        created_by: userId
      };
      
      if (payment_date && typeof payment_date === 'string') {
        data.payment_date = new Date(payment_date + 'T00:00:00.000Z');
      }
      
      const payment = await prisma.payments.create({ data });
      res.json(payment);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/payments/:id', isAuthenticated, async (req, res) => {
    try {
      const existingPayment = await prisma.payments.findUnique({
        where: { id: req.params.id }
      });
      
      if (!existingPayment) {
        return res.status(404).json({ error: 'Pago no encontrado' });
      }
      
      if (existingPayment.verified) {
        return res.status(403).json({ error: 'No se puede modificar un pago verificado' });
      }
      
      // Look up the user by their Replit ID (which is the primary key in users table)
      const replitId = String(req.user?.claims?.sub);
      const dbUser = await prisma.users.findUnique({
        where: { id: replitId }
      });
      const userId = dbUser?.id || null;
      
      const { type, accommodation, amount, payment_method, payment_date, reference, notes, receipt_url } = req.body;
      const data = {
        type: type || null,
        accommodation: accommodation || null,
        amount: amount ? parseFloat(amount) : null,
        payment_method: payment_method || null,
        reference: reference || null,
        notes: notes || null,
        receipt_url: receipt_url || null,
        updated_at: new Date(),
        updated_by: userId
      };
      
      if (payment_date && typeof payment_date === 'string' && !payment_date.includes('T')) {
        data.payment_date = new Date(payment_date + 'T00:00:00.000Z');
      } else if (payment_date) {
        data.payment_date = new Date(payment_date);
      }
      
      const payment = await prisma.payments.update({
        where: { id: req.params.id },
        data
      });
      res.json(payment);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/payments/:id/verify', isAuthenticated, async (req, res) => {
    try {
      const { verified } = req.body;
      const paymentId = req.params.id;
      
      // Get current payment to access accommodation info
      const currentPayment = await prisma.payments.findUnique({
        where: { id: paymentId }
      });
      
      if (!currentPayment) {
        return res.status(404).json({ error: 'Payment not found' });
      }
      
      // Look up the user by their Replit ID (which is the primary key in users table)
      const replitId = String(req.user?.claims?.sub);
      const dbUser = await prisma.users.findUnique({
        where: { id: replitId }
      });
      const userId = dbUser?.id || null;
      
      const data = {
        verified: verified === true,
        verified_at: verified === true ? new Date() : null,
        verified_by: verified === true ? userId : null,
        updated_at: new Date(),
        updated_by: userId
      };
      
      const payment = await prisma.payments.update({
        where: { id: paymentId },
        data
      });
      
      // Handle income creation/deletion based on verification status
      if (verified === true && currentPayment.accommodation) {
        // Get accommodation to find venue
        const accommodation = await prisma.accommodations.findUnique({
          where: { id: currentPayment.accommodation }
        });
        
        // Get venue (if exists) to find organization
        let venue = null;
        if (accommodation?.venue) {
          venue = await prisma.venues.findUnique({
            where: { id: accommodation.venue }
          });
        }
        
        // Create or update income record (upsert to prevent duplicates)
        const incomeData = {
          organization_id: venue?.organization || null,
          venue_id: accommodation?.venue || null,
          amount: currentPayment.amount,
          type: 'accommodation',
          date: currentPayment.payment_date || accommodation?.date || new Date()
        };
        
        await prisma.incomes.upsert({
          where: { payment_id: paymentId },
          update: incomeData,
          create: { payment_id: paymentId, ...incomeData }
        });
      } else if (verified === false) {
        // Remove income record when payment is unverified
        await prisma.incomes.deleteMany({
          where: { payment_id: paymentId }
        });
      }
      
      res.json(payment);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/payments/:id', isAuthenticated, async (req, res) => {
    try {
      await prisma.payments.delete({
        where: { id: req.params.id }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Analytics endpoints
  
  // Helper function to get accessible organization IDs for analytics
  async function getAnalyticsOrgIds(req) {
    const { viewAll, organizations } = req.query;
    const viewAllFlag = viewAll === 'true';
    const selectedOrgIds = organizations ? organizations.split(',') : [];
    
    let accessibleOrgIds = null;
    
    if (req.user) {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      
      if (viewAllFlag && currentUser?.is_super_admin) {
        // Super admin with viewAll=true: access all organizations
        accessibleOrgIds = null;
      } else if (currentUser?.is_super_admin) {
        // Super admin with viewAll=false: only assigned organizations
        const userOrgs = await prisma.user_organizations.findMany({
          where: { user_id: userId }
        });
        accessibleOrgIds = userOrgs.map(uo => uo.organization_id);
      } else {
        // Non-super admin: use permission-based access
        accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
      }
    } else {
      accessibleOrgIds = [];
    }
    
    // Filter by selected organizations if provided
    if (selectedOrgIds.length > 0) {
      if (accessibleOrgIds === null) {
        // User has access to all, filter by selection
        accessibleOrgIds = selectedOrgIds;
      } else {
        // User has limited access, intersect with selection
        accessibleOrgIds = accessibleOrgIds.filter(id => selectedOrgIds.includes(id));
      }
    }
    
    return accessibleOrgIds;
  }
  
  // Income summary for current month with comparison to previous month
  app.get('/api/analytics/income-summary', isAuthenticated, async (req, res) => {
    try {
      const orgIds = await getAnalyticsOrgIds(req);
      
      if (orgIds !== null && orgIds.length === 0) {
        return res.json({
          currentMonth: { total: 0, count: 0 },
          previousMonth: { total: 0, count: 0 },
          percentChange: 0
        });
      }
      
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      
      const whereClause = orgIds !== null ? { organization_id: { in: orgIds } } : {};
      
      // Current month incomes
      const currentMonthIncomes = await prisma.incomes.findMany({
        where: {
          ...whereClause,
          date: { gte: currentMonthStart }
        }
      });
      
      // Previous month incomes
      const previousMonthIncomes = await prisma.incomes.findMany({
        where: {
          ...whereClause,
          date: { gte: previousMonthStart, lte: previousMonthEnd }
        }
      });
      
      const currentTotal = currentMonthIncomes.reduce((sum, i) => sum + Number(i.amount || 0), 0);
      const previousTotal = previousMonthIncomes.reduce((sum, i) => sum + Number(i.amount || 0), 0);
      
      const percentChange = previousTotal > 0 
        ? ((currentTotal - previousTotal) / previousTotal * 100).toFixed(1)
        : currentTotal > 0 ? 100 : 0;
      
      res.json({
        currentMonth: { total: currentTotal, count: currentMonthIncomes.length },
        previousMonth: { total: previousTotal, count: previousMonthIncomes.length },
        percentChange: Number(percentChange)
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Income breakdown by venue for pie chart
  app.get('/api/analytics/income-by-venue', isAuthenticated, async (req, res) => {
    try {
      const orgIds = await getAnalyticsOrgIds(req);
      
      if (orgIds !== null && orgIds.length === 0) {
        return res.json([]);
      }
      
      const whereClause = orgIds !== null ? { organization_id: { in: orgIds } } : {};
      
      // Get all incomes grouped by venue
      const incomes = await prisma.incomes.findMany({
        where: whereClause
      });
      
      // Group by venue
      const venueIncomes = {};
      incomes.forEach(income => {
        if (!income.venue_id) return;
        if (!venueIncomes[income.venue_id]) {
          venueIncomes[income.venue_id] = { total: 0, count: 0 };
        }
        venueIncomes[income.venue_id].total += Number(income.amount || 0);
        venueIncomes[income.venue_id].count += 1;
      });
      
      // Get venue names
      const venueIds = Object.keys(venueIncomes);
      const venues = venueIds.length > 0 ? await prisma.venues.findMany({
        where: { id: { in: venueIds } }
      }) : [];
      
      const venueMap = {};
      venues.forEach(v => { venueMap[v.id] = v.name; });
      
      const result = venueIds.map(venueId => ({
        venue_id: venueId,
        venue_name: venueMap[venueId] || 'Unknown',
        total: venueIncomes[venueId].total,
        count: venueIncomes[venueId].count
      })).sort((a, b) => b.total - a.total);
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Accommodations history - last 12 months by venue
  app.get('/api/analytics/accommodations-history', isAuthenticated, async (req, res) => {
    try {
      const orgIds = await getAnalyticsOrgIds(req);
      
      if (orgIds !== null && orgIds.length === 0) {
        return res.json({ months: [], venues: [] });
      }
      
      // Get venue IDs for accessible organizations
      let venueIds = null;
      if (orgIds !== null) {
        const venues = await prisma.venues.findMany({
          where: { organization: { in: orgIds } },
          select: { id: true }
        });
        venueIds = venues.map(v => v.id);
        if (venueIds.length === 0) {
          return res.json({ months: [], venues: [] });
        }
      }
      
      // Calculate date range for last 12 months
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      
      const whereClause = {
        date: { gte: startDate, lt: new Date(now.getFullYear(), now.getMonth() + 1, 1) }
      };
      if (venueIds !== null) {
        whereClause.venue = { in: venueIds };
      }
      
      const accommodations = await prisma.accommodations.findMany({
        where: whereClause
      });
      
      // Get all venues for the chart
      const allVenueIds = [...new Set(accommodations.filter(a => a.venue).map(a => a.venue))];
      const venues = allVenueIds.length > 0 ? await prisma.venues.findMany({
        where: { id: { in: allVenueIds } }
      }) : [];
      
      // Generate months array
      const months = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
          key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          label: d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' })
        });
      }
      
      // Group accommodations by venue and month
      const venueData = venues.map(venue => {
        const counts = months.map(month => {
          return accommodations.filter(a => {
            if (a.venue !== venue.id || !a.date) return false;
            const d = new Date(a.date);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            return key === month.key;
          }).length;
        });
        return { venue_id: venue.id, venue_name: venue.name, counts };
      });
      
      res.json({ months: months.map(m => m.label), venues: venueData });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Accommodations forecast - next 12 months by venue
  app.get('/api/analytics/accommodations-forecast', isAuthenticated, async (req, res) => {
    try {
      const orgIds = await getAnalyticsOrgIds(req);
      
      if (orgIds !== null && orgIds.length === 0) {
        return res.json({ months: [], venues: [] });
      }
      
      // Get venue IDs for accessible organizations
      let venueIds = null;
      if (orgIds !== null) {
        const venues = await prisma.venues.findMany({
          where: { organization: { in: orgIds } },
          select: { id: true }
        });
        venueIds = venues.map(v => v.id);
        if (venueIds.length === 0) {
          return res.json({ months: [], venues: [] });
        }
      }
      
      // Calculate date range for next 12 months
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = new Date(now.getFullYear(), now.getMonth() + 12, 0);
      
      const whereClause = {
        date: { gte: startDate, lte: endDate }
      };
      if (venueIds !== null) {
        whereClause.venue = { in: venueIds };
      }
      
      const accommodations = await prisma.accommodations.findMany({
        where: whereClause
      });
      
      // Get all venues for the chart
      const allVenueIds = [...new Set(accommodations.filter(a => a.venue).map(a => a.venue))];
      const venues = allVenueIds.length > 0 ? await prisma.venues.findMany({
        where: { id: { in: allVenueIds } }
      }) : [];
      
      // Generate months array
      const months = [];
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        months.push({
          key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          label: d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' })
        });
      }
      
      // Group accommodations by venue and month
      const venueData = venues.map(venue => {
        const counts = months.map(month => {
          return accommodations.filter(a => {
            if (a.venue !== venue.id || !a.date) return false;
            const d = new Date(a.date);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            return key === month.key;
          }).length;
        });
        return { venue_id: venue.id, venue_name: venue.name, counts };
      });
      
      res.json({ months: months.map(m => m.label), venues: venueData });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/countries', async (req, res) => {
    try {
      const countries = await prisma.countries.findMany({
        orderBy: { name: 'asc' }
      });
      res.json(countries);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/states', async (req, res) => {
    try {
      const { country } = req.query;
      const where = country ? { country: country.toUpperCase() } : {};
      const states = await prisma.states.findMany({
        where,
        orderBy: { name: 'asc' }
      });
      res.json(states);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/users', isAuthenticated, async (req, res) => {
    try {
      const users = await prisma.users.findMany({
        orderBy: { email: 'asc' }
      });
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Super Admin Management - MUST be before /api/users/:id to avoid route conflicts
  app.get('/api/users/super-admins', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      
      if (!currentUser?.is_super_admin) {
        return res.status(403).json({ error: 'Solo super admins pueden acceder' });
      }
      const superAdmins = await prisma.users.findMany({
        where: { is_super_admin: true },
        orderBy: { email: 'asc' },
        select: { id: true, email: true, display_name: true, avatar_url: true }
      });
      res.json(superAdmins);
    } catch (error) {
      console.error('super-admins endpoint error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/users/:id/super-admin', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      
      if (!currentUser?.is_super_admin) {
        return res.status(403).json({ error: 'Solo super admins pueden modificar este permiso' });
      }
      
      if (typeof req.body.is_super_admin !== 'boolean') {
        return res.status(400).json({ error: 'Valor de is_super_admin inválido' });
      }
      
      const newValue = req.body.is_super_admin;
      
      if (String(req.params.id) === String(currentUser.id) && !newValue) {
        return res.status(400).json({ error: 'No puedes quitarte el permiso de super admin a ti mismo' });
      }
      
      const user = await prisma.users.update({
        where: { id: req.params.id },
        data: { is_super_admin: newValue }
      });
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/users/:id', isAuthenticated, async (req, res) => {
    try {
      const user = await prisma.users.findUnique({
        where: { id: req.params.id }
      });
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/users', isAuthenticated, async (req, res) => {
    try {
      const user = await prisma.users.create({
        data: {
          id: req.body.id || `manual_${Date.now()}`,
          email: req.body.email,
          display_name: req.body.display_name,
          avatar_url: req.body.avatar_url,
          role: req.body.role || 'user',
          is_locked: false
        }
      });
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/users/:id', isAuthenticated, async (req, res) => {
    try {
      const { email, display_name, avatar_url, role, preferences } = req.body;
      const user = await prisma.users.update({
        where: { id: req.params.id },
        data: {
          email,
          display_name,
          avatar_url,
          role,
          preferences
        }
      });
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/users/:id', isAuthenticated, async (req, res) => {
    try {
      await prisma.users.delete({
        where: { id: req.params.id }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/users/:id/lock', isAuthenticated, async (req, res) => {
    try {
      const user = await prisma.users.update({
        where: { id: req.params.id },
        data: {
          is_locked: true,
          locked_at: new Date(),
          locked_by: String(req.user.claims?.sub)
        }
      });
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/users/:id/unlock', isAuthenticated, async (req, res) => {
    try {
      const user = await prisma.users.update({
        where: { id: req.params.id },
        data: {
          is_locked: false,
          locked_at: null,
          locked_by: null
        }
      });
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/organizations/:id/contacts', async (req, res) => {
    try {
      const relations = await prisma.contact_organization.findMany({
        where: { organization: req.params.id }
      });
      const contactIds = relations.map(r => r.contact);
      const contactsData = await prisma.contacts.findMany({
        where: { id: { in: contactIds } }
      });
      const userIds = contactsData.filter(c => c.user).map(c => c.user);
      const usersData = userIds.length > 0 ? await prisma.users.findMany({
        where: { id: { in: userIds } }
      }) : [];
      const usersMap = {};
      usersData.forEach(u => { usersMap[u.id] = u; });
      const contactsMap = {};
      contactsData.forEach(c => { 
        contactsMap[c.id] = {
          ...c,
          user_email: c.user ? usersMap[c.user]?.email : null
        };
      });
      const result = relations.map(r => ({
        ...r,
        contact: contactsMap[r.contact] || null
      }));
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/organizations/:id/contacts', isAuthenticated, async (req, res) => {
    try {
      const relation = await prisma.contact_organization.create({
        data: {
          organization: req.params.id,
          contact: req.body.contactId,
          type: req.body.type || 'employee'
        }
      });
      res.json(relation);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/organizations/:orgId/contacts/:contactId', isAuthenticated, async (req, res) => {
    try {
      await prisma.contact_organization.delete({
        where: {
          contact_organization: {
            contact: req.params.contactId,
            organization: req.params.orgId
          }
        }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Profiles CRUD
  app.get('/api/profiles', async (req, res) => {
    try {
      const profiles = await prisma.profiles.findMany({
        orderBy: { name: 'asc' }
      });
      res.json(profiles);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/profiles/:id', async (req, res) => {
    try {
      const profile = await prisma.profiles.findUnique({
        where: { id: req.params.id }
      });
      if (!profile) {
        return res.status(404).json({ error: 'Perfil no encontrado' });
      }
      res.json(profile);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/profiles', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      if (!currentUser?.is_super_admin && !hasPermission(req.userPermissions, 'profiles:create')) {
        return res.status(403).json({ error: 'No tiene permiso para crear perfiles' });
      }
      const { code, name, description, permissions } = req.body;
      const profile = await prisma.profiles.create({
        data: {
          code,
          name,
          description,
          permissions: permissions || [],
          is_system: false
        }
      });
      res.json(profile);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/profiles/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      if (!currentUser?.is_super_admin && !hasPermission(req.userPermissions, 'profiles:edit')) {
        return res.status(403).json({ error: 'No tiene permiso para editar perfiles' });
      }
      
      const existing = await prisma.profiles.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        return res.status(404).json({ error: 'Perfil no encontrado' });
      }
      if (existing.is_system) {
        return res.status(403).json({ error: 'No se pueden modificar perfiles del sistema' });
      }
      
      const { code, name, description, permissions } = req.body;
      const profile = await prisma.profiles.update({
        where: { id: req.params.id },
        data: { code, name, description, permissions }
      });
      res.json(profile);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/profiles/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      if (!currentUser?.is_super_admin && !hasPermission(req.userPermissions, 'profiles:delete')) {
        return res.status(403).json({ error: 'No tiene permiso para eliminar perfiles' });
      }
      
      const existing = await prisma.profiles.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        return res.status(404).json({ error: 'Perfil no encontrado' });
      }
      if (existing.is_system) {
        return res.status(403).json({ error: 'No se pueden eliminar perfiles del sistema' });
      }
      
      await prisma.profiles.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Permissions list
  app.get('/api/permissions', async (req, res) => {
    try {
      const permissions = await prisma.permissions.findMany({
        orderBy: { code: 'asc' }
      });
      res.json(permissions);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // User organizations
  app.get('/api/users/:id/organizations', isAuthenticated, async (req, res) => {
    try {
      const userOrgs = await prisma.user_organizations.findMany({
        where: { user_id: req.params.id }
      });
      const orgIds = userOrgs.map(uo => uo.organization_id);
      const organizations = orgIds.length > 0 
        ? await prisma.organizations.findMany({ where: { id: { in: orgIds } } })
        : [];
      res.json(organizations);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/users/:id/organizations', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      if (!currentUser?.is_super_admin && !hasPermission(req.userPermissions, 'users:edit')) {
        return res.status(403).json({ error: 'No tiene permiso para editar usuarios' });
      }
      
      const { organization_ids } = req.body;
      
      await prisma.user_organizations.deleteMany({
        where: { user_id: req.params.id }
      });
      
      if (organization_ids && organization_ids.length > 0) {
        await prisma.user_organizations.createMany({
          data: organization_ids.map(orgId => ({
            user_id: req.params.id,
            organization_id: orgId
          }))
        });
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update user profile
  app.put('/api/users/:id/profile', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      if (!currentUser?.is_super_admin && !hasPermission(req.userPermissions, 'users:edit')) {
        return res.status(403).json({ error: 'No tiene permiso para editar usuarios' });
      }
      
      const { profile_id } = req.body;
      
      const user = await prisma.users.update({
        where: { id: req.params.id },
        data: { profile_id }
      });
      
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // =====================
  // AMENITIES CRUD
  // =====================
  app.get('/api/amenities', async (req, res) => {
    try {
      const amenities = await prisma.amenities.findMany({
        orderBy: { name: 'asc' }
      });
      res.json(amenities);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/amenities/:id', async (req, res) => {
    try {
      const amenity = await prisma.amenities.findUnique({ where: { id: req.params.id } });
      if (!amenity) return res.status(404).json({ error: 'Amenidad no encontrada' });
      res.json(amenity);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/amenities', isAuthenticated, async (req, res) => {
    try {
      const { name, description, icon, category, is_active } = req.body;
      const amenity = await prisma.amenities.create({
        data: { name, description, icon, category, is_active: is_active !== false }
      });
      res.status(201).json(amenity);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/amenities/:id', isAuthenticated, async (req, res) => {
    try {
      const { name, description, icon, category, is_active } = req.body;
      const amenity = await prisma.amenities.update({
        where: { id: req.params.id },
        data: { name, description, icon, category, is_active }
      });
      res.json(amenity);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/amenities/:id', isAuthenticated, async (req, res) => {
    try {
      await prisma.amenities.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // =====================
  // VENUE PLANS CRUD
  // =====================
  app.get('/api/venue-plans', async (req, res) => {
    try {
      const { venue_id } = req.query;
      const where = venue_id ? { venue_id } : {};
      const plans = await prisma.venue_plans.findMany({
        where,
        orderBy: { name: 'asc' }
      });
      
      // Fetch amenities and images for each plan
      const plansWithDetails = await Promise.all(plans.map(async (plan) => {
        const planAmenities = await prisma.plan_amenities.findMany({
          where: { plan_id: plan.id }
        });
        const amenityIds = planAmenities.map(pa => pa.amenity_id);
        const amenities = amenityIds.length > 0 
          ? await prisma.amenities.findMany({ where: { id: { in: amenityIds } } })
          : [];
        
        const images = await prisma.plan_images.findMany({
          where: { plan_id: plan.id },
          orderBy: { sort_order: 'asc' }
        });
        
        return {
          ...plan,
          amenities: amenities.map(a => ({
            ...a,
            ...(planAmenities.find(pa => pa.amenity_id === a.id) || {})
          })),
          images
        };
      }));
      
      res.json(plansWithDetails);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/venue-plans/:id', async (req, res) => {
    try {
      const plan = await prisma.venue_plans.findUnique({ where: { id: req.params.id } });
      if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
      
      const planAmenities = await prisma.plan_amenities.findMany({
        where: { plan_id: plan.id }
      });
      const amenityIds = planAmenities.map(pa => pa.amenity_id);
      const amenities = amenityIds.length > 0 
        ? await prisma.amenities.findMany({ where: { id: { in: amenityIds } } })
        : [];
      
      const images = await prisma.plan_images.findMany({
        where: { plan_id: plan.id },
        orderBy: { sort_order: 'asc' }
      });
      
      res.json({
        ...plan,
        amenities: amenities.map(a => ({
          ...a,
          ...(planAmenities.find(pa => pa.amenity_id === a.id) || {})
        })),
        images
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/venue-plans', isAuthenticated, async (req, res) => {
    try {
      const {
        venue_id, name, plan_type, description,
        adult_price, child_price, infant_max_age, child_max_age,
        free_children_qty, free_children_max_age, free_children_condition, child_food_price,
        min_guests, max_capacity, check_in_time, check_out_time,
        includes_overnight, includes_rooms, includes_food, food_description, includes_beverages,
        terms_conditions, is_active, amenity_ids
      } = req.body;
      
      const parseIntOrNull = (val) => val === '' || val === null || val === undefined ? null : parseInt(val, 10);
      const parseFloatOrNull = (val) => val === '' || val === null || val === undefined ? null : parseFloat(val);
      
      const plan = await prisma.venue_plans.create({
        data: {
          venue_id, name, plan_type, description: description || null,
          adult_price: parseFloatOrNull(adult_price),
          child_price: parseFloatOrNull(child_price),
          infant_max_age: parseIntOrNull(infant_max_age) ?? 2,
          child_max_age: parseIntOrNull(child_max_age) ?? 12,
          free_children_qty: parseIntOrNull(free_children_qty),
          free_children_max_age: parseIntOrNull(free_children_max_age),
          free_children_condition: free_children_condition || null,
          child_food_price: parseFloatOrNull(child_food_price),
          min_guests: parseIntOrNull(min_guests) ?? 1,
          max_capacity: parseIntOrNull(max_capacity),
          check_in_time: check_in_time || null,
          check_out_time: check_out_time || null,
          includes_overnight: includes_overnight || false,
          includes_rooms: includes_rooms || false,
          includes_food: includes_food || false,
          food_description: food_description || null,
          includes_beverages: includes_beverages || false,
          terms_conditions: terms_conditions || null,
          is_active: is_active !== false
        }
      });
      
      // Add amenities if provided
      if (amenity_ids && amenity_ids.length > 0) {
        await prisma.plan_amenities.createMany({
          data: amenity_ids.map(aid => ({
            plan_id: plan.id,
            amenity_id: typeof aid === 'object' ? aid.id : aid,
            quantity: typeof aid === 'object' ? aid.quantity : 1,
            notes: typeof aid === 'object' ? aid.notes : null
          }))
        });
      }
      
      res.status(201).json(plan);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/venue-plans/:id', isAuthenticated, async (req, res) => {
    try {
      const {
        name, plan_type, description,
        adult_price, child_price, infant_max_age, child_max_age,
        free_children_qty, free_children_max_age, free_children_condition, child_food_price,
        min_guests, max_capacity, check_in_time, check_out_time,
        includes_overnight, includes_rooms, includes_food, food_description, includes_beverages,
        terms_conditions, is_active, amenity_ids
      } = req.body;
      
      const parseIntOrNull = (val) => val === '' || val === null || val === undefined ? null : parseInt(val, 10);
      const parseFloatOrNull = (val) => val === '' || val === null || val === undefined ? null : parseFloat(val);
      
      const plan = await prisma.venue_plans.update({
        where: { id: req.params.id },
        data: {
          name, plan_type, description: description || null,
          adult_price: parseFloatOrNull(adult_price),
          child_price: parseFloatOrNull(child_price),
          infant_max_age: parseIntOrNull(infant_max_age) ?? 2,
          child_max_age: parseIntOrNull(child_max_age) ?? 12,
          free_children_qty: parseIntOrNull(free_children_qty),
          free_children_max_age: parseIntOrNull(free_children_max_age),
          free_children_condition: free_children_condition || null,
          child_food_price: parseFloatOrNull(child_food_price),
          min_guests: parseIntOrNull(min_guests) ?? 1,
          max_capacity: parseIntOrNull(max_capacity),
          check_in_time: check_in_time || null,
          check_out_time: check_out_time || null,
          includes_overnight: includes_overnight || false,
          includes_rooms: includes_rooms || false,
          includes_food: includes_food || false,
          food_description: food_description || null,
          includes_beverages: includes_beverages || false,
          terms_conditions: terms_conditions || null,
          is_active: is_active !== false
        }
      });
      
      // Update amenities if provided
      if (amenity_ids !== undefined) {
        await prisma.plan_amenities.deleteMany({ where: { plan_id: plan.id } });
        if (amenity_ids.length > 0) {
          await prisma.plan_amenities.createMany({
            data: amenity_ids.map(aid => ({
              plan_id: plan.id,
              amenity_id: typeof aid === 'object' ? aid.id : aid,
              quantity: typeof aid === 'object' ? aid.quantity : 1,
              notes: typeof aid === 'object' ? aid.notes : null
            }))
          });
        }
      }
      
      res.json(plan);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/venue-plans/:id', isAuthenticated, async (req, res) => {
    try {
      // Delete related data first
      await prisma.plan_amenities.deleteMany({ where: { plan_id: req.params.id } });
      await prisma.plan_images.deleteMany({ where: { plan_id: req.params.id } });
      await prisma.venue_plans.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Plan images
  app.post('/api/venue-plans/:id/images', isAuthenticated, async (req, res) => {
    try {
      const { image_url, is_cover } = req.body;
      
      // If setting as cover, unset other covers
      if (is_cover) {
        await prisma.plan_images.updateMany({
          where: { plan_id: req.params.id },
          data: { is_cover: false }
        });
      }
      
      const maxOrder = await prisma.plan_images.aggregate({
        where: { plan_id: req.params.id },
        _max: { sort_order: true }
      });
      
      const image = await prisma.plan_images.create({
        data: {
          plan_id: req.params.id,
          image_url,
          is_cover: is_cover || false,
          sort_order: (maxOrder._max.sort_order || 0) + 1
        }
      });
      res.status(201).json(image);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/plan-images/:id/cover', isAuthenticated, async (req, res) => {
    try {
      const image = await prisma.plan_images.findUnique({ where: { id: req.params.id } });
      if (!image) return res.status(404).json({ error: 'Imagen no encontrada' });
      
      await prisma.plan_images.updateMany({
        where: { plan_id: image.plan_id },
        data: { is_cover: false }
      });
      
      const updated = await prisma.plan_images.update({
        where: { id: req.params.id },
        data: { is_cover: true }
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/plan-images/:id', isAuthenticated, async (req, res) => {
    try {
      await prisma.plan_images.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // =====================
  // VENUE IMAGES
  // =====================
  app.get('/api/venues/:id/images', async (req, res) => {
    try {
      const images = await prisma.venue_images.findMany({
        where: { venue_id: req.params.id },
        orderBy: { sort_order: 'asc' }
      });
      res.json(images);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/venues/:id/images', isAuthenticated, async (req, res) => {
    try {
      const { image_url, is_cover } = req.body;
      
      if (is_cover) {
        await prisma.venue_images.updateMany({
          where: { venue_id: req.params.id },
          data: { is_cover: false }
        });
      }
      
      const maxOrder = await prisma.venue_images.aggregate({
        where: { venue_id: req.params.id },
        _max: { sort_order: true }
      });
      
      const image = await prisma.venue_images.create({
        data: {
          venue_id: req.params.id,
          image_url,
          is_cover: is_cover || false,
          sort_order: (maxOrder._max.sort_order || 0) + 1
        }
      });
      res.status(201).json(image);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/venue-images/:id/cover', isAuthenticated, async (req, res) => {
    try {
      const image = await prisma.venue_images.findUnique({ where: { id: req.params.id } });
      if (!image) return res.status(404).json({ error: 'Imagen no encontrada' });
      
      await prisma.venue_images.updateMany({
        where: { venue_id: image.venue_id },
        data: { is_cover: false }
      });
      
      const updated = await prisma.venue_images.update({
        where: { id: req.params.id },
        data: { is_cover: true }
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/venue-images/:id', isAuthenticated, async (req, res) => {
    try {
      await prisma.venue_images.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generic upload URL for plans/venues images
  app.post('/api/uploads/image-url', isAuthenticated, async (req, res) => {
    try {
      const { contentType, size, type } = req.body; // type: 'plan' or 'venue'
      
      if (!contentType || !ALLOWED_IMAGE_TYPES.includes(contentType)) {
        return res.status(400).json({ error: 'Solo se permiten imágenes (JPEG, PNG, GIF, WebP)' });
      }
      
      if (size && size > MAX_FILE_SIZE) {
        return res.status(400).json({ error: 'El archivo no puede superar 10MB' });
      }
      
      const privateObjectDir = process.env.PRIVATE_OBJECT_DIR || '';
      if (!privateObjectDir) {
        throw new Error('PRIVATE_OBJECT_DIR not set');
      }
      
      const objectId = randomUUID();
      const folder = type === 'venue' ? 'venues' : 'plans';
      const fullPath = `${privateObjectDir}/${folder}/${objectId}`;
      
      const pathParts = fullPath.startsWith('/') ? fullPath.slice(1).split('/') : fullPath.split('/');
      const bucketName = pathParts[0];
      const objectName = pathParts.slice(1).join('/');
      
      const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bucket_name: bucketName,
          object_name: objectName,
          method: 'PUT',
          expires_at: new Date(Date.now() + 900 * 1000).toISOString(),
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to sign object URL: ${response.status}`);
      }
      
      const { signed_url } = await response.json();
      res.json({ uploadURL: signed_url, objectPath: `/objects/${folder}/${objectId}` });
    } catch (error) {
      console.error('Error generating upload URL:', error);
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch(console.error);
