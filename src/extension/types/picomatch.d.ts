// Minimal typing for the parts of picomatch this extension uses; @types/picomatch is not installed.
declare module "picomatch" {
  interface PicomatchOptions {
    dot?: boolean;
    nocase?: boolean;
    windows?: boolean;
  }
  type Matcher = (input: string) => boolean;
  function picomatch(glob: string | string[], options?: PicomatchOptions): Matcher;
  export = picomatch;
}
