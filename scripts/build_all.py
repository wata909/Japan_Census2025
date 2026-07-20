#!/usr/bin/env python3
"""全47都道府県：国勢調査 小地域(町丁・字)を大正9年(1920)行政区域＝旧市町村に集約し、
2000/2005/2010/2015/2020の人口を集計、5年ごと4期間の増減率を算出する（試験版）。

各県: 5年次の境界(人口付き)DL → 1920単位へ空間割当・集計 → 期間増減率 → fgb → PMTiles → values.json。
既存 kyu.html 互換のため pop2015/pop2020/pop_chg*/hh* も残す。R2アップロードは別途 bash。

使い方: python build_all.py [pref ...]   引数なしで01〜47全県。既存キャッシュ/成果物はスキップ。
"""
import sys, subprocess, json, urllib.request, zipfile, glob, traceback, time
from pathlib import Path
import geopandas as gpd
import pandas as pd
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SHO = ROOT / "data" / "shocho"
OUT = ROOT / "out"
SITE_DATA = ROOT / "site" / "data"
OUT.mkdir(exist_ok=True); SITE_DATA.mkdir(parents=True, exist_ok=True)

OGR2OGR = "/opt/miniconda3/envs/gdal_pdal/bin/ogr2ogr"
TIPPE = "/opt/homebrew/bin/tippecanoe"
ESTAT = "https://www.e-stat.go.jp/gis/statmap-search/data"
MLIT = "https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-1920/N03-200101_{p}_GML.zip"
PROJ = 3857
ASSUME_CRS = 4612
# 年次 -> dlserveyId 年・shp接頭辞
YEARS = ["2000", "2005", "2010", "2015", "2020"]
# 期間（起点,終点）
PERIODS = [("2000", "2005"), ("2005", "2010"), ("2010", "2015"), ("2015", "2020")]

PREF_NAME = {
    "01":"北海道","02":"青森県","03":"岩手県","04":"宮城県","05":"秋田県","06":"山形県","07":"福島県",
    "08":"茨城県","09":"栃木県","10":"群馬県","11":"埼玉県","12":"千葉県","13":"東京都","14":"神奈川県",
    "15":"新潟県","16":"富山県","17":"石川県","18":"福井県","19":"山梨県","20":"長野県","21":"岐阜県",
    "22":"静岡県","23":"愛知県","24":"三重県","25":"滋賀県","26":"京都府","27":"大阪府","28":"兵庫県",
    "29":"奈良県","30":"和歌山県","31":"鳥取県","32":"島根県","33":"岡山県","34":"広島県","35":"山口県",
    "36":"徳島県","37":"香川県","38":"愛媛県","39":"高知県","40":"福岡県","41":"佐賀県","42":"長崎県",
    "43":"熊本県","44":"大分県","45":"宮崎県","46":"鹿児島県","47":"沖縄県",
}
# kyu.html 互換の値レンジ用（従来8指標）
VAL_METRICS = ["pop_chg_pct","pop_chg","hh_chg_pct","hh_chg","pop2020","pop2015","hh2020","hh2015"]


def dl(url, dest):
    if dest.exists() and dest.stat().st_size > 1000:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    for a in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=180) as r:
                body = r.read()
            if len(body) < 1000:
                raise RuntimeError(f"too small ({len(body)}B)")
            tmp = dest.with_suffix(dest.suffix + ".part"); tmp.write_bytes(body); tmp.replace(dest)
            return
        except Exception:
            if a == 2:
                raise
            time.sleep(3 * (a + 1))


def fetch(pref):
    base = SHO / pref
    for y in YEARS:
        d = base / f"census_{y}"
        if not (d.exists() and list(d.glob("*.shp"))):
            z = base / f"census_{y}.zip"
            dl(f"{ESTAT}?dlserveyId=A00200521{y}&code={pref}&coordSys=1&format=shape&downloadType=5&datum=2000", z)
            d.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(z) as zf:
                zf.extractall(d)
    d = base / "n1920"
    if not (d.exists() and list(d.glob("*.shp"))):
        z = base / "n1920.zip"
        dl(MLIT.format(p=pref), z)
        d.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(z) as zf:
            zf.extractall(d)


def one(d, pat):
    g = list(Path(d).glob(pat))
    if not g:
        raise FileNotFoundError(f"{pat} in {d}")
    return g[0]


def build(pref):
    base = SHO / pref
    g = gpd.read_file(one(base/"n1920", "*AdministrativeBoundary.shp"))
    if g.crs is None:
        g = g.set_crs(ASSUME_CRS, allow_override=True)
    g["gun"] = g["N03_003"].fillna(""); g["name"] = g["N03_004"].fillna("")
    g["k"] = g["gun"] + "|" + g["name"]
    units = g.dissolve(by="k", as_index=False, aggfunc={"gun":"first","name":"first"})
    units = units.sort_values(["gun","name"]).reset_index(drop=True)
    units["kyu_id"] = [f"{pref}{i:04d}" for i in range(1, len(units)+1)]
    units = units[["kyu_id","gun","name","geometry"]]

    def assign(year):
        cx = gpd.read_file(one(base/f"census_{year}", "*.shp"), columns=["KEY_CODE","JINKO","SETAI"])
        if cx.crs != units.crs:
            cx = cx.to_crs(units.crs)
        pts = cx.copy(); pts["geometry"] = cx.geometry.representative_point()
        j = gpd.sjoin(pts, units[["kyu_id","geometry"]], how="left", predicate="within")
        j = j[~j.index.duplicated(keep="first")]
        miss = int(j["kyu_id"].isna().sum())
        if miss:
            mm = pts.loc[j["kyu_id"].isna()].to_crs(PROJ)
            near = gpd.sjoin_nearest(mm, units[["kyu_id","geometry"]].to_crs(PROJ), how="left")
            near = near[~near.index.duplicated(keep="first")]
            j.loc[near.index, "kyu_id"] = near["kyu_id"]
        df = pd.DataFrame({"kyu_id": j["kyu_id"].values,
            "pop": pd.to_numeric(cx["JINKO"], errors="coerce").fillna(0).astype(int).values,
            "hh": pd.to_numeric(cx["SETAI"], errors="coerce").fillna(0).astype(int).values})
        agg = df.groupby("kyu_id").agg(pop=("pop","sum"), hh=("hh","sum")).reset_index()
        return agg.rename(columns={"pop":f"pop{year}","hh":f"hh{year}"}), df["pop"].sum()

    m = units.copy(); checks = {}
    for y in YEARS:
        a, tot = assign(y); checks[y] = tot
        m = m.merge(a, on="kyu_id", how="left")
    for y in YEARS:
        m[f"pop{y}"] = m[f"pop{y}"].fillna(0).astype(int)
        m[f"hh{y}"] = m[f"hh{y}"].fillna(0).astype(int)

    # 期間増減率
    for a, b in PERIODS:
        m[f"rate_{a[2:]}_{b[2:]}"] = np.where(m[f"pop{a}"] > 0,
            (m[f"pop{b}"] - m[f"pop{a}"]) / m[f"pop{a}"] * 100, np.nan).round(2)
    # kyu.html 互換フィールド
    m["pop_chg"] = m["pop2020"] - m["pop2015"]
    m["hh_chg"] = m["hh2020"] - m["hh2015"]
    m["pop_chg_pct"] = np.where(m["pop2015"]>0, m["pop_chg"]/m["pop2015"]*100, np.nan).round(2)
    m["hh_chg_pct"]  = np.where(m["hh2015"]>0,  m["hh_chg"]/m["hh2015"]*100,  np.nan).round(2)

    keep = ["kyu_id","gun","name"] + [f"pop{y}" for y in YEARS] \
        + [f"rate_{a[2:]}_{b[2:]}" for a,b in PERIODS] \
        + ["pop_chg","pop_chg_pct","hh2015","hh2020","hh_chg","hh_chg_pct","geometry"]
    m = m[keep]

    fgb = OUT / f"kyu_census2020_{pref}.fgb"
    m.to_file(fgb, driver="FlatGeobuf")
    gjl = OUT / f"_kyu_{pref}.geojsonl"
    subprocess.run([OGR2OGR, "-f", "GeoJSONSeq", str(gjl), str(fgb)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    pmt = OUT / f"kyu_census2020_{pref}.pmtiles"
    subprocess.run([TIPPE, "-o", str(pmt), "-l", "kyu", "-Z5", "-z13", "--detect-shared-borders",
                    "--no-tiny-polygon-reduction", "--simplification=3", "--no-tile-size-limit",
                    "--force", str(gjl)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    gjl.unlink(missing_ok=True)

    vals = {k: sorted(m[k].dropna().tolist()) for k in VAL_METRICS}
    json.dump(vals, open(SITE_DATA / f"kyu_values_{pref}.json", "w"))

    minx, miny, maxx, maxy = m.total_bounds
    okc = all(int(m[f'pop{y}'].sum()) == int(checks[y]) for y in YEARS)
    print(f"[{pref} {PREF_NAME[pref]}] {len(m)}単位 "
          f"人口2000={m['pop2000'].sum():,}→2020={m['pop2020'].sum():,} {'検算OK' if okc else '不一致!'}"
          f" -> {pmt.name} {pmt.stat().st_size//1024}KB")
    return {"name": PREF_NAME[pref], "units": len(m),
            "bounds": [[round(minx,4),round(miny,4)],[round(maxx,4),round(maxy,4)]]}


def main(prefs):
    mpath = SITE_DATA / "kyu_prefs.json"
    manifest = json.load(open(mpath)) if mpath.exists() else {}
    for pref in prefs:
        try:
            fetch(pref)
            manifest[pref] = build(pref)
            json.dump(manifest, open(mpath, "w"), ensure_ascii=False, indent=0)
        except Exception as e:
            print(f"[{pref} {PREF_NAME.get(pref,'?')}] 失敗: {e}")
            traceback.print_exc()
    print(f"\n完了。成功 {len(manifest)}県。")


if __name__ == "__main__":
    args = sys.argv[1:] or [f"{i:02d}" for i in range(1, 48)]
    main(args)
