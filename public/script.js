// 전체 동작 요약
// - /data로부터 시트 불러오기 (rows: [header, ...])
// - 동일 주소는 그룹화하여 "주소당 하나의 마커" 생성
// - 마커 클릭 시 해당 주소의 모든 매물 목록을 정보창에 표시
// - 각 매물 항목에 "사진보기" (클라이언트 압축 시도 후 모달 표시)와 "매물나감" 버튼 제공
// - 매물나감은 로컬스토리지(removedListings)로 관리 (브라우저 기준 유지) — 서버 반영 원하면 서버 API 필요
// - 카카오내비 연결: 네이티브 스킴 시도 후 웹 링크로 포괄적 폴백 처리

let map;
let geocoder;
let markers = [];
let openInfoWindow = null;
let allRows = []; // header 포함
const removedKey = 'REAL_ESTATE_REMOVED_LISTINGS_v1';

// helper: 로컬스토리지에서 제거 목록 반환 (Set)
function getRemovedSet() {
  try {
    const raw = localStorage.getItem(removedKey);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}
function saveRemovedSet(set) {
  localStorage.setItem(removedKey, JSON.stringify(Array.from(set)));
}

// 초기화
function initMap() {
  const container = document.getElementById('map');
  map = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(37.5665, 126.978),
    level: 7,
  });
  geocoder = new kakao.maps.services.Geocoder();

  // 사용자 위치 1회만 표시 (지도 중심 이동 X)
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = new kakao.maps.LatLng(
          pos.coords.latitude,
          pos.coords.longitude
        );
        new kakao.maps.Marker({
          position: loc,
          map,
          title: '내 위치',
          image: new kakao.maps.MarkerImage(
            'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png',
            new kakao.maps.Size(30, 45)
          ),
        });
      },
      (err) => console.warn('위치 불러오기 실패:', err),
      { enableHighAccuracy: true }
    );
  }

  // 클릭 시 오픈된 InfoWindow 닫기
  kakao.maps.event.addListener(map, 'click', () => {
    if (openInfoWindow) {
      openInfoWindow.close();
      openInfoWindow = null;
    }
  });

  // 이벤트 바인딩
  document.getElementById('refresh').addEventListener('click', loadData);
  document.getElementById('searchInput').addEventListener('keyup', (e) => {
    if (e.key === 'Enter') applySearch();
  });

  // photo modal
  document
    .getElementById('closeModal')
    .addEventListener('click', closePhotoModal);
  document
    .getElementById('photoModalBackdrop')
    .addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) closePhotoModal();
    });

  // 최초 로드
  loadData();
}

// 데이터 로드
async function loadData() {
  try {
    const res = await fetch('/data');
    const rows = await res.json();
    // rows expected like: [headerRowArray, [col1,col2,...], ...]
    allRows = rows || [];
    // 그리기 (필터 적용 상태라면 applySearch에서 호출)
    applySearch(); // 기본: 빈 검색 -> 전체 그룹 마커 표시
  } catch (err) {
    console.error('데이터 로드 실패:', err);
  }
}

// 주소 정리 (전화번호 제거 + 특수문자 정리)
function cleanAddress(str) {
  if (!str) return '';
  return str
    .replace(/010-\d{4}-\d{4}/g, '')
    .replace(/01[0-9]-\d{3,4}-\d{4}/g, '') // 일반 전화번호도 제거
    .replace(/[^\uAC00-\uD7A30-9a-zA-Z\s\-,]/g, '')
    .trim();
}

// 행을 그룹화: 단일 주소(정리된 주소) -> [rows...]
// 반환: { header, groups: Map(addr => [row1,row2,...]) }
function groupByAddress(rows) {
  const header = rows[0] || [];
  const groups = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const [contact, addrRaw, note, deal, images] = row; // images optional (col index 4)
    if (!addrRaw) continue;
    let addr = cleanAddress(addrRaw);
    if (!/서울|경기|인천/.test(addr)) addr = `서울 ${addr}`;
    const key = addr.trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      rowIndex: i,
      contact: contact || '',
      addrRaw: addrRaw || '',
      addr: key,
      note: note || '',
      deal: deal || '',
      images: images || '', // may be multiple URLs separated by ; or ,
    });
  }
  return { header, groups };
}

// 지도에 마커 그리기 (그룹별로 하나)
async function mapMarkersFromGroups(groups) {
  // 기존 마커 제거
  markers.forEach((m) => m.setMap(null));
  markers = [];

  for (const [addr, listings] of groups.entries()) {
    // 주소 -> 좌표 변환 (first listing used)
    await delay(200); // rate-limit friendly
    // use cleaned addr
    const first = listings[0];
    geocoder.addressSearch(addr, (result, status) => {
      if (status === kakao.maps.services.Status.OK && result[0]) {
        const latlng = new kakao.maps.LatLng(result[0].y, result[0].x);
        const marker = new kakao.maps.Marker({ map, position: latlng });
        markers.push(marker);

        // 마커 클릭 시: 인포윈도우 생성 (목록 포함)
        kakao.maps.event.addListener(marker, 'click', () => {
          if (openInfoWindow) openInfoWindow.close();

          const html = buildInfoWindowContent(
            listings,
            result[0].y,
            result[0].x
          );
          const infowindow = new kakao.maps.InfoWindow({
            content: html,
            removable: true,
          });

          infowindow.open(map, marker);
          openInfoWindow = infowindow;
        });
      } else {
        console.warn('주소 변환 실패:', addr);
      }
    });
  }
}

// 인포윈도우 HTML 생성 (주소에 해당하는 모든 매물 목록)
// 각 매물 항목에는 사진보기와 매물나감 버튼 포함
function buildInfoWindowContent(listings, lat, lng) {
  // removed 체크
  const removed = getRemovedSet();
  const parts = listings
    .map((item, idx) => {
      const id = encodeListingId(item);
      if (removed.has(id)) {
        return `<div class="listing-box" style="opacity:0.5;">
          <div><strong>이미 삭제된 매물</strong></div>
          <div style="font-size:13px;">${escapeHtml(item.deal)} ${escapeHtml(
          item.note
        )}</div>
        </div>`;
      }
      // images parse
      const imageUrls = parseImageUrls(item.images);
      return `<div class="listing-box" data-listing-id="${id}">
        <div><strong>매물 ${idx + 1}</strong></div>
        <div style="font-size:13px;margin-top:6px;">
          📞 ${escapeHtml(item.contact)}<br>
          📍 ${escapeHtml(item.addrRaw)}<br>
          💬 ${escapeHtml(item.note)}<br>
          💰 ${escapeHtml(item.deal)}
        </div>
        <div class="listing-controls">
          <button class="btn btn-photo btn-small" data-images='${htmlAttrEncode(
            JSON.stringify(imageUrls)
          )}'>사진보기</button>
          <button class="btn btn-remove btn-small" data-listing-id='${id}'>매물나감</button>
        </div>
      </div>`;
    })
    .join('');

  // 주소 네비 연결 버튼 (네이티브 시도 -> 웹 폴백)
  const safeAddr = encodeURIComponent(listings[0].addr);
  const webUrl = `https://map.kakao.com/link/to/${safeAddr},${lat},${lng}`;

  // Build full wrapper with script hooks (onclicks delegated since infowindow content is raw HTML)
  const wrapper = `<div style="padding:10px;min-width:240px;max-width:380px;">
    <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(
      listings[0].addr
    )}</div>
    <div style="margin-bottom:8px;">
      <button class="btn btn-small" id="openNavBtn">카카오내비로 길찾기</button>
    </div>
    <div id="listingsContainer">${parts}</div>
    <script>
      (function(){
        // 네이티브 스킴 시도 후 웹 링크 폴백
        const openNavBtn = document.getElementById('openNavBtn');
        openNavBtn.addEventListener('click', function(){
          const lat = ${lat};
          const lng = ${lng};
          // native kakaomap scheme (iOS/Android 카카오맵 앱)
          const native = 'kakaomap://route?sp=' + lat + ',' + lng + '&by=FOOT';
          // attempt native open
          const timeout = setTimeout(function(){
            window.open('${webUrl}','_blank');
          }, 600);
          // try open native
          window.location.href = native;
          // fallback already set (will open web in timeout)
        });

        // 이벤트 위임: 사진보기, 매물나감
        const container = document.getElementById('listingsContainer');
        container.addEventListener('click', function(ev){
          const t = ev.target;
          if (t.matches('.btn-photo')) {
            const images = JSON.parse(t.getAttribute('data-images') || '[]');
            // call parent window's function to open modal & compress images
            window.parent && window.parent.openPhotoModalFromInfo && window.parent.openPhotoModalFromInfo(images);
            // if not in iframe, call global
            if (typeof openPhotoModalFromInfo === 'function') openPhotoModalFromInfo(images);
          } else if (t.matches('.btn-remove')) {
            const id = t.getAttribute('data-listing-id');
            if (!confirm('정말 이 매물을 "매물나감" 처리하시겠습니까? (이 동작은 로컬 브라우저에서 제거 처리됩니다)')) return;
            // mark removed in localStorage
            try {
              const raw = localStorage.getItem('${removedKey}');
              const arr = raw ? JSON.parse(raw) : [];
              if (!arr.includes(id)) arr.push(id);
              localStorage.setItem('${removedKey}', JSON.stringify(arr));
              // visual feedback: fade element
              const box = t.closest('.listing-box');
              if (box) box.style.opacity = 0.5;
            } catch(e) { console.error(e); }
          }
        });
      })();
    </script>
  </div>`;

  return wrapper;
}

// 유틸: escapeHtml
function escapeHtml(s) {
  if (!s && s !== 0) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 유틸: html attribute 안전 인코딩
function htmlAttrEncode(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

// 이미지 URL 문자열에서 배열로 (구분자 ; , 공백)
function parseImageUrls(imagesField) {
  if (!imagesField) return [];
  // split by semicolon or comma, trim, filter empties
  return imagesField
    .split(/;|,/)
    .map((u) => u.trim())
    .filter(Boolean);
}

// 매물 고유 ID 생성 (주소+연락처+deal+rowIndex)
function encodeListingId(item) {
  const key = `${item.addr}|${item.contact}|${item.deal}|${item.rowIndex}`;
  // base64 safe
  return btoa(unescape(encodeURIComponent(key)));
}

// small delay
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 검색 적용: 검색어가 없으면 전체 그룹 표시, 있으면 필터링하여 그룹 생성
function applySearch() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  if (!allRows || allRows.length < 2) {
    // no data
    return;
  }
  if (!q) {
    // show all groups
    const { groups } = groupByAddress(allRows);
    mapMarkersFromGroups(groups);
    return;
  }

  // filter rows where any column contains keyword
  const header = allRows[0];
  const filteredRows = [header];
  for (let i = 1; i < allRows.length; i++) {
    const row = allRows[i];
    if (!row) continue;
    const joined = row.join(' ').toLowerCase();
    if (joined.includes(q)) filteredRows.push(row);
  }
  const { groups } = groupByAddress(filteredRows);
  mapMarkersFromGroups(groups);
}

// 사진 모달: 이미지 리스트 받아서 압축 시도 후 보여주기
async function openPhotoModalFromInfo(imageUrls) {
  const container = document.getElementById('photoContainer');
  container.innerHTML = '';
  if (!imageUrls || imageUrls.length === 0) {
    container.innerHTML = '<div>등록된 사진이 없습니다.</div>';
    showPhotoModal();
    return;
  }

  for (const url of imageUrls) {
    // try compress
    try {
      const compressedDataUrl = await loadAndCompressImage(url, 1200, 0.75); // maxWidth 1200, quality 0.75
      const img = document.createElement('img');
      img.src = compressedDataUrl;
      container.appendChild(img);
    } catch (err) {
      // CORS or other error -> fallback to direct image tag but scaled
      const img = document.createElement('img');
      img.src = url; // may still load or be blocked
      img.style.maxWidth = '100%';
      container.appendChild(img);
    }
  }
  showPhotoModal();
}
window.openPhotoModalFromInfo = openPhotoModalFromInfo;

function showPhotoModal() {
  const backdrop = document.getElementById('photoModalBackdrop');
  backdrop.style.display = 'flex';
  backdrop.setAttribute('aria-hidden', 'false');
}

function closePhotoModal() {
  const backdrop = document.getElementById('photoModalBackdrop');
  const container = document.getElementById('photoContainer');
  backdrop.style.display = 'none';
  container.innerHTML = '';
  backdrop.setAttribute('aria-hidden', 'true');
}

// 이미지 로드 후 캔버스에서 사이즈 줄여 dataURL 반환
// 경고: 원본 이미지에 CORS 헤더(Access-Control-Allow-Origin)가 없으면 toDataURL에서 보안 오류 발생 → catch에서 fallback 처리
function loadAndCompressImage(url, maxWidth = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        const ratio = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      } catch (err) {
        // likely CORS restriction or other drawing error
        reject(err);
      }
    };
    img.onerror = function (e) {
      reject(e);
    };
    img.src = url;
    // If browser cached image and onload not fired, ensure onload will run
    if (img.complete) img.onload();
  });
}

// 초기화 호출
window.onload = initMap;
