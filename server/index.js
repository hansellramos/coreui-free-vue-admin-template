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

  app.get('/objects/:type/:id', isAuthenticated, async (req, res) => {
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
      res.set({
        'Content-Type': metadata.contentType || 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      });
      
      file.createReadStream().pipe(res);
    } catch (error) {
      console.error('Error serving object:', error);
      res.status(500).json({ error: 'Failed to serve object' });
    }
  });

  app.get('/api/organizations', async (req, res) => {
    try {
      const accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
      
      const whereClause = accessibleOrgIds !== null 
        ? { id: { in: accessibleOrgIds } }
        : {};
      
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
      const accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
      
      const whereClause = accessibleOrgIds !== null
        ? { organization: { in: accessibleOrgIds } }
        : {};
      
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
      const accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
      
      let contacts;
      if (accessibleOrgIds !== null) {
        const contactOrgs = await prisma.contact_organization.findMany({
          where: { organization: { in: accessibleOrgIds } },
          select: { contact: true }
        });
        const contactIds = [...new Set(contactOrgs.map(co => co.contact))];
        contacts = await prisma.contacts.findMany({
          where: { id: { in: contactIds } },
          orderBy: { fullname: 'asc' }
        });
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
      const { from_date, venue_ids } = req.query;
      
      const accessibleVenueIds = await getAccessibleVenueIds(req.userPermissions);
      
      const whereClause = {};
      
      if (from_date) {
        whereClause.date = { gte: new Date(from_date) };
      }
      
      if (venue_ids) {
        const ids = venue_ids.split(',');
        if (accessibleVenueIds !== null) {
          const filteredIds = ids.filter(id => accessibleVenueIds.includes(id));
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
      const { accommodation_id } = req.query;
      const accessibleVenueIds = await getAccessibleVenueIds(req.userPermissions);
      
      let accessibleAccommodationIds = null;
      if (accessibleVenueIds !== null) {
        const accs = await prisma.accommodations.findMany({
          where: { venue: { in: accessibleVenueIds } },
          select: { id: true }
        });
        accessibleAccommodationIds = accs.map(a => a.id);
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
      const { type, accommodation, amount, payment_method, payment_date, reference, notes, receipt_url } = req.body;
      const data = {
        type: type || null,
        accommodation: accommodation || null,
        amount: amount ? parseFloat(amount) : null,
        payment_method: payment_method || null,
        reference: reference || null,
        notes: notes || null,
        receipt_url: receipt_url || null,
        created_by: req.user?.id || null
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
        updated_by: req.user?.id || null
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
      const data = {
        verified: verified === true,
        verified_at: verified === true ? new Date() : null,
        verified_by: verified === true ? (req.user?.id || null) : null,
        updated_at: new Date(),
        updated_by: req.user?.id || null
      };
      
      const payment = await prisma.payments.update({
        where: { id: req.params.id },
        data
      });
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
          locked_by: req.user.id
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
      if (!hasPermission(req.userPermissions, 'profiles:create')) {
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
      if (!hasPermission(req.userPermissions, 'profiles:edit')) {
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
      if (!hasPermission(req.userPermissions, 'profiles:delete')) {
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
      if (!hasPermission(req.userPermissions, 'users:edit')) {
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
      if (!hasPermission(req.userPermissions, 'users:edit')) {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch(console.error);
