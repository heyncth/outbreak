# Bundled road graphs

`manifest.json` lists zones: `bbox` = `[south, west, north, east]`.
Game loads manifest at build time, picks zone containing player GPS, fetches `<name>.json`.
No zone match → free-move fallback.

## Add a zone

1. Geofabrik PBF: `https://download.geofabrik.de/asia/vietnam.html`
2. Cut (temp script, see `C:/Temp/opencode/pipeline/cut.js` or regenerate):

```
node cut.js <lat> <lng> <radius_m> <outfile>
```

3. Copy `<outfile>` here, append zone entry to `manifest.json`.
