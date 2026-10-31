// Resolve emphasis against actual caption times; never infer word-level timestamps.
export function rhythmPlan(p, speech) {
  const firstEnd=speech.scenes[0]?.end??0;
  const introDuration=Math.max(0,Math.min(4,firstEnd-.05));
  const opening=!!p.opening?.enabled&&introDuration>=.3;
  const sentence=p.scenes[0]?.text.split(/[。！？]/u)[0]?.trim()||p.title;
  const clauses=sentence.split(/[，,：:]/u).filter(Boolean);
  const fallback=sentence.length>24&&clauses.length>=3?clauses.slice(-2).join('，'):sentence;
  const title=(p.opening?.title.trim()||fallback).slice(0,40);
  let last=-6;
  const accents=[];
  for(const c of speech.captions||[]){
    if(c.start<(opening?introDuration:0)||c.start-last<6)continue;
    const text=c.text.trim();
    if(text.length>20||!/[？?]|却|不是|别急|第一|第二|第三|\d|到底|关键|先看|不会|还是/u.test(text))continue;
    const shot=speech.scenes.find(s=>c.start>=s.start&&c.start<s.end);
    if(!shot)continue;
    const end=Math.min(c.end,shot.end-.1);
    if(end-c.start<.7)continue;
    accents.push({text,start:c.start,end,sceneId:shot.id});last=c.start;
  }
  return {opening,introDuration,title,accents};
}
