// ffprobe-static ships no type declarations; it exports `{ path: string }`.
declare module "ffprobe-static" {
  const ffprobe: { path: string };
  export default ffprobe;
}
