import os
import csv
import json
from collections import defaultdict

GTFS_DIR = "gtt_gtfs"
OUTPUT_DIR = "public_data"
os.makedirs(OUTPUT_DIR, exist_ok=True)

def load_csv(name):
    path = os.path.join(GTFS_DIR, name)
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))

def main():
    print("Caricamento GTFS...")

    routes = load_csv("routes.txt")
    trips = load_csv("trips.txt")
    stops = load_csv("stops.txt")
    stop_times = load_csv("stop_times.txt")
    calendar = load_csv("calendar.txt")
    calendar_dates = load_csv("calendar_dates.txt")
    shapes = load_csv("shapes.txt")
    timetables = load_csv("timetables.txt")

    # --- STOPS ---
    stops_json = {
        s["stop_id"]: {
            "stop_id": s["stop_id"],
            "stop_name": s.get("stop_name", ""),
            "stop_lat": float(s["stop_lat"]),
            "stop_lon": float(s["stop_lon"]),
            "stop_code": s.get("stop_code")
        }
        for s in stops
    }
    with open(os.path.join(OUTPUT_DIR, "stops.json"), "w", encoding="utf-8") as f:
        json.dump(stops_json, f, ensure_ascii=False, indent=2)
    print(f"stops.json → {len(stops_json)} fermate")

    # --- ROUTES ---
    routes_json = {
        r["route_id"]: {
            "short_name": r.get("route_short_name", ""),
            "long_name": r.get("route_long_name", ""),
            "agency_id": r.get("agency_id", ""),
            "color": r.get("route_color", ""),
            "text_color": r.get("route_text_color", "")
        }
        for r in routes
    }
    with open(os.path.join(OUTPUT_DIR, "routes.json"), "w", encoding="utf-8") as f:
        json.dump(routes_json, f, ensure_ascii=False, indent=2)
    print(f"routes.json → {len(routes_json)} linee")

    # --- SERVICES (calendar + calendar_dates) ---
    services_json = {}
    for row in calendar:
        services_json[row["service_id"]] = {
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
    for row in calendar_dates:
        sid = row["service_id"]
        if sid not in services_json:
            services_json[sid] = {"days": {}, "start_date": None, "end_date": None, "dates": []}
        services_json[sid]["dates"].append({
            "date": row["date"],
            "exception_type": int(row["exception_type"])
        })
    with open(os.path.join(OUTPUT_DIR, "services.json"), "w", encoding="utf-8") as f:
        json.dump(services_json, f, ensure_ascii=False, indent=2)
    print(f"services.json → {len(services_json)} servizi")

    # --- SHAPES ---
    shapes_dict = defaultdict(list)
    for row in shapes:
        shapes_dict[row["shape_id"]].append((int(row["shape_pt_sequence"]),
                                             [float(row["shape_pt_lat"]), float(row["shape_pt_lon"])]))
    shapes_json = {sid: [pt for _, pt in sorted(pts, key=lambda x: x[0])] for sid, pts in shapes_dict.items()}
    with open(os.path.join(OUTPUT_DIR, "shapes.json"), "w", encoding="utf-8") as f:
        json.dump(shapes_json, f, ensure_ascii=False, indent=2)
    print(f"shapes.json → {len(shapes_json)} shape")

    # mappa timetable_id -> info oraria
    timetable_info = {
        t["timetable_id"]: {
            "start_date": t["start_date"],
            "end_date": t["end_date"],
            "days": {
                "mon": int(t["monday"]),
                "tue": int(t["tuesday"]),
                "wed": int(t["wednesday"]),
                "thu": int(t["thursday"]),
                "fri": int(t["friday"]),
                "sat": int(t["saturday"]),
                "sun": int(t["sunday"]),
            },
            "start_time": t["start_time"],
            "end_time": t["end_time"],
            "direction_id": t["direction_id"],
            "route_id": t["route_id"]
        }
        for t in timetables
    }

    # --- TRIPS (con fermate ordinate + direction_id) ---
    stops_by_trip = defaultdict(list)
    for st in stop_times:
        stops_by_trip[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"]))

    trips_json = {}
    for t in trips:
        tid = t["trip_id"]
        trips_json[tid] = {
            "route_id": t["route_id"],
            "service_id": t["service_id"],
            "shape_id": t.get("shape_id", ""),
            "direction_id": t.get("direction_id", ""),
            "stops": [sid for _, sid in sorted(stops_by_trip.get(tid, []), key=lambda x: x[0])],
            "start_time": timetable_info.get(t.get("timetable_id"), {}).get("start_time", None),
            "end_time": timetable_info.get(t.get("timetable_id"), {}).get("end_time", None)
        }

    with open(os.path.join(OUTPUT_DIR, "trips.json"), "w", encoding="utf-8") as f:
        json.dump(trips_json, f, ensure_ascii=False, indent=2)
    print(f"trips.json → {len(trips_json)} viaggi")

    print("✅ Conversione completata. File in", OUTPUT_DIR)

if __name__ == "__main__":
    main()