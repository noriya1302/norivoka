// 노리의 매일 알림: 저녁마다 계정별 마지막 학습일을 보고 노리 상태에 맞는 알림을 보낸다.
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
  if (gap == null) return { mood: 'wait', title: '노리가 첫 산책을 기다려요 🐶', body: who + '오늘 분량만 끝내면 노리가 꼬리를 흔들 거예요' };
  if (gap === 1){
    if (streak >= 2) return { mood: 'wait', title: `🔥 ${streak}일 연속이 오늘 밤 끊겨요`, body: who + pick(['노리가 목줄을 물고 현관에서 기다려요. 단어 몇 개면 지킬 수 있어요', '노리가 연속 기록을 지키는 중이에요. 지금 들어오면 아직 안 늦었어요'], seed) };
    return { mood: 'wait', title: '노리가 산책 가자고 낑낑대요', body: who + '오늘 분량 끝내고 같이 놀아요' };
  }
  if (gap === 2) return { mood: 'sad', title: '노리가 삐졌어요 😤', body: who + pick(['어제 안 와서 밥그릇을 엎었대요. 오늘은 와 줄 거죠?', '노리가 등 돌리고 누워 있어요. 단어로 달래 주세요'], seed) };
  if (gap === 3) return { mood: 'sick', title: '노리가 아파요 🤒', body: who + pick(['수의사 말로는 영어 단어가 약이래요. 오늘 꼭 먹여 주세요', '노리가 열이 나요. 오늘 분량이 해열제래요'], seed) };
  if (gap <= 5) return { mood: 'hospital', title: '노리가 입원했어요 🏥', body: who + `면회는 노리보카에서만 돼요. ${7 - gap}일 안에 와야 노리가 버텨요` };
  if (gap === 6) return { mood: 'hospital', title: '노리가 위독해요 🚨', body: who + '오늘이 마지막 기회예요. 내일이면 노리가 무지개다리를 건너요' };
  if (gap === 7) return { mood: 'ghost', title: '노리가 무지개다리를 건넜어요 🌈', body: who + '너무 늦었나요... 오늘 분량을 끝내면 다시 살아날지도 몰라요' };
  if ([10, 14, 21, 30].includes(gap)) return { mood: 'ghost', title: '노리 유령이 나타났어요 👻', body: who + '밤마다 단어장을 넘기고 있대요. 들어와서 살려 주세요' };
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
    const m = TEST ? { mood: 'happy', title: '노리 알림 테스트 🐶', body: (nick ? nick + '님, ' : '') + '알림이 잘 와요! 매일 저녁 8시쯤 찾아갈게요' } : message(gap, streak, nick, dayKST + seedOf(uid));
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
