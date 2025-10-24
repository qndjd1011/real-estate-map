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

  showUserLocation();
  loadData();

  document.getElementById('filterBtn').addEventListener('click', applyFilters);
  document.getElementById('searchInput').addEventListener('keyup', (e) => {
    if (e.key === 'Enter') applyFilters();
  });

  document.getElementById('refresh').addEventListener('click', loadData);

  // 30초마다 새로고침
  setInterval(loadData, 30000);
}

// ✅ 내 위치 표시
function showUserLocation() {
  if (!navigator.geolocation)
    return console.warn('❌ 위치 서비스를 지원하지 않음');
  navigator.geolocation.watchPosition(
    (pos) => {
      const loc = new kakao.maps.LatLng(
        pos.coords.latitude,
        pos.coords.longitude
      );
      if (userMarker) userMarker.setMap(null);
      userMarker = new kakao.maps.Marker({
        position: loc,
        map,
        title: '내 위치',
        image: new kakao.maps.MarkerImage(
          'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png',
          new kakao.maps.Size(30, 45)
        ),
      });
      map.setCenter(loc);
    },
    (err) => console.warn('❌ 위치 정보 불가', err),
    { enableHighAccuracy: true }
  );
}

// ✅ 구글 스프레드시트 데이터 로드
async function loadData() {
  try {
    const res = await fetch('/data');
    const rows = await res.json();
    allRows = rows;
    mapMarkers(rows);
  } catch (err) {
    console.error('❌ 데이터 로드 오류:', err);
  }
}

// ✅ 주소 문자열 정리 (전화번호 제거 등)
function cleanAddress(str) {
  if (!str) return '';
  return str
    .replace(/010-\d{4}-\d{4}/g, '') // 전화번호 제거
    .replace(/[^가-힣0-9\s\-]/g, '') // 특수문자 제거
    .trim();
}

// ✅ 마커 표시 (순차 처리)
async function mapMarkers(rows) {
  markers.forEach((m) => m.setMap(null));
  markers = [];

  const validRows = rows.slice(1).filter((r) => r[1]); // 헤더 제외 + 주소 있는 행만

  for (const [연락처, 주소지, 특이사항, 매물] of validRows) {
    let addr = cleanAddress(주소지);
    if (!/서울|경기|인천/.test(addr)) addr = `서울 ${addr}`;
    await delay(200); // 요청 간격 조절 (0.2초)
    geocoder.addressSearch(addr, (result, status) => {
      if (status === kakao.maps.services.Status.OK) {
        createMarker(result[0], 연락처, addr, 특이사항, 매물);
      } else {
        console.warn(`❌ 주소 인식 실패: ${addr}`);
      }
    });
  }
}

// ✅ 지연 함수
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ✅ 마커 생성
function createMarker(result, 연락처, 주소지, 특이사항, 매물) {
  const coords = new kakao.maps.LatLng(result.y, result.x);
  const marker = new kakao.maps.Marker({ map, position: coords });
  markers.push(marker);

  const infoContent = `
    <div style="padding:10px;min-width:230px;font-size:14px;line-height:1.6;">
      📞 <a href="tel:${연락처}" style="color:#007aff;font-weight:bold;text-decoration:none;">
        ${연락처 || '연락처 없음'}
      </a><br>
      📍 ${주소지}<br>
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

// ✅ 필터 적용
function applyFilters() {
  const keyword = document.getElementById('searchInput').value.trim();
  const minPrice = parseInt(document.getElementById('minPrice').value) || 0;
  const maxPrice =
    parseInt(document.getElementById('maxPrice').value) || Infinity;
  const region = document.getElementById('regionSelect').value;

  const filtered = allRows.filter((r, idx) => {
    if (idx === 0) return false;
    const [연락처, 주소지, 특이사항, 매물] = r;
    if (!주소지) return false;

    let addr = cleanAddress(주소지);
    if (!/서울|경기|인천/.test(addr)) addr = `서울 ${addr}`;
    if (region !== '전체' && !addr.includes(region)) return false;

    const combined = `${주소지} ${특이사항} ${매물}`.toLowerCase();
    if (keyword && !combined.includes(keyword.toLowerCase())) return false;

    const priceMatch = 매물.match(/(\d+)\/(\d+)/);
    if (priceMatch) {
      const deposit = parseInt(priceMatch[1]);
      const rent = parseInt(priceMatch[2]);
      if (deposit < minPrice || rent > maxPrice) return false;
    }

    return true;
  });

  mapMarkers(filtered);
}

// ✅ 페이지 로드 시 실행
window.onload = initMap;
