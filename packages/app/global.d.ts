declare module "*.css";

declare module "*.woff2" {
  const asset: string;
  export default asset;
}

declare module "*?raw&url" {
  const source: string;
  export default source;
}
