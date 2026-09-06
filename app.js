(function(){
  /* ============================================================
     定数
     ============================================================ */
  const TAGS = [
    {id:'food', label:'ごはん', emoji:'🍜', color:'#c9622d'},
    {id:'cafe', label:'カフェ', emoji:'☕', color:'#8a5a3c'},
    {id:'sight', label:'観光', emoji:'🏞', color:'#3c6e52'},
    {id:'shop', label:'買い物', emoji:'🛍', color:'#a2557c'},
    {id:'stay', label:'宿', emoji:'🏨', color:'#3a5a78'},
    {id:'other', label:'その他', emoji:'✨', color:'#7a7267'},
  ];
  const LIST_COLORS = ['#3c6e52','#c08e2a','#a24936','#3a5a78','#6b5b95','#5a6377'];
  const LIST_EMOJIS = ['📔','✈️','🗺','🎒','🍽','🌊','🏔','🎡'];
  const tagMeta = id => TAGS.find(t=>t.id===id) || TAGS[5];

  /* ============================================================
     状態（アプリ全体の状態はここに集約。永続化はstorageセクション参照）
     ============================================================ */
  let lists = [];
  let places = [];
  let view = 'cover';
  let currentListId = null;

  let filterTag = null;
  let searchQuery = '';
  let isComposing = false;
  let coverSearchQuery = '';
  let placeModalOpen = false;
  let activeTab = 'name';
  let pickedTag = 'other';
  let editingPlaceId = null;
  let pinPickLatLng = null; // {lat,lng} 追加モーダルの地図でタップした座標
  let pendingFocusPlaceId = null; // 追加直後に位置が確定し次第フォーカスする場所のID

  let listModalOpen = false;
  let pickedColor = LIST_COLORS[0];
  let pickedEmoji = LIST_EMOJIS[0];
  let editingListId = null;
  let draftListName = '';

  let openListMenuId = null;
  let coverPerShelf = 4;
  let selectedPinId = null; // 地図下のパネルに詳細表示中の場所

  const app = document.getElementById('app');

  /* ============================================================
     ストレージ（localStorage。将来、実サービス化する際はここを
     サーバーAPI呼び出しに差し替える）
     ============================================================ */
  function load(){
    try{ lists = JSON.parse(localStorage.getItem('ikitai_lists') || '[]'); }catch(e){ lists = []; }
    try{ places = JSON.parse(localStorage.getItem('ikitai_places') || '[]'); }catch(e){ places = []; }
    if(lists.length===0){
      lists.push({id:'l'+Date.now(), name:'行きたい場所', emoji:'📔', color:LIST_COLORS[0], createdAt:Date.now()});
      persistLists();
    }
    render();
  }
  function persistLists(){ localStorage.setItem('ikitai_lists', JSON.stringify(lists)); }
  function persistPlaces(){ localStorage.setItem('ikitai_places', JSON.stringify(places)); }

  /* ============================================================
     Google Driveバックアップ（利用者自身のDriveに、このアプリが作った
     ファイルだけを保存/読み込みする。drive.fileスコープを使用）
     ============================================================ */
  const DRIVE_BACKUP_FILENAME = '行き先帖-backup.json';
  let driveTokenClient = null;
  let driveAccessToken = null;
  let driveAuthCallback = null; // ログイン完了時に呼ぶ、直近にリクエストされた処理

  function driveOAuthReady(){
    return !!(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_ID !== 'YOUR_OAUTH_CLIENT_ID_HERE');
  }

  function driveEnsureAuth(cb){
    if(!driveOAuthReady()){
      alert('Google Drive連携が未設定です。config.js の GOOGLE_OAUTH_CLIENT_ID を設定してください。');
      return;
    }
    if(!(window.google && google.accounts && google.accounts.oauth2)){
      alert('Googleログイン機能の読み込みに失敗しました。しばらくしてから再度お試しください。');
      return;
    }
    if(driveAccessToken){ cb(); return; }
    // トークンクライアントは使い回すが、ログイン後に呼ぶ処理は毎回この時点の cb に差し替える
    // （initTokenClient の callback に直接 cb を焼き込むと、2回目以降のクリックで
    //   最初にクリックしたボタンの処理が呼ばれてしまう不具合になるため）
    driveAuthCallback = cb;
    if(!driveTokenClient){
      driveTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (resp)=>{
          if(resp.error){ alert('Googleログインに失敗しました'); return; }
          driveAccessToken = resp.access_token;
          const fn = driveAuthCallback;
          driveAuthCallback = null;
          if(fn) fn();
        }
      });
    }
    driveTokenClient.requestAccessToken();
  }

  function driveApiFetch(url, options){
    options = options || {};
    options.headers = Object.assign({}, options.headers, { 'Authorization': 'Bearer ' + driveAccessToken });
    return fetch(url, options).then(res=>{
      if(res.status === 401){ driveAccessToken = null; throw new Error('認証の有効期限が切れました。もう一度お試しください。'); }
      return res;
    });
  }

  function driveFindBackupFileId(cb){
    const q = encodeURIComponent(`name='${DRIVE_BACKUP_FILENAME}' and trashed=false`);
    driveApiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`)
      .then(res=>res.json())
      .then(data=>cb((data.files && data.files[0] && data.files[0].id) || null))
      .catch(err=>{ alert(err.message || 'Google Driveとの通信に失敗しました'); });
  }

  function driveSaveBackup(){
    driveEnsureAuth(()=>{
      driveFindBackupFileId((fileId)=>{
        const content = JSON.stringify({ lists, places }, null, 2);
        const metadata = { name: DRIVE_BACKUP_FILENAME, mimeType: 'application/json' };
        const boundary = 'ikitai-backup-boundary';
        const body =
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
        const url = fileId
          ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
          : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
        driveApiFetch(url, {
          method: fileId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
          body
        }).then(res=>{
          if(!res.ok) throw new Error('Google Driveへの保存に失敗しました');
          alert('Google Driveにバックアップしました');
        }).catch(err=> alert(err.message || 'Google Driveへの保存に失敗しました'));
      });
    });
  }

  function driveLoadBackup(){
    driveEnsureAuth(()=>{
      driveFindBackupFileId((fileId)=>{
        if(!fileId){ alert('Google Drive内にバックアップが見つかりませんでした'); return; }
        driveApiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`)
          .then(res=>res.json())
          .then(data=>{
            if(!Array.isArray(data.lists) || !Array.isArray(data.places)) throw new Error('バックアップファイルの形式が正しくありません');
            if(!confirm('現在のデータを上書きしてGoogle Driveから復元します。この操作は元に戻せません。よろしいですか？')) return;
            lists = data.lists;
            places = data.places;
            persistLists(); persistPlaces();
            render();
          })
          .catch(err=> alert(err.message || 'Google Driveからの復元に失敗しました'));
      });
    });
  }

  /* ============================================================
     ユーティリティ
     ============================================================ */
  function extractNameFromUrl(url){
    try{
      const m = url.match(/\/maps\/place\/([^\/]+)/);
      if(m) return decodeURIComponent(m[1].replace(/\+/g,' '));
      const q = url.match(/[?&]q=([^&]+)/);
      if(q) return decodeURIComponent(q[1].replace(/\+/g,' '));
    }catch(e){}
    return '';
  }
  function searchLink(name, address){
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((name||'') + ' ' + (address||''));
  }
  function coordLink(lat,lng){
    return 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng;
  }
  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function placesInList(id){ return places.filter(p=>p.listId===id); }

  /* ============================================================
     カバー画面（本棚・ノート一覧）
     ============================================================ */
  function renderCover(){
    const q = coverSearchQuery.trim().toLowerCase();
    const filteredLists = q ? lists.filter(l=>l.name.toLowerCase().includes(q)) : lists;

    const menuTarget = lists.find(l=>l.id===openListMenuId);
    const popupHtml = menuTarget ? `<div class="list-popup">
      <button class="close-x" id="closeListMenu">✕</button>
      <h4>${menuTarget.emoji} ${escapeHtml(menuTarget.name)}</h4>
      <div class="row">
        <button data-editlist="${menuTarget.id}">✏️ 名前を編集</button>
        <button class="danger" data-dellist="${menuTarget.id}">🗑 削除</button>
      </div>
    </div>` : '';

    const items = filteredLists.map(l=>{
      const cnt = placesInList(l.id).length;
      return { id:l.id, html:`<div class="spine" data-open="${l.id}" style="background:${l.color}">
        <button class="spine-menu" data-listmenu="${l.id}" title="メニュー">⋮</button>
        <div class="spine-emoji">${l.emoji}</div>
        <div class="spine-name">${escapeHtml(l.name)}</div>
        <div class="spine-count">${cnt}件</div>
      </div>` };
    });
    if(!q) items.push({ id:'__add__', html:`<div class="spine addnew" id="openListModal"><div class="plus">＋</div></div>` });

    const perShelf = coverPerShelf;
    let shelvesHtml = '';
    for(let i=0; i<items.length; i+=perShelf){
      const chunk = items.slice(i, i+perShelf);
      shelvesHtml += `<div class="shelf-row">${chunk.map(it=>it.html).join('')}</div><div class="shelf-board"></div>`;
      if(chunk.some(it=>it.id===openListMenuId)) shelvesHtml += popupHtml;
    }
    if(items.length===0){
      shelvesHtml = `<div class="empty-state">「${escapeHtml(coverSearchQuery)}」に一致するノートがありません</div>`;
    }

    return `
      <div class="eyebrow">TRAVEL PIN NOTE</div>
      <h1>行き先帖</h1>
      <div class="sub">行き先やテーマごとにノートを分けて、気になる場所をコレクションしよう</div>
      <div class="toolbar">
        <button class="addbtn" id="openListModal2">＋ 新しく追加する</button>
        <div class="search-wrap">
          <span class="icon">🔍</span>
          <input class="searchbox" id="coverSearchbox" placeholder="本を検索" value="${escapeHtml(coverSearchQuery)}">
        </div>
      </div>
      <div class="text-link-row">
        <button class="text-link" id="driveSaveBtn">☁️ Google Driveにバックアップ</button>
        <button class="text-link" id="driveLoadBtn">☁️ Google Driveから復元</button>
      </div>
      <div class="bookshelf">${shelvesHtml}</div>
      ${renderListModal()}
    `;
  }

  function renderListModal(){
    if(!listModalOpen) return '';
    const editing = lists.find(l=>l.id===editingListId);
    return `<div class="overlay" id="listOverlay">
      <div class="modal">
        <h2>${editing ? 'ノートを編集' : '新しいノートを作る'}</h2>
        <label>ノート名</label>
        <input type="text" id="l-name" placeholder="例）沖縄旅行 / デート先 / カフェ巡り" value="${escapeHtml(draftListName)}">
        <label>アイコン</label>
        <div class="emoji-pick">
          ${LIST_EMOJIS.map(e=>`<button type="button" class="emoji-opt ${e===pickedEmoji?'active':''}" data-emoji="${e}">${e}</button>`).join('')}
        </div>
        <label>カラー</label>
        <div class="color-pick">
          ${LIST_COLORS.map(c=>`<button type="button" class="color-opt ${c===pickedColor?'active':''}" data-color="${c}" style="background:${c}"></button>`).join('')}
        </div>
        <div class="save-row">
          <button class="btn-ghost" id="listCancelBtn">キャンセル</button>
          <button class="btn-primary" id="listSaveBtn">${editing ? '保存する' : '作成する'}</button>
        </div>
      </div>
    </div>`;
  }

  /* ============================================================
     詳細画面・地図（Google Maps）
     ============================================================ */
  let gmap = null;              // google.maps.Map インスタンス（使い回す）
  let geocoder = null;          // google.maps.Geocoder インスタンス
  let markers = [];             // gmap上の現在のマーカー
  const mapDiv = document.createElement('div');
  mapDiv.id = 'mapCanvas';

  let showCurrentLocation = false;   // 現在地表示トグルのON/OFF
  let geoWatchId = null;             // navigator.geolocation.watchPosition のID
  let currentLocationMarker = null;  // 現在地を示すマーカー（場所ピンとは別管理）

  function mapsReady(){ return typeof google !== 'undefined' && google.maps; }

  function mountMainMap(){
    const wrap = document.getElementById('mapWrap');
    if(!wrap) return;
    if(!mapsReady()){
      wrap.innerHTML = `<div class="board-empty">Google Maps APIキーが未設定、または読み込みに失敗しています。<br>config.js の GOOGLE_MAPS_API_KEY を設定してください。</div>`;
      return;
    }
    if(mapDiv.parentElement !== wrap){ wrap.appendChild(mapDiv); }
    if(!gmap){
      gmap = new google.maps.Map(mapDiv, { center:{lat:35.681236,lng:139.767125}, zoom:5, streetViewControl:false, mapTypeControl:false, fullscreenControl:false, gestureHandling:'greedy' });
      gmap.addListener('click', (e)=>{
        if(e.placeId){
          e.stop(); // Google純正のPOI情報ウィンドウを抑制
          openAddPlaceFromPOI(e.placeId, e.latLng);
        }
      });
    } else {
      google.maps.event.trigger(gmap, 'resize');
    }
    refreshMarkers();
  }

  function clearMarkers(){
    markers.forEach(m=>m.setMap(null));
    markers = [];
  }

  // メイン地図上の実際のお店・施設（POI）をタップした時に、その場所を「地図でピン」タブの状態で追加する
  function openAddPlaceFromPOI(placeId, latLng){
    pinPickLatLng = { lat: latLng.lat(), lng: latLng.lng() };
    placeModalOpen = true;
    activeTab = 'pin';
    pickedTag = 'other';
    editingPlaceId = null;
    render();

    if(!(google.maps.places && google.maps.places.PlacesService)) return;
    const service = new google.maps.places.PlacesService(gmap);
    service.getDetails({ placeId, fields: ['name'] }, (result, status)=>{
      const nm = (status === google.maps.places.PlacesServiceStatus.OK && result) ? result.name : null;
      if(!nm) return;
      const nameInput = document.getElementById('f-name');
      if(nameInput){ nameInput.value = nm; nameInput.dataset.touched = '1'; }
      const hint = document.getElementById('pinPickHint');
      if(hint) hint.textContent = `📍 ${nm} を選択しました`;
    });
  }

  function refreshMarkers(){
    if(!gmap) return;
    clearMarkers();
    const list = placesInList(currentListId);
    const bounds = new google.maps.LatLngBounds();
    let any = false;

    list.forEach(p=>{
      if(typeof p.lat === 'number' && typeof p.lng === 'number'){
        addMarkerForPlace(p);
        bounds.extend({lat:p.lat, lng:p.lng});
        any = true;
      } else {
        // 座標未取得ならジオコーディングしてから追加
        geocodeAndAttach(p);
      }
    });

    if(any){
      if(list.filter(p=>typeof p.lat==='number').length === 1){
        gmap.setCenter(bounds.getCenter()); gmap.setZoom(14);
      } else {
        gmap.fitBounds(bounds, 60);
      }
    }

    if(pendingFocusPlaceId){
      const pending = places.find(x=>x.id===pendingFocusPlaceId);
      if(pending && typeof pending.lat === 'number'){
        const id = pendingFocusPlaceId;
        pendingFocusPlaceId = null;
        focusPlaceOnMap(id);
      }
    }
  }

  function geocodeAndAttach(p){
    if(!geocoder || !mapsReady() || !p.query) return;
    geocoder.geocode({ address: p.query }, (results, status)=>{
      if(status === 'OK' && results[0]){
        p.lat = results[0].geometry.location.lat();
        p.lng = results[0].geometry.location.lng();
        persistPlaces();
        // 現在も同じノートを表示中なら地図に反映
        if(view==='detail' && currentListId===p.listId && gmap){
          addMarkerForPlace(p);
          if(pendingFocusPlaceId === p.id){
            pendingFocusPlaceId = null;
            focusPlaceOnMap(p.id);
          } else {
            gmap.setCenter({lat:p.lat,lng:p.lng});
          }
        }
      }
    });
  }

  function addMarkerForPlace(p){
    const meta = tagMeta(p.tag);
    const marker = new google.maps.Marker({
      position: {lat:p.lat, lng:p.lng},
      map: gmap,
      title: p.name,
      opacity: p.visited ? 0.55 : 1,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 15,
        fillColor: '#ffffff',
        fillOpacity: 1,
        strokeColor: meta.color,
        strokeWeight: 3
      },
      label: { text: meta.emoji, fontSize:'14px' }
    });
    marker.placeId = p.id;
    marker.addListener('click', ()=> selectPin(p.id));
    markers.push(marker);
    return marker;
  }

  function focusPlaceOnMap(id){
    const p = places.find(x=>x.id===id);
    if(!p || typeof p.lat !== 'number' || !gmap) return;
    gmap.panTo({lat:p.lat, lng:p.lng});
    gmap.setZoom(Math.max(gmap.getZoom(), 16));
    selectPin(id);
    const wrap = document.querySelector('.board-wrap');
    if(wrap) wrap.scrollIntoView({behavior:'smooth', block:'center'});
  }

  function toggleCurrentLocation(){
    showCurrentLocation = !showCurrentLocation;
    if(showCurrentLocation){ startWatchingLocation(); } else { stopWatchingLocation(); }
    render();
  }

  function startWatchingLocation(){
    if(!navigator.geolocation){
      alert('この端末・ブラウザでは位置情報が利用できません');
      showCurrentLocation = false;
      return;
    }
    geoWatchId = navigator.geolocation.watchPosition(
      (pos)=>{
        if(!mapsReady() || !gmap) return;
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if(currentLocationMarker){
          currentLocationMarker.setPosition(loc);
        } else {
          currentLocationMarker = new google.maps.Marker({
            position: loc,
            map: gmap,
            title: '現在地',
            zIndex: 999,
            icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor:'#4285F4', fillOpacity:1, strokeColor:'#ffffff', strokeWeight:2 }
          });
        }
      },
      ()=>{
        alert('現在地を取得できませんでした。位置情報の利用を許可してください。');
        showCurrentLocation = false;
        stopWatchingLocation();
        render();
      },
      { enableHighAccuracy:true }
    );
  }

  function stopWatchingLocation(){
    if(geoWatchId !== null){ navigator.geolocation.clearWatch(geoWatchId); geoWatchId = null; }
    if(currentLocationMarker){ currentLocationMarker.setMap(null); currentLocationMarker = null; }
  }

  /* ============================================================
     ピン詳細パネル（地図の下の枠。マップ全体は再描画せず枠だけ差し替える）
     ============================================================ */
  function selectPin(id){
    selectedPinId = id;
    updatePinPanel();
  }

  function renderPinDetail(){
    const p = places.find(x=>x.id===selectedPinId && x.listId===currentListId);
    if(!p){
      return `<div class="board-hint">📍 ピンをタップすると、その場所の詳細がここに表示されます</div>`;
    }
    const meta = tagMeta(p.tag);
    return `<div class="iw-card pin-detail">
      <button class="iw-close" id="pinDetailClose" aria-label="閉じる">✕</button>
      <div class="iw-tagline">${meta.emoji} ${meta.label}</div>
      <h4>${escapeHtml(p.name)}</h4>
      ${p.memo ? `<p>${escapeHtml(p.memo)}</p>` : ''}
      <div class="iw-row">
        <button data-visit="${p.id}">${p.visited?'↩︎ 未訪問に戻す':'✅ 行った'}</button>
        <button data-editplace="${p.id}">✏️ 編集</button>
        <a href="${p.link}" target="_blank" rel="noopener">📍 開く ↗</a>
      </div>
    </div>`;
  }

  function updatePinPanel(){
    const el = document.getElementById('pinPanel');
    if(!el) return;
    el.innerHTML = renderPinDetail();
    bindPinPanelEvents(el);
  }

  function bindPinPanelEvents(el){
    const closeBtn = el.querySelector('#pinDetailClose');
    if(closeBtn) closeBtn.onclick = ()=>{ selectedPinId = null; updatePinPanel(); };
    const visitBtn = el.querySelector('[data-visit]');
    if(visitBtn) visitBtn.onclick = ()=>{ const p = places.find(x=>x.id===visitBtn.dataset.visit); if(p){ p.visited=!p.visited; persistPlaces(); render(); } };
    const editBtn = el.querySelector('[data-editplace]');
    if(editBtn) editBtn.onclick = ()=>{ openEditPlaceModal(editBtn.dataset.editplace); };
  }

  function openEditPlaceModal(id){
    const p = places.find(x=>x.id===id);
    if(!p) return;
    editingPlaceId = p.id;
    pickedTag = p.tag;
    activeTab = 'name';
    placeModalOpen = true;
    render();
  }

  /* ============================================================
     場所カード一覧
     ============================================================ */
  function filteredPlaces(){
    return placesInList(currentListId).filter(p=>{
      if(filterTag && p.tag !== filterTag) return false;
      if(searchQuery && !(p.name+p.memo).toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    }).sort((a,b)=> b.addedAt - a.addedAt);
  }

  function renderCards(){
    const list = filteredPlaces();
    if(list.length===0){
      return `<div class="empty-state">${placesInList(currentListId).length===0 ? '最初の1件を追加してみましょう 🗺' : '条件に合う場所がありません'}</div>`;
    }
    return `<div class="grid">` + list.map(p=>{
      const meta = tagMeta(p.tag);
      return `<div class="card" data-card="${p.id}" style="cursor:pointer;">
        ${p.visited ? `<div class="stamp">VISITED<br>済</div>` : ''}
        <div class="card-top">
          <div>
            <div class="tagline">${meta.emoji} ${meta.label}</div>
            <h3>${escapeHtml(p.name)}</h3>
          </div>
        </div>
        ${p.memo ? `<p class="memo">${escapeHtml(p.memo)}</p>` : ''}
        <div class="card-actions">
          <a class="pill-link" href="${p.link}" target="_blank" rel="noopener">📍 Googleマップで開く ↗</a>
          <button class="icon-btn ${p.visited?'on':''}" data-visit="${p.id}" title="行った/行きたいを切替">${p.visited?'↩︎ 未訪問に戻す':'✅ 行った'}</button>
          <button class="icon-btn" data-editplace="${p.id}" title="編集">✏️</button>
          <button class="icon-btn danger" data-del="${p.id}" title="削除">🗑</button>
        </div>
      </div>`;
    }).join('') + `</div>`;
  }

  function renderTagFilter(){
    return `<div class="tags-filter">
      <button class="chip ${filterTag===null?'active':''}" data-filter="">すべて</button>
      ${TAGS.map(t=>`<button class="chip ${filterTag===t.id?'active':''}" data-filter="${t.id}" style="--chip-color:${t.color}">${t.emoji} ${t.label}</button>`).join('')}
    </div>`;
  }

  /* ============================================================
     場所の追加・編集モーダル
     ============================================================ */
  function renderPlaceModal(){
    if(!placeModalOpen) return '';
    const editing = places.find(p=>p.id===editingPlaceId);
    return `<div class="overlay" id="overlay">
      <div class="modal">
        <h2>${editing ? '場所を編集' : '行きたい場所を追加'}</h2>
        ${editing ? '' : `
        <div class="tabs">
          <div class="tab ${activeTab==='name'?'active':''}" data-tab="name">名前・住所で追加</div>
          <div class="tab ${activeTab==='link'?'active':''}" data-tab="link">リンクで追加</div>
          <div class="tab ${activeTab==='pin'?'active':''}" data-tab="pin">地図でピン</div>
        </div>`}
        ${editing ? renderEditBody(editing) : renderTabBody()}
        <div class="save-row">
          <button class="btn-ghost" id="cancelBtn">キャンセル</button>
          <button class="btn-primary" id="saveBtn">保存する</button>
        </div>
      </div>
    </div>`;
  }

  function renderEditBody(p){
    const tagOptions = `<div class="tagpick">${TAGS.map(t=>`<button type="button" class="chip tag-opt" data-tagopt="${t.id}" style="--chip-color:${t.color}">${t.emoji} ${t.label}</button>`).join('')}</div>`;
    const locTab = activeTab==='link' ? 'link' : 'name';
    return `
      <label>場所の名前</label>
      <input type="text" id="f-name" value="${escapeHtml(p.name)}" placeholder="例）〇〇食堂">
      <label>メモ</label>
      <textarea id="f-memo" placeholder="友達がおすすめしてた、誕生日に行きたい など">${escapeHtml(p.memo)}</textarea>
      <label>カテゴリ</label>
      ${tagOptions}
      <label>地図上の位置を変更する場合</label>
      <div class="tabs">
        <div class="tab ${locTab==='name'?'active':''}" data-tab="name">名前・住所で変更</div>
        <div class="tab ${locTab==='link'?'active':''}" data-tab="link">リンクで変更</div>
      </div>
      ${locTab==='link' ? `
        <input type="text" id="f-link" placeholder="https://maps.google.com/...">
      ` : `
        <input type="text" id="f-query" placeholder="例）東京タワー / 渋谷区 / 東京都〇〇市">
      `}
      <div class="hint">空欄のままなら、今の位置は変わりません</div>
    `;
  }

  function renderTabBody(){
    const tagOptions = `<div class="tagpick">${TAGS.map(t=>`<button type="button" class="chip tag-opt" data-tagopt="${t.id}" style="--chip-color:${t.color}">${t.emoji} ${t.label}</button>`).join('')}</div>`;
    if(activeTab==='name'){
      return `
        <label>場所の名前</label>
        <input type="text" id="f-name" placeholder="例）〇〇食堂">
        <div class="hint">カードに表示される名前です（地図の検索には使われません）</div>
        <label>名前・住所・エリア</label>
        <input type="text" id="f-query" placeholder="例）東京タワー / 渋谷区 / 東京都〇〇市">
        <div class="hint">地図上の位置を調べるための検索語です。実際の店名や住所を入力してください</div>
        <label>メモ</label>
        <textarea id="f-memo" placeholder="友達がおすすめしてた、誕生日に行きたい など"></textarea>
        <label>カテゴリ</label>
        ${tagOptions}
      `;
    }
    if(activeTab==='link'){
      return `
        <label>Googleマップのリンク</label>
        <input type="text" id="f-link" placeholder="https://maps.google.com/... または g.co/... のリンクを貼付け">
        <div class="hint">地図上の位置はこのリンクから取得されます</div>
        <label>場所の名前</label>
        <input type="text" id="f-name" placeholder="例）〇〇食堂">
        <div class="hint">貼り付けると自動入力されます。カードに表示される名前なので自由に書き換えられます</div>
        <label>メモ</label>
        <textarea id="f-memo" placeholder="友達がおすすめしてた、誕生日に行きたい など"></textarea>
        <label>カテゴリ</label>
        ${tagOptions}
      `;
    }
    // pin タブ：本物の地図をタップして正確な位置にピンを置く
    return `
      <label>地図をタップしてピン留め</label>
      <div class="pin-search-row">
        <div class="search-wrap">
          <span class="icon">🔍</span>
          <input class="searchbox" id="pinAreaSearch" placeholder="エリアを検索（例：渋谷駅）">
        </div>
        <button type="button" id="pinAreaSearchBtn">移動</button>
      </div>
      <div id="pinPickMap"></div>
      <div class="hint" id="pinPickHint">${pinPickLatLng ? '📍 位置を設定しました' : '地図をタップすると、その場所にピンが立ちます'}</div>
      <label>場所の名前</label>
      <input type="text" id="f-name" placeholder="例）〇〇食堂">
      <label>メモ</label>
      <textarea id="f-memo" placeholder="友達がおすすめしてた、誕生日に行きたい など"></textarea>
      <label>カテゴリ</label>
      ${tagOptions}
    `;
  }

  let pinPickMap = null;
  let pinPickMarker = null;

  // 地図上の実際のお店・施設（POI）をタップした時に、その場所の名前を取得してピン留めする
  function applyPinFromPlaceId(placeId, latLng){
    pinPickLatLng = { lat: latLng.lat(), lng: latLng.lng() };
    if(pinPickMarker){ pinPickMarker.setPosition(pinPickLatLng); }
    else { pinPickMarker = new google.maps.Marker({ position: pinPickLatLng, map: pinPickMap }); }

    const hint = document.getElementById('pinPickHint');
    if(hint) hint.textContent = '📍 お店の情報を取得中…';

    if(!(google.maps.places && google.maps.places.PlacesService)){
      if(hint) hint.textContent = '📍 位置を設定しました';
      return;
    }
    const service = new google.maps.places.PlacesService(pinPickMap);
    service.getDetails({ placeId, fields: ['name'] }, (result, status)=>{
      const nm = (status === google.maps.places.PlacesServiceStatus.OK && result) ? result.name : null;
      const hintEl = document.getElementById('pinPickHint');
      if(hintEl) hintEl.textContent = nm ? `📍 ${nm} を選択しました` : '📍 位置を設定しました';
      const nameInput = document.getElementById('f-name');
      if(nm && nameInput && !nameInput.dataset.touched){ nameInput.value = nm; }
    });
  }

  function mountPinPickMap(){
    const el = document.getElementById('pinPickMap');
    if(!el || !mapsReady()) return;
    pinPickMap = new google.maps.Map(el, {
      center: pinPickLatLng || {lat:35.681236,lng:139.767125},
      zoom: pinPickLatLng ? 15 : 12,
      streetViewControl:false, mapTypeControl:false, fullscreenControl:false, gestureHandling:'greedy'
    });
    if(pinPickLatLng){
      pinPickMarker = new google.maps.Marker({ position: pinPickLatLng, map: pinPickMap });
    }
    pinPickMap.addListener('click', (e)=>{
      if(e.placeId){
        e.stop(); // Google純正のPOI情報ウィンドウを抑制
        applyPinFromPlaceId(e.placeId, e.latLng);
        return;
      }
      pinPickLatLng = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      if(pinPickMarker){ pinPickMarker.setPosition(pinPickLatLng); }
      else { pinPickMarker = new google.maps.Marker({ position: pinPickLatLng, map: pinPickMap }); }
      const hint = document.getElementById('pinPickHint');
      if(hint) hint.textContent = '📍 位置を設定しました';
    });

    // エリア名で検索して地図を移動できるようにする（ピンの設置自体はタップで行う）
    const searchInput = document.getElementById('pinAreaSearch');
    const searchBtn = document.getElementById('pinAreaSearchBtn');
    const runAreaSearch = ()=>{
      const text = (searchInput.value||'').trim();
      if(!text || !geocoder) return;
      geocoder.geocode({ address: text }, (results, status)=>{
        if(status === 'OK' && results[0]){
          pinPickMap.setCenter(results[0].geometry.location);
          pinPickMap.setZoom(15);
        }
      });
    };
    if(searchBtn) searchBtn.onclick = runAreaSearch;
    if(searchInput) searchInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !e.isComposing){ e.preventDefault(); runAreaSearch(); } });
  }

  function renderDetail(){
    const list = lists.find(l=>l.id===currentListId) || {id:'', name:'', emoji:''};
    const hasPlaces = placesInList(currentListId).length > 0;
    const keyMissing = !GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === 'YOUR_API_KEY_HERE';
    return `
      <button class="backlink" id="backBtn">← 本棚に戻る</button>
      <div class="eyebrow">TRAVEL PIN NOTE</div>
      <h1>${list.emoji} ${escapeHtml(list.name)} <button class="title-edit" data-editlist="${list.id}" title="ノート名を編集">✏️</button></h1>
      <div class="sub">気になった場所を、リンク・検索・ピンで気軽に保存する自分だけの地図</div>
      ${keyMissing ? `<div class="map-key-warning">⚠️ Google Maps APIキーが未設定です。config.js の GOOGLE_MAPS_API_KEY に有効なキーを設定すると、ここに実際の地図が表示されます。</div>` : ''}
      ${hasPlaces ? `<div class="map-controls"><button class="pill-btn ${showCurrentLocation?'on':''}" id="locateToggle">📍 現在地を表示</button></div>` : ''}
      <div class="board-wrap"><div id="mapWrap">${!hasPlaces ? '<div class="board-empty">まだ場所がありません。<br>下の「＋ 場所を追加」から登録してみましょう</div>' : ''}</div></div>
      ${hasPlaces ? `<div id="pinPanel">${renderPinDetail()}</div>` : ''}
      <div class="toolbar">
        <button class="addbtn" id="openAdd">＋ 場所を追加</button>
        <div class="search-wrap">
          <span class="icon">🔍</span>
          <input class="searchbox" id="searchbox" placeholder="保存した場所を検索" value="${escapeHtml(searchQuery)}">
        </div>
      </div>
      <div class="text-link-row">
        <button class="text-link" id="driveSaveBtnDetail">☁️ Google Driveにバックアップ</button>
      </div>
      ${renderTagFilter()}
      ${renderCards()}
      ${renderPlaceModal()}
      ${renderListModal()}
    `;
  }

  function renderFooter(){
    return `<footer class="app-footer">© ${new Date().getFullYear()} 行き先帖</footer>`;
  }

  /* ============================================================
     メインレンダリング
     ============================================================ */
  function render(){
    app.innerHTML = (view==='cover' ? renderCover() : renderDetail()) + renderFooter();
    bindEvents();
    if(view==='cover') requestAnimationFrame(adjustCoverShelf);
    if(view==='detail') requestAnimationFrame(()=>{
      const hasPlaces = placesInList(currentListId).length > 0;
      if(hasPlaces) mountMainMap();
      if(placeModalOpen && activeTab==='pin' && !editingPlaceId) mountPinPickMap();
    });
  }

  function adjustCoverShelf(){
    const bs = document.querySelector('.bookshelf');
    if(!bs || bs.clientWidth===0) return;
    const SPINE_W = 52, GAP = 9, ROW_PADDING = 4;
    const usable = bs.clientWidth - ROW_PADDING;
    let n = Math.floor((usable + GAP) / (SPINE_W + GAP));
    n = Math.max(2, n);
    if(n !== coverPerShelf){ coverPerShelf = n; render(); }
  }
  window.addEventListener('resize', ()=>{ if(view==='cover') adjustCoverShelf(); });

  /* ============================================================
     イベントバインディング
     ============================================================ */
  function bindListModalEvents(){
    document.querySelectorAll('[data-editlist]').forEach(el=>{
      el.onclick = (e)=>{
        e.stopPropagation();
        const target = lists.find(l=>l.id===el.dataset.editlist);
        if(!target) return;
        editingListId = target.id; pickedColor = target.color; pickedEmoji = target.emoji; draftListName = target.name;
        openListMenuId = null;
        listModalOpen = true; render();
      };
    });
    const listOverlay = document.getElementById('listOverlay');
    if(listOverlay) listOverlay.addEventListener('mousedown', (e)=>{ if(e.target===listOverlay){ listModalOpen=false; editingListId=null; render(); } });
    const lNameInput = document.getElementById('l-name');
    if(lNameInput) lNameInput.oninput = (e)=>{ draftListName = e.target.value; };
    const listCancelBtn = document.getElementById('listCancelBtn');
    if(listCancelBtn) listCancelBtn.onclick = ()=>{ listModalOpen=false; editingListId=null; render(); };
    document.querySelectorAll('.emoji-opt').forEach(el=>{ el.onclick = ()=>{ const ni=document.getElementById('l-name'); if(ni) draftListName=ni.value; pickedEmoji = el.dataset.emoji; render(); listModalOpen=true; }; });
    document.querySelectorAll('.color-opt').forEach(el=>{ el.onclick = ()=>{ const ni=document.getElementById('l-name'); if(ni) draftListName=ni.value; pickedColor = el.dataset.color; render(); listModalOpen=true; }; });
    const listSaveBtn = document.getElementById('listSaveBtn');
    if(listSaveBtn) listSaveBtn.onclick = ()=>{
      const name = (document.getElementById('l-name')||{}).value?.trim();
      if(!name){ alert('ノート名を入力してください'); return; }
      if(editingListId){
        const target = lists.find(l=>l.id===editingListId);
        if(target){ target.name = name; target.emoji = pickedEmoji; target.color = pickedColor; }
      } else {
        lists.push({id:'l'+Date.now()+Math.floor(Math.random()*1000), name, emoji:pickedEmoji, color:pickedColor, createdAt:Date.now()});
      }
      persistLists(); listModalOpen = false; editingListId = null; render();
    };
  }

  function bindEvents(){
    bindListModalEvents();
    if(view==='cover'){
      document.querySelectorAll('[data-open]').forEach(el=>{
        el.onclick = (e)=>{
          if(e.target.closest('[data-dellist],[data-editlist],[data-listmenu]')) return;
          currentListId = el.dataset.open;
          view = 'detail'; filterTag=null; searchQuery=''; selectedPinId=null; coverSearchQuery=''; render();
        };
      });
      document.querySelectorAll('[data-listmenu]').forEach(el=>{
        el.onclick = (e)=>{ e.stopPropagation(); const id = el.dataset.listmenu; openListMenuId = (openListMenuId===id) ? null : id; render(); };
      });
      const closeListMenu = document.getElementById('closeListMenu');
      if(closeListMenu) closeListMenu.onclick = ()=>{ openListMenuId = null; render(); };
      document.querySelectorAll('[data-dellist]').forEach(el=>{
        el.onclick = (e)=>{
          e.stopPropagation();
          if(!confirm('このノートと中の場所をすべて削除しますか？')) return;
          const id = el.dataset.dellist;
          lists = lists.filter(l=>l.id!==id);
          places = places.filter(p=>p.listId!==id);
          openListMenuId = null;
          persistLists(); persistPlaces(); render();
        };
      });
      const openListModal = document.getElementById('openListModal');
      const openListModal2 = document.getElementById('openListModal2');
      const openListModalHandler = ()=>{ listModalOpen=true; editingListId=null; openListMenuId=null; draftListName=''; pickedColor=LIST_COLORS[0]; pickedEmoji=LIST_EMOJIS[0]; render(); };
      if(openListModal) openListModal.onclick = openListModalHandler;
      if(openListModal2) openListModal2.onclick = openListModalHandler;

      const coverSearchbox = document.getElementById('coverSearchbox');
      if(coverSearchbox){
        coverSearchbox.addEventListener('compositionstart', ()=>{ isComposing = true; });
        coverSearchbox.addEventListener('compositionend', (e)=>{
          isComposing = false; coverSearchQuery = e.target.value; render();
          const s = document.getElementById('coverSearchbox'); if(s){ s.focus(); s.selectionStart = s.selectionEnd = s.value.length; }
        });
        coverSearchbox.oninput = (e)=>{
          if(isComposing) return;
          coverSearchQuery = e.target.value; render();
          const s = document.getElementById('coverSearchbox'); if(s){ s.focus(); s.selectionStart = s.selectionEnd = s.value.length; }
        };
      }

      const driveSaveBtn = document.getElementById('driveSaveBtn');
      if(driveSaveBtn) driveSaveBtn.onclick = driveSaveBackup;
      const driveLoadBtn = document.getElementById('driveLoadBtn');
      if(driveLoadBtn) driveLoadBtn.onclick = driveLoadBackup;
      return;
    }

    // ---- detail view events ----
    const backBtn = document.getElementById('backBtn');
    if(backBtn) backBtn.onclick = ()=>{ view='cover'; render(); };

    const openAdd = document.getElementById('openAdd');
    if(openAdd) openAdd.onclick = ()=>{ placeModalOpen=true; activeTab='name'; pinPickLatLng=null; pickedTag='other'; editingPlaceId=null; render(); };

    const locateToggle = document.getElementById('locateToggle');
    if(locateToggle) locateToggle.onclick = toggleCurrentLocation;

    const driveSaveBtnDetail = document.getElementById('driveSaveBtnDetail');
    if(driveSaveBtnDetail) driveSaveBtnDetail.onclick = driveSaveBackup;

    const searchbox = document.getElementById('searchbox');
    if(searchbox){
      searchbox.addEventListener('compositionstart', ()=>{ isComposing = true; });
      searchbox.addEventListener('compositionend', (e)=>{
        isComposing = false; searchQuery = e.target.value; render();
        const s = document.getElementById('searchbox'); if(s){ s.focus(); s.selectionStart = s.selectionEnd = s.value.length; }
      });
      searchbox.oninput = (e)=>{
        if(isComposing) return;
        searchQuery = e.target.value; render();
        const s = document.getElementById('searchbox'); if(s){ s.focus(); s.selectionStart = s.selectionEnd = s.value.length; }
      };
    }

    document.querySelectorAll('[data-filter]').forEach(el=>{ el.onclick = ()=>{ filterTag = el.dataset.filter || null; render(); }; });

    document.querySelectorAll('[data-visit]').forEach(el=>{
      el.onclick = ()=>{ const p = places.find(x=>x.id===el.dataset.visit); if(p){ p.visited=!p.visited; persistPlaces(); render(); } };
    });
    document.querySelectorAll('[data-del]').forEach(el=>{
      el.onclick = ()=>{ places = places.filter(x=>x.id!==el.dataset.del); persistPlaces(); render(); };
    });
    document.querySelectorAll('[data-editplace]').forEach(el=>{
      el.onclick = ()=>{ openEditPlaceModal(el.dataset.editplace); };
    });
    document.querySelectorAll('[data-card]').forEach(el=>{
      el.onclick = (e)=>{ if(e.target.closest('.card-actions')) return; focusPlaceOnMap(el.dataset.card); };
    });
    const pinDetailClose = document.getElementById('pinDetailClose');
    if(pinDetailClose) pinDetailClose.onclick = ()=>{ selectedPinId = null; updatePinPanel(); };

    const overlay = document.getElementById('overlay');
    if(overlay) overlay.addEventListener('mousedown', (e)=>{ if(e.target===overlay){ placeModalOpen=false; editingPlaceId=null; render(); } });
    const cancelBtn = document.getElementById('cancelBtn');
    if(cancelBtn) cancelBtn.onclick = ()=>{ placeModalOpen=false; editingPlaceId=null; render(); };

    document.querySelectorAll('.tab').forEach(el=>{ el.onclick = ()=>{ activeTab = el.dataset.tab; render(); }; });

    document.querySelectorAll('.tag-opt').forEach(el=>{
      el.onclick = ()=>{ pickedTag = el.dataset.tagopt; document.querySelectorAll('.tag-opt').forEach(x=>x.classList.remove('active')); el.classList.add('active'); };
    });
    const activeEl = document.querySelector(`.tag-opt[data-tagopt="${pickedTag}"]`);
    if(activeEl) activeEl.classList.add('active');

    const linkInput = document.getElementById('f-link');
    if(linkInput){
      linkInput.oninput = (e)=>{
        const nm = extractNameFromUrl(e.target.value);
        const nameInput = document.getElementById('f-name');
        if(nm && nameInput && !nameInput.dataset.touched){ nameInput.value = nm; }
      };
    }
    const nameInput = document.getElementById('f-name');
    if(nameInput){
      if(editingPlaceId) nameInput.dataset.touched = '1';
      nameInput.oninput = ()=>{ nameInput.dataset.touched = '1'; };
    }

    const saveBtn = document.getElementById('saveBtn');
    if(saveBtn) saveBtn.onclick = handleSave;
  }

  /* ============================================================
     保存処理
     ============================================================ */
  function handleSave(){
    const name = (document.getElementById('f-name')||{}).value?.trim();
    const memo = (document.getElementById('f-memo')||{}).value?.trim() || '';
    if(!name){ alert('場所の名前を入力してください'); return; }

    if(editingPlaceId){
      const p = places.find(x=>x.id===editingPlaceId);
      if(p){
        p.name = name;
        p.memo = memo;
        p.tag = pickedTag;

        if(activeTab==='link'){
          const url = (document.getElementById('f-link')||{}).value?.trim();
          if(url){
            p.link = url;
            p.query = extractNameFromUrl(url) || '';
            p.lat = undefined; p.lng = undefined; // 位置を再取得
          }
        } else {
          const searchText = (document.getElementById('f-query')||{}).value?.trim() || '';
          if(searchText){
            p.query = searchText;
            p.link = searchLink(searchText, '');
            p.lat = undefined; p.lng = undefined; // 位置を再取得
          }
        }
      }
      persistPlaces();
      placeModalOpen = false;
      editingPlaceId = null;
      render();
      return;
    }

    let link, query, lat, lng;
    if(activeTab==='name'){
      // 「名前」はカードの表示ラベル。地図検索には「名前・住所・エリア」欄だけを使う
      const searchText = (document.getElementById('f-query')||{}).value?.trim() || '';
      if(!searchText){ alert('名前・住所・エリアを入力してください'); return; }
      query = searchText;
      link = searchLink(query, '');
    } else if(activeTab==='link'){
      const url = (document.getElementById('f-link')||{}).value?.trim();
      if(!url){ alert('Googleマップのリンクを入力してください'); return; }
      link = url;
      query = extractNameFromUrl(url) || '';
    } else {
      // pin タブ：実際にタップした座標をそのまま使う
      if(!pinPickLatLng){ alert('地図をタップしてピンを置いてください'); return; }
      lat = pinPickLatLng.lat; lng = pinPickLatLng.lng;
      link = coordLink(lat, lng);
      query = '';
    }

    const newPlace = {
      id: 'p'+Date.now()+Math.floor(Math.random()*1000),
      listId: currentListId,
      name, memo, link, query,
      tag: pickedTag,
      visited: false,
      addedAt: Date.now()
    };
    if(typeof lat === 'number'){ newPlace.lat = lat; newPlace.lng = lng; }

    places.push(newPlace);
    persistPlaces();
    placeModalOpen = false;
    pinPickLatLng = null;
    pendingFocusPlaceId = newPlace.id;
    render();
  }

  /* ============================================================
     Google Maps ローダー（起動処理）
     ============================================================ */
  window.__initApp = function(){
    if(mapsReady()){ geocoder = new google.maps.Geocoder(); }
    load();
  };

  if(!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === 'YOUR_API_KEY_HERE'){
    // キー未設定でもアプリ自体は使えるようにする(地図は警告表示になる)
    load();
  } else {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places&callback=__initApp&loading=async`;
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }
})();
