let map,
  geocoder,
  openInfowindow = null;

// ✅ 지도 초기화
function initMap() {
  const container = document.getElementById('map');
  const options = {
    center: new kakao.maps.LatLng(37.5665, 126.978),
    level: 7,
  };
  map = new kakao.maps.Map(container, options);
  geocoder = new kakao.maps.services.Geocoder();

  loadData();

  document.getElementById('regionFilter').addEventListener('change', loadData);
  document.getElementById('priceFilter').addEventListener('change', loadData);
  document.getElementById('searchBtn').addEventListener('click', handleSearch);
}

async function loadData() {
  try {
    const regionFilter = document.getElementById('regionFilter').value;
    const priceFilter = document.getElementById('priceFilter').value;

    const res = await fetch('/data');
    const rows = await res.json();
    mapMarkers(rows, regionFilter, priceFilter);
  } catch (e) {
    console.error('데이터 불러오기 오류:', e);
  }
}

// ✅ 지도에 마커 표시
function mapMarkers(rows, regionFilter, priceFilter) {
  map.setLevel(7);
  map.setCenter(new kakao.maps.LatLng(37.5665, 126.978));

  rows.slice(1).forEach(([지역, 주소, 가격, 연락처, 특이사항, 매물]) => {
    if (!주소 || !지역) return;
    if (regionFilter && !지역.includes(regionFilter)) return;
    if (
      priceFilter &&
      parseInt(가격.replace(/[^0-9]/g, '')) > parseInt(priceFilter)
    )
      return;

    searchAndMark(지역, 주소, 연락처, 특이사항, 매물, 가격);
  });
}

// ✅ 주소로 마커 생성
function searchAndMark(region, address, 연락처, 특이사항, 매물, 가격) {
  const fullAddress = address.includes(region)
    ? address
    : `${region} ${address}`;
  geocoder.addressSearch(fullAddress, (result, status) => {
    if (status === kakao.maps.services.Status.OK) {
      const coords = new kakao.maps.LatLng(result[0].y, result[0].x);
      const marker = new kakao.maps.Marker({ map, position: coords });
      const info = `
        <div style="padding:5px;">
          <b>${매물}</b><br>${fullAddress}<br>💰 ${가격}<br>📞 ${연락처}<br>${특이사항}
        </div>`;
      const infowindow = new kakao.maps.InfoWindow({ content: info });
      kakao.maps.event.addListener(marker, 'click', () => {
        if (openInfowindow) openInfowindow.close();
        infowindow.open(map, marker);
        openInfowindow = infowindow;
      });
    } else {
      console.warn(`주소 인식 실패: ${fullAddress}`);
    }
  });
}

// ✅ 검색 기능
function handleSearch() {
  const keyword = document.getElementById('searchInput').value.trim();
  if (!keyword) return alert('검색어를 입력하세요.');

  geocoder.addressSearch(keyword, (result, status) => {
    if (status === kakao.maps.services.Status.OK) {
      const coords = new kakao.maps.LatLng(result[0].y, result[0].x);
      map.setCenter(coords);
      new kakao.maps.Marker({ map, position: coords });
    } else {
      alert('주소를 찾을 수 없습니다.');
    }
  });
}

window.onload = initMap;
