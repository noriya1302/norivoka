// 노리의 매일 알림: 아침마다 계정별 마지막 학습일을 보고 노리 상태에 맞는 알림을 보낸다.
// Secret NORI_PUSH = {"vapidPublic","vapidPrivate","email","password","subject"}
import webpush from 'web-push';

const S = JSON.parse(process.env.NORI_PUSH || '{}');
const API_KEY = 'AIzaSyCJ8pNh2diC2vzzvTJzM2PV65VewZipU24'; // public web key, same as in the app
const PROJECT = 'projectvc-11ce4';
const ID = process.env.ID_URL || 'https://identitytoolkit.googleapis.com/v1';
const FS = (process.env.FS_URL || 'https://firestore.googleapis.com/v1') + `/projects/${PROJECT}/databases/(default)/documents`;
const TEST = process.env.MODE === 'test';

const dayKST = Math.floor((Date.now() + 9 * 3600e3) / 864e5);
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

export function message(gap, streak, nick, seed){
  const who = nick ? nick + '님, ' : '';
  if (gap === 0) return null;
  if (gap == null) return { mood: 'wait', title: '🐶 노리가 기다려요', body: who + '첫 산책 언제 가요? 오늘 분량이면 충분해요' };
  if (gap === 1){
    if (streak >= 2) return { mood: 'wait', title: `🔥 ${streak}일 연속, 오늘 지켜야 해요!`, body: pick(['노리가 목줄 물고 기다리는 중... 지금 하면 지켜요', '노리가 현관에서 꼬리 흔드는 중! 5분이면 돼요'], seed) };
    return { mood: 'wait', title: '🐶 노리가 낑낑대요', body: who + '오늘 분량 끝내고 산책 가요!' };
  }
  if (gap === 2) return { mood: 'sad', title: '😤 노리 삐짐', body: pick(['어제 안 와서 밥그릇 엎었대요. 오늘은 와요?', '노리가 등 돌리고 누웠어요. 단어로 달래 주세요'], seed) };
  if (gap <= 4) return { mood: 'sick', title: '🤒 노리가 아파요', body: pick(['약은 영어 단어뿐이래요... 빨리 와 주세요', '열이 펄펄 나요. 오늘 분량이 해열제래요'], seed) };
  if (gap <= 6) return { mood: 'hospital', title: '🏥 노리 입원', body: '면회는 노링에서만 돼요. 얼른 와 주세요' };
  if (gap <= 9) return { mood: 'hospital', title: '😭 노리가 죽어가고 있어요..', body: 10 - gap === 1 ? '정말 안 오실 건가요? 오늘이 마지막이에요' : `정말 안 오실 건가요? ${10 - gap}일 남았어요` };
  if (gap === 10) return { mood: 'dead', title: '🪦 노리가 죽었어요', body: '기다리다 지쳐서요... 지금 오면 살릴 수 있을지도' };
  if ([13, 17, 24, 30].includes(gap)) return { mood: 'dead', title: '👻 노리 유령 등장', body: '밤마다 단어장을 넘긴대요. 와서 살려 주세요' };
  return null;
}

async function post(url, body){ const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return [r.status, await r.json().catch(() => ({}))]; }
async function signIn(){
  const cred = { email: S.email, password: S.password, returnSecureToken: true };
  let [st, j] = await post(`${ID}/accounts:signInWithPassword?key=${API_KEY}`, cred);
  if (st !== 200){
    const why = j.error && j.error.message || '';
    if (!/EMAIL_NOT_FOUND|INVALID_LOGIN_CREDENTIALS/.test(why)) throw new Error('sign-in failed: ' + why);
    [st, j] = await post(`${ID}/accounts:signUp?key=${API_KEY}`, cred);
    if (st !== 200) throw new Error('sign-up failed: ' + (j.error && j.error.message));
  }
  return j.idToken;
}
const val = f => !f ? null : 'integerValue' in f ? Number(f.integerValue) : 'doubleValue' in f ? f.doubleValue : 'stringValue' in f ? f.stringValue
  : 'booleanValue' in f ? f.booleanValue : 'mapValue' in f ? Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, v]) => [k, val(v)])) : null;
function seedOf(s){ let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

export async function main(){
  if (!S.vapidPrivate) throw new Error('NORI_PUSH secret is missing');
  const token = await signIn();
  const H = { authorization: 'Bearer ' + token };
  const docs = []; let page = '';
  do {
    const r = await fetch(`${FS}/push?pageSize=300${page ? '&pageToken=' + page : ''}`, { headers: H });
    if (r.status !== 200) throw new Error('read failed ' + r.status + ' ' + (await r.text()).slice(0, 300));
    const j = await r.json(); (j.documents || []).forEach(d => docs.push(d)); page = j.nextPageToken || '';
  } while (page);
  let sent = 0, skipped = 0, gone = 0;
  for (const d of docs){
    const uid = d.name.split('/').pop(), f = d.fields || {};
    const subs = val(f.subs) || {}, last = val(f.last), streak = val(f.streak) || 0, nick = val(f.nick) || '';
    const gap = last == null ? null : dayKST - last;
    const m = TEST ? { mood: 'happy', title: '노리 알림 테스트 🐶', body: (nick ? nick + '님, ' : '') + '알림이 잘 와요! 매일 아침 9시쯤 찾아갈게요' } : message(gap, streak, nick, dayKST + seedOf(uid));
    if (!m || !Object.keys(subs).length){ skipped++; continue; }
    const payload = JSON.stringify({ title: m.title, body: m.body, icon: `nori-${m.mood}.png`, url: './' });
    const dead = [];
    for (const [k, raw] of Object.entries(subs)){
      try {
        await webpush.sendNotification(JSON.parse(raw), payload, { TTL: 4 * 3600, vapidDetails: { subject: S.subject, publicKey: S.vapidPublic, privateKey: S.vapidPrivate } });
        sent++;
      } catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dead.push(k); else console.log('send error', uid.slice(0, 6), e.statusCode || e.message); }
    }
    if (dead.length){
      const q = dead.map(k => 'updateMask.fieldPaths=subs.' + k).join('&');
      await fetch(`${FS}/push/${uid}?${q}`, { method: 'PATCH', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ fields: {} }) });
      gone += dead.length;
    }
  }
  console.log(`day ${dayKST}: ${docs.length} accounts, ${sent} sent, ${skipped} quiet, ${gone} expired`);
  return { sent, skipped, gone };
}
if (process.argv[1] && process.argv[1].endsWith('push.mjs')) main().catch(e => { console.error(e.message); process.exit(1); });
