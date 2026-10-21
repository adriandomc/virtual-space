# PBR materials

Photographic maps from [Poly Haven](https://polyhaven.com), distributed under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Commercial use and redistribution are permitted; attribution is not required for these bundled assets. [Provider license](https://polyhaven.com/license).

| Directory | Asset and author | Physical repeat |
| --- | --- | --- |
| `wood` | [Wood Floor](https://polyhaven.com/a/wood_floor), Dimitrios Savva | 1.70 × 1.70 m |
| `plaster` | [White Plaster 02](https://polyhaven.com/a/white_plaster_02), Rob Tuytel | 1.00 × 1.00 m |
| `stone` | [Concrete Floor](https://polyhaven.com/a/concrete_floor), eye-candy.xyz | 2.08 × 2.08 m |
| `marble` | [Marble 01](https://polyhaven.com/a/marble_01), Rob Tuytel | 1.50 × 1.50 m |
| `fabric` | [Cotton Jersey](https://polyhaven.com/a/cotton_jersey), colormass (photography), Rico Cilliers (processing) | 0.264 × 0.264 m |

Each directory includes `color.jpg` (sRGB), `normal.jpg` (OpenGL tangent-space normals, linear data) and `arm.jpg` (linear data: R = ambient occlusion, G = roughness, B = metalness). These are the original 1K JPGs: 1024 × 1024, except Cotton Jersey at 1024 × 1025. The `512/` directory contains reduced JPEG variants. No external asset host is contacted during application use.

`manifest.json` records original URLs, authors, sizes and MD5/SHA-256 hashes. Downloads were verified against the provider's sizes and MD5 on 2026-10-12, then decoded to check integrity and dimensions. The API was used only during local preparation with User-Agent `VirtualSpace-asset-preparation/1.0`.

## Compressed variants

`ktx2/{512,1024}/` contains 30 Basis Universal KTX2 maps with complete mip chains. Dimensions fit the selected maximum and align to 4 × 4 compression blocks for WebGPU. The fabric source is resized from 1024 × 1025 to 1024 × 1024; its aspect changes by less than 0.1%. Color uses the sRGB transfer function; normals and ARM remain linear. The source is flipped to bottom-left texture origin during encoding because compressed textures cannot rely on runtime `flipY`.

The checked-in outputs were generated with official [KTX-Software 4.4.2](https://github.com/KhronosGroup/KTX-Software/releases/tag/v4.4.2). `scripts/encode-materials.mjs` uses ETC1S/BasisLZ quality 255 and compression level 2 for color and ARM, and UASTC quality 2 with RDO 0.25 and Zstd 18 for normal maps. Normal RGB channels remain intact. Each output passes `ktx validate`, and the manifest records its bytes, SHA-256, dimensions, encoding and transfer function.

Run `npm run assets:encode` with `ktx` on `PATH`, or set `KTX_BINARY` to the executable. Append surface names to regenerate only those maps, for example `npm run assets:encode -- fabric`. No encoder runs in production. Original JPEGs remain a runtime fallback and are included with KTX2 assets in offline preparation. The local [Basis transcoder](../decoders/basis/README.md) selects a GPU format supported by the active rendering backends.
