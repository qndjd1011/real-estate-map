let map;
let markers = [];
let geocoder;
let openInfoWindow = null;
let userMarker = null;
let allRows = [];

// ✅ 지도 초기화
function initMap() {
  const container = document.getElementById('map');
  map = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(37.5665, 126.978),
    level: 7,
  });
  geocoder = new kakao.maps.services.Geocoder();

  kakao.maps.event.addListener(map, 'click', () => {
    if (openInfoWindow) {
      openInfoWindow.close();
      openInfoWindow = null;
    }
  });

  // ✅ 새로고침 시 자동 현재위치 이동 제거
  showUserLocationOnce();
  loadData();

  // ✅ 필터 검색 기능 단일화
  document.getElementById('searchInput').addEventListener('keyup', (e) => {
    if (e.key === 'Enter') applySearch();
  });

  // ✅ 새로고침 버튼 클릭 시에만 데이터 갱신
  document.getElementById('refresh').addEventListener('click', loadData);

  // ⛔ 자동 새로고침 제거 (기존 setInterval 삭제)
}

// ✅ 현재위치 1회만 표시 (자동이동 없음)
function showUserLocationOnce() {
  if (!navigator.geolocation)
    return console.warn('❌ 위치 서비스를 지원하지 않음');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const loc = new kakao.maps.LatLng(
        pos.coords.latitude,
        pos.coords.longitude
      );
      userMarker = new kakao.maps.Marker({
        position: loc,
        map,
        title: '내 위치',
        image: new kakao.maps.MarkerImage(
          'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png',
          new kakao.maps.Size(30, 45)
        ),
      });
    },
    (err) => console.warn('❌ 위치 정보 불가', err),
    { enableHighAccuracy: true }
  );
}

// ✅ 구글 시트 데이터 불러오기
async function loadData() {
  try {
    const res = await fetch('/data');
    const rows = await res.json();
    // ✅ 동일 주소 중 최근 등록만 남기기
    const uniqueRows = getLatestUniqueRows(rows);
    allRows = uniqueRows;
    mapMarkers(uniqueRows);
  } catch (err) {
    console.error('❌ 데이터 로드 오류:', err);
  }
}

// ✅ 동일주소 중 최신 데이터만 유지
function getLatestUniqueRows(rows) {
  const header = rows[0];
  const dataRows = rows.slice(1);
  const uniqueMap = new Map();
  for (let row of dataRows) {
    const addr = row[1] || '';
    if (!addr) continue;
    // 같은 주소가 있을 경우, 뒤쪽(최근) 데이터로 덮어쓰기
    uniqueMap.set(addr.trim(), row);
  }
  return [header, ...Array.from(uniqueMap.values())];
}

// ✅ 주소 문자열 정리
function cleanAddress(str) {
  if (!str) return '';
  return str
    .replace(/010-\d{4}-\d{4}/g, '')
    .replace(/[^가-힣0-9\s\-]/g, '')
    .trim();
}

// ✅ 마커 표시
async function mapMarkers(rows) {
  markers.forEach((m) => m.setMap(null));
  markers = [];

  const validRows = rows.slice(1).filter((r) => r[1]);

  for (const [연락처, 주소지, 특이사항, 매물] of validRows) {
    let addr = cleanAddress(주소지);
    if (!/서울|경기|인천/.test(addr)) addr = `서울 ${addr}`;
    await delay(200);
    geocoder.addressSearch(addr, (result, status) => {
      if (status === kakao.maps.services.Status.OK) {
        createMarker(result[0], 연락처, addr, 특이사항, 매물);
      } else {
        console.warn(`❌ 주소 인식 실패: ${addr}`);
      }
    });
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ✅ 마커 생성 (주소 클릭 시 카카오내비 연결)
function createMarker(result, 연락처, 주소지, 특이사항, 매물) {
  const coords = new kakao.maps.LatLng(result.y, result.x);
  const marker = new kakao.maps.Marker({ map, position: coords });
  markers.push(marker);

  const kakaoNaviUrl = `https://map.kakao.com/link/to/${encodeURIComponent(
    주소지
  )},${result.y},${result.x}`;

  const infoContent = `
    <div style="padding:10px;min-width:230px;font-size:14px;line-height:1.6;">
      📞 <a href="tel:${연락처}" style="color:#007aff;font-weight:bold;text-decoration:none;">
        ${연락처 || '연락처 없음'}
      </a><br>
      📍 <a href="${kakaoNaviUrl}" target="_blank" style="color:#333;text-decoration:underline;">
        ${주소지}
      </a><br>
      💬 ${특이사항 || ''}<br>
      💰 ${매물 || ''}
    </div>
  `;

  const infowindow = new kakao.maps.InfoWindow({ content: infoContent });
  kakao.maps.event.addListener(marker, 'click', () => {
    if (openInfoWindow) openInfoWindow.close();
    infowindow.open(map, marker);
    openInfoWindow = infowindow;
  });
}

// ✅ 검색 기능 (단일 키워드)
function applySearch() {
  const keyword = document
    .getElementById('searchInput')
    .value.trim()
    .toLowerCase();
  if (!keyword) {
    mapMarkers(allRows);
    return;
  }

  const filtered = allRows.filter((r, idx) => {
    if (idx === 0) return false;
    return r.join(' ').toLowerCase().includes(keyword);
  });

  mapMarkers([allRows[0], ...filtered]);
}

window.onload = initMap;
