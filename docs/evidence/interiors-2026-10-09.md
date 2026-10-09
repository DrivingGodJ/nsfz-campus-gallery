# Photo-backed interior details — 2026-10-09

The eight full previews below were inspected individually. Details are tied to fixed model anchors in `src/photo-interior-geometry.ts`, inside the actual occupied floor shapes. Changing a photograph's pose does not move furniture. No photo file, manual pose, EXIF or building outline is changed by this component.

## Source observations

| Photo ID / title | Floor | Confirmed observation / interpretation |
| --- | --- | --- |
| 719592c1-5539-42c7-b21a-7d9492d273b0 / 2025 年 04 月 23 日12时25分 | Cafeteria 2 | Green rectangular tables, timber legs, white/orange/green chair backs and round columns. 39 six-chair sets and four columns fit the curved lower floor. Three sets occupy the photographed near window bay; the standing position and central aisle remain clear. Counts/spacing are estimates. |
| a4661989-e16c-4399-8edb-6c5a8a2223fe / _DSC9853-已增强-降噪 | Dormitory 6 | Large tilted open-truss reflector, white fork mount and small timber side table. One open-ring/truss telescope at [-5.25, 132.5], with its own fixed optical axis. The existing observatory dome is at the same location. |
| 88338113-b195-4d6d-a689-628603b6fc3f / _DSC3117 | Laboratory 6 | Timber slat ceiling and zigzag lights on the balcony approach. This is not evidence of a round timber-walled room. Slats/light strip are added at laboratory local [57.8, 13.2]. |
| 8904ca53-186b-44ac-b32b-6603b313e39b / _DSC7695 | Laboratory 6 | Timber decking, steel space frame and two folded black umbrellas on the balcony. Simplified frame and umbrellas occupy the existing branch platform, local [circleU, 23]. Timber finish is clipped to the actual platform. |
| 15ce2084-cd0d-4410-8f6d-112dae3e127a / _DSC8910 | Laboratory 1 | Painted art wall, leaning canvases, paint pots and red ceiling pipe. This is not an exhibition-table hall. Thin schematic colored panels/pots sit on the classroom-side wall at local [58, 3.8], clear of the garage opening; the artwork itself is not reproduced. |
| dc98c0fb-fd4a-4158-81cd-5e4926f9d9a9 / DSC03631 | Laboratory 1 | Four blue-backed barrel seats beside a timber-topped gallery rail. Seats follow the existing gallery at local u = 29.4 + 1.6 × index, v = 14.85; the rail is not duplicated. |
| 49036e82-ea4a-4195-a5b4-f571794f438b / DSC07200 | Theatre 5 | Three shallow white window steps, an orange bench and red fire case. Fixed on the outer side of the existing narrow window gallery, preserving its walking side. |
| f07686c3-cedb-4632-9441-80413ab4b9bf / DSC07199 | Theatre 5 | Exhibition frames and ceiling spotlights along that gallery. Five simple frames and a lighting track follow the same wall anchor. |

Coordinates are model metres [east, south]; laboratory anchors use `laboratoryLayout.at(u, v)`. These placements reuse floor plates and walls rather than adding duplicate solid rooms, theatre seating or gym details already represented elsewhere.

## Observatory correction

The ordinary sixth-floor roof formerly crossed the real observatory cavity, and the dome's support was a solid box. `dormitoryBodyGeometry` now keeps the surrounding roof but removes a fixed circular patch below the dome; its support is an empty circular drum. The sixth-floor slab beneath the instrument remains. The telescope height is estimated to fit that high room (about 4.8 m envelope), and its upper truss extends into the dome only in an intact building view. Selected-floor slicing still clips it at the chosen level. The source camera's manual 3.5 m eye height and 27° upward pitch remain unchanged.

## Visibility checks and limits

- The stored cafeteria pose now visibly shows near green tables, white/orange chair backs and a column. Earlier broad grid envelopes had rejected that small window bay and left the view empty; the fixed near-bay sets correct this.
- The stored telescope pose now shows the upper black optical ring and metal truss inside the hollow dome. This is a schematic instrument; the exact optical scale, fork proportions and photographic framing remain estimates.
- The art-wall photograph retains a manually set 0.1 m eye height and downward pitch. Its camera is below the model's approximately 0.37 m floor surface, so the stored view still shows floor/near masonry instead of the artwork. No camera data is silently changed and no artificial pit is made to hide this mismatch.
- The balcony photograph is at laboratory local u = 26.85, v = 20.56 and points west. The fixed platform frame is east of that stored camera (u approximately 27.5–39.8), so its original view does not show that frame. The observed structure is modeled on the actual platform; it is not placed in mid-air ahead of an inconsistent pose.

## Rendering and verification

There are 66 fixed placement records across four buildings: 39 dining sets (234 chairs), four columns, telescope/table, 12 laboratory detail records, and nine theatre gallery records. Geometry adds 24,308 triangles in 23 total material batches; the busiest building has eight. The component shares color materials, disposes geometry on rebuild, and hides its group beyond 280 m. Every detail carries a zero photo-occlusion mask. Overhead slats, pipes, lights and space frames disappear with the selected ceiling; furniture and floor finishes remain below the slice.

Five targeted tests verify evidence/floor identity, complete footprint clipping, garage and gallery clearance, finite geometry and the triangle budget, deterministic anchors, visible near-window table placement, and the observatory's true open roof/hollow support with the lower floor preserved. The full photo-facade regression suite and TypeScript build also pass.
