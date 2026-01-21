const express = require('express');
const cors = require('cors');
const { prisma } = require('./db');
const { setupAuth, isAuthenticated } = require('./auth/replitAuth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());

async function startServer() {
  await setupAuth(app);

  app.get('/api/organizations', async (req, res) => {
    try {
      const organizations = await prisma.organizations.findMany({
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
      const venues = await prisma.venues.findMany({
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
      const contacts = await prisma.contacts.findMany({
        orderBy: { fullname: 'asc' }
      });
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
      const contact = await prisma.contacts.create({
        data: req.body
      });
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
      const accommodations = await prisma.accommodations.findMany({
        orderBy: { date: 'desc' }
      });
      res.json(accommodations);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/accommodations/:id', async (req, res) => {
    try {
      const accommodation = await prisma.accommodations.findUnique({
        where: { id: req.params.id }
      });
      res.json(accommodation);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/accommodations', isAuthenticated, async (req, res) => {
    try {
      const accommodation = await prisma.accommodations.create({
        data: req.body
      });
      res.json(accommodation);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/accommodations/:id', isAuthenticated, async (req, res) => {
    try {
      const accommodation = await prisma.accommodations.update({
        where: { id: req.params.id },
        data: req.body
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
      const contactsMap = {};
      contactsData.forEach(c => { contactsMap[c.id] = c; });
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch(console.error);
