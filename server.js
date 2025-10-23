const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

// 정적 파일 (HTML, JS, CSS)을 서비스
app.use(express.static('public'));

// Google Sheet ID 및 시트 이름
const SHEET_ID = '1Iuglj2pzxGaabo-UVogKZ6SV4rPMddE9-aEzkrMhK0M';
const SHEET_NAME = '매물정보'; // 실제 시트 이름에 맞게 수정

// Google Sheets JSON API URL
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${SHEET_NAME}`;

let cachedData = null;
let lastFetched = 0;
const CACHE_DURATION = 30 * 1000; // 30초마다 새로고침

app.get('/data', async (req, res) => {
  const now = Date.now();
  try {
    // 캐시 만료 시 새로 요청
    if (!cachedData || now - lastFetched > CACHE_DURATION) {
      const response = await axios.get(SHEET_URL);
      const text = response.data;

      // Google Sheets 데이터 파싱
      const json = JSON.parse(text.substr(47).slice(0, -2));
      const rows = json.table.rows.map((r) => r.c.map((c) => (c ? c.v : '')));

      cachedData = rows;
      lastFetched = now;
      console.log('🔄 스프레드시트 새로고침됨');
    }

    res.json(cachedData);
  } catch (error) {
    console.error('❌ 데이터 로드 오류:', error);
    res
      .status(500)
      .send('스프레드시트 데이터를 불러오는 중 오류가 발생했습니다.');
  }
});

app.listen(PORT, () =>
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`)
);
