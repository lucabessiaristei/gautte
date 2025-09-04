import os
import csv
import json
from collections import defaultdict

GTFS_DIR = "gtt_gtfs"
OUTPUT_DIR = "public_data"
os.makedirs(OUTPUT_DIR, exist_ok=True)

def load_csv(file):
    with open(os.path.join(GTFS_DIR, file), encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))

def main():
    print("Caricamento dati GTFS...")

    routes = load_csv("routes.txt")
    trips = load_csv("trips.txt")
    calendar = load_csv("calendar.txt")
    calendar_dates = load_csv("calendar_dates.txt")
    shapes = load_csv("shapes.txt")

    print("Generazione routes.json...")
    routes_json = {}
    trips_by_route = defaultdict(list)

    for trip in trips:
        trips_by_route[trip["route_id"]].append(trip["trip_id"])

    for route in routes:
        route_id = route["route_id"]
        routes_json[route_id] = {
            "short_name": route["route_short_name"],
            "long_name": route["route_long_name"],
            "agency_id": route["agency_id"],
            "type": int(route["route_type"]),
            "color": route["route_color"],
            "text_color": route["route_text_color"],
            "trips": trips_by_route.get(route_id, [])
        }

    with open(os.path.join(OUTPUT_DIR, "routes.json"), "w", encoding="utf-8") as f:
        json.dump(routes_json, f, ensure_ascii=False, indent=2)

    print("Generazione trips.json...")
    trips_json = {
        trip["trip_id"]: {
            "service_id": trip["service_id"],
            "shape_id": trip["shape_id"]
        }
        for trip in trips
    }

    with open(os.path.join(OUTPUT_DIR, "trips.json"), "w", encoding="utf-8") as f:
        json.dump(trips_json, f, ensure_ascii=False, indent=2)

    print("Generazione calendar.json...")
    calendar_json = {}

    # Normal calendar
    for row in calendar:
        calendar_json[row["service_id"]] = {
            "days": {
                "mon": int(row["monday"]),
                "tue": int(row["tuesday"]),
                "wed": int(row["wednesday"]),
                "thu": int(row["thursday"]),
                "fri": int(row["friday"]),
                "sat": int(row["saturday"]),
                "sun": int(row["sunday"]),
            },
            "start_date": row["start_date"],
            "end_date": row["end_date"],
            "dates": []
        }

    # Exceptions
    for row in calendar_dates:
        service = calendar_json.setdefault(row["service_id"], {
            "days": {},
            "start_date": None,
            "end_date": None,
            "dates": []
        })
        service["dates"].append({
            "date": row["date"],
            "exception_type": int(row["exception_type"])
        })

    with open(os.path.join(OUTPUT_DIR, "calendar.json"), "w", encoding="utf-8") as f:
        json.dump(calendar_json, f, ensure_ascii=False, indent=2)

    print("Generazione shapes.json...")
    shapes_json = defaultdict(list)

    for row in shapes:
        shape_id = row["shape_id"]
        lat = float(row["shape_pt_lat"])
        lon = float(row["shape_pt_lon"])
        seq = int(row["shape_pt_sequence"])
        shapes_json[shape_id].append((seq, [lat, lon]))

    # Ordina per sequenza
    shapes_json_sorted = {
        shape_id: [pt for _, pt in sorted(coords, key=lambda x: x[0])]
        for shape_id, coords in shapes_json.items()
    }

    with open(os.path.join(OUTPUT_DIR, "shapes.json"), "w", encoding="utf-8") as f:
        json.dump(shapes_json_sorted, f, ensure_ascii=False, indent=2)

    print("✅ Completato. Dati salvati in:", OUTPUT_DIR)

if __name__ == "__main__":
    main()