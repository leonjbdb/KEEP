// Every published KEEP release before this one, oldest first. This is what
// lets a newer keep.html vouch for a RECOVERY.html made years earlier: undo
// the kit's two swaps (kitfile.js) and the hash of what is left must be one
// of these.
//
//   keep  SHA-256 of the release's blank keep.html, exactly as published
//         in its README (and so as committed in dist/keep.html at its tag).
//         Since 1.1.0 a kit's code hashes to this value too.
//   kit   only for 1.0.x: those kits were written from the browser's
//         re-serialized copy of the page, which differs from the published
//         file in a few spots (whitespace around the header comment, the
//         wrapped CSP tag, the licence after the script), so their code
//         hashes to the serialized form instead. Recorded from Chrome.
//
// A build cannot list itself: its own hash is only known once it is built.
// When version N+1 is prepared, N's published hash goes here; the test suite
// (test/kitfile.test.mjs) fails until every earlier v* tag is listed.
//
// No v1.0.1: that release was withdrawn and its tag retired.

export const KNOWN_RELEASES = [
  {
    version: "1.0.0",
    keep: "c88925e2a45ef08cff2c4939ce40f0748da51cd0372378b5c3b9867246240dc2",
    kit: "3bad02c2f6f276c643981d09ade8ca392d2dbad9e4efcab5404a5cbf312460c9",
  },
  {
    version: "1.0.2",
    keep: "94fe3c2ce07dcadb4668ab763ea6e7b9fa9bdf77097ffe7cf45f071bbcaa1bf6",
    kit: "db01c86a12b7a61c097553271846c1b7c7a8ce8be11b8d505efaacaef84e112a",
  },
  {
    version: "1.0.3",
    keep: "e5feb78bfca8dfb57fe34aaa2e689b2b5f4fcfdc1f7ebc3988ffdac16ec3daa4",
    kit: "7709b8fc9de75db582e7c424d737d22a7b8f857adc42952a81d4a557dc3d5780",
  },
  {
    version: "1.1.0",
    keep: "2eaef4016f7bf9eaecf379cb269d9f65332e976ebd6abbf503930f4d5c587d6d",
  },
];
