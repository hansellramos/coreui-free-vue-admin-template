require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const { uploadImage, deleteImage, extractPublicId } = require('./upload-service');
const { prisma } = require('./db');
const { setupAuth, isAuthenticated } = require('./auth/replitAuth');
const { loadUserPermissions, hasPermission, hasOwnOnly, hasAnyPermission, getAccessibleOrganizationIds, getAccessibleVenueIds, requirePermission } = require('./auth/permissions');
const llmService = require('./llm-service');

// WhatsApp service — proxied to external Baileys microservice via HTTP
const whatsappClient = require('./services/whatsappClient');
const metaWhatsApp = require('./services/metaWhatsApp');

/**
 * Calculate the next resume time at given hour in America/Bogota timezone.
 * If the hour has already passed today, returns tomorrow at that hour.
 */
function getNextResumeTime(hour = 3) {
  const now = new Date();
  // Get current time in Bogota (UTC-5)
  const bogotaOffset = -5 * 60; // minutes
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const bogotaMinutes = utcMinutes + bogotaOffset;
  const bogotaHour = Math.floor(((bogotaMinutes % 1440) + 1440) % 1440 / 60);

  // Calculate target time in UTC
  const targetBogotaMs = new Date(now);
  targetBogotaMs.setUTCHours(hour - (bogotaOffset / 60), 0, 0, 0); // hour in UTC = hour_bogota + 5

  if (targetBogotaMs <= now) {
    // Already passed today, set for tomorrow
    targetBogotaMs.setUTCDate(targetBogotaMs.getUTCDate() + 1);
  }

  return targetBogotaMs;
}

// AI audit logging helper — price cache for cost calculation
const _providerPriceCache = { data: null, expires: 0 };
const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getProviderPrices() {
  const now = Date.now();
  if (_providerPriceCache.data && now < _providerPriceCache.expires) {
    return _providerPriceCache.data;
  }
  try {
    const providers = await prisma.llm_providers.findMany({
      where: { is_active: true },
      select: { code: true, input_price_per_mtok: true, output_price_per_mtok: true }
    });
    const map = {};
    for (const p of providers) {
      map[p.code] = {
        input: parseFloat(p.input_price_per_mtok || 0),
        output: parseFloat(p.output_price_per_mtok || 0)
      };
    }
    _providerPriceCache.data = map;
    _providerPriceCache.expires = now + PRICE_CACHE_TTL;
    return map;
  } catch (err) {
    console.error('[ai-audit] Error loading provider prices:', err.message);
    return _providerPriceCache.data || {};
  }
}

function invalidateProviderPriceCache() {
  _providerPriceCache.data = null;
  _providerPriceCache.expires = 0;
}

// Check if a user is the linked commission agent for an accommodation
async function isCommissionAgentForAccommodation(userId, accommodation) {
  if (!userId || !accommodation?.commission_agent_id) return false;
  const agent = await prisma.commission_agents.findUnique({
    where: { id: accommodation.commission_agent_id },
    select: { user_id: true }
  });
  return agent?.user_id === userId;
}

// Get accommodation IDs where user is the linked commission agent
async function getAgentAccommodationIds(userId) {
  if (!userId) return new Set();
  const agents = await prisma.commission_agents.findMany({
    where: { user_id: userId, is_active: true },
    select: { id: true }
  });
  if (agents.length === 0) return new Set();
  const agentIds = agents.map(a => a.id);
  const accs = await prisma.accommodations.findMany({
    where: { commission_agent_id: { in: agentIds } },
    select: { id: true }
  });
  return new Set(accs.map(a => a.id));
}

async function logAICall(data) {
  try {
    const systemPrompt = data.system_prompt || '';
    const userPrompt = data.user_prompt || '';
    const responseContent = data.response_content || '';

    // Calculate cost if not provided
    let costEstimate = data.cost_estimate || null;
    if (costEstimate === null && (data.input_tokens || data.output_tokens)) {
      try {
        const prices = await getProviderPrices();
        const providerPrices = prices[data.provider_code];
        if (providerPrices) {
          costEstimate = (
            (data.input_tokens || 0) * providerPrices.input / 1000000 +
            (data.output_tokens || 0) * providerPrices.output / 1000000
          );
        }
      } catch (_) { /* ignore pricing errors */ }
    }

    await prisma.ai_audit_logs.create({
      data: {
        venue_id: data.venue_id || null,
        feature: data.feature,
        provider_code: data.provider_code,
        model: data.model,
        system_prompt: systemPrompt.substring(0, 50000),
        user_prompt: userPrompt.substring(0, 50000),
        response_content: responseContent.substring(0, 50000),
        input_tokens: data.input_tokens || null,
        output_tokens: data.output_tokens || null,
        response_time_ms: data.response_time_ms || null,
        request_size_bytes: Buffer.byteLength(systemPrompt + userPrompt, 'utf8'),
        response_size_bytes: Buffer.byteLength(responseContent, 'utf8'),
        cost_estimate: costEstimate,
        user_id: data.user_id || null,
        accommodation_id: data.accommodation_id || null,
        conversation_id: data.conversation_id || null,
        error: data.error || null,
        metadata: data.metadata || null
      }
    });
  } catch (err) {
    console.error('[ai-audit] Error logging AI call:', err.message);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  }
});

const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    cb(null, allowed.includes(file.mimetype));
  }
});

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());

// Seed default message templates
async function seedDefaultMessageTemplates() {
  const defaultTemplates = [
    {
      code: 'welcome',
      name: 'Bienvenida post-reserva',
      category: 'engagement',
      content: 'Genera un mensaje de bienvenida para el cliente que acaba de oficializar su reserva. Incluye: agradecimiento por elegirnos, indicaciones de cómo llegar (usa los links de Waze y Google Maps del venue), horario de llegada, y cualquier dato importante para su estadía. Si hay saldo pendiente del hospedaje o depósito sin pagar, menciona los montos que debe cancelar al momento de llegar a la cabaña. Si no hay saldos pendientes ni depósito pendiente, NO menciones pagos. El tono debe ser cálido y emocionante.',
      is_system: true,
      venue_id: null,
      sort_order: 1
    },
    {
      code: 'pre_stay',
      name: 'Recordatorio pre-estadía',
      category: 'engagement',
      content: 'Genera un mensaje para enviar 1 día antes de la llegada del cliente. Incluye: recordatorio de la fecha y hora de llegada, indicaciones para llegar, recordatorio del plan contratado y qué incluye, cualquier preparación que deba hacer el cliente. Tono de emoción y anticipación: "¡Ya casi es el día!"',
      is_system: true,
      venue_id: null,
      sort_order: 2
    },
    {
      code: 'post_stay',
      name: 'Follow-up post-estadía',
      category: 'engagement',
      content: 'Genera un mensaje para enviar 1 día después de que el cliente se fue. Incluye: agradecimiento por visitarnos, invitación a seguirnos en redes sociales (Instagram del venue), pedirle que nos etiquete en sus fotos y nos comparta su experiencia, mencionar que nos encanta ver cómo nuestros clientes disfrutan. Si hay un depósito pendiente de devolver (verificado), mencionar que está en proceso de devolución según las reglas. Si no hay depósito, NO menciones depósitos. Tono cálido y cercano, orientado a crear comunidad.',
      is_system: true,
      venue_id: null,
      sort_order: 3
    },
    {
      code: 'location',
      name: '¿Cómo llegar?',
      category: 'ubicacion',
      content: 'Proporciona instrucciones de cómo llegar al venue usando la información de dirección, enlaces de Waze y Google Maps disponibles.',
      is_system: true,
      venue_id: null,
      sort_order: 4
    },
    {
      code: 'wifi',
      name: 'Clave del WiFi',
      category: 'wifi',
      content: 'Proporciona la información del WiFi: nombre de red (SSID) y contraseña.',
      is_system: true,
      venue_id: null,
      sort_order: 5
    },
    {
      code: 'delivery',
      name: 'Domicilios cercanos',
      category: 'domicilios',
      content: 'Proporciona información sobre servicios de domicilios cercanos disponibles.',
      is_system: true,
      venue_id: null,
      sort_order: 6
    },
    {
      code: 'beer_delivery',
      name: 'Domicilios de cervezas',
      category: 'domicilios',
      content: 'Proporciona información sobre servicios de domicilios de cervezas disponibles.',
      is_system: true,
      venue_id: null,
      sort_order: 7
    },
    {
      code: 'plans',
      name: 'Información de planes',
      category: 'planes',
      content: 'Proporciona información detallada sobre los planes disponibles, precios, y qué incluyen.',
      is_system: true,
      venue_id: null,
      sort_order: 8
    },
    {
      code: 'general_info',
      name: 'Información general',
      category: 'general',
      content: 'Proporciona información general sobre el venue, horarios, servicios y amenidades.',
      is_system: true,
      venue_id: null,
      sort_order: 9
    }
  ];

  for (const template of defaultTemplates) {
    const existing = await prisma.message_templates.findFirst({
      where: { code: template.code, venue_id: null }
    });
    if (existing) {
      await prisma.message_templates.update({
        where: { id: existing.id },
        data: { content: template.content, sort_order: template.sort_order }
      });
    } else {
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

  // ==================== Health Check (no auth — for external monitors) ====================
  app.get('/api/health', async (req, res) => {
    const components = {};
    let allHealthy = true;
    let dbUp = true;

    // 1. Database
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      components.database = { status: 'up', latency_ms: Date.now() - start };
    } catch (err) {
      components.database = { status: 'down', error: err.message };
      allHealthy = false;
      dbUp = false;
    }

    // 2. WhatsApp microservice
    if (process.env.WHATSAPP_SERVICE_URL) {
      try {
        const start = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(`${process.env.WHATSAPP_SERVICE_URL}/api/health`, { signal: controller.signal });
        clearTimeout(timeout);
        if (resp.ok) {
          const data = await resp.json();
          components.whatsapp_service = {
            status: 'up',
            latency_ms: Date.now() - start,
            venue_connections: data.venue_connections ?? null
          };
        } else {
          components.whatsapp_service = { status: 'down', error: `HTTP ${resp.status}` };
          allHealthy = false;
        }
      } catch (err) {
        components.whatsapp_service = { status: 'down', error: err.message };
        allHealthy = false;
      }
    }

    const status = !dbUp ? 'unhealthy' : !allHealthy ? 'degraded' : 'healthy';
    const httpCode = !dbUp ? 503 : 200;

    res.status(httpCode).json({
      status,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      components
    });
  });

  // Upload endpoints - Cloudinary
  app.post('/api/uploads/receipt', isAuthenticated, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No se proporcionó archivo o tipo no permitido' });
      }
      const result = await uploadImage(req.file.buffer, { type: 'receipt', mimetype: req.file.mimetype });
      res.json({ imageUrl: result.secure_url });
    } catch (error) {
      console.error('Error uploading receipt:', error);
      res.status(500).json({ error: 'Error al subir la imagen' });
    }
  });

  // Upload chat media (internal key auth for microservice, or authenticated user)
  app.post('/api/uploads/chat-media', upload.single('file'), async (req, res) => {
    try {
      // Auth: either internal key or authenticated user
      const internalKey = req.headers['x-internal-key'];
      const isInternalAuth = internalKey && internalKey === process.env.WHATSAPP_INTERNAL_KEY;
      if (!isInternalAuth && !req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }
      const result = await uploadImage(req.file.buffer, { type: 'chat_media', mimetype: req.file.mimetype });
      res.json({ url: result.secure_url });
    } catch (error) {
      console.error('Error uploading chat media:', error);
      res.status(500).json({ error: 'Error uploading image' });
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
          avatar_url: true,
          profile: { select: { code: true, name: true } }
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

  // Public venue page endpoint (no auth)
  app.get('/api/public/venues/:slug', async (req, res) => {
    try {
      const venue = await prisma.venues.findUnique({
        where: { slug: req.params.slug }
      });
      if (!venue || !venue.is_public) {
        return res.status(404).json({ error: 'Venue not found' });
      }

      // Load images, amenities, plans, and payment methods in parallel
      const [images, venueAmenityLinks, plans, paymentMethods] = await Promise.all([
        prisma.venue_images.findMany({
          where: { venue_id: venue.id },
          orderBy: { sort_order: 'asc' }
        }),
        prisma.venue_amenities.findMany({
          where: { venue_id: venue.id }
        }),
        prisma.venue_plans.findMany({
          where: { venue_id: venue.id, is_active: true },
          orderBy: { name: 'asc' }
        }),
        prisma.venue_payment_methods.findMany({
          where: { venue_id: venue.id, is_active: true },
          orderBy: { sort_order: 'asc' },
          select: { id: true, method_type: true, label: true, account_info: true, holder_name: true, qr_image_url: true, instructions: true }
        })
      ]);

      // Resolve amenity details
      const amenityIds = venueAmenityLinks.map(va => va.amenity_id);
      const amenities = amenityIds.length > 0
        ? await prisma.amenities.findMany({ where: { id: { in: amenityIds }, is_active: true } })
        : [];

      // Load plan amenities
      const planIds = plans.map(p => p.id);
      const planAmenityLinks = planIds.length > 0
        ? await prisma.plan_amenities.findMany({ where: { plan_id: { in: planIds } } })
        : [];
      const planAmenityIds = [...new Set(planAmenityLinks.map(pa => pa.amenity_id))];
      const planAmenities = planAmenityIds.length > 0
        ? await prisma.amenities.findMany({ where: { id: { in: planAmenityIds } } })
        : [];
      const amenityMap = {};
      for (const a of planAmenities) amenityMap[a.id] = a;

      const plansWithAmenities = plans.map(p => {
        const pAmenities = planAmenityLinks
          .filter(pa => pa.plan_id === p.id)
          .map(pa => ({ ...amenityMap[pa.amenity_id], quantity: pa.quantity, notes: pa.notes }))
          .filter(Boolean);
        return { ...p, amenities: pAmenities };
      });

      // Return only public-safe fields
      res.json({
        venue: {
          id: venue.id, name: venue.name, slug: venue.slug,
          whatsapp: venue.whatsapp, instagram: venue.instagram,
          address: venue.address, city: venue.city, department: venue.department,
          suburb: venue.suburb, country: venue.country, address_reference: venue.address_reference,
          latitude: venue.latitude, longitude: venue.longitude,
          waze_link: venue.waze_link, google_maps_link: venue.google_maps_link,
          venue_info: venue.venue_info, delivery_info: venue.delivery_info,
          brand_color_primary: venue.brand_color_primary,
          brand_color_secondary: venue.brand_color_secondary,
          logo_url: venue.logo_url
        },
        images,
        amenities,
        plans: plansWithAmenities,
        paymentMethods
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Public availability check (no auth, no LLM) — used by booking widget
  const availabilityRateLimit = new Map(); // IP -> { count, resetAt }
  app.post('/api/public/venues/:id/availability', async (req, res) => {
    try {
      // Rate limit: 10 requests per minute per IP
      const ip = req.ip || req.connection.remoteAddress;
      const now = Date.now();
      const rl = availabilityRateLimit.get(ip);
      if (rl && rl.resetAt > now) {
        if (rl.count >= 10) {
          return res.status(429).json({ error: 'Demasiadas consultas. Intenta en un momento.' });
        }
        rl.count++;
      } else {
        availabilityRateLimit.set(ip, { count: 1, resetAt: now + 60000 });
      }
      // Cleanup stale entries every 100 requests
      if (availabilityRateLimit.size > 500) {
        for (const [k, v] of availabilityRateLimit) {
          if (v.resetAt <= now) availabilityRateLimit.delete(k);
        }
      }

      const venueId = req.params.id;
      const { check_in, check_out, adults, children, plan_id } = req.body;

      if (!check_in) {
        return res.status(400).json({ error: 'check_in es requerido' });
      }

      const venue = await prisma.venues.findUnique({ where: { id: venueId } });
      if (!venue || !venue.is_public) {
        return res.status(404).json({ error: 'Venue not found' });
      }

      // Parse and validate dates
      const checkInDate = new Date(check_in);
      const checkOutDate = check_out ? new Date(check_out) : checkInDate;
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const checkInDay = new Date(checkInDate.getUTCFullYear(), checkInDate.getUTCMonth(), checkInDate.getUTCDate());
      const checkOutDay = new Date(checkOutDate.getUTCFullYear(), checkOutDate.getUTCMonth(), checkOutDate.getUTCDate());

      if (checkInDay < today) {
        return res.status(400).json({ error: 'La fecha de llegada está en el pasado.' });
      }
      if (checkOutDay < checkInDay) {
        return res.status(400).json({ error: 'La fecha de salida debe ser igual o posterior a la de llegada.' });
      }

      const numAdults = parseInt(adults) || 1;
      const numChildren = parseInt(children) || 0;
      const totalGuests = numAdults + numChildren;

      // Check overlapping accommodations
      const existingAccommodations = await prisma.accommodations.findMany({
        where: { venue: venueId }
      });

      let isAvailable = true;
      for (const acc of existingAccommodations) {
        const accDate = new Date(acc.date);
        const durationSeconds = parseInt(acc.duration) || 43200;
        const accEndDate = new Date(accDate.getTime() + durationSeconds * 1000);
        const accStartDay = new Date(accDate.getUTCFullYear(), accDate.getUTCMonth(), accDate.getUTCDate());
        const accEndDay = new Date(accEndDate.getUTCFullYear(), accEndDate.getUTCMonth(), accEndDate.getUTCDate());

        if (accStartDay <= checkOutDay && accEndDay >= checkInDay) {
          isAvailable = false;
          break;
        }
      }

      // Load active plans for this venue
      const plans = await prisma.venue_plans.findMany({
        where: { venue_id: venueId, is_active: true },
        orderBy: { name: 'asc' }
      });

      // Filter suitable plans by guest count (and optionally by plan_id)
      const suitablePlans = plans.filter(p => {
        const planMin = p.min_guests || 1;
        const planMax = p.max_capacity || 999;
        const fits = totalGuests >= planMin && totalGuests <= planMax;
        return plan_id ? (fits && p.id === plan_id) : fits;
      }).map(p => {
        const adultTotal = numAdults * parseFloat(p.adult_price);
        const childTotal = numChildren * parseFloat(p.child_price);
        return {
          id: p.id,
          name: p.name,
          plan_type: p.plan_type,
          adult_price: parseFloat(p.adult_price),
          child_price: parseFloat(p.child_price),
          estimated_total: adultTotal + childTotal,
          check_in_time: p.check_in_time,
          check_out_time: p.check_out_time,
          includes_overnight: p.includes_overnight
        };
      });

      // Get next available dates if not available
      let nextAvailableDates = [];
      if (!isAvailable) {
        const checkInDayOfWeek = checkInDate.getDay();
        const preferWeekends = checkInDayOfWeek === 0 || checkInDayOfWeek === 6;
        const stayLength = Math.max(1, Math.ceil((checkOutDay - checkInDay) / (1000 * 60 * 60 * 24)) + 1);
        nextAvailableDates = llmService.getNextAvailableDates(existingAccommodations, checkInDate, {
          preferWeekends,
          stayLength,
          numDays: 30
        });
      }

      res.json({
        is_available: isAvailable,
        check_in: check_in,
        check_out: check_out || check_in,
        adults: numAdults,
        children: numChildren,
        total_guests: totalGuests,
        suitable_plans: suitablePlans,
        next_available_dates: nextAvailableDates
      });
    } catch (error) {
      console.error('Availability check error:', error);
      res.status(500).json({ error: 'Error checking availability' });
    }
  });

  // Public conversation loader (no auth) — restores chat for returning visitors
  app.get('/api/public/chat/conversation/:id', async (req, res) => {
    try {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid conversation ID' });
      }

      const conversation = await prisma.chat_conversations.findUnique({
        where: { id: req.params.id },
        include: {
          messages: {
            orderBy: { created_at: 'asc' },
            select: { role: true, content: true, created_at: true }
          }
        }
      });

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const messages = conversation.messages.map(m => ({
        role: m.role,
        content: m.content.replace(/\n<!-- \{.*?\} -->/g, ''),
        created_at: m.created_at
      }));

      const messageCount = messages.filter(m => m.role === 'user').length;
      const limitSetting = await prisma.app_settings.findUnique({
        where: { setting_key: 'public_chat_free_limit' }
      });
      const freeLimit = parseInt(limitSetting?.setting_value) || 20;
      const isVerified = conversation.metadata?.verified === true;

      res.json({
        id: conversation.id,
        venue_id: conversation.venue_id,
        name: conversation.name,
        phone: conversation.phone,
        messages,
        message_count: messageCount,
        free_limit: freeLimit,
        is_verified: isVerified
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Request verification code for public chat
  app.post('/api/public/chat/verify/request', async (req, res) => {
    try {
      const { conversation_id, phone } = req.body;
      if (!conversation_id || !phone) {
        return res.status(400).json({ error: 'conversation_id and phone are required' });
      }

      const conversation = await prisma.chat_conversations.findUnique({
        where: { id: conversation_id }
      });
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Rate limit: max 3 requests per hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentRequests = await prisma.public_chat_verifications.count({
        where: { conversation_id, created_at: { gte: oneHourAgo } }
      });
      if (recentRequests >= 3) {
        return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta de nuevo en una hora.' });
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));

      await prisma.public_chat_verifications.create({
        data: {
          conversation_id,
          phone,
          code,
          expires_at: new Date(Date.now() + 10 * 60 * 1000)
        }
      });

      // Send code via system WhatsApp (microservice)
      let codeSent = false;
      try {
        if (whatsappClient.isAvailable()) {
          const systemStatus = await whatsappClient.getSystemStatus();
          if (systemStatus?.status === 'connected') {
            const waMsg = `🔐 *CabanIA* — Código de verificación\n\nTu código es: *${code}*\n\nExpira en 10 minutos. No compartas este código.`;
            const result = await whatsappClient.sendSystemMessage(phone, waMsg);
            if (result?.success) codeSent = true;
          }
        }
      } catch (waErr) {
        console.warn('[chat-verify] WhatsApp send failed:', waErr.message);
      }

      const response = { success: true, message: 'Código de verificación enviado', codeSent };
      if (process.env.NODE_ENV !== 'production') {
        response.code = code; // Dev only
      }
      res.json(response);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Confirm verification code for public chat
  app.post('/api/public/chat/verify/confirm', async (req, res) => {
    try {
      const { conversation_id, code } = req.body;
      if (!conversation_id || !code) {
        return res.status(400).json({ error: 'conversation_id and code are required' });
      }

      const verification = await prisma.public_chat_verifications.findFirst({
        where: {
          conversation_id,
          status: 'pending',
          expires_at: { gte: new Date() }
        },
        orderBy: { created_at: 'desc' }
      });

      if (!verification) {
        return res.status(404).json({ error: 'No hay código pendiente o ya expiró' });
      }

      if (verification.attempts >= 5) {
        await prisma.public_chat_verifications.update({
          where: { id: verification.id },
          data: { status: 'expired' }
        });
        return res.status(429).json({ error: 'Demasiados intentos. Solicita un nuevo código.' });
      }

      await prisma.public_chat_verifications.update({
        where: { id: verification.id },
        data: { attempts: verification.attempts + 1 }
      });

      if (verification.code !== code.trim()) {
        return res.status(400).json({
          error: 'Código incorrecto',
          attempts_remaining: 5 - (verification.attempts + 1)
        });
      }

      // Mark verified
      await prisma.public_chat_verifications.update({
        where: { id: verification.id },
        data: { status: 'verified', verified_at: new Date() }
      });

      // Update conversation metadata
      const conversation = await prisma.chat_conversations.findUnique({
        where: { id: conversation_id }
      });
      const metadata = conversation.metadata || {};
      metadata.verified = true;
      metadata.verified_at = new Date().toISOString();
      metadata.verified_phone = verification.phone;

      await prisma.chat_conversations.update({
        where: { id: conversation_id },
        data: { metadata, phone: verification.phone, updated_at: new Date() }
      });

      res.json({ success: true, verified: true });
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

  app.post('/api/venues', isAuthenticated, requirePermission('venues:create'), async (req, res) => {
    try {
      const venue = await prisma.venues.create({
        data: req.body
      });
      res.json(venue);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/venues/:id', isAuthenticated, requirePermission('venues:edit'), async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.deposit_max_people_included !== undefined) {
        data.deposit_max_people_included = data.deposit_max_people_included ? parseInt(data.deposit_max_people_included, 10) : null;
      }
      if (data.deposit_refund_hours !== undefined) {
        data.deposit_refund_hours = data.deposit_refund_hours ? parseInt(data.deposit_refund_hours, 10) : null;
      }
      if (data.commission_percentage !== undefined) {
        data.commission_percentage = data.commission_percentage ? parseFloat(data.commission_percentage) : null;
      }

      // Auto-generate slug when is_public=true and slug is empty
      if (data.is_public && !data.slug && data.name) {
        let baseSlug = data.name
          .toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        let slug = baseSlug;
        let suffix = 1;
        while (true) {
          const existing = await prisma.venues.findUnique({ where: { slug } });
          if (!existing || existing.id === req.params.id) break;
          slug = `${baseSlug}-${suffix++}`;
        }
        data.slug = slug;
      }

      const venue = await prisma.venues.update({
        where: { id: req.params.id },
        data
      });
      res.json(venue);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/venues/:id', isAuthenticated, requirePermission('venues:delete'), async (req, res) => {
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

  // ========================================
  // VENUE PAYMENT METHODS
  // ========================================

  const PAYMENT_METHOD_CATALOG = [
    { type: 'nequi', label: 'Nequi', icon: 'cil-phone' },
    { type: 'daviplata', label: 'Daviplata', icon: 'cil-phone' },
    { type: 'bancolombia', label: 'Bancolombia', icon: 'cil-institution' },
    { type: 'davivienda', label: 'Davivienda', icon: 'cil-institution' },
    { type: 'breb', label: 'Bre-B', icon: 'cil-mobile' },
    { type: 'pse', label: 'PSE', icon: 'cil-laptop' },
    { type: 'credit_card_national', label: 'Tarjeta de Crédito Nacional', icon: 'cil-credit-card' },
    { type: 'credit_card_international', label: 'Tarjeta de Crédito Internacional', icon: 'cil-credit-card' },
    { type: 'cash', label: 'Efectivo', icon: 'cil-dollar' },
    { type: 'custom', label: 'Otro', icon: 'cil-options' }
  ];

  app.get('/api/venues/:id/payment-methods/catalog', isAuthenticated, async (req, res) => {
    res.json(PAYMENT_METHOD_CATALOG);
  });

  app.get('/api/venues/:id/payment-methods', isAuthenticated, async (req, res) => {
    try {
      const methods = await prisma.venue_payment_methods.findMany({
        where: { venue_id: req.params.id },
        orderBy: { sort_order: 'asc' }
      });
      res.json(methods);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/venues/:id/payment-methods', isAuthenticated, upload.single('qr_image'), async (req, res) => {
    try {
      const { method_type, label, account_info, holder_name, instructions, is_active } = req.body;
      let qr_image_url = req.body.qr_image_url || null;

      if (req.file) {
        const result = await uploadImage(req.file.buffer, { type: 'payment_method', mimetype: req.file.mimetype });
        qr_image_url = result.secure_url;
      }

      const maxOrder = await prisma.venue_payment_methods.aggregate({
        where: { venue_id: req.params.id },
        _max: { sort_order: true }
      });

      const method = await prisma.venue_payment_methods.create({
        data: {
          venue_id: req.params.id,
          method_type,
          label,
          account_info: account_info || null,
          holder_name: holder_name || null,
          qr_image_url,
          instructions: instructions || null,
          is_active: is_active !== 'false',
          sort_order: (maxOrder._max.sort_order || 0) + 1
        }
      });
      res.json(method);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/venues/:id/payment-methods/:methodId', isAuthenticated, upload.single('qr_image'), async (req, res) => {
    try {
      const { method_type, label, account_info, holder_name, instructions, is_active } = req.body;
      const data = {
        method_type,
        label,
        account_info: account_info || null,
        holder_name: holder_name || null,
        instructions: instructions || null,
        is_active: is_active !== 'false',
        updated_at: new Date()
      };

      if (req.file) {
        // Delete old QR if exists
        const existing = await prisma.venue_payment_methods.findUnique({ where: { id: req.params.methodId } });
        if (existing?.qr_image_url) {
          const oldPublicId = extractPublicId(existing.qr_image_url);
          if (oldPublicId) await deleteImage(oldPublicId);
        }
        const result = await uploadImage(req.file.buffer, { type: 'payment_method', mimetype: req.file.mimetype });
        data.qr_image_url = result.secure_url;
      } else if (req.body.qr_image_url !== undefined) {
        data.qr_image_url = req.body.qr_image_url || null;
      }

      const method = await prisma.venue_payment_methods.update({
        where: { id: req.params.methodId },
        data
      });
      res.json(method);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/venues/:id/payment-methods/reorder', isAuthenticated, async (req, res) => {
    try {
      const { order } = req.body; // Array of { id, sort_order }
      for (const item of order) {
        await prisma.venue_payment_methods.update({
          where: { id: item.id },
          data: { sort_order: item.sort_order }
        });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/venues/:id/payment-methods/:methodId', isAuthenticated, async (req, res) => {
    try {
      const method = await prisma.venue_payment_methods.findUnique({ where: { id: req.params.methodId } });
      if (method?.qr_image_url) {
        const publicId = extractPublicId(method.qr_image_url);
        if (publicId) await deleteImage(publicId);
      }
      await prisma.venue_payment_methods.delete({ where: { id: req.params.methodId } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Public payment methods (no auth)
  app.get('/api/public/venues/:slug/payment-methods', async (req, res) => {
    try {
      const venue = await prisma.venues.findUnique({ where: { slug: req.params.slug } });
      if (!venue || !venue.is_public) {
        return res.status(404).json({ error: 'Venue not found' });
      }
      const methods = await prisma.venue_payment_methods.findMany({
        where: { venue_id: venue.id, is_active: true },
        orderBy: { sort_order: 'asc' },
        select: { id: true, method_type: true, label: true, account_info: true, holder_name: true, qr_image_url: true, instructions: true }
      });
      res.json(methods);
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
      
      // :own pattern — only show contacts linked to user's own accommodations
      if (hasOwnOnly(req.userPermissions, 'contacts:view')) {
        const currentUserId = req.user ? String(req.user.claims?.sub) : null;
        if (!currentUserId) return res.json([]);
        const ownAccommodations = await prisma.accommodations.findMany({
          where: { created_by: currentUserId, customer: { not: null } },
          select: { customer: true }
        });
        const ownContactIds = [...new Set(ownAccommodations.map(a => a.customer))];
        const filtered = contacts.filter(c => ownContactIds.includes(c.id));
        return res.json(filtered);
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

      // :own pattern — redact details for accommodations not created by this user
      // Exception: commission agents can see full details of their linked accommodations
      if (hasOwnOnly(req.userPermissions, 'accommodations:view')) {
        const currentUserId = req.user ? String(req.user.claims?.sub) : null;
        const agentAccIds = await getAgentAccommodationIds(currentUserId);
        const result = enriched.map(a => {
          if (a.created_by === currentUserId || agentAccIds.has(a.id)) return a;
          return {
            id: a.id,
            venue: a.venue,
            date: a.date,
            duration: a.duration,
            time: a.time,
            plan_id: a.plan_id,
            created_at: a.created_at,
            venue_data: a.venue_data ? { id: a.venue_data.id, name: a.venue_data.name } : null,
            customer: null,
            customer_data: null,
            adults: null,
            children: null,
            agreed_price: null,
            calculated_price: null,
            total_paid: null,
            pending_balance: null,
            created_by: null,
            _redacted: true,
          };
        });
        return res.json(result);
      }

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
      
      // :own pattern — redact if user only has accommodations:view:own and this isn't theirs
      // Exception: commission agents can see full details of their linked accommodations
      if (hasOwnOnly(req.userPermissions, 'accommodations:view')) {
        const currentUserId = req.user ? String(req.user.claims?.sub) : null;
        const isAgent = await isCommissionAgentForAccommodation(currentUserId, accommodation);
        if (accommodation.created_by !== currentUserId && !isAgent) {
          return res.json({
            id: accommodation.id,
            venue: accommodation.venue,
            date: accommodation.date,
            duration: accommodation.duration,
            time: accommodation.time,
            plan_id: accommodation.plan_id,
            created_at: accommodation.created_at,
            venue_data: venue_data ? { id: venue_data.id, name: venue_data.name } : null,
            customer: null, customer_data: null,
            adults: null, children: null,
            agreed_price: null, calculated_price: null,
            created_by: null,
            _redacted: true,
          });
        }
      }

      res.json({ ...accommodation, venue_data, customer_data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/accommodations', isAuthenticated, async (req, res) => {
    try {
      const { venue, date, time, duration, customer, adults, children, plan_id, calculated_price, agreed_price, commission_agent_id } = req.body;
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
      const userId = req.user ? String(req.user.claims?.sub) : null;
      if (userId) {
        data.created_by = userId;
      }

      // Commission agent assignment
      if (commission_agent_id) {
        // Manual assignment from admin
        data.commission_agent_id = commission_agent_id;
      } else if (venue && userId) {
        // Auto-assign if creator is linked to an agent for this venue
        const linkedAgent = await prisma.commission_agents.findFirst({
          where: { user_id: userId, venue_id: venue, is_active: true }
        });
        if (linkedAgent) {
          data.commission_agent_id = linkedAgent.id;
        }
      }

      const accommodation = await prisma.accommodations.create({ data });
      res.json(accommodation);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/accommodations/:id', isAuthenticated, async (req, res) => {
    try {
      // :own pattern — only allow editing own accommodations
      if (hasOwnOnly(req.userPermissions, 'accommodations:edit')) {
        const existing = await prisma.accommodations.findUnique({ where: { id: req.params.id }, select: { created_by: true } });
        const currentUserId = String(req.user.claims?.sub);
        if (!existing || existing.created_by !== currentUserId) {
          return res.status(403).json({ error: 'Solo puede editar reservas que usted creó' });
        }
      }

      const { venue, date, time, duration, customer, adults, children, plan_id, calculated_price, agreed_price, commission_agent_id } = req.body;
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

      // Only admins (not :own-only users) can change commission_agent_id
      if (!hasOwnOnly(req.userPermissions, 'accommodations:edit')) {
        data.commission_agent_id = commission_agent_id || null;
      }

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
      // :own pattern — only allow deleting own accommodations
      if (hasOwnOnly(req.userPermissions, 'accommodations:delete')) {
        const existing = await prisma.accommodations.findUnique({ where: { id: req.params.id }, select: { created_by: true } });
        const currentUserId = String(req.user.claims?.sub);
        if (!existing || existing.created_by !== currentUserId) {
          return res.status(403).json({ error: 'Solo puede eliminar reservas que usted creó' });
        }
      }

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

      // :own pattern — only show payments for user's own accommodations
      // Exception: commission agents can see payments for their linked accommodations
      if (hasOwnOnly(req.userPermissions, 'payments:view')) {
        const currentUserId = req.user ? String(req.user.claims?.sub) : null;
        if (!currentUserId) return res.json([]);
        const ownAccIds = await prisma.accommodations.findMany({
          where: { created_by: currentUserId },
          select: { id: true }
        });
        const ownAccIdSet = new Set(ownAccIds.map(a => a.id));
        const agentAccIds = await getAgentAccommodationIds(currentUserId);
        return res.json(enriched.filter(p => p.accommodation && (ownAccIdSet.has(p.accommodation) || agentAccIds.has(p.accommodation))));
      }

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

      // :own pattern — only allow verifying payments for own accommodations
      if (hasOwnOnly(req.userPermissions, 'payments:verify')) {
        const currentUserId = String(req.user.claims?.sub);
        if (currentPayment.accommodation) {
          const acc = await prisma.accommodations.findUnique({ where: { id: currentPayment.accommodation }, select: { created_by: true } });
          if (!acc || acc.created_by !== currentUserId) {
            return res.status(403).json({ error: 'Solo puede verificar pagos de sus propias reservas' });
          }
        }
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
          date: currentPayment.payment_date || accommodation?.date || new Date(),
          accrual_date: accommodation?.date || null
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

      // Update linked estimate and notify client via WhatsApp
      if (verified === true) {
        const linkedEstimate = await prisma.estimates.findFirst({
          where: { payment_id: paymentId }
        });
        if (linkedEstimate) {
          await prisma.estimates.update({
            where: { id: linkedEstimate.id },
            data: { payment_status: 'verified', updated_at: new Date() }
          });

          // Notify client via WhatsApp
          if (linkedEstimate.conversation_id) {
            const conv = await prisma.chat_conversations.findUnique({
              where: { id: linkedEstimate.conversation_id }
            });
            if (conv?.phone && conv?.venue_id) {
              try {
                const venueForNotif = await prisma.venues.findUnique({ where: { id: conv.venue_id } });
                const confirmMsg = `✅ *¡Pago Verificado!*\n\n¡Hola ${conv.name || ''}! Tu pago ha sido verificado exitosamente. Tu reserva en *${venueForNotif?.name || 'la cabaña'}* está confirmada.\n\n¡Te esperamos! 🎉`;
                await sendWhatsAppReply(conv.venue_id, conv.phone, confirmMsg);
              } catch (notifErr) {
                console.error('[payment-verify] Failed to notify client:', notifErr.message);
              }
            }
          }
        }
      } else if (verified === false) {
        // Reject linked estimate
        const linkedEstimate = await prisma.estimates.findFirst({
          where: { payment_id: paymentId }
        });
        if (linkedEstimate) {
          await prisma.estimates.update({
            where: { id: linkedEstimate.id },
            data: { payment_status: 'rejected', updated_at: new Date() }
          });
        }
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
      const { basis } = req.query;
      const dateField = basis === 'accrual' ? 'accrual_date' : 'date';
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
          [dateField]: { gte: currentMonthStart }
        }
      });

      // Previous month incomes
      const previousMonthIncomes = await prisma.incomes.findMany({
        where: {
          ...whereClause,
          [dateField]: { gte: previousMonthStart, lte: previousMonthEnd }
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
      const { period, basis } = req.query;
      const dateField = basis === 'accrual' ? 'accrual_date' : 'date';
      const orgIds = await getAnalyticsOrgIds(req);

      if (orgIds !== null && orgIds.length === 0) {
        return res.json([]);
      }

      const whereClause = orgIds !== null ? { organization_id: { in: orgIds } } : {};

      // Add date filter if period is specified
      if (period) {
        const { startDate, endDate } = calculateDateRange(period);
        whereClause[dateField] = {
          gte: startDate,
          lte: endDate
        };
      }

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
      
      // Calculate date range for last N months (default 12)
      const numMonths = Math.min(Math.max(parseInt(req.query.months) || 12, 1), 24);
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth() - (numMonths - 1), 1);

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
      for (let i = numMonths - 1; i >= 0; i--) {
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
      
      // Calculate date range for next N months (default 12)
      const numMonths = Math.min(Math.max(parseInt(req.query.months) || 12, 1), 24);
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = new Date(now.getFullYear(), now.getMonth() + numMonths, 0);

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
      for (let i = 0; i < numMonths; i++) {
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

  // Helper function for date range calculation
  function calculateDateRange(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let startDate, endDate;

    switch (period) {
      case 'next_12_months':
        startDate = today;
        endDate = new Date(now.getFullYear(), now.getMonth() + 12, now.getDate());
        break;
      case 'next_3_months':
        startDate = today;
        endDate = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());
        break;
      case 'next_month':
        startDate = today;
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
        break;
      case 'this_month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'last_month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'this_quarter':
        const quarterStart = Math.floor(now.getMonth() / 3) * 3;
        startDate = new Date(now.getFullYear(), quarterStart, 1);
        endDate = new Date(now.getFullYear(), quarterStart + 3, 0);
        break;
      case 'this_year':
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31);
        break;
      case 'last_3_months':
        startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
        endDate = today;
        break;
      case 'last_6_months':
        startDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
        endDate = today;
        break;
      case 'last_12_months':
      default:
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        endDate = today;
        break;
    }

    return { startDate, endDate };
  }

  // Accommodations count by venue with flexible date range
  app.get('/api/analytics/accommodations-by-venue', isAuthenticated, async (req, res) => {
    try {
      const { period } = req.query;
      const orgIds = await getAnalyticsOrgIds(req);

      if (orgIds !== null && orgIds.length === 0) {
        return res.json([]);
      }

      const { startDate, endDate } = calculateDateRange(period);

      // Get venue IDs for accessible organizations
      let venueIds = null;
      if (orgIds !== null) {
        const venues = await prisma.venues.findMany({
          where: { organization: { in: orgIds } },
          select: { id: true }
        });
        venueIds = venues.map(v => v.id);
        if (venueIds.length === 0) {
          return res.json([]);
        }
      }

      // Build where clause
      const whereClause = {
        date: { gte: startDate, lte: endDate }
      };
      if (venueIds !== null) {
        whereClause.venue = { in: venueIds };
      }

      // Get accommodations grouped by venue
      const accommodations = await prisma.accommodations.groupBy({
        by: ['venue'],
        where: whereClause,
        _count: { id: true }
      });

      // Get venue names
      const venueIdsFromResults = accommodations
        .filter(a => a.venue)
        .map(a => a.venue);

      const venues = venueIdsFromResults.length > 0
        ? await prisma.venues.findMany({
            where: { id: { in: venueIdsFromResults } }
          })
        : [];

      const venueMap = Object.fromEntries(venues.map(v => [v.id, v.name]));

      const result = accommodations
        .filter(a => a.venue)
        .map(a => ({
          venue_id: a.venue,
          venue_name: venueMap[a.venue] || 'Sin nombre',
          count: a._count.id
        }))
        .sort((a, b) => b.count - a.count);

      res.json(result);
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

  app.get('/api/users', isAuthenticated, requirePermission('users:view'), async (req, res) => {
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
      if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
      // Find linked contact — user field is UUID, so only query if ID looks like a UUID
      let linked_contact = null;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(req.params.id)) {
        linked_contact = await prisma.contacts.findFirst({
          where: { user: req.params.id }
        });
      }
      res.json({ ...user, linked_contact: linked_contact || null });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/users', isAuthenticated, requirePermission('users:edit'), async (req, res) => {
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

  app.put('/api/users/:id', isAuthenticated, requirePermission('users:edit'), async (req, res) => {
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

  app.delete('/api/users/:id', isAuthenticated, requirePermission('users:edit'), async (req, res) => {
    try {
      await prisma.users.delete({
        where: { id: req.params.id }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/users/:id/lock', isAuthenticated, requirePermission('users:lock'), async (req, res) => {
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

  app.post('/api/users/:id/unlock', isAuthenticated, requirePermission('users:lock'), async (req, res) => {
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

  // Generate temporary key for a user (saves hashed password, returns plain key)
  app.post('/api/users/:id/generate-temp-key', isAuthenticated, requirePermission('users:edit'), async (req, res) => {
    try {
      if (!req.user?.is_super_admin && !hasPermission(req.userPermissions, 'users:manage')) {
        return res.status(403).json({ error: 'No tiene permiso para gestionar usuarios' });
      }

      const user = await prisma.users.findUnique({ where: { id: req.params.id } });
      if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

      // Generate random 8-character alphanumeric temp key
      const tempKey = require('crypto').randomBytes(4).toString('hex');

      // Hash and save as password
      const bcryptUsers = require('bcryptjs');
      const hash = await bcryptUsers.hash(tempKey, 10);
      await prisma.users.update({
        where: { id: req.params.id },
        data: { password_hash: hash }
      });

      res.json({ success: true, tempKey });
    } catch (error) {
      console.error('Error generating temp key:', error);
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
  app.get('/api/profiles', isAuthenticated, requirePermission('profiles:view'), async (req, res) => {
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
  app.get('/api/permissions', isAuthenticated, requirePermission('profiles:view'), async (req, res) => {
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

  app.put('/api/users/:id/organizations', isAuthenticated, requirePermission('users:edit'), async (req, res) => {
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

  // Remove user from organization
  app.delete('/api/organizations/:orgId/users/:userId', isAuthenticated, async (req, res) => {
    try {
      const currentUserId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: currentUserId } });
      if (!currentUser?.is_super_admin && !hasPermission(req.userPermissions, 'users:edit')) {
        return res.status(403).json({ error: 'No tiene permiso para gestionar accesos' });
      }

      // Prevent removing yourself
      if (req.params.userId === currentUserId) {
        return res.status(400).json({ error: 'No puedes remover tu propio acceso' });
      }

      await prisma.user_organizations.deleteMany({
        where: { user_id: req.params.userId, organization_id: req.params.orgId }
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update user profile
  app.put('/api/users/:id/profile', isAuthenticated, requirePermission('users:edit'), async (req, res) => {
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
      const image = await prisma.plan_images.findUnique({ where: { id: req.params.id } });
      if (image?.image_url) {
        const publicId = extractPublicId(image.image_url);
        if (publicId) await deleteImage(publicId);
      }
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
      const image = await prisma.venue_images.findUnique({ where: { id: req.params.id } });
      if (image?.image_url) {
        const publicId = extractPublicId(image.image_url);
        if (publicId) await deleteImage(publicId);
      }
      await prisma.venue_images.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generic upload URL for plans/venues images
  app.post('/api/uploads/image', isAuthenticated, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No se proporcionó archivo o tipo no permitido' });
      }
      const type = req.body.type || 'venue';
      const result = await uploadImage(req.file.buffer, { type, mimetype: req.file.mimetype });
      res.json({ imageUrl: result.secure_url });
    } catch (error) {
      console.error('Error uploading image:', error);
      res.status(500).json({ error: 'Error al subir la imagen' });
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
      const { venue_id, organization_id, category_id, accommodation_id, from_date, to_date, viewAll } = req.query;
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
      if (accommodation_id) whereClause.accommodation_id = accommodation_id;
      
      if (from_date || to_date) {
        whereClause.expense_date = {};
        if (from_date) whereClause.expense_date.gte = new Date(from_date);
        if (to_date) whereClause.expense_date.lte = new Date(to_date);
      }
      
      const expenses = await prisma.expenses.findMany({
        where: whereClause,
        include: { category: true, provider: true },
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

      // :own pattern — only show expenses linked to user's own accommodations
      if (hasOwnOnly(req.userPermissions, 'deposits:view')) {
        const currentUserId = String(req.user.claims?.sub);
        const ownAccIds = await prisma.accommodations.findMany({
          where: { created_by: currentUserId },
          select: { id: true }
        });
        const ownAccIdSet = new Set(ownAccIds.map(a => a.id));
        return res.json(enriched.filter(e => e.accommodation_id && ownAccIdSet.has(e.accommodation_id)));
      }

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
        include: { category: true, provider: true }
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

      // Enrich with accommodation data if linked
      let accommodation_data = null;
      if (expense.accommodation_id) {
        const acc = await prisma.accommodations.findUnique({
          where: { id: expense.accommodation_id }
        });
        if (acc) {
          let customer_data = null;
          if (acc.customer) {
            customer_data = await prisma.contacts.findUnique({ where: { id: acc.customer } });
          }
          accommodation_data = { ...acc, customer_data };
        }
      }

      res.json({ ...expense, accommodation_data });
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
      
      const data = { ...req.body };
      // Convert empty strings to null for optional fields
      for (const key of ['accommodation_id', 'subcategory', 'notes', 'provider_id', 'receipt_url', 'reference']) {
        if (data[key] === '') data[key] = null;
      }
      data.expense_date = new Date(data.expense_date);
      data.created_by = userId;

      const expense = await prisma.expenses.create({ data });
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
      // Convert empty strings to null for optional fields
      for (const key of ['accommodation_id', 'subcategory', 'notes', 'provider_id', 'receipt_url', 'reference']) {
        if (updateData[key] === '') updateData[key] = null;
      }
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

  // AI-powered expense receipt analysis (enhanced extraction with categories and inventory matching)
  app.post('/api/expenses/analyze-receipt', isAuthenticated, async (req, res) => {
    const startTime = Date.now();
    try {
      const { imageUrl, categories, subcategoryMap, inventoryItems, organization_id } = req.body;
      console.log(`[analyze-receipt] Starting for: ${imageUrl?.substring(0, 50)}...`);
      if (!imageUrl) {
        return res.status(400).json({ error: 'Se requiere la URL de la imagen' });
      }

      const { model, generateObject, z, modelConfig: expModelConfig, providerCode: expProviderCode } = await getAIModelForReceipt('[analyze-receipt]');
      const { base64Image, mediaType } = await fetchReceiptImage(imageUrl, '[analyze-receipt]');

      // Fetch existing providers for matching
      let providers = [];
      try {
        providers = await prisma.providers.findMany({
          where: organization_id ? { organization_id } : {},
          select: { id: true, name: true },
          orderBy: { name: 'asc' }
        });
      } catch (e) {
        console.warn('[analyze-receipt] Could not fetch providers:', e.message);
      }

      // Build context sections for the prompt
      let categoriesContext = '';
      if (categories && categories.length > 0) {
        categoriesContext = `\nCATEGORIAS DE GASTO DISPONIBLES (usa el ID exacto al asignar):\n${categories.map(c => `- ID: "${c.id}" | Nombre: "${c.name}"`).join('\n')}`;
      }

      let subcategoryContext = '';
      if (subcategoryMap && Object.keys(subcategoryMap).length > 0) {
        subcategoryContext = `\nSUBCATEGORIAS POR CATEGORIA (la subcategoria DEBE ser exactamente una de estas opciones, o null):\n${Object.entries(subcategoryMap).map(([cat, subs]) => `- ${cat}: ${subs.join(', ')}`).join('\n')}`;
      }

      let inventoryContext = '';
      if (inventoryItems && inventoryItems.length > 0) {
        inventoryContext = `\nITEMS DE INVENTARIO EXISTENTES (usa el ID exacto si hay coincidencia):\n${inventoryItems.map(i => `- ID: "${i.id}" | Nombre: "${i.name}" | Unidad: "${i.unit || 'und'}"`).join('\n')}`;
      }

      let providersContext = '';
      if (providers.length > 0) {
        providersContext = `\nPROVEEDORES EXISTENTES (si el emisor del recibo coincide con alguno, usa su nombre exacto):\n${providers.map(p => `- "${p.name}"`).join('\n')}`;
      }

      const prompt = `Analiza esta imagen de un recibo, factura o comprobante de compra y extrae la informacion detallada.

INSTRUCCIONES:
1. Extrae el monto total, numero de referencia/factura/tiquete, y fecha del documento.
2. Determina la categoria del gasto basandote en el contenido del recibo.${categoriesContext}
3. Si la categoria tiene subcategorias, sugiere la mas apropiada.${subcategoryContext}
4. Genera una descripcion breve del gasto (que se compro o pago).
5. Extrae CADA linea/item individual del recibo con nombre del producto, cantidad, precio unitario y subtotal. Si el recibo solo muestra un total sin desglose, devuelve line_items como array vacio.
6. Para cada item extraido, intenta encontrar coincidencia en el inventario existente del venue.${inventoryContext}
   - Asigna matched_inventory_id SOLO si hay coincidencia clara (mismo producto o equivalente directo).
   - confidence: "high" si el nombre coincide bien, "medium" si es probable, "low" si es incierto.
   - Si no hay inventario o no hay match, deja matched_inventory_id como null.
7. Identifica el nombre del establecimiento, tienda, proveedor o emisor del recibo (quien vendio o presto el servicio).${providersContext}

Si algun dato no esta visible o no se puede determinar, devuelve null para ese campo.
Presta atencion a recibos de tiendas, ferreterias, supermercados, peajes, servicios y proveedores colombianos.
Para la referencia, busca el numero de factura, tiquete, o comprobante (NO el CUDE/CUFE que es un hash largo).`;

      console.log(`[analyze-receipt] Prompt:\n${prompt}`);
      const aiStartTime = Date.now();
      const result = await generateObject({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', image: `data:${mediaType};base64,${base64Image}` },
            { type: 'text', text: prompt }
          ]
        }],
        schema: z.object({
          amount: z.number().nullable().describe('Monto total del recibo sin simbolos de moneda'),
          reference: z.string().nullable().describe('Numero de factura, tiquete o referencia (NO el CUDE/CUFE)'),
          expense_date: z.string().nullable().describe('Fecha del gasto en formato YYYY-MM-DD'),
          category_id: z.string().nullable().describe('ID de la categoria que mejor coincide'),
          category_name: z.string().nullable().describe('Nombre de la categoria seleccionada'),
          subcategory: z.string().nullable().describe('Subcategoria exacta de las opciones disponibles, o null'),
          description: z.string().nullable().describe('Descripcion breve del gasto'),
          line_items: z.array(z.object({
            name: z.string().describe('Nombre del producto/item del recibo'),
            quantity: z.number().describe('Cantidad comprada'),
            unit_cost: z.number().describe('Precio unitario'),
            subtotal: z.number().describe('Subtotal de la linea'),
            matched_inventory_id: z.string().nullable().describe('ID del item de inventario coincidente, o null'),
            matched_inventory_name: z.string().nullable().describe('Nombre del item de inventario coincidente'),
            confidence: z.enum(['high', 'medium', 'low']).describe('Confianza en la coincidencia')
          })).describe('Items individuales del recibo, array vacio si no hay desglose'),
          provider_name: z.string().nullable().describe('Nombre del establecimiento, tienda o proveedor que emitio el recibo')
        })
      });

      // Try to match provider by name (case-insensitive)
      const data = { ...result.object };
      data.matched_provider_id = null;
      data.matched_provider_name = null;
      if (data.provider_name && providers.length > 0) {
        const aiName = data.provider_name.toLowerCase().trim();
        const match = providers.find(p => p.name.toLowerCase().trim() === aiName)
          || providers.find(p => aiName.includes(p.name.toLowerCase().trim()) || p.name.toLowerCase().trim().includes(aiName));
        if (match) {
          data.matched_provider_id = match.id;
          data.matched_provider_name = match.name;
        }
      }

      const expAiTime = Date.now() - aiStartTime;

      logAICall({
        feature: 'expense_receipt_analysis',
        provider_code: expProviderCode,
        model: expModelConfig?.model || expProviderCode,
        user_prompt: prompt,
        response_content: JSON.stringify(data),
        input_tokens: result.usage?.promptTokens || result.usage?.prompt_tokens,
        output_tokens: result.usage?.completionTokens || result.usage?.completion_tokens,
        response_time_ms: expAiTime,
        user_id: req.user?.id,
        metadata: { organization_id }
      });

      console.log(`[analyze-receipt] Done in ${Date.now() - startTime}ms (AI: ${expAiTime}ms)`, JSON.stringify(data));
      res.json({ success: true, data });
    } catch (error) {
      console.error(`[analyze-receipt] Error after ${Date.now() - startTime}ms:`, error);
      res.status(500).json({ error: 'Error al analizar el recibo', details: error.message });
    }
  });

  // ==========================================
  // Providers API
  // ==========================================
  
  // GET /api/providers - List providers with optional search
  app.get('/api/providers', isAuthenticated, async (req, res) => {
    try {
      const { search, organization_id } = req.query;
      
      const whereClause = {};
      
      if (organization_id) {
        whereClause.organization_id = organization_id;
      }
      
      if (search) {
        whereClause.name = {
          contains: search,
          mode: 'insensitive'
        };
      }
      
      const providers = await prisma.providers.findMany({
        where: whereClause,
        orderBy: { name: 'asc' },
        take: 50
      });
      
      res.json(providers);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // POST /api/providers - Create a new provider
  app.post('/api/providers', isAuthenticated, async (req, res) => {
    try {
      const { name, organization_id, phone, email, address, notes } = req.body;
      
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'El nombre del proveedor es requerido' });
      }
      
      // Check if provider already exists with same name in organization
      const existing = await prisma.providers.findFirst({
        where: {
          name: { equals: name.trim(), mode: 'insensitive' },
          organization_id: organization_id || null
        }
      });
      
      if (existing) {
        return res.json(existing);
      }
      
      const provider = await prisma.providers.create({
        data: {
          name: name.trim(),
          organization_id: organization_id || null,
          phone: phone || null,
          email: email || null,
          address: address || null,
          notes: notes || null
        }
      });
      
      res.json(provider);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // POST /api/providers/find-or-create - Find or create provider by name
  app.post('/api/providers/find-or-create', isAuthenticated, async (req, res) => {
    try {
      const { name, organization_id } = req.body;
      
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'El nombre del proveedor es requerido' });
      }
      
      // Try to find existing provider
      let provider = await prisma.providers.findFirst({
        where: {
          name: { equals: name.trim(), mode: 'insensitive' },
          organization_id: organization_id || null
        }
      });
      
      // Create if not found
      if (!provider) {
        provider = await prisma.providers.create({
          data: {
            name: name.trim(),
            organization_id: organization_id || null
          }
        });
      }
      
      res.json(provider);
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
      
      // Get verified_by users
      const verifiedByIds = [...new Set(deposits.filter(d => d.verified_by).map(d => d.verified_by))];
      const verifiedByUsers = verifiedByIds.length > 0 ? await prisma.users.findMany({
        where: { id: { in: verifiedByIds } }
      }) : [];
      const verifiedByMap = {};
      verifiedByUsers.forEach(u => { verifiedByMap[u.id] = u; });
      
      const enriched = deposits.map(d => {
        const accommodation = accommodationsMap[d.accommodation_id];
        return {
          ...d,
          verified_by_user: d.verified_by ? verifiedByMap[d.verified_by] : null,
          accommodation_data: accommodation ? {
            ...accommodation,
            customer_data: accommodation.customer ? customersMap[accommodation.customer] : null
          } : null,
          venue_data: d.venue_id ? venuesMap[d.venue_id] : null
        };
      });

      // :own pattern — only show deposits for user's own accommodations
      if (hasOwnOnly(req.userPermissions, 'deposits:view')) {
        const currentUserId = String(req.user.claims?.sub);
        const ownAccIds = await prisma.accommodations.findMany({
          where: { created_by: currentUserId },
          select: { id: true }
        });
        const ownAccIdSet = new Set(ownAccIds.map(a => a.id));
        return res.json(enriched.filter(d => d.accommodation_id && ownAccIdSet.has(d.accommodation_id)));
      }

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

  // Deposit calculation endpoint
  app.get('/api/accommodations/:id/deposit-calculation', isAuthenticated, async (req, res) => {
    try {
      const accommodation = await prisma.accommodations.findUnique({
        where: { id: req.params.id }
      });
      if (!accommodation) {
        return res.status(404).json({ error: 'Hospedaje no encontrado' });
      }

      if (!accommodation.venue) {
        return res.json({ calculated_amount: null });
      }

      const venue = await prisma.venues.findUnique({ where: { id: accommodation.venue } });
      if (!venue || venue.deposit_base_amount == null) {
        return res.json({ calculated_amount: null });
      }

      const base = parseFloat(venue.deposit_base_amount) || 0;
      const maxIncluded = venue.deposit_max_people_included || 0;
      const perExtra = parseFloat(venue.deposit_per_extra_person) || 0;
      const adults = accommodation.adults || 0;
      const extraPeople = Math.max(0, adults - maxIncluded);
      const calculated = base + extraPeople * perExtra;

      res.json({
        calculated_amount: calculated,
        venue_rules: {
          base_amount: base,
          max_people_included: maxIncluded,
          per_extra_person: perExtra,
          refund_hours: venue.deposit_refund_hours,
          policy: venue.deposit_policy
        }
      });
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

      // Auto-calculate deposit amount if venue has rules
      if (depositData.accommodation_id && depositData.calculated_amount === undefined) {
        const accommodation = await prisma.accommodations.findUnique({
          where: { id: depositData.accommodation_id }
        });
        if (accommodation?.venue) {
          const venue = await prisma.venues.findUnique({ where: { id: accommodation.venue } });
          if (venue?.deposit_base_amount != null) {
            const base = parseFloat(venue.deposit_base_amount) || 0;
            const maxIncluded = venue.deposit_max_people_included || 0;
            const perExtra = parseFloat(venue.deposit_per_extra_person) || 0;
            const adults = accommodation.adults || 0;
            const extraPeople = Math.max(0, adults - maxIncluded);
            depositData.calculated_amount = base + extraPeople * perExtra;
          }
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

      // Delete evidence images from Cloudinary before deleting the deposit
      const evidence = await prisma.deposit_evidence.findMany({ where: { deposit_id: req.params.id } });
      for (const ev of evidence) {
        const publicId = extractPublicId(ev.image_url);
        if (publicId) {
          await deleteImage(publicId).catch(err => console.error('Error deleting image from Cloudinary:', err));
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

      // Claimed deposit: allow recording balance refund without changing status
      if (existing.status === 'claimed' && status === 'refunded') {
        updateData.status = 'claimed'; // keep claimed status
        updateData.refund_amount = refund_amount;
        updateData.refund_date = refund_date ? new Date(refund_date) : new Date();
        updateData.refund_reference = refund_reference;
      } else if (status === 'refunded') {
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

  // Verify deposit
  app.put('/api/deposits/:id/verify', isAuthenticated, async (req, res) => {
    try {
      const { verified } = req.body;
      const depositId = req.params.id;
      
      const currentDeposit = await prisma.deposits.findUnique({
        where: { id: depositId }
      });
      
      if (!currentDeposit) {
        return res.status(404).json({ error: 'Depósito no encontrado' });
      }
      
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
      
      const deposit = await prisma.deposits.update({
        where: { id: depositId },
        data,
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
      
      // Resolve payment method labels
      const paymentMethodIds = [...new Set(estimates.filter(e => e.payment_method_id).map(e => e.payment_method_id))];
      const paymentMethods = paymentMethodIds.length > 0 ? await prisma.venue_payment_methods.findMany({
        where: { id: { in: paymentMethodIds } },
        select: { id: true, label: true }
      }) : [];
      const pmMap = {};
      paymentMethods.forEach(pm => { pmMap[pm.id] = pm.label; });

      const enriched = estimates.map(e => ({
        ...e,
        venue: venueMap[e.venue_id] || null,
        plan: e.plan_id ? (planMap[e.plan_id] || null) : null,
        payment_method_label: e.payment_method_id ? (pmMap[e.payment_method_id] || null) : null
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
      const paymentMethod = estimate.payment_method_id ? await prisma.venue_payment_methods.findUnique({ where: { id: estimate.payment_method_id } }) : null;

      res.json({ ...estimate, venue, plan, payment_method_label: paymentMethod?.label || null });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/estimates', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const { venue_id, plan_id, customer_name, contact_type, contact_value, check_in, check_out, adults, children, calculated_price, agreed_price, discount_note, notes, conversation_id } = req.body;
      
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
          agreed_price,
          discount_note,
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
      const { plan_id, customer_name, contact_type, contact_value, check_in, check_out, adults, children, calculated_price, agreed_price, discount_note, notes, status } = req.body;
      
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
          agreed_price,
          discount_note,
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
              whatsapp: estimate.contact_type === 'whatsapp' ? parseFloat(estimate.contact_value) : null,
              instagram: estimate.contact_type === 'instagram' ? estimate.contact_value : null
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
      const { venue_id, organization_id, from_date, to_date, period, viewAll, basis } = req.query;
      const incomeDateField = basis === 'accrual' ? 'accrual_date' : 'date';
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
      
      // Build date range using calculateDateRange helper
      const now = new Date();
      let startDate, endDate;

      if (period && typeof calculateDateRange === 'function') {
        const range = calculateDateRange(period);
        startDate = range.startDate;
        endDate = range.endDate;
      } else if (from_date && to_date) {
        startDate = new Date(from_date);
        endDate = new Date(to_date);
      } else {
        // Default to last 12 months
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        endDate = now;
      }
      
      // Build where clauses
      const orgFilter = accessibleOrgIds !== null ? { in: accessibleOrgIds } : undefined;
      
      const incomeWhere = {
        [incomeDateField]: { gte: startDate, lte: endDate }
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
      
      // Build date range using calculateDateRange helper
      const now = new Date();
      let startDate, endDate;

      if (period) {
        const range = calculateDateRange(period);
        startDate = range.startDate;
        endDate = range.endDate;
      } else if (from_date && to_date) {
        startDate = new Date(from_date);
        endDate = new Date(to_date);
      } else {
        // Default to last 12 months
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        endDate = now;
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

  app.get('/api/analytics/income-detail', async (req, res) => {
    try {
      const { venue_id, organization_id, period, viewAll, basis } = req.query;
      const incomeDateField = basis === 'accrual' ? 'accrual_date' : 'date';
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

      const now = new Date();
      let startDate, endDate;

      if (period && typeof calculateDateRange === 'function') {
        const range = calculateDateRange(period);
        startDate = range.startDate;
        endDate = range.endDate;
      } else {
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        endDate = now;
      }

      const whereClause = {
        [incomeDateField]: { gte: startDate, lte: endDate }
      };
      if (accessibleOrgIds !== null) {
        if (accessibleOrgIds.length === 0) return res.json([]);
        whereClause.organization_id = { in: accessibleOrgIds };
      }
      if (venue_id) whereClause.venue_id = venue_id;
      if (organization_id) whereClause.organization_id = organization_id;

      const incomes = await prisma.incomes.findMany({
        where: whereClause,
        orderBy: { [incomeDateField]: 'desc' }
      });

      // Enrich with venue names
      const venueIds = [...new Set(incomes.filter(i => i.venue_id).map(i => i.venue_id))];
      const venueMap = {};
      if (venueIds.length > 0) {
        const venueList = await prisma.venues.findMany({
          where: { id: { in: venueIds } },
          select: { id: true, name: true }
        });
        venueList.forEach(v => { venueMap[v.id] = v.name; });
      }

      const result = incomes.map(income => ({
        id: income.id,
        amount: parseFloat(income.amount) || 0,
        type: income.type,
        date: income.date,
        accrual_date: income.accrual_date,
        venue_name: venueMap[income.venue_id] || null,
        created_at: income.created_at
      }));

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/analytics/monthly-trend', async (req, res) => {
    try {
      const { venue_id, organization_id, period, viewAll, basis } = req.query;
      const incomeDateField = basis === 'accrual' ? 'accrual_date' : 'date';
      const viewAllFlag = viewAll === 'true';

      // Calculate number of months based on period
      let numMonths = 6;
      const now = new Date();
      let startFromMonth = now.getMonth();
      let startFromYear = now.getFullYear();

      switch (period) {
        case 'last_12_months':
          numMonths = 12;
          break;
        case 'last_6_months':
          numMonths = 6;
          break;
        case 'last_3_months':
          numMonths = 3;
          break;
        case 'last_month':
          numMonths = 1;
          break;
        case 'this_month':
          numMonths = 1;
          break;
        case 'this_quarter':
          numMonths = 3;
          const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
          startFromMonth = now.getMonth();
          numMonths = now.getMonth() - quarterStartMonth + 1;
          break;
        case 'this_year':
          numMonths = now.getMonth() + 1;
          break;
        default:
          numMonths = 6;
      }

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
          where: { ...baseWhere, [incomeDateField]: { gte: startDate, lte: endDate } },
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

  // ==========================================
  // AI Usage Analytics Endpoints
  // ==========================================

  app.get('/api/analytics/ai-usage', isAuthenticated, async (req, res) => {
    try {
      const { venue_id, period, viewAll } = req.query;
      const viewAllFlag = viewAll === 'true';

      // Determine accessible venue IDs via org filter
      let venueFilter = undefined;
      if (venue_id) {
        venueFilter = venue_id;
      } else {
        let accessibleOrgIds = null;
        if (req.user) {
          const userId = String(req.user.claims?.sub);
          const currentUser = await prisma.users.findUnique({ where: { id: userId } });
          if (viewAllFlag && currentUser?.is_super_admin) {
            accessibleOrgIds = null;
          } else if (currentUser?.is_super_admin) {
            const userOrgs = await prisma.user_organizations.findMany({ where: { user_id: userId } });
            accessibleOrgIds = userOrgs.map(uo => uo.organization_id);
          } else {
            accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
          }
        }
        if (accessibleOrgIds !== null && accessibleOrgIds.length > 0) {
          const accessibleVenues = await prisma.venues.findMany({
            where: { organization: { in: accessibleOrgIds } },
            select: { id: true }
          });
          venueFilter = { in: accessibleVenues.map(v => v.id) };
        }
      }

      // Date range
      const range = calculateDateRange(period || 'last_6_months');
      const dateWhere = { created_at: { gte: range.startDate, lte: range.endDate } };

      const where = { ...dateWhere };
      if (venueFilter) {
        if (typeof venueFilter === 'string') {
          where.venue_id = venueFilter;
        } else {
          // Include system logs (venue_id = null) along with accessible venues
          where.OR = [{ venue_id: venueFilter }, { venue_id: null }];
        }
      }

      // Aggregates
      const agg = await prisma.ai_audit_logs.aggregate({
        where,
        _sum: { input_tokens: true, output_tokens: true, cost_estimate: true },
        _avg: { response_time_ms: true },
        _count: true
      });

      // Group by feature + provider
      const allLogs = await prisma.ai_audit_logs.findMany({
        where,
        select: { feature: true, provider_code: true, input_tokens: true, output_tokens: true, cost_estimate: true }
      });
      const featureMap = {};
      // Also track tokens by provider for client-side recalc
      const tokensByProvider = {};
      for (const log of allLogs) {
        if (!featureMap[log.feature]) {
          featureMap[log.feature] = { feature: log.feature, count: 0, tokens: 0, cost: 0, input_tokens: 0, output_tokens: 0, byProvider: {} };
        }
        const f = featureMap[log.feature];
        f.count++;
        const inTok = log.input_tokens || 0;
        const outTok = log.output_tokens || 0;
        f.tokens += inTok + outTok;
        f.input_tokens += inTok;
        f.output_tokens += outTok;
        f.cost += parseFloat(log.cost_estimate || 0);
        // Per-provider breakdown within feature
        const pc = log.provider_code;
        if (!f.byProvider[pc]) f.byProvider[pc] = { input_tokens: 0, output_tokens: 0 };
        f.byProvider[pc].input_tokens += inTok;
        f.byProvider[pc].output_tokens += outTok;
        // Global per-provider
        if (!tokensByProvider[pc]) tokensByProvider[pc] = { input_tokens: 0, output_tokens: 0 };
        tokensByProvider[pc].input_tokens += inTok;
        tokensByProvider[pc].output_tokens += outTok;
      }

      res.json({
        totalCalls: agg._count,
        totalTokens: (agg._sum.input_tokens || 0) + (agg._sum.output_tokens || 0),
        totalInputTokens: agg._sum.input_tokens || 0,
        totalOutputTokens: agg._sum.output_tokens || 0,
        totalCost: parseFloat(agg._sum.cost_estimate || 0),
        avgResponseTime: Math.round(agg._avg.response_time_ms || 0),
        byFeature: Object.values(featureMap),
        tokensByProvider
      });
    } catch (error) {
      console.error('[ai-usage] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/analytics/ai-usage-by-venue', isAuthenticated, async (req, res) => {
    try {
      const { venue_id, period, viewAll } = req.query;
      const viewAllFlag = viewAll === 'true';

      // Determine accessible venue IDs
      let venueFilter = undefined;
      if (venue_id) {
        venueFilter = venue_id;
      } else {
        let accessibleOrgIds = null;
        if (req.user) {
          const userId = String(req.user.claims?.sub);
          const currentUser = await prisma.users.findUnique({ where: { id: userId } });
          if (viewAllFlag && currentUser?.is_super_admin) {
            accessibleOrgIds = null;
          } else if (currentUser?.is_super_admin) {
            const userOrgs = await prisma.user_organizations.findMany({ where: { user_id: userId } });
            accessibleOrgIds = userOrgs.map(uo => uo.organization_id);
          } else {
            accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
          }
        }
        if (accessibleOrgIds !== null && accessibleOrgIds.length > 0) {
          const accessibleVenues = await prisma.venues.findMany({
            where: { organization: { in: accessibleOrgIds } },
            select: { id: true }
          });
          venueFilter = { in: accessibleVenues.map(v => v.id) };
        }
      }

      // Calculate months
      const now = new Date();
      let numMonths = 6;
      switch (period) {
        case 'last_12_months': numMonths = 12; break;
        case 'last_6_months': numMonths = 6; break;
        case 'last_3_months': numMonths = 3; break;
        case 'this_month': numMonths = 1; break;
        case 'this_quarter': numMonths = Math.min(now.getMonth() - Math.floor(now.getMonth() / 3) * 3 + 1, 3); break;
        case 'this_year': numMonths = now.getMonth() + 1; break;
        default: numMonths = 6;
      }

      const result = [];
      const allVenueIds = new Set();

      for (let i = numMonths - 1; i >= 0; i--) {
        const startDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const endDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);

        const where = { created_at: { gte: startDate, lte: endDate } };
        if (venueFilter) {
          if (typeof venueFilter === 'string') {
            where.venue_id = venueFilter;
          } else {
            where.OR = [{ venue_id: venueFilter }, { venue_id: null }];
          }
        }

        const logs = await prisma.ai_audit_logs.findMany({
          where,
          select: { venue_id: true, provider_code: true, input_tokens: true, output_tokens: true, cost_estimate: true }
        });

        const venueMap = {};
        for (const log of logs) {
          const vid = log.venue_id || '__system__';
          if (vid !== '__system__') allVenueIds.add(vid);
          if (!venueMap[vid]) {
            venueMap[vid] = { venue_id: vid, calls: 0, tokens: 0, cost: 0, input_tokens: 0, output_tokens: 0, byProvider: {} };
          }
          const v = venueMap[vid];
          const inTok = log.input_tokens || 0;
          const outTok = log.output_tokens || 0;
          v.calls++;
          v.tokens += inTok + outTok;
          v.input_tokens += inTok;
          v.output_tokens += outTok;
          v.cost += parseFloat(log.cost_estimate || 0);
          const pc = log.provider_code;
          if (!v.byProvider[pc]) v.byProvider[pc] = { input_tokens: 0, output_tokens: 0 };
          v.byProvider[pc].input_tokens += inTok;
          v.byProvider[pc].output_tokens += outTok;
        }

        result.push({
          month: startDate.toISOString().slice(0, 7),
          monthName: startDate.toLocaleString('es-CO', { month: 'short', year: 'numeric' }),
          venues: Object.values(venueMap)
        });
      }

      // Lookup venue names
      const venueNames = {};
      if (allVenueIds.size > 0) {
        const venueRecords = await prisma.venues.findMany({
          where: { id: { in: [...allVenueIds] } },
          select: { id: true, name: true }
        });
        for (const v of venueRecords) {
          venueNames[v.id] = v.name;
        }
      }

      // Enrich with names
      for (const month of result) {
        for (const v of month.venues) {
          v.venue_name = v.venue_id === '__system__' ? 'Sistema' : (venueNames[v.venue_id] || 'Desconocido');
        }
      }

      res.json(result);
    } catch (error) {
      console.error('[ai-usage-by-venue] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/analytics/ai-usage-detail', isAuthenticated, async (req, res) => {
    try {
      const { venue_id, period, viewAll, page: pageStr, limit: limitStr } = req.query;
      const viewAllFlag = viewAll === 'true';
      const page = Math.max(1, parseInt(pageStr) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(limitStr) || 50));

      // Determine accessible venue IDs
      let venueFilter = undefined;
      if (venue_id) {
        venueFilter = venue_id;
      } else {
        let accessibleOrgIds = null;
        if (req.user) {
          const userId = String(req.user.claims?.sub);
          const currentUser = await prisma.users.findUnique({ where: { id: userId } });
          if (viewAllFlag && currentUser?.is_super_admin) {
            accessibleOrgIds = null;
          } else if (currentUser?.is_super_admin) {
            const userOrgs = await prisma.user_organizations.findMany({ where: { user_id: userId } });
            accessibleOrgIds = userOrgs.map(uo => uo.organization_id);
          } else {
            accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
          }
        }
        if (accessibleOrgIds !== null && accessibleOrgIds.length > 0) {
          const accessibleVenues = await prisma.venues.findMany({
            where: { organization: { in: accessibleOrgIds } },
            select: { id: true }
          });
          venueFilter = { in: accessibleVenues.map(v => v.id) };
        }
      }

      // Date range
      const range = calculateDateRange(period || 'last_6_months');
      const where = { created_at: { gte: range.startDate, lte: range.endDate } };
      if (venueFilter) {
        if (typeof venueFilter === 'string') {
          where.venue_id = venueFilter;
        } else {
          where.OR = [{ venue_id: venueFilter }, { venue_id: null }];
        }
      }

      const total = await prisma.ai_audit_logs.count({ where });
      const logs = await prisma.ai_audit_logs.findMany({
        where,
        select: {
          id: true, created_at: true, feature: true, venue_id: true,
          provider_code: true, model: true, input_tokens: true, output_tokens: true,
          response_time_ms: true, cost_estimate: true, error: true
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      });

      // Lookup venue names
      const venueIds = [...new Set(logs.map(l => l.venue_id).filter(Boolean))];
      const venueNames = {};
      if (venueIds.length > 0) {
        const venueRecords = await prisma.venues.findMany({
          where: { id: { in: venueIds } },
          select: { id: true, name: true }
        });
        for (const v of venueRecords) {
          venueNames[v.id] = v.name;
        }
      }

      const data = logs.map(l => ({
        ...l,
        cost_estimate: parseFloat(l.cost_estimate || 0),
        venue_name: l.venue_id ? (venueNames[l.venue_id] || 'Desconocido') : 'Sistema'
      }));

      res.json({
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('[ai-usage-detail] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // AI Receipt Helpers (shared by payment and expense extraction)
  // ==========================================

  async function getAIModelForReceipt(logPrefix = '[extract-receipt]') {
    const aiSetting = await prisma.ai_settings.findUnique({
      where: { setting_key: 'receipt_extraction' }
    });
    const providerCode = aiSetting?.provider_code || 'anthropic_claude';
    const modelConfig = llmService.getModelConfig(providerCode);
    if (!modelConfig) throw new Error('Modelo de IA no configurado');
    const apiKey = llmService.getApiKeyForProvider(providerCode);
    if (!apiKey) throw new Error(`API key no configurada (${modelConfig.env_key})`);

    // Use model from ai_settings if available, otherwise fallback to hardcoded
    const modelName = aiSetting?.model || modelConfig.model;

    const { generateObject } = await import('ai');
    const { z } = await import('zod');

    let model;
    if (modelConfig.provider === 'anthropic') {
      const { anthropic } = await import('@ai-sdk/anthropic');
      model = anthropic(modelName);
    } else if (providerCode.startsWith('openai')) {
      const { openai } = await import('@ai-sdk/openai');
      model = openai(modelName);
    } else {
      const { createOpenAI } = await import('@ai-sdk/openai');
      const provider = createOpenAI({ apiKey, baseURL: modelConfig.base_url });
      model = provider(modelName);
    }

    console.log(`${logPrefix} Model ready: ${modelName} (${providerCode})`);
    return { model, generateObject, z, modelConfig, providerCode };
  }

  async function fetchReceiptImage(imageUrl, logPrefix = '[extract-receipt]') {
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) throw new Error('No se pudo descargar la imagen');
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const base64Image = imageBuffer.toString('base64');

    let mediaType = 'image/jpeg';
    if (contentType.includes('png')) mediaType = 'image/png';
    else if (contentType.includes('gif')) mediaType = 'image/gif';
    else if (contentType.includes('webp')) mediaType = 'image/webp';

    console.log(`${logPrefix} Image fetched: ${imageBuffer.length} bytes, type: ${mediaType}`);
    return { base64Image, mediaType };
  }

  // AI-powered receipt data extraction (payments)
  app.post('/api/payments/extract-receipt', isAuthenticated, async (req, res) => {
    const startTime = Date.now();
    try {
      const { imageUrl } = req.body;
      console.log(`[extract-receipt] Starting extraction for: ${imageUrl?.substring(0, 50)}...`);
      if (!imageUrl) {
        return res.status(400).json({ error: 'Se requiere la URL de la imagen' });
      }

      const { model, generateObject, z, modelConfig, providerCode: receiptProviderCode } = await getAIModelForReceipt();
      const { base64Image, mediaType } = await fetchReceiptImage(imageUrl);

      const receiptPrompt = `Analiza esta imagen de un comprobante de pago o transferencia bancaria y extrae la siguiente información:

1. Monto/valor de la transferencia (solo el número, sin símbolos de moneda)
2. Número de referencia o transacción (puede estar etiquetado como "Referencia", "No. Transacción", "ID", "Comprobante", etc.)
3. Fecha de la transferencia (en formato YYYY-MM-DD si es posible)

Si algún dato no está visible o no se puede determinar, devuelve null para ese campo.
Presta especial atención a comprobantes de Nequi, Daviplata, Bancolombia, y otras entidades colombianas.`;

      const aiStartTime = Date.now();
      const result = await generateObject({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', image: `data:${mediaType};base64,${base64Image}` },
            { type: 'text', text: receiptPrompt }
          ]
        }],
        schema: z.object({
          amount: z.number().nullable().describe('Monto de la transferencia sin símbolos de moneda'),
          reference: z.string().nullable().describe('Número de referencia o transacción'),
          payment_date: z.string().nullable().describe('Fecha de la transferencia en formato YYYY-MM-DD')
        })
      });
      const aiTime = Date.now() - aiStartTime;

      logAICall({
        feature: 'payment_receipt_extraction',
        provider_code: receiptProviderCode,
        model: modelConfig?.model || receiptProviderCode,
        user_prompt: receiptPrompt,
        response_content: JSON.stringify(result.object),
        input_tokens: result.usage?.promptTokens || result.usage?.prompt_tokens,
        output_tokens: result.usage?.completionTokens || result.usage?.completion_tokens,
        response_time_ms: aiTime,
        user_id: req.user?.id
      });

      console.log(`[extract-receipt] Done in ${Date.now() - startTime}ms (AI: ${aiTime}ms)`, JSON.stringify(result.object));
      res.json({ success: true, data: result.object });
    } catch (error) {
      console.error(`[extract-receipt] Error after ${Date.now() - startTime}ms:`, error);
      res.status(500).json({ error: 'Error al procesar el comprobante', details: error.message });
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

  // POST /api/message-templates/generate - Generate message from template using AI
  app.post('/api/message-templates/generate', isAuthenticated, async (req, res) => {
    try {
      const { template_id, accommodation_id, additional_instructions } = req.body;

      if (!template_id || !accommodation_id) {
        return res.status(400).json({ error: 'template_id y accommodation_id son requeridos' });
      }

      // Fetch template
      const template = await prisma.message_templates.findUnique({
        where: { id: template_id }
      });
      if (!template) {
        return res.status(404).json({ error: 'Template no encontrado' });
      }

      // Fetch accommodation
      const accommodation = await prisma.accommodations.findUnique({
        where: { id: accommodation_id }
      });
      if (!accommodation) {
        return res.status(404).json({ error: 'Hospedaje no encontrado' });
      }

      // Fetch venue
      const venue = accommodation.venue
        ? await prisma.venues.findUnique({ where: { id: accommodation.venue } })
        : null;
      if (!venue) {
        return res.status(404).json({ error: 'Venue no encontrado para este hospedaje' });
      }

      // Fetch customer
      const customer = accommodation.customer
        ? await prisma.contacts.findUnique({ where: { id: accommodation.customer } })
        : null;

      // Fetch venue plans
      const plans = await prisma.venue_plans.findMany({
        where: { venue_id: venue.id, is_active: true }
      });

      // Fetch accommodation plan name
      const accPlan = accommodation.plan_id
        ? await prisma.venue_plans.findUnique({ where: { id: accommodation.plan_id } })
        : null;

      // Fetch deposit for this accommodation
      const deposits = await prisma.deposits.findMany({
        where: { accommodation_id: accommodation_id }
      });
      const deposit = deposits.length > 0 ? deposits[0] : null;

      // Fetch payments to calculate pending balance
      const payments = await prisma.payments.findMany({
        where: { accommodation: accommodation_id }
      });
      const totalPaid = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
      const agreedPrice = parseFloat(accommodation.agreed_price) || 0;
      const pendingBalance = agreedPrice - totalPaid;

      // Build venue context
      const venueContext = llmService.buildVenueContext(venue, [], plans);

      // Format accommodation date
      let dateStr = 'No definida';
      if (accommodation.date) {
        const d = new Date(accommodation.date);
        const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
        const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        dateStr = `${dayNames[d.getUTCDay()]}, ${d.getUTCDate()} de ${monthNames[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
      }

      // Format time
      let timeStr = 'No definida';
      if (accommodation.time) {
        const t = accommodation.time;
        if (t instanceof Date) {
          timeStr = `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
        } else if (typeof t === 'string' && t.includes('T')) {
          const td = new Date(t);
          timeStr = `${String(td.getUTCHours()).padStart(2, '0')}:${String(td.getUTCMinutes()).padStart(2, '0')}`;
        } else if (typeof t === 'string') {
          timeStr = t.slice(0, 5);
        }
      }

      const customerName = customer?.fullname || 'Cliente';
      const firstName = customerName.split(' ')[0];

      // Build system prompt
      const systemPrompt = `Eres un asistente que genera mensajes de WhatsApp listos para enviar a clientes de "${venue.name || 'la Cabaña'}".

${venueContext}

## Datos del Hospedaje
- Cliente: ${customerName}
- Nombre de pila: ${firstName}
- Fecha: ${dateStr}
- Hora de llegada: ${timeStr}
- Adultos: ${accommodation.adults || 0}
- Niños: ${accommodation.children || 0}
- Plan: ${accPlan?.name || 'No asignado'}
- Precio acordado: ${agreedPrice ? `$${agreedPrice.toLocaleString('es-CO')}` : 'No definido'}
- Total pagado: $${totalPaid.toLocaleString('es-CO')}
- Saldo pendiente: ${pendingBalance > 0 ? `$${pendingBalance.toLocaleString('es-CO')}` : 'Pagado en su totalidad'}
${venue.deposit_base_amount != null ? `
## Depósito de Garantía
${deposit && deposit.status === 'pending' ? `- Depósito registrado: $${parseFloat(deposit.amount).toLocaleString('es-CO')} (${deposit.verified ? 'Verificado' : 'Pendiente de verificación'})` : deposit && deposit.status === 'refunded' ? `- Depósito devuelto: $${parseFloat(deposit.refund_amount || deposit.amount).toLocaleString('es-CO')}` : deposit && deposit.status === 'claimed' ? `- Depósito retenido por daños: $${parseFloat(deposit.damage_amount || deposit.amount).toLocaleString('es-CO')}` : `- Depósito NO pagado aún. Monto requerido: $${parseFloat(venue.deposit_base_amount).toLocaleString('es-CO')}. Debe pagarse al momento de ingresar a la cabaña.`}
- Reglas: $${parseFloat(venue.deposit_base_amount).toLocaleString('es-CO')} para hasta ${venue.deposit_max_people_included || 0} personas, +$${parseFloat(venue.deposit_per_extra_person || 0).toLocaleString('es-CO')} por persona adicional
- Devolución en ${venue.deposit_refund_hours || 24} horas hábiles después de la salida` : `
IMPORTANTE: Este venue NO tiene reglas de depósito. NO menciones depósitos ni garantías en el mensaje.`}

## Redes Sociales del Venue
- Instagram: ${venue?.instagram || 'No configurado'}
- WhatsApp: ${venue?.whatsapp || 'No configurado'}

## Instrucción del Template
${template.content}
${additional_instructions ? `\n## Instrucciones Adicionales\n${additional_instructions}` : ''}

REGLAS:
- Responde SOLO con el texto del mensaje listo para enviar por WhatsApp.
- No incluyas explicaciones, encabezados, comillas, ni nada adicional.
- Usa SOLO la información que sea relevante según la instrucción del template. No menciones datos del hospedaje (fecha, hora, precio, número de personas, plan, etc.) a menos que la instrucción del template lo requiera explícitamente.
- Usa un tono cálido y profesional.
- Puedes usar emojis con moderación.
- Usa formato de WhatsApp (*negritas*, _cursivas_) cuando sea apropiado.`;

      // Get AI model config
      const chatSetting = await prisma.ai_settings.findUnique({
        where: { setting_key: 'customer_chat' }
      });
      const providerCode = chatSetting?.provider_code || 'anthropic_claude';
      const modelOverride = chatSetting?.model || undefined;

      // Call LLM
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Genera el mensaje.' }
      ];

      const llmStart = Date.now();
      const result = await llmService.callLLMByCode(providerCode, messages, {
        maxTokens: 1024,
        temperature: 0.7,
        model: modelOverride
      });
      const llmTime = Date.now() - llmStart;

      logAICall({
        venue_id: venue?.id,
        feature: 'message_generation',
        provider_code: providerCode,
        model: result.model || modelOverride || providerCode,
        system_prompt: systemPrompt,
        user_prompt: 'Genera el mensaje.',
        response_content: result.content,
        input_tokens: result.usage?.prompt_tokens,
        output_tokens: result.usage?.completion_tokens,
        response_time_ms: llmTime,
        user_id: req.user?.id,
        accommodation_id,
        metadata: { template_id, template_code: template.code }
      });

      res.json({
        message: result.content,
        model: result.model,
        usage: {
          input_tokens: result.usage?.prompt_tokens || 0,
          output_tokens: result.usage?.completion_tokens || 0,
          total_tokens: result.usage?.total_tokens || 0,
          response_time_ms: llmTime
        }
      });
    } catch (error) {
      console.error('Error generating message from template:', error);
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
  
  // GET /api/llm-providers/pricing - Get pricing for all active providers
  app.get('/api/llm-providers/pricing', isAuthenticated, async (req, res) => {
    try {
      const providers = await prisma.llm_providers.findMany({
        where: { is_active: true },
        select: { id: true, code: true, name: true, model: true, input_price_per_mtok: true, output_price_per_mtok: true },
        orderBy: { name: 'asc' }
      });
      res.json(providers.map(p => ({
        ...p,
        input_price_per_mtok: parseFloat(p.input_price_per_mtok || 0),
        output_price_per_mtok: parseFloat(p.output_price_per_mtok || 0)
      })));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/llm-providers/:id/pricing - Update provider pricing (super_admin only)
  app.put('/api/llm-providers/:id/pricing', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user?.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      if (!currentUser?.is_super_admin) {
        return res.status(403).json({ error: 'Acceso denegado' });
      }
      const { input_price_per_mtok, output_price_per_mtok } = req.body;
      const provider = await prisma.llm_providers.update({
        where: { id: req.params.id },
        data: {
          input_price_per_mtok: input_price_per_mtok != null ? input_price_per_mtok : undefined,
          output_price_per_mtok: output_price_per_mtok != null ? output_price_per_mtok : undefined,
          updated_at: new Date()
        }
      });
      invalidateProviderPriceCache();
      const { api_key, ...safeProvider } = provider;
      res.json(safeProvider);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

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

  // ==================== WhatsApp Baileys API ====================

  // POST /api/venues/:id/whatsapp/connect - Start WhatsApp connection (generates QR)
  app.post('/api/venues/:id/whatsapp/connect', isAuthenticated, async (req, res) => {
    try {
      if (!whatsappClient || !whatsappClient.isAvailable()) {
        return res.status(503).json({ error: 'WhatsApp no disponible en este entorno' });
      }

      const venueId = req.params.id;

      // Verify user has access to this venue
      const venueIds = await getAccessibleVenueIds(req.userPermissions);
      if (venueIds !== null && !venueIds.includes(venueId)) {
        return res.status(403).json({ error: 'No tienes acceso a esta cabaña' });
      }

      const result = await whatsappClient.connectVenue(venueId);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('[whatsapp] Connect error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/venues/:id/whatsapp/disconnect - Disconnect WhatsApp
  app.post('/api/venues/:id/whatsapp/disconnect', isAuthenticated, async (req, res) => {
    try {
      if (!whatsappClient || !whatsappClient.isAvailable()) {
        return res.status(503).json({ error: 'WhatsApp no disponible en este entorno' });
      }

      const venueId = req.params.id;

      const venueIds = await getAccessibleVenueIds(req.userPermissions);
      if (venueIds !== null && !venueIds.includes(venueId)) {
        return res.status(403).json({ error: 'No tienes acceso a esta cabaña' });
      }

      await whatsappClient.disconnectVenue(venueId);
      res.json({ success: true, status: 'disconnected' });
    } catch (error) {
      console.error('[whatsapp] Disconnect error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/venues/:id/whatsapp/status - Get connection status + QR
  app.get('/api/venues/:id/whatsapp/status', isAuthenticated, async (req, res) => {
    try {
      const venueId = req.params.id;

      const venueIds = await getAccessibleVenueIds(req.userPermissions);
      if (venueIds !== null && !venueIds.includes(venueId)) {
        return res.status(403).json({ error: 'No tienes acceso a esta cabaña' });
      }

      if (!whatsappClient || !whatsappClient.isAvailable()) {
        return res.json({ status: 'unavailable', qr_code: null, phone_number: null });
      }

      const status = await whatsappClient.getStatus(venueId);
      res.json(status);
    } catch (error) {
      console.error('[whatsapp] Status error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/venues/:id/whatsapp/qr - Get QR code data
  app.get('/api/venues/:id/whatsapp/qr', isAuthenticated, async (req, res) => {
    try {
      const venueId = req.params.id;

      const venueIds = await getAccessibleVenueIds(req.userPermissions);
      if (venueIds !== null && !venueIds.includes(venueId)) {
        return res.status(403).json({ error: 'No tienes acceso a esta cabaña' });
      }

      const conn = await prisma.whatsapp_connections.findUnique({
        where: { venue_id: venueId },
        select: { qr_code: true, status: true }
      });

      if (!conn || !conn.qr_code) {
        return res.json({ qr_code: null, status: conn?.status || 'not_configured' });
      }

      res.json({ qr_code: conn.qr_code, status: conn.status });
    } catch (error) {
      console.error('[whatsapp] QR error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/venues/:id/whatsapp/excluded-phones - Get excluded phones list
  app.get('/api/venues/:id/whatsapp/excluded-phones', isAuthenticated, async (req, res) => {
    try {
      const venueId = req.params.id;
      const venueIds = await getAccessibleVenueIds(req.userPermissions);
      if (venueIds !== null && !venueIds.includes(venueId)) {
        return res.status(403).json({ error: 'No tienes acceso a esta cabaña' });
      }

      const venue = await prisma.venues.findUnique({
        where: { id: venueId },
        select: { excluded_phones: true }
      });

      res.json({ excluded_phones: venue?.excluded_phones || [] });
    } catch (error) {
      console.error('[whatsapp] Excluded phones error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/venues/:id/whatsapp/excluded-phones - Update excluded phones list
  app.put('/api/venues/:id/whatsapp/excluded-phones', isAuthenticated, async (req, res) => {
    try {
      const venueId = req.params.id;
      const venueIds = await getAccessibleVenueIds(req.userPermissions);
      if (venueIds !== null && !venueIds.includes(venueId)) {
        return res.status(403).json({ error: 'No tienes acceso a esta cabaña' });
      }

      const { excluded_phones } = req.body;
      if (!Array.isArray(excluded_phones)) {
        return res.status(400).json({ error: 'excluded_phones debe ser un array' });
      }

      // Validate each entry has phone field
      for (const entry of excluded_phones) {
        if (!entry.phone || typeof entry.phone !== 'string') {
          return res.status(400).json({ error: 'Cada entrada debe tener un campo "phone"' });
        }
        // Clean phone: keep only digits
        entry.phone = entry.phone.replace(/\D/g, '');
      }

      await prisma.venues.update({
        where: { id: venueId },
        data: { excluded_phones }
      });

      res.json({ success: true, excluded_phones });
    } catch (error) {
      console.error('[whatsapp] Update excluded phones error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== Per-venue Escalation Config ====================

  // GET /api/venues/:id/whatsapp/escalation-config
  app.get('/api/venues/:id/whatsapp/escalation-config', isAuthenticated, async (req, res) => {
    try {
      const venueId = req.params.id;
      const venueIds = await getAccessibleVenueIds(req.userPermissions);
      if (venueIds !== null && !venueIds.includes(venueId)) {
        return res.status(403).json({ error: 'No tienes acceso a esta cabaña' });
      }

      const conn = await prisma.whatsapp_connections.findUnique({
        where: { venue_id: venueId },
        select: { escalation_config: true, notification_phone: true }
      });

      const defaultConfig = {
        ai_escalation_enabled: true,
        client_request_enabled: true,
        message_limit_enabled: false,
        message_limit: 15,
        auto_resume_enabled: true,
        auto_resume_hour: 3
      };

      res.json({
        escalation_config: { ...defaultConfig, ...(conn?.escalation_config || {}) },
        notification_phone: conn?.notification_phone || ''
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/venues/:id/whatsapp/escalation-config
  app.put('/api/venues/:id/whatsapp/escalation-config', isAuthenticated, async (req, res) => {
    try {
      const venueId = req.params.id;
      const venueIds = await getAccessibleVenueIds(req.userPermissions);
      if (venueIds !== null && !venueIds.includes(venueId)) {
        return res.status(403).json({ error: 'No tienes acceso a esta cabaña' });
      }

      const { escalation_config, notification_phone } = req.body;

      const updateData = { updated_at: new Date() };
      if (escalation_config !== undefined) updateData.escalation_config = escalation_config;
      if (notification_phone !== undefined) updateData.notification_phone = notification_phone || null;

      // Upsert: create record if doesn't exist
      let conn = await prisma.whatsapp_connections.findUnique({
        where: { venue_id: venueId }
      });

      if (conn) {
        conn = await prisma.whatsapp_connections.update({
          where: { venue_id: venueId },
          data: updateData
        });
      } else {
        conn = await prisma.whatsapp_connections.create({
          data: {
            venue_id: venueId,
            ...updateData
          }
        });
      }

      res.json({ success: true, escalation_config: conn.escalation_config, notification_phone: conn.notification_phone });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/chat/:venue_id/conversations/:id/resume - Resume a conversation manually
  app.post('/api/chat/:venue_id/conversations/:id/resume', isAuthenticated, async (req, res) => {
    try {
      const { venue_id, id } = req.params;
      const venueIds = await getAccessibleVenueIds(req.userPermissions);
      if (venueIds !== null && !venueIds.includes(venue_id)) {
        return res.status(403).json({ error: 'No tienes acceso a esta cabaña' });
      }

      const conversation = await prisma.chat_conversations.findUnique({
        where: { id }
      });
      if (!conversation || conversation.venue_id !== venue_id) {
        return res.status(404).json({ error: 'Conversación no encontrada' });
      }
      if (conversation.status !== 'human_attention') {
        return res.json({ success: true, message: 'La conversación ya está activa' });
      }

      await prisma.chat_conversations.update({
        where: { id },
        data: {
          status: 'active',
          escalated_at: null,
          escalated_reason: null,
          resume_at: null,
          updated_at: new Date()
        }
      });

      // Send greeting to client if WhatsApp conversation
      if (conversation.phone && (conversation.source === 'baileys' || conversation.source === 'cloud_api')) {
        try {
          await sendWhatsAppReply(
            venue_id,
            conversation.phone,
            '¡Hola! 👋 CabanIA está disponible nuevamente para ayudarte. ¿En qué puedo asistirte?'
          );
        } catch (err) {
          console.error('[resume] Failed to send greeting:', err.message);
        }
      }

      res.json({ success: true, message: 'Conversación reanudada' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== WhatsApp Message Tracking & Events ====================

  // PATCH /api/chat/messages/:id/status - Update message delivery status (internal key auth)
  app.patch('/api/chat/messages/:id/status', async (req, res) => {
    try {
      const internalKey = req.headers['x-internal-key'];
      if (!internalKey || internalKey !== process.env.WHATSAPP_INTERNAL_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { id } = req.params;
      const { status, external_id, error_details } = req.body;

      if (!status) {
        return res.status(400).json({ error: 'status is required' });
      }

      const validStatuses = ['pending', 'sent', 'delivered', 'read', 'failed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      }

      const updateData = { status };
      if (external_id) updateData.external_id = external_id;
      if (error_details) updateData.error_details = error_details;

      await prisma.chat_messages.update({
        where: { id },
        data: updateData
      });

      res.json({ success: true });
    } catch (error) {
      console.error('[message-status] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/whatsapp/events - Log WhatsApp events (internal key auth)
  app.post('/api/whatsapp/events', async (req, res) => {
    try {
      const internalKey = req.headers['x-internal-key'];
      if (!internalKey || internalKey !== process.env.WHATSAPP_INTERNAL_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { venue_id, event_type, details, phone, message_id } = req.body;

      if (!event_type) {
        return res.status(400).json({ error: 'event_type is required' });
      }

      await prisma.whatsapp_event_log.create({
        data: {
          venue_id: venue_id || null,
          event_type,
          details: details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
          phone: phone || null,
          message_id: message_id || null
        }
      });

      res.json({ success: true });
    } catch (error) {
      console.error('[whatsapp-events] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/venues/:id/whatsapp/events - Get recent WhatsApp events for a venue
  app.get('/api/venues/:id/whatsapp/events', isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const limit = parseInt(req.query.limit) || 50;

      const events = await prisma.whatsapp_event_log.findMany({
        where: { venue_id: id },
        orderBy: { created_at: 'desc' },
        take: Math.min(limit, 200)
      });

      res.json(events);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/venues/:id/whatsapp/stats - Get message stats for a venue
  app.get('/api/venues/:id/whatsapp/stats', isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;

      // Get conversations for this venue with source baileys or cloud_api
      const conversations = await prisma.chat_conversations.findMany({
        where: { venue_id: id, source: { in: ['baileys', 'cloud_api'] } },
        select: { id: true }
      });
      const convIds = conversations.map(c => c.id);

      if (convIds.length === 0) {
        return res.json({
          total_sent: 0, total_delivered: 0, total_read: 0,
          total_failed: 0, total_pending: 0,
          last_message_at: null, failed_details: []
        });
      }

      // Count messages by status for assistant messages (outbound)
      const statusCounts = await prisma.chat_messages.groupBy({
        by: ['status'],
        where: {
          conversation_id: { in: convIds },
          role: 'assistant',
          status: { not: null }
        },
        _count: { id: true }
      });

      const counts = {};
      for (const sc of statusCounts) {
        counts[sc.status] = sc._count.id;
      }

      // Last message
      const lastMessage = await prisma.chat_messages.findFirst({
        where: { conversation_id: { in: convIds }, role: 'assistant' },
        orderBy: { created_at: 'desc' },
        select: { created_at: true, status: true }
      });

      // Recent failed messages (last 24h)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const failedMessages = await prisma.chat_messages.findMany({
        where: {
          conversation_id: { in: convIds },
          role: 'assistant',
          status: 'failed',
          created_at: { gte: oneDayAgo }
        },
        select: { id: true, error_details: true, created_at: true },
        orderBy: { created_at: 'desc' },
        take: 10
      });

      res.json({
        total_sent: counts.sent || 0,
        total_delivered: counts.delivered || 0,
        total_read: counts.read || 0,
        total_failed: counts.failed || 0,
        total_pending: counts.pending || 0,
        last_message_at: lastMessage?.created_at || null,
        failed_details: failedMessages
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== System WhatsApp (Admin) ====================

  // GET /api/admin/system-whatsapp/status
  app.get('/api/admin/system-whatsapp/status', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      if (!currentUser?.is_super_admin) {
        return res.status(403).json({ error: 'Solo administradores' });
      }
      if (!whatsappClient.isAvailable()) {
        return res.json({ status: 'unavailable' });
      }
      const status = await whatsappClient.getSystemStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/admin/system-whatsapp/connect
  app.post('/api/admin/system-whatsapp/connect', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      if (!currentUser?.is_super_admin) {
        return res.status(403).json({ error: 'Solo administradores' });
      }
      if (!whatsappClient.isAvailable()) {
        return res.status(400).json({ error: 'Servicio de WhatsApp del sistema no disponible' });
      }
      const result = await whatsappClient.connectSystem();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/admin/system-whatsapp/disconnect
  app.post('/api/admin/system-whatsapp/disconnect', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      if (!currentUser?.is_super_admin) {
        return res.status(403).json({ error: 'Solo administradores' });
      }
      if (!whatsappClient.isAvailable()) {
        return res.status(400).json({ error: 'Servicio de WhatsApp del sistema no disponible' });
      }
      await whatsappClient.disconnectSystem();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== Meta WhatsApp Cloud API Webhook ====================

  // GET /api/webhook/whatsapp — Meta verification challenge
  app.get('/api/webhook/whatsapp', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (mode === 'subscribe' && token === verifyToken) {
      console.log('[meta-webhook] Verification successful');
      return res.status(200).send(challenge);
    }
    console.warn('[meta-webhook] Verification failed', { mode, token: token?.slice(0, 6) });
    res.sendStatus(403);
  });

  // POST /api/webhook/whatsapp — Incoming messages & status updates from Meta
  app.post('/api/webhook/whatsapp', (req, res) => {
    // Respond 200 immediately — Meta retries if >20s
    res.sendStatus(200);

    // Process async
    (async () => {
      try {
        const entry = req.body?.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        if (!value) return;

        const phoneNumberId = value.metadata?.phone_number_id;
        if (!phoneNumberId) return;

        // Find venue by meta_phone_number_id
        const conn = await prisma.whatsapp_connections.findFirst({
          where: { meta_phone_number_id: phoneNumberId, channel: 'cloud_api' }
        });
        if (!conn) {
          console.warn(`[meta-webhook] No venue found for phone_number_id=${phoneNumberId}`);
          return;
        }
        const venue_id = conn.venue_id;

        // Handle incoming messages
        if (value.messages && value.messages.length > 0) {
          for (const msg of value.messages) {
            try {
              const from = msg.from; // sender phone
              const wamid = msg.id;

              // Check excluded phones
              const excludedPhones = conn.excluded_phones || [];
              if (excludedPhones.some(e => from.includes(e.phone) || e.phone.includes(from))) {
                console.log(`[meta-webhook] Skipping excluded phone ${from}`);
                continue;
              }

              // Extract message content
              let userMessage = '';
              let media_url = null;
              let media_type = null;

              if (msg.type === 'text') {
                userMessage = msg.text?.body || '';
              } else if (msg.type === 'image') {
                // Download image and upload to Cloudinary
                try {
                  const imageBuffer = await metaWhatsApp.downloadMedia(msg.image.id, conn.meta_access_token);
                  const { uploadImage } = require('./upload-service');
                  const uploaded = await uploadImage(imageBuffer, { type: 'chat_media', mimetype: msg.image.mime_type || 'image/jpeg' });
                  media_url = uploaded.secure_url;
                  media_type = 'image';
                  userMessage = msg.image.caption || '[Imagen]';
                } catch (dlErr) {
                  console.error('[meta-webhook] Failed to download/upload image:', dlErr.message);
                  userMessage = '[Imagen no disponible]';
                }
              } else if (msg.type === 'audio') {
                userMessage = '[Audio recibido - no procesable]';
              } else if (msg.type === 'document') {
                userMessage = '[Documento recibido]';
              } else if (msg.type === 'location') {
                userMessage = `[Ubicación: ${msg.location?.latitude}, ${msg.location?.longitude}]`;
              } else if (msg.type === 'contacts') {
                userMessage = '[Contacto compartido]';
              } else if (msg.type === 'sticker') {
                userMessage = '[Sticker]';
              } else if (msg.type === 'reaction') {
                // Ignore reactions
                continue;
              } else {
                userMessage = `[${msg.type || 'mensaje'} no soportado]`;
              }

              // Find or create conversation
              let conversation = await prisma.chat_conversations.findFirst({
                where: { venue_id, phone: from, source: 'cloud_api' },
                include: { messages: { orderBy: { created_at: 'asc' }, take: 20 } }
              });

              if (!conversation) {
                // Get contact name from webhook data
                const contactName = value.contacts?.[0]?.profile?.name || null;
                conversation = await prisma.chat_conversations.create({
                  data: {
                    venue_id,
                    phone: from,
                    name: contactName,
                    source: 'cloud_api',
                    status: 'active',
                    external_id: wamid
                  }
                });
                conversation.messages = [];
              }

              // Check if conversation is escalated
              if (conversation.status === 'human_attention') {
                console.log(`[meta-webhook] Conversation ${conversation.id} is escalated, skipping AI`);
                // Still save the message
                await prisma.chat_messages.create({
                  data: {
                    conversation_id: conversation.id,
                    role: 'user',
                    content: userMessage,
                    media_url,
                    media_type,
                    status: 'delivered',
                    external_id: wamid
                  }
                });
                // Mark as read
                await metaWhatsApp.markAsRead(phoneNumberId, conn.meta_access_token, wamid).catch(() => {});
                continue;
              }

              // Save user message
              await prisma.chat_messages.create({
                data: {
                  conversation_id: conversation.id,
                  role: 'user',
                  content: userMessage,
                  media_url,
                  media_type,
                  status: 'delivered',
                  external_id: wamid
                }
              });

              // Update conversation timestamp
              await prisma.chat_conversations.update({
                where: { id: conversation.id },
                data: { updated_at: new Date() }
              });

              // Process with AI
              const result = await processChat({
                venue_id,
                userMessage,
                conversation,
                source: 'cloud_api',
                media_url,
                media_type
              });

              // Send AI response
              if (result?.llmResponse?.content) {
                try {
                  const sendResult = await metaWhatsApp.sendText(
                    phoneNumberId, conn.meta_access_token, from, result.llmResponse.content
                  );
                  await prisma.chat_messages.update({
                    where: { id: result.assistantMessage.id },
                    data: {
                      status: 'sent',
                      external_id: sendResult.messages?.[0]?.id || null
                    }
                  });
                } catch (sendErr) {
                  console.error('[meta-webhook] Failed to send reply:', sendErr.message);
                  await prisma.chat_messages.update({
                    where: { id: result.assistantMessage.id },
                    data: { status: 'failed', error_details: sendErr.message }
                  });
                }
              }

              // Mark incoming message as read
              await metaWhatsApp.markAsRead(phoneNumberId, conn.meta_access_token, wamid).catch(() => {});

            } catch (msgErr) {
              console.error('[meta-webhook] Error processing message:', msgErr.message);
            }
          }
        }

        // Handle status updates
        if (value.statuses && value.statuses.length > 0) {
          for (const status of value.statuses) {
            try {
              const statusMap = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
              const mappedStatus = statusMap[status.status];
              if (!mappedStatus) continue;

              const wamid = status.id;
              // Find message by external_id
              const message = await prisma.chat_messages.findFirst({
                where: { external_id: wamid }
              });
              if (message) {
                const updateData = { status: mappedStatus };
                if (mappedStatus === 'failed' && status.errors?.[0]) {
                  updateData.error_details = `${status.errors[0].code}: ${status.errors[0].title}`;
                }
                await prisma.chat_messages.update({
                  where: { id: message.id },
                  data: updateData
                });
              }
            } catch (stErr) {
              console.error('[meta-webhook] Error processing status:', stErr.message);
            }
          }
        }

      } catch (err) {
        console.error('[meta-webhook] Unhandled error:', err);
      }
    })();
  });

  // ==================== WhatsApp Cloud API Config ====================

  // GET /api/venues/:id/whatsapp/cloud-config — Get Cloud API config (super_admin only)
  app.get('/api/venues/:id/whatsapp/cloud-config', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      if (!currentUser?.is_super_admin) {
        return res.status(403).json({ error: 'Solo super admin' });
      }

      const conn = await prisma.whatsapp_connections.findUnique({
        where: { venue_id: req.params.id }
      });

      res.json({
        channel: conn?.channel || 'baileys',
        meta_phone_number_id: conn?.meta_phone_number_id || '',
        meta_access_token: conn?.meta_access_token ? '••••••' : '',
        meta_verify_token: conn?.meta_verify_token || '',
        has_token: !!conn?.meta_access_token
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/venues/:id/whatsapp/cloud-config — Save Cloud API config (super_admin only)
  app.put('/api/venues/:id/whatsapp/cloud-config', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      if (!currentUser?.is_super_admin) {
        return res.status(403).json({ error: 'Solo super admin' });
      }

      const { channel, meta_phone_number_id, meta_access_token, meta_verify_token } = req.body;
      const venue_id = req.params.id;

      const updateData = {
        channel: channel || 'baileys',
        meta_phone_number_id: meta_phone_number_id || null,
        meta_verify_token: meta_verify_token || null,
        updated_at: new Date()
      };

      // Only update token if a new one is provided (not the masked placeholder)
      if (meta_access_token && meta_access_token !== '••••••') {
        updateData.meta_access_token = meta_access_token;
      }

      // If switching to cloud_api and status is disconnected, set to connected
      if (channel === 'cloud_api' && meta_phone_number_id && (meta_access_token || updateData.meta_access_token)) {
        updateData.status = 'connected';
      }

      await prisma.whatsapp_connections.upsert({
        where: { venue_id },
        update: updateData,
        create: {
          venue_id,
          ...updateData,
          excluded_phones: [],
          escalation_config: {}
        }
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/venues/:id/whatsapp/cloud-test — Send test template message (super_admin only)
  app.post('/api/venues/:id/whatsapp/cloud-test', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });
      if (!currentUser?.is_super_admin) {
        return res.status(403).json({ error: 'Solo super admin' });
      }

      const { to } = req.body;
      if (!to) return res.status(400).json({ error: 'Se requiere número de destino (to)' });

      const conn = await prisma.whatsapp_connections.findUnique({
        where: { venue_id: req.params.id }
      });
      if (!conn?.meta_phone_number_id || !conn?.meta_access_token) {
        return res.status(400).json({ error: 'Cloud API no configurada para este venue' });
      }

      const result = await metaWhatsApp.sendTemplate(
        conn.meta_phone_number_id, conn.meta_access_token, to, 'hello_world', 'en_US'
      );

      res.json({ success: true, message_id: result.messages?.[0]?.id });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== WhatsApp Send Helpers ====================

  /**
   * Send a text reply via the appropriate WhatsApp channel (Cloud API or Baileys).
   * Returns the send result or null if no channel is available.
   */
  async function sendWhatsAppReply(venue_id, phone, text, messageId) {
    const conn = await prisma.whatsapp_connections.findUnique({ where: { venue_id } });
    if (conn?.channel === 'cloud_api' && conn.meta_phone_number_id && conn.meta_access_token) {
      const result = await metaWhatsApp.sendText(conn.meta_phone_number_id, conn.meta_access_token, phone, text);
      if (messageId) {
        await prisma.chat_messages.update({
          where: { id: messageId },
          data: { status: 'sent', external_id: result.messages?.[0]?.id || null }
        });
      }
      return result;
    } else if (whatsappClient.isAvailable()) {
      return whatsappClient.sendMessage(venue_id, phone, text);
    }
    return null;
  }

  /**
   * Send an image via the appropriate WhatsApp channel.
   */
  async function sendWhatsAppImage(venue_id, phone, imageUrl, caption) {
    const conn = await prisma.whatsapp_connections.findUnique({ where: { venue_id } });
    if (conn?.channel === 'cloud_api' && conn.meta_phone_number_id && conn.meta_access_token) {
      return metaWhatsApp.sendImage(conn.meta_phone_number_id, conn.meta_access_token, phone, imageUrl, caption);
    } else if (whatsappClient.isAvailable()) {
      return whatsappClient.sendImage(venue_id, phone, imageUrl, caption);
    }
    return null;
  }

  /**
   * Check if any WhatsApp channel is available for a venue.
   */
  async function isWhatsAppAvailable(venue_id) {
    const conn = await prisma.whatsapp_connections.findUnique({ where: { venue_id } });
    if (conn?.channel === 'cloud_api' && conn.meta_phone_number_id && conn.meta_access_token) return true;
    return whatsappClient.isAvailable();
  }

  // ==================== Chat API ====================

  // Reusable chat processing function — called by POST /api/chat/:venue_id and reprocess endpoint
  async function processChat({ venue_id, userMessage, conversation, source, media_url, media_type, contact_type, contact_value, userId }) {
    // Get venue with all relevant info
    const venue = await prisma.venues.findUnique({
      where: { id: venue_id }
    });

    if (!venue) {
      throw Object.assign(new Error('Cabaña no encontrada'), { statusCode: 404 });
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
      throw Object.assign(new Error('Modelo de chat no configurado'), { statusCode: 400 });
    }

    const chatApiKey = llmService.getApiKeyForProvider(chatProviderCode);
    if (!chatApiKey) {
      throw Object.assign(new Error(`API key no configurada (${chatModelConfig.env_key})`), { statusCode: 400 });
    }

    // Auto-detect payment receipt: if image + estimate with payment_status 'qr_sent'
    let receiptContext = null;
    if (media_url && media_type === 'image') {
      const pendingEstimate = await prisma.estimates.findFirst({
        where: {
          conversation_id: conversation.id,
          payment_status: 'qr_sent'
        },
        orderBy: { created_at: 'desc' }
      });
      if (pendingEstimate) {
        // Update estimate with receipt
        await prisma.estimates.update({
          where: { id: pendingEstimate.id },
          data: {
            payment_status: 'receipt_received',
            receipt_url: media_url,
            updated_at: new Date()
          }
        });

        // Create payment record
        const paymentMethodRecord = pendingEstimate.payment_method_id
          ? await prisma.venue_payment_methods.findUnique({ where: { id: pendingEstimate.payment_method_id } })
          : null;

        const payment = await prisma.payments.create({
          data: {
            amount: pendingEstimate.agreed_price || pendingEstimate.calculated_price,
            payment_method: paymentMethodRecord?.label || 'WhatsApp',
            receipt_url: media_url,
            verified: false,
            created_by: 'chat_ai',
            type: 'accommodation'
          }
        });

        await prisma.estimates.update({
          where: { id: pendingEstimate.id },
          data: { payment_id: payment.id, updated_at: new Date() }
        });

        // Notify venue owner via system WhatsApp
        const waConn = await prisma.whatsapp_connections.findUnique({ where: { venue_id } });
        const notificationPhone = waConn?.notification_phone || (venue.whatsapp ? String(venue.whatsapp) : null);
        if (notificationPhone && whatsappClient.isAvailable()) {
          try {
            const clientName = conversation.name || 'Cliente';
            const clientPhone = conversation.phone || 'desconocido';
            const amount = pendingEstimate.agreed_price || pendingEstimate.calculated_price || 'N/A';
            const methodName = paymentMethodRecord?.label || 'N/A';
            const notifMsg = `💰 *Comprobante de Pago Recibido - ${venue.name || 'Venue'}*\n\n*Cliente:* ${clientName}\n*Teléfono:* ${clientPhone}\n*Monto:* $${amount}\n*Método:* ${methodName}\n\n🔗 Verifica el pago en el sistema para confirmar la reserva.`;
            await whatsappClient.sendSystemMessage(notificationPhone, notifMsg);
          } catch (notifErr) {
            console.error('[payment] Failed to send receipt notification:', notifErr.message);
          }
        }

        receiptContext = '[El cliente envió un comprobante de pago. El sistema ya lo registró automáticamente. Confirma al cliente que recibiste su comprobante y que será verificado por el equipo pronto.]';
      }
    }

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

    // Add current message (with receipt context if applicable)
    const finalUserMessage = receiptContext ? `${userMessage}\n\n${receiptContext}` : userMessage;
    llmMessages.push({ role: 'user', content: finalUserMessage });

    // Call LLM using configured model with tools
    const chatLlmStart = Date.now();
    let chatTotalInputTokens = 0;
    let chatTotalOutputTokens = 0;
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
        } else if (toolCall.function.name === 'get_payment_methods') {
          // Get active payment methods for this venue
          const paymentMethods = await prisma.venue_payment_methods.findMany({
            where: { venue_id, is_active: true },
            orderBy: { sort_order: 'asc' },
            select: { id: true, method_type: true, label: true, account_info: true, holder_name: true, instructions: true, qr_image_url: true }
          });

          const paymentResult = {
            methods: paymentMethods.map(m => ({
              id: m.id,
              type: m.method_type,
              name: m.label,
              account_info: m.account_info,
              holder_name: m.holder_name,
              has_qr: !!m.qr_image_url,
              instructions: m.instructions
            })),
            message: paymentMethods.length > 0
              ? `Hay ${paymentMethods.length} método(s) de pago disponible(s).`
              : 'No hay métodos de pago configurados. El cliente deberá coordinar el pago directamente con el venue.'
          };

          const toolResultContent = JSON.stringify(paymentResult);

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
            temperature: 0.7,
            tools: llmService.CHAT_TOOLS
          });

          llmResponse.tools_used = llmResponse.tools_used || [];
          llmResponse.tools_used.push('get_payment_methods');
        } else if (toolCall.function.name === 'send_payment_info') {
          const args = JSON.parse(toolCall.function.arguments);

          // Fetch the payment method
          const paymentMethod = args.payment_method_id
            ? await prisma.venue_payment_methods.findUnique({ where: { id: args.payment_method_id } })
            : null;

          let sendResult;
          if (!paymentMethod) {
            sendResult = { success: false, message: 'Método de pago no encontrado.' };
          } else {
            // Update estimate
            if (args.estimate_id) {
              await prisma.estimates.update({
                where: { id: args.estimate_id },
                data: {
                  payment_status: 'qr_sent',
                  payment_method_id: paymentMethod.id,
                  updated_at: new Date()
                }
              });
            }

            // Build caption
            const amount = args.payment_amount || 0;
            let caption = `💳 *Pago - ${paymentMethod.label}*\n`;
            if (amount) caption += `\n💰 *Monto:* $${Number(amount).toLocaleString('es-CO')}\n`;
            if (paymentMethod.account_info) caption += `\n📱 *Cuenta/Número:* ${paymentMethod.account_info}`;
            if (paymentMethod.holder_name) caption += `\n👤 *Titular:* ${paymentMethod.holder_name}`;
            if (paymentMethod.instructions) caption += `\n\n📝 ${paymentMethod.instructions}`;
            caption += '\n\n📸 Una vez realices el pago, envía la foto del comprobante por este chat.';

            // Send QR image or text via WhatsApp if source is baileys or cloud_api
            if ((source === 'baileys' || source === 'cloud_api') && conversation.phone) {
              try {
                if (paymentMethod.qr_image_url) {
                  await sendWhatsAppImage(venue_id, conversation.phone, paymentMethod.qr_image_url, caption);
                } else {
                  await sendWhatsAppReply(venue_id, conversation.phone, caption);
                }
              } catch (sendErr) {
                console.error('[payment] Failed to send payment info via WhatsApp:', sendErr.message);
              }
            }

            sendResult = {
              success: true,
              method_name: paymentMethod.label,
              has_qr: !!paymentMethod.qr_image_url,
              message: paymentMethod.qr_image_url
                ? `Se envió el QR de ${paymentMethod.label} al cliente con los datos de pago.`
                : `Se enviaron los datos de pago de ${paymentMethod.label} al cliente.`
            };
          }

          const toolResultContent = JSON.stringify(sendResult);

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
          llmResponse.tools_used.push('send_payment_info');
        } else if (toolCall.function.name === 'escalate_to_human') {
          const args = JSON.parse(toolCall.function.arguments);

          // Check if escalation is enabled for this venue
          const waConn = await prisma.whatsapp_connections.findUnique({
            where: { venue_id }
          });
          const escConfig = waConn?.escalation_config || {};
          const reason = args.reason || 'ai_decided';

          // Verify the trigger is enabled
          let escalationAllowed = true;
          if (reason === 'client_requested' && escConfig.client_request_enabled === false) {
            escalationAllowed = false;
          }
          if (reason === 'ai_decided' && escConfig.ai_escalation_enabled === false) {
            escalationAllowed = false;
          }

          let escalateResult;
          if (escalationAllowed) {
            // Calculate resume_at (next 3 AM in America/Bogota if auto_resume enabled)
            const autoResumeEnabled = escConfig.auto_resume_enabled !== false;
            const autoResumeHour = escConfig.auto_resume_hour || 3;
            let resumeAt = null;
            if (autoResumeEnabled) {
              resumeAt = getNextResumeTime(autoResumeHour);
            }

            // Mark conversation as human_attention
            await prisma.chat_conversations.update({
              where: { id: conversation.id },
              data: {
                status: 'human_attention',
                escalated_at: new Date(),
                escalated_reason: reason,
                resume_at: resumeAt,
                updated_at: new Date()
              }
            });

            // Send notification via system WhatsApp
            const notificationPhone = waConn?.notification_phone || (venue.whatsapp ? String(venue.whatsapp) : null);
            if (notificationPhone && whatsappClient.isAvailable()) {
              try {
                const clientPhone = conversation.phone || 'desconocido';
                const clientName = conversation.name || 'Cliente';
                const resumeNote = autoResumeEnabled
                  ? `Si no me dices nada, retomo mañana a las ${autoResumeHour}:00 AM automáticamente.`
                  : 'Respóndeme "ya puedes seguir" cuando quieras que CabanIA retome.';

                const notificationMsg = `🔔 *Escalación CabanIA - ${venue.name || 'Venue'}*\n\n*Resumen:* ${args.summary}\n*Cliente:* ${clientName}\n*Teléfono:* ${clientPhone}\n*Link directo:* https://wa.me/${clientPhone}\n\nPara continuar la conversación, contacta al cliente directamente.\nCuando quieras que CabanIA retome, respóndeme: "ya puedes seguir"\n${resumeNote}`;

                await whatsappClient.sendSystemMessage(notificationPhone, notificationMsg);
                console.log(`[escalation] Notification sent to ${notificationPhone} for venue ${venue_id}`);
              } catch (notifErr) {
                console.error('[escalation] Failed to send notification:', notifErr.message);
              }
            }

            escalateResult = {
              success: true,
              message: 'Conversación escalada a un humano. El propietario ha sido notificado.',
              reason
            };
          } else {
            escalateResult = {
              success: false,
              message: 'El escalamiento no está habilitado para este tipo de solicitud. Continúa asistiendo al cliente.',
              reason
            };
          }

          const toolResultContent = JSON.stringify(escalateResult);

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
          llmResponse.tools_used.push('escalate_to_human');
        }
      }
    }

    // Check message limit escalation (before responding, after tool calls)
    if (source === 'baileys' && conversation.phone) {
      const waConn = await prisma.whatsapp_connections.findUnique({
        where: { venue_id }
      });
      const escConfig = waConn?.escalation_config || {};
      if (escConfig.message_limit_enabled && escConfig.message_limit > 0) {
        const userMsgCount = await prisma.chat_messages.count({
          where: { conversation_id: conversation.id, role: 'user' }
        });
        // Check if estimate was created for this conversation
        const hasEstimate = await prisma.estimates.count({
          where: { conversation_id: conversation.id }
        });
        if (userMsgCount >= escConfig.message_limit && hasEstimate === 0 && conversation.status !== 'human_attention') {
          // Force escalation by message limit
          const autoResumeEnabled = escConfig.auto_resume_enabled !== false;
          const autoResumeHour = escConfig.auto_resume_hour || 3;
          let resumeAt = autoResumeEnabled ? getNextResumeTime(autoResumeHour) : null;

          await prisma.chat_conversations.update({
            where: { id: conversation.id },
            data: {
              status: 'human_attention',
              escalated_at: new Date(),
              escalated_reason: 'message_limit',
              resume_at: resumeAt,
              updated_at: new Date()
            }
          });

          // Notify owner
          const notificationPhone = waConn?.notification_phone || (venue.whatsapp ? String(venue.whatsapp) : null);
          if (notificationPhone && whatsappClient.isAvailable()) {
            try {
              const clientPhone = conversation.phone || 'desconocido';
              const clientName = conversation.name || 'Cliente';
              const notificationMsg = `🔔 *Escalación CabanIA - ${venue.name || 'Venue'}*\n\n*Motivo:* Límite de ${escConfig.message_limit} mensajes alcanzado sin cotización\n*Cliente:* ${clientName}\n*Teléfono:* ${clientPhone}\n*Link directo:* https://wa.me/${clientPhone}\n\nEl cliente lleva ${userMsgCount} mensajes sin generar cotización. Puede necesitar atención personalizada.\nResponde "ya puedes seguir" para reactivar CabanIA.`;

              await whatsappClient.sendSystemMessage(notificationPhone, notificationMsg);
            } catch (notifErr) {
              console.error('[escalation] Failed to send limit notification:', notifErr.message);
            }
          }
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
        tokens_used: llmResponse.usage?.total_tokens,
        status: source === 'baileys' ? 'pending' : null
      }
    });

    // Update conversation timestamp
    await prisma.chat_conversations.update({
      where: { id: conversation.id },
      data: { updated_at: new Date() }
    });

    // Audit log for chat
    chatTotalInputTokens += llmResponse.usage?.prompt_tokens || 0;
    chatTotalOutputTokens += llmResponse.usage?.completion_tokens || 0;
    logAICall({
      venue_id,
      feature: 'chat',
      provider_code: chatProviderCode,
      model: llmResponse.model || chatProviderCode,
      system_prompt: systemPrompt,
      user_prompt: userMessage,
      response_content: llmResponse.content,
      input_tokens: chatTotalInputTokens,
      output_tokens: chatTotalOutputTokens,
      response_time_ms: Date.now() - chatLlmStart,
      user_id: userId,
      conversation_id: conversation.id,
      metadata: { tools_used: toolsUsed, source }
    });

    return {
      assistantMessage,
      llmResponse,
      chatProviderCode,
      toolsUsed
    };
  }

  // POST /api/chat/:venue_id - Chat endpoint (supports internal and webhook calls)
  app.post('/api/chat/:venue_id', async (req, res) => {
    try {
      const { venue_id } = req.params;
      const { message, conversation_id, source = 'web', contact_type, contact_value, media_url, media_type } = req.body;

      // Validate internal key for Baileys microservice callbacks
      if (source === 'baileys' && process.env.WHATSAPP_INTERNAL_KEY) {
        const internalKey = req.headers['x-internal-key'];
        if (internalKey !== process.env.WHATSAPP_INTERNAL_KEY) {
          return res.status(401).json({ error: 'Invalid internal key' });
        }
      }

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
            phone: phone || req.body.visitor_phone || null,
            name: userName || req.body.visitor_name || null
          }
        });
        conversation.messages = [];
      }

      // Update visitor info if provided
      if (req.body.visitor_name || req.body.visitor_phone) {
        const updateData = { updated_at: new Date() };
        if (req.body.visitor_name && !conversation.name) updateData.name = req.body.visitor_name;
        if (req.body.visitor_phone && !conversation.phone) updateData.phone = req.body.visitor_phone;
        if (Object.keys(updateData).length > 1) {
          await prisma.chat_conversations.update({
            where: { id: conversation.id },
            data: updateData
          });
        }
      }

      // Check free tier limit for public (non-authenticated) requests
      if (!req.user) {
        const limitSetting = await prisma.app_settings.findUnique({
          where: { setting_key: 'public_chat_free_limit' }
        });
        const freeLimit = parseInt(limitSetting?.setting_value) || 20;
        const isVerified = conversation.metadata?.verified === true;
        const userMsgCount = conversation.messages
          ? conversation.messages.filter(m => m.role === 'user').length
          : 0;

        if (!isVerified && userMsgCount >= freeLimit) {
          return res.status(403).json({
            error: 'free_limit_reached',
            message_count: userMsgCount,
            free_limit: freeLimit,
            requires_verification: true
          });
        }
      }

      // Save user message
      const userMsg = await prisma.chat_messages.create({
        data: {
          conversation_id: conversation.id,
          role: 'user',
          content: userMessage,
          media_url: media_url || null,
          media_type: media_type || null,
          status: (source === 'baileys' || source === 'cloud_api') ? 'delivered' : null
        }
      });

      // Process chat with LLM
      const result = await processChat({
        venue_id,
        userMessage,
        conversation,
        source,
        media_url,
        media_type,
        contact_type,
        contact_value,
        userId: req.user?.id
      });

      // Count user messages for limit tracking
      const updatedMsgCount = await prisma.chat_messages.count({
        where: { conversation_id: conversation.id, role: 'user' }
      });
      const limitSetting2 = await prisma.app_settings.findUnique({
        where: { setting_key: 'public_chat_free_limit' }
      });

      res.json({
        conversation_id: conversation.id,
        assistant_message_id: result.assistantMessage.id,
        user_message_id: userMsg.id,
        message: result.llmResponse.content,
        provider: result.chatProviderCode,
        model: result.llmResponse.model,
        tokens_used: result.llmResponse.usage?.total_tokens,
        message_count: updatedMsgCount,
        free_limit: parseInt(limitSetting2?.setting_value) || 20,
        is_verified: conversation.metadata?.verified === true
      });
    } catch (error) {
      console.error('Chat error:', error);
      const status = error.statusCode || 500;
      res.status(status).json({ error: error.message });
    }
  });

  // POST /api/chat/:venue_id/messages/:message_id/reprocess - Reprocess a user message through AI
  app.post('/api/chat/:venue_id/messages/:message_id/reprocess', isAuthenticated, async (req, res) => {
    try {
      const { venue_id, message_id } = req.params;

      // Find the user message
      const targetMessage = await prisma.chat_messages.findUnique({
        where: { id: message_id },
        include: { conversation: true }
      });

      if (!targetMessage) {
        return res.status(404).json({ error: 'Mensaje no encontrado' });
      }

      if (targetMessage.role !== 'user') {
        return res.status(400).json({ error: 'Solo se pueden reprocesar mensajes del usuario' });
      }

      if (targetMessage.conversation.venue_id !== venue_id) {
        return res.status(403).json({ error: 'El mensaje no pertenece a este venue' });
      }

      // Load conversation history up to and including the target message
      const historyMessages = await prisma.chat_messages.findMany({
        where: {
          conversation_id: targetMessage.conversation_id,
          created_at: { lt: targetMessage.created_at }
        },
        orderBy: { created_at: 'asc' },
        take: 20
      });

      // Build conversation object with history (excluding the target message itself — it will be the "current" message)
      const conversation = {
        ...targetMessage.conversation,
        messages: historyMessages
      };

      const source = conversation.source || 'web';

      // Process chat with LLM
      const result = await processChat({
        venue_id,
        userMessage: targetMessage.content,
        conversation,
        source,
        media_url: targetMessage.media_url,
        media_type: targetMessage.media_type,
        userId: req.user?.id
      });

      // If source is WhatsApp (baileys or cloud_api), send the response
      if ((source === 'baileys' || source === 'cloud_api') && conversation.phone) {
        try {
          await sendWhatsAppReply(venue_id, conversation.phone, result.llmResponse.content, result.assistantMessage.id);
        } catch (sendErr) {
          console.error('[reprocess] Failed to send via WhatsApp:', sendErr.message);
          await prisma.chat_messages.update({
            where: { id: result.assistantMessage.id },
            data: { status: 'failed', error_details: sendErr.message }
          });
        }
      }

      res.json({
        assistant_message_id: result.assistantMessage.id,
        response: result.llmResponse.content,
        model: result.llmResponse.model,
        tokens_used: result.llmResponse.usage?.total_tokens,
        status: result.assistantMessage.status
      });
    } catch (error) {
      console.error('Reprocess error:', error);
      const status = error.statusCode || 500;
      res.status(status).json({ error: error.message });
    }
  });

  // POST /api/chat/:venue_id/messages/:message_id/send-whatsapp - Send assistant message via WhatsApp
  app.post('/api/chat/:venue_id/messages/:message_id/send-whatsapp', isAuthenticated, async (req, res) => {
    try {
      const { venue_id, message_id } = req.params;

      const message = await prisma.chat_messages.findUnique({
        where: { id: message_id },
        include: { conversation: true }
      });

      if (!message) {
        return res.status(404).json({ error: 'Mensaje no encontrado' });
      }
      if (message.role !== 'assistant') {
        return res.status(400).json({ error: 'Solo se pueden enviar mensajes del asistente' });
      }
      if (message.conversation.venue_id !== venue_id) {
        return res.status(403).json({ error: 'El mensaje no pertenece a este venue' });
      }

      const phone = message.conversation.phone;
      if (!phone) {
        return res.status(400).json({ error: 'La conversación no tiene número de teléfono asociado' });
      }

      if (!(await isWhatsAppAvailable(venue_id))) {
        return res.status(503).json({ error: 'Servicio de WhatsApp no disponible' });
      }

      try {
        await sendWhatsAppReply(venue_id, phone, message.content, message_id);
        const updated = await prisma.chat_messages.findUnique({ where: { id: message_id } });
        res.json({ status: updated.status, external_id: updated.external_id });
      } catch (sendErr) {
        console.error('[send-whatsapp] Failed:', sendErr.message);
        await prisma.chat_messages.update({
          where: { id: message_id },
          data: { status: 'failed', error_details: sendErr.message }
        });
        res.status(502).json({ error: 'Error al enviar por WhatsApp', details: sendErr.message });
      }
    } catch (error) {
      console.error('Send WhatsApp error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/chat/:venue_id/conversations - List conversations for a venue (inbox)
  app.get('/api/chat/:venue_id/conversations', isAuthenticated, async (req, res) => {
    try {
      const { venue_id } = req.params;
      const { search, source } = req.query;

      const where = { venue_id };

      // Filter by source channels (comma-separated)
      if (source) {
        where.source = { in: source.split(',').map(s => s.trim()) };
      }

      // Search by name or phone
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } }
        ];
      }

      const conversations = await prisma.chat_conversations.findMany({
        where,
        orderBy: { updated_at: 'desc' },
        take: 50,
        include: {
          messages: {
            orderBy: { created_at: 'desc' },
            take: 1,
            select: { content: true, role: true, created_at: true, provider: true }
          }
        }
      });

      // Add last_message preview and unread_count
      const result = await Promise.all(conversations.map(async (conv) => {
        const lastMsg = conv.messages[0] || null;
        // Count user messages after last_read_at
        let unread_count = 0;
        const unreadWhere = { conversation_id: conv.id, role: 'user' };
        if (conv.last_read_at) {
          unreadWhere.created_at = { gt: conv.last_read_at };
        }
        unread_count = await prisma.chat_messages.count({ where: unreadWhere });

        const { messages, ...convData } = conv;
        return {
          ...convData,
          last_message: lastMsg ? {
            content: (lastMsg.content || '').substring(0, 100),
            role: lastMsg.role,
            created_at: lastMsg.created_at,
            provider: lastMsg.provider
          } : null,
          unread_count
        };
      }));

      res.json(result);
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

      // Mark as read
      if (conversation) {
        await prisma.chat_conversations.update({
          where: { id: req.params.id },
          data: { last_read_at: new Date() }
        });
      }

      res.json(conversation);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/chat/:venue_id/conversations/:id/admin-reply - Send manual admin reply
  app.post('/api/chat/:venue_id/conversations/:id/admin-reply', isAuthenticated, async (req, res) => {
    try {
      const { venue_id, id } = req.params;
      const { text } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).json({ error: 'Text is required' });
      }

      const conversation = await prisma.chat_conversations.findUnique({ where: { id } });
      if (!conversation || conversation.venue_id !== venue_id) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Save as assistant message with provider 'admin'
      const message = await prisma.chat_messages.create({
        data: {
          conversation_id: id,
          role: 'assistant',
          content: text.trim(),
          provider: 'admin',
          status: 'pending'
        }
      });

      // Update conversation timestamp
      await prisma.chat_conversations.update({
        where: { id },
        data: { updated_at: new Date(), last_read_at: new Date() }
      });

      // Send via WhatsApp if the conversation has a phone number
      if (conversation.phone && conversation.source !== 'web') {
        try {
          await sendWhatsAppReply(venue_id, conversation.phone, text.trim(), message.id);
        } catch (waError) {
          console.error('Admin reply WhatsApp send error:', waError);
          await prisma.chat_messages.update({
            where: { id: message.id },
            data: { status: 'failed', error_details: waError.message }
          });
          return res.json({ ...message, status: 'failed', error_details: waError.message });
        }
      } else {
        // Web channel — just mark as sent (user will see on page reload)
        await prisma.chat_messages.update({
          where: { id: message.id },
          data: { status: 'sent' }
        });
        message.status = 'sent';
      }

      res.json(message);
    } catch (error) {
      console.error('Admin reply error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/chat/:venue_id/conversations/:id - Delete a conversation and its messages
  app.delete('/api/chat/:venue_id/conversations/:id', isAuthenticated, async (req, res) => {
    try {
      const { venue_id, id } = req.params;
      const conversation = await prisma.chat_conversations.findUnique({ where: { id } });
      if (!conversation || conversation.venue_id !== venue_id) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      // Messages cascade-delete via schema relation (onDelete: Cascade)
      await prisma.chat_conversations.delete({ where: { id } });
      res.json({ success: true });
    } catch (error) {
      console.error('Delete conversation error:', error);
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

  // ==================== Inventory API ====================

  // --- Inventory Categories ---

  app.get('/api/inventory-categories', async (req, res) => {
    try {
      const categories = await prisma.inventory_categories.findMany({
        where: { is_active: true },
        orderBy: { name: 'asc' }
      });
      res.json(categories);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/inventory-categories', isAuthenticated, async (req, res) => {
    try {
      const category = await prisma.inventory_categories.create({ data: req.body });
      res.json(category);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/inventory-categories/:id', isAuthenticated, async (req, res) => {
    try {
      const existing = await prisma.inventory_categories.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Categoría no encontrada' });
      const category = await prisma.inventory_categories.update({ where: { id: req.params.id }, data: req.body });
      res.json(category);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/inventory-categories/:id', isAuthenticated, async (req, res) => {
    try {
      const existing = await prisma.inventory_categories.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Categoría no encontrada' });
      await prisma.inventory_categories.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Inventory Items ---

  app.get('/api/inventory', isAuthenticated, async (req, res) => {
    try {
      const { venue_id, organization_id, type, category_id, low_stock, search } = req.query;
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });

      let accessibleOrgIds = null;
      if (currentUser?.is_super_admin) {
        const userOrgs = await prisma.user_organizations.findMany({ where: { user_id: userId } });
        accessibleOrgIds = userOrgs.map(uo => uo.organization_id);
      } else {
        accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
      }

      const whereClause = { is_active: true };
      if (accessibleOrgIds !== null) {
        if (accessibleOrgIds.length === 0) return res.json([]);
        whereClause.organization_id = { in: accessibleOrgIds };
      }
      if (venue_id) whereClause.venue_id = venue_id;
      if (organization_id) whereClause.organization_id = organization_id;
      if (type) whereClause.type = type;
      if (category_id) whereClause.category_id = category_id;
      if (search) whereClause.name = { contains: search, mode: 'insensitive' };

      const items = await prisma.inventory_items.findMany({
        where: whereClause,
        include: { category: true },
        orderBy: { name: 'asc' }
      });

      if (low_stock === 'true') {
        return res.json(items.filter(item => item.minimum_stock !== null && parseFloat(item.quantity) <= parseFloat(item.minimum_stock)));
      }
      res.json(items);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/inventory/:id', isAuthenticated, async (req, res) => {
    try {
      const item = await prisma.inventory_items.findUnique({
        where: { id: req.params.id },
        include: { category: true, images: true, movements: { take: 20, orderBy: { created_at: 'desc' } } }
      });
      if (!item) return res.status(404).json({ error: 'Item no encontrado' });
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/inventory', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const data = { ...req.body, created_by: userId };
      // Sanitize empty strings to null for optional fields
      const optionalDecimalFields = ['quantity', 'minimum_stock', 'unit_cost'];
      const optionalStringFields = ['description', 'notes', 'condition', 'brand', 'model_name', 'serial_number', 'location_notes', 'unit'];
      for (const f of optionalDecimalFields) {
        if (data[f] === '' || data[f] === undefined) data[f] = null;
        else if (data[f] !== null) data[f] = parseFloat(data[f]);
      }
      for (const f of optionalStringFields) {
        if (data[f] === '') data[f] = null;
      }
      if (data.purchase_date && data.purchase_date !== '') data.purchase_date = new Date(data.purchase_date);
      else data.purchase_date = null;
      if (data.warranty_expiry && data.warranty_expiry !== '') data.warranty_expiry = new Date(data.warranty_expiry);
      else data.warranty_expiry = null;
      const item = await prisma.inventory_items.create({ data });
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/inventory/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const existing = await prisma.inventory_items.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Item no encontrado' });
      const updateData = { ...req.body, updated_at: new Date(), updated_by: userId };
      const optionalDecimalFields = ['quantity', 'minimum_stock', 'unit_cost'];
      const optionalStringFields = ['description', 'notes', 'condition', 'brand', 'model_name', 'serial_number', 'location_notes', 'unit'];
      for (const f of optionalDecimalFields) {
        if (updateData[f] === '' || updateData[f] === undefined) updateData[f] = null;
        else if (updateData[f] !== null) updateData[f] = parseFloat(updateData[f]);
      }
      for (const f of optionalStringFields) {
        if (updateData[f] === '') updateData[f] = null;
      }
      if (updateData.purchase_date && updateData.purchase_date !== '') updateData.purchase_date = new Date(updateData.purchase_date);
      else updateData.purchase_date = null;
      if (updateData.warranty_expiry && updateData.warranty_expiry !== '') updateData.warranty_expiry = new Date(updateData.warranty_expiry);
      else updateData.warranty_expiry = null;
      const item = await prisma.inventory_items.update({ where: { id: req.params.id }, data: updateData });
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/inventory/:id', isAuthenticated, async (req, res) => {
    try {
      const existing = await prisma.inventory_items.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Item no encontrado' });
      await prisma.inventory_items.update({ where: { id: req.params.id }, data: { is_active: false } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Inventory Images ---

  app.post('/api/inventory/:id/images', isAuthenticated, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No se proporcionó archivo o tipo no permitido' });
      const item = await prisma.inventory_items.findUnique({ where: { id: req.params.id } });
      if (!item) return res.status(404).json({ error: 'Item no encontrado' });
      const result = await uploadImage(req.file.buffer, { type: 'inventory', mimetype: req.file.mimetype });
      const is_cover = req.body.is_cover === 'true' || req.body.is_cover === true;
      if (is_cover) {
        await prisma.inventory_images.updateMany({ where: { inventory_item_id: req.params.id }, data: { is_cover: false } });
      }
      const image = await prisma.inventory_images.create({
        data: { inventory_item_id: req.params.id, image_url: result.secure_url, is_cover: is_cover || false, description: req.body.description || null, sort_order: parseInt(req.body.sort_order) || 0 }
      });
      res.json(image);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/inventory-images/:id', isAuthenticated, async (req, res) => {
    try {
      const existing = await prisma.inventory_images.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Imagen no encontrada' });
      if (existing.image_url) {
        const publicId = extractPublicId(existing.image_url);
        if (publicId) await deleteImage(publicId);
      }
      await prisma.inventory_images.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Inventory Movements ---

  app.get('/api/inventory/:id/movements', isAuthenticated, async (req, res) => {
    try {
      const movements = await prisma.inventory_movements.findMany({
        where: { inventory_item_id: req.params.id },
        orderBy: { created_at: 'desc' },
        take: 50
      });
      res.json(movements);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/inventory/:id/movements', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const { type, quantity_change, reason } = req.body;
      const validTypes = ['consumption_general', 'adjustment', 'return'];
      if (!validTypes.includes(type)) return res.status(400).json({ error: 'Tipo de movimiento no válido' });

      const item = await prisma.inventory_items.findUnique({ where: { id: req.params.id } });
      if (!item) return res.status(404).json({ error: 'Item no encontrado' });

      if (type === 'consumption_general' && quantity_change > 0) return res.status(400).json({ error: 'La cantidad para consumo debe ser negativa' });
      if (type === 'return' && quantity_change > 0) return res.status(400).json({ error: 'La cantidad para devolución debe ser negativa' });

      const result = await prisma.$transaction(async (tx) => {
        const movement = await tx.inventory_movements.create({
          data: { inventory_item_id: req.params.id, organization_id: item.organization_id, venue_id: item.venue_id, type, quantity_change, reason: reason || null, created_by: userId }
        });
        const updatedItem = await tx.inventory_items.update({
          where: { id: req.params.id },
          data: { quantity: parseFloat(item.quantity) + parseFloat(quantity_change) }
        });
        return { movement, item: updatedItem };
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Expense-Inventory Items ---

  app.get('/api/expenses/:id/inventory-items', isAuthenticated, async (req, res) => {
    try {
      const expenseItems = await prisma.expense_inventory_items.findMany({
        where: { expense_id: req.params.id },
        include: { inventory_item: { include: { category: true } } }
      });
      res.json(expenseItems);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/expenses/:id/inventory-items', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const { inventory_item_id, quantity, unit_cost, notes } = req.body;

      const expense = await prisma.expenses.findUnique({ where: { id: req.params.id } });
      if (!expense) return res.status(404).json({ error: 'Gasto no encontrado' });

      const item = await prisma.inventory_items.findUnique({ where: { id: inventory_item_id } });
      if (!item) return res.status(404).json({ error: 'Item no encontrado' });

      const result = await prisma.$transaction(async (tx) => {
        const expenseItem = await tx.expense_inventory_items.create({
          data: { expense_id: req.params.id, inventory_item_id, quantity, unit_cost: unit_cost || null, notes: notes || null }
        });
        await tx.inventory_items.update({
          where: { id: inventory_item_id },
          data: { quantity: parseFloat(item.quantity) + parseFloat(quantity) }
        });
        await tx.inventory_movements.create({
          data: { inventory_item_id, organization_id: item.organization_id, venue_id: item.venue_id, type: 'purchase', quantity_change: quantity, reference_id: req.params.id, reference_type: 'expense', reason: 'Compra registrada en gasto', created_by: userId }
        });
        return expenseItem;
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/expense-inventory-items/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const record = await prisma.expense_inventory_items.findUnique({ where: { id: req.params.id } });
      if (!record) return res.status(404).json({ error: 'Registro no encontrado' });

      const item = await prisma.inventory_items.findUnique({ where: { id: record.inventory_item_id } });

      await prisma.$transaction(async (tx) => {
        if (item) {
          await tx.inventory_items.update({
            where: { id: record.inventory_item_id },
            data: { quantity: parseFloat(item.quantity) - parseFloat(record.quantity) }
          });
          await tx.inventory_movements.create({
            data: { inventory_item_id: record.inventory_item_id, organization_id: item.organization_id, venue_id: item.venue_id, type: 'adjustment', quantity_change: -parseFloat(record.quantity), reference_id: record.expense_id, reference_type: 'expense_reversal', reason: 'Reversión de compra vinculada a gasto', created_by: userId }
          });
        }
        await tx.expense_inventory_items.delete({ where: { id: req.params.id } });
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== Maintenance API ====================

  // --- Maintenance Zones ---

  app.get('/api/maintenance-zones', isAuthenticated, async (req, res) => {
    try {
      const { venue_id } = req.query;
      const whereClause = { is_active: true };
      if (venue_id) whereClause.venue_id = venue_id;
      const zones = await prisma.maintenance_zones.findMany({ where: whereClause, orderBy: { name: 'asc' } });
      res.json(zones);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/maintenance-zones/:id', isAuthenticated, async (req, res) => {
    try {
      const zone = await prisma.maintenance_zones.findUnique({ where: { id: req.params.id } });
      if (!zone) return res.status(404).json({ error: 'Zona no encontrada' });
      res.json(zone);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/maintenance-zones', isAuthenticated, async (req, res) => {
    try {
      const zone = await prisma.maintenance_zones.create({ data: req.body });
      res.json(zone);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/maintenance-zones/:id', isAuthenticated, async (req, res) => {
    try {
      const existing = await prisma.maintenance_zones.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Zona no encontrada' });
      const zone = await prisma.maintenance_zones.update({ where: { id: req.params.id }, data: { ...req.body, updated_at: new Date() } });
      res.json(zone);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/maintenance-zones/:id', isAuthenticated, async (req, res) => {
    try {
      const existing = await prisma.maintenance_zones.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Zona no encontrada' });
      await prisma.maintenance_zones.update({ where: { id: req.params.id }, data: { is_active: false } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Maintenance Logs ---

  app.get('/api/maintenance-logs', isAuthenticated, async (req, res) => {
    try {
      const { venue_id, zone_id, provider_id, status, from_date, to_date } = req.query;
      const userId = String(req.user.claims?.sub);
      const currentUser = await prisma.users.findUnique({ where: { id: userId } });

      let accessibleOrgIds = null;
      if (currentUser?.is_super_admin) {
        const userOrgs = await prisma.user_organizations.findMany({ where: { user_id: userId } });
        accessibleOrgIds = userOrgs.map(uo => uo.organization_id);
      } else {
        accessibleOrgIds = await getAccessibleOrganizationIds(req.userPermissions);
      }

      const whereClause = {};
      if (accessibleOrgIds !== null) {
        if (accessibleOrgIds.length === 0) return res.json([]);
        whereClause.organization_id = { in: accessibleOrgIds };
      }
      if (venue_id) whereClause.venue_id = venue_id;
      if (zone_id) whereClause.zone_id = zone_id;
      if (provider_id) whereClause.provider_id = provider_id;
      if (status) whereClause.status = status;
      if (from_date || to_date) {
        whereClause.maintenance_date = {};
        if (from_date) whereClause.maintenance_date.gte = new Date(from_date);
        if (to_date) whereClause.maintenance_date.lte = new Date(to_date);
      }

      const logs = await prisma.maintenance_logs.findMany({
        where: whereClause,
        include: { zone: true, provider: true },
        orderBy: { maintenance_date: 'desc' }
      });

      // Enrich with venue data
      const venueIds = [...new Set(logs.filter(l => l.venue_id).map(l => l.venue_id))];
      const venues = venueIds.length > 0 ? await prisma.venues.findMany({ where: { id: { in: venueIds } } }) : [];
      const venuesMap = Object.fromEntries(venues.map(v => [v.id, v]));

      const enriched = logs.map(l => ({ ...l, venue_data: l.venue_id ? venuesMap[l.venue_id] || null : null }));
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/maintenance-logs/:id', isAuthenticated, async (req, res) => {
    try {
      const log = await prisma.maintenance_logs.findUnique({
        where: { id: req.params.id },
        include: { zone: true, provider: true, supplies: { include: { inventory_item: true } }, images: true }
      });
      if (!log) return res.status(404).json({ error: 'Registro no encontrado' });
      res.json(log);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/maintenance-logs', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const data = { ...req.body, created_by: userId };
      if (data.maintenance_date && data.maintenance_date !== '') data.maintenance_date = new Date(data.maintenance_date);
      else data.maintenance_date = null;
      const mlOptDecimal = ['cost'];
      const mlOptString = ['work_performed', 'pending_items', 'notes', 'entry_time', 'exit_time', 'priority', 'provider_id', 'zone_id'];
      for (const f of mlOptDecimal) { if (data[f] === '' || data[f] === undefined) data[f] = null; else if (data[f] !== null) data[f] = parseFloat(data[f]); }
      for (const f of mlOptString) { if (data[f] === '') data[f] = null; }
      const log = await prisma.maintenance_logs.create({ data });
      res.json(log);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/maintenance-logs/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const existing = await prisma.maintenance_logs.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Registro no encontrado' });
      const updateData = { ...req.body, updated_at: new Date(), updated_by: userId };
      if (updateData.maintenance_date && updateData.maintenance_date !== '') updateData.maintenance_date = new Date(updateData.maintenance_date);
      else updateData.maintenance_date = null;
      const mlOptDecimal2 = ['cost'];
      const mlOptString2 = ['work_performed', 'pending_items', 'notes', 'entry_time', 'exit_time', 'priority', 'provider_id', 'zone_id'];
      for (const f of mlOptDecimal2) { if (updateData[f] === '' || updateData[f] === undefined) updateData[f] = null; else if (updateData[f] !== null) updateData[f] = parseFloat(updateData[f]); }
      for (const f of mlOptString2) { if (updateData[f] === '') updateData[f] = null; }
      const log = await prisma.maintenance_logs.update({ where: { id: req.params.id }, data: updateData });
      res.json(log);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/maintenance-logs/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const existing = await prisma.maintenance_logs.findUnique({
        where: { id: req.params.id },
        include: { supplies: true }
      });
      if (!existing) return res.status(404).json({ error: 'Registro no encontrado' });

      await prisma.$transaction(async (tx) => {
        // Restore consumed supply quantities
        for (const supply of existing.supplies) {
          const item = await tx.inventory_items.findUnique({ where: { id: supply.inventory_item_id } });
          if (item) {
            await tx.inventory_items.update({
              where: { id: supply.inventory_item_id },
              data: { quantity: parseFloat(item.quantity) + parseFloat(supply.quantity_used) }
            });
            await tx.inventory_movements.create({
              data: { inventory_item_id: supply.inventory_item_id, organization_id: item.organization_id, venue_id: item.venue_id, type: 'adjustment', quantity_change: parseFloat(supply.quantity_used), reference_id: req.params.id, reference_type: 'maintenance_log_deletion', reason: 'Restauración por eliminación de registro de mantenimiento', created_by: userId }
            });
          }
        }
        await tx.maintenance_logs.delete({ where: { id: req.params.id } });
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/maintenance-logs/:id/status', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const existing = await prisma.maintenance_logs.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Registro no encontrado' });
      const log = await prisma.maintenance_logs.update({
        where: { id: req.params.id },
        data: { status: req.body.status, updated_at: new Date(), updated_by: userId }
      });
      res.json(log);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Maintenance Supplies ---

  app.post('/api/maintenance-logs/:id/supplies', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const { inventory_item_id, quantity_used, notes } = req.body;

      const log = await prisma.maintenance_logs.findUnique({ where: { id: req.params.id } });
      if (!log) return res.status(404).json({ error: 'Registro no encontrado' });

      const item = await prisma.inventory_items.findUnique({ where: { id: inventory_item_id } });
      if (!item) return res.status(404).json({ error: 'Item no encontrado' });

      const result = await prisma.$transaction(async (tx) => {
        const supply = await tx.maintenance_supplies.create({
          data: { maintenance_log_id: req.params.id, inventory_item_id, quantity_used, unit_cost_at_time: item.unit_cost || null, notes: notes || null }
        });
        await tx.inventory_items.update({
          where: { id: inventory_item_id },
          data: { quantity: parseFloat(item.quantity) - parseFloat(quantity_used) }
        });
        await tx.inventory_movements.create({
          data: { inventory_item_id, organization_id: item.organization_id, venue_id: item.venue_id, type: 'consumption_maintenance', quantity_change: -parseFloat(quantity_used), reference_id: req.params.id, reference_type: 'maintenance_log', reason: 'Consumo en mantenimiento', created_by: userId }
        });
        return supply;
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/maintenance-supplies/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const record = await prisma.maintenance_supplies.findUnique({ where: { id: req.params.id } });
      if (!record) return res.status(404).json({ error: 'Registro no encontrado' });

      const item = await prisma.inventory_items.findUnique({ where: { id: record.inventory_item_id } });

      await prisma.$transaction(async (tx) => {
        if (item) {
          await tx.inventory_items.update({
            where: { id: record.inventory_item_id },
            data: { quantity: parseFloat(item.quantity) + parseFloat(record.quantity_used) }
          });
          await tx.inventory_movements.create({
            data: { inventory_item_id: record.inventory_item_id, organization_id: item.organization_id, venue_id: item.venue_id, type: 'adjustment', quantity_change: parseFloat(record.quantity_used), reference_id: record.maintenance_log_id, reference_type: 'maintenance_supply_reversal', reason: 'Reversión de consumo en mantenimiento', created_by: userId }
          });
        }
        await tx.maintenance_supplies.delete({ where: { id: req.params.id } });
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Maintenance Images ---

  app.post('/api/maintenance-logs/:id/images', isAuthenticated, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No se proporcionó archivo o tipo no permitido' });
      const log = await prisma.maintenance_logs.findUnique({ where: { id: req.params.id } });
      if (!log) return res.status(404).json({ error: 'Registro no encontrado' });
      const result = await uploadImage(req.file.buffer, { type: 'maintenance', mimetype: req.file.mimetype });
      const image = await prisma.maintenance_images.create({
        data: { maintenance_log_id: req.params.id, image_url: result.secure_url, type: req.body.type || null, description: req.body.description || null, sort_order: parseInt(req.body.sort_order) || 0 }
      });
      res.json(image);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/maintenance-images/:id', isAuthenticated, async (req, res) => {
    try {
      const existing = await prisma.maintenance_images.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Imagen no encontrada' });
      if (existing.image_url) {
        const publicId = extractPublicId(existing.image_url);
        if (publicId) await deleteImage(publicId);
      }
      await prisma.maintenance_images.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Maintenance Dashboard ---

  app.get('/api/maintenance-dashboard', isAuthenticated, async (req, res) => {
    try {
      const { venue_id } = req.query;
      if (!venue_id) return res.status(400).json({ error: 'venue_id es requerido' });

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const [pendingCount, inProgressCount, completedThisMonth, recentLogs, zones, lowStockSupplies] = await Promise.all([
        prisma.maintenance_logs.count({ where: { venue_id, status: 'pending' } }),
        prisma.maintenance_logs.count({ where: { venue_id, status: 'in_progress' } }),
        prisma.maintenance_logs.count({ where: { venue_id, status: 'completed', maintenance_date: { gte: startOfMonth } } }),
        prisma.maintenance_logs.findMany({ where: { venue_id }, include: { zone: true, provider: true }, orderBy: { maintenance_date: 'desc' }, take: 10 }),
        prisma.maintenance_zones.findMany({ where: { venue_id, is_active: true }, orderBy: { name: 'asc' } }),
        prisma.inventory_items.findMany({
          where: { venue_id, type: 'supply', is_active: true, OR: [{ quantity: { lte: 0 } }, { AND: [{ minimum_stock: { not: null } }] }] },
          include: { category: true }
        })
      ]);

      // Filter low stock properly (Prisma can't do field comparison easily)
      const actualLowStock = lowStockSupplies.filter(item => item.minimum_stock !== null ? parseFloat(item.quantity) <= parseFloat(item.minimum_stock) : parseFloat(item.quantity) <= 0);

      // Enrich zones with last maintenance info
      const zoneStatus = await Promise.all(zones.map(async (zone) => {
        const lastLog = await prisma.maintenance_logs.findFirst({
          where: { zone_id: zone.id },
          include: { provider: true },
          orderBy: { maintenance_date: 'desc' }
        });
        return {
          ...zone,
          last_maintenance_date: lastLog?.maintenance_date || null,
          last_provider_name: lastLog?.provider?.name || null,
          days_since_maintenance: lastLog ? Math.floor((now - new Date(lastLog.maintenance_date)) / (1000 * 60 * 60 * 24)) : null
        };
      }));

      res.json({
        pending_count: pendingCount,
        in_progress_count: inProgressCount,
        completed_this_month: completedThisMonth,
        recent_logs: recentLogs,
        zone_status: zoneStatus,
        low_stock_supplies: actualLowStock
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== End Maintenance API ====================

  // ==================== Pending Tasks API ====================

  // --- Pending Tasks CRUD ---

  app.get('/api/pending-tasks', isAuthenticated, async (req, res) => {
    try {
      const orgIds = await getAccessibleOrganizationIds(req.user);
      const where = { organization_id: { in: orgIds } };
      if (req.query.venue_id) where.venue_id = req.query.venue_id;
      if (req.query.zone_id) where.zone_id = req.query.zone_id;
      if (req.query.status) where.status = req.query.status;
      if (req.query.priority) where.priority = req.query.priority;
      if (req.query.search) {
        where.OR = [
          { title: { contains: req.query.search, mode: 'insensitive' } },
          { description: { contains: req.query.search, mode: 'insensitive' } },
        ];
      }
      const tasks = await prisma.pending_tasks.findMany({
        where,
        include: { zone: true, images: { orderBy: { sort_order: 'asc' } } },
        orderBy: [{ status: 'asc' }, { priority: 'desc' }, { created_at: 'desc' }],
      });
      res.json(tasks);
    } catch (err) {
      console.error('Error fetching pending tasks:', err);
      res.status(500).json({ error: 'Error al obtener tareas pendientes' });
    }
  });

  app.get('/api/pending-tasks/:id', isAuthenticated, async (req, res) => {
    try {
      const task = await prisma.pending_tasks.findUnique({
        where: { id: req.params.id },
        include: { zone: true, images: { orderBy: { sort_order: 'asc' } } },
      });
      if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
      res.json(task);
    } catch (err) {
      console.error('Error fetching pending task:', err);
      res.status(500).json({ error: 'Error al obtener tarea' });
    }
  });

  app.post('/api/pending-tasks', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub || req.user.id || '');
      const data = { ...req.body, created_by: userId };
      if (data.due_date && data.due_date !== '') data.due_date = new Date(data.due_date);
      else data.due_date = null;
      if (!data.zone_id) data.zone_id = null;
      const task = await prisma.pending_tasks.create({ data });
      res.json(task);
    } catch (err) {
      console.error('Error creating pending task:', err);
      res.status(500).json({ error: 'Error al crear tarea' });
    }
  });

  app.put('/api/pending-tasks/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub || req.user.id || '');
      const data = { ...req.body, updated_by: userId, updated_at: new Date() };
      if (data.due_date && data.due_date !== '') data.due_date = new Date(data.due_date);
      else data.due_date = null;
      if (!data.zone_id) data.zone_id = null;
      if (data.status === 'completed' && !data.completed_at) data.completed_at = new Date();
      if (data.status !== 'completed') data.completed_at = null;
      const task = await prisma.pending_tasks.update({
        where: { id: req.params.id },
        data,
        include: { zone: true, images: { orderBy: { sort_order: 'asc' } } },
      });
      res.json(task);
    } catch (err) {
      console.error('Error updating pending task:', err);
      res.status(500).json({ error: 'Error al actualizar tarea' });
    }
  });

  app.put('/api/pending-tasks/:id/status', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub || req.user.id || '');
      const data = { status: req.body.status, updated_by: userId, updated_at: new Date() };
      if (req.body.status === 'completed') data.completed_at = new Date();
      if (req.body.status !== 'completed') data.completed_at = null;
      const task = await prisma.pending_tasks.update({
        where: { id: req.params.id },
        data,
        include: { zone: true, images: { orderBy: { sort_order: 'asc' } } },
      });
      res.json(task);
    } catch (err) {
      console.error('Error updating task status:', err);
      res.status(500).json({ error: 'Error al actualizar estado' });
    }
  });

  app.delete('/api/pending-tasks/:id', isAuthenticated, async (req, res) => {
    try {
      await prisma.$transaction([
        prisma.pending_task_images.deleteMany({ where: { pending_task_id: req.params.id } }),
        prisma.pending_tasks.delete({ where: { id: req.params.id } }),
      ]);
      res.json({ success: true });
    } catch (err) {
      console.error('Error deleting pending task:', err);
      res.status(500).json({ error: 'Error al eliminar tarea' });
    }
  });

  // --- Pending Task: Create maintenance log from task ---

  app.post('/api/pending-tasks/:id/create-maintenance', isAuthenticated, async (req, res) => {
    try {
      const task = await prisma.pending_tasks.findUnique({ where: { id: req.params.id } });
      if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
      const userId = String(req.user.claims?.sub || req.user.id || '');

      const result = await prisma.$transaction(async (tx) => {
        const log = await tx.maintenance_logs.create({
          data: {
            organization_id: task.organization_id,
            venue_id: task.venue_id,
            zone_id: task.zone_id,
            maintenance_date: new Date(),
            description: task.title + (task.description ? '\n\n' + task.description : ''),
            status: 'pending',
            priority: task.priority,
            notes: task.notes,
            created_by: userId,
          },
        });
        const updatedTask = await tx.pending_tasks.update({
          where: { id: task.id },
          data: {
            maintenance_log_id: log.id,
            status: 'in_progress',
            updated_by: userId,
            updated_at: new Date(),
          },
          include: { zone: true, images: { orderBy: { sort_order: 'asc' } } },
        });
        return { log, task: updatedTask };
      });
      res.json(result);
    } catch (err) {
      console.error('Error creating maintenance from task:', err);
      res.status(500).json({ error: 'Error al crear orden de mantenimiento' });
    }
  });

  // --- Pending Task Images ---

  app.post('/api/pending-tasks/:id/images', isAuthenticated, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No se proporcionó archivo' });
      const task = await prisma.pending_tasks.findUnique({ where: { id: req.params.id } });
      if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
      const result = await uploadImage(req.file.buffer, { type: 'pending_task', mimetype: req.file.mimetype });
      const image = await prisma.pending_task_images.create({
        data: {
          pending_task_id: req.params.id,
          image_url: result.secure_url,
          description: req.body.description || null,
          sort_order: parseInt(req.body.sort_order) || 0,
        },
      });
      res.json(image);
    } catch (err) {
      console.error('Error uploading task image:', err);
      res.status(500).json({ error: 'Error al subir imagen' });
    }
  });

  app.delete('/api/pending-task-images/:id', isAuthenticated, async (req, res) => {
    try {
      const existing = await prisma.pending_task_images.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Imagen no encontrada' });
      if (existing.image_url) {
        const publicId = extractPublicId(existing.image_url);
        if (publicId) await deleteImage(publicId);
      }
      await prisma.pending_task_images.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (err) {
      console.error('Error deleting task image:', err);
      res.status(500).json({ error: 'Error al eliminar imagen' });
    }
  });

  // ==================== End Pending Tasks API ====================

  // ==================== Commissions API ====================

  // --- Commission Agents CRUD ---

  app.get('/api/commission-agents', isAuthenticated, async (req, res) => {
    try {
      const orgIds = await getAccessibleOrganizationIds(req.userPermissions);
      const where = {};
      if (orgIds !== null) where.organization_id = { in: orgIds };
      if (req.query.venue_id) where.venue_id = req.query.venue_id;
      if (req.query.is_active !== undefined) where.is_active = req.query.is_active === 'true';
      if (req.query.search) where.name = { contains: req.query.search, mode: 'insensitive' };

      const agents = await prisma.commission_agents.findMany({
        where,
        include: { provider: true, rules: { orderBy: [{ plan_type: 'asc' }, { sort_order: 'asc' }] }, _count: { select: { payments: true } } },
        orderBy: { created_at: 'desc' }
      });
      res.json(agents);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/commission-agents/:id', isAuthenticated, async (req, res) => {
    try {
      const agent = await prisma.commission_agents.findUnique({
        where: { id: req.params.id },
        include: {
          provider: true,
          rules: { orderBy: [{ plan_type: 'asc' }, { sort_order: 'asc' }] },
          payments: { orderBy: { created_at: 'desc' }, take: 10 }
        }
      });
      if (!agent) return res.status(404).json({ error: 'Comisionista no encontrado' });
      res.json(agent);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/commission-agents', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const { provider_id, organization_id, venue_id, name, notes, is_active, rules, user_id } = req.body;

      if (venue_id) {
        const existing = await prisma.commission_agents.findFirst({ where: { venue_id, is_active: true } });
        if (existing) return res.status(400).json({ error: 'Ya existe un comisionista activo para esta sede' });
      }

      const result = await prisma.$transaction(async (tx) => {
        const agent = await tx.commission_agents.create({
          data: { provider_id, organization_id: organization_id || null, venue_id: venue_id || null, name, notes: notes || null, is_active: is_active !== false, created_by: userId, user_id: user_id || null }
        });
        if (rules && rules.length > 0) {
          await tx.commission_rules.createMany({
            data: rules.map((r, i) => ({
              agent_id: agent.id,
              plan_type: r.plan_type,
              min_adults: r.min_adults || 1,
              max_adults: r.max_adults || null,
              rate_percent: r.rate_percent,
              sort_order: r.sort_order ?? i
            }))
          });
        }
        return tx.commission_agents.findUnique({
          where: { id: agent.id },
          include: { provider: true, rules: { orderBy: [{ plan_type: 'asc' }, { sort_order: 'asc' }] } }
        });
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/commission-agents/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const { provider_id, organization_id, venue_id, name, notes, is_active, rules, user_id } = req.body;

      if (venue_id) {
        const existing = await prisma.commission_agents.findFirst({ where: { venue_id, is_active: true, NOT: { id: req.params.id } } });
        if (existing && is_active !== false) return res.status(400).json({ error: 'Ya existe otro comisionista activo para esta sede' });
      }

      const result = await prisma.$transaction(async (tx) => {
        await tx.commission_agents.update({
          where: { id: req.params.id },
          data: { provider_id, organization_id: organization_id || null, venue_id: venue_id || null, name, notes: notes || null, is_active: is_active !== false, updated_by: userId, updated_at: new Date(), user_id: user_id || null }
        });
        await tx.commission_rules.deleteMany({ where: { agent_id: req.params.id } });
        if (rules && rules.length > 0) {
          await tx.commission_rules.createMany({
            data: rules.map((r, i) => ({
              agent_id: req.params.id,
              plan_type: r.plan_type,
              min_adults: r.min_adults || 1,
              max_adults: r.max_adults || null,
              rate_percent: r.rate_percent,
              sort_order: r.sort_order ?? i
            }))
          });
        }
        return tx.commission_agents.findUnique({
          where: { id: req.params.id },
          include: { provider: true, rules: { orderBy: [{ plan_type: 'asc' }, { sort_order: 'asc' }] } }
        });
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/commission-agents/:id', isAuthenticated, async (req, res) => {
    try {
      const paymentsCount = await prisma.commission_payments.count({ where: { agent_id: req.params.id } });
      if (paymentsCount > 0) {
        await prisma.commission_agents.update({ where: { id: req.params.id }, data: { is_active: false, updated_at: new Date() } });
        return res.json({ success: true, soft_deleted: true, message: 'Comisionista desactivado (tiene pagos asociados)' });
      }
      await prisma.commission_agents.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Commission Calculation ---

  app.post('/api/commissions/calculate', isAuthenticated, async (req, res) => {
    try {
      const { accommodation_id } = req.body;
      if (!accommodation_id) return res.status(400).json({ error: 'accommodation_id requerido' });

      const accommodation = await prisma.accommodations.findUnique({ where: { id: accommodation_id } });
      if (!accommodation) return res.status(404).json({ error: 'Evento no encontrado' });

      // No plan assigned — return graceful info response
      if (!accommodation.plan_id) {
        return res.json({ no_agent: true, message: 'El evento no tiene un plan asignado' });
      }

      const plan = await prisma.venue_plans.findUnique({ where: { id: accommodation.plan_id } });
      if (!plan) return res.json({ no_agent: true, message: 'Plan no encontrado' });

      // Use explicitly assigned commission agent (not auto-find by venue)
      if (!accommodation.commission_agent_id) {
        return res.json({ no_agent: true, message: 'No hay comisionista asignado para este evento' });
      }

      const agent = await prisma.commission_agents.findUnique({
        where: { id: accommodation.commission_agent_id },
        include: { provider: true, rules: { where: { plan_type: plan.plan_type }, orderBy: { sort_order: 'asc' } } }
      });

      const agentInfo = (a) => ({ id: a.id, name: a.name, provider_name: a.provider?.name || null });

      if (!agent) return res.json({ no_agent: true, message: 'Comisionista asignado no encontrado' });
      if (!agent.rules.length) return res.json({ agent: agentInfo(agent), no_rules: true, message: `No hay reglas configuradas para tipo "${plan.plan_type}"` });

      const adults = accommodation.adults || 0;
      const agreedPrice = parseFloat(accommodation.agreed_price || accommodation.calculated_price || 0);

      if (adults === 0 || agreedPrice === 0) {
        return res.json({ agent: agentInfo(agent), total_commission: 0, breakdown: [], message: 'Sin adultos o precio para calcular' });
      }

      const perAdultPrice = agreedPrice / adults;
      let remaining = adults;
      let totalCommission = 0;
      const breakdown = [];

      for (const rule of agent.rules) {
        if (remaining <= 0) break;
        const capacity = rule.max_adults ? (rule.max_adults - rule.min_adults + 1) : remaining;
        const inTier = Math.min(remaining, capacity);
        const tierAmount = inTier * perAdultPrice * (parseFloat(rule.rate_percent) / 100);

        breakdown.push({
          range_min: rule.min_adults,
          range_max: rule.max_adults,
          adults_in_tier: inTier,
          commission_percent: parseFloat(rule.rate_percent),
          per_adult_price: Math.round(perAdultPrice),
          subtotal: Math.round(tierAmount)
        });

        totalCommission += tierAmount;
        remaining -= inTier;
      }

      // Check for existing payment for this accommodation
      const existingPayment = await prisma.commission_payments.findFirst({
        where: { agent_id: agent.id, accommodation_id }
      });

      res.json({
        agent: agentInfo(agent),
        accommodation: { id: accommodation.id, adults, agreed_price: agreedPrice, plan_type: plan.plan_type },
        total_commission: Math.round(totalCommission),
        breakdown,
        existing_payment: existingPayment || null
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Commission Payments ---

  app.get('/api/commission-payments', isAuthenticated, async (req, res) => {
    try {
      const orgIds = await getAccessibleOrganizationIds(req.user);
      const where = { organization_id: { in: orgIds } };
      if (req.query.agent_id) where.agent_id = req.query.agent_id;
      if (req.query.accommodation_id) where.accommodation_id = req.query.accommodation_id;
      if (req.query.venue_id) where.venue_id = req.query.venue_id;
      if (req.query.status) where.status = req.query.status;

      const payments = await prisma.commission_payments.findMany({
        where,
        include: { agent: { include: { provider: true } } },
        orderBy: { created_at: 'desc' }
      });

      // Enrich with accommodation data
      const enriched = await Promise.all(payments.map(async (p) => {
        const acc = await prisma.accommodations.findUnique({ where: { id: p.accommodation_id } });
        const venue = acc?.venue ? await prisma.venues.findUnique({ where: { id: acc.venue } }) : null;
        return { ...p, accommodation_data: acc, venue_data: venue };
      }));

      res.json(enriched);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/commission-payments', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const { agent_id, accommodation_id, organization_id, venue_id, adults, agreed_price, calculated_amount, breakdown, status, payment_date, payment_method, reference, receipt_url, notes, create_expense, expense_category_id } = req.body;

      const result = await prisma.$transaction(async (tx) => {
        const payment = await tx.commission_payments.create({
          data: {
            agent_id, accommodation_id,
            organization_id: organization_id || null, venue_id: venue_id || null,
            adults, agreed_price, calculated_amount,
            status: status || 'pending',
            payment_date: payment_date ? new Date(payment_date) : null,
            payment_method: payment_method || null,
            reference: reference || null,
            receipt_url: receipt_url || null,
            notes: notes || null,
            breakdown: breakdown || null,
            created_by: userId
          }
        });

        // Auto-create expense if paid and requested
        if (status === 'paid' && create_expense) {
          const agent = await tx.commission_agents.findUnique({ where: { id: agent_id }, include: { provider: true } });
          const acc = await tx.accommodations.findUnique({ where: { id: accommodation_id } });

          const expense = await tx.expenses.create({
            data: {
              organization_id: organization_id || null,
              venue_id: venue_id || null,
              category_id: expense_category_id || null,
              provider_id: agent?.provider_id || null,
              amount: calculated_amount,
              description: `Comisión - ${agent?.name || 'Comisionista'} - Evento ${acc?.date ? new Date(acc.date).toLocaleDateString('es-CO') : ''}`,
              expense_date: payment_date ? new Date(payment_date) : new Date(),
              reference: reference || null,
              receipt_url: receipt_url || null,
              notes: `Pago de comisión por evento con ${adults} adultos`,
              created_by: userId
            }
          });

          await tx.commission_payments.update({
            where: { id: payment.id },
            data: { expense_id: expense.id }
          });

          return { ...payment, expense_id: expense.id };
        }

        return payment;
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/commission-payments/:id', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const { status, payment_date, payment_method, reference, receipt_url, notes, create_expense, expense_category_id } = req.body;

      const existing = await prisma.commission_payments.findUnique({ where: { id: req.params.id }, include: { agent: true } });
      if (!existing) return res.status(404).json({ error: 'Pago no encontrado' });

      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.commission_payments.update({
          where: { id: req.params.id },
          data: {
            status: status || existing.status,
            payment_date: payment_date ? new Date(payment_date) : existing.payment_date,
            payment_method: payment_method ?? existing.payment_method,
            reference: reference ?? existing.reference,
            receipt_url: receipt_url ?? existing.receipt_url,
            notes: notes ?? existing.notes,
            updated_by: userId, updated_at: new Date()
          }
        });

        // Create expense when transitioning to paid
        if (status === 'paid' && existing.status !== 'paid' && create_expense && !existing.expense_id) {
          const acc = await tx.accommodations.findUnique({ where: { id: existing.accommodation_id } });
          const expense = await tx.expenses.create({
            data: {
              organization_id: existing.organization_id,
              venue_id: existing.venue_id,
              category_id: expense_category_id || null,
              provider_id: existing.agent?.provider_id || null,
              amount: existing.calculated_amount,
              description: `Comisión - ${existing.agent?.name || 'Comisionista'} - Evento ${acc?.date ? new Date(acc.date).toLocaleDateString('es-CO') : ''}`,
              expense_date: payment_date ? new Date(payment_date) : new Date(),
              reference: reference || null,
              receipt_url: receipt_url || null,
              notes: `Pago de comisión por evento con ${existing.adults} adultos`,
              created_by: userId
            }
          });
          await tx.commission_payments.update({ where: { id: req.params.id }, data: { expense_id: expense.id } });
          return { ...updated, expense_id: expense.id };
        }

        return updated;
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/commission-payments/:id', isAuthenticated, async (req, res) => {
    try {
      const payment = await prisma.commission_payments.findUnique({ where: { id: req.params.id } });
      if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });
      if (payment.status === 'paid' && payment.expense_id) {
        return res.status(400).json({ error: 'No se puede eliminar un pago registrado con egreso. Elimine el egreso primero.' });
      }
      await prisma.commission_payments.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== End Commissions API ====================

  // ==================== Invitations API ====================
  const { getEmailProvider } = require('./services/email');
  const { invitationEmail, invitationWhatsAppMessage } = require('./services/email/templates');
  const { sendWhatsApp } = require('./services/twilio/twilioService');
  const bcryptInv = require('bcryptjs');
  const crypto = require('crypto');

  // Helper: send WhatsApp via microservice first, fallback to Twilio
  async function sendInvitationWhatsApp(phone, body) {
    try {
      if (whatsappClient.isAvailable()) {
        const systemStatus = await whatsappClient.getSystemStatus();
        if (systemStatus?.status === 'connected') {
          const cleanPhone = phone.replace('whatsapp:', '');
          const sent = await whatsappClient.sendSystemMessage(cleanPhone, body);
          if (sent?.success) return { success: true, channel: 'baileys' };
        }
      }
    } catch (err) {
      console.warn('[invitation] WhatsApp service send failed, trying Twilio:', err.message);
    }
    return sendWhatsApp({ to: phone, body });
  }

  // List invitations
  app.get('/api/invitations', isAuthenticated, requirePermission('invitations:view'), async (req, res) => {
    try {
      if (!req.user?.is_super_admin && !hasPermission(req.userPermissions, 'invitations:view')) {
        return res.status(403).json({ error: 'No tiene permiso para ver invitaciones' });
      }
      const { status, organization_id } = req.query;
      const where = {};
      if (status) where.status = status;
      if (organization_id) where.organization_id = organization_id;

      const invitations = await prisma.invitations.findMany({
        where,
        include: {
          inviter: { select: { id: true, display_name: true, email: true } },
          organization: { select: { id: true, name: true } }
        },
        orderBy: { created_at: 'desc' }
      });
      res.json(invitations);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create and send invitation
  app.post('/api/invitations', isAuthenticated, requirePermission('invitations:send'), async (req, res) => {
    try {
      if (!req.user?.is_super_admin && !hasPermission(req.userPermissions, 'invitations:send')) {
        return res.status(403).json({ error: 'No tiene permiso para enviar invitaciones' });
      }
      const { email, phone, channel, organization_id, role, message, profile_code } = req.body;

      if (!channel || !['email', 'whatsapp'].includes(channel)) {
        return res.status(400).json({ error: 'Canal inválido. Use "email" o "whatsapp"' });
      }
      if (channel === 'email' && !email) {
        return res.status(400).json({ error: 'Email requerido para invitación por correo' });
      }
      if (channel === 'whatsapp' && !phone) {
        return res.status(400).json({ error: 'Teléfono requerido para invitación por WhatsApp' });
      }

      // Check for existing pending invitation
      const existingWhere = { status: 'pending' };
      if (channel === 'email') existingWhere.email = email;
      else existingWhere.phone = phone;

      const existing = await prisma.invitations.findFirst({ where: existingWhere });
      if (existing) {
        return res.status(409).json({ error: 'Ya existe una invitación pendiente para este destinatario' });
      }

      const invitation = await prisma.invitations.create({
        data: {
          email: email || null,
          phone: phone || null,
          channel,
          invited_by: String(req.user.claims?.sub),
          organization_id: organization_id || null,
          role: role || 'user',
          message: message || null,
          profile_code: profile_code || null,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        },
        include: {
          inviter: { select: { id: true, display_name: true, email: true } },
          organization: { select: { id: true, name: true } }
        }
      });

      // Send notification
      const inviterName = invitation.inviter.display_name || invitation.inviter.email || 'Un administrador';
      const orgName = invitation.organization?.name || null;

      // Partner invitations use a different acceptance page
      const isPartnerInvitation = profile_code && profile_code !== 'organization:admin';
      const acceptUrl = isPartnerInvitation
        ? `${process.env.APP_URL || 'https://cabania.app'}/#/invitation/accept?token=${invitation.token}`
        : null;

      if (channel === 'email') {
        const emailProvider = getEmailProvider();
        const template = invitationEmail({
          inviterName,
          organizationName: orgName,
          token: invitation.token,
          message: invitation.message,
          expiresAt: invitation.expires_at,
          acceptUrl,
        });
        const result = await emailProvider.send({
          to: email,
          subject: template.subject,
          html: template.html,
          text: template.text,
        });
        if (!result.success) {
          console.error('Failed to send invitation email:', result.error);
        }
      } else {
        const body = invitationWhatsAppMessage({
          inviterName,
          organizationName: orgName,
          token: invitation.token,
          acceptUrl,
        });
        const result = await sendInvitationWhatsApp(phone, body);
        if (!result.success) {
          console.error('Failed to send WhatsApp invitation:', result.error);
        }
      }

      res.json(invitation);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Resend invitation
  app.post('/api/invitations/:id/resend', isAuthenticated, async (req, res) => {
    try {
      if (!req.user?.is_super_admin && !hasPermission(req.userPermissions, 'invitations:manage')) {
        return res.status(403).json({ error: 'No tiene permiso para gestionar invitaciones' });
      }
      const invitation = await prisma.invitations.findUnique({
        where: { id: req.params.id },
        include: {
          inviter: { select: { id: true, display_name: true, email: true } },
          organization: { select: { id: true, name: true } }
        }
      });
      if (!invitation) return res.status(404).json({ error: 'Invitación no encontrada' });
      if (invitation.status !== 'pending') {
        return res.status(400).json({ error: 'Solo se pueden reenviar invitaciones pendientes' });
      }

      // Extend expiration
      const updated = await prisma.invitations.update({
        where: { id: req.params.id },
        data: { expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
      });

      const inviterName = invitation.inviter.display_name || invitation.inviter.email || 'Un administrador';
      const orgName = invitation.organization?.name || null;

      if (invitation.channel === 'email') {
        const emailProvider = getEmailProvider();
        const template = invitationEmail({
          inviterName,
          organizationName: orgName,
          token: invitation.token,
          message: invitation.message,
          expiresAt: updated.expires_at,
        });
        await emailProvider.send({
          to: invitation.email,
          subject: template.subject,
          html: template.html,
          text: template.text,
        });
      } else {
        const body = invitationWhatsAppMessage({
          inviterName,
          organizationName: orgName,
          token: invitation.token,
        });
        await sendInvitationWhatsApp(invitation.phone, body);
      }

      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Cancel invitation
  app.delete('/api/invitations/:id', isAuthenticated, async (req, res) => {
    try {
      if (!req.user?.is_super_admin && !hasPermission(req.userPermissions, 'invitations:manage')) {
        return res.status(403).json({ error: 'No tiene permiso para gestionar invitaciones' });
      }
      const invitation = await prisma.invitations.findUnique({ where: { id: req.params.id } });
      if (!invitation) return res.status(404).json({ error: 'Invitación no encontrada' });

      await prisma.invitations.update({
        where: { id: req.params.id },
        data: { status: 'cancelled' }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Validate invitation token (PUBLIC - no auth required)
  app.get('/api/invitations/validate/:token', async (req, res) => {
    try {
      const invitation = await prisma.invitations.findUnique({
        where: { token: req.params.token },
        include: { organization: { select: { id: true, name: true } } }
      });

      if (!invitation) {
        return res.status(404).json({ valid: false, error: 'Invitación no encontrada' });
      }
      if (invitation.status !== 'pending') {
        return res.status(400).json({ valid: false, error: 'Esta invitación ya fue utilizada o cancelada', status: invitation.status });
      }
      if (new Date(invitation.expires_at) < new Date()) {
        await prisma.invitations.update({ where: { id: invitation.id }, data: { status: 'expired' } });
        return res.status(400).json({ valid: false, error: 'Esta invitación ha expirado' });
      }

      res.json({
        valid: true,
        email: invitation.email,
        phone: invitation.phone,
        channel: invitation.channel,
        organization: invitation.organization,
        role: invitation.role,
        profile_code: invitation.profile_code || null,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Accept invitation + create account (PUBLIC - no auth required)
  app.post('/api/invitations/:token/accept', async (req, res) => {
    try {
      const { display_name, email, password } = req.body;

      if (!display_name || !email || !password) {
        return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
      }

      const invitation = await prisma.invitations.findUnique({
        where: { token: req.params.token },
        include: { organization: true }
      });

      if (!invitation) return res.status(404).json({ error: 'Invitación no encontrada' });
      if (invitation.status !== 'pending') {
        return res.status(400).json({ error: 'Esta invitación ya fue utilizada o cancelada' });
      }
      if (new Date(invitation.expires_at) < new Date()) {
        await prisma.invitations.update({ where: { id: invitation.id }, data: { status: 'expired' } });
        return res.status(400).json({ error: 'Esta invitación ha expirado' });
      }

      // Check if email already taken
      const existingUser = await prisma.users.findFirst({ where: { email } });
      if (existingUser) {
        return res.status(409).json({ error: 'Ya existe una cuenta con este correo electrónico' });
      }

      // Get profile — use invitation's profile_code if specified, otherwise default
      const profileCode = invitation.profile_code || process.env.DEFAULT_PROFILE_CODE || 'organization:admin';
      const profile = await prisma.profiles.findUnique({ where: { code: profileCode } });

      // Partners skip onboarding (they don't create venues)
      const isPartnerInvitation = profileCode !== 'organization:admin' && invitation.organization_id;

      const password_hash = await bcryptInv.hash(password, 10);
      const userId = `inv_${crypto.randomUUID().split('-')[0]}_${Date.now()}`;

      // Create user + mark invitation accepted + referral reward
      const transactionOps = [
        prisma.users.create({
          data: {
            id: userId,
            email,
            display_name,
            password_hash,
            role: invitation.role || 'user',
            profile_id: profile?.id || null,
            referred_by: invitation.invited_by,
          }
        }),
        prisma.invitations.update({
          where: { id: invitation.id },
          data: { status: 'accepted', accepted_at: new Date() }
        }),
        prisma.referral_rewards.create({
          data: {
            referrer_id: invitation.invited_by,
            referred_id: userId,
            invitation_id: invitation.id,
            reward_type: 'signup',
            status: 'pending',
            description: `Registro de ${display_name} (${email}) por invitación`,
          }
        }),
      ];

      // Only create onboarding progress for non-partner invitations (new parceleros)
      if (!isPartnerInvitation) {
        transactionOps.push(
          prisma.onboarding_progress.create({
            data: { user_id: userId, current_step: 2, data: {} }
          })
        );
      }

      const [user] = await prisma.$transaction(transactionOps);

      // Assign to organization if specified
      if (invitation.organization_id) {
        await prisma.user_organizations.create({
          data: { user_id: userId, organization_id: invitation.organization_id }
        });
      }

      // Assign to default subscription if configured
      const defaultSubId = process.env.DEFAULT_SUBSCRIPTION_ID;
      if (defaultSubId) {
        await prisma.subscription_users.create({
          data: {
            subscription_id: defaultSubId,
            user_id: userId,
            role: 'member',
            is_owner: false,
          }
        }).catch(() => {}); // Ignore if already exists
      }

      // Auto-login: create session
      const loginUser = { id: userId, email, display_name };
      req.login(loginUser, (err) => {
        if (err) {
          console.error('Auto-login error:', err);
          return res.json({ success: true, user: { id: userId, email, display_name }, autoLogin: false, skipOnboarding: isPartnerInvitation });
        }
        res.json({ success: true, user: { id: userId, email, display_name }, autoLogin: true, skipOnboarding: isPartnerInvitation });
      });
    } catch (error) {
      console.error('Accept invitation error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Accept invitation for existing user (requires authentication)
  app.post('/api/invitations/:token/accept-existing', isAuthenticated, async (req, res) => {
    try {
      const invitation = await prisma.invitations.findUnique({
        where: { token: req.params.token },
        include: { organization: { select: { id: true, name: true } } }
      });

      if (!invitation) return res.status(404).json({ error: 'Invitación no encontrada' });
      if (invitation.status !== 'pending') {
        return res.status(400).json({ error: 'Esta invitación ya fue utilizada o cancelada' });
      }
      if (new Date(invitation.expires_at) < new Date()) {
        await prisma.invitations.update({ where: { id: invitation.id }, data: { status: 'expired' } });
        return res.status(400).json({ error: 'Esta invitación ha expirado' });
      }

      const userId = String(req.user.claims?.sub);

      // Link user to organization
      if (invitation.organization_id) {
        // Check if already linked
        const existing = await prisma.user_organizations.findFirst({
          where: { user_id: userId, organization_id: invitation.organization_id }
        });
        if (!existing) {
          await prisma.user_organizations.create({
            data: { user_id: userId, organization_id: invitation.organization_id }
          });
        }
      }

      // Update user profile if invitation specifies one and user doesn't have a higher-level profile
      if (invitation.profile_code) {
        const user = await prisma.users.findUnique({ where: { id: userId }, include: { profile: true } });
        const currentProfileCode = user?.profile?.code;
        // Only downgrade to partner if user has no profile or is already a partner
        if (!currentProfileCode || currentProfileCode === 'organization:partner') {
          const invProfile = await prisma.profiles.findUnique({ where: { code: invitation.profile_code } });
          if (invProfile) {
            await prisma.users.update({ where: { id: userId }, data: { profile_id: invProfile.id } });
          }
        }
      }

      // Mark invitation as accepted
      await prisma.invitations.update({
        where: { id: invitation.id },
        data: { status: 'accepted', accepted_at: new Date() }
      });

      // Create referral reward
      await prisma.referral_rewards.create({
        data: {
          referrer_id: invitation.invited_by,
          referred_id: userId,
          invitation_id: invitation.id,
          reward_type: 'signup',
          status: 'pending',
          description: `Vinculación de usuario existente por invitación`,
        }
      }).catch(() => {}); // Ignore if duplicate

      res.json({ success: true, organization: invitation.organization });
    } catch (error) {
      console.error('Accept existing invitation error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== End Invitations API ====================

  // ==================== Onboarding API ====================

  // Get onboarding progress (authenticated)
  app.get('/api/onboarding/progress', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      let progress = await prisma.onboarding_progress.findUnique({
        where: { user_id: userId }
      });

      if (!progress) {
        // Create initial progress if doesn't exist
        progress = await prisma.onboarding_progress.create({
          data: { user_id: userId, current_step: 2, data: {} }
        });
      }

      res.json(progress);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Save onboarding step data and advance
  app.put('/api/onboarding/step', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const { step, data: stepData } = req.body;

      if (!step || !stepData) {
        return res.status(400).json({ error: 'step y data son requeridos' });
      }

      const progress = await prisma.onboarding_progress.findUnique({
        where: { user_id: userId }
      });

      if (!progress) {
        return res.status(404).json({ error: 'Progreso de onboarding no encontrado' });
      }

      // Merge step data into existing data
      const existingData = progress.data || {};
      existingData[`step${step}`] = stepData;

      const updated = await prisma.onboarding_progress.update({
        where: { user_id: userId },
        data: {
          current_step: step + 1,
          data: existingData,
        }
      });

      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Mark onboarding as completed
  app.post('/api/onboarding/complete', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const updated = await prisma.onboarding_progress.update({
        where: { user_id: userId },
        data: { completed_at: new Date() }
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get amenities for onboarding (authenticated)
  app.get('/api/onboarding/amenities', isAuthenticated, async (req, res) => {
    try {
      const amenities = await prisma.amenities.findMany({
        where: { is_active: true },
        orderBy: [{ category: 'asc' }, { name: 'asc' }]
      });
      res.json(amenities);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get nearby zones for onboarding location step
  app.get('/api/onboarding/nearby-zones', isAuthenticated, async (req, res) => {
    try {
      const { department } = req.query;
      if (!department) {
        return res.status(400).json({ error: 'department es requerido' });
      }

      const zones = await prisma.venues.groupBy({
        by: ['city'],
        where: { department, city: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 8,
      });

      res.json({
        zones: zones
          .filter(z => z.city)
          .map(z => ({ city: z.city, venue_count: z._count.id })),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get plan suggestions based on nearby venues
  app.get('/api/onboarding/suggestions', isAuthenticated, async (req, res) => {
    try {
      const { city, department } = req.query;

      const where = { is_active: true };
      if (department) {
        where.venue = { department };
      }

      const plans = await prisma.venue_plans.findMany({
        where,
        select: {
          name: true,
          adult_price: true,
          child_price: true,
          max_capacity: true,
          check_in_time: true,
          check_out_time: true,
          plan_type: true,
        },
        take: 100,
      });

      if (plans.length < 3) {
        // Fallback defaults for Colombia
        return res.json({
          source: 'defaults',
          plan_count: plans.length,
          suggestions: {
            name: [
              { value: 'Pasadía Familiar', count: 0 },
              { value: 'Plan Fin de Semana', count: 0 },
              { value: 'Noche Romántica', count: 0 },
              { value: 'Plan Todo Incluido', count: 0 },
            ],
            adult_price: [
              { value: 60000, label: '$60.000' },
              { value: 80000, label: '$80.000' },
              { value: 120000, label: '$120.000' },
              { value: 150000, label: '$150.000' },
            ],
            child_price: [
              { value: 30000, label: '$30.000' },
              { value: 50000, label: '$50.000' },
              { value: 70000, label: '$70.000' },
            ],
            max_capacity: [
              { value: 6, label: '6 personas' },
              { value: 10, label: '10 personas' },
              { value: 15, label: '15 personas' },
              { value: 20, label: '20 personas' },
            ],
            check_in_time: [
              { value: '10:00', label: '10:00 AM' },
              { value: '14:00', label: '2:00 PM' },
              { value: '15:00', label: '3:00 PM' },
            ],
            check_out_time: [
              { value: '12:00', label: '12:00 PM' },
              { value: '17:00', label: '5:00 PM' },
              { value: '18:00', label: '6:00 PM' },
            ],
          },
        });
      }

      // Helper: get most common values for a field
      function getMostCommon(arr, field, limit) {
        const counts = {};
        arr.forEach(item => {
          const val = item[field];
          if (val != null && val !== '') {
            const key = String(val);
            counts[key] = (counts[key] || 0) + 1;
          }
        });
        return Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([value, count]) => ({ value, count }));
      }

      // Helper: get representative numeric values (quartiles)
      function getRepresentativeValues(arr, field, limit) {
        const values = arr
          .map(item => parseFloat(item[field]))
          .filter(v => !isNaN(v) && v > 0)
          .sort((a, b) => a - b);
        if (values.length === 0) return [];
        const step = Math.max(1, Math.floor(values.length / limit));
        const result = [];
        const seen = new Set();
        for (let i = 0; i < values.length && result.length < limit; i += step) {
          const v = values[i];
          if (!seen.has(v)) {
            seen.add(v);
            result.push({ value: v, label: `$${v.toLocaleString('es-CO')}` });
          }
        }
        return result;
      }

      res.json({
        source: 'nearby',
        plan_count: plans.length,
        suggestions: {
          name: getMostCommon(plans, 'name', 5),
          adult_price: getRepresentativeValues(plans, 'adult_price', 4),
          child_price: getRepresentativeValues(plans, 'child_price', 3),
          max_capacity: getMostCommon(plans, 'max_capacity', 4).map(s => ({
            value: parseInt(s.value),
            label: `${s.value} personas`,
            count: s.count,
          })),
          check_in_time: getMostCommon(plans, 'check_in_time', 3).map(s => ({
            value: s.value,
            label: s.value,
            count: s.count,
          })),
          check_out_time: getMostCommon(plans, 'check_out_time', 3).map(s => ({
            value: s.value,
            label: s.value,
            count: s.count,
          })),
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== End Onboarding API ====================

  // ==================== Contract API ====================
  const contractRenderer = require('./services/contractRenderer');

  // --- Contract Templates CRUD ---
  app.get('/api/venues/:venueId/contract-templates', isAuthenticated, async (req, res) => {
    try {
      const templates = await prisma.contract_templates.findMany({
        where: { venue_id: req.params.venueId },
        include: { sections: { orderBy: { sort_order: 'asc' } } },
        orderBy: { created_at: 'desc' },
      });
      // Enriquecer con el nombre del plan ligado (si lo hay)
      const planIds = [...new Set(templates.map(t => t.plan_id).filter(Boolean))];
      const plans = planIds.length
        ? await prisma.venue_plans.findMany({ where: { id: { in: planIds } }, select: { id: true, name: true } })
        : [];
      const planMap = Object.fromEntries(plans.map(p => [p.id, p.name]));
      res.json(templates.map(t => ({ ...t, plan_name: t.plan_id ? (planMap[t.plan_id] || null) : null })));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/contract-templates/:id', isAuthenticated, async (req, res) => {
    try {
      const template = await prisma.contract_templates.findUnique({
        where: { id: req.params.id },
        include: { sections: { orderBy: { sort_order: 'asc' } } },
      });
      if (!template) return res.status(404).json({ error: 'Plantilla no encontrada' });
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/contract-templates', isAuthenticated, requirePermission('contracts:templates:manage'), async (req, res) => {
    try {
      const userId = String(req.user.claims?.sub);
      const { venue_id, plan_id, name, is_default, sections } = req.body;

      const result = await prisma.$transaction(async (tx) => {
        if (is_default) {
          await tx.contract_templates.updateMany({
            where: { venue_id, is_default: true },
            data: { is_default: false },
          });
        }
        const template = await tx.contract_templates.create({
          data: { venue_id, plan_id: plan_id || null, name, is_default: is_default || false, created_by: userId },
        });
        if (sections?.length > 0) {
          await tx.contract_template_sections.createMany({
            data: sections.map((s, i) => ({
              template_id: template.id,
              title: s.title,
              content: s.content,
              sort_order: s.sort_order ?? i,
              print_hidden: s.print_hidden ?? false,
            })),
          });
        }
        return tx.contract_templates.findUnique({
          where: { id: template.id },
          include: { sections: { orderBy: { sort_order: 'asc' } } },
        });
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/contract-templates/:id', isAuthenticated, requirePermission('contracts:templates:manage'), async (req, res) => {
    try {
      const { name, plan_id, is_default, is_active, sections } = req.body;
      const template = await prisma.contract_templates.findUnique({ where: { id: req.params.id } });
      if (!template) return res.status(404).json({ error: 'Plantilla no encontrada' });

      const result = await prisma.$transaction(async (tx) => {
        if (is_default) {
          await tx.contract_templates.updateMany({
            where: { venue_id: template.venue_id, is_default: true, NOT: { id: template.id } },
            data: { is_default: false },
          });
        }
        await tx.contract_templates.update({
          where: { id: req.params.id },
          data: { name, plan_id: plan_id || null, is_default, is_active, updated_at: new Date() },
        });
        if (sections) {
          await tx.contract_template_sections.deleteMany({ where: { template_id: req.params.id } });
          if (sections.length > 0) {
            await tx.contract_template_sections.createMany({
              data: sections.map((s, i) => ({
                template_id: req.params.id,
                title: s.title,
                content: s.content,
                sort_order: s.sort_order ?? i,
                print_hidden: s.print_hidden ?? false,
              })),
            });
          }
        }
        return tx.contract_templates.findUnique({
          where: { id: req.params.id },
          include: { sections: { orderBy: { sort_order: 'asc' } } },
        });
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/contract-templates/:id', isAuthenticated, requirePermission('contracts:templates:manage'), async (req, res) => {
    try {
      await prisma.contract_templates.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Contract placeholders reference ---
  app.get('/api/contract-placeholders', isAuthenticated, (req, res) => {
    res.json(contractRenderer.getAvailablePlaceholders());
  });

  // --- Contract template import from PDF/Word ---
  const contractImporter = require('./services/contractImporter');

  app.post('/api/contract-templates/import', isAuthenticated, requirePermission('contracts:templates:manage'), uploadDocument.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No se envió archivo' });
      }
      if (req.file.size > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'El archivo no puede superar 5MB' });
      }

      // Extract text
      const text = await contractImporter.extractText(req.file.buffer, req.file.mimetype);
      if (!text || text.trim().length < 50) {
        return res.status(400).json({ error: 'No se pudo extraer texto suficiente del archivo' });
      }

      // Build prompt and call AI
      const { system, user } = contractImporter.buildImportPrompt(text);
      const messages = [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ];

      const aiResponse = await llmService.callLLMByCode('xai_grok', messages, {
        maxTokens: 8000,
        temperature: 0.1,
      });

      const responseText = aiResponse.content || aiResponse.choices?.[0]?.message?.content || '';
      const parsed = contractImporter.parseAIResponse(responseText);

      res.json({
        success: true,
        extracted_text_length: text.length,
        template: parsed,
      });
    } catch (error) {
      console.error('Error importing contract template:', error);
      res.status(500).json({ error: error.message || 'Error al importar plantilla' });
    }
  });

  // Arma el contexto real de la cabaña para que la IA no invente features
  async function buildVenueContextForAI(venueId) {
    if (!venueId) return '';
    const venue = await prisma.venues.findUnique({ where: { id: venueId } });
    if (!venue) return '';

    // Amenidades del venue (agrupadas por categoría)
    const links = await prisma.venue_amenities.findMany({ where: { venue_id: venueId } });
    const amenityIds = links.map(l => l.amenity_id);
    const amenities = amenityIds.length
      ? await prisma.amenities.findMany({ where: { id: { in: amenityIds } } })
      : [];
    const byCat = {};
    amenities.forEach(a => {
      const cat = a.category || 'General';
      (byCat[cat] = byCat[cat] || []).push(a.name);
    });
    const amenitiesText = Object.keys(byCat).length
      ? Object.entries(byCat).map(([cat, list]) => `  - ${cat}: ${list.join(', ')}`).join('\n')
      : '  (ninguna registrada)';

    // Planes del venue
    const plans = await prisma.venue_plans.findMany({ where: { venue_id: venueId }, orderBy: { name: 'asc' } });
    const plansText = plans.length
      ? plans.map(p => {
          const parts = [`  - "${p.name}"`];
          if (p.check_in_time || p.check_out_time) parts.push(`check-in ${p.check_in_time || '?'} / check-out ${p.check_out_time || '?'}`);
          if (p.max_capacity) parts.push(`capacidad ${p.max_capacity}`);
          parts.push(p.includes_food ? `incluye comida${p.food_description ? ` (${p.food_description})` : ''}` : 'sin comida');
          if (p.terms_conditions) parts.push(`términos: ${p.terms_conditions}`);
          return parts.join('; ');
        }).join('\n')
      : '  (ninguno registrado)';

    return `CONTEXTO REAL DE LA CABAÑA (usa SOLO esta información; NO inventes amenidades, servicios ni reglas sobre features que no estén listados aquí):
Cabaña: ${venue.name || '—'}${venue.city ? `, ${venue.city}` : ''}${venue.address ? `, ${venue.address}` : ''}
Amenidades disponibles:
${amenitiesText}
Planes:
${plansText}`;
  }

  // --- AI-powered contract template generation ---
  app.post('/api/contract-templates/ai-generate', isAuthenticated, requirePermission('contracts:templates:manage'), async (req, res) => {
    try {
      const { prompt, current_sections, venue_id, template_id } = req.body;
      if (!prompt) return res.status(400).json({ error: 'Prompt requerido' });

      const placeholderList = contractRenderer.getAvailablePlaceholders()
        .map(p => `- ${p.label} → {{${p.key}}}`)
        .join('\n');

      // --- Herramientas: la IA consulta datos reales SOLO cuando los necesita ---
      async function toolGetAmenities() {
        if (!venue_id) return 'Sin venue.';
        const links = await prisma.venue_amenities.findMany({ where: { venue_id } });
        const ids = links.map(l => l.amenity_id);
        const ams = ids.length ? await prisma.amenities.findMany({ where: { id: { in: ids } } }) : [];
        if (!ams.length) return 'La cabaña no tiene amenidades registradas.';
        const byCat = {};
        ams.forEach(a => { const c = a.category || 'General'; (byCat[c] = byCat[c] || []).push(a.name); });
        return Object.entries(byCat).map(([c, l]) => `${c}: ${l.join(', ')}`).join('\n');
      }
      async function toolGetPlans() {
        if (!venue_id) return 'Sin venue.';
        const plans = await prisma.venue_plans.findMany({ where: { venue_id }, orderBy: { name: 'asc' } });
        if (!plans.length) return 'No hay planes registrados.';
        return plans.map(p => {
          const parts = [`"${p.name}"`];
          if (p.check_in_time || p.check_out_time) parts.push(`check-in ${p.check_in_time || '?'} / check-out ${p.check_out_time || '?'}`);
          if (p.max_capacity) parts.push(`capacidad ${p.max_capacity}`);
          parts.push(p.includes_food ? `incluye comida${p.food_description ? ` (${p.food_description})` : ''}` : 'sin comida');
          return parts.join('; ');
        }).join('\n');
      }
      async function toolListTemplates() {
        if (!venue_id) return 'Sin venue.';
        const others = await prisma.contract_templates.findMany({
          where: { venue_id, is_active: true, ...(template_id ? { NOT: { id: template_id } } : {}) },
          select: { id: true, name: true, plan_id: true },
        });
        if (!others.length) return 'No hay otras plantillas en este venue.';
        const planIds = [...new Set(others.map(t => t.plan_id).filter(Boolean))];
        const plans = planIds.length ? await prisma.venue_plans.findMany({ where: { id: { in: planIds } }, select: { id: true, name: true } }) : [];
        const planMap = Object.fromEntries(plans.map(p => [p.id, p.name]));
        return others.map(t => `- "${t.name}"${t.plan_id && planMap[t.plan_id] ? ` (plan: ${planMap[t.plan_id]})` : ''}`).join('\n');
      }
      async function toolGetTemplate(name) {
        if (!venue_id || !name) return 'Falta el nombre de la plantilla.';
        const t = await prisma.contract_templates.findFirst({
          where: { venue_id, is_active: true, name: { equals: name, mode: 'insensitive' }, ...(template_id ? { NOT: { id: template_id } } : {}) },
          include: { sections: { orderBy: { sort_order: 'asc' } } },
        });
        if (!t) return `No existe una plantilla llamada "${name}". Usa list_templates para ver los nombres exactos.`;
        return t.sections.map(s => `[${s.title}]\n${s.content}`).join('\n\n');
      }
      async function execTool(name, args) {
        switch (name) {
          case 'get_amenities': return await toolGetAmenities();
          case 'get_plans': return await toolGetPlans();
          case 'list_templates': return await toolListTemplates();
          case 'get_template': return await toolGetTemplate(args?.name);
          default: return 'Herramienta desconocida.';
        }
      }

      const tools = [
        { type: 'function', function: { name: 'get_amenities', description: 'Lista las amenidades reales del venue agrupadas por categoría. Úsala ANTES de escribir reglas sobre features físicos (piscina, canchas, parrilla, etc.) para no inventar.', parameters: { type: 'object', properties: {}, required: [] } } },
        { type: 'function', function: { name: 'get_plans', description: 'Lista los planes del venue con horarios de check-in/check-out, si incluyen comida y capacidad.', parameters: { type: 'object', properties: {}, required: [] } } },
        { type: 'function', function: { name: 'list_templates', description: 'Lista los nombres de las otras plantillas de contrato del venue. Úsala si el usuario pide basarse en otra plantilla.', parameters: { type: 'object', properties: {}, required: [] } } },
        { type: 'function', function: { name: 'get_template', description: 'Devuelve el contenido (secciones) de una plantilla del venue por su nombre exacto.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Nombre exacto de la plantilla' } }, required: ['name'] } } },
      ];

      let contextMsg = '';
      if (current_sections?.length > 0) {
        contextMsg = `\n\nPLANTILLA ACTUAL (parte de aquí; modifica/agrega SOLO lo que pide el usuario y conserva el resto tal cual):\n${JSON.stringify(current_sections, null, 2)}`;
      }

      const messages = [
        {
          role: 'system',
          content: `Eres un experto en contratos de alquiler de cabañas/fincas en Colombia. Modificas o generas plantillas de contrato con secciones estructuradas, a partir de instrucciones en lenguaje natural.

Tienes HERRAMIENTAS para consultar datos REALES del venue, pero úsalas SOLO cuando la instrucción lo requiera (no las llames de más):
- get_amenities: amenidades reales. Consúltala antes de escribir reglas sobre features físicos (piscina, canchas, parrilla...).
- get_plans: planes con horarios, comida y capacidad.
- list_templates / get_template: para basarte en otra plantilla del venue.

REGLAS IMPORTANTES:
- Cada sección tiene "title" y "content" en markdown. Listas numeradas con "1.", "2."; viñetas con "- ".
- Usa los placeholders disponibles para datos variables (no escribas valores fijos que cambian por reserva).
- NO inventes amenidades ni reglas sobre features. Si la instrucción toca un feature físico, primero verifica con get_amenities; si el venue NO lo tiene, no agregues reglas de ese feature.
- CRÍTICO: el array "sections" de tu respuesta DEBE contener TODAS las secciones actuales (con título y contenido completos), salvo las que el usuario pida explícitamente eliminar. NUNCA omitas ni reemplaces una sección existente que el usuario no pidió quitar. Una sección nueva va ADEMÁS de las existentes.
- Si el usuario pide ELIMINAR una política o sección, quítala Y revisa el resto: si ese tema se menciona en otra sección, elimina/ajusta esas menciones para no dejar inconsistencias.
- Si pide reorganizar (ej: "separa las políticas por categorías"), reestructura manteniendo TODA la información.
- Cuando ya tengas lo que necesitas, responde SOLO con el JSON final (sin más tool calls ni texto adicional).

Placeholders disponibles:
${placeholderList}`
        },
        {
          role: 'user',
          content: `Instrucción del usuario: ${prompt}${contextMsg}

Responde con JSON EXACTAMENTE en este formato:
{
  "name": "nombre sugerido para la plantilla",
  "summary": "resumen breve, en español y en bullets con '-', de los cambios que hiciste (qué agregaste, quitaste o reorganizaste)",
  "sections": [
    { "title": "...", "content": "...", "sort_order": 1 }
  ]
}`
        },
      ];

      // --- Streaming (SSE): estado en vivo según la tool que la IA va pidiendo ---
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (res.flushHeaders) res.flushHeaders();
      const sse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      const TOOL_LABELS = {
        get_amenities: 'Revisando las amenidades de la cabaña…',
        get_plans: 'Consultando los planes…',
        list_templates: 'Buscando otras plantillas de contrato…',
        get_template: 'Leyendo la plantilla de referencia…',
      };

      sse('status', { label: 'Analizando tu solicitud…' });

      // Loop de tool calling: la IA pide datos bajo demanda y luego responde el JSON
      let finalText = '';
      const toolsUsed = [];
      for (let i = 0; i < 5; i++) {
        if (i > 0) sse('status', { label: 'Redactando los cambios…' });
        const aiResponse = await llmService.callLLMByCode('xai_grok', messages, {
          maxTokens: 8000,
          temperature: 0.2,
          tools,
        });
        if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
          messages.push({ role: 'assistant', content: aiResponse.content || '', tool_calls: aiResponse.tool_calls });
          for (const tc of aiResponse.tool_calls) {
            const tname = tc.function?.name;
            sse('status', { label: TOOL_LABELS[tname] || 'Consultando información…', tool: tname });
            let args = {};
            try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* noop */ }
            const result = await execTool(tname, args);
            toolsUsed.push(tname);
            messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result) });
          }
          continue;
        }
        finalText = aiResponse.content || '';
        break;
      }

      if (!finalText) {
        sse('error', { error: 'La IA no devolvió una respuesta final.' });
        return res.end();
      }

      const parsed = contractImporter.parseAIResponse(finalText);
      sse('done', { success: true, template: parsed, summary: parsed.summary || '', tools_used: toolsUsed });
      res.end();
    } catch (error) {
      console.error('Error generating contract with AI:', error);
      if (res.headersSent) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message || 'Error al generar con IA' })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: error.message || 'Error al generar con IA' });
      }
    }
  });

  // --- Contract for an accommodation ---
  async function canAccessAccommodationContract(req, accommodationId, action) {
    // action: 'view' or 'manage'
    const fullPerm = action === 'manage' ? 'contracts:manage' : 'contracts:view';
    const ownPerm = action === 'manage' ? 'contracts:manage:own' : 'contracts:view:own';
    if (hasPermission(req.userPermissions, fullPerm)) return true;
    if (!hasPermission(req.userPermissions, ownPerm)) return false;
    const userId = req.user ? String(req.user.claims?.sub) : null;
    if (!userId) return false;
    const acc = await prisma.accommodations.findUnique({
      where: { id: accommodationId },
      select: { created_by: true, commission_agent_id: true }
    });
    if (!acc) return false;
    if (acc.created_by === userId) return true;
    const agentAccIds = await getAgentAccommodationIds(userId);
    return agentAccIds.has(accommodationId);
  }

  app.get('/api/accommodations/:id/contract', isAuthenticated, async (req, res) => {
    try {
      if (!(await canAccessAccommodationContract(req, req.params.id, 'view'))) {
        return res.status(403).json({ error: 'Permiso denegado' });
      }
      const contract = await prisma.contracts.findFirst({
        where: { accommodation_id: req.params.id },
        include: { attachments: true, template: { include: { sections: { orderBy: { sort_order: 'asc' } } } } },
      });
      if (!contract) return res.json(null);
      res.json(contract);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Helper: arma el snapshot_html (JSON de secciones renderizadas) para un hospedaje.
  // Selección de plantilla: (1) override explícito, (2) la ligada al plan de la reserva,
  // (3) la marcada como Default del venue.
  async function buildContractSnapshot(accommodation, explicitTemplateId = null) {
    const withSections = { include: { sections: { orderBy: { sort_order: 'asc' } } } };
    let template = null;
    if (explicitTemplateId) {
      template = await prisma.contract_templates.findFirst({
        where: { id: explicitTemplateId, venue_id: accommodation.venue, is_active: true },
        ...withSections,
      });
    }
    if (!template && accommodation.plan_id) {
      template = await prisma.contract_templates.findFirst({
        where: { venue_id: accommodation.venue, plan_id: accommodation.plan_id, is_active: true },
        ...withSections,
      });
    }
    if (!template) {
      template = await prisma.contract_templates.findFirst({
        where: { venue_id: accommodation.venue, is_default: true, is_active: true },
        ...withSections,
      });
    }
    const customer = accommodation.customer ? await prisma.contacts.findUnique({ where: { id: accommodation.customer } }) : null;
    const venue = accommodation.venue ? await prisma.venues.findUnique({ where: { id: accommodation.venue } }) : null;
    const organization = venue?.organization ? await prisma.organizations.findUnique({ where: { id: venue.organization } }) : null;
    const plan = accommodation.plan_id ? await prisma.venue_plans.findUnique({ where: { id: accommodation.plan_id } }) : null;
    const payments = await prisma.payments.findMany({ where: { accommodation: accommodation.id } });
    const deposit = await prisma.deposits.findFirst({ where: { accommodation_id: accommodation.id } });
    let commissionAgent = null;
    let commissionAgentContact = null;
    if (accommodation.commission_agent_id) {
      commissionAgent = await prisma.commission_agents.findUnique({
        where: { id: accommodation.commission_agent_id },
        include: { provider: true },
      });
      if (commissionAgent?.user_id) {
        commissionAgentContact = await prisma.contacts.findFirst({ where: { user: commissionAgent.user_id } });
      }
    }
    let snapshotHtml = null;
    if (template) {
      const { renderedSections } = contractRenderer.renderContract(template.sections, {
        accommodation, customer, venue, organization, plan, commissionAgent, commissionAgentContact, payments, deposit,
      });
      snapshotHtml = JSON.stringify(renderedSections);
    }
    return { snapshotHtml, templateId: template?.id || null };
  }

  app.post('/api/accommodations/:id/contract', isAuthenticated, async (req, res) => {
    try {
      if (!(await canAccessAccommodationContract(req, req.params.id, 'manage'))) {
        return res.status(403).json({ error: 'Permiso denegado' });
      }
      const userId = String(req.user.claims?.sub);
      const accommodation = await prisma.accommodations.findUnique({ where: { id: req.params.id } });
      if (!accommodation) return res.status(404).json({ error: 'Hospedaje no encontrado' });

      const existing = await prisma.contracts.findFirst({ where: { accommodation_id: req.params.id } });
      if (existing) return res.status(400).json({ error: 'Ya existe un contrato para este hospedaje' });

      const accessCode = String(Math.floor(100000 + Math.random() * 900000));
      const { snapshotHtml, templateId } = await buildContractSnapshot(accommodation, req.body?.template_id || null);

      const contract = await prisma.contracts.create({
        data: {
          accommodation_id: req.params.id,
          template_id: templateId,
          snapshot_html: snapshotHtml,
          access_code: accessCode,
          status: 'draft',
          created_by: userId,
        },
        include: { attachments: true },
      });

      res.json(contract);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/accommodations/:id/contract', isAuthenticated, async (req, res) => {
    try {
      if (!(await canAccessAccommodationContract(req, req.params.id, 'manage'))) {
        return res.status(403).json({ error: 'Permiso denegado' });
      }
      const existing = await prisma.contracts.findFirst({ where: { accommodation_id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Contrato no encontrado' });
      if (existing.status === 'signed') {
        return res.status(400).json({ error: 'No se puede eliminar un contrato firmado' });
      }
      await prisma.contract_attachments.deleteMany({ where: { contract_id: existing.id } });
      await prisma.contracts.delete({ where: { id: existing.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Regenerar el snapshot del contrato EN SITIO (conserva adjuntos, qr_token y código)
  app.post('/api/accommodations/:id/contract/regenerate', isAuthenticated, async (req, res) => {
    try {
      if (!(await canAccessAccommodationContract(req, req.params.id, 'manage'))) {
        return res.status(403).json({ error: 'Permiso denegado' });
      }
      const existing = await prisma.contracts.findFirst({ where: { accommodation_id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Contrato no encontrado' });
      if (existing.status === 'signed') {
        return res.status(400).json({ error: 'No se puede regenerar un contrato firmado' });
      }
      const accommodation = await prisma.accommodations.findUnique({ where: { id: req.params.id } });
      const { snapshotHtml, templateId } = await buildContractSnapshot(accommodation, req.body?.template_id || null);

      const updated = await prisma.contracts.update({
        where: { id: existing.id },
        data: { snapshot_html: snapshotHtml, template_id: templateId, updated_at: new Date() },
        include: { attachments: true },
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: adjuntar imagen al contrato (pegar/subir desde el tab del hospedaje)
  app.post('/api/accommodations/:id/contract/attachments', isAuthenticated, async (req, res) => {
    try {
      if (!(await canAccessAccommodationContract(req, req.params.id, 'manage'))) {
        return res.status(403).json({ error: 'Permiso denegado' });
      }
      const contract = await prisma.contracts.findFirst({
        where: { accommodation_id: req.params.id },
        select: { id: true },
      });
      if (!contract) return res.status(404).json({ error: 'Contrato no encontrado' });

      const { type, image_url, image_sepia_url, description } = req.body;
      if (!image_url) return res.status(400).json({ error: 'Falta image_url' });

      const attachment = await prisma.contract_attachments.create({
        data: { contract_id: contract.id, type: type || 'document', image_url, image_sepia_url, description },
      });
      res.json(attachment);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/accommodations/:id/contract/attachments/:attachmentId', isAuthenticated, async (req, res) => {
    try {
      if (!(await canAccessAccommodationContract(req, req.params.id, 'manage'))) {
        return res.status(403).json({ error: 'Permiso denegado' });
      }
      await prisma.contract_attachments.delete({ where: { id: req.params.attachmentId } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Public contract access (no auth) ---
  app.get('/api/public/contracts/:token', async (req, res) => {
    try {
      const contract = await prisma.contracts.findUnique({
        where: { qr_token: req.params.token },
        include: { attachments: true },
      });
      if (!contract) return res.status(404).json({ error: 'Contrato no encontrado' });

      // Get venue branding
      const accommodation = await prisma.accommodations.findUnique({ where: { id: contract.accommodation_id } });
      const venue = accommodation?.venue ? await prisma.venues.findUnique({ where: { id: accommodation.venue } }) : null;

      res.json({
        ...contract,
        venue_branding: venue ? {
          name: venue.name,
          logo_url: venue.logo_url,
          brand_color_primary: venue.brand_color_primary,
          brand_color_secondary: venue.brand_color_secondary,
        } : null,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/public/contracts/:token/upload', upload.single('file'), async (req, res) => {
    try {
      const contract = await prisma.contracts.findUnique({
        where: { qr_token: req.params.token },
        select: { id: true, status: true },
      });
      if (!contract) return res.status(404).json({ error: 'Contrato no encontrado' });
      if (contract.status === 'signed') {
        return res.status(400).json({ error: 'El contrato ya esta firmado' });
      }
      if (!req.file) return res.status(400).json({ error: 'No se envio archivo' });
      const result = await uploadImage(req.file.buffer, { type: 'receipt', mimetype: req.file.mimetype });
      res.json({ imageUrl: result.secure_url });
    } catch (error) {
      console.error('Error uploading contract asset:', error);
      res.status(500).json({ error: 'Error al subir la imagen' });
    }
  });

  app.post('/api/public/contracts/validate-code', async (req, res) => {
    try {
      const { accommodation_id, code } = req.body;
      const contract = await prisma.contracts.findFirst({
        where: { accommodation_id, access_code: code },
      });
      if (!contract) return res.status(403).json({ error: 'Código incorrecto' });
      res.json({ qr_token: contract.qr_token });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/public/contracts/:token/sign', async (req, res) => {
    try {
      const { signature_image_url, signer_photo_url, signer_photo_sepia_url } = req.body;
      const contract = await prisma.contracts.findUnique({ where: { qr_token: req.params.token } });
      if (!contract) return res.status(404).json({ error: 'Contrato no encontrado' });
      if (contract.status === 'signed') return res.status(400).json({ error: 'Contrato ya firmado' });

      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];

      const updated = await prisma.contracts.update({
        where: { qr_token: req.params.token },
        data: {
          status: 'signed',
          signature_image_url,
          signer_photo_url,
          signer_photo_sepia_url,
          accepted_at: new Date(),
          accepted_ip: String(ip).split(',')[0].trim(),
          accepted_user_agent: userAgent,
          updated_at: new Date(),
        },
        include: { attachments: true },
      });

      // TODO: Generate PDF + hash (ticket #10)

      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/public/contracts/:token/attachments', async (req, res) => {
    try {
      const contract = await prisma.contracts.findUnique({ where: { qr_token: req.params.token } });
      if (!contract) return res.status(404).json({ error: 'Contrato no encontrado' });
      if (contract.status === 'signed') return res.status(400).json({ error: 'Contrato ya firmado, no se pueden agregar adjuntos' });

      const { type, image_url, image_sepia_url, description } = req.body;
      const attachment = await prisma.contract_attachments.create({
        data: { contract_id: contract.id, type, image_url, image_sepia_url, description },
      });
      res.json(attachment);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/public/contracts/:token/attachments/:attachmentId', async (req, res) => {
    try {
      const contract = await prisma.contracts.findUnique({ where: { qr_token: req.params.token } });
      if (!contract) return res.status(404).json({ error: 'Contrato no encontrado' });
      if (contract.status === 'signed') return res.status(400).json({ error: 'Contrato ya firmado' });

      await prisma.contract_attachments.delete({ where: { id: req.params.attachmentId } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== End Contract API ====================

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

    // WhatsApp connections restore and auto-resume are handled by the external microservice
  });
}

// When running standalone (node index.js), start the server
if (!process.env.VERCEL) {
  startServer().catch(console.error);
}

// For Vercel serverless: export a ready promise and the app
const readyPromise = process.env.VERCEL ? startServer() : Promise.resolve();
module.exports = { app, readyPromise };
