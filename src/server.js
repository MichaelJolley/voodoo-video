require('dotenv').config();

const msal = require("@azure/msal-node");
const { v4: uuidv4 } = require('uuid');
const OpenTok = require('opentok');
const express = require('express');
const session = require('express-session');
const app = new express();
const port = 3000;

app.use(express.static(`${__dirname}/public`));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({ secret: uuidv4() }));

app.set('views', './src/views');

const config = {
  videoApiKey: process.env.videoApiKey,
  videoApiSecret: process.env.videoApiSecret,
  serverUrl: process.env.serverUrl,
  authority: process.env.azureB2CAuthority,
  azureB2CClientId: process.env.azureB2CClientId,
  azureB2CClientSecret: process.env.azureB2CClientSecret,
  azureB2CRedirectUrl: process.env.azureB2CRedirectUrl,
  azureB3CKnownAuthorities: process.env.azureB3CKnownAuthorities
};

const OT = new OpenTok(config.videoApiKey, config.videoApiSecret);

/**
 * Creates a Video API user token
 * @param {String} sessionId Id of the Video API session the user wishes to join
 * @param {String} username Username
*/
const generateToken = (sessionId, username) => OT.generateToken(sessionId, {
  role: 'publisher',
  data: `name=${username}`,
});

/**
 * Render the ejs template
 * @param {Object} res Express result
 * @param {String} sessionId Id of the Video API session to render with the page
 * @param {String} token A Video API token for the requesting user
 * @param {String} roomId Name of the room joined
 * @param {String} username Username
*/
const renderRoom = (res, sessionId, token, roomId, username) => {
  const { videoApiKey } = config;
  res.render('room.ejs', {
    videoApiKey,
    sessionId,
    token,
    roomId,
    username
  });
};

const checkSignIn = (req, res, next) => {
  if (req.session.user) {
    next();     //If session exists, proceed to page
  } else {
    var err = new Error("Not logged in!");
    console.log(req.session.user);
    next(err);  //Error, trying to access unauthorized page!
  }
}

/**
 * Routes
 */
app.get('/', (req, res) => {
  let { roomId } = req.query;

  if (!roomId) {
    roomId = uuidv4();
  }

  res.render('index.ejs', {
    roomId
  });
});

app.get('/room/:roomId', checkSignIn, (req, res) => {
  const { roomId } = req.params;

  // TODO: get username
  const username = req.session.user;

  if (app.get(roomId)) {
    const sessionId = app.get(roomId);

    const token = generateToken(sessionId, username);
    renderRoom(res, sessionId, token, roomId, username);
  } else {
    OT.createSession({
      mediaMode: 'routed',
    }, (error, session) => {
      if (error) {
        return res.send('There was an error').status(500);
      }
      const { sessionId } = session;
      const token = generateToken(sessionId, username);

      app.set(roomId, sessionId);

      renderRoom(res, sessionId, token, roomId, username);
    });
  }
});

app.get('/logout', function (req, res) {
  req.session.destroy(function () {
    console.log("user logged out.")
  });
  res.redirect('/');
});

app.use('/room/:roomId', function (err, req, res, next) {
  const { roomId } = req.params;
  console.log(err);
  //User should be authenticated! Redirect him to log in.
  res.redirect(`/?roomId=${roomId}`);
});


// Initiates auth code grant for login
app.get("/login", (req, res) => {
  const { roomId } = req.query;
  getAuthCode(config.authority, SCOPES.oidc, roomId, res);
})

// Second leg of auth code grant
app.get("/redirect", (req, res) => {

  // prepare the request for authentication
  tokenRequest.scopes = SCOPES.oidc;
  tokenRequest.code = req.query.code;

  cca.acquireTokenByCode(tokenRequest)
    .then((response) => {
      const { state } = req.query;
      req.session.user = response.idTokenClaims['name'];
      res.redirect(`/room/${state}`);
    }).catch((error) => {
      res.status(500).send(error);
    });

});

/**
 * Confidential Client Application Configuration
 */
const confidentialClientConfig = {
  auth: {
    clientId: config.azureB2CClientId,
    authority: config.authority,
    clientSecret: config.azureB2CClientSecret,
    knownAuthorities: [config.azureB3CKnownAuthorities],
    redirectUri: config.azureB2CRedirectUrl
  },
  system: {
    loggerOptions: {
      loggerCallback(loglevel, message, containsPii) {
        console.log(message);
      },
      piiLoggingEnabled: false,
      logLevel: msal.LogLevel.Verbose,
    }
  }
};

const SCOPES = {
  oidc: ["openid", "profile"]
}

/** 
 * Request Configuration
 * We manipulate these two request objects below 
 * to acquire a token with the appropriate claims.
 */
const authCodeRequest = {
  redirectUri: confidentialClientConfig.auth.redirectUri,
};

const tokenRequest = {
  redirectUri: confidentialClientConfig.auth.redirectUri,
};

// Initialize MSAL Node
const cca = new msal.ConfidentialClientApplication(confidentialClientConfig);


// Store accessToken in memory
app.locals.accessToken = null;

/**
 * This method is used to generate an auth code request
 * @param {string} authority: the authority to request the auth code from 
 * @param {array} scopes: scopes to request the auth code for 
 * @param {string} state: state of the application
 * @param {object} res: express middleware response object
 */
const getAuthCode = (authority, scopes, state, res) => {

  // prepare the request
  authCodeRequest.authority = authority;
  authCodeRequest.scopes = scopes;
  authCodeRequest.state = state;

  tokenRequest.authority = authority;

  // request an authorization code to exchange for a token
  return cca.getAuthCodeUrl(authCodeRequest)
    .then((response) => {
      res.redirect(response);
    })
    .catch((error) => {
      res.status(500).send(error);
    });
}

app.listen(port, () => console.log(`Listening on port ${port}`));