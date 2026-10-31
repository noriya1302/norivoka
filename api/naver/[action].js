const crypto = require('node:crypto');
const ORIGIN = 'https://norivoka-alpha.vercel.app';
const STATE = '__Host-nori_naver_state';
const TOKEN = '__Host-nori_naver_token';
const cookie = (name, value, age, sameSite = 'Lax') => `${name}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=${sameSite}`;
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split(/=(.*)/s)).filter(x => x[0]).map(x => [x[0], x[1] || '']));
}
function digest(value, secret) { return crypto.createHmac('sha256', secret).update(value).digest('base64url'); }
function equal(a, b) {
  const x = Buffer.from(a || ''), y = Buffer.from(b || '');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function makeToken(id, account) {
  if (account.project_id !== 'projectvc-11ce4') throw new Error('Wrong Firebase project');
  const now = Math.floor(Date.now() / 1000);
  // Hash provider IDs to keep the UID stable and inside Firebase's 128-character limit.
  const uid = 'naver:' + crypto.createHash('sha256').update(id).digest('hex');
  const payload = {iss: account.client_email, sub: account.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now, exp: now + 120, uid};
  const data = [ {alg:'RS256',typ:'JWT'}, payload ].map(x => Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  return data + '.' + crypto.sign('RSA-SHA256', Buffer.from(data), account.private_key).toString('base64url');
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const action = new URL(req.url, ORIGIN).pathname.split('/').pop();
  const jar = cookies(req);
  const redirect = path => { res.statusCode = 303; res.setHeader('Location', path); return res.end(); };
  const fail = reason => {
    res.setHeader('Set-Cookie', [cookie(STATE, '', 0), cookie(TOKEN, '', 0, 'Strict')]);
    return redirect('/?naver_error=' + reason);
  };
  if (!['start','callback','exchange'].includes(action)) { res.statusCode = 404; return res.end(); }
  if (req.method !== (action === 'exchange' ? 'POST' : 'GET')) { res.statusCode = 405; return res.end(); }
  try {
    const secret = process.env.NAVER_CLIENT_SECRET;
    const clientId = process.env.NAVER_CLIENT_ID;
    if (!secret || !clientId || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return fail('configuration');
    if (action === 'start') {
      const state = crypto.randomBytes(32).toString('base64url');
      const data = `${Date.now()}.${state}`;
      res.setHeader('Set-Cookie', [cookie(STATE, data + '.' + digest(data, secret), 600), cookie(TOKEN, '', 0, 'Strict')]);
      const url = new URL('https://nid.naver.com/oauth2.0/authorize');
      url.search = new URLSearchParams({response_type:'code', client_id:clientId, redirect_uri:ORIGIN + '/api/naver/callback', state});
      return redirect(url.href);
    }
    if (action === 'exchange') {
      if (req.headers.origin !== ORIGIN) { res.statusCode = 403; return res.end(); }
      res.setHeader('Set-Cookie', cookie(TOKEN, '', 0, 'Strict'));
      const token = jar[TOKEN];
      if (!token) { res.statusCode = 401; return res.end(JSON.stringify({error:'expired'})); }
      const parts = token.split('.');
      const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      if (parts.length !== 3 || !crypto.verify('RSA-SHA256', Buffer.from(parts.slice(0,2).join('.')), crypto.createPublicKey(account.private_key), Buffer.from(parts[2], 'base64url'))) { res.statusCode = 401; return res.end(); }
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      if (claims.exp <= Date.now()/1000) { res.statusCode = 401; return res.end(); }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({token}));
    }
    const query = new URL(req.url, ORIGIN).searchParams;
    const [time, expected, signature] = (jar[STATE] || '').split('.');
    const age = Date.now() - Number(time);
    if (!expected || !signature || !Number.isFinite(age) || age < 0 || age > 600000 || !equal(signature, digest(`${time}.${expected}`, secret)) || !equal(expected, query.get('state'))) return fail('state');
    if (query.has('error')) return fail('cancelled');
    const code = query.get('code');
    if (!code || code.length > 4096) return fail('response');
    const response = await fetch('https://nid.naver.com/oauth2.0/token', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,client_secret:secret,code,state:expected}), signal:AbortSignal.timeout(10000)});
    const credentials = await response.json();
    if (!response.ok || !credentials.access_token) return fail('provider');
    const profileResponse = await fetch('https://openapi.naver.com/v1/nid/me', {headers:{Authorization:'Bearer ' + credentials.access_token},signal:AbortSignal.timeout(10000)});
    const profile = await profileResponse.json();
    if (!profileResponse.ok || profile.resultcode !== '00' || typeof profile.response?.id !== 'string' || !profile.response.id) return fail('profile');
    const token = makeToken(profile.response.id, JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
    res.setHeader('Set-Cookie', [cookie(STATE, '', 0), cookie(TOKEN, token, 120, 'Strict')]);
    return redirect('/?naver_complete=1');
  } catch {
    // Never log provider tokens, credentials, or callback query parameters.
    return fail('server');
  }
};