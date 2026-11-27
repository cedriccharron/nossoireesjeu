#!/usr/bin/env python3
"""Import des données de marché dans Supabase, puis réévaluation de tous les biens.

Sources (données ouvertes, trimestrielles) :
  - Belgique : Statbel, « Ventes de biens immobiliers » par commune (prix médians, nombre de ventes).
  - France   : INSEE, indices des prix des logements anciens (base 2015) par zone.

Utilisation :
  SUPABASE_URL=… SUPABASE_SECRET_KEY=… python3 scripts/import_indices.py [--full] [--dry-run]
  --full     : renvoie tout l'historique (sinon : 3 dernières années, ou tout si la table est vide)
  --dry-run  : calcule et affiche un résumé sans rien envoyer

Bibliothèque standard uniquement (aucune installation nécessaire).
"""
import csv
import io
import json
import os
import re
import sys
import urllib.request
import zipfile
from datetime import date

STATBEL_URL = "https://statbel.fgov.be/sites/default/files/files/opendata/immo/vastgoed_2010_9999.zip"
INSEE_URL = "https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/{}"
UA = {"User-Agent": "patrimoine-import/1.0"}
MIN_QUARTERS = 2  # trimestres avec médiane nécessaires dans la fenêtre glissante de 4

# ---------------------------------------------------------------------------
# Belgique
# ---------------------------------------------------------------------------
BE_KINDS = {
    "Appartements": "apartment",
    "Maisons avec 2 ou 3 façades": "house_closed",
    "Maisons avec 4 ou plus de façades": "house_open",
    "Toutes les maisons": "house",
}
BE_LEVEL = {"1": 0, "2": 1, "3": 2, "4": 3, "5": 4}


def be_kind(label):
    for prefix, kind in BE_KINDS.items():
        if label.startswith(prefix):
            return kind
    return None


def be_parent(refnis, level):
    """Parent administratif d'un code REFNIS (communes ≥ 2019, y compris fusions 2025)."""
    if level == 0:
        return None
    if level == 1:
        return "01000"
    d2 = refnis[:2]
    region = "04000" if d2 == "21" else "03000" if (refnis[0] in "5689" or d2 == "25") else "02000"
    if level == 2:  # province
        return region
    if level == 3:  # arrondissement
        if d2 == "21":
            return "04000"
        if d2 in ("23", "24"):
            return "20001"
        if d2 == "25":
            return "20002"
        return refnis[0] + "0000"
    return d2 + "000"  # commune → arrondissement


def nice_name(s):
    s = s.strip()
    if s.upper() != s:
        return s
    small = {"de", "du", "des", "la", "le", "les", "d'", "l'", "en", "sur", "lez", "et"}
    out = []
    for i, w in enumerate(re.split(r"(\s|-)", s.lower())):
        if w in (" ", "-"):
            out.append(w)
        elif i > 0 and w in small:
            out.append(w)
        elif w.startswith(("d'", "l'")):
            out.append(w[:2] + w[2:].capitalize() if i > 0 else w[0].upper() + "'" + w[2:].capitalize())
        else:
            out.append(w.capitalize())
    return "".join(out)


def load_statbel():
    print("Statbel : téléchargement…", flush=True)
    raw = urllib.request.urlopen(urllib.request.Request(STATBEL_URL, headers=UA), timeout=120).read()
    zf = zipfile.ZipFile(io.BytesIO(raw))
    name = next(n for n in zf.namelist() if n.lower().endswith(".txt"))
    text = zf.read(name).decode("latin-1")
    areas, quarters = {}, {}  # quarters[(code, kind)][period] = (median, n)
    for row in csv.DictReader(io.StringIO(text), delimiter="|"):
        if row["CD_PERIOD"] not in ("Q1", "Q2", "Q3", "Q4"):
            continue
        if not row["CD_CLASS_SURFACE"].startswith("totaal"):
            continue
        kind = be_kind(row["CD_TYPE_FR"])
        if not kind:
            continue
        refnis, level = row["CD_REFNIS"], BE_LEVEL[row["CD_niveau_refnis"]]
        if refnis not in areas:
            name = row["CD_REFNIS_FR"] or row["CD_REFNIS_NL"]
            nl = row["CD_REFNIS_NL"]
            name = re.sub(r"^(REGION|PROVINCE|ARRONDISSEMENT) (DE LA |DE |D'|DU )?", "", name.upper()) if level in (1, 2, 3) else name
            prefix = {1: "Région ", 2: "Province ", 3: "Arr. "}.get(level, "")
            areas[refnis] = {"code": "BE-" + refnis, "country": "BE", "level": level,
                             "name": prefix + nice_name(name), "refnis": refnis, "selectable": level == 4}
            if level == 4 and nl and nl.upper() != name.upper():
                areas[refnis]["name"] += f" ({nice_name(nl)})"
        median = row["MS_P_50_median"]
        n = int(row["MS_TOTAL_TRANSACTIONS"] or 0)
        period = date(int(row["CD_YEAR"]), (int(row["CD_PERIOD"][1]) - 1) * 3 + 1, 1)
        quarters.setdefault((refnis, kind), {})[period] = (float(median) if median else None, n)
    areas["01000"]["name"] = "Belgique"
    for a in areas.values():
        if a["level"] == 0:
            a["parent_code"] = None
        else:  # parent direct, sinon région, sinon Belgique (si le parent manque dans le fichier)
            cands = [be_parent(a["refnis"], a["level"]), be_parent(a["refnis"], 2), "01000"]
            parent = next(c for c in cands if c in areas and c != a["refnis"])
            a["parent_code"] = "BE-" + parent
        del a["refnis"]

    points = []
    for (refnis, kind), series in quarters.items():
        periods = sorted(series)
        for i, p in enumerate(periods):
            window = [series[q] for q in periods[max(0, i - 3): i + 1] if (p - q).days < 360]
            valid = [(m, n) for m, n in window if m and n]
            if len(valid) < MIN_QUARTERS:
                continue
            vol = sum(n for _, n in valid)
            value = sum(m * n for m, n in valid) / vol
            points.append({"area_code": "BE-" + refnis, "kind": kind, "period": p.isoformat(),
                           "value": round(value), "volume": vol, "source": "statbel"})
    print(f"Statbel : {len(areas)} zones, {len(points)} points", flush=True)
    return list(areas.values()), points


# ---------------------------------------------------------------------------
# France (INSEE, indices des prix des logements anciens, base 2015)
# ---------------------------------------------------------------------------
FR_AREAS = [  # code, level, nom, parent
    ("FR", 0, "France", None),
    ("FR-IDF", 1, "Île-de-France", "FR"),
    ("FR-PROV", 1, "Province", "FR"),
    ("FR-HDF", 2, "Hauts-de-France", "FR-PROV"),
    ("FR-ARA", 2, "Auvergne-Rhône-Alpes", "FR-PROV"),
    ("FR-PACA", 2, "Provence-Alpes-Côte d'Azur", "FR-PROV"),
]
# idbank (suffixe après 010567) par zone : (appartements, maisons, ensemble)
FR_SERIES = {
    "FR": ("116", "120", "118"), "FR-PROV": ("062", "074", "072"), "FR-IDF": ("076", "090", "078"),
    "FR-D75": ("012", None, None), "FR-D77": ("014", "018", "016"), "FR-D78": ("020", "024", "022"),
    "FR-D91": ("026", "030", "028"), "FR-D92": ("032", "036", "034"), "FR-D93": ("038", "042", "040"),
    "FR-D94": ("044", "048", "046"), "FR-D95": ("050", "054", "052"),
    "FR-HDF": ("122", "126", "124"), "FR-ARA": ("128", "132", "130"), "FR-PACA": ("110", "114", "112"),
}
DEPTS = {
    "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence", "05": "Hautes-Alpes",
    "06": "Alpes-Maritimes", "07": "Ardèche", "08": "Ardennes", "09": "Ariège", "10": "Aube", "11": "Aude",
    "12": "Aveyron", "13": "Bouches-du-Rhône", "14": "Calvados", "15": "Cantal", "16": "Charente",
    "17": "Charente-Maritime", "18": "Cher", "19": "Corrèze", "2A": "Corse-du-Sud", "2B": "Haute-Corse",
    "21": "Côte-d'Or", "22": "Côtes-d'Armor", "23": "Creuse", "24": "Dordogne", "25": "Doubs", "26": "Drôme",
    "27": "Eure", "28": "Eure-et-Loir", "29": "Finistère", "30": "Gard", "31": "Haute-Garonne", "32": "Gers",
    "33": "Gironde", "34": "Hérault", "35": "Ille-et-Vilaine", "36": "Indre", "37": "Indre-et-Loire",
    "38": "Isère", "39": "Jura", "40": "Landes", "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire",
    "44": "Loire-Atlantique", "45": "Loiret", "46": "Lot", "47": "Lot-et-Garonne", "48": "Lozère",
    "49": "Maine-et-Loire", "50": "Manche", "51": "Marne", "52": "Haute-Marne", "53": "Mayenne",
    "54": "Meurthe-et-Moselle", "55": "Meuse", "56": "Morbihan", "57": "Moselle", "58": "Nièvre", "59": "Nord",
    "60": "Oise", "61": "Orne", "62": "Pas-de-Calais", "63": "Puy-de-Dôme", "64": "Pyrénées-Atlantiques",
    "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales", "67": "Bas-Rhin", "68": "Haut-Rhin", "69": "Rhône",
    "70": "Haute-Saône", "71": "Saône-et-Loire", "72": "Sarthe", "73": "Savoie", "74": "Haute-Savoie",
    "75": "Paris", "76": "Seine-Maritime", "77": "Seine-et-Marne", "78": "Yvelines", "79": "Deux-Sèvres",
    "80": "Somme", "81": "Tarn", "82": "Tarn-et-Garonne", "83": "Var", "84": "Vaucluse", "85": "Vendée",
    "86": "Vienne", "87": "Haute-Vienne", "88": "Vosges", "89": "Yonne", "90": "Territoire de Belfort",
    "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne", "95": "Val-d'Oise",
    "971": "Guadeloupe", "972": "Martinique", "973": "Guyane", "974": "La Réunion",
}
IDF = {"75", "77", "78", "91", "92", "93", "94", "95"}
HDF = {"02", "59", "60", "62", "80"}
ARA = {"01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74"}
PACA = {"04", "05", "06", "13", "83", "84"}


def dept_parent(d):
    if d in IDF:
        return "FR-IDF"
    if d in HDF:
        return "FR-HDF"
    if d in ARA:
        return "FR-ARA"
    if d in PACA:
        return "FR-PACA"
    if len(d) == 3:
        return "FR"  # outre-mer : indice France entière
    return "FR-PROV"


def load_insee():
    areas = [{"code": c, "country": "FR", "level": l, "name": n, "parent_code": p, "selectable": False}
             for c, l, n, p in FR_AREAS]
    areas += [{"code": "FR-D" + d, "country": "FR", "level": 3, "name": f"{n} ({d})",
               "parent_code": dept_parent(d), "selectable": True} for d, n in DEPTS.items()]
    ids = {}
    for area, triple in FR_SERIES.items():
        for kind, suffix in zip(("apartment", "house", "all"), triple):
            if suffix:
                ids["010567" + suffix] = (area, kind)
    print("INSEE : téléchargement…", flush=True)
    xml = urllib.request.urlopen(urllib.request.Request(INSEE_URL.format("+".join(ids)), headers=UA), timeout=120).read().decode("utf-8")
    points = []
    for m in re.finditer(r"<Series ([^>]*)>(.*?)</Series>", xml, re.S):
        idbank = re.search(r'IDBANK="(\d+)"', m.group(1)).group(1)
        area, kind = ids[idbank]
        for tp, val in re.findall(r'TIME_PERIOD="(\d{4}-Q\d)" OBS_VALUE="([\d.]+)"', m.group(2)):
            y, q = tp.split("-Q")
            points.append({"area_code": area, "kind": kind, "period": date(int(y), (int(q) - 1) * 3 + 1, 1).isoformat(),
                           "value": float(val), "volume": None, "source": "insee"})
    print(f"INSEE : {len(areas)} zones, {len(points)} points", flush=True)
    return areas, points


# ---------------------------------------------------------------------------
# Supabase
# ---------------------------------------------------------------------------
def api(method, path, body=None, prefer=None):
    url = os.environ["SUPABASE_URL"].rstrip("/") + path
    key = os.environ["SUPABASE_SECRET_KEY"]
    headers = {"apikey": key, "Content-Type": "application/json"}
    if not key.startswith("sb_"):  # ancienne clé service_role (JWT)
        headers["Authorization"] = "Bearer " + key
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        sys.exit(f"Erreur Supabase {e.code} sur {path} : {e.read().decode()[:500]}")


def upsert(table, rows, batch=1000):
    for i in range(0, len(rows), batch):
        api("POST", f"/rest/v1/{table}", rows[i:i + batch], prefer="resolution=merge-duplicates,return=minimal")
        print(f"  {table} : {min(i + batch, len(rows))}/{len(rows)}", flush=True)


def sort_areas(areas):
    """Parents avant enfants (clé étrangère parent_code)."""
    return sorted(areas, key=lambda a: a["level"])


DEMO_AREAS = {"BE-01000", "BE-02000", "BE-03000", "BE-04000", "BE-21000", "BE-92000", "BE-62000", "BE-25000",
              "BE-21004", "BE-21009", "BE-21016", "BE-92094", "BE-62063", "BE-25072"}


def export_demo(areas, points, path):
    """Écrit un petit extrait réel (quelques zones) pour le mode démo de l'app."""
    series = {}
    for p in sorted(points, key=lambda x: x["period"]):
        if p["period"] < "2008-01-01" or not (p["area_code"] in DEMO_AREAS or p["source"] == "insee"):
            continue
        s = series.setdefault(f'{p["area_code"]}|{p["kind"]}', {"from": p["period"], "v": [], "n": []})
        s["v"].append(p["value"])
        s["n"].append(p["volume"])
    keep = [{k: a[k] for k in ("code", "country", "level", "name", "parent_code", "selectable")} for a in areas]
    with open(path, "w", encoding="utf-8") as f:
        f.write("// Extrait réel des données Statbel et INSEE pour le mode démo (généré par scripts/import_indices.py).\n")
        f.write("export const DEMO_AREAS = " + json.dumps(keep, ensure_ascii=False, separators=(",", ":")) + ";\n")
        f.write("export const DEMO_SERIES = " + json.dumps(series, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"Démo : {len(keep)} zones, {len(series)} séries → {path}")


def export_market(areas, points, path):
    """Toutes les zones et séries (depuis 2000) en un fichier JSON compact, pour la version claude.ai."""
    series = {}
    for p in sorted(points, key=lambda x: x["period"]):
        if p["period"] < "2000-01-01":
            continue
        s = series.setdefault(f'{p["area_code"]}|{p["kind"]}', {"from": p["period"], "v": [], "n": []})
        s["v"].append(p["value"])
        s["n"].append(p["volume"])
    keep = [{k: a[k] for k in ("code", "country", "level", "name", "parent_code", "selectable")} for a in areas]
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"generated": date.today().isoformat(), "areas": keep, "series": series}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Marché : {len(keep)} zones, {len(series)} séries → {path}")


def main():
    full, dry = "--full" in sys.argv, "--dry-run" in sys.argv
    be_areas, be_points = load_statbel()
    fr_areas, fr_points = load_insee()
    areas, points = sort_areas(be_areas + fr_areas), be_points + fr_points

    if "--export-market" in sys.argv:
        export_market(areas, points, sys.argv[sys.argv.index("--export-market") + 1])
        return

    if "--export-demo" in sys.argv:
        export_demo(areas, points, sys.argv[sys.argv.index("--export-demo") + 1])
        return

    if dry:
        latest = {}
        for p in points:
            latest[p["source"]] = max(latest.get(p["source"], ""), p["period"])
        print("Dernier trimestre :", latest)
        sample = [p for p in points if p["area_code"] in ("BE-21004", "FR-D75")][-6:]
        print(json.dumps(sample, indent=1))
        return

    if not full:
        existing = api("GET", "/rest/v1/index_points?select=period&limit=1")
        if existing:
            since = date(date.today().year - 3, 1, 1).isoformat()
            points = [p for p in points if p["period"] >= since]
            print(f"Envoi incrémental depuis {since}")
    upsert("index_areas", areas)
    upsert("index_points", points)
    n = api("POST", "/rest/v1/rpc/revalue_all", {})
    print(f"Réévaluation : {n} bien(s)")


if __name__ == "__main__":
    main()
