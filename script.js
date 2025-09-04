const MAPTILER_KEY = "JwMEsUIjS86xRPmDczqz";

// Vista iniziale Torino
const INITIAL_CENTER = [45.07, 7.69];
const INITIAL_ZOOM = 15;
const MIN_MAP_ZOOM = 10;
const MIN_LAYER_ZOOM = MIN_MAP_ZOOM - 1;
const MAX_MAP_ZOOM = 19;
let currentVisibleRouteId = null;
let currentVisibleStopId = null;
let STOP_MARKERS = {};
let lineMode = false;
let lineStopMarkers = [];

const map = L.map("map", {
	center: INITIAL_CENTER,
	zoom: INITIAL_ZOOM,
	maxZoom: MAX_MAP_ZOOM,
	minZoom: MIN_MAP_ZOOM,
});

L.maptiler
	.maptilerLayer({
		apiKey: MAPTILER_KEY,
		style: "https://api.maptiler.com/maps/0197657b-84fb-74e1-94aa-0d013b607aa9/style.json?key=" + MAPTILER_KEY,
		maxNativeZoom: 19,
		maxZoom: MAX_MAP_ZOOM,
		minZoom: MIN_LAYER_ZOOM,
	})
	.addTo(map);

// Icone custom
const stopIcon = L.icon({
	iconUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
	iconSize: [22, 22],
	iconAnchor: [11, 22],
	popupAnchor: [0, -20],
});

const userIcon = L.icon({
	iconUrl: "https://cdn-icons-png.flaticon.com/512/149/149060.png",
	iconSize: [28, 28],
	iconAnchor: [14, 28],
	popupAnchor: [0, -25],
});

// Cluster per fermate
const clusters = L.markerClusterGroup({
	disableClusteringAtZoom: 17,
	maxClusterRadius: 200,
	spiderfyOnMaxZoom: false,
	showCoverageOnHover: true,
	zoomToBoundsOnClick: true,
	iconCreateFunction: function (cluster) {
		const count = cluster.getChildCount();
		const size = Math.min(60, 45 + count / 20);
		const opacity = Math.min(1, 0.5 + count / 200);
		return L.divIcon({
			html: `<div style="
              background: rgba(0, 102, 204, ${opacity});
              width: ${size}px; height: ${size}px;
              line-height: ${size}px;
              border-radius: 50%;
              color: white; text-align: center;
              font-weight: bold; font-size: 14px;">
                ${count}
             </div>`,
			className: "custom-cluster-icon",
			iconSize: [size, size],
		});
	},
});
map.addLayer(clusters);

// Marker utente
let userMarker = null;

// Dati GTFS
let GTFS_STOPS, GTFS_ROUTES, GTFS_TRIPS, GTFS_SERVICES, GTFS_SHAPES;

// Layer percorsi attivi
let activeShapes = [];

// --- Funzioni utili ---
async function loadData() {
	try {
		const [stops, routes, trips, services, shapes] = await Promise.all([
			fetch("public_data/stops.json").then((r) => r.json()),
			fetch("public_data/routes.json").then((r) => r.json()),
			fetch("public_data/trips.json").then((r) => r.json()),
			fetch("public_data/services.json").then((r) => r.json()),
			fetch("public_data/shapes.json").then((r) => r.json()),
		]);

		GTFS_STOPS = stops;
		GTFS_ROUTES = routes;
		GTFS_TRIPS = trips;
		GTFS_SERVICES = services;
		GTFS_SHAPES = shapes;

		const now = new Date();
		const today = now.toISOString().split("T")[0];
		document.getElementById("datePicker").value = today;
		document.getElementById("timePicker").value = now.toTimeString().slice(0, 5);

		for (const stop of Object.values(GTFS_STOPS)) {
  const marker = L.marker([stop.stop_lat, stop.stop_lon], { icon: stopIcon });

  marker._stopId = stop.stop_id; // salva stopId dentro il marker
  marker.bindPopup("<i>Caricamento...</i>");
  marker.on("click", () => {
    const popup = marker.getPopup();
    if (!popup) return;
    popup.setContent("<i>Caricamento...</i>");
    setTimeout(() => {
      const html = popupContent(stop.stop_id);
      popup.setContent(html);
    }, 10);
  });

  clusters.addLayer(marker);
  STOP_MARKERS[stop.stop_id] = marker; // <— salva il riferimento
}
	} catch (err) {
		alert("Errore durante il caricamento dei dati: " + err.message);
	}
}

// unica definizione globale!
function isTripActive(serviceId, dateStr, timeStr) {
	const svc = GTFS_SERVICES[serviceId];
	if (!svc) return false;

	// --- Check date range ---
	if (dateStr < svc.start_date || dateStr > svc.end_date) return false;

	// --- Check weekday ---
	const d = new Date(dateStr.slice(0, 4), parseInt(dateStr.slice(4, 6)) - 1, dateStr.slice(6, 8));
	const dow = d.getDay(); // 0=dom
	const mapDays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
	if (svc.days[mapDays[dow]] !== 1) return false;

	// --- Check calendar exceptions ---
	for (const ex of svc.dates) {
		if (ex.date === dateStr) {
			return ex.exception_type === 1; // 1=aggiunta, 2=rimozione
		}
	}

	// --- Check time range (se disponibile) ---
	if (timeStr && svc.start_time && svc.end_time) {
		const [h, m] = timeStr.split(":").map(Number);
		const currentSeconds = h * 3600 + m * 60;

		const [sh, sm, ss = 0] = svc.start_time.split(":").map(Number);
		const [eh, em, es = 0] = svc.end_time.split(":").map(Number);
		const startSec = sh * 3600 + sm * 60 + ss;
		const endSec = eh * 3600 + em * 60 + es;

		if (currentSeconds < startSec || currentSeconds > endSec) {
			return false;
		}
	}

	return true;
}

function locateUser() {
	if (!navigator.geolocation) {
		alert("Geolocalizzazione non supportata");
		return;
	}
	navigator.geolocation.getCurrentPosition(
		(pos) => {
			const { latitude, longitude } = pos.coords;
			if (userMarker) {
				userMarker.setLatLng([latitude, longitude]);
			} else {
				userMarker = L.marker([latitude, longitude], { icon: userIcon }).bindPopup("Tu sei qui").addTo(map);
			}
			map.setView([latitude, longitude], 15);
		},
		(err) => {
			alert("Errore geolocalizzazione: " + err.message);
		}
	);
}

function resetView() {
	closeLine();
	map.setView(INITIAL_CENTER, INITIAL_ZOOM);
}

function clearShapes() {
	activeShapes.forEach((l) => map.removeLayer(l));
	activeShapes = [];
}

function clearLineStops() {
	lineStopMarkers.forEach((m) => map.removeLayer(m));
	lineStopMarkers = [];
}

function clearRouteShapesOnly() {
	activeShapes.forEach((l) => map.removeLayer(l));
	activeShapes = [];
}


document.getElementById("btnCloseLine").onclick = closeLine;

function popupContent(stopId) {
	try {
		const selectedDate = document.getElementById("datePicker").value.replace(/-/g, "");
		const selectedTime = document.getElementById("timePicker").value;

		const stop = GTFS_STOPS[stopId];
		if (!stop) return `<i>Fermata sconosciuta</i>`;

		const activeTrips = Object.entries(GTFS_TRIPS).filter(([tid, trip]) => {
			return trip?.stops?.includes(stopId) && isTripActive(trip.service_id, selectedDate, selectedTime);
		});

		if (activeTrips.length === 0) {
			return `<b>${stop.stop_name}</b><br><i>Nessuna linea attiva oggi</i>`;
		}

		// Raggruppa i trip per route_id
		const routesForStop = {};
		for (const [tid, trip] of activeTrips) {
			const rid = trip.route_id;
			if (!routesForStop[rid]) routesForStop[rid] = [];
			routesForStop[rid].push(tid);
		}

		let html = `<b>${stop.stop_name}</b><br><form class="popup-form">`;

		let first = true;
		for (const [routeId, tripIds] of Object.entries(routesForStop)) {
			const route = GTFS_ROUTES[routeId];
			const label = route?.short_name || `ID ${routeId}`;
			const isCurrent = routeId === currentVisibleRouteId && stopId === currentVisibleStopId;
			const checked = isCurrent || first;

			html += `<label>
    <input type="radio" name="routeChoice-${stopId}" value="${routeId}" 
      ${checked ? "checked" : ""} 
      onclick="showRoute('${stopId}', '${routeId}')">
    Linea ${label}
  </label><br>`;

			if (first && !isCurrent) {
				showRoute(stopId, routeId);
			}
			first = false;
		}

		html += `</form>`;
		return html;
	} catch (e) {
		console.error("Errore in popupContent per stopId:", stopId, e);
		return `<i>Errore nel caricamento</i>`;
	}
}

function showRoute(stopId, routeId) {
  // NON tocchiamo il popup in corso.
  // Puliamo solo le polylines (non i marker della linea)
  clearRouteShapesOnly();

  currentVisibleRouteId = routeId;
  currentVisibleStopId = stopId;
  lineMode = true;

  const selectedDate = document.getElementById("datePicker").value.replace(/-/g, "");
  const selectedTime = document.getElementById("timePicker").value;

  // Tutti i trips attivi per la route
  const tripsForRoute = Object.entries(GTFS_TRIPS).filter(([tid, trip]) =>
    trip.route_id === routeId && isTripActive(trip.service_id, selectedDate, selectedTime)
  );

  // Prendi una variante per direzione
  const tripsByDir = {};
  for (const [tid, trip] of tripsForRoute) {
    const dir = trip.direction_id || "0";
    if (!tripsByDir[dir]) tripsByDir[dir] = trip;
  }

  // Set di fermate coinvolte (unione delle due direzioni)
  const stopsSet = new Set();
  for (const dir in tripsByDir) {
    const trip = tripsByDir[dir];
    if (!trip) continue;

    const coords = GTFS_SHAPES[trip.shape_id];
    if (!coords) continue;

    const polyline = L.polyline(coords, {
      color: dir === "0" ? "#c84949ff" : "#2b70cbff",
      weight: 4,
      opacity: 0.85,
      offset: 6,
    }).addTo(map);
    activeShapes.push(polyline);

    trip.stops.forEach((sid) => stopsSet.add(sid));
  }

  // 1) Disabilita il clustering (così i marker di linea non si ri-aggregano)
  if (clusters.disableClustering) clusters.disableClustering();

  // 2) Mantieni SOLO i marker delle fermate della linea dentro clusters
  //    - i marker della linea: li lasciamo dov'erano (se per caso non ci sono, li riaggiungiamo)
  //    - tutti gli altri: li rimuoviamo dal layer clusters (ma NON distruggiamo l'istanza)
  //       (così non "tocchiamo" quelli di linea e non chiudiamo il popup corrente)
  for (const [sid, marker] of Object.entries(STOP_MARKERS)) {
    const inLine = stopsSet.has(sid);
    const has = clusters.hasLayer(marker);

    if (inLine) {
      if (!has) clusters.addLayer(marker); // se non c'è, lo aggiungiamo (non stiamo rimuovendo/riaggiungendo quelli di linea)
      marker.setOpacity(1);
    } else {
      if (has) clusters.removeLayer(marker); // rimuovi tutti i NON-linea
    }
  }

  showCloseButton();
}

function closeLine() {
	clusters.enableClustering();
  clearShapes();
  clearLineStops();

  clusters.clearLayers();
  for (const marker of Object.values(STOP_MARKERS)) {
    clusters.addLayer(marker);
  }

  currentVisibleRouteId = null;
  currentVisibleStopId  = null;
  lineMode = false;
  hideCloseButton();
}

// --- Eventi UI ---
function showCloseButton() {
	document.getElementById("btnCloseLine").style.display = "block";
}
function hideCloseButton() {
	document.getElementById("btnCloseLine").style.display = "none";
}
document.getElementById("btnReset").onclick = resetView;
document.getElementById("btnLocate").onclick = locateUser;

// --- Inizializzazione ---
loadData();
