let map;
let markers = [];
let geocoder;
let openInfoWindow = null;
let userMarker = null; // 내 위치 마커 저장용

// 지도 초기화
function initMap() {
  const container = document.getElementById('map');
  const options = {
    center: new kakao.maps.LatLng(37.5665, 126.978), // 서울 중심
    level: 7,
  };
  map = new kakao.maps.Map(container, options);
  geocoder = new kakao.maps.services.Geocoder();

  // 지도 클릭 시 열린 창 닫기
  kakao.maps.event.addListener(map, 'click', function () {
    if (openInfoWindow) {
      openInfoWindow.close();
      openInfoWindow = null;
    }
  });

  // ✅ 내 위치 표시
  showUserLocation();

  // 매물 데이터 로드
  loadData();
}

// ✅ 사용자 현재 위치 마커 표시
function showUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const loc = new kakao.maps.LatLng(lat, lng);

        // 기존 위치 마커 제거
        if (userMarker) userMarker.setMap(null);

        // 새 마커 추가
        userMarker = new kakao.maps.Marker({
          position: loc,
          map: map,
          title: '내 위치',
          image: new kakao.maps.MarkerImage(
            'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png',
            new kakao.maps.Size(30, 45)
          ),
        });

        // 지도 중심 이동
        map.setCenter(loc);
      },
      (error) => {
        console.warn('❌ 위치 정보를 가져올 수 없습니다.', error);
      },
      { enableHighAccuracy: true }
    );
  } else {
    console.warn('❌ 이 브라우저는 위치 서비스를 지원하지 않습니다.');
  }
}

// 구글 스프레드시트 데이터 불러오기
async function loadData() {
  try {
    const res = await fetch('/data');
    const rows = await res.json();

    // 기존 마커 제거
    markers.forEach((m) => m.setMap(null));
    markers = [];

    // 첫 줄(헤더) 제외
    for (let i = 1; i < rows.length; i++) {
      const [연락처, 주소지, 가격, 특이사항] = rows[i];
      if (!주소지) continue;

      geocoder.addressSearch(주소지, function (result, status) {
        if (status === kakao.maps.services.Status.OK) {
          createMarker(result[0], 연락처, 주소지, 가격, 특이사항);
        } else {
          console.warn(`❌ 주소 인식 실패: ${주소지}`);
        }
      });
    }

    console.log('✅ 지도 업데이트 완료');
  } catch (err) {
    console.error('❌ 데이터 로드 오류:', err);
  }
}

// 마커 생성 함수
function createMarker(result, 연락처, 주소지, 가격, 특이사항) {
  const coords = new kakao.maps.LatLng(result.y, result.x);
  const marker = new kakao.maps.Marker({
    map: map,
    position: coords,
  });
  markers.push(marker);

  const infoContent = `
    <div style="
      padding:10px;
      min-width:230px;
      font-size:14px;
      line-height:1.6;
    ">
      📞 <a href="tel:${연락처}" style="color:#007aff;text-decoration:none;font-weight:bold;">
        ${연락처 || '연락처 없음'}
      </a><br>
      📍 ${주소지}<br>
      💰 ${가격 || '가격 미정'}<br>
      📝 ${특이사항 || ''}
    </div>
  `;
  const infowindow = new kakao.maps.InfoWindow({ content: infoContent });

  kakao.maps.event.addListener(marker, 'click', () => {
    if (openInfoWindow) openInfoWindow.close();
    infowindow.open(map, marker);
    openInfoWindow = infowindow;
  });
}

// 새로고침 버튼
document.getElementById('refresh').addEventListener('click', () => {
  loadData();
});

// 자동 새로고침 (30초마다)
setInterval(loadData, 30000);

// 페이지 로드시 지도 실행
window.onload = initMap;
