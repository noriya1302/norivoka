// 신고 알림: 새로 들어온 신고가 있으면 관리자 휴대폰으로 바로 알린다 (15분마다 확인).
// 관리자 계정은 앱에서 노리 알림을 켜 두면 push 문서에 adm: true 가 붙는다.
import webpush from 'web-push';
const S = JSON.parse(process.env.NORI_PUSH || '{}');
const API_KEY = 'AIzaSyCJ8pNh2diC2vzzvTJzM2PV65VewZipU24'; // public web key, same as in the app
const PROJECT = 'projectvc-11ce4';
const ID = 'https://identitytoolkit.googleapis.com/v1';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
async function post(url, body){ const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return [r.status, await r.json().catch(() => ({}))]; }
const val = f => !f ? null : 'integerValue' in f ? Number(f.integerValue) : 'doubleValue' in f ? f.doubleValue : 'stringValue' in f ? f.stringValue
  : 'booleanValue' in f ? f.booleanValue : 'mapValue' in f ? Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, v]) => [k, val(v)])) : null;
async function list(col, H){
  const out = []; let page = '';
  do {
    const r = await fetch(`${FS}/${col}?pageSize=300${page ? '&pageToken=' + page : ''}`, { headers: H });
    if (r.status === 403){ console.log(col + ': no read permission yet (paste the new rules from the admin screen)'); return null; }
    if (r.status !== 200) throw new Error(col + ' read failed ' + r.status);
    const j = await r.json(); (j.documents || []).forEach(d => out.push(d)); page = j.nextPageToken || '';
  } while (page);
  return out;
}
async function main(){
  if (!S.vapidPrivate) throw new Error('NORI_PUSH secret is missing');
  const [st, j] = await post(`${ID}/accounts:signInWithPassword?key=${API_KEY}`, { email: S.email, password: S.password, returnSecureToken: true });
  if (st !== 200) throw new Error('sign-in failed');
  const H = { authorization: 'Bearer ' + j.idToken };
  const reps = await list('reports', H); if (!reps) return;
  const fresh = reps.filter(d => !val((d.fields || {}).pushed)).map(d => ({ name: d.name, why: val(d.fields.why) || '신고', w: val(d.fields.w) || '', at: val(d.fields.at) || 0 })).sort((a, b) => b.at - a.at);
  if (!fresh.length){ console.log('no new reports'); return; }
  const push = await list('push', H) || [];
  const admins = push.filter(d => val((d.fields || {}).adm));
  const payload = JSON.stringify({ title: '새 신고 ' + fresh.length + '개', body: fresh[0].why + (fresh[0].w ? ' · ' + fresh[0].w : '') + (fresh.length > 1 ? ' 외 ' + (fresh.length - 1) + '개' : ''), icon: 'nori-wait.png', url: './?admin=reports', tag: 'nori-report' });
  let sent = 0;
  for (const d of admins){
    for (const raw of Object.values(val(d.fields.subs) || {})){
      try { await webpush.sendNotification(JSON.parse(raw), payload, { TTL: 24 * 3600, vapidDetails: { subject: S.subject, publicKey: S.vapidPublic, privateKey: S.vapidPrivate } }); sent++; }
      catch (e) { console.log('send error', e.statusCode || e.message); }
    }
  }
  // mark them so the same report is announced once
  for (const r of fresh){
    await fetch(`https://firestore.googleapis.com/v1/${r.name}?updateMask.fieldPaths=pushed`, { method: 'PATCH', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ fields: { pushed: { booleanValue: true } } }) });
  }
  console.log(`${fresh.length} new reports, ${admins.length} admin devices, ${sent} sent`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
