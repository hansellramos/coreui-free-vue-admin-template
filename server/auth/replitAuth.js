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

    // Assign default trial subscription to new user
    const defaultSubscriptionId = process.env.DEFAULT_SUBSCRIPTION_ID;
    if (defaultSubscriptionId) {
      const subscription = await prisma.subscriptions.findUnique({
        where: { id: defaultSubscriptionId }
      });
      
      if (subscription) {
        // Calculate 30-day trial expiration for this user
        const trialDays = 30;
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + trialDays);
        
        await prisma.subscription_users.create({
          data: {
            subscription_id: defaultSubscriptionId,
            user_id: claims.sub,
            is_owner: false,
            role: 'member',
            trial_expires_at: expiresAt
          }
        });
      }
    }
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
      
      // Get all user's subscriptions and select the best one
      // Priority: active paid subscription > active trial > expired trial
      const subscriptionUsers = await prisma.subscription_users.findMany({
        where: { user_id: userId },
        include: {
          subscription: true
        },
        orderBy: { added_at: 'desc' }
      });
      
      let subscription = null;
      let trialDaysRemaining = null;
      let isTrialExpired = false;
      
      if (subscriptionUsers.length > 0) {
        // Find the best subscription
        let bestSubscription = null;
        
        for (const su of subscriptionUsers) {
          const sub = su.subscription;
          const trialExpiresAt = su.trial_expires_at;
          
          // Calculate if this specific subscription is active
          let isActive = sub.is_active;
          let isExpired = false;
          
          if (trialExpiresAt) {
            const now = new Date();
            const expiresDate = new Date(trialExpiresAt);
            isExpired = expiresDate.getTime() <= now.getTime();
            if (isExpired) {
              isActive = false;
            }
          }
          
          // Priority: active paid (no trial_expires_at) > active trial > expired
          if (!bestSubscription) {
            bestSubscription = { su, isActive, isExpired };
          } else {
            // Prefer active over inactive
            if (isActive && !bestSubscription.isActive) {
              bestSubscription = { su, isActive, isExpired };
            }
            // If both active, prefer paid (no trial) over trial
            else if (isActive && bestSubscription.isActive && !trialExpiresAt && bestSubscription.su.trial_expires_at) {
              bestSubscription = { su, isActive, isExpired };
            }
          }
        }
        
        if (bestSubscription) {
          const su = bestSubscription.su;
          const sub = su.subscription;
          const trialExpiresAt = su.trial_expires_at;
          
          // Calculate days remaining for trial
          if (trialExpiresAt) {
            const now = new Date();
            const expiresDate = new Date(trialExpiresAt);
            const diffTime = expiresDate.getTime() - now.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays > 0) {
              trialDaysRemaining = diffDays;
            } else {
              isTrialExpired = true;
            }
          }
          
          subscription = {
            id: sub.id,
            name: sub.name,
            plan_type: sub.plan_type,
            is_active: bestSubscription.isActive,
            is_owner: su.is_owner,
            role: su.role,
            expires_at: sub.expires_at,
            trial_expires_at: trialExpiresAt,
            trial_days_remaining: trialDaysRemaining,
            is_trial_expired: isTrialExpired
          };
        }
      }
      
      res.json({
        ...user,
        permissionDetails,
        subscription
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
