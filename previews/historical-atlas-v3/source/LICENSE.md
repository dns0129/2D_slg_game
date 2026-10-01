# Licence

There are two different kinds of thing in this repository and they are not
under the same terms. The short version: the work done here is public domain,
no copyright is claimed over any of the map sources, and attribution for the
georeferencing is asked for but not required.

## 1. The work done here — public domain

Everything written for this project is dedicated to the public domain under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). That
covers:

* **the code** — `map.js`, `admin.js`, `styles.css`, `index.html`, and
  everything under `tools/`;
* **the prose** — everything under `texts/`, and the `data.js`, `sources.html`
  and `docs/SOURCES.md` built out of it;
* **the georeferencing, tracing and clipping** described in `docs/SOURCES.md`: the
  work of putting drawn sheets on the ground, chaining open coastlines back
  into islands, cutting shapes to the frontiers of a particular date, and
  deciding which shape stands for which place on which map. This includes the
  tracing of the North China Area Army's security map of September 1942 and of
  the occupied zone in China.

To the extent possible under law, the author waives all copyright and related
or neighbouring rights in that work. Copy it, change it, republish it, teach
from it, sell it — no permission is needed and no conditions attach.

## 2. The map sources — no copyright is claimed over any of them

None of the underlying map data originates here, and **no copyright over any of
it is claimed by this project**. Every source keeps whatever terms its own
author put on it, and nothing above alters them in any way.

Some of the shapes drawn here are derived from other people's data. They are
listed below, with what each one gave, who made it, and under what terms.
**No copyright over any of them is claimed by this project**, and nothing in
section 1 alters their terms in any way. `docs/SOURCES.md` gives the fuller account,
including what was done to each dataset and how accurate it turned out to be;
`occupation-maps/README.md` lists the scanned sheets one by one.

### Derived from openly licensed datasets

| What is drawn from it | Source | Licence |
|---|---|---|
| All coastlines and national outlines outside China; the frame; Christmas Island and the Cocos group | Natural Earth 1:10m cultural vectors — [github.com/nvkelso/natural-earth-vector](https://github.com/nvkelso/natural-earth-vector) | [Public domain](https://www.naturalearthdata.com/about/terms-of-use/) |
| The Yangzi and the Yellow River | Natural Earth 1:10m rivers and lake centrelines | [Public domain](https://www.naturalearthdata.com/about/terms-of-use/) |
| Every Chinese land region: the provinces of 1928–1945, and the dissolved outline of the Republic laid under China | ENP-China provincial boundaries, "Provinces 1922–1928 © 2021 by ENP-China Project", Elites, Networks and Power in Modern China, Aix-Marseille University — [enp-china.eu](https://www.enp-china.eu/) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| The provinces ceded to Thailand in 1941; the northern Malay states; Burma by division; Kengtung by district; the Indian, Japanese and Philippine first-level units; the Indonesian residencies; Laos and Cambodia province by province | geoBoundaries ADM1 and ADM2 — [github.com/wmgeolab/geoBoundaries](https://github.com/wmgeolab/geoBoundaries) · Runfola, D. et al. (2020), *PLoS ONE* 15(4): e0231866 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| The fine coastlines and island names of the Ryukyus, the Bonins, the Volcano and Izu Islands, Micronesia and Melanesia, the islands off the Japanese coast, the South China Sea, Singapore, Ulleung and the Liancourt Rocks, the Turtle and Mangsee Islands, Miangas, the Cocos (Keeling) Islands and the central Pacific | OpenStreetMap — © OpenStreetMap contributors — [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright) | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The geometry drawn from it is a **Produced Work** under that licence |
| The alternative Republican provinces offered in Layers | [File:Republic of China edcp location map 1936.svg](https://commons.wikimedia.org/wiki/File:Republic_of_China_edcp_location_map_1936.svg), traced by Wikimedia Commons user Lilauid, on Uwe Dedering's *China edcp location map* (CC BY-SA 3.0 / GFDL) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) — **share-alike, and the boundaries derived from it inherit it** |
| Saharat Thai Doem — Kengtung and the trans-Salween Shan states | [File:Saharat_Thai_Doem_map.png](https://commons.wikimedia.org/wiki/File:Saharat_Thai_Doem_map.png) by Xufanc on Wikimedia Commons | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) — **share-alike** |
| The 1938–47 course of the Yellow River | The channel map at [disasterhistory.org](https://disasterhistory.org/) (Chris Courtney, after Saito et al. 2000) | see that site |

### Traced or georeferenced here, from sheets not made here

These shapes are the project's own work — the tracing and the georeferencing are
dedicated to the public domain under section 1 — but the sheets they were traced
*from* are somebody else's, and are listed here so that nobody has to guess where
a line came from. `occupation-maps/README.md` gives each scanned sheet's Commons
page, author and licence.

| What is drawn | Traced from |
|---|---|
| The occupied zone in China, December 1942 | The 1940 sheet of the US Army *China 1900–1949* series — public domain |
| The pacified and un-pacified areas, the alternative reading in Layers | 付図第五「北支那方面軍占拠地域内治安概況（昭和十七年九月中）」, an appendix to 『北支の治安戦＜2＞』(戦史叢書 50, 1971), held by the National Institute for Defense Studies |
| Manchukuo and its fourteen provinces | 滿洲國地圖 1935, South Manchuria Railway Company research section |
| Mengchiang and Outer Mongolia | 支那全土並附近大地圖・欧洲現勢大地圖, a Japanese sheet of the period |
| The Kwantung Leased Territory, mainland and nineteen islands | a 1935 sheet |
| The Communist base areas and guerrilla zones, 1941–42 | p199 of 武月星主編，《中國抗日戰爭史地圖集：1931–1945》 (Wu Yuexing, ed.) |
| The princely states of India; British India in 1931 and the French and Portuguese enclaves in it; Nepal, Afghanistan, Sikkim and Bhutan | the 1931 Imperial Gazetteer of India sheets |
| The Pacific mandates — Japan's, Australia's and the British mandate over Nauru | a period sheet of the mandate boundaries |
| The thirteen provinces of colonial Korea, with their coastline | a map of the period |
| Weihaiwei and Kwangchowan | the author's own *Modern East Asia GIS* project |

### What that means for reuse

Where a shape in this repository is derived from one of the datasets above,
**the source's conditions travel with the shape**. A share-alike source stays
share-alike — that is OpenStreetMap's ODbL, Lilauid's Republican provinces and
Xufanc's Saharat map. An attribution source still has to be attributed — that
is ENP-China and geoBoundaries. The dedication in section 1 cannot release
anyone from those obligations and does not attempt to; it applies to the work
done here and not to the material it was done on. If you are taking geometry
rather than code, read `docs/SOURCES.md` first and find out which source it came
from.

## 3. A request, not a condition

CC0 asks for nothing, and this asks for nothing either. It is a request, and
you are free to ignore it without asking.

If you use this map, or shapes taken out of it, please acknowledge the
**georeferencing**. That is where most of the time here went: not in drawing
new borders, but in working out where somebody else's drawing actually sits on
the earth, and in reconciling half a dozen sources that disagree by a
kilometre or two about the same coast. Something like

> Georeferencing and tracing: Konrad Lawson, *An interactive map of the
> Japanese Empire*.
> https://github.com/kmlawson/japanese-empire-student-map

is plenty.

Where the shape came from a source that has its own attribution requirement,
that requirement is the one that must be met. This request is in addition to
it and is no substitute for it.
