import { encode, decode } from "gpt-tokenizer";
export function chunkText(text: string, opts:{minTokens:number,maxTokens:number,overlap:number}){
  const toks = encode(text);
  const out: any[] = [];
  const step = opts.maxTokens - opts.overlap;
  for (let i = 0; i < toks.length; i += step) {
    const end = Math.min(i + opts.maxTokens, toks.length);
    out.push({ offset: i, length: end - i, text: decode(toks.slice(i, end)) });
  }
  return out;
}
