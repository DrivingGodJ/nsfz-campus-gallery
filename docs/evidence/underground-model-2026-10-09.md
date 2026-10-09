# Underground venue reconstruction — 2026-10-09

All 13 annotated source images were read as contact sheets, then the hall, lightwell, low corridor, and practice-strip photographs were inspected at full preview size. No source photograph, X/Z shooting position, direction, pitch, EXIF, or non-underground camera height is replaced.

## Levels and coherent photo height

- Shared floor: -3.8 m, previously -3 m. This is an estimate, not a measured basement elevation. A common floor preserves all approved passage connections.
- Tunnel clear height: 3.2 m, inferred from ceiling panels, wall lamps, door proportions and people; top -0.6 m.
- Exit and underground corridor clear height: 4 m, inferred from round columns and a glazed lightwell above the long wing; top +0.2 m. The closed low return wing is retained beneath the same outer enclosure.
- Underground sports hall and sheltered practice strip: 6.2 m, inferred from high overhead beams, the intermediate perimeter maintenance gallery, the clerestory, and people/net height. Top +2.4 m remains below the raised sports deck at +3.6 m.
- Main entrance bottom follows the new floor; 23 treads keep each rise near 17 cm. Its approved horizontal curve and entrance position remain unchanged. The old solid cube marker is replaced with an open glass canopy, steel portal frames and continuous stair handrails.
- All 13 photographs move down by 0.8 m in world coordinates through the shared height resolver. Missing eye heights are recorded as the existing 1.6 m default. Four manual low/crowd eye heights (0.3 m, 0.6 m, 1 m, 0.3 m) are preserved. The committed values are in `public/data/site.json` by exact photo ID; feature elevations and clear heights are in `public/data/campus.json` and the persistent `data/campus-corrections.json`. The review-only local patch is not a deployment input.

## Source-to-model ledger

| Source | Confirmed visible features | Implemented interpretation |
| --- | --- | --- |
| DSC01480 (35af56d9) | Green peripheral floor, pale timber multipurpose zone, silver panel walls, overhead red pipes/ducts, white gallery rail, support columns, retractable basketball backboard | Green badminton hall with bounded timber end bay, structural columns, ceiling beams, long clerestory windows/gallery rails, ducts/pipes, end backboard |
| DSC07554 (74f60c2f) | High paneled wall, narrow high window/gallery, bright daylight wedge and green floor | High wall bands with real clerestory openings, panel joints, green floor and overhead gallery |
| _DSC0337 (79cd84d6) | Yellow portable net post/base, green playing floor, white badminton lines, high paneled wall | Regulation-proportion court line layouts, portable posts/base and net panels, high wall glazing |
| DJI_20231019140600_0059_D (0ec460c7) | Badminton nets, white perimeter gallery rail, gray beam ceiling, red service pipes, bright high windows | Same coherent hall structure, rails, courts, service and light batches |
| DSC08912 (559153e7) | Tall practice-strip wall, bright high window, upper service structure | High practice-strip enclosure, end clerestory, overhead frames/pipes |
| DSC08915 (ddcdc8a8) | Long narrow sports strip, gray tiled lower walls, net posts/nets, red upper tape, blue stools and wall lamps | Retained painted strip with removable practice nets, blue stools, tile joints, drains, wall lamps/pipes |
| DSC03602-已增强-降噪 (6877d72b) | Low closed corridor, polished blue-gray floor, paired red pipes, wall lamps, stacked movable equipment | Corridor floor/ceiling/service network and lamps. Stacked equipment is not added because its permanent location and footprint are uncertain |
| _DSC9517 (f8853bef) | Ground-level reflection, low corridor, wall lamps, overhead pipes, bright doorway | Low photo eye height preserved; actual floor/door apertures, lamps and paired service strips |
| DJI_20231020142241_0068_D (db564407) | Long skylight, round columns, black window band, white wall, tiled lower wall | Glazed lightwell along long wing, round columns, mullioned building-side windows, wall-panel joints and drain strip |
| DJI_20231020142247_0070_D (07fa62be) | Same lightwell/round columns with clearer side drain and dark window wall | Same connected lightwell, columns, windows and drains |
| 向上 (06863d9c) | Ascending stair, metal handrails, light-gray paneled walls, glazed entrance cover | Approved stair curve retained, open glass canopy/steel portals/stair rails replace false solid entry cube |
| DSC03643 (d1e18779) | Crowded low viewpoint toward the stair opening and rectangular ceiling lamps | Manual low eye height preserved; connected stair entrance and real ceiling/wall light positions |
| _DSC8295 (2de4e955) | Orange floor guide line, rectangular ceiling lamps, white panel walls and a short rise toward a side/end exit | Guide strip, lights, panel walls and open passage. Exact short end-stair level remains uncertain; no invented step barrier is inserted into the approved same-level main route |

## Estimates and limits

- Repeated courts, column bay spacing, service pipe routing, timber-zone depth and clerestory bay spacing fit the approved footprint and photographic proportions; their exact counts and dimensions are estimates. This is a navigable visual reconstruction, not a surveyed building drawing.
- No whole underground garage is added. The previously approved internal garage entrance ramp remains unchanged.
- Doorways at both sports-hall/practice-strip ends are genuine wall cuts. Taller walls remain above openings. Different tunnel/corridor ceilings join below the lower ceiling, with the upper wall retained.
- The practice-strip floor is trimmed at the passage connection rather than overlapping the corridor floor. Route centerlines and photo positions remain unchanged.
- All details remain in approximately 30,464 triangles, merged by material. They do not count as photograph-occluding geometry. Exterior map inspection keeps the existing obstruction-layer opacity. A camera inside its own footprint and below the ceiling gets opaque, normally depth-tested/depth-writing structural materials; glass and nets stay translucent. Nearby venues depth-test against that room instead of painting through its walls. The detailed wall shell, including real clerestories and doorways, replaces the coarse plan volume inside. Plan floors/outlines are hidden inside and ceilings disappear for overhead inspection. The curved entry stair uses the same internal material mode; its 3.2 m lower landing cuts an actual opening into the tunnel end wall, fixing the earlier stair projected through a closed end cap. The raised sports deck and campus ground are hollowed above/beside the rooms, so these views rely on real clearance rather than disabled depth tests.

## Verification

The focused geometry, rendering, placement and metadata tests passed: both sports-hall doors are open at eye height with heads above, different ceiling heights connect correctly, floors are continuous without an overlapping practice-strip patch, all detail vertices are finite and between their floor/ceiling, low-height photo placement and entrance treads remain valid, and all decorative batches retain a zero photo-occlusion mask.

## Photo height audit

All values are metres. Eye heights stay relative to the venue floor; world heights are resolved by `src/locations.ts`. Four manual low/crowd views retain their original relative eye height.

| Photo ID | Title | Eye height before → after | World height before → after |
| --- | --- | --- | --- |
| 35af56d9-984d-43be-82bb-aaa47ddefb37 | DSC01480 | 1.6 → 1.6 | -1.4 → -2.2 |
| 06863d9c-c0cb-4a6f-b6f1-b1080f9f9efa | 向上 | 1.6 → 1.6 | -1.4 → -2.2 |
| 559153e7-dd9d-4b0f-a940-2eefc5241831 | DSC08912 | 1.6 → 1.6 | -1.4 → -2.2 |
| ddcdc8a8-f5c6-44c7-aa41-25911197d4c3 | DSC08915 | 1.6 → 1.6 | -1.4 → -2.2 |
| 74f60c2f-421b-4c1b-8b33-5ac6db39bc03 | DSC07554 | 1.6 → 1.6 | -1.4 → -2.2 |
| d1e18779-30db-424f-be64-7d2d35602be7 | DSC03643 | 1 → 1 | -2 → -2.8 |
| 6877d72b-047f-4958-9795-958e116ace05 | DSC03602-已增强-降噪 | 0.6 → 0.6 | -2.4 → -3.2 |
| 79cd84d6-bf4a-4331-9a08-5b4f81ea1f00 | _DSC0337 | 1.6 → 1.6 | -1.4 → -2.2 |
| f8853bef-6b8f-4920-9deb-750d18668fb4 | _DSC9517 | 0.3 → 0.3 | -2.7 → -3.5 |
| 2de4e955-98d2-4157-bed7-7ee448f1a77a | _DSC8295 | 0.3 → 0.3 | -2.7 → -3.5 |
| 0ec460c7-55b5-4283-99ce-dcdcde63ac71 | DJI_20231019140600_0059_D-已增强-降噪 | 1.6 → 1.6 | -1.4 → -2.2 |
| db564407-9db3-4e82-9f08-0d6ac779beef | DJI_20231020142241_0068_D-已增强-降噪 | 1.6 → 1.6 | -1.4 → -2.2 |
| 07fa62be-e579-426a-a286-02b3a741dfe5 | DJI_20231020142247_0070_D-已增强-降噪 | 1.6 → 1.6 | -1.4 → -2.2 |

## Actual-pose checks

The source shooting positions, headings and pitches were retained. In the stored DSC01480 pose, the solid hall shows the green playing floor, white court lines/net posts, wall panels, round columns, high glazing and ceiling service runs. In the stored 向上 pose, the genuine tunnel doorway reveals ascending solid stair treads and metal handrails without the old translucent stair ghosting through a wall. Full-campus camera coverage and remaining alignment limits are tracked separately.
