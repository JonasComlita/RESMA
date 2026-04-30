## 2024-05-01 - Optimizing SVG Re-rendering
**Learning:** In React, constantly updating parent state (like a `viewport` from zooming/panning) causes children to re-render. If there are many inline elements (like SVG paths and nodes), diffing these frequently causes significant jank.
**Action:** Extract inline elements mapped from arrays into discrete, `memo()`ized components, and use `useCallback()` to provide stable callbacks. This drastically cuts down on the work the renderer has to do on each frame.
