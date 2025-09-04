const MAPTILER_KEY = 'JwMEsUIjS86xRPmDczqz';

const map = L.map('map').setView([45.07, 7.69], 12);

L.maptiler.maptilerLayer({
  apiKey: MAPTILER_KEY,
  style: "https://api.maptiler.com/maps/0197657b-84fb-74e1-94aa-0d013b607aa9/style.json?key=JwMEsUIjS86xRPmDczqz"
}).addTo(map);

// Cluster per fermate
const clusters = L.markerClusterGroup();
map.addLayer(clusters);

if (window.GTFS_STOPS) {
  for (const stop of Object.values(window.GTFS_STOPS)) {
    const m = L.marker([stop.stop_lat, stop.stop_lon])
      .bindPopup(`<b>${stop.stop_name}</b>`);
    clusters.addLayer(m);
  }
}