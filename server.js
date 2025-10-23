const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// 정적 파일 (HTML, JS, CSS) 제공
app.use(express.static('public'));

// Google Sheet 설정
const SHEET_ID = '1Iuglj2pzxGaabo-UVogKZ6SV4rPMddE9-aEzkrMhK0M';
const SHEET_NAME = '매물정보';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${SHEET_NAME}`;

let cachedData = null;
let lastFetched = 0;
const CACHE_DURATION = 30 * 1000; // 30초

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

app.listen(PORT, () =>
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`)
);
