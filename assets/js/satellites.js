import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as satellite from 'satellite.js';

const $ = (id) => document.getElementById(id);
const RAD = Math.PI / 180;
const EARTH_KM = 6371;
const CACHE_KEY = 'htc-satellite-tles-v1';
const OBSERVER_KEY = 'htc-satellite-observer-v1';
const DATA_ROOT = new URL('../satellites/', import.meta.url);
const state = { satellites: [], selected: null, observer: null, minElevation: 10, orbitAt: 0, passToken: 0 };
let scene, camera, renderer, controls, earth, observerMarker, footprint;
const markers = new THREE.Group();
const orbits = new THREE.Group();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const screenPoint = new THREE.Vector3();
globalThis.lucide?.createIcons();

function stored(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function tunable(hz) {
  return (hz >= 136e6 && hz <= 174e6) || (hz >= 300e6 && hz <= 550e6);
}
function workable(usage) {
  return usage.mode.toUpperCase().includes('FM') && usage.status.toLowerCase() === 'active' && tunable(usage.uplinkHz) && tunable(usage.downlinkHz);
}
function parseTles(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const result = new Map();
  for (let index = 0; index < lines.length - 1; index++) {
    if (!lines[index].startsWith('1 ') || !lines[index + 1].startsWith('2 ')) continue;
    const line1 = lines[index], line2 = lines[index + 1];
    const id = Number(line1.slice(2, 7));
    if (!Number.isInteger(id) || id <= 0) continue;
    try {
      const record = satellite.twoline2satrec(line1, line2);
      if (!Number.isFinite(record.no) || record.no <= 0 || !Number.isFinite(record.jdsatepoch)) continue;
      result.set(id, { id, name: (lines[index - 1] || `NORAD ${id}`).replace(/^0 /, ''), record });
    } catch { continue; }
    index++;
  }
  return result;
}
function vector(position) { return new THREE.Vector3(position.x, position.z, -position.y).multiplyScalar(1 / EARTH_KM); }
function atTime(item, date) {
  try {
    const propagated = satellite.propagate(item.record, date);
    if (!propagated.position || !Number.isFinite(propagated.position.x)) return null;
    const gmst = satellite.gstime(date);
    const ecf = satellite.eciToEcf(propagated.position, gmst);
    const geo = satellite.eciToGeodetic(propagated.position, gmst);
    if (geo.height < 0 || !Number.isFinite(geo.height)) return null;
    const look = state.observer ? satellite.ecfToLookAngles(state.observer, ecf) : null;
    return { point: vector(ecf), geo, look, elevation: look ? look.elevation / RAD : null };
  } catch { return null; }
}
async function getText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
async function loadCatalog() {
  const [catalogText, seedText] = await Promise.all([getText(new URL('transponders.json', DATA_ROOT)), getText(new URL('amateur.tle', DATA_ROOT))]);
  const catalog = JSON.parse(catalogText).transponders;
  const elements = parseTles(seedText);
  const cache = stored(CACHE_KEY);
  let source = 'Bundled fallback';
  if (cache && typeof cache.text === 'string') {
    for (const [id, tle] of parseTles(cache.text)) elements.set(id, tle);
    source = 'Cached CelesTrak';
  }
  if (!cache || !Number.isFinite(cache.fetchedAt) || Date.now() - cache.fetchedAt >= 7200000) {
    try {
      const text = await getText('https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=TLE');
      const fresh = parseTles(text);
      if (![...fresh.keys()].some((id) => catalog.some((usage) => usage.noradId === id))) throw new Error('Empty catalog');
      for (const [id, tle] of fresh) elements.set(id, tle);
      store(CACHE_KEY, { text, fetchedAt: Date.now() });
      source = 'CelesTrak';
    } catch { source += ' (live refresh unavailable)'; }
  }
  const grouped = new Map();
  for (const usage of catalog) {
    if (!tunable(usage.uplinkHz) && !tunable(usage.downlinkHz)) continue;
    if (!grouped.has(usage.noradId)) grouped.set(usage.noradId, []);
    grouped.get(usage.noradId).push(usage);
  }
  state.satellites = [...elements.values()].filter((item) => grouped.get(item.id)?.some(workable)).map((item) => ({ ...item, usages: grouped.get(item.id).sort((first, second) => Number(workable(second)) - Number(workable(first))) })).sort((first, second) => first.name.localeCompare(second.name));
  if (!state.satellites.length) throw new Error('No satellite orbital data available.');
  state.selected = state.satellites.find((item) => item.id === 25544)?.id || state.satellites[0].id;
  const oldest = Math.min(...state.satellites.map((item) => (item.record.jdsatepoch - 2440587.5) * 86400000));
  const ageDays = Math.max(0, Math.floor((Date.now() - oldest) / 86400000));
  $('dataStatus').textContent = `${source}. Oldest orbital epoch: ${new Date(oldest).toISOString().slice(0, 10)} (${ageDays} days old).${ageDays > 7 ? ' Stale elements: positions and pass times may be inaccurate.' : ''}`;
  $('dataStatus').classList.toggle('stale', ageDays > 7);
  $('catalogCount').textContent = `${state.satellites.length} amateur satellites`;
  $('listCount').textContent = state.satellites.length;
}

async function buildGlobe() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#080f18');
  camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
  camera.position.set(0, 1.3, 4.1);
  renderer = new THREE.WebGLRenderer({ canvas: $('globe'), antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.45;
  controls.maxDistance = 9;
  controls.autoRotateSpeed = 0.35;
  scene.add(new THREE.AmbientLight(0xffffff, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.position.set(4, 3, 5);
  scene.add(sun);
  earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.MeshPhongMaterial({ color: '#1e4663', shininess: 12 }));
  scene.add(earth, markers, orbits);
  const grid = new THREE.Group();
  const gridMaterial = new THREE.LineBasicMaterial({ color: '#60869c', transparent: true, opacity: 0.23 });
  for (let latitude = -60; latitude <= 60; latitude += 30) {
    const points = [];
    for (let longitude = 0; longitude <= 360; longitude += 3) points.push(surface(latitude, longitude, 1.002));
    grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), gridMaterial));
  }
  for (let longitude = 0; longitude < 360; longitude += 30) {
    const points = [];
    for (let latitude = -90; latitude <= 90; latitude += 3) points.push(surface(latitude, longitude, 1.002));
    grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), gridMaterial));
  }
  scene.add(grid);
  observerMarker = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), new THREE.MeshBasicMaterial({ color: '#ff8296' }));
  observerMarker.visible = false;
  scene.add(observerMarker);
  const resize = () => {
    const { width, height } = $('globeStage').getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe($('globeStage'));
  resize();
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
    positionLabels();
  });
  try {
    const land = JSON.parse(await getText(new URL('world_land_110m.json', DATA_ROOT)));
    const material = new THREE.LineBasicMaterial({ color: '#9abfae', transparent: true, opacity: 0.85 });
    for (const ring of land.rings) {
      const points = [];
      for (let index = 0; index < ring.length; index += 2) points.push(surface(ring[index + 1], ring[index], 1.003));
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
    }
  } catch { $('dataStatus').textContent += ' Land outlines unavailable.'; }
}
function surface(latitude, longitude, radius = 1) {
  return new THREE.Vector3(Math.cos(latitude * RAD) * Math.cos(longitude * RAD), Math.sin(latitude * RAD), -Math.cos(latitude * RAD) * Math.sin(longitude * RAD)).multiplyScalar(radius);
}
function makeMarkers() {
  const geometry = new THREE.SphereGeometry(0.012, 16, 12);
  for (const item of state.satellites) {
    const marker = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#bdcddd' }));
    marker.userData.id = item.id;
    markers.add(marker);
    item.marker = marker;
    const label = document.createElement('span');
    label.className = 'satellite-label';
    label.textContent = item.name;
    $('satelliteLabels').append(label);
    item.label = label;
  }
}
function updateOrbits(date) {
  while (orbits.children.length) {
    const line = orbits.children[0];
    orbits.remove(line);
    line.geometry.dispose();
    line.material.dispose();
  }
  const gmst = satellite.gstime(date);
  for (const item of state.satellites) {
    const points = [];
    const periodMs = 2 * Math.PI / item.record.no * 60000;
    for (let index = 0; index <= 180; index++) {
      try {
        const propagated = satellite.propagate(item.record, new Date(date.getTime() + periodMs * index / 180));
        if (propagated.position && Number.isFinite(propagated.position.x)) points.push(vector(satellite.eciToEcf(propagated.position, gmst)));
      } catch { break; }
    }
    if (points.length < 2) continue;
    item.orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#58758e', transparent: true, opacity: 0.3 }));
    orbits.add(item.orbit);
  }
  state.orbitAt = date.getTime();
}
function positionLabels() {
  if (!camera) return;
  const width = $('globe').clientWidth, height = $('globe').clientHeight;
  const occupied = [];
  const ordered = [...state.satellites].sort((first, second) => Number(second.id === state.selected) - Number(first.id === state.selected) || Number(second.inRange) - Number(first.inRange));
  for (const item of ordered) {
    if (!item.marker) continue;
    const point = item.marker.position;
    const direction = point.clone().sub(camera.position);
    const distance = direction.length();
    direction.normalize();
    const projection = -camera.position.dot(direction);
    const closest = camera.position.clone().addScaledVector(direction, projection);
    const occluded = projection > 0 && projection < distance && closest.lengthSq() < 1;
    screenPoint.copy(point).project(camera);
    const left = (screenPoint.x + 1) * width / 2;
    const top = (1 - screenPoint.y) * height / 2;
    const bounds = { left: left + 10, right: left + 20 + item.name.length * 6.7, top: top - 10, bottom: top + 10 };
    const overlaps = occupied.some((rect) => bounds.left < rect.right && bounds.right > rect.left && bounds.top < rect.bottom && bounds.bottom > rect.top);
    item.label.hidden = !$('showLabels').checked || !item.marker.visible || occluded || overlaps || bounds.left < 8 || bounds.right > width - 58 || bounds.top < 48 || bounds.bottom > height - 90 || screenPoint.z > 1;
    if (!item.label.hidden) occupied.push(bounds);
    item.label.style.left = `${left}px`;
    item.label.style.top = `${top}px`;
  }
}
function tick() {
  const now = new Date();
  $('utcClock').textContent = `${now.toISOString().slice(11, 19)} UTC`;
  if (!state.satellites.length || !scene) return;
  if (now.getTime() - state.orbitAt > 120000) updateOrbits(now);
  let visible = 0;
  for (const item of state.satellites) {
    item.position = atTime(item, now);
    item.inRange = item.position?.elevation != null && item.position.elevation >= state.minElevation;
    if (item.inRange) visible++;
    item.marker.visible = !!item.position;
    if (item.position) item.marker.position.copy(item.position.point);
    const selected = item.id === state.selected;
    const color = selected ? '#ffd166' : item.inRange ? '#39d89a' : '#bdcddd';
    item.marker.material.color.set(color);
    item.marker.scale.setScalar(selected ? 1.65 : item.inRange ? 1.3 : 1);
    item.label.className = `satellite-label${selected ? ' is-selected' : item.inRange ? ' in-range' : ''}`;
    if (item.orbit) {
      item.orbit.material.color.set(selected ? '#ffd166' : item.inRange ? '#39d89a' : '#58758e');
      item.orbit.material.opacity = selected ? 0.85 : item.inRange ? 0.55 : 0.25;
    }
  }
  $('visibleCount').textContent = state.observer ? `${visible} in range` : 'Location not set';
  renderList();
  updateDetails();
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function renderList() {
  const query = $('satelliteSearch').value.toLowerCase();
  const items = state.satellites.filter((item) => `${item.name} ${item.id} ${item.usages.map((usage) => usage.name).join(' ')}`.toLowerCase().includes(query) && (!$('visibleOnly').checked || item.inRange));
  const list = $('satelliteList');
  const signature = `${!!state.observer}:${items.map((item) => item.id).join(',')}`;
  if (list.dataset.signature !== signature) {
    list.replaceChildren();
    for (const item of items) {
      const row = element('button', null, 'satellite-row');
      row.type = 'button';
      row.dataset.id = item.id;
      row.append(element('strong', item.name), element('span', '', 'row-angle'), element('small', `NORAD ${item.id} / ${[...new Set(item.usages.map((usage) => usage.usage))].join(', ')}`));
      row.addEventListener('click', () => selectSatellite(item.id));
      list.append(row);
    }
    if (!items.length) list.append(element('p', state.observer ? 'No matching satellites.' : 'Set an observer location to filter by visibility.', 'list-empty'));
    list.dataset.signature = signature;
  }
  for (const row of list.querySelectorAll('button')) {
    const item = state.satellites.find((entry) => entry.id === Number(row.dataset.id));
    row.setAttribute('aria-pressed', String(item.id === state.selected));
    row.classList.toggle('in-range', item.inRange);
    row.querySelector('.row-angle').textContent = !item.position ? 'No orbit' : item.position.elevation == null ? '--' : `${item.position.elevation.toFixed(1)}\u00b0`;
  }
}
function selectSatellite(id) {
  state.selected = id;
  tick();
  predictPass();
}
function mhz(hz) { return hz == null ? '--' : `${(hz / 1e6).toFixed(5)} MHz`; }
function updateDetails() {
  const item = state.satellites.find((entry) => entry.id === state.selected);
  if (!item) return;
  const panel = $('satelliteDetails');
  if (panel.dataset.id !== String(item.id)) {
    const epoch = new Date((item.record.jdsatepoch - 2440587.5) * 86400000);
    const stale = Date.now() - epoch.getTime() > 7 * 86400000;
    panel.replaceChildren(element('h2', item.name), element('p', `NORAD ${item.id} / Epoch ${epoch.toISOString().slice(0, 10)}${stale ? ' / STALE ORBIT' : ''}`, `detail-meta${stale ? ' stale-orbit' : ''}`));
    const ground = element('p', '', 'detail-meta'); ground.id = 'groundPosition'; panel.append(ground);
    const angles = element('dl', null, 'look-angles');
    for (const [label, id] of [['Azimuth', 'azimuth'], ['Elevation', 'elevation'], ['Range', 'range']]) {
      const wrap = element('div');
      const value = element('dd', '--'); value.id = id;
      wrap.append(element('dt', label), value); angles.append(wrap);
    }
    panel.append(angles);
    const pass = element('p', 'Set an observer for pass predictions.', 'pass-status'); pass.id = 'passStatus'; panel.append(pass);
    for (const usage of item.usages) {
      const section = element('div', null, 'usage');
      const heading = element('h3');
      if (usage.infoUrl && /^https:\/\//.test(usage.infoUrl)) {
        const link = element('a', `${usage.usage} / ${usage.mode}`); link.href = usage.infoUrl; link.target = '_blank'; link.rel = 'noopener'; heading.append(link);
      } else heading.textContent = `${usage.usage} / ${usage.mode}`;
      section.append(heading, element('p', `TX ${mhz(usage.uplinkHz)}`), element('p', `RX ${mhz(usage.downlinkHz)}`));
      if (usage.ctcssHz) section.append(element('p', `CTCSS ${usage.ctcssHz.toFixed(1)} Hz`));
      panel.append(section);
    }
    panel.dataset.id = item.id;
  }
  const look = item.position?.look;
  $('azimuth').textContent = look ? `${(look.azimuth / RAD).toFixed(0)}\u00b0` : '--';
  $('elevation').textContent = look ? `${(look.elevation / RAD).toFixed(1)}\u00b0` : '--';
  $('range').textContent = look ? `${look.rangeSat.toFixed(0)} km` : '--';
  const geo = item.position?.geo;
  $('groundPosition').textContent = geo ? `${(geo.latitude / RAD).toFixed(2)}\u00b0, ${(geo.longitude / RAD).toFixed(2)}\u00b0 / Altitude ${geo.height.toFixed(0)} km` : 'Orbit cannot be propagated.';
}
async function predictPass() {
  const token = ++state.passToken;
  if (!state.observer || !$('passStatus')) return;
  const item = state.satellites.find((entry) => entry.id === state.selected);
  if (!item) return;
  const now = Date.now();
  $('passStatus').textContent = 'Calculating next pass...';
  let rise = null, peak = -90, previous = now;
  const alreadyUp = (atTime(item, new Date(now))?.elevation ?? -90) >= state.minElevation;
  for (let step = 0; step <= 2880; step++) {
    if (token !== state.passToken) return;
    const time = now + step * 30000;
    const elevation = atTime(item, new Date(time))?.elevation ?? -90;
    if (elevation >= state.minElevation) {
      if (rise == null) {
        let low = previous, high = time;
        while (high - low > 1000) {
          const middle = (low + high) / 2;
          if ((atTime(item, new Date(middle))?.elevation ?? -90) >= state.minElevation) high = middle; else low = middle;
        }
        rise = high;
      }
      peak = Math.max(peak, elevation);
    } else if (rise != null) {
      const format = (stamp) => new Date(stamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      $('passStatus').textContent = `${alreadyUp ? 'In range now, until' : 'Next pass (local):'} ${format(alreadyUp ? time : rise)}${alreadyUp ? '' : ` - ${new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}. Peak${alreadyUp ? ' remaining' : ''}: ${peak.toFixed(0)}\u00b0.`;
      return;
    }
    previous = time;
    if (step % 120 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (token === state.passToken) $('passStatus').textContent = rise == null ? 'No pass above your minimum elevation in the next 24 hours.' : 'Satellite remains in range beyond the prediction window.';
}
function setObserver(latitude, longitude, minimum, save = true) {
  if (![latitude, longitude, minimum].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || minimum < 0 || minimum > 90) return;
  state.observer = { latitude: latitude * RAD, longitude: longitude * RAD, height: 0 };
  state.minElevation = minimum;
  $('latitude').value = latitude;
  $('longitude').value = longitude;
  $('minElevation').value = minimum;
  $('observerStatus').textContent = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
  if (save) store(OBSERVER_KEY, { latitude, longitude, minimum });
  if (observerMarker) {
    observerMarker.position.copy(surface(latitude, longitude, 1.015)); observerMarker.visible = true;
    if (footprint) { scene.remove(footprint); footprint.geometry.dispose(); footprint.material.dispose(); }
    const up = surface(latitude, longitude);
    const east = surface(0, longitude + 90);
    const north = new THREE.Vector3().crossVectors(up, east).normalize();
    const points = [];
    const length = 0.32;
    for (let index = 0; index <= 80; index++) {
      const angle = index * Math.PI / 40;
      const direction = up.clone().multiplyScalar(Math.sin(minimum * RAD)).addScaledVector(east, Math.cos(angle) * Math.cos(minimum * RAD)).addScaledVector(north, Math.sin(angle) * Math.cos(minimum * RAD));
      const edge = up.clone().multiplyScalar(1.005).addScaledVector(direction, length);
      points.push(edge);
      if (index % 10 === 0) points.push(up.clone().multiplyScalar(1.005), edge.clone());
    }
    footprint = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#ff8296', transparent: true, opacity: 0.5 }));
    scene.add(footprint);
    centerObserver();
    tick(); predictPass();
  }
}
function centerObserver() {
  if (!state.observer || !camera) return;
  camera.position.copy(surface(state.observer.latitude / RAD - 20, state.observer.longitude / RAD, 4.3));
  controls.target.set(0, 0, 0); controls.update();
}
function wireControls() {
  $('observerForm').addEventListener('submit', (event) => { event.preventDefault(); setObserver(Number($('latitude').value), Number($('longitude').value), Number($('minElevation').value)); });
  $('minElevation').addEventListener('change', () => { if (state.observer) setObserver(state.observer.latitude / RAD, state.observer.longitude / RAD, Number($('minElevation').value)); });
  $('useLocation').addEventListener('click', () => {
    if (!navigator.geolocation) { $('observerStatus').textContent = 'Geolocation unavailable. Enter coordinates manually.'; return; }
    $('observerStatus').textContent = 'Requesting location...';
    navigator.geolocation.getCurrentPosition((position) => setObserver(position.coords.latitude, position.coords.longitude, Number($('minElevation').value)), () => { $('observerStatus').textContent = 'Location unavailable. Enter coordinates manually.'; }, { timeout: 15000, maximumAge: 300000 });
  });
  $('satelliteSearch').addEventListener('input', renderList);
  $('visibleOnly').addEventListener('change', renderList);
  $('showOrbits').addEventListener('change', () => { orbits.visible = $('showOrbits').checked; });
  $('autoRotate').addEventListener('change', () => { controls.autoRotate = $('autoRotate').checked; });
  $('zoomIn').addEventListener('click', () => { camera.position.multiplyScalar(0.8); controls.update(); });
  $('zoomOut').addEventListener('click', () => { camera.position.multiplyScalar(1.25); controls.update(); });
  $('centerView').addEventListener('click', centerObserver);
  $('resetView').addEventListener('click', () => { camera.position.set(0, 1.3, 4.1); controls.target.set(0, 0, 0); controls.update(); });
  $('fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen(); else await $('globeStage').requestFullscreen();
    } catch { $('observerStatus').textContent = 'Full screen is unavailable in this browser.'; }
  });
  let down = null;
  $('globe').addEventListener('pointerdown', (event) => { down = { x: event.clientX, y: event.clientY }; });
  $('globe').addEventListener('pointerup', (event) => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
    const rect = $('globe').getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects([earth, ...markers.children])[0];
    if (hit?.object.userData.id) selectSatellite(hit.object.userData.id);
  });
  $('globe').addEventListener('keydown', (event) => {
    const directions = { ArrowLeft: -0.12, ArrowRight: 0.12 };
    if (event.key in directions) { event.preventDefault(); camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), directions[event.key]); controls.update(); }
    if (event.key === '+' || event.key === '=') $('zoomIn').click();
    if (event.key === '-') $('zoomOut').click();
  });
}
async function init() {
  try {
    await Promise.all([loadCatalog(), buildGlobe()]);
    makeMarkers();
    wireControls();
    const saved = stored(OBSERVER_KEY);
    if (saved) setObserver(saved.latitude, saved.longitude, saved.minimum, false);
    tick(); predictPass();
    $('globeMessage').hidden = true;
    setInterval(tick, 1000);
    setInterval(predictPass, 60000);
  } catch (error) {
    $('globeMessage').hidden = false;
    $('globeMessage').textContent = `Unable to load the tracker. Check your connection and WebGL support, then reload. ${error.message}`;
    $('dataStatus').textContent = 'Satellite tracking unavailable.';
    console.error(error);
  }
}
init();