// server.js (전체)
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const sharp = require('sharp');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ========== Google Sheet 설정 (읽기 기존) ==========
const SHEET_ID =
  process.env.SHEET_ID || '1Iuglj2pzxGaabo-UVogKZ6SV4rPMddE9-aEzkrMhK0M';
const SHEET_NAME = process.env.SHEET_NAME || '매물정보';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${SHEET_NAME}`;

let cachedData = null;
let lastFetched = 0;
const CACHE_DURATION = 30 * 1000; // 30초 캐시

app.get('/data', async (req, res) => {
  const now = Date.now();
  try {
    if (!cachedData || now - lastFetched > CACHE_DURATION) {
      const response = await axios.get(SHEET_URL);
      const text = response.data;
      const json = JSON.parse(text.substr(47).slice(0, -2));
      const rows = json.table.rows.map((r) => r.c.map((c) => (c ? c.v : '')));
      cachedData = rows;
      lastFetched = now;
      console.log('🔄 시트 새로고침 완료');
    }
    res.json(cachedData);
  } catch (error) {
    console.error('❌ 스프레드시트 로드 오류:', error);
    res.status(500).send('스프레드시트 데이터를 불러오는 중 오류 발생');
  }
});

// ========== 이미지 프록시: /image-proxy?url=ENCODED_URL&w=1200 ==========
app.get('/image-proxy', async (req, res) => {
  const imageUrl = req.query.url;
  const maxWidth = parseInt(req.query.w) || 1200;
  if (!imageUrl) return res.status(400).send('url 쿼리가 필요합니다.');

  try {
    // 안전하게 원격 이미지 가져오기 (https만 허용)
    const urlObj = new URL(imageUrl);
    if (urlObj.protocol !== 'https:') {
      return res.status(400).send('https 이미지 URL만 지원합니다.');
    }

    // fetch binary
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 10000,
    });
    const inputBuffer = Buffer.from(response.data);

    // sharp로 리사이즈 (비율 유지)
    const image = sharp(inputBuffer);
    const meta = await image.metadata();
    if (meta.width && meta.width > maxWidth) {
      const out = await image
        .resize({ width: maxWidth })
        .jpeg({ quality: 80 })
        .toBuffer();
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=604800'); // 7일 캐시
      return res.send(out);
    } else {
      // 크기 변경 필요 없으면 원본을 jpeg로 변환(혹은 그대로)
      const out = await image.jpeg({ quality: 80 }).toBuffer();
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=604800');
      return res.send(out);
    }
  } catch (err) {
    console.error('image-proxy 오류:', err && err.message);
    return res.status(500).send('이미지 프록시 실패');
  }
});

// ========== 매물나감 처리: 로컬 로그 + (옵션) 스프레드시트 기록 ==========
const REMOVED_LOG = path.join(__dirname, 'removed_log.json');

// Helper: append to local removed log
function appendLocalRemoved(entry) {
  let arr = [];
  try {
    if (fs.existsSync(REMOVED_LOG)) {
      arr = JSON.parse(fs.readFileSync(REMOVED_LOG, 'utf8'));
    }
  } catch (e) {
    arr = [];
  }
  arr.push(entry);
  fs.writeFileSync(REMOVED_LOG, JSON.stringify(arr, null, 2), 'utf8');
}

// Google Sheets append (옵션): requires GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_PATH env and REMOVED_SHEET_NAME
async function appendToGoogleRemoved(entry) {
  try {
    const credPath = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_PATH;
    const removedSheetName = process.env.REMOVED_SHEET_NAME || 'Removed';
    if (!credPath || !process.env.SHEET_ID) {
      console.log(
        'Google Sheets append skipped: credentials or SHEET_ID missing'
      );
      return;
    }
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    const jwtClient = new google.auth.JWT(
      creds.client_email,
      null,
      creds.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    await jwtClient.authorize();
    const sheets = google.sheets({ version: 'v4', auth: jwtClient });
    const values = [
      [new Date().toISOString(), entry.listingId, JSON.stringify(entry)],
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: `${removedSheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values },
    });
    console.log('✅ Google Sheets Removed에 기록됨');
  } catch (e) {
    console.error('Google Sheets append 실패:', e && e.message);
  }
}

app.post('/remove', async (req, res) => {
  const { listingId, extra } = req.body;
  if (!listingId)
    return res.status(400).json({ ok: false, message: 'listingId 필요' });

  const entry = {
    listingId,
    extra: extra || null,
    ts: new Date().toISOString(),
  };
  try {
    appendLocalRemoved(entry);
    // optional sheet append
    if (process.env.ENABLE_GOOGLE_REMOVED === 'true') {
      await appendToGoogleRemoved(entry);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('remove 처리 실패:', err);
    return res.status(500).json({ ok: false, message: '서버 오류' });
  }
});

// =================================================
// 서버 시작
app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
  console.log(`   image-proxy: /image-proxy?url=...&w=1200`);
});
