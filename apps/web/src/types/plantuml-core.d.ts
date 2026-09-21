// @plantuml/core ships no type declarations. The engine itself runs inside
// the sandboxed iframe (loaded as a classic script from the versioned public
// assets); only package.json is imported, for the versioned asset path.
declare module "@plantuml/core/package.json" {
  const pkg: { version: string };
  export default pkg;
}
