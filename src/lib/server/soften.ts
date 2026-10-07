// Pure (no server imports) so unit tests can load it directly.

const HARSH: [RegExp, string][] = [
  [/\b(guns?|pistols?|rifles?|revolvers?|firearms?|weapons?)\b/gi, "prop"],
  [/\b(blood(y|ied)?|gore|wounds?|bleeding)\b/gi, "red ink"],
  [/\b(kill(s|ed|ing)?|murder(s|ed|ing)?|shoot(s|ing)?|shot dead|stab(s|bed|bing)?)\b/gi, "confront"],
  [/\b(dead|corpses?|bod(y|ies) on the floor)\b/gi, "still"],
  [/\b(mobsters?|gangsters?|hitm[ae]n)\b/gi, "stern figure"],
];
/** The same shot with the words fal's filter trips on swapped for tamer ones, framed as a non-graphic comic panel. */
export function soften(prompt: string) {
  return `non-graphic, all-ages comic illustration: ${HARSH.reduce((p, [re, to]) => p.replace(re, to), prompt)}`;
}
