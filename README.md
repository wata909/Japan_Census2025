# 国勢調査 人口増減マップ（試験版）

国勢調査の人口データを、**現在の市区町村**および**大正9年(1920)の旧市町村**単位でコロプレス表示する Web マップです。ベクトルタイル(PMTiles)＋ MapLibre GL による軽量な地図で、GitHub Pages と Cloudflare R2 で配信しています。

> **試験版**です。境界の空間割当に近似を含みます（後述「既知の制約」）。

## 公開サイト

| ページ | 内容 | URL |
|---|---|---|
| **市区町村版** | 令和7年(2025)国勢調査 人口速報集計。市区町村別、2020→2025 の人口・世帯増減など | https://wata909.github.io/Japan_Census2025/ |
| **旧市町村版** | 令和2年(2020)国勢調査。大正9年(1920)行政区域＝旧市町村単位、2015→2020 の増減 | https://wata909.github.io/Japan_Census2025/kyu.html |
| **経年変化版** | 2000〜2020 の5年ごと人口増減率（旧市町村単位）。左ペインに地区別の経年変化グラフ。配色は5%刻み(−20〜+20%) | https://wata909.github.io/Japan_Census2025/trend.html |

旧市町村版・経年変化版は `?pref=16`（富山）のように都道府県コードで切り替えられます（左ペインのセレクタでも可）。

## 何を表示しているか

- **市区町村版**：総務省統計局「令和7年国勢調査 人口速報集計 第1表」を、国土数値情報の行政区域(2020年)に市区町村コードで結合。全国人口 123,049,524 が公表値と一致。
- **旧市町村版・経年変化版**：国勢調査「小地域（町丁・字等別）」の人口を、**大正9年(1920)の行政区域**に空間的に集約して旧市町村単位に再構成。昭和・平成の大合併より前の細かい単位で人口動態を見られます。全国の旧市町村は 12,239 単位。全47都道府県・全年次で人口合計が公表値と一致することを確認済み。

## データソースと出典

| データ | 提供 | 用途 |
|---|---|---|
| 国勢調査 人口速報集計（第1表 a01.xlsx） | 総務省統計局（e-Stat） | 市区町村版の統計 |
| 国勢調査 小地域（町丁・字等別）境界データ 2000/2005/2010/2015/2020（人口・世帯を属性に含む Shapefile） | 総務省統計局（e-Stat 統計GIS） | 旧市町村版・経年変化版の統計＋境界 |
| 国土数値情報 行政区域データ N03（2020年版） | 国土交通省 | 市区町村版の境界 |
| 国土数値情報 行政区域データ N03（大正9年=1920年） | 国土交通省 | 旧市町村版の集約単位（境界） |
| 地理院タイル（淡色地図） | 国土地理院 | 背景地図 |

元データはそれぞれの提供機関の利用規約（政府標準利用規約等）に従います。**利用時は上記の出典表示を残してください**（本リポジトリのライセンス CC0 は、著者が作成したコード・生成物に対する権利放棄であり、元データ提供者の権利には及びません）。

## アーキテクチャ

```
e-Stat 小地域境界(人口付き) ─┐
国土数値情報 N03(1920)     ─┤ GDAL / GeoPandas で空間割当・集計
                            ├─→ FlatGeobuf ─→ tippecanoe ─→ PMTiles ─→ Cloudflare R2（大容量・HTTP Range配信）
                            │                                              │
                            └─────────────────────────────────────────────┘
HTML / JS / 軽量JSON ──────────────────────────────────→ GitHub Pages ──→ MapLibre GL + pmtiles.js が R2 の PMTiles を参照
```

- **PMTiles は Cloudflare R2 に置く**（HTTP Range リクエストが必要で、GitHub Pages は Range 非対応のため）。
- HTML/JS と小さな JSON のみ GitHub Pages に置く。
- 面の**隙間対策**として tippecanoe の `--detect-shared-borders`（共有境界を同一に簡略化）を使用。

## リポジトリ構成

```
index.html / app.js            市区町村版ビューア
kyu.html   / kyu-app.js         旧市町村版ビューア（2015→2020）
trend.html / trend-app.js       経年変化版ビューア（2000〜2020・5年ごと）
data/
  values.json                   市区町村版の凡例スケール用
  kyu_prefs.json                都道府県ごとの表示範囲・県名
  kyu_values_XX.json            旧市町村版の凡例スケール用（県別）
scripts/
  build_all.py                  全47県 一括生成（DL→集計→FlatGeobuf→PMTiles）
  serve_range.py                ローカル確認用の HTTP Range 対応サーバ
```

※ PMTiles 本体（`kyu_census2020_XX.pmtiles` ほか）はサイズが大きいため R2 のみに置き、本リポジトリには含めません。

## 再現手順

### 1. 必要なツール

- Python（`geopandas` `pandas` `shapely` `pyogrio`）と GDAL 3.x（`ogr2ogr`）。本プロジェクトは conda 環境 `gdal_pdal` を使用。
- [tippecanoe](https://github.com/felt/tippecanoe)（`brew install tippecanoe`）
- [Cloudflare Wrangler](https://developers.cloudflare.com/workers/wrangler/)（`npm i -g wrangler`。R2 配信に使用）

`scripts/build_all.py` 冒頭の `OGR2OGR` `TIPPE` のパスは環境に合わせて調整してください。

### 2. 全47都道府県のデータ生成

```bash
python scripts/build_all.py            # 01〜47 全県（引数で県コード指定も可: python scripts/build_all.py 16）
```

各県について次を自動実行します（ダウンロード済みはキャッシュ）。

1. e-Stat 統計GIS から小地域境界（2000/2005/2010/2015/2020、人口付き Shapefile）を取得
   - ダウンロードURL例（富山=16、2020年）:
     `https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=16&coordSys=1&format=shape&downloadType=5&datum=2000`
   - `dlserveyId` の末尾が年（2000/2005/2010/2015/2020）、`code` が都道府県コード。
2. 国土数値情報 N03 大正9年(1920) を取得
   - `https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-1920/N03-200101_16_GML.zip`
3. 1920 行政区域を (郡, 市町村名) で dissolve → 旧市町村ポリゴン（表示単位）
4. 各年の町丁・字等の代表点を旧市町村ポリゴンへ空間割当（境界外は最近傍で補完）し、人口・世帯を合算
5. 5年ごと4期間（2000→05, 05→10, 10→15, 15→20）の増減率を算出
6. FlatGeobuf（`out/kyu_census2020_XX.fgb`）→ tippecanoe で PMTiles（`out/kyu_census2020_XX.pmtiles`）
7. 県別の凡例用 `data/kyu_values_XX.json` と、範囲・県名の `data/kyu_prefs.json` を出力

tippecanoe 呼び出しは `--detect-shared-borders --no-tiny-polygon-reduction --simplification=3 --no-tile-size-limit -Z5 -z13`。

### 3. PMTiles を R2 にアップロード

```bash
for f in out/kyu_census2020_*.pmtiles; do
  wrangler r2 object put s24-tottori-fude2026/$(basename "$f") \
    --file "$f" --content-type application/octet-stream --remote
done
```

公開URLは `https://<R2公開ドメイン>/kyu_census2020_XX.pmtiles`。`*-app.js` 内の `R2` 定数を自分の公開ドメインに合わせてください。R2 でなくても **HTTP Range に対応した静的ホスティング**なら利用できます。

### 4. サイトを配信

`index.html` `kyu.html` `trend.html` と各 `*-app.js`、`data/` を GitHub Pages（`main` ブランチのルート）に置くだけです。地図データ本体は R2 から読まれます。

ローカル確認は Range 対応サーバで:

```bash
python scripts/serve_range.py     # http://localhost:8899/trend.html?pref=16
```

（GitHub Pages 上では R2 が Range 対応のため、このサーバは不要です。）

## 検算・品質

- 各都道府県・各年次で、集約後の人口合計が国勢調査の公表値と一致することを確認（例: 富山県 2000=1,120,851 → 2020=1,034,814）。
- 人口・世帯の矛盾レコード（人口0だが世帯あり等）は全国で 0 件。小地域の総人口・総世帯は秘匿されず保全されます（人口0の町丁・字は山林・水面等の無居住地）。

## 既知の制約（試験版）

- 旧市町村への集約は**町丁・字の代表点による空間割当**（面積按分ではない）。境界付近にわずかな誤差があります。
- 大正9年(1920)の行政区域を集約単位に用いるため、現在の海岸線・埋立地・境界未定地との差により、一部で最近傍補完が入ります（各県数十件程度）。
- 福島県の原発避難区域など、実態として極端な増減（±20%超）を示す旧市町村があります。配色は5%刻み・±20%で頭打ちのため端の色で表示されます。

## ライセンス

本リポジトリのコード・設定・生成物は [CC0 1.0 全世界（パブリックドメイン提供）](LICENSE) とします。作者は可能な限りの権利を放棄しています。ただし前掲の**元データ（国勢調査・国土数値情報・地理院タイル）は各提供機関の権利・利用規約に従う**もので、CC0 の対象外です。利用の際は元データの出典表示を残してください。
