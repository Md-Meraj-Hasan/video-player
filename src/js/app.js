import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { ScreenOrientation } from '@capacitor/screen-orientation';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

// Share the currently selected audio file via Android's native share sheet.
async function shareMerajMedia() {
  const t = current >= 0 ? tracks[current] : null;
  if (!t) { toast('Select an audio track first, then tap Share.'); return; }
  try {
    if (t.native && t.uri) {
      await VideoScannerBridge.shareMedia({ uri: t.uri, name: t.name || 'audio', mimeType: t.mimeType || 'audio/*' });
      return;
    }
    if (t.file && navigator.share && navigator.canShare?.({ files: [t.file] })) {
      await navigator.share({ files: [t.file], title: t.file.name });
      return;
    }
    toast('To share device music, use the Android app after scanning your library.');
  } catch (error) {
    if (error?.name !== 'AbortError') { console.error('Audio share failed', error); toast('Could not share this audio file.'); }
  }
}
const shareAppButton = document.getElementById('shareApp');
if (shareAppButton) { shareAppButton.setAttribute('aria-label','Share selected audio'); shareAppButton.setAttribute('title','Share selected audio'); shareAppButton.addEventListener('click', shareMerajMedia); }
// Video iframe bridge: keep the video UI/CSS isolated while routing native calls through the parent Capacitor bridge.
const videoFrameBridge = document.getElementById('videoPlayerFrame');
const VideoPermissionBridge = registerPlugin('MediaPermission');
const VideoScannerBridge = registerPlugin('MediaLibraryScanner');
window.addEventListener('message', async (event) => {
  if (!videoFrameBridge || event.source !== videoFrameBridge.contentWindow) return;
  const message = event.data;
  if (message?.type === 'meraj-video-switch-audio') { page('home'); return; }
  if (!message || message.bridge !== 'meraj-video-native' || !message.requestId) return;
  const reply = { bridge: 'meraj-video-native-result', requestId: message.requestId };
  try {
    switch (message.action) {
      case 'permission': reply.result = await VideoPermissionBridge.requestIfNeeded(); break;
      case 'scan': reply.result = await VideoScannerBridge.scan({ type: message.payload?.type || 'video' }); break;
      case 'launchVideo': reply.result = await VideoScannerBridge.launchVideo(message.payload || {}); break;
      case 'preparePlayback': reply.result = await VideoScannerBridge.preparePlayback(message.payload || {}); break;
      case 'getThumbnail': reply.result = await VideoScannerBridge.getThumbnail(message.payload || {}); break;
      case 'shareMedia': reply.result = await VideoScannerBridge.shareMedia(message.payload || {}); break;
      case 'orientationLock': await ScreenOrientation.lock({ orientation: message.payload?.orientation || 'landscape' }); reply.result = { locked: true }; break;
      case 'orientationUnlock': await ScreenOrientation.unlock(); reply.result = { locked: false }; break;
      case 'exitApp': await App.exitApp(); reply.result = { exited: true }; break;
      default: throw new Error('Unsupported video native action: ' + message.action);
    }
    reply.ok = true;
  } catch (error) {
    reply.ok = false;
    reply.error = String(error?.message || error || 'Native operation failed');
  }
  event.source.postMessage(reply, '*');
});
try {
  App.addListener('backButton', () => {
    if (videoFrameBridge && document.getElementById('videoPlayer')?.classList.contains('active')) {
      videoFrameBridge.contentWindow?.postMessage({ type: 'meraj-video-native-back' }, '*');
    } else {
      goBack();
    }
  }).catch(() => {});
} catch (_) {}
const audio=$('#audio');const NativePlayer=registerPlugin('MerajMediaPlayer');NativePlayer.addListener('trackChanged',ev=>{const idx=tracks.findIndex(t=>String(t.id||t.uri)===String(ev.mediaId));if(idx>=0){current=idx;nativePlayback=true;nativeEndedHandled=false;nativeIsPlaying=true;syncNow();}});let tracks=[],current=-1,favs=new Set(),shuffleMode=0,repeatMode=0,folderMode=false,nativeMode=false,nativePlayback=false,nativeIsPlaying=false,nativePosition=0,nativeDuration=0,nativeEndedHandled=false,historyPages=['home'],playbackSpeed=1,equalizerPreset='normal';const colors=['','c2','c3','c4'];
// Premium themes cycle on every palette-icon tap; shared with video iframe.
const themeNames=['default','green','red','silver','graphite','blue','ocean','sunset','gold','ice'];
function applyTheme(theme,save=true){if(!themeNames.includes(theme))theme='default';document.documentElement.dataset.theme=theme;const meta=document.querySelector('meta[name="theme-color"]');const metaColors={default:'#10101c',green:'#071b17',red:'#200d13',silver:'#20242b',graphite:'#101318',blue:'#08172b',ocean:'#071c28',sunset:'#27121d',gold:'#211a0b',ice:'#10232b'};if(meta)meta.content=metaColors[theme]||metaColors.default;if(save){try{localStorage.setItem('merajMusicTheme',theme)}catch(e){}}if(themeToggle){themeToggle.dataset.theme=theme;themeToggle.style.color='var(--accent2)';themeToggle.setAttribute('aria-label','Color theme: '+theme+'; tap to change');themeToggle.title='Theme: '+theme+' · tap to change'}}
const themeToggle=$('#themeToggle');
if(themeToggle){let saved='default';try{saved=localStorage.getItem('merajMusicTheme')||'default'}catch(e){}applyTheme(saved,false);themeToggle.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const current=document.documentElement.dataset.theme||'default';const next=themeNames[(themeNames.indexOf(current)+1)%themeNames.length];applyTheme(next);});window.addEventListener('storage',e=>{if(e.key==='merajMusicTheme'&&e.newValue)applyTheme(e.newValue,false)})}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function toast(t){let x=$('#toast');x.textContent=t;x.classList.add('show');setTimeout(()=>x.classList.remove('show'),2600)}function fmt(n){if(!Number.isFinite(n))return '0:00';return Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0')}function page(id){const oldPage=$$('.page.active')[0]?.id;if(oldPage==='videoPlayer'&&id!=='videoPlayer')videoFrameBridge?.contentWindow?.postMessage({type:'meraj-video-parent-hide'},'*');if(!window.__pageBack) {if(historyPages[historyPages.length-1]!==id) historyPages.push(id)} window.__pageBack=false; $$('.page').forEach(p=>p.classList.toggle('active',p.id===id));document.body.classList.toggle('video-mode',id==='videoPlayer');$$('.nav').forEach(b=>b.classList.toggle('active',b.dataset.page===id));const mini=$('#mini');if(mini)mini.classList.toggle('hidden',id==='now'||current<0);if(id==='now')syncNow();if(id==='folders')renderFolders();if(id==='favorites')renderFavorites();if(id==='albums')renderAlbums();if(id==='artists')renderArtists();window.scrollTo(0,0)}$$('[data-page]').forEach(b=>b.addEventListener('click',()=>page(b.dataset.page))); $$('.back').forEach(b=>b.addEventListener('click',()=>goBack())); function goBack(){if(historyPages.length>1)historyPages.pop();const target=historyPages[historyPages.length-1]||'home';window.__pageBack=true;page(target)} window.addEventListener('keydown',e=>{if((e.key==='Escape'||e.key==='Backspace')&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();goBack()}});function addFiles(files){let added=0;for(const f of files){if(!f.type.startsWith('audio/')&&!/\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(f.name))continue;let path=f.webkitRelativePath||f.name;if(tracks.some(t=>t.name===f.name&&t.size===f.size&&t.path===path))continue;tracks.push({name:f.name.replace(/\.[^.]+$/,''),artist:'Local audio',album:'Unknown album',path,size:f.size,url:URL.createObjectURL(f),file:f,native:false});added++}renderAll();toast(added?`Added ${added} local audio file(s).`:'No new audio files found.');}$('#scan').onclick=()=>{if('showDirectoryPicker'in window){$('#folderPicker').click()}else $('#folderPicker').click()};$('#folderPicker').addEventListener('change',e=>addFiles(e.target.files));$('#filePicker').addEventListener('change',e=>addFiles(e.target.files));function songRow(t,i){const active=i===current;return `<div class="song ${active?'is-playing':''}" data-song-row="${i}"><div class="art ${colors[i%4]} ${active?'playing-art':''}">${active&&!isPaused()?'♫':'♫'}</div><button class="songinfo" data-play="${i}"><b>${esc(t.name)}${active?' <span class=\"playing-badge\">'+(isPaused()?'PAUSED':'PLAYING')+'</span>':''}</b><small>${active?(isPaused()?'Ⅱ Paused · ':'♫ Now playing · '):''}${esc(t.path.includes('/')?t.path.split('/').slice(0,-1).join(' / '):'Local audio')} · ${esc(t.artist)}</small></button><button class="more" data-fav="${i}" title="Favorite">${favs.has(i)?'♥':'♡'}</button></div>`}function fillList(id,arr){$(id).innerHTML=arr.length?arr.map(i=>songRow(tracks[i],i)).join(''):'<p class="muted">No music loaded yet. In browser preview, use the ↻ button to select a music folder. Android app will scan local music after permission is granted.</p>'}function renderAll(){let all=tracks.map((_,i)=>i);fillList('#recent',all.slice(-5).reverse());fillList('#allSongs',all);fillList('#libraryRecent',all.slice(-6).reverse());$('#songCount').textContent=tracks.length+' tracks';$('#countBadge').textContent=tracks.length+' songs';$('#favCount').textContent=favs.size+' saved';renderFavorites();bindRows()}function bindRows(){$$('[data-play]').forEach(b=>b.onclick=()=>playTrack(+b.dataset.play));$$('[data-fav]').forEach(b=>b.onclick=()=>{let i=+b.dataset.fav;favs.has(i)?favs.delete(i):favs.add(i);renderAll()})}async function playTrack(i){if(i<0||i>=tracks.length)return;current=i;const t=tracks[i];if(Capacitor.isNativePlatform()&&t.native&&t.uri){nativePlayback=true;nativeIsPlaying=false;nativePosition=0;nativeDuration=Number(t.duration||0)/1000;audio.pause();try{await NativePlayer.setQueue({items:tracks.filter(x=>x.native&&x.uri).map(x=>({id:String(x.id||x.uri),uri:x.uri,title:x.name,artist:x.artist})),startIndex:tracks.filter(x=>x.native&&x.uri).findIndex(x=>String(x.id||x.uri)===String(t.id||t.uri))});await NativePlayer.playAt({index:tracks.filter(x=>x.native&&x.uri).findIndex(x=>String(x.id||x.uri)===String(t.id||t.uri))});nativeIsPlaying=true;$('#mini').classList.remove('hidden');syncNow();page('now');await NativePlayer.setRepeatOne({enabled:repeatMode===2});await pollNativeState()}catch(e){nativeIsPlaying=false;syncNow();toast('Could not play this audio file on this device.');console.error(e)}return;}nativePlayback=false;audio.src=t.uri||t.url;audio.playbackRate=playbackSpeed;audio.play().then(()=>{$('#mini').classList.remove('hidden');syncNow();page('now')}).catch(()=>{syncNow();page('now');toast('Tap Play to start this local track.')});$('#mini').classList.remove('hidden');syncNow()}function isPaused(){return nativePlayback?!nativeIsPlaying:audio.paused}function syncNow(){if(current<0)return;let t=tracks[current];$('#nowTitle').textContent=t.name;$('#nowArtist').textContent=t.path.includes('/')?t.path.split('/').slice(0,-1).join(' / '):'Local audio';$('#miniTitle').textContent=t.name;$('#miniArtist').textContent='Local audio';$('#play').textContent=isPaused()?'▶':'Ⅱ';$('#miniPlay').textContent=isPaused()?'▶':'Ⅱ';$('#likeNow').innerHTML=(favs.has(current)?'♥ Remove from favorites':'♡ Add to favorites');$('#bigart').textContent='♫';updatePlayingRows()}function updatePlayingRows(){ $$('[data-song-row]').forEach(row=>{const i=Number(row.dataset.songRow),active=i===current;row.classList.toggle('is-playing',active);const info=row.querySelector('.songinfo');if(!info)return;const title=info.querySelector('b'),sub=info.querySelector('small');if(!title||!sub)return;title.innerHTML=esc(tracks[i]?.name||'')+(active?' <span class="playing-badge">'+(isPaused()?'PAUSED':'PLAYING')+'</span>':'');const t=tracks[i];sub.textContent=(active?(isPaused()?'Ⅱ Paused · ':'♫ Now playing · '):'')+(t?.path?.includes('/')?t.path.split('/').slice(0,-1).join(' / '):'Local audio')+' · '+(t?.artist||'Local audio')})}$('#play').onclick=async()=>{if(current<0){if(tracks.length)playTrack(0);else toast('No songs loaded.');return}if(nativePlayback){try{if(nativeIsPlaying)await NativePlayer.pause();else await NativePlayer.resume();await pollNativeState()}catch(e){toast('Playback control failed.')}return;}audio.paused?audio.play():audio.pause();syncNow()};$('#miniPlay').onclick=()=>$('#play').click();function trackFolder(t){const p=String(t?.path||t?.relativePath||'');return p.includes('/')?p.split('/').slice(0,-1).join('/'):'Root / Selected files'}function shufflePool(){if(shuffleMode===1&&current>=0){const folder=trackFolder(tracks[current]);const ids=tracks.map((t,i)=>({t,i})).filter(x=>trackFolder(x.t)===folder).map(x=>x.i);return ids.length?ids:tracks.map((_,i)=>i)}return tracks.map((_,i)=>i)}function step(d){if(!tracks.length)return;let n;if(shuffleMode){const pool=shufflePool();const choices=pool.filter(i=>i!==current);n=choices.length?choices[Math.floor(Math.random()*choices.length)]:current}else n=(Math.max(0,current)+d+tracks.length)%tracks.length;playTrack(n)}$('#next').onclick=()=>step(1);$('#prev').onclick=()=>{if(nativePlayback){if(nativePosition>3000){NativePlayer.seekTo({positionMs:0});nativePosition=0;syncTimeline()}else step(-1)}else if(audio.currentTime>3)audio.currentTime=0;else step(-1)};$('#miniNext').onclick=()=>step(1);audio.addEventListener('play',syncNow);audio.addEventListener('pause',syncNow);audio.addEventListener('ended',()=>{if(repeatMode===2){audio.currentTime=0;audio.play()}else if(repeatMode===1)step(1)});audio.addEventListener('timeupdate',()=>{if(audio.duration){if(!seekDragging)$('#seek').value=audio.currentTime/audio.duration*1000;$('#elapsed').textContent=fmt(audio.currentTime);$('#duration').textContent=fmt(audio.duration)}});
let seekDragging=false,seekTouched=false,seekCommitPending=false,seekRequestId=0,seekSyncHoldUntil=0;
const seek=$('#seek');
function seekDurationSeconds(){
  if(nativePlayback){
    const fromState=Number(nativeDuration||0);
    const fromTrack=Number(tracks[current]?.duration||0)/1000;
    return Math.max(fromState,fromTrack);
  }
  return Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:0;
}
function seekTargetSeconds(){return seekDurationSeconds()*(Math.min(1000,Math.max(0,Number(seek.value)||0))/1000)}
function previewSeek(){
  seekTouched=true;
  const duration=seekDurationSeconds();
  if(duration<=0)return;
  const pos=seekTargetSeconds();
  $('#elapsed').textContent=fmt(pos);
  // Do not issue native seek requests for every slider movement. Android's
  // MediaController can queue those requests and the final seek can be lost.
  if(!nativePlayback){try{audio.currentTime=pos}catch(e){console.warn('Audio preview seek unavailable',e)}}
}
async function commitSeek(){
  if(current<0)return;
  const duration=seekDurationSeconds();
  if(duration<=0){toast('Track is still loading. Try seeking again.');return}
  const targetSeconds=Math.min(duration,Math.max(0,seekTargetSeconds()));
  const targetMs=Math.round(targetSeconds*1000);
  const requestId=++seekRequestId;
  seekSyncHoldUntil=Date.now()+1200;
  try{
    if(nativePlayback){
      const result=await NativePlayer.seekTo({positionMs:targetMs});
      // Use the accepted target immediately, then verify against Android state.
      nativePosition=targetMs/1000;
      nativeDuration=duration;
      syncTimeline();
      const state=await NativePlayer.getState();
      if(requestId===seekRequestId){
        const actual=Number(state.position||0)/1000;
        // ExoPlayer can report the previous position for a brief moment after seekTo.
        if(Math.abs(actual-targetSeconds)<2)nativePosition=actual;
        else nativePosition=targetSeconds;
        nativeDuration=Math.max(duration,Number(state.duration||0)/1000);
        syncTimeline();
      }
      if(result&&result.accepted===false)throw new Error('Android player did not accept the seek request');
    }else{
      if(!Number.isFinite(audio.duration)||audio.duration<=0)throw new Error('Audio duration is unavailable');
      audio.currentTime=targetSeconds;
      $('#seek').value=String(Math.round(targetSeconds/audio.duration*1000));
      $('#elapsed').textContent=fmt(targetSeconds);
    }
  }catch(e){
    console.error('Seek request failed',e);
    toast('Seek failed: '+(e?.message||'Android player rejected the request'));
  }finally{
    setTimeout(()=>{if(Date.now()>=seekSyncHoldUntil&&nativePlayback)pollNativeState()},350);
  }
}
function finishSeek(){
  if(!seekTouched&&!seekDragging)return;
  seekDragging=false;seekTouched=false;
  if(seekCommitPending)return;
  seekCommitPending=true;
  commitSeek().finally(()=>{seekCommitPending=false});
}
seek.addEventListener('pointerdown',()=>{seekDragging=true;seekTouched=false});
seek.addEventListener('touchstart',()=>{seekDragging=true;seekTouched=false},{passive:true});
seek.addEventListener('input',previewSeek);
seek.addEventListener('change',finishSeek);
seek.addEventListener('pointerup',finishSeek);
seek.addEventListener('touchend',finishSeek,{passive:true});
seek.addEventListener('keyup',e=>{if(['ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(e.key)){seekTouched=true;finishSeek()}});
function syncShuffleButton(){const labels=['Shuffle off','Current folder','All directory audio'];const b=$('#shuffle');b.classList.toggle('mode-active',shuffleMode!==0);b.style.color=shuffleMode?'#ff91aa':'';b.title=labels[shuffleMode];b.setAttribute('aria-label',labels[shuffleMode]);b.dataset.mode=String(shuffleMode);$('#shuffleModeLabel').textContent=labels[shuffleMode];}$('#shuffle').onclick=()=>{shuffleMode=(shuffleMode+1)%3;syncShuffleButton();toast(['Shuffle off','Shuffle current folder','Shuffle all directory audio'][shuffleMode])};syncShuffleButton();function syncRepeatButton(){const labels=['Repeat off','Repeat all','Repeat one'];const b=$('#repeat');b.classList.toggle('mode-active',repeatMode!==0);b.classList.toggle('repeat-one',repeatMode===2);b.style.color=repeatMode?'#ff91aa':'';b.title=labels[repeatMode];b.setAttribute('aria-label',labels[repeatMode]);b.dataset.mode=String(repeatMode);$('#repeatModeLabel').textContent=labels[repeatMode];}$('#repeat').onclick=()=>{repeatMode=(repeatMode+1)%3;syncRepeatButton();if(nativePlayback)NativePlayer.setRepeatOne({enabled:repeatMode===2}).catch(console.error);toast(['Repeat off','Repeat all','Repeat one'][repeatMode])};syncRepeatButton();const speedSteps=[0.5,0.6,0.7,0.8,0.9,1,1.1,1.2,1.3,1.4,1.5];
function closeAudioPopovers(){$('#equalizerPopover').hidden=true;$('#speedPopover').hidden=true}
function openAudioPopover(id){const el=$(id),wasOpen=!el.hidden;closeAudioPopovers();el.hidden=wasOpen}
function syncSpeedUI(){$('#speedLabel').textContent=playbackSpeed.toFixed(1)+'×';$('#speedOptions').innerHTML=speedSteps.map(v=>`<button class="${v===playbackSpeed?'selected':''}" data-speed="${v}">${v.toFixed(1)}×</button>`).join('');$('#speedOptions').querySelectorAll('[data-speed]').forEach(b=>b.onclick=()=>setPlaybackSpeed(+b.dataset.speed))}
async function setPlaybackSpeed(v){playbackSpeed=Math.min(1.5,Math.max(0.5,+v||1));try{if(nativePlayback)await NativePlayer.setPlaybackSpeed({speed:playbackSpeed});else audio.playbackRate=playbackSpeed;syncSpeedUI();closeAudioPopovers();toast('Speed '+playbackSpeed.toFixed(1)+'×')}catch(e){console.error(e);toast('Speed change failed')}}
$('#speedBtn').onclick=()=>openAudioPopover('#speedPopover');
const eqPresetNames={normal:'Normal',dance:'Dance',classic:'Classic',jazz:'Jazz',pop:'Pop',rock:'Rock',flat:'Flat','bass-boost':'Bass Boost'};
let eqAvailablePresets=[];
function renderEqualizerPresets(){
  const list=eqAvailablePresets.length?eqAvailablePresets:Object.entries(eqPresetNames).map(([key,name])=>({key,name}));
  $('#equalizerPresets').innerHTML=list.map(x=>`<button type="button" data-eq="${esc(x.key)}" class="${x.key===equalizerPreset?'selected':''}" aria-pressed="${x.key===equalizerPreset?'true':'false'}">${esc(x.name)}</button>`).join('');
  $('#equalizerPresets').querySelectorAll('[data-eq]').forEach(b=>b.onclick=()=>setEqualizerPreset(b.dataset.eq));
}
$('#equalizerBtn').onclick=async()=>{
  openAudioPopover('#equalizerPopover');
  renderEqualizerPresets();
  if(nativePlayback&&Capacitor.isNativePlatform()){
    try{
      const r=await NativePlayer.getEqualizerPresets();
      if(r?.presets?.length){
        eqAvailablePresets=r.presets;
        // Map the saved selected preset to a device preset by normalized name.
        if(!eqAvailablePresets.some(x=>x.key===equalizerPreset)) {
          const match=eqAvailablePresets.find(x=>x.key===String(equalizerPreset).replace(/-/g,' ')) ||
            eqAvailablePresets.find(x=>x.name.toLowerCase()===String(equalizerPreset).replace(/-/g,' '));
          if(match) equalizerPreset=match.key;
        }
        renderEqualizerPresets();
        $('#eqNote').textContent='Select a preset; the highlighted option is active.';
      } else {
        $('#eqNote').textContent='No Android equalizer presets were reported. Check the audio session.';
      }
    }catch(e){console.error('Equalizer preset list failed',e);$('#eqNote').textContent='Could not load equalizer presets. Check Android audio session.';}
  } else {
    $('#eqNote').textContent='Play a song from the Android app to apply an equalizer preset.';
  }
};
async function setEqualizerPreset(key){
  if(!nativePlayback||!Capacitor.isNativePlatform()){toast('Play a song in the Android app first.');return;}
  try{
    const result=await NativePlayer.setEqualizerPreset({preset:key});
    equalizerPreset=result?.preset||key;
    renderEqualizerPresets();
    $('#eqNote').textContent='Active preset: '+(eqPresetNames[equalizerPreset]||eqAvailablePresets.find(x=>x.key===equalizerPreset)?.name||equalizerPreset);
    toast('Equalizer applied: '+(eqPresetNames[equalizerPreset]||equalizerPreset.replace(/-/g,' ')));
  }catch(e){
    console.error('Equalizer apply failed',e);
    $('#eqNote').textContent='Could not apply this preset: '+(e?.message||'Android equalizer unavailable');
    toast('Equalizer could not be applied. Check Android audio session.');
  }
}
$$('[data-close-audio]').forEach(b=>b.onclick=closeAudioPopovers);document.addEventListener('click',e=>{if(!e.target.closest('.audio-popover')&&!e.target.closest('.audio-tool'))closeAudioPopovers()});syncSpeedUI();
$('#likeNow').onclick=()=>{if(current<0)return;favs.has(current)?favs.delete(current):favs.add(current);renderAll();syncNow()};function renderFavorites(){fillList('#favoriteList',[...favs].filter(i=>tracks[i]))}function renderFolders(){let map={};tracks.forEach((t,i)=>{let f=t.path.includes('/')?t.path.split('/').slice(0,-1).join('/'):'Root / Selected files';(map[f]??=[]).push(i)});const names=Object.keys(map);const host=$('#folderList');if(!names.length){host.innerHTML='<p class="muted">No folders loaded. Select a music folder using Scan.</p>';return}host.innerHTML='<div class="audio-folder-strip" role="tablist">'+names.map((f,i)=>'<button type="button" class="audio-folder-chip '+(i===0?'active':'')+'" data-audio-folder="'+i+'">▣ '+esc(f)+' <small>'+map[f].length+'</small></button>').join('')+'</div><div id="audio-folder-content" class="audio-folder-content songlist"></div>';const show=(i)=>{host.querySelectorAll('.audio-folder-chip').forEach((b,j)=>b.classList.toggle('active',i===j));$('#audio-folder-content').innerHTML=map[names[i]].map(j=>songRow(tracks[j],j)).join('');bindRows()};host.querySelectorAll('[data-audio-folder]').forEach(b=>b.addEventListener('click',()=>show(Number(b.dataset.audioFolder))));show(0)}function renderAlbums(){let map={};tracks.forEach((t,i)=>(map[t.album]??=[]).push(i));$('#albumList').innerHTML=Object.keys(map).length?Object.entries(map).map(([name,ids],i)=>`<button class="album" data-album="${esc(name)}"><div class="albumart">♫</div><b>${esc(name)}</b><small>${ids.length} songs</small></button>`).join(''):'<p class="muted">Album details will appear when available in local music metadata.</p>';$$('[data-album]').forEach(b=>b.onclick=()=>{page('songs');fillList('#allSongs',map[b.dataset.album]);bindRows()})}function renderArtists(){let map={};tracks.forEach((t,i)=>(map[t.artist]??=[]).push(i));$('#artistList').innerHTML=Object.keys(map).length?Object.entries(map).map(([name,ids])=>`<div class="song"><div class="art">♙</div><button class="songinfo" data-artist="${esc(name)}"><b>${esc(name)}</b><small>${ids.length} songs</small></button></div>`).join(''):'<p class="muted">Artist names will appear when available in local music metadata.</p>';$$('[data-artist]').forEach(b=>b.onclick=()=>{page('songs');fillList('#allSongs',map[b.dataset.artist]);bindRows()})}function doSearch(q){let ids=tracks.map((t,i)=>({t,i})).filter(x=>(x.t.name+' '+x.t.artist+' '+x.t.path).toLowerCase().includes(q.toLowerCase())).map(x=>x.i);fillList('#searchResults',ids);bindRows()}$$('.searchbox button[data-page="search"]').forEach(b=>{b.removeAttribute('data-page');b.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();$('#searchHome').focus();},true)});$('#searchHome').oninput=e=>{
  const q=e.target.value.trim();
  const recentHead=$('#homeRecentTitle');
  if(q){
    const ids=tracks.map((t,i)=>({t,i})).filter(x=>(x.t.name+' '+x.t.artist+' '+x.t.path).toLowerCase().includes(q.toLowerCase())).map(x=>x.i);
    recentHead.textContent='Search results';
    fillList('#recent',ids); bindRows();
  } else {
    recentHead.textContent='Recently added';
    fillList('#recent',tracks.map((_,i)=>i).slice(-5).reverse());bindRows();
  }
};
function syncTimeline(){const pos=nativePlayback?nativePosition:audio.currentTime;const dur=nativePlayback?nativeDuration:audio.duration;if(dur>0){if(!seekDragging)$('#seek').value=Math.min(1000,Math.max(0,pos/dur*1000));$('#elapsed').textContent=fmt(pos);$('#duration').textContent=fmt(dur)}}
async function pollNativeState(){if(!nativePlayback)return;try{const st=await NativePlayer.getState();nativeIsPlaying=!!st.isPlaying;if(Date.now()>=seekSyncHoldUntil){nativePosition=Math.max(0,Number(st.position||0)/1000)}nativeDuration=Math.max(0,Number(st.duration||0)/1000);syncTimeline();syncNow();if(Number(st.playbackState)!==4){nativeEndedHandled=false}else if(repeatMode===1&&!nativeEndedHandled){nativeEndedHandled=true;step(1)}}catch(e){console.error('Native playback state check failed',e)}}
setInterval(()=>{if(nativePlayback)pollNativeState()},500);
async function scanAndroidLibrary(){
 const isNative=Capacitor.isNativePlatform();
 if(!isNative) return false;
 nativeMode=true;
 try{
  const MediaPermission=registerPlugin('MediaPermission');
  const MediaLibraryScanner=registerPlugin('MediaLibraryScanner');
  const perm=await MediaPermission.requestIfNeeded();
  if(!perm || !perm.granted){toast('Audio permission is needed to scan local music.');return true;}
  const result=await MediaLibraryScanner.scan({type:'audio'});
  const items=(result&&result.items)||[]; const oldCurrent=current>=0?tracks[current]?.id:null;
  tracks.forEach(t=>{if(t.url&&t.url.startsWith('blob:'))URL.revokeObjectURL(t.url)});
  tracks=items.map((x)=>({id:String(x.id),uri:x.uri,name:(x.name||'Unknown audio').replace(/\.[^.]+$/,''),artist:x.artist||'Unknown artist',album:x.album||'Unknown album',path:x.relativePath||'Music',size:Number(x.size||0),duration:Number(x.duration||0),native:true}));
  current=oldCurrent?tracks.findIndex(t=>t.id===oldCurrent):-1;
  renderAll(); if(tracks.length) toast(`Found ${tracks.length} songs on this device.`); else toast('No local audio files found.');
 }catch(err){console.error('Native audio scan failed',err);toast('Could not scan music. Check audio permission.');}
 return true;
}
$('#scan').onclick=async()=>{if(nativeMode){await scanAndroidLibrary();return;}$('#folderPicker').click()};
(async()=>{if(Capacitor.isNativePlatform()){await scanAndroidLibrary()}
renderAll();})();
