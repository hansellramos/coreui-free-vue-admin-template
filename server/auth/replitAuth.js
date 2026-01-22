const { discovery } = require('openid-client');
const { Strategy } = require('openid-client/passport');
const passport = require('passport');
const session = require('express-session');
const memoize = require('memoizee');
const connectPg = require('connect-pg-simple');
const { prisma } = require('../db');

const getOidcConfig = memoize(
  async () => {
    const issuerUrl = new URL(process.env.ISSUER_URL || 'https://replit.com/oidc');
    return await discovery(issuerUrl, process.env.REPL_ID);
  },
  { maxAge: 3600 * 1000 }
);

function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: 'sessions',
  });
  return session({
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(user, tokens) {
  const claims = tokens.claims();
  user.claims = claims;
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = claims?.exp;
}

async function upsertUser(claims) {
  const userData = {
    id: claims.sub,
    email: claims.email || null,
    display_name: claims.first_name && claims.last_name 
      ? `${claims.first_name} ${claims.last_name}` 
      : claims.first_name || claims.email,
    avatar_url: claims.profile_image_url || null,
  };

  // Check if user already exists
  const existingUser = await prisma.users.findUnique({
    where: { id: claims.sub }
  });

  if (existingUser) {
    // Update existing user (don't change profile_id)
    await prisma.users.update({
      where: { id: claims.sub },
      data: {
        email: userData.email,
        display_name: userData.display_name,
        avatar_url: userData.avatar_url,
      }
    });
  } else {
    // Create new user with default profile
    let defaultProfileId = null;
    const defaultProfileCode = process.env.DEFAULT_PROFILE_CODE;
    
    if (defaultProfileCode) {
      const defaultProfile = await prisma.profiles.findUnique({
        where: { code: defaultProfileCode }
      });
      if (defaultProfile) {
        defaultProfileId = defaultProfile.id;
      }
    }

    await prisma.users.create({
      data: {
        ...userData,
        profile_id: defaultProfileId
      }
    });
  }
}

async function setupAuth(app) {
  app.set('trust proxy', 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify = async (tokens, verified) => {
    try {
      const user = {};
      updateUserSession(user, tokens);
      await upsertUser(tokens.claims());
      verified(null, user);
    } catch (error) {
      verified(error);
    }
  };

  const registeredStrategies = new Set();

  const getExternalUrl = () => {
    const domain = process.env.REPLIT_DEV_DOMAIN;
    if (domain) {
      return `https://${domain}`;
    }
    return 'https://localhost:5000';
  };

  const ensureStrategy = () => {
    const externalUrl = getExternalUrl();
    const strategyName = 'replitauth';
    if (!registeredStrategies.has(strategyName)) {
      const callbackURL = `${externalUrl}/api/callback`;
      console.log('Registering strategy with callbackURL:', callbackURL);
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: 'openid email profile offline_access',
          callbackURL,
        },
        verify
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
    return strategyName;
  };

  passport.serializeUser((user, cb) => cb(null, user));
  passport.deserializeUser((user, cb) => cb(null, user));

  app.get('/api/login', (req, res, next) => {
    const strategyName = ensureStrategy();
    passport.authenticate(strategyName, {
      prompt: 'login consent',
      scope: ['openid', 'email', 'profile', 'offline_access'],
    })(req, res, next);
  });

  app.get('/api/callback', (req, res, next) => {
    const strategyName = ensureStrategy();
    passport.authenticate(strategyName, {
      successReturnToOrRedirect: '/',
      failureRedirect: '/api/login',
    })(req, res, next);
  });

  app.get('/api/logout', (req, res) => {
    req.logout(() => {
      res.redirect('/');
    });
  });

  app.get('/api/auth/user', isAuthenticated, async (req, res) => {
    try {
      const userId = String(req.user.claims.sub);
      const user = await prisma.users.findUnique({
        where: { id: userId },
        include: {
          profile: true
        }
      });
      
      // If user has a profile, fetch permission descriptions
      let permissionDetails = [];
      if (user?.profile?.permissions && Array.isArray(user.profile.permissions)) {
        const permissions = await prisma.permissions.findMany({
          where: {
            code: { in: user.profile.permissions }
          },
          orderBy: { code: 'asc' }
        });
        permissionDetails = permissions;
      }
      
      res.json({
        ...user,
        permissionDetails
      });
    } catch (error) {
      console.error('Error fetching user:', error);
      res.status(500).json({ message: 'Failed to fetch user' });
    }
  });
}

const isAuthenticated = async (req, res, next) => {
  const user = req.user;

  if (!req.isAuthenticated() || !user?.expires_at) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const { refreshTokenGrant } = require('openid-client');
    const config = await getOidcConfig();
    const tokenResponse = await refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
};

module.exports = { setupAuth, isAuthenticated };
