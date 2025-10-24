// script.js (전체)
let map;
let geocoder;
let markers = [];
let openInfoWindow = null;
let allRows = [];
const REMOVED_LOCAL_KEY = 'REAL_ESTATE_REMOVED_v1';
const UPLOADED_PHOTOS_KEY_PREFIX = 'REAL_ESTATE_UPLOADED_'; // + listingId -> array of dataURLs

function initMap() {
  const container = document.getElementById('map');
  map = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(37.5665, 126.978),
    level: 7,
  });
  geocoder = new kakao.maps.services.Geocoder();

  // show user position marker once (no center 이동)
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        new kakao.maps.Marker({
          position: new kakao.maps.LatLng(
            pos.coords.latitude,
            pos.coords.longitude
          ),
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

  kakao.maps.event.addListener(map, 'click', () => {
    if (openInfoWindow) {
      openInfoWindow.close();
      openInfoWindow = null;
    }
  });

  document.getElementById('refresh').addEventListener('click', loadData);
  document.getElementById('searchInput').addEventListener('keyup', (e) => {
    if (e.key === 'Enter') applySearch();
  });

  // photo modal controls
  document
    .getElementById('closeModal')
    .addEventListener('click', closePhotoModal);
  document
    .getElementById('photoModalBackdrop')
    .addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) closePhotoModal();
    });

  document
    .getElementById('uploadPhotoBtn')
    .addEventListener('click', async () => {
      const fileInput = document.getElementById('photoFileInput');
      if (!fileInput.files || fileInput.files.length === 0) {
        alert('업로드할 사진을 선택하세요.');
        return;
      }
      const file = fileInput.files[0];
      try {
        const dataUrl = await compressFileToDataUrl(file, 1200, 0.75);
        // store temporarily under currentlyOpenedListing (set when opening modal)
        if (window.__currentModalListingId) {
          const key =
            UPLOADED_PHOTOS_KEY_PREFIX + window.__currentModalListingId;
          const arrRaw = localStorage.getItem(key);
          const arr = arrRaw ? JSON.parse(arrRaw) : [];
          arr.push({ dataUrl, ts: new Date().toISOString() });
          localStorage.setItem(key, JSON.stringify(arr));
          // add to modal preview
          const img = document.createElement('img');
          img.src = dataUrl;
          document.getElementById('photoContainer').appendChild(img);
          alert('사진이 브라우저에 저장되었습니다. (로컬 전용)');
          fileInput.value = '';
        } else {
          alert('저장할 매물이 설정되지 않았습니다.');
        }
      } catch (err) {
        console.error(err);
        alert('이미지 처리 중 오류가 발생했습니다.');
      }
    });

  loadData();
}

async function loadData() {
  try {
    const res = await fetch('/data');
    const rows = await res.json();
    allRows = rows || [];
    applySearch(); // 기본 검색 상태면 전체 보여줌
  } catch (e) {
    console.error('데이터 로드 오류:', e);
  }
}

function cleanAddress(str) {
  if (!str) return '';
  return str
    .replace(/010-\d{4}-\d{4}/g, '')
    .replace(/01[0-9]-\d{3,4}-\d{4}/g, '')
    .replace(/[^\uAC00-\uD7A30-9a-zA-Z\s\-,]/g, '')
    .trim();
}

function groupByAddress(rows) {
  const header = rows[0] || [];
  const groups = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const [contact, addrRaw, note, deal, images] = row;
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
      images: images || '',
    });
  }
  return { header, groups };
}

async function mapMarkersFromGroups(groups) {
  markers.forEach((m) => m.setMap(null));
  markers = [];

  for (const [addr, listings] of groups.entries()) {
    await delay(200);
    geocoder.addressSearch(addr, (result, status) => {
      if (status === kakao.maps.services.Status.OK && result[0]) {
        const lat = result[0].y;
        const lng = result[0].x;
        const marker = new kakao.maps.Marker({
          map,
          position: new kakao.maps.LatLng(lat, lng),
        });
        markers.push(marker);

        kakao.maps.event.addListener(marker, 'click', () => {
          if (openInfoWindow) openInfoWindow.close();
          const html = buildInfoWindowContent(listings, lat, lng);
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

function buildInfoWindowContent(listings, lat, lng) {
  const removedSet = new Set(
    JSON.parse(localStorage.getItem(REMOVED_LOCAL_KEY) || '[]')
  );

  const itemsHtml = listings
    .map((item, idx) => {
      const id = encodeListingId(item);
      const isRemoved = removedSet.has(id);
      const imageUrls = parseImageUrls(item.images);
      return `
      <div class="listing-box" data-listing-id="${id}" style="${
        isRemoved ? 'opacity:0.5' : ''
      }">
        <div><strong>매물 ${idx + 1}</strong></div>
        <div style="font-size:13px;margin-top:6px;">
          📞 <a href="tel:${
            item.contact
          }" onclick="event.stopPropagation();" style="color:#007aff;text-decoration:none;">${
        item.contact || '연락처 없음'
      }</a><br>
          📍 ${escapeHtml(item.addrRaw)}<br>
          💬 ${escapeHtml(item.note)}<br>
          💰 ${escapeHtml(item.deal)}
        </div>
        <div class="listing-controls">
          <button class="btn btn-photo btn-small" data-images='${htmlAttrEncode(
            JSON.stringify(imageUrls)
          )}' data-listing-id="${id}">사진보기</button>
          <button class="btn btn-remove btn-small" data-listing-id="${id}">${
        isRemoved ? '이미 삭제' : '매물나감'
      }</button>
        </div>
      </div>
      `;
    })
    .join('');

  const safeAddr = encodeURIComponent(listings[0].addr);
  const webUrl = `https://map.kakao.com/link/to/${safeAddr},${lat},${lng}`;

  // InfoWindow 내부에서 동작하는 스크립트 포함 (이 스크립트는 같은 window에서 실행됩니다)
  return `
  <div style="padding:10px;min-width:240px;max-width:380px;">
    <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(
      listings[0].addr
    )}</div>
    <div style="margin-bottom:8px;">
      <button class="btn btn-small" id="openNavBtn">카카오내비로 길찾기</button>
    </div>
    <div id="listingsContainer">${itemsHtml}</div>
    <script>
      (function(){
        const lat = ${lat};
        const lng = ${lng};
        const webUrl = "${webUrl}";
        // openNav: try native via iframe, fallback to web
        document.getElementById('openNavBtn').addEventListener('click', function(e){
          e.stopPropagation();
          var iframe = document.createElement('iframe');
          iframe.style.display = 'none';
          iframe.src = 'kakaomap://route?sp=' + lat + ',' + lng + '&by=FOOT';
          document.body.appendChild(iframe);
          setTimeout(function(){
            window.open(webUrl,'_blank');
            try { document.body.removeChild(iframe); } catch(e){}
          }, 800);
        });

        // delegation for photo & remove
        const container = document.getElementById('listingsContainer');
        container.addEventListener('click', function(ev){
          ev.stopPropagation();
          const t = ev.target;
          if (t.matches('.btn-photo')) {
            const images = JSON.parse(t.getAttribute('data-images') || '[]');
            const listingId = t.getAttribute('data-listing-id');
            // let parent window handle open modal and merging uploaded images
            if (window && typeof openPhotoModalFromInfo === 'function') {
              openPhotoModalFromInfo(listingId, images);
            } else {
              // fallback: open basic modal with remote urls only
              window.alert('사진보기 준비 중');
            }
          } else if (t.matches('.btn-remove')) {
            const id = t.getAttribute('data-listing-id');
            if (!confirm('정말 이 매물을 "매물나감" 처리하시겠습니까?')) return;
            // localStorage mark
            try {
              const raw = localStorage.getItem('${REMOVED_LOCAL_KEY}');
              const arr = raw ? JSON.parse(raw) : [];
              if (!arr.includes(id)) arr.push(id);
              localStorage.setItem('${REMOVED_LOCAL_KEY}', JSON.stringify(arr));
              // update server (optional)
              fetch('/remove', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ listingId: id })})
                .then(r=>r.json()).then(j=>console.log('remove response', j)).catch(e=>console.warn(e));
              // visual effect
              const box = t.closest('.listing-box');
              if (box) box.style.opacity = 0.5;
              t.textContent = '이미 삭제';
            } catch(e) {
              console.error(e);
            }
          }
        });
      })();
    </script>
  </div>
  `;
}

// helper parse images
function parseImageUrls(imagesField) {
  if (!imagesField) return [];
  return imagesField
    .split(/;|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function encodeListingId(item) {
  const key = `${item.addr}|${item.contact}|${item.deal}|${item.rowIndex}`;
  return btoa(unescape(encodeURIComponent(key)));
}

function escapeHtml(s) {
  if (!s && s !== 0) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
function htmlAttrEncode(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

async function applySearch() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  if (!allRows || allRows.length < 2) return;
  let filteredRows = [allRows[0]];
  if (!q) {
    filteredRows = allRows;
  } else {
    for (let i = 1; i < allRows.length; i++) {
      const row = allRows[i];
      if (!row) continue;
      if (row.join(' ').toLowerCase().includes(q)) filteredRows.push(row);
    }
  }
  const { groups } = groupByAddress(filteredRows);
  mapMarkersFromGroups(groups);
}

function groupByAddress(rows) {
  const groups = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const [contact, addrRaw, note, deal, images] = row;
    if (!addrRaw) continue;
    let addr = cleanAddress(addrRaw);
    if (!/서울|경기|인천/.test(addr)) addr = `서울 ${addr}`;
    const key = addr.trim();
    if (!groups.has(key)) groups.set(key, []);
    groups
      .get(key)
      .push({
        rowIndex: i,
        contact: contact || '',
        addrRaw: addrRaw || '',
        addr: key,
        note: note || '',
        deal: deal || '',
        images: images || '',
      });
  }
  return { header: rows[0], groups };
}

async function mapMarkersFromGroups(groups) {
  markers.forEach((m) => m.setMap(null));
  markers = [];
  for (const [addr, listings] of groups.entries()) {
    await delay(200);
    geocoder.addressSearch(addr, (result, status) => {
      if (status === kakao.maps.services.Status.OK && result[0]) {
        const lat = result[0].y,
          lng = result[0].x;
        const marker = new kakao.maps.Marker({
          map,
          position: new kakao.maps.LatLng(lat, lng),
        });
        markers.push(marker);
        kakao.maps.event.addListener(marker, 'click', () => {
          if (openInfoWindow) openInfoWindow.close();
          const html = buildInfoWindowContent(listings, lat, lng);
          const infowindow = new kakao.maps.InfoWindow({
            content: html,
            removable: true,
          });
          infowindow.open(map, marker);
          openInfoWindow = infowindow;
        });
      }
    });
  }
}

// Photo modal & upload handling
function showPhotoModal() {
  document.getElementById('photoModalBackdrop').style.display = 'flex';
  document
    .getElementById('photoModalBackdrop')
    .setAttribute('aria-hidden', 'false');
}
function closePhotoModal() {
  document.getElementById('photoModalBackdrop').style.display = 'none';
  document
    .getElementById('photoModalBackdrop')
    .setAttribute('aria-hidden', 'true');
  document.getElementById('photoContainer').innerHTML = '';
  window.__currentModalListingId = null;
}

// entry point from infowindow: listingId + remoteUrls array
async function openPhotoModalFromInfo(listingId, remoteUrls) {
  window.__currentModalListingId = listingId;
  const container = document.getElementById('photoContainer');
  container.innerHTML = '';

  // 1) uploaded images from localStorage
  const key = UPLOADED_PHOTOS_KEY_PREFIX + listingId;
  const uploadedRaw = localStorage.getItem(key);
  const uploaded = uploadedRaw ? JSON.parse(uploadedRaw) : [];

  for (const u of uploaded) {
    const img = document.createElement('img');
    img.src = u.dataUrl || u;
    container.appendChild(img);
  }

  // 2) remote urls: try canvas compress (CORS). If fails, fallback to server proxy if available, otherwise just show as <img>
  for (const url of remoteUrls || []) {
    try {
      const compressed = await loadAndCompressImage(url, 1200, 0.75);
      const img = document.createElement('img');
      img.src = compressed;
      container.appendChild(img);
    } catch (err) {
      // try server proxy
      try {
        const proxyUrl = `/image-proxy?url=${encodeURIComponent(url)}&w=1200`;
        // test fetch
        const r = await fetch(proxyUrl);
        if (r.ok) {
          const blob = await r.blob();
          const objUrl = URL.createObjectURL(blob);
          const img = document.createElement('img');
          img.src = objUrl;
          container.appendChild(img);
        } else {
          const img = document.createElement('img');
          img.src = url;
          container.appendChild(img);
        }
      } catch (e) {
        const img = document.createElement('img');
        img.src = url;
        container.appendChild(img);
      }
    }
  }

  showPhotoModal();
}
window.openPhotoModalFromInfo = openPhotoModalFromInfo;

// utility: load remote image into canvas and return dataURL (may fail due to CORS)
function loadAndCompressImage(url, maxWidth = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        const ratio = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * ratio),
          h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = function (e) {
      reject(e);
    };
    img.src = url;
    if (img.complete) img.onload();
  });
}

function compressFileToDataUrl(file, maxWidth = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function (ev) {
      const img = new Image();
      img.onload = function () {
        const ratio = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * ratio),
          h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// init
window.onload = initMap;
