Placeholder: icon-192.png and icon-512.png are referenced by app/manifest.ts
but were not generated in this pass (no image-generation step was run for a
branding asset). Drop real 192x192 and 512x512 PNGs here before shipping —
the manifest will otherwise fail Lighthouse's installability check.
