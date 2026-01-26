const express = require('express');
const cors = require('cors');
const path = require('path');
const { Storage } = require('@google-cloud/storage');
const { randomUUID } = require('crypto');
const { prisma } = require('./db');
const { setupAuth, isAuthenticated } = require('./auth/replitAuth');
const { loadUserPermissions, hasPermission, getAccessibleOrganizationIds, getAccessibleVenueIds, requirePermission } = require('./auth/permissions');
const llmService = require('./llm-service');

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

// Seed default message templates
async function seedDefaultMessageTemplates() {
  const defaultTemplates = [
    {
      code: 'location',
      name: '¿Cómo llegar?',
      category: 'ubicacion',
      content: 'Proporciona instrucciones de cómo llegar al venue usando la información de dirección, enlaces de Waze y Google Maps disponibles.',
      is_system: true,
      venue_id: null,
      sort_order: 1
    },
    {
      code: 'wifi',
      name: 'Clave del WiFi',
      category: 'wifi',
      content: 'Proporciona la información del WiFi: nombre de red (SSID) y contraseña.',
      is_system: true,
      venue_id: null,
      sort_order: 2
    },
    {
      code: 'delivery',
      name: 'Domicilios cercanos',
      category: 'domicilios',
      content: 'Proporciona información sobre servicios de domicilios cercanos disponibles.',
      is_system: true,
      venue_id: null,
      sort_order: 3
    },
    {
      code: 'beer_delivery',
      name: 'Domicilios de cervezas',
      category: 'domicilios',
      content: 'Proporciona información sobre servicios de domicilios de cervezas disponibles.',
      is_system: true,
      venue_id: null,
      sort_order: 4
    },
    {
      code: 'plans',
      name: 'Información de planes',
      category: 'planes',
      content: 'Proporciona información detallada sobre los planes disponibles, precios, y qué incluyen.',
      is_system: true,
      venue_id: null,
      sort_order: 5
    },
    {
      code: 'general_info',
      name: 'Información general',
      category: 'general',
      content: 'Proporciona información general sobre el venue, horarios, servicios y amenidades.',
      is_system: true,
      venue_id: null,
      sort_order: 6
    }
  ];

  for (const template of defaultTemplates) {
    const existing = await prisma.message_templates.findFirst({
      where: { code: template.code, venue_id: null }
    });
    if (!existing) {
      await prisma.message_templates.create({ data: template });
      console.log(`Created default message template: ${template.code}`);
    }
  }
}

// Seed default LLM providers (without API keys)
async function seedDefaultLLMProviders() {
  const defaultProviders = [
    {
      code: 'deepseek',
      name: 'DeepSeek V3',
      base_url: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      is_active: true,
      is_default: false
    },
    {
      code: 'groq',
      name: 'Groq',
      base_url: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      is_active: true,
      is_default: false
    },
    {
      code: 'openai',
      name: 'OpenAI',
      base_url: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      is_active: true,
      is_default: true
    },
    {
      code: 'anthropic',
      name: 'Anthropic Claude',
      base_url: 'https://api.anthropic.com',
      model: 'claude-3-haiku-20240307',
      is_active: true,
      is_default: false
    }
  ];

  for (const provider of defaultProviders) {
    const existing = await prisma.llm_providers.findUnique({
      where: { code: provider.code }
    });
    if (!existing) {
      await prisma.llm_providers.create({ data: provider });
      console.log(`Created default LLM provider: ${provider.code}`);
    }
  }
}

async function startServer() {
  // Seed default data
  await seedDefaultMessageTemplates();
  await seedDefaultLLMProviders();
  
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
      const userId = String(req.user.claims?.sub);
      
      const organization = await prisma.organizations.create({
        data: req.body
      });
      
      // Associate the creating user with the new organization
      await prisma.user_organizations.create({
        data: {
          user_id: userId,
          organization_id: organization.id
        }
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

  app.get('/api/organizations/:id/users', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      const orgId = req.params.id;
      
      // Use same access control logic as /api/organizations
      let hasAccess = false;
      
      if (currentUser?.is_super_admin) {
        hasAccess = true;
      } else {
        // Get accessible organizations via permissions (same as org list endpoint)
        const accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions || []);
        if (accessibleOrgIds === null) {
          // null means access to all
          hasAccess = true;
        } else if (accessibleOrgIds.includes(orgId)) {
          hasAccess = true;
        }
      }
      
      if (!hasAccess) {
        return res.status(403).json({ error: 'No tiene acceso a esta organización' });
      }
      
      const userOrgs = await prisma.user_organizations.findMany({
        where: { organization_id: orgId }
      });
      
      const userIds = userOrgs.map(uo => uo.user_id);
      
      if (userIds.length === 0) {
        return res.json([]);
      }
      
      const users = await prisma.users.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          email: true,
          display_name: true,
          avatar_url: true
        }
      });
      
      res.json(users);
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

  // Venue Amenities
  app.get('/api/venues/:id/amenities', async (req, res) => {
    try {
      const venueAmenities = await prisma.venue_amenities.findMany({
        where: { venue_id: req.params.id }
      });
      const amenityIds = venueAmenities.map(va => va.amenity_id);
      const amenities = await prisma.amenities.findMany({
        where: { id: { in: amenityIds } }
      });
      res.json(amenities);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/venues/:id/amenities', isAuthenticated, async (req, res) => {
    try {
      const { amenity_ids } = req.body;
      const venueId = req.params.id;
      
      // Delete existing venue amenities
      await prisma.venue_amenities.deleteMany({
        where: { venue_id: venueId }
      });
      
      // Create new venue amenities
      if (amenity_ids && amenity_ids.length > 0) {
        await prisma.venue_amenities.createMany({
          data: amenity_ids.map(amenityId => ({
            venue_id: venueId,
            amenity_id: amenityId
          }))
        });
      }
      
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
      
      if (contact) {
        const contactOrg = await prisma.contact_organization.findFirst({
          where: { contact: contact.id }
        });
        contact.organizationId = contactOrg?.organization || null;
      }
      
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
      
      // Fetch payments for all accommodations
      const accommodationIds = accommodations.map(a => a.id);
      const payments = accommodationIds.length > 0 ? await prisma.payments.findMany({
        where: { accommodation: { in: accommodationIds } }
      }) : [];
      
      // Calculate total paid per accommodation
      const paymentsByAccommodation = {};
      payments.forEach(p => {
        if (p.accommodation) {
          if (!paymentsByAccommodation[p.accommodation]) {
            paymentsByAccommodation[p.accommodation] = 0;
          }
          paymentsByAccommodation[p.accommodation] += parseFloat(p.amount) || 0;
        }
      });
      
      // Enrich accommodations with related data
      const enriched = accommodations.map(a => {
        const agreedPrice = parseFloat(a.agreed_price) || parseFloat(a.calculated_price) || 0;
        const totalPaid = paymentsByAccommodation[a.id] || 0;
        return {
          ...a,
          venue_data: a.venue ? venuesMap[a.venue] : null,
          customer_data: a.customer ? customersMap[a.customer] : null,
          total_paid: totalPaid,
          pending_balance: agreedPrice - totalPaid
        };
      });
      
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
      const { venue, date, time, duration, customer, adults, children, plan_id, calculated_price, agreed_price } = req.body;
      const parseFloatOrNull = (val) => val === '' || val === null || val === undefined ? null : parseFloat(val);
      
      const data = {
        venue,
        duration: parseFloat(duration) || null,
        adults: parseInt(adults, 10) || 0,
        children: parseInt(children, 10) || 0,
        plan_id: plan_id || null,
        calculated_price: parseFloatOrNull(calculated_price),
        agreed_price: parseFloatOrNull(agreed_price)
      };
      
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
      
      const accommodation = await prisma.accommodations.create({ data });
      res.json(accommodation);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/accommodations/:id', isAuthenticated, async (req, res) => {
    try {
      const { venue, date, time, duration, customer, adults, children, plan_id, calculated_price, agreed_price } = req.body;
      const parseFloatOrNull = (val) => val === '' || val === null || val === undefined ? null : parseFloat(val);
      
      const data = {
        venue,
        duration: parseFloat(duration) || null,
        adults: parseInt(adults, 10) || 0,
        children: parseInt(children, 10) || 0,
        plan_id: plan_id || null,
        calculated_price: parseFloatOrNull(calculated_price),
        agreed_price: parseFloatOrNull(agreed_price)
      };
      
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

  // Weather cache to avoid excessive API calls (cache for 1 hour)
  const weatherCache = new Map();
  const WEATHER_CACHE_TTL = 60 * 60 * 1000; // 1 hour

  // Weather code to icon mapping for Open-Meteo (using CoreUI icon names)
  const weatherCodeToIcon = {
    0: { icon: 'cilSun', description: 'Despejado' },
    1: { icon: 'cilSun', description: 'Mayormente despejado' },
    2: { icon: 'cilCloud', description: 'Parcialmente nublado' },
    3: { icon: 'cilCloud', description: 'Nublado' },
    45: { icon: 'cilCloud', description: 'Niebla' },
    48: { icon: 'cilCloud', description: 'Niebla con escarcha' },
    51: { icon: 'cilDrop', description: 'Llovizna ligera' },
    53: { icon: 'cilDrop', description: 'Llovizna moderada' },
    55: { icon: 'cilDrop', description: 'Llovizna intensa' },
    61: { icon: 'cilDrop', description: 'Lluvia ligera' },
    63: { icon: 'cilDrop', description: 'Lluvia moderada' },
    65: { icon: 'cilDrop', description: 'Lluvia intensa' },
    71: { icon: 'cilCloudDownload', description: 'Nieve ligera' },
    73: { icon: 'cilCloudDownload', description: 'Nieve moderada' },
    75: { icon: 'cilCloudDownload', description: 'Nieve intensa' },
    80: { icon: 'cilDrop', description: 'Chubascos ligeros' },
    81: { icon: 'cilDrop', description: 'Chubascos moderados' },
    82: { icon: 'cilDrop', description: 'Chubascos intensos' },
    95: { icon: 'cilBolt', description: 'Tormenta' },
    96: { icon: 'cilBolt', description: 'Tormenta con granizo' },
    99: { icon: 'cilBolt', description: 'Tormenta fuerte con granizo' }
  };

  app.get('/api/weather', async (req, res) => {
    try {
      const { lat, lon, date } = req.query;
      
      if (!lat || !lon) {
        return res.status(400).json({ error: 'Latitude and longitude are required' });
      }

      const latitude = parseFloat(lat);
      const longitude = parseFloat(lon);
      
      if (isNaN(latitude) || isNaN(longitude)) {
        return res.status(400).json({ error: 'Invalid coordinates' });
      }

      // Create cache key based on coordinates (rounded to 2 decimals) and date
      const cacheKey = `${latitude.toFixed(2)}_${longitude.toFixed(2)}_${date || 'current'}`;
      const cached = weatherCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < WEATHER_CACHE_TTL) {
        return res.json(cached.data);
      }

      // Call Open-Meteo API
      const forecastDays = date ? 16 : 7;
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=${forecastDays}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch weather data');
      }
      
      const data = await response.json();
      
      // Process weather data
      const forecasts = [];
      if (data.daily && data.daily.time) {
        for (let i = 0; i < data.daily.time.length; i++) {
          const weatherCode = data.daily.weather_code[i];
          const weatherInfo = weatherCodeToIcon[weatherCode] || { icon: 'cil-cloudy', description: 'Desconocido' };
          
          forecasts.push({
            date: data.daily.time[i],
            temp_max: Math.round(data.daily.temperature_2m_max[i]),
            temp_min: Math.round(data.daily.temperature_2m_min[i]),
            icon: weatherInfo.icon,
            description: weatherInfo.description
          });
        }
      }

      // If specific date requested, find that date's forecast
      let result;
      if (date) {
        const targetDate = date.split('T')[0];
        const dayForecast = forecasts.find(f => f.date === targetDate);
        result = dayForecast || null;
      } else {
        result = { forecasts };
      }

      // Cache the result
      weatherCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      res.json(result);
    } catch (error) {
      console.error('Weather API error:', error);
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

  // Availability check endpoint - returns venues with plans and their availability status
  app.get('/api/availability', async (req, res) => {
    try {
      const { check_in, check_out, adults, children, amenities } = req.query;
      
      if (!check_in) {
        return res.status(400).json({ error: 'check_in es requerido' });
      }
      
      const checkInDate = new Date(check_in);
      // For pasadia, check_out can be same as check_in or null
      const checkOutDate = check_out ? new Date(check_out) : checkInDate;
      
      // Validate date range
      if (checkOutDate < checkInDate) {
        return res.status(400).json({ error: 'La fecha de salida debe ser posterior a la fecha de entrada' });
      }
      
      const numAdults = parseInt(adults) || 1;
      const numChildren = parseInt(children) || 0;
      const totalGuests = numAdults + numChildren;
      
      // Parse amenity filter
      const requiredAmenityIds = amenities ? amenities.split(',').filter(Boolean) : [];
      
      // Get all venues that have active plans
      const venuesWithPlans = await prisma.venues.findMany({
        where: {
          venue_plans: {
            some: {
              is_active: true
            }
          }
        },
        include: {
          venue_plans: {
            where: { is_active: true },
            orderBy: { name: 'asc' }
          }
        }
      });
      
      // Get organization data for each venue
      const orgIds = [...new Set(venuesWithPlans.filter(v => v.organization).map(v => v.organization))];
      const organizations = orgIds.length > 0 ? await prisma.organizations.findMany({
        where: { id: { in: orgIds } }
      }) : [];
      const orgMap = {};
      organizations.forEach(o => { orgMap[o.id] = o; });
      
      // Get venue amenities for all venues
      const venueIds = venuesWithPlans.map(v => v.id);
      const venueAmenities = await prisma.venue_amenities.findMany({
        where: { venue_id: { in: venueIds } }
      });
      const allAmenityIds = [...new Set(venueAmenities.map(va => va.amenity_id))];
      const amenitiesData = allAmenityIds.length > 0 ? await prisma.amenities.findMany({
        where: { id: { in: allAmenityIds } }
      }) : [];
      const amenityMap = {};
      amenitiesData.forEach(a => { amenityMap[a.id] = a; });
      
      // Build venue amenities map
      const venueAmenitiesMap = {};
      venueAmenities.forEach(va => {
        if (!venueAmenitiesMap[va.venue_id]) {
          venueAmenitiesMap[va.venue_id] = [];
        }
        if (amenityMap[va.amenity_id]) {
          venueAmenitiesMap[va.venue_id].push(amenityMap[va.amenity_id]);
        }
      });
      
      // Check for existing accommodations in the date range for each venue
      
      // Get all accommodations for these venues
      const existingAccommodations = await prisma.accommodations.findMany({
        where: {
          venue: { in: venueIds }
        }
      });
      
      // Calculate accommodation end dates and check for overlaps
      const busyVenueIds = new Set();
      existingAccommodations.forEach(acc => {
        const accDate = new Date(acc.date);
        // Duration is stored in seconds, default to 12 hours (pasadia) if missing
        const durationSeconds = parseInt(acc.duration) || 43200;
        const accEndDate = new Date(accDate.getTime() + durationSeconds * 1000);
        
        // Normalize dates to day boundaries for comparison
        const accStartDay = new Date(accDate.getUTCFullYear(), accDate.getUTCMonth(), accDate.getUTCDate());
        const accEndDay = new Date(accEndDate.getUTCFullYear(), accEndDate.getUTCMonth(), accEndDate.getUTCDate());
        const checkInDay = new Date(checkInDate.getUTCFullYear(), checkInDate.getUTCMonth(), checkInDate.getUTCDate());
        const checkOutDay = new Date(checkOutDate.getUTCFullYear(), checkOutDate.getUTCMonth(), checkOutDate.getUTCDate());
        
        // Check if this accommodation overlaps with requested dates
        // Overlap condition: accStart <= checkOut AND accEnd >= checkIn
        if (accStartDay <= checkOutDay && accEndDay >= checkInDay) {
          busyVenueIds.add(acc.venue);
        }
      });
      
      // Build result with availability info
      let result = venuesWithPlans.map(venue => {
        const plans = venue.venue_plans || [];
        const venueAmenityList = venueAmenitiesMap[venue.id] || [];
        
        // Check each plan for guest suitability
        const plansWithSuitability = plans.map(p => {
          const planMin = p.min_guests || 1;
          const planMax = p.max_capacity || 999;
          const isSuitable = totalGuests >= planMin && totalGuests <= planMax;
          return {
            id: p.id,
            name: p.name,
            plan_type: p.plan_type,
            adult_price: p.adult_price,
            child_price: p.child_price,
            min_guests: p.min_guests,
            max_capacity: p.max_capacity,
            is_suitable: isSuitable
          };
        });
        
        // Venue has a matching plan if at least one plan is suitable
        const hasMatchingPlan = plansWithSuitability.some(p => p.is_suitable);
        const minGuests = Math.min(...plans.map(p => p.min_guests || 1));
        const maxCapacity = Math.max(...plans.map(p => p.max_capacity || 999));
        
        return {
          id: venue.id,
          name: venue.name,
          organization: venue.organization,
          organization_name: orgMap[venue.organization]?.name || null,
          is_available: !busyVenueIds.has(venue.id),
          has_matching_plan: hasMatchingPlan,
          min_guests: minGuests,
          max_capacity: maxCapacity === 999 ? null : maxCapacity,
          plans_count: plans.length,
          plans: plansWithSuitability,
          amenities: venueAmenityList
        };
      });
      
      // Filter by required amenities
      if (requiredAmenityIds.length > 0) {
        result = result.filter(venue => {
          const venueAmenityIdSet = new Set(venue.amenities.map(a => a.id));
          return requiredAmenityIds.every(reqId => venueAmenityIdSet.has(reqId));
        });
      }
      
      // Sort: available first, then has matching plan, then by name
      result.sort((a, b) => {
        if (a.is_available !== b.is_available) return b.is_available - a.is_available;
        if (a.has_matching_plan !== b.has_matching_plan) return b.has_matching_plan - a.has_matching_plan;
        return a.name.localeCompare(b.name);
      });
      
      res.json(result);
    } catch (error) {
      console.error('Availability error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // =====================
  // SUBSCRIPTIONS CRUD
  // =====================
  
  // List all subscriptions (admin only)
  app.get('/api/subscriptions', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      
      if (!currentUser?.is_super_admin && !hasPermission(req.userPermissions || [], 'subscription:manage')) {
        return res.status(403).json({ error: 'No tiene permiso para ver suscripciones' });
      }
      
      const subscriptions = await prisma.subscriptions.findMany({
        include: {
          subscription_users: {
            include: {
              // Can't include users directly, will fetch separately
            }
          }
        },
        orderBy: { created_at: 'desc' }
      });
      
      res.json(subscriptions);
    } catch (error) {
      console.error('Subscriptions error:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get single subscription
  app.get('/api/subscriptions/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      
      // Check if user is admin or member of subscription
      const isMember = await prisma.subscription_users.findFirst({
        where: { subscription_id: req.params.id, user_id: userId }
      });
      
      if (!currentUser?.is_super_admin && !hasPermission(req.userPermissions || [], 'subscription:manage') && !isMember) {
        return res.status(403).json({ error: 'No tiene acceso a esta suscripción' });
      }
      
      const subscription = await prisma.subscriptions.findUnique({
        where: { id: req.params.id },
        include: {
          subscription_users: true
        }
      });
      
      if (!subscription) {
        return res.status(404).json({ error: 'Suscripción no encontrada' });
      }
      
      // Get user details for each subscription user
      const userIds = subscription.subscription_users.map(su => su.user_id);
      const users = await prisma.users.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, display_name: true, avatar_url: true }
      });
      
      const usersMap = Object.fromEntries(users.map(u => [u.id, u]));
      const subscriptionWithUsers = {
        ...subscription,
        subscription_users: subscription.subscription_users.map(su => ({
          ...su,
          user: usersMap[su.user_id] || null
        }))
      };
      
      res.json(subscriptionWithUsers);
    } catch (error) {
      console.error('Subscription error:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Create subscription (super admin only)
  app.post('/api/subscriptions', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      
      if (!currentUser?.is_super_admin) {
        return res.status(403).json({ error: 'Solo los super administradores pueden crear suscripciones' });
      }
      
      const { name, description, plan_type, max_users, max_organizations, owner_user_id } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: 'El nombre es requerido' });
      }
      
      const subscription = await prisma.subscriptions.create({
        data: {
          name,
          description,
          plan_type: plan_type || 'free',
          max_users: max_users || 5,
          max_organizations: max_organizations || 1,
          is_active: true
        }
      });
      
      // If owner specified, add them as owner
      if (owner_user_id) {
        await prisma.subscription_users.create({
          data: {
            subscription_id: subscription.id,
            user_id: owner_user_id,
            role: 'owner',
            is_owner: true,
            added_by: userId
          }
        });
      }
      
      res.json(subscription);
    } catch (error) {
      console.error('Create subscription error:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Update subscription
  app.put('/api/subscriptions/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      
      // Check if user is super admin or owner of subscription
      const isOwner = await prisma.subscription_users.findFirst({
        where: { subscription_id: req.params.id, user_id: userId, is_owner: true }
      });
      
      if (!currentUser?.is_super_admin && !isOwner) {
        return res.status(403).json({ error: 'No tiene permiso para modificar esta suscripción' });
      }
      
      const { name, description, plan_type, max_users, max_organizations, is_active } = req.body;
      
      const subscription = await prisma.subscriptions.update({
        where: { id: req.params.id },
        data: {
          name,
          description,
          plan_type,
          max_users,
          max_organizations,
          is_active
        }
      });
      
      res.json(subscription);
    } catch (error) {
      console.error('Update subscription error:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Delete subscription (super admin only)
  app.delete('/api/subscriptions/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      
      if (!currentUser?.is_super_admin) {
        return res.status(403).json({ error: 'Solo los super administradores pueden eliminar suscripciones' });
      }
      
      // Check if subscription has users
      const userCount = await prisma.subscription_users.count({
        where: { subscription_id: req.params.id }
      });
      
      if (userCount > 0) {
        return res.status(400).json({ error: `No se puede eliminar la suscripción porque tiene ${userCount} usuario(s) asignado(s)` });
      }
      
      await prisma.subscriptions.delete({
        where: { id: req.params.id }
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error('Delete subscription error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Add user to subscription
  app.post('/api/subscriptions/:id/users', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      
      // Check if user is owner of subscription or has permission
      const isOwner = await prisma.subscription_users.findFirst({
        where: { subscription_id: req.params.id, user_id: userId, is_owner: true }
      });
      
      if (!currentUser?.is_super_admin && !hasPermission(req.userPermissions || [], 'subscription:manage') && !isOwner) {
        return res.status(403).json({ error: 'No tiene permiso para agregar usuarios a esta suscripción' });
      }
      
      const { user_id, role = 'member' } = req.body;
      
      // Check if user exists
      const targetUser = await prisma.users.findUnique({ where: { id: user_id } });
      if (!targetUser) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      
      // Check subscription limits
      const subscription = await prisma.subscriptions.findUnique({
        where: { id: req.params.id },
        include: { subscription_users: true }
      });
      
      if (!subscription) {
        return res.status(404).json({ error: 'Suscripción no encontrada' });
      }
      
      if (subscription.subscription_users.length >= subscription.max_users) {
        return res.status(400).json({ error: `La suscripción ya tiene el máximo de usuarios permitidos (${subscription.max_users})` });
      }
      
      const subscriptionUser = await prisma.subscription_users.create({
        data: {
          subscription_id: req.params.id,
          user_id,
          role,
          is_owner: false,
          added_by: userId
        }
      });
      
      res.json(subscriptionUser);
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(400).json({ error: 'El usuario ya está en esta suscripción' });
      }
      console.error('Add subscription user error:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Remove user from subscription
  app.delete('/api/subscriptions/:id/users/:userId', isAuthenticated, async (req, res) => {
    try {
      const currentUserId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: currentUserId } });
      
      // Check if user is owner of subscription or has permission
      const isOwner = await prisma.subscription_users.findFirst({
        where: { subscription_id: req.params.id, user_id: currentUserId, is_owner: true }
      });
      
      if (!currentUser?.is_super_admin && !hasPermission(req.userPermissions || [], 'subscription:manage') && !isOwner) {
        return res.status(403).json({ error: 'No tiene permiso para remover usuarios de esta suscripción' });
      }
      
      // Cannot remove owner
      const targetMembership = await prisma.subscription_users.findFirst({
        where: { subscription_id: req.params.id, user_id: req.params.userId }
      });
      
      if (!targetMembership) {
        return res.status(404).json({ error: 'Usuario no encontrado en esta suscripción' });
      }
      
      if (targetMembership.is_owner) {
        return res.status(400).json({ error: 'No se puede remover al propietario de la suscripción' });
      }
      
      await prisma.subscription_users.delete({
        where: { id: targetMembership.id }
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error('Remove subscription user error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Expense Categories API
  app.get('/api/expense-categories', async (req, res) => {
    try {
      const categories = await prisma.expense_categories.findMany({
        where: { is_active: true },
        orderBy: { name: 'asc' }
      });
      res.json(categories);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/expense-categories/:id', async (req, res) => {
    try {
      const category = await prisma.expense_categories.findUnique({
        where: { id: req.params.id }
      });
      res.json(category);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/expense-categories', isAuthenticated, async (req, res) => {
    try {
      const category = await prisma.expense_categories.create({
        data: req.body
      });
      res.json(category);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/expense-categories/:id', isAuthenticated, async (req, res) => {
    try {
      const existing = await prisma.expense_categories.findUnique({
        where: { id: req.params.id }
      });
      if (existing?.is_system) {
        return res.status(403).json({ error: 'No se pueden modificar categorías del sistema' });
      }
      const category = await prisma.expense_categories.update({
        where: { id: req.params.id },
        data: req.body
      });
      res.json(category);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/expense-categories/:id', isAuthenticated, async (req, res) => {
    try {
      const existing = await prisma.expense_categories.findUnique({
        where: { id: req.params.id }
      });
      if (existing?.is_system) {
        return res.status(403).json({ error: 'No se pueden eliminar categorías del sistema' });
      }
      await prisma.expense_categories.delete({
        where: { id: req.params.id }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Expenses API
  app.get('/api/expenses', isAuthenticated, async (req, res) => {
    try {
      const { venue_id, organization_id, category_id, from_date, to_date, viewAll } = req.query;
      const viewAllFlag = viewAll === 'true';
      
      let accessibleOrgIds = null;
      
      if (req.user) {
        const userId = String(req.user.claims?.sub);
        const currentUser = await prisma.users.findUnique({ where: { id: userId } });
        
        if (viewAllFlag && currentUser?.is_super_admin) {
          accessibleOrgIds = null;
        } else if (currentUser?.is_super_admin) {
          const userOrgs = await prisma.user_organizations.findMany({
            where: { user_id: userId }
          });
          accessibleOrgIds = userOrgs.map(uo => uo.organization_id);
        } else {
          accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
        }
      } else {
        accessibleOrgIds = [];
      }
      
      const whereClause = {};
      
      if (accessibleOrgIds !== null) {
        if (accessibleOrgIds.length === 0) {
          return res.json([]);
        }
        whereClause.organization_id = { in: accessibleOrgIds };
      }
      
      if (venue_id) whereClause.venue_id = venue_id;
      if (organization_id) whereClause.organization_id = organization_id;
      if (category_id) whereClause.category_id = category_id;
      
      if (from_date || to_date) {
        whereClause.expense_date = {};
        if (from_date) whereClause.expense_date.gte = new Date(from_date);
        if (to_date) whereClause.expense_date.lte = new Date(to_date);
      }
      
      const expenses = await prisma.expenses.findMany({
        where: whereClause,
        include: { category: true },
        orderBy: { expense_date: 'desc' }
      });
      
      // Enrich with venue and organization data
      const venueIds = [...new Set(expenses.filter(e => e.venue_id).map(e => e.venue_id))];
      const orgIds = [...new Set(expenses.filter(e => e.organization_id).map(e => e.organization_id))];
      
      const venues = venueIds.length > 0 ? await prisma.venues.findMany({
        where: { id: { in: venueIds } }
      }) : [];
      const organizations = orgIds.length > 0 ? await prisma.organizations.findMany({
        where: { id: { in: orgIds } }
      }) : [];
      
      const venuesMap = {};
      venues.forEach(v => { venuesMap[v.id] = v; });
      const orgsMap = {};
      organizations.forEach(o => { orgsMap[o.id] = o; });
      
      const enriched = expenses.map(e => ({
        ...e,
        venue_data: e.venue_id ? venuesMap[e.venue_id] : null,
        organization_data: e.organization_id ? orgsMap[e.organization_id] : null
      }));
      
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/expenses/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      
      const expense = await prisma.expenses.findUnique({
        where: { id: req.params.id },
        include: { category: true }
      });
      
      if (!expense) {
        return res.status(404).json({ error: 'Gasto no encontrado' });
      }
      
      // Check access to this expense's organization
      if (!currentUser?.is_super_admin) {
        const accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
        if (accessibleOrgIds !== null && expense.organization_id && !accessibleOrgIds.includes(expense.organization_id)) {
          return res.status(403).json({ error: 'No tiene acceso a este gasto' });
        }
      }
      
      res.json(expense);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/expenses', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      
      // Verify user has access to the organization
      if (!currentUser?.is_super_admin && req.body.organization_id) {
        const accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
        if (accessibleOrgIds !== null && !accessibleOrgIds.includes(req.body.organization_id)) {
          return res.status(403).json({ error: 'No tiene acceso a esta organización' });
        }
      }
      
      const expense = await prisma.expenses.create({
        data: {
          ...req.body,
          expense_date: new Date(req.body.expense_date),
          created_by: userId
        }
      });
      res.json(expense);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/expenses/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      
      // Check access to the existing expense
      const existing = await prisma.expenses.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        return res.status(404).json({ error: 'Gasto no encontrado' });
      }
      
      if (!currentUser?.is_super_admin) {
        const accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
        if (accessibleOrgIds !== null && existing.organization_id && !accessibleOrgIds.includes(existing.organization_id)) {
          return res.status(403).json({ error: 'No tiene acceso a este gasto' });
        }
      }
      
      const updateData = { ...req.body, updated_at: new Date(), updated_by: userId };
      if (req.body.expense_date) {
        updateData.expense_date = new Date(req.body.expense_date);
      }
      const expense = await prisma.expenses.update({
        where: { id: req.params.id },
        data: updateData
      });
      res.json(expense);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/expenses/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      
      // Check access to the expense
      const existing = await prisma.expenses.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        return res.status(404).json({ error: 'Gasto no encontrado' });
      }
      
      if (!currentUser?.is_super_admin) {
        const accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
        if (accessibleOrgIds !== null && existing.organization_id && !accessibleOrgIds.includes(existing.organization_id)) {
          return res.status(403).json({ error: 'No tiene acceso a este gasto' });
        }
      }
      
      await prisma.expenses.delete({
        where: { id: req.params.id }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Deposits API
  app.get('/api/deposits', isAuthenticated, async (req, res) => {
    try {
      const { accommodation_id, venue_id, status, viewAll } = req.query;
      const viewAllFlag = viewAll === 'true';
      
      let accessibleOrgIds = null;
      
      if (req.user) {
        const userId = String(req.user.claims?.sub);
        const currentUser = await prisma.users.findUnique({ where: { id: userId } });
        
        if (viewAllFlag && currentUser?.is_super_admin) {
          accessibleOrgIds = null;
        } else if (currentUser?.is_super_admin) {
          const userOrgs = await prisma.user_organizations.findMany({
            where: { user_id: userId }
          });
          accessibleOrgIds = userOrgs.map(uo => uo.organization_id);
        } else {
          accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
        }
      } else {
        accessibleOrgIds = [];
      }
      
      const whereClause = {};
      
      if (accessibleOrgIds !== null) {
        if (accessibleOrgIds.length === 0) {
          return res.json([]);
        }
        whereClause.organization_id = { in: accessibleOrgIds };
      }
      
      if (accommodation_id) whereClause.accommodation_id = accommodation_id;
      if (venue_id) whereClause.venue_id = venue_id;
      if (status) whereClause.status = status;
      
      const deposits = await prisma.deposits.findMany({
        where: whereClause,
        include: { evidence: true },
        orderBy: { created_at: 'desc' }
      });
      
      // Enrich with accommodation and venue data
      const accommodationIds = [...new Set(deposits.map(d => d.accommodation_id))];
      const venueIds = [...new Set(deposits.filter(d => d.venue_id).map(d => d.venue_id))];
      
      const accommodations = accommodationIds.length > 0 ? await prisma.accommodations.findMany({
        where: { id: { in: accommodationIds } }
      }) : [];
      const venues = venueIds.length > 0 ? await prisma.venues.findMany({
        where: { id: { in: venueIds } }
      }) : [];
      
      const accommodationsMap = {};
      accommodations.forEach(a => { accommodationsMap[a.id] = a; });
      const venuesMap = {};
      venues.forEach(v => { venuesMap[v.id] = v; });
      
      // Get customer data for accommodations
      const customerIds = [...new Set(accommodations.filter(a => a.customer).map(a => a.customer))];
      const customers = customerIds.length > 0 ? await prisma.contacts.findMany({
        where: { id: { in: customerIds } }
      }) : [];
      const customersMap = {};
      customers.forEach(c => { customersMap[c.id] = c; });
      
      const enriched = deposits.map(d => {
        const accommodation = accommodationsMap[d.accommodation_id];
        return {
          ...d,
          accommodation_data: accommodation ? {
            ...accommodation,
            customer_data: accommodation.customer ? customersMap[accommodation.customer] : null
          } : null,
          venue_data: d.venue_id ? venuesMap[d.venue_id] : null
        };
      });
      
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/deposits/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      
      const deposit = await prisma.deposits.findUnique({
        where: { id: req.params.id },
        include: { evidence: { orderBy: { sort_order: 'asc' } } }
      });
      
      if (!deposit) {
        return res.status(404).json({ error: 'Depósito no encontrado' });
      }
      
      // Check access to this deposit's organization
      if (!currentUser?.is_super_admin) {
        const accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
        if (accessibleOrgIds !== null && deposit.organization_id && !accessibleOrgIds.includes(deposit.organization_id)) {
          return res.status(403).json({ error: 'No tiene acceso a este depósito' });
        }
      }
      
      const accommodation = await prisma.accommodations.findUnique({
        where: { id: deposit.accommodation_id }
      });
      let customer = null;
      if (accommodation?.customer) {
        customer = await prisma.contacts.findUnique({
          where: { id: accommodation.customer }
        });
      }
      let venue = null;
      if (deposit.venue_id) {
        venue = await prisma.venues.findUnique({
          where: { id: deposit.venue_id }
        });
      }
      deposit.accommodation_data = accommodation ? { ...accommodation, customer_data: customer } : null;
      deposit.venue_data = venue;
      
      res.json(deposit);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/deposits', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      const { evidence, ...depositData } = req.body;
      
      // Verify user has access to the organization
      if (!currentUser?.is_super_admin && depositData.organization_id) {
        const accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
        if (accessibleOrgIds !== null && !accessibleOrgIds.includes(depositData.organization_id)) {
          return res.status(403).json({ error: 'No tiene acceso a esta organización' });
        }
      }
      
      const deposit = await prisma.deposits.create({
        data: {
          ...depositData,
          payment_date: depositData.payment_date ? new Date(depositData.payment_date) : null,
          created_by: userId
        }
      });
      
      if (evidence && evidence.length > 0) {
        await prisma.deposit_evidence.createMany({
          data: evidence.map((e, i) => ({
            deposit_id: deposit.id,
            image_url: e.image_url,
            type: e.type,
            description: e.description,
            sort_order: i
          }))
        });
      }
      
      const created = await prisma.deposits.findUnique({
        where: { id: deposit.id },
        include: { evidence: true }
      });
      
      res.json(created);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/deposits/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      const { evidence, ...depositData } = req.body;
      
      // Check access to the existing deposit
      const existing = await prisma.deposits.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        return res.status(404).json({ error: 'Depósito no encontrado' });
      }
      
      if (!currentUser?.is_super_admin) {
        const accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
        if (accessibleOrgIds !== null && existing.organization_id && !accessibleOrgIds.includes(existing.organization_id)) {
          return res.status(403).json({ error: 'No tiene acceso a este depósito' });
        }
      }
      
      const updateData = {
        ...depositData,
        updated_at: new Date(),
        updated_by: userId
      };
      if (depositData.payment_date) updateData.payment_date = new Date(depositData.payment_date);
      if (depositData.refund_date) updateData.refund_date = new Date(depositData.refund_date);
      
      const deposit = await prisma.deposits.update({
        where: { id: req.params.id },
        data: updateData
      });
      
      if (evidence !== undefined) {
        await prisma.deposit_evidence.deleteMany({
          where: { deposit_id: req.params.id }
        });
        if (evidence.length > 0) {
          await prisma.deposit_evidence.createMany({
            data: evidence.map((e, i) => ({
              deposit_id: req.params.id,
              image_url: e.image_url,
              type: e.type,
              description: e.description,
              sort_order: i
            }))
          });
        }
      }
      
      const updated = await prisma.deposits.findUnique({
        where: { id: req.params.id },
        include: { evidence: true }
      });
      
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/deposits/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      
      // Check access to the deposit
      const existing = await prisma.deposits.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        return res.status(404).json({ error: 'Depósito no encontrado' });
      }
      
      if (!currentUser?.is_super_admin) {
        const accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
        if (accessibleOrgIds !== null && existing.organization_id && !accessibleOrgIds.includes(existing.organization_id)) {
          return res.status(403).json({ error: 'No tiene acceso a este depósito' });
        }
      }
      
      await prisma.deposits.delete({
        where: { id: req.params.id }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Deposit status update (refund/claim damage)
  app.put('/api/deposits/:id/status', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      const { status, refund_amount, refund_date, refund_reference, damage_amount, damage_notes } = req.body;
      
      // Check access to the deposit
      const existing = await prisma.deposits.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        return res.status(404).json({ error: 'Depósito no encontrado' });
      }
      
      if (!currentUser?.is_super_admin) {
        const accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
        if (accessibleOrgIds !== null && existing.organization_id && !accessibleOrgIds.includes(existing.organization_id)) {
          return res.status(403).json({ error: 'No tiene acceso a este depósito' });
        }
      }
      
      const updateData = {
        status,
        updated_at: new Date(),
        updated_by: userId
      };
      
      if (status === 'refunded') {
        updateData.refund_amount = refund_amount;
        updateData.refund_date = refund_date ? new Date(refund_date) : new Date();
        updateData.refund_reference = refund_reference;
      } else if (status === 'claimed') {
        updateData.damage_amount = damage_amount;
        updateData.damage_notes = damage_notes;
      }
      
      const deposit = await prisma.deposits.update({
        where: { id: req.params.id },
        data: updateData,
        include: { evidence: true }
      });
      
      res.json(deposit);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Estimates CRUD
  app.get('/api/estimates', isAuthenticated, async (req, res) => {
    try {
      const { venue_id, status } = req.query;
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      
      const where = {};
      if (venue_id) where.venue_id = venue_id;
      if (status) where.status = status;
      
      if (!currentUser?.is_super_admin) {
        const accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
        if (accessibleOrgIds !== null) {
          const accessibleVenues = await prisma.venues.findMany({
            where: { organization: { in: accessibleOrgIds } },
            select: { id: true }
          });
          where.venue_id = { in: accessibleVenues.map(v => v.id) };
        }
      }
      
      const estimates = await prisma.estimates.findMany({
        where,
        orderBy: { created_at: 'desc' }
      });
      
      const venueIds = [...new Set(estimates.map(e => e.venue_id))];
      const planIds = [...new Set(estimates.filter(e => e.plan_id).map(e => e.plan_id))];
      
      const venues = venueIds.length > 0 ? await prisma.venues.findMany({
        where: { id: { in: venueIds } }
      }) : [];
      const venueMap = {};
      venues.forEach(v => { venueMap[v.id] = v; });
      
      const plans = planIds.length > 0 ? await prisma.venue_plans.findMany({
        where: { id: { in: planIds } }
      }) : [];
      const planMap = {};
      plans.forEach(p => { planMap[p.id] = p; });
      
      const enriched = estimates.map(e => ({
        ...e,
        venue: venueMap[e.venue_id] || null,
        plan: e.plan_id ? (planMap[e.plan_id] || null) : null
      }));
      
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/estimates/:id', isAuthenticated, async (req, res) => {
    try {
      const estimate = await prisma.estimates.findUnique({
        where: { id: req.params.id }
      });
      
      if (!estimate) {
        return res.status(404).json({ error: 'Cotización no encontrada' });
      }
      
      const venue = await prisma.venues.findUnique({ where: { id: estimate.venue_id } });
      const plan = estimate.plan_id ? await prisma.venue_plans.findUnique({ where: { id: estimate.plan_id } }) : null;
      
      res.json({ ...estimate, venue, plan });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/estimates', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const { venue_id, plan_id, customer_name, contact_type, contact_value, check_in, check_out, adults, children, calculated_price, notes, conversation_id } = req.body;
      
      if (!venue_id || !contact_type || !contact_value) {
        return res.status(400).json({ error: 'venue_id, contact_type y contact_value son requeridos' });
      }
      
      const estimate = await prisma.estimates.create({
        data: {
          venue_id,
          plan_id,
          customer_name,
          contact_type,
          contact_value,
          check_in: check_in ? new Date(check_in) : null,
          check_out: check_out ? new Date(check_out) : null,
          adults: adults || 0,
          children: children || 0,
          calculated_price,
          notes,
          conversation_id,
          status: 'pending',
          created_by: userId
        }
      });
      
      res.status(201).json(estimate);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/estimates/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const { plan_id, customer_name, contact_type, contact_value, check_in, check_out, adults, children, calculated_price, notes, status } = req.body;
      
      const existing = await prisma.estimates.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        return res.status(404).json({ error: 'Cotización no encontrada' });
      }
      
      const estimate = await prisma.estimates.update({
        where: { id: req.params.id },
        data: {
          plan_id,
          customer_name,
          contact_type,
          contact_value,
          check_in: check_in ? new Date(check_in) : existing.check_in,
          check_out: check_out ? new Date(check_out) : existing.check_out,
          adults: adults !== undefined ? adults : existing.adults,
          children: children !== undefined ? children : existing.children,
          calculated_price,
          notes,
          status,
          updated_at: new Date()
        }
      });
      
      res.json(estimate);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/estimates/:id', isAuthenticated, async (req, res) => {
    try {
      await prisma.estimates.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/estimates/:id/convert', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const estimate = await prisma.estimates.findUnique({ where: { id: req.params.id } });
      
      if (!estimate) {
        return res.status(404).json({ error: 'Cotización no encontrada' });
      }
      
      if (estimate.status === 'converted') {
        return res.status(400).json({ error: 'Esta cotización ya fue convertida' });
      }
      
      let customerId = null;
      if (estimate.customer_name || estimate.contact_value) {
        const existingContact = await prisma.contacts.findFirst({
          where: { 
            OR: [
              { whatsapp: estimate.contact_type === 'whatsapp' ? parseFloat(estimate.contact_value) : undefined },
              { fullname: estimate.customer_name }
            ].filter(c => Object.keys(c).length > 0)
          }
        });
        
        if (existingContact) {
          customerId = existingContact.id;
        } else {
          const newContact = await prisma.contacts.create({
            data: {
              fullname: estimate.customer_name,
              whatsapp: estimate.contact_type === 'whatsapp' ? parseFloat(estimate.contact_value) : null
            }
          });
          customerId = newContact.id;
        }
      }
      
      const checkIn = estimate.check_in ? new Date(estimate.check_in) : new Date();
      const checkOut = estimate.check_out ? new Date(estimate.check_out) : checkIn;
      const durationMs = checkOut.getTime() - checkIn.getTime();
      const durationSeconds = Math.max(43200, Math.floor(durationMs / 1000));
      
      const accommodation = await prisma.accommodations.create({
        data: {
          venue: estimate.venue_id,
          plan_id: estimate.plan_id,
          customer: customerId,
          date: checkIn,
          duration: durationSeconds.toString(),
          adults: estimate.adults || 0,
          children: estimate.children || 0,
          calculated_price: estimate.calculated_price,
          agreed_price: estimate.calculated_price
        }
      });
      
      await prisma.estimates.update({
        where: { id: req.params.id },
        data: {
          status: 'converted',
          converted_at: new Date(),
          accommodation_id: accommodation.id,
          updated_at: new Date()
        }
      });
      
      res.json({ estimate_id: req.params.id, accommodation_id: accommodation.id, accommodation });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Analytics API
  app.get('/api/analytics/summary', async (req, res) => {
    try {
      const { venue_id, organization_id, from_date, to_date, period, viewAll } = req.query;
      const viewAllFlag = viewAll === 'true';
      
      let accessibleOrgIds = null;
      
      if (req.user) {
        const userId = String(req.user.claims?.sub);
        const currentUser = await prisma.users.findUnique({ where: { id: userId } });
        
        if (viewAllFlag && currentUser?.is_super_admin) {
          accessibleOrgIds = null;
        } else if (currentUser?.is_super_admin) {
          const userOrgs = await prisma.user_organizations.findMany({
            where: { user_id: userId }
          });
          accessibleOrgIds = userOrgs.map(uo => uo.organization_id);
        } else {
          accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
        }
      } else {
        return res.json({ income: 0, expenses: 0, depositsHeld: 0, depositsClaimed: 0, profit: 0 });
      }
      
      // Build date range
      let startDate, endDate;
      const now = new Date();
      
      if (period === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      } else if (period === 'quarter') {
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
        endDate = new Date(now.getFullYear(), quarter * 3 + 3, 0);
      } else if (period === 'year') {
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31);
      } else if (from_date && to_date) {
        startDate = new Date(from_date);
        endDate = new Date(to_date);
      } else {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      }
      
      // Build where clauses
      const orgFilter = accessibleOrgIds !== null ? { in: accessibleOrgIds } : undefined;
      
      const incomeWhere = {
        date: { gte: startDate, lte: endDate }
      };
      if (orgFilter) incomeWhere.organization_id = orgFilter;
      if (venue_id) incomeWhere.venue_id = venue_id;
      if (organization_id) incomeWhere.organization_id = organization_id;
      
      const expenseWhere = {
        expense_date: { gte: startDate, lte: endDate }
      };
      if (orgFilter) expenseWhere.organization_id = orgFilter;
      if (venue_id) expenseWhere.venue_id = venue_id;
      if (organization_id) expenseWhere.organization_id = organization_id;
      
      const depositWhere = {
        created_at: { gte: startDate, lte: endDate }
      };
      if (orgFilter) depositWhere.organization_id = orgFilter;
      if (venue_id) depositWhere.venue_id = venue_id;
      if (organization_id) depositWhere.organization_id = organization_id;
      
      // Query aggregates
      const incomeResult = await prisma.incomes.aggregate({
        where: incomeWhere,
        _sum: { amount: true }
      });
      
      const expenseResult = await prisma.expenses.aggregate({
        where: expenseWhere,
        _sum: { amount: true }
      });
      
      const depositsHeldResult = await prisma.deposits.aggregate({
        where: { ...depositWhere, status: 'pending' },
        _sum: { amount: true }
      });
      
      const depositsClaimedResult = await prisma.deposits.aggregate({
        where: { ...depositWhere, status: 'claimed' },
        _sum: { damage_amount: true }
      });
      
      const income = parseFloat(incomeResult._sum.amount) || 0;
      const expenses = parseFloat(expenseResult._sum.amount) || 0;
      const depositsHeld = parseFloat(depositsHeldResult._sum.amount) || 0;
      const depositsClaimed = parseFloat(depositsClaimedResult._sum.damage_amount) || 0;
      
      res.json({
        income,
        expenses,
        depositsHeld,
        depositsClaimed,
        profit: income - expenses,
        period: { from: startDate, to: endDate }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/analytics/expenses-by-category', async (req, res) => {
    try {
      const { venue_id, organization_id, from_date, to_date, period, viewAll } = req.query;
      const viewAllFlag = viewAll === 'true';
      
      let accessibleOrgIds = null;
      
      if (req.user) {
        const userId = String(req.user.claims?.sub);
        const currentUser = await prisma.users.findUnique({ where: { id: userId } });
        
        if (viewAllFlag && currentUser?.is_super_admin) {
          accessibleOrgIds = null;
        } else if (currentUser?.is_super_admin) {
          const userOrgs = await prisma.user_organizations.findMany({
            where: { user_id: userId }
          });
          accessibleOrgIds = userOrgs.map(uo => uo.organization_id);
        } else {
          accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
        }
      } else {
        return res.json([]);
      }
      
      let startDate, endDate;
      const now = new Date();
      
      if (period === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      } else if (period === 'quarter') {
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
        endDate = new Date(now.getFullYear(), quarter * 3 + 3, 0);
      } else if (period === 'year') {
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31);
      } else if (from_date && to_date) {
        startDate = new Date(from_date);
        endDate = new Date(to_date);
      } else {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      }
      
      const whereClause = {
        expense_date: { gte: startDate, lte: endDate }
      };
      if (accessibleOrgIds !== null) {
        if (accessibleOrgIds.length === 0) return res.json([]);
        whereClause.organization_id = { in: accessibleOrgIds };
      }
      if (venue_id) whereClause.venue_id = venue_id;
      if (organization_id) whereClause.organization_id = organization_id;
      
      const expenses = await prisma.expenses.findMany({
        where: whereClause,
        include: { category: true }
      });
      
      const byCategory = {};
      expenses.forEach(e => {
        const catId = e.category_id || 'uncategorized';
        const catName = e.category?.name || 'Sin categoría';
        const catIcon = e.category?.icon || 'cilOptions';
        const catColor = e.category?.color || 'secondary';
        if (!byCategory[catId]) {
          byCategory[catId] = { id: catId, name: catName, icon: catIcon, color: catColor, total: 0, count: 0 };
        }
        byCategory[catId].total += parseFloat(e.amount) || 0;
        byCategory[catId].count += 1;
      });
      
      const result = Object.values(byCategory).sort((a, b) => b.total - a.total);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/analytics/monthly-trend', async (req, res) => {
    try {
      const { venue_id, organization_id, months, viewAll } = req.query;
      const viewAllFlag = viewAll === 'true';
      const numMonths = parseInt(months) || 6;
      
      let accessibleOrgIds = null;
      
      if (req.user) {
        const userId = String(req.user.claims?.sub);
        const currentUser = await prisma.users.findUnique({ where: { id: userId } });
        
        if (viewAllFlag && currentUser?.is_super_admin) {
          accessibleOrgIds = null;
        } else if (currentUser?.is_super_admin) {
          const userOrgs = await prisma.user_organizations.findMany({
            where: { user_id: userId }
          });
          accessibleOrgIds = userOrgs.map(uo => uo.organization_id);
        } else {
          accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
        }
      } else {
        return res.json([]);
      }
      
      const now = new Date();
      const result = [];
      
      for (let i = numMonths - 1; i >= 0; i--) {
        const startDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const endDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
        
        const baseWhere = {};
        if (accessibleOrgIds !== null) {
          if (accessibleOrgIds.length === 0) {
            result.push({ month: startDate.toISOString().slice(0, 7), income: 0, expenses: 0, profit: 0 });
            continue;
          }
          baseWhere.organization_id = { in: accessibleOrgIds };
        }
        if (venue_id) baseWhere.venue_id = venue_id;
        if (organization_id) baseWhere.organization_id = organization_id;
        
        const incomeResult = await prisma.incomes.aggregate({
          where: { ...baseWhere, date: { gte: startDate, lte: endDate } },
          _sum: { amount: true }
        });
        
        const expenseResult = await prisma.expenses.aggregate({
          where: { ...baseWhere, expense_date: { gte: startDate, lte: endDate } },
          _sum: { amount: true }
        });
        
        const income = parseFloat(incomeResult._sum.amount) || 0;
        const expenses = parseFloat(expenseResult._sum.amount) || 0;
        
        result.push({
          month: startDate.toISOString().slice(0, 7),
          monthName: startDate.toLocaleString('es-CO', { month: 'short', year: 'numeric' }),
          income,
          expenses,
          profit: income - expenses
        });
      }
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // AI-powered receipt data extraction
  app.post('/api/payments/extract-receipt', isAuthenticated, async (req, res) => {
    try {
      const { imageUrl } = req.body;
      
      if (!imageUrl) {
        return res.status(400).json({ error: 'Se requiere la URL de la imagen' });
      }
      
      // Get configured model for receipt extraction
      const aiSetting = await prisma.ai_settings.findUnique({
        where: { setting_key: 'receipt_extraction' }
      });
      
      // Default to anthropic if not configured
      const providerCode = aiSetting?.provider_code || 'anthropic_claude';
      const modelConfig = llmService.getModelConfig(providerCode);
      
      if (!modelConfig) {
        return res.status(500).json({ error: 'Modelo de IA no configurado' });
      }
      
      const apiKey = llmService.getApiKeyForProvider(providerCode);
      if (!apiKey) {
        return res.status(500).json({ error: `API key no configurada (${modelConfig.env_key})` });
      }
      
      // Fetch the image from object storage
      let imageBuffer;
      let contentType = 'image/jpeg';
      
      if (imageUrl.startsWith('/objects/')) {
        // Internal object storage path - fetch from sidecar
        const objectPath = imageUrl.replace('/objects/', '');
        const pathParts = objectPath.split('/');
        const objectType = pathParts[0];
        const objectId = pathParts[1];
        
        const privateObjectDir = process.env.PRIVATE_OBJECT_DIR || '';
        const fullPath = `${privateObjectDir}/${objectType}/${objectId}`;
        const pathSegments = fullPath.startsWith('/') ? fullPath.slice(1).split('/') : fullPath.split('/');
        const bucketName = pathSegments[0];
        const objectName = pathSegments.slice(1).join('/');
        
        const signedUrlResponse = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bucket_name: bucketName,
            object_name: objectName,
            method: 'GET',
            expires_at: new Date(Date.now() + 300 * 1000).toISOString(),
          }),
        });
        
        if (!signedUrlResponse.ok) {
          throw new Error('No se pudo obtener la imagen del almacenamiento');
        }
        
        const { signed_url } = await signedUrlResponse.json();
        const imageResponse = await fetch(signed_url);
        if (!imageResponse.ok) {
          throw new Error('No se pudo descargar la imagen');
        }
        
        imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
      } else {
        // External URL
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          throw new Error('No se pudo descargar la imagen');
        }
        imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
      }
      
      // Convert to base64
      const base64Image = imageBuffer.toString('base64');
      
      // Map content type to Anthropic's accepted media types
      let mediaType = 'image/jpeg';
      if (contentType.includes('png')) mediaType = 'image/png';
      else if (contentType.includes('gif')) mediaType = 'image/gif';
      else if (contentType.includes('webp')) mediaType = 'image/webp';
      
      // Use Vercel AI SDK with configured model
      const { generateObject } = await import('ai');
      const { z } = await import('zod');
      
      let model;
      if (modelConfig.provider === 'anthropic') {
        const { anthropic } = await import('@ai-sdk/anthropic');
        model = anthropic(modelConfig.model);
      } else if (providerCode.startsWith('openai')) {
        const { openai } = await import('@ai-sdk/openai');
        model = openai(modelConfig.model);
      } else {
        // Fallback to OpenAI-compatible for xAI Grok, etc.
        const { createOpenAI } = await import('@ai-sdk/openai');
        const provider = createOpenAI({
          apiKey: apiKey,
          baseURL: modelConfig.base_url
        });
        model = provider(modelConfig.model);
      }
      
      const result = await generateObject({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                image: `data:${mediaType};base64,${base64Image}`,
              },
              {
                type: 'text',
                text: `Analiza esta imagen de un comprobante de pago o transferencia bancaria y extrae la siguiente información:
                
1. Monto/valor de la transferencia (solo el número, sin símbolos de moneda)
2. Número de referencia o transacción (puede estar etiquetado como "Referencia", "No. Transacción", "ID", "Comprobante", etc.)
3. Fecha de la transferencia (en formato YYYY-MM-DD si es posible)

Si algún dato no está visible o no se puede determinar, devuelve null para ese campo.
Presta especial atención a comprobantes de Nequi, Daviplata, Bancolombia, y otras entidades colombianas.`
              }
            ]
          }
        ],
        schema: z.object({
          amount: z.number().nullable().describe('Monto de la transferencia sin símbolos de moneda'),
          reference: z.string().nullable().describe('Número de referencia o transacción'),
          payment_date: z.string().nullable().describe('Fecha de la transferencia en formato YYYY-MM-DD')
        })
      });
      
      res.json({
        success: true,
        data: result.object
      });
    } catch (error) {
      console.error('Error extracting receipt data:', error);
      res.status(500).json({ 
        error: 'Error al procesar el comprobante',
        details: error.message 
      });
    }
  });

  // ==========================================
  // Message Templates API
  // ==========================================
  
  // GET /api/message-templates - List templates (optional venue_id filter)
  app.get('/api/message-templates', isAuthenticated, async (req, res) => {
    try {
      const { venue_id } = req.query;
      const whereClause = {};
      
      if (venue_id) {
        // Get templates for specific venue + system templates (venue_id=null)
        whereClause.OR = [
          { venue_id: venue_id },
          { venue_id: null }
        ];
      }
      
      const templates = await prisma.message_templates.findMany({
        where: whereClause,
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }]
      });
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/message-templates/:id - Get template by ID
  app.get('/api/message-templates/:id', isAuthenticated, async (req, res) => {
    try {
      const template = await prisma.message_templates.findUnique({
        where: { id: req.params.id }
      });
      if (!template) {
        return res.status(404).json({ error: 'Template no encontrado' });
      }
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/message-templates - Create template
  app.post('/api/message-templates', isAuthenticated, async (req, res) => {
    try {
      const template = await prisma.message_templates.create({
        data: req.body
      });
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/message-templates/:id - Update template
  app.put('/api/message-templates/:id', isAuthenticated, async (req, res) => {
    try {
      const template = await prisma.message_templates.update({
        where: { id: req.params.id },
        data: {
          ...req.body,
          updated_at: new Date()
        }
      });
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/message-templates/:id - Delete template (only if not is_system)
  app.delete('/api/message-templates/:id', isAuthenticated, async (req, res) => {
    try {
      const template = await prisma.message_templates.findUnique({
        where: { id: req.params.id }
      });
      
      if (!template) {
        return res.status(404).json({ error: 'Template no encontrado' });
      }
      
      if (template.is_system) {
        return res.status(403).json({ error: 'No se pueden eliminar templates del sistema' });
      }
      
      await prisma.message_templates.delete({
        where: { id: req.params.id }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // LLM Providers API
  // ==========================================
  
  // GET /api/llm-providers - List active providers
  app.get('/api/llm-providers', isAuthenticated, async (req, res) => {
    try {
      const providers = await prisma.llm_providers.findMany({
        where: { is_active: true },
        orderBy: { name: 'asc' }
      });
      // Add has_api_key flag and remove actual api_key
      const safeProviders = providers.map(p => {
        const { api_key, ...rest } = p;
        return { ...rest, has_api_key: !!api_key };
      });
      res.json(safeProviders);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/llm-providers/:id - Get provider by ID
  app.get('/api/llm-providers/:id', isAuthenticated, async (req, res) => {
    try {
      const provider = await prisma.llm_providers.findUnique({
        where: { id: req.params.id }
      });
      if (!provider) {
        return res.status(404).json({ error: 'Proveedor no encontrado' });
      }
      // Add has_api_key flag and remove actual api_key
      const { api_key, ...safeProvider } = provider;
      res.json({ ...safeProvider, has_api_key: !!api_key });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/llm-providers - Create provider
  app.post('/api/llm-providers', isAuthenticated, async (req, res) => {
    try {
      const provider = await prisma.llm_providers.create({
        data: req.body
      });
      // Return without api_key
      const { api_key, ...safeProvider } = provider;
      res.json(safeProvider);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/llm-providers/:id - Update provider
  app.put('/api/llm-providers/:id', isAuthenticated, async (req, res) => {
    try {
      const provider = await prisma.llm_providers.update({
        where: { id: req.params.id },
        data: {
          ...req.body,
          updated_at: new Date()
        }
      });
      // Return without api_key
      const { api_key, ...safeProvider } = provider;
      res.json(safeProvider);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/llm-providers/:id - Delete provider
  app.delete('/api/llm-providers/:id', isAuthenticated, async (req, res) => {
    try {
      await prisma.llm_providers.delete({
        where: { id: req.params.id }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/llm-providers/:id/test - Test provider connection
  app.post('/api/llm-providers/:id/test', isAuthenticated, async (req, res) => {
    try {
      const provider = await prisma.llm_providers.findUnique({
        where: { id: req.params.id }
      });
      
      if (!provider) {
        return res.status(404).json({ error: 'Proveedor no encontrado' });
      }
      
      if (!provider.api_key) {
        return res.status(400).json({ error: 'El proveedor no tiene API key configurada' });
      }
      
      // Test the connection by making a simple request
      let testUrl = provider.base_url;
      let headers = {
        'Content-Type': 'application/json'
      };
      let body;
      
      if (provider.code === 'anthropic') {
        // Anthropic uses a different API structure
        testUrl = `${provider.base_url}/v1/messages`;
        headers['x-api-key'] = provider.api_key;
        headers['anthropic-version'] = '2023-06-01';
        body = JSON.stringify({
          model: provider.model || 'claude-3-haiku-20240307',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }]
        });
      } else {
        // OpenAI-compatible API (OpenAI, DeepSeek, Groq, etc.)
        testUrl = `${provider.base_url}/chat/completions`;
        headers['Authorization'] = `Bearer ${provider.api_key}`;
        body = JSON.stringify({
          model: provider.model || 'gpt-4o-mini',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }]
        });
      }
      
      const response = await fetch(testUrl, {
        method: 'POST',
        headers,
        body
      });
      
      if (response.ok) {
        res.json({ success: true, message: 'Conexión exitosa' });
      } else {
        const errorData = await response.json().catch(() => ({}));
        res.status(400).json({ 
          success: false, 
          error: errorData.error?.message || `Error: ${response.status}` 
        });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ==================== AI Settings API ====================
  
  // Available AI models configuration (reads API keys from environment)
  const AI_MODELS = [
    {
      code: 'anthropic_claude',
      name: 'Anthropic Claude',
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      base_url: 'https://api.anthropic.com',
      env_key: 'ANTHROPIC_API_KEY'
    },
    {
      code: 'xai_grok',
      name: 'xAI Grok',
      model: 'grok-4',
      provider: 'openai_compatible',
      base_url: 'https://api.x.ai/v1',
      env_key: 'GROK_API_KEY'
    },
    {
      code: 'openai_gpt4o',
      name: 'OpenAI GPT-4o',
      model: 'gpt-4o',
      provider: 'openai_compatible',
      base_url: 'https://api.openai.com/v1',
      env_key: 'OPENAI_API_KEY'
    },
    {
      code: 'openai_gpt4o_mini',
      name: 'OpenAI GPT-4o Mini',
      model: 'gpt-4o-mini',
      provider: 'openai_compatible',
      base_url: 'https://api.openai.com/v1',
      env_key: 'OPENAI_API_KEY'
    }
  ];
  
  // GET /api/ai/available-models - List available models with API keys configured
  app.get('/api/ai/available-models', isAuthenticated, async (req, res) => {
    try {
      const available = AI_MODELS.filter(m => !!process.env[m.env_key]).map(m => ({
        code: m.code,
        name: m.name,
        model: m.model
      }));
      res.json(available);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // GET /api/ai/settings - Get AI settings
  app.get('/api/ai/settings', isAuthenticated, async (req, res) => {
    try {
      const settings = await prisma.ai_settings.findMany();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // POST /api/ai/settings - Save AI settings
  app.post('/api/ai/settings', isAuthenticated, async (req, res) => {
    try {
      const { receipt_extraction, message_suggestions, customer_chat } = req.body;
      const settingsToSave = [
        { key: 'receipt_extraction', value: receipt_extraction },
        { key: 'message_suggestions', value: message_suggestions },
        { key: 'customer_chat', value: customer_chat }
      ];
      
      for (const setting of settingsToSave) {
        if (!setting.value) continue;
        
        const modelConfig = AI_MODELS.find(m => m.code === setting.value);
        if (!modelConfig) continue;
        
        await prisma.ai_settings.upsert({
          where: { setting_key: setting.key },
          update: {
            provider_code: setting.value,
            model: modelConfig.model,
            updated_at: new Date()
          },
          create: {
            setting_key: setting.key,
            provider_code: setting.value,
            model: modelConfig.model
          }
        });
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // POST /api/ai/test-connection - Test AI model connection
  app.post('/api/ai/test-connection', isAuthenticated, async (req, res) => {
    try {
      const { provider_code } = req.body;
      const modelConfig = AI_MODELS.find(m => m.code === provider_code);
      
      if (!modelConfig) {
        return res.status(400).json({ error: 'Modelo no encontrado' });
      }
      
      const apiKey = process.env[modelConfig.env_key];
      if (!apiKey) {
        return res.status(400).json({ error: `API key no configurada (${modelConfig.env_key})` });
      }
      
      let testUrl, headers, body;
      
      if (modelConfig.provider === 'anthropic') {
        testUrl = `${modelConfig.base_url}/v1/messages`;
        headers = {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        };
        body = JSON.stringify({
          model: modelConfig.model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }]
        });
      } else {
        testUrl = `${modelConfig.base_url}/chat/completions`;
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        };
        body = JSON.stringify({
          model: modelConfig.model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }]
        });
      }
      
      const response = await fetch(testUrl, { method: 'POST', headers, body });
      
      if (response.ok) {
        res.json({ success: true, message: 'Conexión exitosa' });
      } else {
        const errorData = await response.json().catch(() => ({}));
        res.status(400).json({ 
          success: false, 
          error: errorData.error?.message || `Error: ${response.status}` 
        });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ==================== Chat API ====================

  // POST /api/chat/:venue_id - Chat endpoint (supports internal and webhook calls)
  app.post('/api/chat/:venue_id', async (req, res) => {
    try {
      const { venue_id } = req.params;
      const { message, conversation_id, provider_id, source = 'web', contact_type, contact_value } = req.body;
      
      // For Twilio/Meta webhooks, extract message from their format
      let userMessage = message;
      let externalId = null;
      let phone = null;
      let userName = null;
      
      // Handle Twilio webhook format
      if (req.body.Body && req.body.From) {
        userMessage = req.body.Body;
        phone = req.body.From;
        externalId = req.body.MessageSid;
      }
      
      // Handle Meta/WhatsApp webhook format
      if (req.body.entry && req.body.entry[0]?.changes) {
        const changes = req.body.entry[0].changes[0];
        if (changes?.value?.messages) {
          const msg = changes.value.messages[0];
          userMessage = msg.text?.body || msg.body;
          phone = msg.from;
          externalId = msg.id;
          const contact = changes.value.contacts?.[0];
          userName = contact?.profile?.name;
        }
      }
      
      if (!userMessage) {
        return res.status(400).json({ error: 'Se requiere un mensaje' });
      }
      
      // Get venue with all relevant info
      const venue = await prisma.venues.findUnique({
        where: { id: venue_id }
      });
      
      if (!venue) {
        return res.status(404).json({ error: 'Cabaña no encontrada' });
      }
      
      // Get venue plans
      const plans = await prisma.venue_plans.findMany({
        where: { venue_id, is_active: true }
      });
      
      // Get templates for this venue (including system templates)
      const templates = await prisma.message_templates.findMany({
        where: {
          is_active: true,
          OR: [
            { venue_id },
            { venue_id: null, is_system: true }
          ]
        }
      });
      
      // Get configured model for customer chat from ai_settings
      const chatSetting = await prisma.ai_settings.findUnique({
        where: { setting_key: 'customer_chat' }
      });
      
      const chatProviderCode = chatSetting?.provider_code || 'anthropic_claude';
      const chatModelConfig = llmService.getModelConfig(chatProviderCode);
      
      if (!chatModelConfig) {
        return res.status(400).json({ error: 'Modelo de chat no configurado' });
      }
      
      const chatApiKey = llmService.getApiKeyForProvider(chatProviderCode);
      if (!chatApiKey) {
        return res.status(400).json({ 
          error: `API key no configurada (${chatModelConfig.env_key})` 
        });
      }
      
      // Get or create conversation
      let conversation;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (conversation_id && uuidRegex.test(conversation_id)) {
        conversation = await prisma.chat_conversations.findUnique({
          where: { id: conversation_id },
          include: { messages: { orderBy: { created_at: 'asc' }, take: 20 } }
        });
      }
      
      if (!conversation) {
        conversation = await prisma.chat_conversations.create({
          data: {
            venue_id,
            source,
            external_id: externalId,
            phone,
            name: userName
          }
        });
        conversation.messages = [];
      }
      
      // Save user message
      await prisma.chat_messages.create({
        data: {
          conversation_id: conversation.id,
          role: 'user',
          content: userMessage
        }
      });
      
      // Build context and messages
      const context = llmService.buildVenueContext(venue, templates, plans);
      const contactInfo = (contact_type && contact_value) ? { type: contact_type, value: contact_value } : null;
      const systemPrompt = llmService.buildSystemPrompt(venue, context, contactInfo);
      
      const llmMessages = [
        { role: 'system', content: systemPrompt }
      ];
      
      // Add conversation history
      for (const msg of conversation.messages) {
        llmMessages.push({ role: msg.role, content: msg.content });
      }
      
      // Add current message
      llmMessages.push({ role: 'user', content: userMessage });
      
      // Call LLM using configured model with tools
      let llmResponse = await llmService.callLLMByCode(chatProviderCode, llmMessages, {
        maxTokens: 1024,
        temperature: 0.7,
        tools: llmService.CHAT_TOOLS
      });
      
      // Handle tool calls (function calling)
      if (llmResponse.tool_calls && llmResponse.tool_calls.length > 0) {
        for (const toolCall of llmResponse.tool_calls) {
          if (toolCall.function.name === 'check_availability') {
            const args = JSON.parse(toolCall.function.arguments);
            
            // Rate limiting: max 5 availability checks per hour per conversation
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            const recentChecks = await prisma.chat_messages.count({
              where: {
                conversation_id: conversation.id,
                role: 'assistant',
                content: { contains: '"tool":"check_availability"' },
                created_at: { gte: oneHourAgo }
              }
            });
            
            if (recentChecks >= 5) {
              const availabilityData = {
                error: true,
                message: 'Has alcanzado el límite de consultas de disponibilidad (5 por hora). Por favor espera un momento o contacta directamente por WhatsApp para más información.'
              };
              const toolResultContent = JSON.stringify(availabilityData);
              
              if (chatModelConfig.provider === 'anthropic') {
                llmMessages.push({
                  role: 'assistant',
                  content: [{ type: 'tool_use', id: toolCall.id, name: toolCall.function.name, input: args }]
                });
                llmMessages.push({
                  role: 'user',
                  content: [{ type: 'tool_result', tool_use_id: toolCall.id, content: toolResultContent }]
                });
              } else {
                llmMessages.push({ role: 'assistant', content: null, tool_calls: llmResponse.tool_calls });
                llmMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolResultContent });
              }
              
              llmResponse = await llmService.callLLMByCode(chatProviderCode, llmMessages, {
                maxTokens: 1024,
                temperature: 0.7
              });
              continue;
            }
            
            // Validate dates are not in the past and check_out >= check_in
            const checkInDate = new Date(args.check_in);
            const checkOutDate = args.check_out ? new Date(args.check_out) : checkInDate;
            const today = new Date();
            today.setUTCHours(0, 0, 0, 0);
            const checkInDay = new Date(checkInDate.getUTCFullYear(), checkInDate.getUTCMonth(), checkInDate.getUTCDate());
            const checkOutDay = new Date(checkOutDate.getUTCFullYear(), checkOutDate.getUTCMonth(), checkOutDate.getUTCDate());
            
            let dateError = null;
            if (checkInDay < today) {
              dateError = 'La fecha de llegada está en el pasado. Por favor proporciona una fecha futura.';
            } else if (checkOutDay < checkInDay) {
              dateError = 'La fecha de salida debe ser igual o posterior a la fecha de llegada.';
            } else if (checkOutDay < today) {
              dateError = 'La fecha de salida está en el pasado. Por favor proporciona una fecha futura.';
            }
            
            if (dateError) {
              const availabilityData = {
                error: true,
                message: dateError,
                today: today.toISOString().split('T')[0]
              };
              const toolResultContent = JSON.stringify(availabilityData);
              
              if (chatModelConfig.provider === 'anthropic') {
                llmMessages.push({
                  role: 'assistant',
                  content: [{ type: 'tool_use', id: toolCall.id, name: toolCall.function.name, input: args }]
                });
                llmMessages.push({
                  role: 'user',
                  content: [{ type: 'tool_result', tool_use_id: toolCall.id, content: toolResultContent }]
                });
              } else {
                llmMessages.push({ role: 'assistant', content: null, tool_calls: llmResponse.tool_calls });
                llmMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolResultContent });
              }
              
              llmResponse = await llmService.callLLMByCode(chatProviderCode, llmMessages, {
                maxTokens: 1024,
                temperature: 0.7
              });
              continue;
            }
            
            const numAdults = parseInt(args.adults) || 1;
            const numChildren = parseInt(args.children) || 0;
            const totalGuests = numAdults + numChildren;
            
            // Check for existing accommodations
            const existingAccommodations = await prisma.accommodations.findMany({
              where: { venue: venue_id }
            });
            
            let isAvailable = true;
            for (const acc of existingAccommodations) {
              const accDate = new Date(acc.date);
              const durationSeconds = parseInt(acc.duration) || 43200;
              const accEndDate = new Date(accDate.getTime() + durationSeconds * 1000);
              
              const accStartDay = new Date(accDate.getUTCFullYear(), accDate.getUTCMonth(), accDate.getUTCDate());
              const accEndDay = new Date(accEndDate.getUTCFullYear(), accEndDate.getUTCMonth(), accEndDate.getUTCDate());
              const checkInDay = new Date(checkInDate.getUTCFullYear(), checkInDate.getUTCMonth(), checkInDate.getUTCDate());
              const checkOutDay = new Date(checkOutDate.getUTCFullYear(), checkOutDate.getUTCMonth(), checkOutDate.getUTCDate());
              
              if (accStartDay <= checkOutDay && accEndDay >= checkInDay) {
                isAvailable = false;
                break;
              }
            }
            
            // Check suitable plans
            const suitablePlans = plans.filter(p => {
              const planMin = p.min_guests || 1;
              const planMax = p.max_capacity || 999;
              return totalGuests >= planMin && totalGuests <= planMax;
            }).map(p => ({
              name: p.name,
              plan_type: p.plan_type,
              adult_price: p.adult_price,
              child_price: p.child_price
            }));
            
            // Get next available dates if not available
            let nextAvailableDates = [];
            if (!isAvailable) {
              // Determine if user is looking for weekends (check_in is Sat/Sun)
              const checkInDayOfWeek = checkInDate.getDay();
              const preferWeekends = checkInDayOfWeek === 0 || checkInDayOfWeek === 6;
              // Calculate stay length in days
              const stayLength = Math.max(1, Math.ceil((checkOutDay - checkInDay) / (1000 * 60 * 60 * 24)) + 1);
              
              nextAvailableDates = llmService.getNextAvailableDates(existingAccommodations, checkInDate, {
                preferWeekends,
                stayLength,
                numDays: 30
              });
            }
            
            const availabilityData = {
              venue_name: venue.name,
              check_in: args.check_in,
              check_out: args.check_out || args.check_in,
              adults: numAdults,
              children: numChildren,
              total_guests: totalGuests,
              is_available: isAvailable,
              suitable_plans: suitablePlans,
              next_available_dates: nextAvailableDates,
              message: isAvailable 
                ? (suitablePlans.length > 0 
                    ? `La cabaña está disponible para ${totalGuests} persona(s). Hay ${suitablePlans.length} plan(es) disponible(s).`
                    : `La cabaña está disponible pero no hay planes para ${totalGuests} persona(s).`)
                : `La cabaña no está disponible para esas fechas. ${nextAvailableDates.length > 0 ? `Fechas próximas disponibles: ${nextAvailableDates.map(d => d.date + ' (' + d.day_of_week + ')').join(', ')}.` : ''}`
            };
            
            const toolResultContent = JSON.stringify(availabilityData);
            
            // Handle differently for Anthropic vs OpenAI
            if (chatModelConfig.provider === 'anthropic') {
              // For Anthropic, add assistant message with tool_use and user message with tool_result
              llmMessages.push({
                role: 'assistant',
                content: [
                  ...(llmResponse.content ? [{ type: 'text', text: llmResponse.content }] : []),
                  {
                    type: 'tool_use',
                    id: toolCall.id,
                    name: toolCall.function.name,
                    input: args
                  }
                ]
              });
              
              llmMessages.push({
                role: 'user',
                content: [{
                  type: 'tool_result',
                  tool_use_id: toolCall.id,
                  content: toolResultContent
                }]
              });
            } else {
              // For OpenAI-compatible, use standard tool message format
              llmMessages.push({
                role: 'assistant',
                content: llmResponse.content || null,
                tool_calls: llmResponse.tool_calls
              });
              
              llmMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: toolResultContent
              });
            }
            
            // Get final response with tool results
            llmResponse = await llmService.callLLMByCode(chatProviderCode, llmMessages, {
              maxTokens: 1024,
              temperature: 0.7
            });
            
            // Track that we used check_availability tool (for rate limiting)
            llmResponse.tools_used = llmResponse.tools_used || [];
            llmResponse.tools_used.push('check_availability');
          } else if (toolCall.function.name === 'get_venue_info') {
            // Get venue with amenities
            const venueAmenities = await prisma.venue_amenities.findMany({
              where: { venue_id }
            });
            const amenityIds = venueAmenities.map(va => va.amenity_id);
            const amenities = amenityIds.length > 0 ? await prisma.amenities.findMany({
              where: { id: { in: amenityIds }, is_active: true }
            }) : [];
            
            const venueInfoData = {
              name: venue.name,
              address: venue.address,
              city: venue.city,
              department: venue.department,
              address_reference: venue.address_reference,
              whatsapp: venue.whatsapp,
              instagram: venue.instagram,
              wifi_ssid: venue.wifi_ssid,
              wifi_password: venue.wifi_password,
              venue_info: venue.venue_info,
              delivery_info: venue.delivery_info,
              waze_link: venue.waze_link,
              google_maps_link: venue.google_maps_link,
              amenities: amenities.map(a => ({
                name: a.name,
                description: a.description,
                category: a.category
              }))
            };
            
            const toolResultContent = JSON.stringify(venueInfoData);
            
            if (chatModelConfig.provider === 'anthropic') {
              llmMessages.push({
                role: 'assistant',
                content: [{ type: 'tool_use', id: toolCall.id, name: toolCall.function.name, input: {} }]
              });
              llmMessages.push({
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: toolCall.id, content: toolResultContent }]
              });
            } else {
              llmMessages.push({ role: 'assistant', content: null, tool_calls: llmResponse.tool_calls });
              llmMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolResultContent });
            }
            
            llmResponse = await llmService.callLLMByCode(chatProviderCode, llmMessages, {
              maxTokens: 1024,
              temperature: 0.7
            });
            
            llmResponse.tools_used = llmResponse.tools_used || [];
            llmResponse.tools_used.push('get_venue_info');
          } else if (toolCall.function.name === 'get_plans') {
            // Get plans with their amenities
            const planAmenities = await prisma.plan_amenities.findMany({
              where: { plan_id: { in: plans.map(p => p.id) } }
            });
            const planAmenityIds = [...new Set(planAmenities.map(pa => pa.amenity_id))];
            const planAmenitiesData = planAmenityIds.length > 0 ? await prisma.amenities.findMany({
              where: { id: { in: planAmenityIds }, is_active: true }
            }) : [];
            const amenityMap = {};
            planAmenitiesData.forEach(a => { amenityMap[a.id] = a; });
            
            const plansWithAmenities = plans.map(p => {
              const pAmenities = planAmenities.filter(pa => pa.plan_id === p.id);
              return {
                id: p.id,
                name: p.name,
                plan_type: p.plan_type,
                description: p.description,
                adult_price: p.adult_price,
                child_price: p.child_price,
                min_guests: p.min_guests,
                max_capacity: p.max_capacity,
                check_in_time: p.check_in_time,
                check_out_time: p.check_out_time,
                includes_food: p.includes_food,
                food_description: p.food_description,
                includes_beverages: p.includes_beverages,
                includes_overnight: p.includes_overnight,
                includes_rooms: p.includes_rooms,
                amenities: pAmenities.map(pa => {
                  const am = amenityMap[pa.amenity_id];
                  return am ? { name: am.name, description: am.description } : null;
                }).filter(Boolean)
              };
            });
            
            const toolResultContent = JSON.stringify({ plans: plansWithAmenities });
            
            if (chatModelConfig.provider === 'anthropic') {
              llmMessages.push({
                role: 'assistant',
                content: [{ type: 'tool_use', id: toolCall.id, name: toolCall.function.name, input: {} }]
              });
              llmMessages.push({
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: toolCall.id, content: toolResultContent }]
              });
            } else {
              llmMessages.push({ role: 'assistant', content: null, tool_calls: llmResponse.tool_calls });
              llmMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolResultContent });
            }
            
            llmResponse = await llmService.callLLMByCode(chatProviderCode, llmMessages, {
              maxTokens: 1024,
              temperature: 0.7
            });
            
            llmResponse.tools_used = llmResponse.tools_used || [];
            llmResponse.tools_used.push('get_plans');
          } else if (toolCall.function.name === 'create_estimate') {
            const args = JSON.parse(toolCall.function.arguments);
            
            // Find matching plan by name
            const matchingPlan = plans.find(p => 
              p.name.toLowerCase().includes(args.plan_name.toLowerCase()) ||
              args.plan_name.toLowerCase().includes(p.name.toLowerCase())
            );
            
            // Calculate price if plan found
            let calculatedPrice = null;
            if (matchingPlan) {
              const adults = args.adults || 0;
              const children = args.children || 0;
              calculatedPrice = (parseFloat(matchingPlan.adult_price) * adults) + 
                               (parseFloat(matchingPlan.child_price) * children);
            }
            
            // Create the estimate
            const estimate = await prisma.estimates.create({
              data: {
                venue_id,
                plan_id: matchingPlan?.id || null,
                customer_name: args.customer_name,
                contact_type: contact_type || 'whatsapp',
                contact_value: contact_value || '',
                check_in: args.check_in ? new Date(args.check_in) : null,
                check_out: args.check_out ? new Date(args.check_out) : (args.check_in ? new Date(args.check_in) : null),
                adults: args.adults || 0,
                children: args.children || 0,
                calculated_price: calculatedPrice,
                notes: args.notes || null,
                conversation_id: conversation.id,
                status: 'pending',
                created_by: 'chat_ai'
              }
            });
            
            const estimateResult = {
              success: true,
              estimate_id: estimate.id,
              customer_name: args.customer_name,
              plan: matchingPlan?.name || args.plan_name,
              check_in: args.check_in,
              check_out: args.check_out || args.check_in,
              adults: args.adults,
              children: args.children || 0,
              calculated_price: calculatedPrice,
              message: `Cotización creada exitosamente. El cliente ${args.customer_name} recibirá confirmación pronto.`
            };
            
            const toolResultContent = JSON.stringify(estimateResult);
            
            if (chatModelConfig.provider === 'anthropic') {
              llmMessages.push({
                role: 'assistant',
                content: [{ type: 'tool_use', id: toolCall.id, name: toolCall.function.name, input: args }]
              });
              llmMessages.push({
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: toolCall.id, content: toolResultContent }]
              });
            } else {
              llmMessages.push({ role: 'assistant', content: null, tool_calls: llmResponse.tool_calls });
              llmMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolResultContent });
            }
            
            llmResponse = await llmService.callLLMByCode(chatProviderCode, llmMessages, {
              maxTokens: 1024,
              temperature: 0.7
            });
            
            llmResponse.tools_used = llmResponse.tools_used || [];
            llmResponse.tools_used.push('create_estimate');
          }
        }
      }
      
      // Track if we used a tool in this request (for rate limiting)
      const toolsUsed = llmResponse.tools_used || [];
      
      // Save assistant response with tool metadata if applicable
      const messageContent = toolsUsed.length > 0 
        ? `${llmResponse.content}\n<!-- {"tool":"${toolsUsed[0]}"} -->`
        : llmResponse.content;
      
      const assistantMessage = await prisma.chat_messages.create({
        data: {
          conversation_id: conversation.id,
          role: 'assistant',
          content: messageContent,
          provider: chatProviderCode,
          model: llmResponse.model,
          tokens_used: llmResponse.usage?.total_tokens
        }
      });
      
      // Update conversation timestamp
      await prisma.chat_conversations.update({
        where: { id: conversation.id },
        data: { updated_at: new Date() }
      });
      
      res.json({
        conversation_id: conversation.id,
        message: llmResponse.content,
        provider: chatProviderCode,
        model: llmResponse.model,
        tokens_used: llmResponse.usage?.total_tokens
      });
    } catch (error) {
      console.error('Chat error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/chat/:venue_id/conversations - List conversations for a venue
  app.get('/api/chat/:venue_id/conversations', isAuthenticated, async (req, res) => {
    try {
      const { venue_id } = req.params;
      
      const conversations = await prisma.chat_conversations.findMany({
        where: { venue_id },
        orderBy: { updated_at: 'desc' },
        take: 50
      });
      
      res.json(conversations);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/chat/conversation/:id - Get conversation with messages
  app.get('/api/chat/conversation/:id', isAuthenticated, async (req, res) => {
    try {
      const conversation = await prisma.chat_conversations.findUnique({
        where: { id: req.params.id },
        include: { messages: { orderBy: { created_at: 'asc' } } }
      });
      
      res.json(conversation);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Webhook verification for Meta/WhatsApp
  app.get('/api/webhook/:venue_id', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    // For now, accept any verification with the venue_id as token
    if (mode === 'subscribe' && token) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  });

  // Serve static files from Vue build in production
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  
  // Handle SPA routing - serve index.html for all non-API routes
  app.use((req, res, next) => {
    // Don't serve index.html for API routes or object storage
    if (req.path.startsWith('/api') || req.path.startsWith('/objects')) {
      return res.status(404).json({ error: 'Not found' });
    }
    // Only handle GET requests for SPA routing
    if (req.method === 'GET') {
      res.sendFile(path.join(distPath, 'index.html'));
    } else {
      next();
    }
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch(console.error);
