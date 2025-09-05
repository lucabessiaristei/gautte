// Configuration constants
const CONFIG = {
	MAPTILER_KEY: "JwMEsUIjS86xRPmDczqz",
	INITIAL_CENTER: [45.07, 7.69],
	INITIAL_ZOOM: 15,
	MIN_MAP_ZOOM: 10,
	MAX_MAP_ZOOM: 19,
	CLUSTER_DISABLE_ZOOM: 17,
	CLUSTER_MAX_RADIUS: 200,
	BASE_URL: window.location.origin + window.location.pathname.replace(/index\.html$/, ""),
	ROUTE_COLORS: {
		direction0: "#c84949",
		direction1: "#2b70cb",
	},
	STOP_COLORS: {
		default: "#666666",
		direction0: "#c84949",
		direction1: "#2b70cb",
		both: "#9c27b0",
		unavailable: "#cccccc",
	},
	ICON_SIZES: {
		stop: [20, 20],
		user: [24, 24],
	},
};

// Global state management
class TransitMapState {
	constructor() {
		this.currentVisibleRouteId = null;
		this.currentVisibleStopId = null;
		this.lineMode = false;
		this.stopMarkers = new Map();
		this.activeShapes = [];
		this.userMarker = null;

		this.gtfsData = {
			stops: null,
			routes: null,
			trips: null,
			services: null,
			shapes: null,
		};
	}

	reset() {
		this.currentVisibleRouteId = null;
		this.currentVisibleStopId = null;
		this.lineMode = false;
	}

	clearShapes() {
		this.activeShapes.forEach((layer) => map.removeLayer(layer));
		this.activeShapes.length = 0;
	}
}

const state = new TransitMapState();

// SVG Icon creation functions
class IconFactory {
	static createStopIcon(color = CONFIG.STOP_COLORS.default) {
		const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="9" fill="${color}" stroke="white" stroke-width="2"/>
        <rect x="5" y="6" width="10" height="6" rx="1" fill="white"/>
        <circle cx="7" cy="14" r="1.5" fill="white"/>
        <circle cx="13" cy="14" r="1.5" fill="white"/>
        <rect x="7" y="8" width="6" height="2" fill="${color}"/>
      </svg>
    `;

		return L.divIcon({
			html: svg,
			className: "custom-stop-icon",
			iconSize: CONFIG.ICON_SIZES.stop,
			iconAnchor: [10, 10],
			popupAnchor: [0, -10],
		});
	}

	static createUserIcon() {
		const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="11" fill="#4285f4" stroke="white" stroke-width="2"/>
        <circle cx="12" cy="9" r="3" fill="white"/>
        <path d="M6 19c0-4 2.7-6 6-6s6 2 6 6" fill="white"/>
      </svg>
    `;

		return L.divIcon({
			html: svg,
			className: "custom-user-icon",
			iconSize: CONFIG.ICON_SIZES.user,
			iconAnchor: [12, 12],
			popupAnchor: [0, -12],
		});
	}
}

// Initialize map
const map = L.map("map", {
	center: CONFIG.INITIAL_CENTER,
	zoom: CONFIG.INITIAL_ZOOM,
	maxZoom: CONFIG.MAX_MAP_ZOOM,
	minZoom: CONFIG.MIN_MAP_ZOOM,
});

// Add base layer
L.maptiler
	.maptilerLayer({
		apiKey: CONFIG.MAPTILER_KEY,
		style: `https://api.maptiler.com/maps/0197657b-84fb-74e1-94aa-0d013b607aa9/style.json?key=${CONFIG.MAPTILER_KEY}`,
		maxNativeZoom: 19,
		maxZoom: CONFIG.MAX_MAP_ZOOM,
		minZoom: CONFIG.MIN_MAP_ZOOM - 1,
	})
	.addTo(map);

// Initialize cluster group
const clusters = L.markerClusterGroup({
	disableClusteringAtZoom: CONFIG.CLUSTER_DISABLE_ZOOM,
	maxClusterRadius: CONFIG.CLUSTER_MAX_RADIUS,
	spiderfyOnMaxZoom: false,
	showCoverageOnHover: true,
	zoomToBoundsOnClick: true,
	iconCreateFunction: (cluster) => {
		const count = cluster.getChildCount();
		const size = Math.min(60, 45 + count / 20);
		const opacity = Math.min(1, 0.5 + count / 200);

		const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" 
                fill="rgba(0, 102, 204, ${opacity})" stroke="white" stroke-width="2"/>
        <text x="${size / 2}" y="${size / 2}" text-anchor="middle" dy=".3em" 
              fill="white" font-size="14" font-weight="bold">${count}</text>
      </svg>
    `;

		return L.divIcon({
			html: svg,
			className: "custom-cluster-icon",
			iconSize: [size, size],
		});
	},
});

map.addLayer(clusters);

// Data loading
class DataLoader {
	static async loadAllData() {
		try {
			const endpoints = ["stops", "routes", "trips", "services", "shapes"].map((name) => `public_data/${name}.json`);

			const responses = await Promise.all(endpoints.map((url) => {
				console.log(`Loading ${url}`);
				return fetch(url).then((r) => r.json())
			}));

			const [stops, routes, trips, services, shapes] = responses;

			state.gtfsData = { stops, routes, trips, services, shapes };

			DataLoader.initializeDateTimeInputs();
			DataLoader.createStopMarkers();
		} catch (error) {
			console.error("Data loading error:", error);
			alert(`Error loading data: ${error.message}`);
		}
	}

	static initializeDateTimeInputs() {
		const now = new Date();
		const today = now.toISOString().split("T")[0];
		const currentTime = now.toTimeString().slice(0, 5);

		document.getElementById("datePicker").value = today;
		document.getElementById("timePicker").value = currentTime;
	}

	static createStopMarkers() {
		const { stops } = state.gtfsData;

		Object.values(stops).forEach((stop) => {
			const marker = L.marker([stop.stop_lat, stop.stop_lon], {
				icon: IconFactory.createStopIcon(),
			});

			marker._stopId = stop.stop_id;
			marker.bindPopup("<i>Loading...</i>");
			marker.on("click", () => PopupManager.handleMarkerClick(marker, stop.stop_id));

			clusters.addLayer(marker);
			state.stopMarkers.set(stop.stop_id, marker);
		});
	}
}

// Trip validation
class TripValidator {
	static isTripActive(serviceId, dateStr, timeStr) {
		const service = state.gtfsData.services[serviceId];
		if (!service) return false;

		// Date range check
		if (dateStr < service.start_date || dateStr > service.end_date) {
			return false;
		}

		// Weekday check
		if (!TripValidator.isValidWeekday(service, dateStr)) {
			return false;
		}

		// Calendar exceptions
		const exceptionResult = TripValidator.checkCalendarExceptions(service, dateStr);
		if (exceptionResult !== null) return exceptionResult;

		// Time range check
		if (timeStr && service.start_time && service.end_time) {
			return TripValidator.isValidTimeRange(service, timeStr);
		}

		return true;
	}

	static isValidWeekday(service, dateStr) {
		const date = new Date(dateStr.slice(0, 4), parseInt(dateStr.slice(4, 6)) - 1, dateStr.slice(6, 8));
		const dayOfWeek = date.getDay();
		const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

		return service.days[dayNames[dayOfWeek]] === 1;
	}

	static checkCalendarExceptions(service, dateStr) {
		const exception = service.dates?.find((ex) => ex.date === dateStr);
		if (exception) {
			return exception.exception_type === 1;
		}
		return null;
	}

	static isValidTimeRange(service, timeStr) {
		const [h, m] = timeStr.split(":").map(Number);
		const currentSeconds = h * 3600 + m * 60;

		const parseTime = (timeString) => {
			const [hours, minutes, seconds = 0] = timeString.split(":").map(Number);
			return hours * 3600 + minutes * 60 + seconds;
		};

		const startSeconds = parseTime(service.start_time);
		const endSeconds = parseTime(service.end_time);

		return currentSeconds >= startSeconds && currentSeconds <= endSeconds;
	}
}

// Popup management
class PopupManager {
	static handleMarkerClick(marker, stopId) {
		const popup = marker.getPopup();
		if (!popup) return;

		popup.setContent("<i>Loading...</i>");

		setTimeout(() => {
			const html = PopupManager.generatePopupContent(stopId);
			popup.setContent(html);
		}, 10);
	}

	static generatePopupContent(stopId) {
		try {
			const selectedDate = document.getElementById("datePicker").value.replace(/-/g, "");
			const selectedTime = document.getElementById("timePicker").value;

			const stop = state.gtfsData.stops[stopId];
			if (!stop) return "<i>Unknown stop</i>";

			const activeTrips = PopupManager.getActiveTripsForStop(stopId, selectedDate, selectedTime);

			if (activeTrips.length === 0) {
				return `<b>${stop.stop_name}</b><br><i>No active lines today</i>`;
			}

			return PopupManager.buildPopupHTML(stop, activeTrips, stopId);
		} catch (error) {
			console.error("Error generating popup content for stopId:", stopId, error);
			return "<i>Error loading content</i>";
		}
	}

	static getActiveTripsForStop(stopId, dateStr, timeStr) {
		return Object.entries(state.gtfsData.trips).filter(([tripId, trip]) => {
			return trip?.stops?.includes(stopId) && TripValidator.isTripActive(trip.service_id, dateStr, timeStr);
		});
	}

	static buildPopupHTML(stop, activeTrips, stopId) {
		const routeGroups = new Map();
		activeTrips.forEach(([tripId, trip]) => {
			const routeId = trip.route_id;
			if (!routeGroups.has(routeId)) {
				routeGroups.set(routeId, []);
			}
			routeGroups.get(routeId).push(tripId);
		});

		let html = `<b>${stop.stop_name}</b><br><form class="popup-form">`;
		let isFirst = true;

		for (const [routeId] of routeGroups) {
			const route = state.gtfsData.routes[routeId];
			const label = route?.short_name || `ID ${routeId}`;
			const isCurrent = routeId === state.currentVisibleRouteId && stopId === state.currentVisibleStopId;
			const checked = isCurrent || isFirst;

			html += `<label>
        <input type="radio" name="routeChoice-${stopId}" value="${routeId}" 
          ${checked ? "checked" : ""} 
          onclick="RouteManager.showRoute('${stopId}', '${routeId}')">
        Line ${label}
      </label><br>`;

			if (isFirst && !isCurrent) {
				RouteManager.showRoute(stopId, routeId);
			}
			isFirst = false;
		}

		html += "</form>";
		return html;
	}
}

// Route management
class RouteManager {
	static showRoute(stopId, routeId) {
		state.clearShapes();

		state.currentVisibleRouteId = routeId;
		state.currentVisibleStopId = stopId;
		state.lineMode = true;

		const selectedDate = document.getElementById("datePicker").value.replace(/-/g, "");
		const selectedTime = document.getElementById("timePicker").value;

		const routeTrips = RouteManager.getActiveTripsForRoute(routeId, selectedDate, selectedTime);
		const tripsByDirection = RouteManager.groupTripsByDirection(routeTrips);

		const allStops = new Set();
		const stopDirections = new Map();

		Object.entries(tripsByDirection).forEach(([direction, trip]) => {
			RouteManager.drawRouteShape(trip, direction, allStops);

			trip.stops?.forEach((stopId) => {
				if (!stopDirections.has(stopId)) {
					stopDirections.set(stopId, new Set());
				}
				stopDirections.get(stopId).add(direction);
			});
		});

		RouteManager.updateVisibleStops(allStops, stopDirections);
		UIManager.showCloseButton();
	}

	static getActiveTripsForRoute(routeId, dateStr, timeStr) {
		return Object.entries(state.gtfsData.trips).filter(([tripId, trip]) => trip.route_id === routeId && TripValidator.isTripActive(trip.service_id, dateStr, timeStr));
	}

	static groupTripsByDirection(trips) {
		const groups = {};
		trips.forEach(([tripId, trip]) => {
			const direction = trip.direction_id || "0";
			if (!groups[direction]) {
				groups[direction] = trip;
			}
		});
		return groups;
	}

	static drawRouteShape(trip, direction, allStops) {
		const coordinates = state.gtfsData.shapes[trip.shape_id];
		if (!coordinates) return;

		const color = direction === "0" ? CONFIG.ROUTE_COLORS.direction0 : CONFIG.ROUTE_COLORS.direction1;

		const polyline = L.polyline(coordinates, {
			color,
			weight: 4,
			opacity: 0.85,
			offset: 6,
		}).addTo(map);

		state.activeShapes.push(polyline);
		trip.stops?.forEach((stopId) => allStops.add(stopId));
	}

	static updateVisibleStops(lineStops, stopDirections) {
		if (clusters.disableClustering) {
			clusters.disableClustering();
		}

		state.stopMarkers.forEach((marker, stopId) => {
			const isInLine = lineStops.has(stopId);
			const hasLayer = clusters.hasLayer(marker);

			if (isInLine) {
				if (!hasLayer) clusters.addLayer(marker);
				marker.setOpacity(1);
				RouteManager.updateMarkerColor(marker, stopId, stopDirections);
			} else {
				if (hasLayer) clusters.removeLayer(marker);
			}
		});
	}

	static updateMarkerColor(marker, stopId, stopDirections) {
		const directions = stopDirections.get(stopId);
		if (!directions) return;

		let color;
		if (directions.has("0") && directions.has("1")) {
			color = CONFIG.STOP_COLORS.both;
		} else if (directions.has("0")) {
			color = CONFIG.STOP_COLORS.direction0;
		} else if (directions.has("1")) {
			color = CONFIG.STOP_COLORS.direction1;
		} else {
			color = CONFIG.STOP_COLORS.default;
		}

		const newIcon = IconFactory.createStopIcon(color);
		marker.setIcon(newIcon);
	}

	static closeLine() {
		clusters.enableClustering();
		state.clearShapes();

		clusters.clearLayers();
		state.stopMarkers.forEach((marker) => {
			marker.setIcon(IconFactory.createStopIcon());
			clusters.addLayer(marker);
		});

		state.reset();
		UIManager.hideCloseButton();
	}
}

// Geolocation
class LocationManager {
	static locateUser() {
		if (!navigator.geolocation) {
			alert("Geolocation not supported");
			return;
		}

		navigator.geolocation.getCurrentPosition(
			(position) => {
				const { latitude, longitude } = position.coords;
				LocationManager.updateUserLocation(latitude, longitude);
			},
			(error) => {
				alert(`Geolocation error: ${error.message}`);
			}
		);
	}

	static updateUserLocation(lat, lng) {
		if (state.userMarker) {
			state.userMarker.setLatLng([lat, lng]);
		} else {
			state.userMarker = L.marker([lat, lng], {
				icon: IconFactory.createUserIcon(),
			})
				.bindPopup("You are here")
				.addTo(map);
		}
		map.setView([lat, lng], 15);
	}
}

// UI Management
class UIManager {
	static showCloseButton() {
		document.getElementById("btnCloseLine").style.display = "block";
	}

	static hideCloseButton() {
		document.getElementById("btnCloseLine").style.display = "none";
	}

	static resetView() {
		RouteManager.closeLine();
		map.setView(CONFIG.INITIAL_CENTER, CONFIG.INITIAL_ZOOM);
	}

	static initializeEventListeners() {
		document.getElementById("btnReset").onclick = UIManager.resetView;
		document.getElementById("btnLocate").onclick = LocationManager.locateUser;
		document.getElementById("btnCloseLine").onclick = RouteManager.closeLine;
	}
}

// Make RouteManager globally accessible for onclick handlers
window.RouteManager = RouteManager;

// Add date/time change listeners to refresh stop availability
// function refreshStopAvailability() {
// 	const selectedDate = document.getElementById("datePicker").value.replace(/-/g, "");
// 	const selectedTime = document.getElementById("timePicker").value;

// 	// Update all stop markers based on new date/time
// 	state.stopMarkers.forEach((marker, stopId) => {
// 		const hasActiveServices = DataLoader.hasActiveServices(stopId, selectedDate, selectedTime);
// 		marker._hasActiveServices = hasActiveServices;

// 		// Only update if not in line mode (line mode handles its own coloring)
// 		if (!state.lineMode) {
// 			const icon = hasActiveServices ? IconFactory.createStopIcon(CONFIG.STOP_COLORS.default, true) : IconFactory.createStopIcon(CONFIG.STOP_COLORS.unavailable, false);

// 			marker.setIcon(icon);
// 		}
// 	});
// }

// Initialize application
document.addEventListener("DOMContentLoaded", () => {
	UIManager.initializeEventListeners();
	DataLoader.loadAllData().then(() => {
		// Add listeners for date/time changes
		// document.getElementById("datePicker").addEventListener("change", refreshStopAvailability);
		// document.getElementById("timePicker").addEventListener("change", refreshStopAvailability);

		console.log("Transit map loaded successfully");
	});
});
