import initPoster, { create_stencil } from "./poster-DKlr3gMi.js";

const POSTER_ENABLED = false;

globalThis.__OMP_POSTER_MODULE__ = {
  enabled: POSTER_ENABLED,
  init: () => initPoster({ module_or_path: "/poster_bg-DAFj3nST.wasm" }),
  createStencil: create_stencil,
};
