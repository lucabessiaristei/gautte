const CONFIG = {
            INITIAL_CENTER: [7.69, 45.07], // Note: MapLibre uses [lng, lat]
            INITIAL_ZOOM: 15,
            MIN_ZOOM: 10,
            MAX_ZOOM: 19,
            CLUSTER_RADIUS: 50,
            CLUSTER_MAX_ZOOM: 16,
            ROUTE_COLORS: {
                direction0: '#c84949',
                direction1: '#2b70cb'
            },
            STOP_COLORS: {
                default: '#666666',
                direction0: '#c84949',
                direction1: '#2b70cb',
                both: '#9c27b0',
                unavailable: '#cccccc'
            }
        };

        // Global state
        class TransitMapState {
            constructor() {
                this.currentVisibleRouteId = null;
                this.currentVisibleStopId = null;
                this.lineMode = false;
                this.activeRoutes = [];
                this.gtfsData = {
                    stops: null,
                    routes: null,
                    trips: null,
                    services: null,
                    shapes: null
                };
                this.stopPopups = new Map();
                this.clusterSource = null;
            }

            reset() {
                this.currentVisibleRouteId = null;
                this.currentVisibleStopId = null;
                this.lineMode = false;
            }

            clearRoutes() {
                this.activeRoutes.forEach(routeId => {
                    if (map.getLayer(routeId)) {
                        map.removeLayer(routeId);
                    }
                    if (map.getSource(routeId)) {
                        map.removeSource(routeId);
                    }
                });
                this.activeRoutes = [];
            }
        }

        const state = new TransitMapState();
        let map;

        // Polyline offset implementation
        class PolylineOffset {
            static offsetLine(coordinates, offset) {
                if (coordinates.length < 2) return coordinates;
                
                const segments = [];
                
                // Create offset segments
                for (let i = 0; i < coordinates.length - 1; i++) {
                    const a = coordinates[i];
                    const b = coordinates[i + 1];
                    
                    const dx = b[0] - a[0];
                    const dy = b[1] - a[1];
                    const len = Math.sqrt(dx * dx + dy * dy);
                    
                    if (len === 0) continue;
                    
                    // Perpendicular vector (rotated 90 degrees)
                    const perpX = -dy / len;
                    const perpY = dx / len;
                    
                    segments.push({
                        original: [a, b],
                        offset: [
                            [a[0] + perpX * offset, a[1] + perpY * offset],
                            [b[0] + perpX * offset, b[1] + perpY * offset]
                        ]
                    });
                }
                
                // Join segments
                const result = [];
                if (segments.length > 0) {
                    result.push(segments[0].offset[0]);
                    
                    for (let i = 0; i < segments.length - 1; i++) {
                        const s1 = segments[i];
                        const s2 = segments[i + 1];
                        
                        // Find intersection of offset lines
                        const intersection = this.lineIntersection(
                            s1.offset[0], s1.offset[1],
                            s2.offset[0], s2.offset[1]
                        );
                        
                        if (intersection) {
                            result.push(intersection);
                        } else {
                            result.push(s1.offset[1]);
                            result.push(s2.offset[0]);
                        }
                    }
                    
                    result.push(segments[segments.length - 1].offset[1]);
                }
                
                return result;
            }
            
            static lineIntersection(p1, p2, p3, p4) {
                const x1 = p1[0], y1 = p1[1];
                const x2 = p2[0], y2 = p2[1];
                const x3 = p3[0], y3 = p3[1];
                const x4 = p4[0], y4 = p4[1];
                
                const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
                if (Math.abs(denom) < 0.0000001) return null;
                
                const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
                
                return [
                    x1 + t * (x2 - x1),
                    y1 + t * (y2 - y1)
                ];
            }
        }

        // Initialize map
        function initMap() {
            map = new maplibregl.Map({
                container: 'map',
                style: 'https://tiles.openfreemap.org/styles/liberty',
                center: CONFIG.INITIAL_CENTER,
                zoom: CONFIG.INITIAL_ZOOM,
                minZoom: CONFIG.MIN_ZOOM,
                maxZoom: CONFIG.MAX_ZOOM
            });

            map.addControl(new maplibregl.NavigationControl(), 'top-left');
            
            map.on('load', () => {
                setupMapLayers();
                loadGTFSData();
            });
        }

        // Setup map layers
        function setupMapLayers() {
            // Add source for clustered stops
            map.addSource('stops', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: []
                },
                cluster: true,
                clusterMaxZoom: CONFIG.CLUSTER_MAX_ZOOM,
                clusterRadius: CONFIG.CLUSTER_RADIUS
            });

            // Clustered stops layer
            map.addLayer({
                id: 'clusters',
                type: 'circle',
                source: 'stops',
                filter: ['has', 'point_count'],
                paint: {
                    'circle-color': [
                        'step',
                        ['get', 'point_count'],
                        '#51bbd6',
                        10,
                        '#f1f075',
                        30,
                        '#f28cb1'
                    ],
                    'circle-radius': [
                        'step',
                        ['get', 'point_count'],
                        20,
                        10,
                        25,
                        30,
                        30
                    ],
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#fff'
                }
            });

            // Cluster count layer
            map.addLayer({
                id: 'cluster-count',
                type: 'symbol',
                source: 'stops',
                filter: ['has', 'point_count'],
                layout: {
                    'text-field': '{point_count_abbreviated}',
                    'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                    'text-size': 12
                },
                paint: {
                    'text-color': '#fff'
                }
            });

            // Individual stops layer
            map.addLayer({
                id: 'unclustered-stops',
                type: 'circle',
                source: 'stops',
                filter: ['!', ['has', 'point_count']],
                paint: {
                    'circle-color': ['get', 'color'],
                    'circle-radius': 8,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#fff'
                }
            });

            // Add click handlers
            map.on('click', 'clusters', (e) => {
                const features = map.queryRenderedFeatures(e.point, {
                    layers: ['clusters']
                });
                const clusterId = features[0].properties.cluster_id;
                map.getSource('stops').getClusterExpansionZoom(
                    clusterId,
                    (err, zoom) => {
                        if (err) return;
                        map.easeTo({
                            center: features[0].geometry.coordinates,
                            zoom: zoom + 1
                        });
                    }
                );
            });

            map.on('click', 'unclustered-stops', (e) => {
                const coordinates = e.features[0].geometry.coordinates.slice();
                const properties = e.features[0].properties;
                
                showStopPopup(coordinates, properties.stopId);
            });

            map.on('mouseenter', 'clusters', () => {
                map.getCanvas().style.cursor = 'pointer';
            });

            map.on('mouseleave', 'clusters', () => {
                map.getCanvas().style.cursor = '';
            });

            map.on('mouseenter', 'unclustered-stops', () => {
                map.getCanvas().style.cursor = 'pointer';
            });

            map.on('mouseleave', 'unclustered-stops', () => {
                map.getCanvas().style.cursor = '';
            });
        }

        // Load GTFS data
        async function loadGTFSData() {
            try {
                const endpoints = ['stops', 'routes', 'trips', 'services', 'shapes']
                    .map(name => `public_data/${name}.json`);
                
                const responses = await Promise.all(
                    endpoints.map(url => fetch(url).then(r => r.json()))
                );
                
                const [stops, routes, trips, services, shapes] = responses;
                state.gtfsData = { stops, routes, trips, services, shapes };
                
                initializeDateTimeInputs();
                createStopMarkers();
                
            } catch (error) {
                console.error('Error loading data:', error);
                alert(`Error loading data: ${error.message}`);
            }
        }

        // Initialize date/time inputs
        function initializeDateTimeInputs() {
            const now = new Date();
            const today = now.toISOString().split('T')[0];
            const currentTime = now.toTimeString().slice(0, 5);
            
            document.getElementById('datePicker').value = today;
            document.getElementById('timePicker').value = currentTime;
        }

        // Create stop markers
        function createStopMarkers() {
            const features = Object.values(state.gtfsData.stops).map(stop => ({
                type: 'Feature',
                properties: {
                    stopId: stop.stop_id,
                    stopName: stop.stop_name,
                    color: CONFIG.STOP_COLORS.default
                },
                geometry: {
                    type: 'Point',
                    coordinates: [stop.stop_lon, stop.stop_lat]
                }
            }));

            map.getSource('stops').setData({
                type: 'FeatureCollection',
                features: features
            });
        }

        // Show stop popup
        function showStopPopup(coordinates, stopId) {
            const stop = state.gtfsData.stops[stopId];
            if (!stop) return;

            const selectedDate = document.getElementById('datePicker').value.replace(/-/g, '');
            const selectedTime = document.getElementById('timePicker').value;
            
            const activeTrips = getActiveTripsForStop(stopId, selectedDate, selectedTime);
            
            let html = `<b>${stop.stop_name}</b><br>`;
            
            if (activeTrips.length === 0) {
                html += '<i>No active lines today</i>';
            } else {
                html += buildPopupHTML(stopId, activeTrips);
            }

            const popup = new maplibregl.Popup()
                .setLngLat(coordinates)
                .setHTML(html)
                .addTo(map);
            
            state.stopPopups.set(stopId, popup);
        }

        // Build popup HTML
        function buildPopupHTML(stopId, activeTrips) {
            const routeGroups = new Map();
            activeTrips.forEach(([tripId, trip]) => {
                const routeId = trip.route_id;
                if (!routeGroups.has(routeId)) {
                    routeGroups.set(routeId, []);
                }
                routeGroups.get(routeId).push(tripId);
            });

            let html = '<form class="popup-form">';
            let isFirst = true;

            for (const [routeId] of routeGroups) {
                const route = state.gtfsData.routes[routeId];
                const label = route?.short_name || `ID ${routeId}`;
                const isCurrent = routeId === state.currentVisibleRouteId && stopId === state.currentVisibleStopId;
                const checked = isCurrent || isFirst;

                html += `<label>
                    <input type="radio" name="routeChoice-${stopId}" value="${routeId}" 
                        ${checked ? 'checked' : ''} 
                        onclick="showRoute('${stopId}', '${routeId}')">
                    Line ${label}
                </label>`;

                if (isFirst && !isCurrent) {
                    showRoute(stopId, routeId);
                }
                isFirst = false;
            }

            html += '</form>';
            return html;
        }

        // Get active trips for stop
        function getActiveTripsForStop(stopId, dateStr, timeStr) {
            return Object.entries(state.gtfsData.trips).filter(([tripId, trip]) => {
                return trip?.stops?.includes(stopId) && isTripActive(trip.service_id, dateStr, timeStr);
            });
        }

        // Check if trip is active
        function isTripActive(serviceId, dateStr, timeStr) {
            const service = state.gtfsData.services[serviceId];
            if (!service) return false;

            // Date range check
            if (dateStr < service.start_date || dateStr > service.end_date) {
                return false;
            }

            // Weekday check
            const date = new Date(
                dateStr.slice(0, 4),
                parseInt(dateStr.slice(4, 6)) - 1,
                dateStr.slice(6, 8)
            );
            const dayOfWeek = date.getDay();
            const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
            
            if (service.days[dayNames[dayOfWeek]] !== 1) {
                return false;
            }

            // Calendar exceptions
            const exception = service.dates?.find(ex => ex.date === dateStr);
            if (exception) {
                return exception.exception_type === 1;
            }

            return true;
        }

        // Show route
        window.showRoute = function(stopId, routeId) {
            state.clearRoutes();
            state.currentVisibleRouteId = routeId;
            state.currentVisibleStopId = stopId;
            state.lineMode = true;

            const selectedDate = document.getElementById('datePicker').value.replace(/-/g, '');
            const selectedTime = document.getElementById('timePicker').value;

            const routeTrips = Object.entries(state.gtfsData.trips).filter(([tripId, trip]) => 
                trip.route_id === routeId && isTripActive(trip.service_id, selectedDate, selectedTime)
            );

            const tripsByDirection = {};
            routeTrips.forEach(([tripId, trip]) => {
                const direction = trip.direction_id || '0';
                if (!tripsByDirection[direction]) {
                    tripsByDirection[direction] = trip;
                }
            });

            const allStops = new Set();
            const stopDirections = new Map();

            Object.entries(tripsByDirection).forEach(([direction, trip]) => {
                drawRouteShape(trip, direction);
                
                trip.stops?.forEach(stopId => {
                    allStops.add(stopId);
                    if (!stopDirections.has(stopId)) {
                        stopDirections.set(stopId, new Set());
                    }
                    stopDirections.get(stopId).add(direction);
                });
            });

            updateVisibleStops(allStops, stopDirections);
            document.getElementById('btnCloseLine').style.display = 'block';
        };

        // Draw route shape
        function drawRouteShape(trip, direction) {
            const coordinates = state.gtfsData.shapes[trip.shape_id];
            if (!coordinates) return;

            // Convert coordinates to [lng, lat] format
            const lineCoordinates = coordinates.map(coord => [coord[1], coord[0]]);
            
            // Apply offset based on direction
            const offset = direction === '0' ? -0.00005 : 0.00005;
            const offsetCoordinates = PolylineOffset.offsetLine(lineCoordinates, offset);

            const routeId = `route-${trip.route_id}-${direction}`;
            const color = direction === '0' ? CONFIG.ROUTE_COLORS.direction0 : CONFIG.ROUTE_COLORS.direction1;

            map.addSource(routeId, {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    properties: {},
                    geometry: {
                        type: 'LineString',
                        coordinates: offsetCoordinates
                    }
                }
            });

            map.addLayer({
                id: routeId,
                type: 'line',
                source: routeId,
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': color,
                    'line-width': 4,
                    'line-opacity': 0.85
                }
            });

            state.activeRoutes.push(routeId);
        }

        // Update visible stops
        function updateVisibleStops(lineStops, stopDirections) {
            const features = Object.values(state.gtfsData.stops)
                .filter(stop => lineStops.has(stop.stop_id))
                .map(stop => {
                    const directions = stopDirections.get(stop.stop_id);
                    let color = CONFIG.STOP_COLORS.default;
                    
                    if (directions) {
                        if (directions.has('0') && directions.has('1')) {
                            color = CONFIG.STOP_COLORS.both;
                        } else if (directions.has('0')) {
                            color = CONFIG.STOP_COLORS.direction0;
                        } else if (directions.has('1')) {
                            color = CONFIG.STOP_COLORS.direction1;
                        }
                    }
                    
                    return {
                        type: 'Feature',
                        properties: {
                            stopId: stop.stop_id,
                            stopName: stop.stop_name,
                            color: color
                        },
                        geometry: {
                            type: 'Point',
                            coordinates: [stop.stop_lon, stop.stop_lat]
                        }
                    };
                });

            map.getSource('stops').setData({
                type: 'FeatureCollection',
                features: features
            });
        }

        // Close line view
        function closeLine() {
            state.clearRoutes();
            state.reset();
            createStopMarkers();
            document.getElementById('btnCloseLine').style.display = 'none';
        }

        // Reset view
        function resetView() {
            closeLine();
            map.flyTo({
                center: CONFIG.INITIAL_CENTER,
                zoom: CONFIG.INITIAL_ZOOM
            });
        }

        // Locate user
        function locateUser() {
            if (!navigator.geolocation) {
                alert('Geolocation not supported');
                return;
            }

            navigator.geolocation.getCurrentPosition(
                position => {
                    const { latitude, longitude } = position.coords;
                    
                    // Remove existing user marker if any
                    if (map.getLayer('user-location')) {
                        map.removeLayer('user-location');
                        map.removeSource('user-location');
                    }
                    
                    // Add user location
                    map.addSource('user-location', {
                        type: 'geojson',
                        data: {
                            type: 'Feature',
                            geometry: {
                                type: 'Point',
                                coordinates: [longitude, latitude]
                            }
                        }
                    });
                    
                    map.addLayer({
                        id: 'user-location',
                        type: 'circle',
                        source: 'user-location',
                        paint: {
                            'circle-radius': 10,
                            'circle-color': '#4285f4',
                            'circle-stroke-color': '#fff',
                            'circle-stroke-width': 2
                        }
                    });
                    
                    map.flyTo({
                        center: [longitude, latitude],
                        zoom: 15
                    });
                },
                error => {
                    alert(`Geolocation error: ${error.message}`);
                }
            );
        }

        // Initialize event listeners
        document.addEventListener('DOMContentLoaded', () => {
            document.getElementById('btnReset').onclick = resetView;
            document.getElementById('btnLocate').onclick = locateUser;
            document.getElementById('btnCloseLine').onclick = closeLine;
            
            initMap();
        });